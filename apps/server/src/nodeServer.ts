import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

const JSON_TYPE = 'application/json; charset=utf-8';

class NodeBodyTooLargeError extends Error {}

async function body(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<unknown>) {
    const bytes =
      typeof chunk === 'string'
        ? Buffer.from(chunk)
        : chunk instanceof Uint8Array
          ? chunk
          : undefined;
    if (bytes === undefined) throw new TypeError('Unsupported request chunk');
    size += bytes.byteLength;
    if (size > maxBytes) throw new NodeBodyTooLargeError();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function writeResponse(
  response: Response,
  target: ServerResponse,
): Promise<void> {
  target.writeHead(
    response.status,
    Object.fromEntries(response.headers.entries()),
  );
  if (response.body !== null) {
    for await (const chunk of response.body) target.write(Buffer.from(chunk));
  }
  target.end();
}

export function createNodeServer(
  handler: (request: Request) => Promise<Response>,
  maxBodyBytes = 10 * 1024 * 1024,
) {
  const handleNodeRequest = async (
    incoming: IncomingMessage,
    outgoing: ServerResponse,
  ): Promise<void> => {
    try {
      const authority = incoming.headers.host ?? '127.0.0.1';
      const requestBody = await body(incoming, maxBodyBytes);
      const request = new Request(
        new URL(incoming.url ?? '/', `http://${authority}`),
        {
          ...(requestBody === undefined ? {} : { body: requestBody }),
          headers: Object.fromEntries(
            Object.entries(incoming.headers).flatMap(([key, value]) =>
              value === undefined
                ? []
                : [[key, Array.isArray(value) ? value.join(', ') : value]],
            ),
          ),
          ...(incoming.method === undefined ? {} : { method: incoming.method }),
        },
      );
      await writeResponse(await handler(request), outgoing);
    } catch (error: unknown) {
      if (!outgoing.headersSent) {
        const tooLarge = error instanceof NodeBodyTooLargeError;
        outgoing.writeHead(tooLarge ? 413 : 500, {
          'content-type': JSON_TYPE,
        });
        outgoing.end(
          JSON.stringify({
            error: tooLarge
              ? {
                  code: 'HTTP_413',
                  message: 'Request body exceeds the configured limit',
                }
              : {
                  code: 'INTERNAL_ERROR',
                  message: 'The request failed unexpectedly',
                },
          }),
        );
      } else outgoing.destroy();
    }
  };
  return createServer((incoming, outgoing) => {
    void handleNodeRequest(incoming, outgoing);
  });
}

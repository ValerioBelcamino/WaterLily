import type {
  ChatProvider,
  ChatRequest,
  ChatStreamEvent,
  FetchImplementation,
} from '../src/index.js';

export const basicRequest: ChatRequest = {
  messages: [{ content: 'Hello', role: 'user' }],
  model: 'test-model',
};

export async function collect(
  provider: ChatProvider,
  request: ChatRequest = basicRequest,
  signal?: AbortSignal,
): Promise<readonly ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of provider.streamChat(
    request,
    signal === undefined ? {} : { signal },
  )) {
    events.push(event);
  }
  return events;
}

export function sseResponse(
  payload: string,
  byteChunkSizes: readonly number[] = [Number.MAX_SAFE_INTEGER],
): Response {
  const bytes = new TextEncoder().encode(payload);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let offset = 0;
      let chunkIndex = 0;
      while (offset < bytes.length) {
        const requested =
          byteChunkSizes[chunkIndex % byteChunkSizes.length] ?? 1;
        const size = Math.max(1, requested);
        controller.enqueue(
          bytes.slice(offset, Math.min(bytes.length, offset + size)),
        );
        offset += size;
        chunkIndex += 1;
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
    status: 200,
  });
}

export function successfulFetch(payload: string): FetchImplementation {
  return () => Promise.resolve(sseResponse(payload));
}

export function completionPayload(
  finishReason = 'stop',
  options: { readonly includeDone?: boolean; readonly model?: string } = {},
): string {
  const chunk = JSON.stringify({
    choices: [
      {
        delta: { content: 'ok' },
        finish_reason: finishReason,
        index: 0,
      },
    ],
    created: 1_786_000_000,
    id: 'response-1',
    model: options.model ?? 'test-model',
  });
  return `data: ${chunk}\n\n${options.includeDone === false ? '' : 'data: [DONE]\n\n'}`;
}

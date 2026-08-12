import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import process from 'node:process';
import { setTimeout } from 'node:timers';

const host = '127.0.0.1';
const port = 4320;

function streamChunk(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404);
    response.end();
    return;
  }

  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        payload.model !== 'e2e-local' ||
        payload.stream !== true ||
        !Array.isArray(payload.messages) ||
        payload.messages.length === 0
      ) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end('{"error":{"message":"Invalid test request"}}');
        return;
      }
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end('{"error":{"message":"Malformed test request"}}');
      return;
    }

    response.writeHead(200, {
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
    });
    const base = {
      created: 1_786_000_000,
      id: 'e2e-response',
      model: 'e2e-local-resolved',
    };
    streamChunk(response, {
      ...base,
      choices: [
        {
          delta: { reasoning_content: 'Trace the explicit graph context. ' },
          finish_reason: null,
          index: 0,
        },
      ],
    });
    setTimeout(() => {
      streamChunk(response, {
        ...base,
        choices: [
          {
            delta: { content: 'The end-to-end response is committed.' },
            finish_reason: null,
            index: 0,
          },
        ],
      });
    }, 250);
    setTimeout(() => {
      streamChunk(response, {
        ...base,
        choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
        usage: { completion_tokens: 8, prompt_tokens: 42, total_tokens: 50 },
      });
      response.end('data: [DONE]\n\n');
    }, 600);
  });
});

server.listen(port, host);
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());

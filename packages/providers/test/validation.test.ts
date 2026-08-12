import { describe, expect, it } from 'vitest';

import {
  createOpenAICompatibleProvider,
  ProviderError,
  type ChatRequest,
} from '../src/index.js';
import {
  basicRequest,
  collect,
  completionPayload,
  sseResponse,
  successfulFetch,
} from './helpers.js';

function providerFor(payload: string) {
  return createOpenAICompatibleProvider({
    baseUrl: 'https://provider.example',
    fetch: successfulFetch(payload),
    id: 'test',
    name: 'Test',
  });
}

describe('provider validation', () => {
  it.each([
    { baseUrl: 'not a URL', id: 'test', name: 'Test' },
    { baseUrl: 'ftp://provider.example', id: 'test', name: 'Test' },
    { baseUrl: 'https://user:pass@provider.example', id: 'test', name: 'Test' },
    {
      baseUrl: 'https://provider.example?secret=yes',
      id: 'test',
      name: 'Test',
    },
    { baseUrl: 'https://provider.example#fragment', id: 'test', name: 'Test' },
    { baseUrl: 'https://provider.example', id: '', name: 'Test' },
    { baseUrl: 'https://provider.example', id: 'test', name: ' ' },
    {
      baseUrl: 'https://provider.example',
      headers: { AUTHORIZATION: 'secret' },
      id: 'test',
      name: 'Test',
    },
  ])('rejects unsafe provider configuration %#', (config) => {
    expect(() => createOpenAICompatibleProvider(config)).toThrow(
      expect.objectContaining({ code: 'CONFIGURATION_ERROR' }),
    );
  });

  it.each([
    { ...basicRequest, model: ' ' },
    { ...basicRequest, messages: [] },
    { ...basicRequest, maxOutputTokens: 0 },
    { ...basicRequest, maxOutputTokens: 1.5 },
    { ...basicRequest, temperature: -0.1 },
    { ...basicRequest, temperature: 2.1 },
    { ...basicRequest, temperature: Number.NaN },
    { ...basicRequest, topP: -0.1 },
    { ...basicRequest, topP: 1.1 },
    { ...basicRequest, topP: Number.POSITIVE_INFINITY },
    { ...basicRequest, providerOptions: { model: 'override' } },
  ] satisfies readonly ChatRequest[])(
    'rejects invalid requests %#',
    async (request) => {
      await expect(
        collect(providerFor(completionPayload()), request),
      ).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
    },
  );

  it.each([
    ['not-json', 'malformed JSON'],
    [JSON.stringify({ object: 'wrong' }), 'invalid chat completion chunk'],
    [
      JSON.stringify({
        choices: [null],
        id: 'response-1',
        model: 'test-model',
      }),
      'invalid completion choice',
    ],
    [
      JSON.stringify({ choices: [{}], id: 'response-1', model: 'test-model' }),
      'without a delta',
    ],
    [
      JSON.stringify({
        choices: [{ delta: { content: 42 } }],
        id: 'response-1',
        model: 'test-model',
      }),
      'invalid content',
    ],
    [
      JSON.stringify({
        choices: [{ delta: { reasoning_content: false } }],
        id: 'response-1',
        model: 'test-model',
      }),
      'invalid reasoning_content',
    ],
    [
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 4 }],
        id: 'response-1',
        model: 'test-model',
      }),
      'invalid finish reason',
    ],
  ] as const)('rejects bad stream chunk %#', async (chunk, message) => {
    await expect(
      collect(providerFor(`data: ${chunk}\n\ndata: [DONE]\n\n`)),
    ).rejects.toThrow(message);
  });

  it('rejects missing metadata and invalid usage', async () => {
    const missingMetadata = JSON.stringify({
      choices: [{ delta: { content: 'hello' } }],
    });
    const invalidUsage = JSON.stringify({
      choices: [],
      id: 'response-1',
      model: 'test-model',
      usage: { completion_tokens: -1, prompt_tokens: 2, total_tokens: 1 },
    });

    await expect(
      collect(providerFor(`data: ${missingMetadata}\n\ndata: [DONE]\n\n`)),
    ).rejects.toThrow('omitted response metadata');
    await expect(
      collect(providerFor(`data: ${invalidUsage}\n\ndata: [DONE]\n\n`)),
    ).rejects.toThrow('invalid token usage');
  });

  it('rejects a missing body, early EOF, and an empty DONE stream', async () => {
    const noBody = createOpenAICompatibleProvider({
      baseUrl: 'https://provider.example',
      fetch: () => Promise.resolve(new Response(null, { status: 200 })),
      id: 'test',
      name: 'Test',
    });
    await expect(collect(noBody)).rejects.toThrow('without a body');
    await expect(
      collect(providerFor(completionPayload('stop', { includeDone: false }))),
    ).rejects.toThrow('before its [DONE] marker');
    await expect(collect(providerFor('data: [DONE]\n\n'))).rejects.toThrow(
      'before emitting response metadata',
    );
  });

  it('retains the original protocol cause without exposing payload text', async () => {
    const error = await collect(providerFor('data: {broken}\n\n')).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: 'PROTOCOL_ERROR', status: null });
    expect((error as ProviderError).cause).toBeInstanceOf(SyntaxError);
    expect(String(error)).not.toContain('{broken}');
  });

  it('accepts a final timestamp-free chunk and maps it to null', async () => {
    const payload = completionPayload('stop');
    const withoutTimestamp = payload.replace(/,"created":\d+/, '');
    const events = await collect(providerFor(withoutTimestamp));
    expect(events[0]).toMatchObject({
      createdAt: null,
      type: 'response-start',
    });
  });

  it('uses a null timestamp for a non-finite provider timestamp', async () => {
    const chunk = JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      created: 'not-a-number',
      id: 'response-1',
      model: 'test-model',
    });
    const events = await collect(
      providerFor(`data: ${chunk}\n\ndata: [DONE]\n\n`),
    );
    expect(events[0]).toMatchObject({ createdAt: null });
  });

  it('processes multi-line SSE JSON and final data without a blank separator', async () => {
    const first = '{"choices":[{"delta":{"content":"ok"},';
    const second =
      '"finish_reason":"stop"}],"id":"response-1","model":"test-model"}';
    const response = sseResponse(
      `data: ${first}\ndata: ${second}\n\ndata: [DONE]`,
    );
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://provider.example',
      fetch: () => Promise.resolve(response),
      id: 'test',
      name: 'Test',
    });
    expect(await collect(provider)).toHaveLength(3);
  });
});

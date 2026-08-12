import { describe, expect, it, vi } from 'vitest';

import {
  createDeepSeekProvider,
  createOpenAICompatibleProvider,
  ProviderError,
  type FetchImplementation,
} from '../src/index.js';
import {
  basicRequest,
  collect,
  completionPayload,
  sseResponse,
  successfulFetch,
} from './helpers.js';

describe('OpenAI-compatible provider', () => {
  it('streams metadata, reasoning, text, usage, and completion across byte boundaries', async () => {
    const first = JSON.stringify({
      choices: [
        {
          delta: { content: '', reasoning_content: null, role: 'assistant' },
          finish_reason: null,
          index: 0,
        },
      ],
      created: 1_786_000_000,
      id: 'response-1',
      model: 'deepseek-v4-flash',
    });
    const reasoning = JSON.stringify({
      choices: [
        {
          delta: { reasoning_content: 'Think ' },
          finish_reason: null,
          index: 0,
        },
      ],
      id: 'response-1',
      model: 'deepseek-v4-flash',
    });
    const final = JSON.stringify({
      choices: [
        {
          delta: { content: 'Answer' },
          finish_reason: 'length',
          index: 0,
        },
      ],
      id: 'response-1',
      model: 'deepseek-v4-flash',
      usage: { completion_tokens: 3, prompt_tokens: 7, total_tokens: 10 },
    });
    const payload = `: keep-alive\r\ndata: ${first}\r\n\r\ndata: ${reasoning}\n\ndata: ${final}\n\ndata: [DONE]\n\n`;
    const provider = createDeepSeekProvider({
      apiKey: 'runtime-secret',
      fetch: () => Promise.resolve(sseResponse(payload, [1, 2, 5, 3])),
    });

    await expect(collect(provider)).resolves.toEqual([
      {
        createdAt: '2026-08-06T07:06:40.000Z',
        model: 'deepseek-v4-flash',
        responseId: 'response-1',
        type: 'response-start',
      },
      { delta: 'Think ', type: 'reasoning-delta' },
      { delta: 'Answer', type: 'text-delta' },
      { inputTokens: 7, outputTokens: 3, totalTokens: 10, type: 'usage' },
      {
        finishReason: 'length',
        rawFinishReason: 'length',
        type: 'response-end',
      },
    ]);
  });

  it('constructs a complete request without leaking adapter details into messages', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetch: FetchImplementation = (input, init) => {
      capturedUrl = input.toString();
      capturedInit = init;
      return Promise.resolve(sseResponse(completionPayload()));
    };
    const provider = createOpenAICompatibleProvider({
      apiKey: () => 'secret',
      baseUrl: 'http://127.0.0.1:11434/v1',
      fetch,
      headers: { 'X-Workspace': 'local' },
      id: 'ollama',
      includeUsage: true,
      name: 'Ollama',
    });

    await collect(provider, {
      maxOutputTokens: 123,
      messages: [
        { content: 'rules', name: 'guide', role: 'system' },
        { content: 'result', role: 'assistant' },
        { content: '{}', role: 'tool', toolCallId: 'call-1' },
      ],
      model: 'qwen3',
      providerOptions: { seed: 42, thinking: { type: 'disabled' } },
      stop: ['END'],
      temperature: 0.2,
      topP: 0.9,
    });

    expect(capturedUrl).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toMatchObject({
      Accept: 'text/event-stream',
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
      'X-Workspace': 'local',
    });
    const capturedBody = capturedInit?.body;
    expect(typeof capturedBody).toBe('string');
    if (typeof capturedBody !== 'string') return;
    expect(JSON.parse(capturedBody)).toEqual({
      max_tokens: 123,
      messages: [
        { content: 'rules', name: 'guide', role: 'system' },
        { content: 'result', role: 'assistant' },
        { content: '{}', role: 'tool', tool_call_id: 'call-1' },
      ],
      model: 'qwen3',
      seed: 42,
      stop: ['END'],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      thinking: { type: 'disabled' },
      top_p: 0.9,
    });
  });

  it('supports unauthenticated local providers and custom request paths', async () => {
    const fetch = vi.fn<FetchImplementation>(() =>
      Promise.resolve(sseResponse(completionPayload())),
    );
    const provider = createOpenAICompatibleProvider({
      apiKey: () => '   ',
      baseUrl: 'http://localhost:8000/',
      fetch,
      id: 'local',
      name: 'Local model',
      requestPath: 'api/chat/completions',
    });

    await collect(provider);
    const call = fetch.mock.calls[0];
    expect(call?.[0].toString()).toBe(
      'http://localhost:8000/api/chat/completions',
    );
    expect(call?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it.each([
    ['stop', 'stop'],
    ['content_filter', 'content-filter'],
    ['tool_calls', 'tool-calls'],
    ['insufficient_system_resource', 'other'],
  ] as const)('maps finish reason %s to %s', async (raw, expected) => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://provider.example',
      fetch: successfulFetch(completionPayload(raw)),
      id: 'test',
      name: 'Test',
    });

    const events = await collect(provider);
    expect(events.at(-1)).toEqual({
      finishReason: expected,
      rawFinishReason: raw,
      type: 'response-end',
    });
  });

  it('emits an unknown terminal reason when DONE follows content directly', async () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: 'partial' }, finish_reason: null }],
      id: 'response-1',
      model: 'test-model',
    });
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://provider.example',
      fetch: successfulFetch(`data: ${chunk}\n\ndata: [DONE]`),
      id: 'test',
      name: 'Test',
    });

    expect((await collect(provider)).at(-1)).toEqual({
      finishReason: 'other',
      rawFinishReason: null,
      type: 'response-end',
    });
  });

  it('preserves cancellation separately from network failure', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const aborting = createOpenAICompatibleProvider({
      baseUrl: 'https://provider.example',
      fetch: () => Promise.reject(new DOMException('aborted', 'AbortError')),
      id: 'test',
      name: 'Test',
    });
    const failing = createOpenAICompatibleProvider({
      baseUrl: 'https://provider.example',
      fetch: () => Promise.reject(new TypeError('socket failed')),
      id: 'test',
      name: 'Test',
    });

    await expect(
      collect(aborting, basicRequest, aborted.signal),
    ).rejects.toMatchObject({
      code: 'CANCELED',
    });
    await expect(collect(failing)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('returns bounded, structured HTTP errors and redacts credentials', async () => {
    const secret = 'super-secret-value';
    const provider = createOpenAICompatibleProvider({
      apiKey: secret,
      baseUrl: 'https://provider.example',
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { message: `invalid ${secret}${'x'.repeat(700)}` },
            }),
            { status: 401 },
          ),
        ),
      id: 'test',
      name: 'Test',
    });

    const error = await collect(provider).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      code: 'HTTP_ERROR',
      providerId: 'test',
      status: 401,
    });
    expect(String(error)).not.toContain(secret);
    expect(String(error).length).toBeLessThan(620);
  });

  it('does not surface arbitrary non-JSON provider bodies', async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://provider.example',
      fetch: () =>
        Promise.resolve(
          new Response('<private upstream page>', { status: 500 }),
        ),
      id: 'test',
      name: 'Test',
    });

    await expect(collect(provider)).rejects.toThrow('No diagnostic message');
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  createOpenAIResponsesProvider,
  ProviderError,
  type ChatProvider,
  type ChatRequest,
  type FetchImplementation,
} from '../src/index.js';
import { collect, sseResponse } from './helpers.js';

const request: ChatRequest = {
  messages: [{ content: 'hello', role: 'user' }],
  model: 'gpt-test',
};

const created = {
  response: {
    created_at: 1_786_000_000,
    id: 'response-1',
    model: 'gpt-test-resolved',
  },
  type: 'response.created',
};

function events(...values: readonly unknown[]): Response {
  return sseResponse(
    `${values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join('')}data: [DONE]\n\n`,
    [1, 3, 7, 2],
  );
}

function provider(
  fetch: FetchImplementation,
  overrides: Partial<Parameters<typeof createOpenAIResponsesProvider>[0]> = {},
): ChatProvider {
  return createOpenAIResponsesProvider({
    apiKey: 'test-secret',
    attachmentLoader: () =>
      Promise.resolve({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: 'application/pdf',
        name: 'paper.pdf',
      }),
    fetch,
    id: 'openai-test',
    name: 'OpenAI test',
    ...overrides,
  });
}

describe('OpenAI Responses provider', () => {
  it('sends named text, image, and document inputs and maps a complete stream', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const signal = new AbortController().signal;
    const fetch = vi.fn<FetchImplementation>((input, init) => {
      capturedUrl = input.toString();
      capturedInit = init;
      return Promise.resolve(
        events(
          created,
          { delta: 'think ', type: 'response.reasoning_summary_text.delta' },
          { delta: 'answer', type: 'response.output_text.delta' },
          { type: 'response.output_item.added' },
          {
            response: {
              usage: {
                input_tokens: 8,
                output_tokens: 3,
                total_tokens: 11,
              },
            },
            type: 'response.completed',
          },
        ),
      );
    });
    const attachmentLoader = vi.fn((attachmentId: string) =>
      Promise.resolve(
        attachmentId === 'image-1'
          ? {
              bytes: new Uint8Array([255, 216]),
              mediaType: 'image/jpeg',
              name: 'diagram.jpg',
            }
          : {
              bytes: new TextEncoder().encode('pdf'),
              mediaType: 'application/pdf',
              name: 'paper.pdf',
            },
      ),
    );
    const adapter = provider(fetch, {
      apiKey: () => 'test-secret',
      attachmentLoader,
      baseUrl: 'https://gateway.example/v1',
    });

    await expect(
      collect(
        adapter,
        {
          maxOutputTokens: 123,
          messages: [
            { content: 'rules', name: 'teacher', role: 'system' },
            {
              content: [
                { text: 'Inspect these.', type: 'text' },
                {
                  attachmentId: 'image-1',
                  mediaType: 'image/jpeg',
                  name: 'diagram.jpg',
                  type: 'attachment',
                },
                {
                  attachmentId: 'file-1',
                  mediaType: 'application/pdf',
                  name: 'paper.pdf',
                  type: 'attachment',
                },
              ],
              role: 'user',
            },
          ],
          model: 'gpt-test',
          providerOptions: { reasoning: { effort: 'medium' } },
          temperature: 0.4,
          topP: 0.8,
        },
        signal,
      ),
    ).resolves.toEqual([
      {
        createdAt: '2026-08-06T07:06:40.000Z',
        model: 'gpt-test-resolved',
        responseId: 'response-1',
        type: 'response-start',
      },
      { delta: 'think ', type: 'reasoning-delta' },
      { delta: 'answer', type: 'text-delta' },
      { inputTokens: 8, outputTokens: 3, totalTokens: 11, type: 'usage' },
      {
        finishReason: 'stop',
        rawFinishReason: 'completed',
        type: 'response-end',
      },
    ]);

    expect(capturedUrl).toBe('https://gateway.example/v1/responses');
    expect(capturedInit).toMatchObject({ method: 'POST', signal });
    expect(capturedInit?.headers).toMatchObject({
      Accept: 'text/event-stream',
      Authorization: 'Bearer test-secret',
      'Content-Type': 'application/json',
    });
    const capturedBody = capturedInit?.body;
    expect(typeof capturedBody).toBe('string');
    if (typeof capturedBody !== 'string') return;
    expect(JSON.parse(capturedBody)).toEqual({
      input: [
        {
          content: [
            { text: '[teacher]', type: 'input_text' },
            { text: 'rules', type: 'input_text' },
          ],
          role: 'system',
        },
        {
          content: [
            { text: 'Inspect these.', type: 'input_text' },
            {
              detail: 'auto',
              image_url: 'data:image/jpeg;base64,/9g=',
              type: 'input_image',
            },
            {
              file_data: 'data:application/pdf;base64,cGRm',
              filename: 'paper.pdf',
              type: 'input_file',
            },
          ],
          role: 'user',
        },
      ],
      max_output_tokens: 123,
      model: 'gpt-test',
      reasoning: { effort: 'medium' },
      stream: true,
      temperature: 0.4,
      top_p: 0.8,
    });
    expect(attachmentLoader).toHaveBeenCalledTimes(2);
  });

  it('maps incomplete responses and nullable metadata without usage', async () => {
    const adapter = provider(() =>
      Promise.resolve(
        events(
          {
            response: { created_at: 'unknown', id: 'r', model: 'm' },
            type: 'response.created',
          },
          { delta: '', type: 'response.output_text.delta' },
          { response: {}, type: 'response.incomplete' },
        ),
      ),
    );
    expect(await collect(adapter)).toEqual([
      {
        createdAt: null,
        model: 'm',
        responseId: 'r',
        type: 'response-start',
      },
      { delta: '', type: 'text-delta' },
      {
        finishReason: 'length',
        rawFinishReason: 'incomplete',
        type: 'response-end',
      },
    ]);
  });

  it.each([
    [{ ...request, messages: [] }, 'at least one message'],
    [{ ...request, model: ' ' }, 'non-blank model'],
    [{ ...request, stop: 'END' }, 'stop sequences'],
    [{ ...request, providerOptions: { model: 'override' } }, 'reserved field'],
    [
      {
        ...request,
        messages: [
          { content: '{}', role: 'tool' as const, toolCallId: 'call-1' },
        ],
      },
      'Tool messages',
    ],
  ])('rejects unsupported request input', async (input, message) => {
    await expect(
      collect(
        provider(() => Promise.resolve(events())),
        input,
      ),
    ).rejects.toThrow(message);
  });

  it('validates provider configuration and resolves keys at request time', async () => {
    expect(() =>
      provider(() => Promise.resolve(events()), { id: ' ' }),
    ).toThrow('cannot be blank');
    expect(() =>
      provider(() => Promise.resolve(events()), { baseUrl: 'not a URL' }),
    ).toThrow('base URL is invalid');
    for (const baseUrl of [
      'file:///tmp/api',
      'https://user:pass@example.com/v1',
      'https://example.com/v1?secret=x',
      'https://example.com/v1#fragment',
    ]) {
      expect(() =>
        provider(() => Promise.resolve(events()), { baseUrl }),
      ).toThrow('must be HTTP(S)');
    }
    await expect(
      collect(
        provider(() => Promise.resolve(events()), {
          apiKey: () => undefined,
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });

  it('wraps unavailable and mismatched local attachments', async () => {
    const attachmentRequest: ChatRequest = {
      messages: [
        {
          content: [
            {
              attachmentId: 'missing',
              mediaType: 'application/pdf',
              name: 'paper.pdf',
              type: 'attachment',
            },
          ],
          role: 'user',
        },
      ],
      model: 'm',
    };
    await expect(
      collect(
        provider(() => Promise.resolve(events()), {
          attachmentLoader: () => Promise.reject(new Error('private path')),
        }),
        attachmentRequest,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      collect(
        provider(() => Promise.resolve(events()), {
          attachmentLoader: () =>
            Promise.resolve({
              bytes: new Uint8Array(),
              mediaType: 'text/plain',
              name: 'other.txt',
            }),
        }),
        attachmentRequest,
      ),
    ).rejects.toThrow('metadata does not match');
  });

  it('separates cancellation and network failures', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(
        provider(() =>
          Promise.reject(new DOMException('canceled', 'AbortError')),
        ),
        request,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'CANCELED' });
    await expect(
      collect(provider(() => Promise.reject(new TypeError('socket failed')))),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('bounds and redacts structured HTTP failures', async () => {
    const secret = 'test-secret';
    const error = await collect(
      provider(() =>
        Promise.resolve(
          Response.json(
            { error: { message: `${secret}${'x'.repeat(700)}` } },
            { status: 401 },
          ),
        ),
      ),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      code: 'HTTP_ERROR',
      providerId: 'openai-test',
      status: 401,
    });
    expect(String(error)).not.toContain(secret);
    expect(String(error).length).toBeLessThan(620);

    await expect(
      collect(
        provider(() =>
          Promise.resolve(new Response('private HTML', { status: 500 })),
        ),
      ),
    ).rejects.toThrow('No diagnostic message');
    await expect(
      collect(
        provider(() =>
          Promise.resolve(
            Response.json({ error: 'not an object' }, { status: 400 }),
          ),
        ),
      ),
    ).rejects.toThrow('No diagnostic message');
  });

  it.each([
    [new Response(null), 'without a body'],
    [sseResponse('data: not-json\n\n'), 'malformed JSON'],
    [sseResponse('data: []\n\n'), 'invalid response event'],
    [events({ type: 'response.created' }), 'omitted response metadata'],
    [
      events({ response: { id: 2, model: null }, type: 'response.created' }),
      'metadata is invalid',
    ],
    [events(created, created), 'duplicate response metadata'],
    [
      events(created, { delta: 2, type: 'response.output_text.delta' }),
      'invalid text delta',
    ],
    [
      events(created, {
        delta: null,
        type: 'response.reasoning_summary_text.delta',
      }),
      'invalid reasoning delta',
    ],
    [
      events(created, {
        error: { message: 'stream failed' },
        type: 'error',
      }),
      'stream failed',
    ],
    [events(created), 'ended before completion'],
    [
      events(created, {
        response: { usage: 'bad' },
        type: 'response.completed',
      }),
      'invalid token usage',
    ],
    [
      events(created, {
        response: {
          usage: { input_tokens: -1, output_tokens: 1, total_tokens: 0 },
        },
        type: 'response.completed',
      }),
      'invalid token usage',
    ],
  ])('rejects malformed stream protocol', async (response, message) => {
    await expect(
      collect(provider(() => Promise.resolve(response))),
    ).rejects.toThrow(message);
  });
});

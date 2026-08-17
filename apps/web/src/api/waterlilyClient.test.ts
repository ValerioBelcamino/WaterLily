import {
  serializeNdjson,
  type GenerationApiRequest,
  type GenerationStreamItem,
  type WorkspaceSnapshot,
} from '@waterlily/api-contract';
import { describe, expect, it, vi } from 'vitest';

import { sampleGraph } from '../sampleGraph';
import { WaterLilyApiError, WaterLilyClient } from './waterlilyClient';

const workspace: WorkspaceSnapshot = {
  graph: sampleGraph,
  state: {
    contextSelections: {},
    version: 1,
    view: { groups: [], positions: {} },
  },
};

const generation: GenerationApiRequest = {
  context: {
    heads: [{ label: 'Selected', nodeId: 'node-synthesis', slot: 0 }],
    overrides: [],
  },
  graphId: sampleGraph.id,
  providerId: 'deepseek',
  request: { model: 'deepseek-v4-flash' },
  title: 'Generated',
};

function fetchMock(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof globalThis.fetch {
  return vi.fn(implementation);
}

function chunkedResponse(text: string, bytesPerChunk = 1): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += bytesPerChunk)
          controller.enqueue(bytes.slice(offset, offset + bytesPerChunk));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'application/x-ndjson' } },
  );
}

describe('WaterLilyClient', () => {
  it('invokes browser fetch with the global receiver', async () => {
    const receiver: { value?: unknown } = {};
    const fetchClient: typeof globalThis.fetch = function (this: unknown) {
      receiver.value = this;
      return Promise.resolve(Response.json({ providers: [] }));
    };

    await expect(new WaterLilyClient(fetchClient).health()).resolves.toEqual(
      [],
    );
    expect(receiver.value).toBe(globalThis);
  });

  it('loads health descriptors and a valid workspace', async () => {
    const fetchClient = fetchMock(async (input) => {
      await Promise.resolve();
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return url.endsWith('/api/health')
        ? Response.json({
            providers: [
              {
                available: true,
                defaultModel: 'deepseek-v4-flash',
                id: 'deepseek',
                models: [
                  {
                    capabilities: {
                      inputExtensions: [],
                      inputMimeTypes: [],
                      maxFileBytes: null,
                      nativeFiles: false,
                    },
                    id: 'deepseek-v4-flash',
                    name: 'DeepSeek V4 Flash',
                  },
                ],
                name: 'DeepSeek',
                providerType: 'deepseek',
                source: 'environment',
              },
            ],
          })
        : Response.json(workspace);
    });
    const client = new WaterLilyClient(fetchClient);
    expect(await client.health()).toEqual([
      {
        available: true,
        defaultModel: 'deepseek-v4-flash',
        id: 'deepseek',
        models: [
          {
            capabilities: {
              inputExtensions: [],
              inputMimeTypes: [],
              maxFileBytes: null,
              nativeFiles: false,
            },
            id: 'deepseek-v4-flash',
            name: 'DeepSeek V4 Flash',
          },
        ],
        name: 'DeepSeek',
        providerType: 'deepseek',
        source: 'environment',
      },
    ]);
    expect(await client.load(sampleGraph.id)).toEqual(workspace);
    expect(await client.load('graph with spaces')).toEqual(workspace);
    expect(fetchClient).toHaveBeenLastCalledWith(
      '/api/workspaces/graph%20with%20spaces',
      expect.any(Object),
    );
  });

  it('returns null for a missing workspace and saves with optimistic state', async () => {
    const fetchClient = fetchMock(async (input, init) => {
      await Promise.resolve();
      void input;
      return init?.method === 'PUT'
        ? Response.json(workspace, { status: 201 })
        : Response.json(
            { error: { code: 'NOT_FOUND', message: 'Missing' } },
            { status: 404 },
          );
    });
    const client = new WaterLilyClient(fetchClient);
    expect(await client.load('missing')).toBeNull();
    expect(await client.save(workspace, null)).toEqual(workspace);
    const saveInit = (fetchClient as ReturnType<typeof vi.fn>).mock
      .calls[1]?.[1] as RequestInit | undefined;
    expect(saveInit?.method).toBe('PUT');
    expect(JSON.parse(saveInit?.body as string)).toMatchObject({
      expectedUpdatedAt: null,
      graph: { id: sampleGraph.id },
    });
  });

  it('manages profiles, attachments, and local Python execution', async () => {
    const descriptor = {
      available: true,
      defaultModel: 'gpt-test',
      id: 'profile-test',
      models: [
        {
          capabilities: {
            inputExtensions: ['pdf'],
            inputMimeTypes: ['application/pdf'],
            maxFileBytes: 1024,
            nativeFiles: true,
          },
          id: 'gpt-test',
          name: 'GPT test',
        },
      ],
      name: 'Test profile',
      providerType: 'openai',
      source: 'stored',
    } as const;
    const attachment = {
      id: 'attachment-test',
      mediaType: 'application/pdf',
      name: 'paper.pdf',
      sha256: 'a'.repeat(64),
      size: 3,
    };
    const execution = {
      durationMilliseconds: 4,
      exitCode: 0,
      stderr: '',
      stdout: '42\n',
      timedOut: false,
      truncated: false,
    };
    const fetchClient = fetchMock((input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes('/provider-profiles/') && init?.method === 'DELETE')
        return Promise.resolve(new Response(null, { status: 204 }));
      if (url.endsWith('/provider-profiles'))
        return Promise.resolve(Response.json(descriptor));
      if (url.endsWith('/attachments'))
        return Promise.resolve(Response.json(attachment));
      return Promise.resolve(Response.json(execution));
    });
    const client = new WaterLilyClient(fetchClient);
    const profileInput = {
      apiKey: 'secret',
      baseUrl: null,
      label: 'Test profile',
      models: [],
      providerType: 'openai' as const,
    };
    await expect(client.createProviderProfile(profileInput)).resolves.toEqual(
      descriptor,
    );
    await expect(
      client.removeProviderProfile('profile/test'),
    ).resolves.toBeUndefined();
    const file = new File(['pdf'], 'paper.pdf', { type: 'application/pdf' });
    await expect(client.uploadAttachment(file)).resolves.toEqual(attachment);
    const signal = new AbortController().signal;
    await expect(
      client.executePython(
        {
          cells: [{ nodeId: 'node-code', source: 'print(42)' }],
          graphId: 'graph-study',
        },
        signal,
      ),
    ).resolves.toEqual(execution);
    expect(fetchClient).toHaveBeenCalledWith(
      '/api/provider-profiles/profile%2Ftest',
      { method: 'DELETE' },
    );
    expect(fetchClient).toHaveBeenCalledWith(
      '/api/attachments',
      expect.objectContaining({ body: file, method: 'POST' }),
    );
    expect(fetchClient).toHaveBeenCalledWith(
      '/api/executions/python',
      expect.objectContaining({ method: 'POST', signal }),
    );
  });

  it('downloads attachment bytes and deletes stored attachments', async () => {
    const bytes = new TextEncoder().encode('pdf');
    const fetchClient = fetchMock((_input, init) => {
      if (init?.method === 'DELETE')
        return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(
        new Response(bytes, {
          headers: {
            'content-length': String(bytes.byteLength),
            'content-type': 'application/pdf',
            'x-waterlily-filename': encodeURIComponent('paper one.pdf'),
            'x-waterlily-sha256': 'a'.repeat(64),
          },
        }),
      );
    });
    const client = new WaterLilyClient(fetchClient);
    const downloaded = await client.downloadAttachment('attachment/one');
    expect(Array.from(downloaded.bytes)).toEqual(Array.from(bytes));
    expect(downloaded.descriptor).toEqual({
      id: 'attachment/one',
      mediaType: 'application/pdf',
      name: 'paper one.pdf',
      sha256: 'a'.repeat(64),
      size: 3,
    });
    await expect(
      client.removeAttachment('attachment/one'),
    ).resolves.toBeUndefined();
    expect(fetchClient).toHaveBeenNthCalledWith(
      1,
      '/api/attachments/attachment%2Fone',
      { headers: { Accept: 'application/octet-stream' } },
    );
    expect(fetchClient).toHaveBeenNthCalledWith(
      2,
      '/api/attachments/attachment%2Fone',
      { method: 'DELETE' },
    );
  });

  it('rejects invalid attachment downloads and failed attachment deletion', async () => {
    const responses = [
      new Response('x', { headers: { 'content-type': 'text/plain' } }),
      Response.json(
        { error: { code: 'NOT_FOUND', message: 'Attachment missing' } },
        { status: 404 },
      ),
      Response.json(
        { error: { code: 'NOT_FOUND', message: 'Attachment missing' } },
        { status: 404 },
      ),
    ];
    const client = new WaterLilyClient(
      fetchMock(() => Promise.resolve(responses.shift() as Response)),
    );
    await expect(client.downloadAttachment('bad')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(client.downloadAttachment('missing')).rejects.toThrow(
      'Attachment missing',
    );
    await expect(client.removeAttachment('missing')).rejects.toThrow(
      'Attachment missing',
    );
  });

  it('rejects malformed profile, attachment, Python, and delete responses', async () => {
    const badValues = [
      Response.json({ available: true }),
      Response.json({ id: 'attachment', sha256: 'bad' }),
      Response.json({ durationMilliseconds: -1 }),
      Response.json(
        { error: { code: 'NOPE', message: 'Cannot delete' } },
        { status: 500 },
      ),
    ];
    const client = new WaterLilyClient(
      fetchMock(() => Promise.resolve(badValues.shift() as Response)),
    );
    await expect(
      client.createProviderProfile({
        apiKey: 'secret',
        baseUrl: null,
        label: 'Bad',
        models: [],
        providerType: 'openai',
      }),
    ).rejects.toBeInstanceOf(WaterLilyApiError);
    await expect(
      client.uploadAttachment(new File(['x'], 'x.txt')),
    ).rejects.toBeInstanceOf(WaterLilyApiError);
    await expect(
      client.executePython({
        cells: [{ nodeId: 'node-code', source: 'x' }],
        graphId: 'graph',
      }),
    ).rejects.toBeInstanceOf(WaterLilyApiError);
    await expect(client.removeProviderProfile('id')).rejects.toThrow(
      'Cannot delete',
    );
  });

  it('decodes one-byte NDJSON chunks and returns the committed workspace', async () => {
    const items: readonly GenerationStreamItem[] = [
      {
        event: {
          createdAt: null,
          model: 'resolved',
          responseId: 'response-1',
          type: 'response-start',
        },
        type: 'provider-event',
      },
      { event: { delta: 'ATP', type: 'text-delta' }, type: 'provider-event' },
      { type: 'generation-complete', workspace },
    ];
    let observedSignal: AbortSignal | null | undefined;
    const fetchClient = fetchMock(async (_input, init) => {
      await Promise.resolve();
      observedSignal = init?.signal;
      return chunkedResponse(
        `\n${items.map(serializeNdjson).join('').replaceAll('\n', '\r\n')}`,
      );
    });
    const observed: GenerationStreamItem[] = [];
    const result = await new WaterLilyClient(fetchClient).generate(
      generation,
      (item) => observed.push(item),
      new AbortController().signal,
    );
    expect(result).toEqual(workspace);
    expect(observed).toEqual(items);
    expect(fetchClient).toHaveBeenCalledWith(
      '/api/generations',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(observedSignal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces streamed, HTTP, absent-body, malformed, and incomplete errors', async () => {
    const streamedError: GenerationStreamItem = {
      error: { code: 'HTTP_ERROR', message: 'Provider unavailable' },
      type: 'generation-error',
    };
    const responses = [
      chunkedResponse(serializeNdjson(streamedError), 20),
      Response.json(
        { error: { code: 'CONFLICT', message: 'Changed' } },
        { status: 409 },
      ),
      new Response(null),
      chunkedResponse('not-json\n'),
      chunkedResponse(
        serializeNdjson({
          event: { delta: 'partial', type: 'text-delta' },
          type: 'provider-event',
        }),
      ),
    ];
    const client = new WaterLilyClient(
      fetchMock(async () => {
        await Promise.resolve();
        return responses.shift() as Response;
      }),
    );
    await expect(
      client.generate(generation, () => undefined),
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    });
    await expect(
      client.generate(generation, () => undefined),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    await expect(
      client.generate(generation, () => undefined),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(
      client.generate(generation, () => undefined),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(
      client.generate(generation, () => undefined),
    ).rejects.toMatchObject({
      code: 'INCOMPLETE_RESPONSE',
    });
  });

  it('rejects invalid health, JSON, error, and workspace responses', async () => {
    const responses = [
      Response.json({}),
      Response.json({ providers: {} }),
      Response.json({ providers: [{}] }),
      new Response('not-json', { status: 500 }),
      Response.json({ nope: true }, { status: 500 }),
      Response.json({ graph: {}, state: {} }),
    ];
    const client = new WaterLilyClient(
      fetchMock(async () => {
        await Promise.resolve();
        return responses.shift() as Response;
      }),
    );
    await expect(client.health()).rejects.toBeInstanceOf(WaterLilyApiError);
    await expect(client.health()).rejects.toBeInstanceOf(WaterLilyApiError);
    await expect(client.health()).rejects.toBeInstanceOf(WaterLilyApiError);
    await expect(client.load('x')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(client.load('x')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(
      client.save(workspace, sampleGraph.updatedAt),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

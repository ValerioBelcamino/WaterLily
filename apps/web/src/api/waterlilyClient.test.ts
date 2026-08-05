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
                name: 'DeepSeek',
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
        name: 'DeepSeek',
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

import {
  parseGenerationStreamLine,
  type GenerationStreamItem,
} from '@waterlily/api-contract';
import { DatabaseError } from '@waterlily/database';
import { ProviderError, type ChatProvider } from '@waterlily/providers';
import { describe, expect, it, vi } from 'vitest';

import { createWaterLilyHandler } from '../src/server.js';
import {
  completeEvents,
  fixtureProvider,
  generationRequest,
  MemoryStore,
  NOW,
  workspaceFixture,
} from './helpers.js';

const providerRegistration = {
  descriptor: {
    available: true,
    defaultModel: 'fixture-model',
    id: 'fixture',
    models: [
      {
        capabilities: {
          inputExtensions: [],
          inputMimeTypes: [],
          maxFileBytes: null,
          nativeFiles: false,
        },
        id: 'fixture-model',
        name: 'Fixture model',
      },
    ],
    name: 'Fixture',
    providerType: 'openai-compatible',
    source: 'environment',
  },
  provider: fixtureProvider(),
} as const;

function handler(
  store = new MemoryStore(),
  provider: ChatProvider = fixtureProvider(),
) {
  let id = 0;
  return {
    handle: createWaterLilyHandler({
      createId: (kind) => `${kind}-generated-${String((id += 1))}`,
      now: () => NOW,
      providers: [{ ...providerRegistration, provider }],
      workspaces: store,
    }),
    store,
  };
}

function jsonRequest(
  path: string,
  method: 'POST' | 'PUT',
  value: unknown,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(`http://127.0.0.1${path}`, {
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json', ...headers },
    method,
  });
}

async function streamItems(
  response: Response,
): Promise<readonly GenerationStreamItem[]> {
  return (await response.text())
    .trim()
    .split('\n')
    .map(parseGenerationStreamLine);
}

describe('WaterLily service handler', () => {
  it('reports health, provider availability, and security headers', async () => {
    const response = await handler().handle(
      new Request('http://127.0.0.1/api/health'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providers: [{ available: true, id: 'fixture' }],
      service: 'waterlily',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('inserts, reads, and replaces a workspace', async () => {
    const service = handler();
    const workspace = workspaceFixture();
    const inserted = await service.handle(
      jsonRequest('/api/workspaces/graph-server', 'PUT', {
        ...workspace,
        expectedUpdatedAt: null,
      }),
    );
    expect(inserted.status).toBe(201);

    const loaded = await service.handle(
      new Request('http://127.0.0.1/api/workspaces/graph-server'),
    );
    expect(await loaded.json()).toEqual(workspace);

    const replaced = await service.handle(
      jsonRequest('/api/workspaces/graph-server', 'PUT', {
        ...workspace,
        expectedUpdatedAt: workspace.graph.updatedAt,
      }),
    );
    expect(replaced.status).toBe(200);
  });

  it('maps workspace conflicts, missing records, and path mismatches', async () => {
    const service = handler();
    const workspace = workspaceFixture();
    service.store.insert(workspace);
    expect(
      (
        await service.handle(
          new Request('http://127.0.0.1/api/workspaces/missing'),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await service.handle(
          jsonRequest('/api/workspaces/other', 'PUT', {
            ...workspace,
            expectedUpdatedAt: workspace.graph.updatedAt,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await service.handle(
          jsonRequest('/api/workspaces/graph-server', 'PUT', {
            ...workspace,
            expectedUpdatedAt: '2026-08-05T00:00:00.000Z',
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await service.handle(
          jsonRequest('/api/workspaces/graph-server', 'PUT', {
            ...workspace,
            expectedUpdatedAt: null,
          }),
        )
      ).status,
    ).toBe(409);
  });

  it('rejects cross-origin, malformed, unsupported, and oversized writes', async () => {
    const service = handler();
    const workspace = workspaceFixture();
    const crossOrigin = await service.handle(
      jsonRequest(
        '/api/workspaces/graph-server',
        'PUT',
        { ...workspace, expectedUpdatedAt: null },
        { origin: 'https://evil.example' },
      ),
    );
    expect(crossOrigin.status).toBe(403);

    const badOrigin = await service.handle(
      jsonRequest(
        '/api/workspaces/graph-server',
        'PUT',
        { ...workspace, expectedUpdatedAt: null },
        { origin: 'not a url' },
      ),
    );
    expect(badOrigin.status).toBe(403);
    expect(
      (
        await service.handle(
          new Request('http://127.0.0.1/api/workspaces/graph-server', {
            body: '{}',
            method: 'PUT',
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await service.handle(
          new Request('http://127.0.0.1/api/workspaces/graph-server', {
            headers: { 'content-type': 'application/json' },
            method: 'PUT',
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await service.handle(
          new Request('http://127.0.0.1/api/workspaces/graph-server', {
            body: '{',
            headers: { 'content-type': 'application/json' },
            method: 'PUT',
          }),
        )
      ).status,
    ).toBe(400);
    const tiny = createWaterLilyHandler({
      maxBodyBytes: 4,
      providers: [providerRegistration],
      workspaces: new MemoryStore(),
    });
    expect(
      (await tiny(jsonRequest('/api/workspaces/x', 'PUT', { too: 'large' })))
        .status,
    ).toBe(413);
  });

  it('accepts matching origins and rejects malformed paths and UTF-8', async () => {
    const service = handler();
    const workspace = workspaceFixture();
    const accepted = await service.handle(
      jsonRequest(
        '/api/workspaces/graph-server',
        'PUT',
        { ...workspace, expectedUpdatedAt: null },
        { origin: 'http://127.0.0.1' },
      ),
    );
    expect(accepted.status).toBe(201);
    expect(
      (
        await service.handle(
          new Request('http://127.0.0.1/api/workspaces/%E0%A4%A'),
        )
      ).status,
    ).toBe(400);
    const invalidUtf8 = await service.handle(
      new Request('http://127.0.0.1/api/workspaces/graph-server', {
        body: new Uint8Array([0xff]),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }),
    );
    expect(invalidUtf8.status).toBe(400);
    expect(await invalidUtf8.json()).toMatchObject({
      error: { message: 'Request body is not valid UTF-8 JSON' },
    });
  });

  it('maps unexpected and typed repository read failures without details', async () => {
    const notFound = createWaterLilyHandler({
      providers: [providerRegistration],
      workspaces: {
        get() {
          throw new DatabaseError('NOT_FOUND', 'private database detail');
        },
        insert() {
          throw new Error('unused');
        },
        replace() {
          throw new Error('unused');
        },
      },
    });
    const typed = await notFound(
      new Request('http://127.0.0.1/api/workspaces/graph-server'),
    );
    expect(typed.status).toBe(404);
    expect(await typed.text()).not.toContain('private database detail');

    const broken = createWaterLilyHandler({
      providers: [],
      workspaces: {
        get() {
          throw new Error('secret failure');
        },
        insert() {
          throw new Error('unused');
        },
        replace() {
          throw new Error('unused');
        },
      },
    });
    const unexpected = await broken(
      new Request('http://127.0.0.1/api/workspaces/graph-server'),
    );
    expect(unexpected.status).toBe(500);
    expect(await unexpected.text()).not.toContain('secret failure');
  });

  it('streams provider events, commits the latest graph, and records provenance', async () => {
    const service = handler();
    service.store.insert(workspaceFixture());
    const response = await service.handle(
      jsonRequest('/api/generations', 'POST', generationRequest()),
    );
    expect(response.headers.get('content-type')).toContain(
      'application/x-ndjson',
    );
    const items = await streamItems(response);
    expect(items.slice(0, -1)).toEqual(
      completeEvents.map((event) => ({ event, type: 'provider-event' })),
    );
    const complete = items.at(-1);
    expect(complete?.type).toBe('generation-complete');
    if (complete?.type !== 'generation-complete') return;
    expect(Object.keys(complete.workspace.graph.nodes)).toHaveLength(3);
    const assistant = Object.values(complete.workspace.graph.nodes).find(
      (node) => node.role === 'assistant',
    );
    expect(assistant).toBeDefined();
    const revision =
      assistant === undefined
        ? undefined
        : complete.workspace.graph.revisions[assistant.currentRevisionId];
    expect(revision?.metadata).toMatchObject({
      generation: {
        publicReasoning: 'public reasoning',
        request: {
          request: {
            messages: [
              { content: 'Be precise.', role: 'system' },
              { content: 'Explain ATP.', role: 'user' },
            ],
          },
        },
      },
    });
    expect(JSON.stringify(revision?.metadata.generation)).toMatch(
      /"contextHash":"[0-9a-f]{64}"/u,
    );
  });

  it('retries only persistence conflicts when concurrent generations finish', async () => {
    const service = handler();
    service.store.insert(workspaceFixture());
    service.store.replaceConflicts = 2;
    const items = await streamItems(
      await service.handle(
        jsonRequest('/api/generations', 'POST', generationRequest()),
      ),
    );
    expect(items.at(-1)?.type).toBe('generation-complete');
    expect(service.store.replaceConflicts).toBe(0);
  });

  it('stops after three persistence conflicts and sanitizes the result', async () => {
    const service = handler();
    service.store.insert(workspaceFixture());
    service.store.replaceConflicts = 3;
    const items = await streamItems(
      await service.handle(
        jsonRequest('/api/generations', 'POST', generationRequest()),
      ),
    );
    expect(items.at(-1)).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'The graph changed while the response was being committed',
      },
      type: 'generation-error',
    });
  });

  it('uses server-generated identities and timestamps by default', async () => {
    const store = new MemoryStore();
    store.insert(workspaceFixture());
    const handle = createWaterLilyHandler({
      providers: [providerRegistration],
      workspaces: store,
    });
    const items = await streamItems(
      await handle(
        jsonRequest('/api/generations', 'POST', generationRequest()),
      ),
    );
    const complete = items.at(-1);
    expect(complete?.type).toBe('generation-complete');
    if (complete?.type !== 'generation-complete') return;
    const assistant = Object.values(complete.workspace.graph.nodes).find(
      (node) => node.role === 'assistant',
    );
    expect(assistant?.id).toMatch(/^node-[0-9a-f-]{36}$/u);
    expect(assistant?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it.each([
    {
      expectedCode: 'HTTP_400',
      providerId: 'unknown',
      registration: providerRegistration,
    },
    {
      expectedCode: 'HTTP_503',
      providerId: 'fixture',
      registration: {
        descriptor: { ...providerRegistration.descriptor, available: false },
      },
    },
  ])(
    'streams a sanitized configuration error for $providerId',
    async ({ expectedCode, providerId, registration }) => {
      const store = new MemoryStore();
      store.insert(workspaceFixture());
      const handle = createWaterLilyHandler({
        providers: [registration],
        workspaces: store,
      });
      const items = await streamItems(
        await handle(
          jsonRequest(
            '/api/generations',
            'POST',
            generationRequest(providerId),
          ),
        ),
      );
      expect(items).toHaveLength(1);
      expect(items[0]?.type).toBe('generation-error');
      if (items[0]?.type !== 'generation-error') return;
      expect(items[0].error.code).toBe(expectedCode);
      expect(items[0].error.message.length).toBeGreaterThan(0);
    },
  );

  it('redacts unexpected provider failures and missing graphs', async () => {
    const failing: ChatProvider = {
      id: 'fixture',
      name: 'Fixture',
      async *streamChat() {
        await Promise.resolve();
        yield* [];
        throw new Error('secret prompt and key');
      },
    };
    const service = handler(new MemoryStore(), failing);
    service.store.insert(workspaceFixture());
    const failed = await streamItems(
      await service.handle(
        jsonRequest('/api/generations', 'POST', generationRequest()),
      ),
    );
    expect(failed).toEqual([
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Generation failed unexpectedly',
        },
        type: 'generation-error',
      },
    ]);
    const missing = await streamItems(
      await handler().handle(
        jsonRequest('/api/generations', 'POST', generationRequest()),
      ),
    );
    expect(missing[0]).toMatchObject({
      error: { code: 'NOT_FOUND' },
      type: 'generation-error',
    });
  });

  it('surfaces typed provider failures without leaking response bodies', async () => {
    const failing: ChatProvider = {
      id: 'fixture',
      name: 'Fixture',
      async *streamChat() {
        await Promise.resolve();
        yield* [];
        throw new ProviderError('HTTP_ERROR', 'Provider rejected the request', {
          providerId: 'fixture',
          status: 429,
        });
      },
    };
    const service = handler(new MemoryStore(), failing);
    service.store.insert(workspaceFixture());
    const items = await streamItems(
      await service.handle(
        jsonRequest('/api/generations', 'POST', generationRequest()),
      ),
    );
    expect(items[0]).toMatchObject({
      error: { code: 'HTTP_ERROR', message: 'Provider rejected the request' },
    });
  });

  it('aborts provider work when the response stream is cancelled', async () => {
    const sawAbort = vi.fn();
    const provider: ChatProvider = {
      id: 'fixture',
      name: 'Fixture',
      async *streamChat(_request, options) {
        yield {
          createdAt: NOW,
          model: 'fixture-resolved',
          responseId: 'response-1',
          type: 'response-start',
        };
        if (options?.signal?.aborted === true) {
          sawAbort();
          return;
        }
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              sawAbort();
              resolve();
            },
            { once: true },
          );
        });
      },
    };
    const service = handler(new MemoryStore(), provider);
    service.store.insert(workspaceFixture());
    const response = await service.handle(
      jsonRequest('/api/generations', 'POST', generationRequest()),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel();
    await vi.waitFor(() => expect(sawAbort).toHaveBeenCalledOnce());
  });

  it('stores local provider profiles and supports dynamic health descriptors', async () => {
    const create = vi.fn(() => ({
      ...providerRegistration.descriptor,
      id: 'profile-created',
      source: 'stored' as const,
    }));
    const remove = vi.fn((id: string) => id === 'profile-created');
    const dynamic = vi.fn(() => [providerRegistration]);
    const handle = createWaterLilyHandler({
      providerProfiles: { create, remove },
      providers: dynamic,
      workspaces: new MemoryStore(),
    });
    const profile = {
      apiKey: 'local-secret',
      baseUrl: null,
      label: 'Study key',
      models: [],
      providerType: 'openai' as const,
    };
    const created = await handle(
      jsonRequest('/api/provider-profiles', 'POST', profile),
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: 'profile-created' });
    expect(create).toHaveBeenCalledWith(profile);
    expect(
      (
        await handle(
          new Request(
            'http://127.0.0.1/api/provider-profiles/profile-created',
            { method: 'DELETE' },
          ),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await handle(
          new Request('http://127.0.0.1/api/provider-profiles/missing', {
            method: 'DELETE',
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handle(
          new Request('http://127.0.0.1/api/provider-profiles/%E0%A4%A', {
            method: 'DELETE',
          }),
        )
      ).status,
    ).toBe(400);
    await handle(new Request('http://127.0.0.1/api/health'));
    expect(dynamic).toHaveBeenCalled();

    const unavailable = createWaterLilyHandler({
      providers: [],
      workspaces: new MemoryStore(),
    });
    expect(
      (
        await unavailable(
          jsonRequest('/api/provider-profiles', 'POST', profile),
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await unavailable(
          new Request('http://127.0.0.1/api/provider-profiles/id', {
            method: 'DELETE',
          }),
        )
      ).status,
    ).toBe(503);
  });

  it('uploads opaque attachments and validates their metadata boundary', async () => {
    const put = vi.fn(() => ({
      id: 'attachment-created',
      mediaType: 'application/pdf',
      name: 'paper.pdf',
      sha256: 'a'.repeat(64),
      size: 3,
    }));
    const handle = createWaterLilyHandler({
      attachments: {
        get() {
          throw new Error('unused');
        },
        put,
      },
      providers: [],
      workspaces: new MemoryStore(),
    });
    const upload = (headers: Record<string, string>, body: Uint8Array | null) =>
      handle(
        new Request('http://127.0.0.1/api/attachments', {
          body,
          headers,
          method: 'POST',
        }),
      );
    const response = await upload(
      {
        'content-type': 'application/pdf; charset=binary',
        'x-waterlily-filename': encodeURIComponent('paper.pdf'),
      },
      new Uint8Array([1, 2, 3]),
    );
    expect(response.status).toBe(201);
    expect(put).toHaveBeenCalledWith({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'application/pdf',
      name: 'paper.pdf',
    });
    for (const invalid of [
      upload({ 'content-type': 'text/plain' }, new Uint8Array([1])),
      upload(
        {
          'content-type': 'text/plain',
          'x-waterlily-filename': '%E0%A4%A',
        },
        new Uint8Array([1]),
      ),
      upload(
        {
          'content-type': 'text/plain',
          'x-waterlily-filename': encodeURIComponent(' '),
        },
        new Uint8Array([1]),
      ),
      upload(
        { 'x-waterlily-filename': encodeURIComponent('notes.txt') },
        new Uint8Array([1]),
      ),
      upload(
        {
          'content-type': 'text/plain',
          'x-waterlily-filename': encodeURIComponent('notes.txt'),
        },
        new Uint8Array(),
      ),
    ])
      expect((await invalid).status).toBeGreaterThanOrEqual(400);

    const unavailable = createWaterLilyHandler({
      providers: [],
      workspaces: new MemoryStore(),
    });
    expect(
      (
        await unavailable(
          new Request('http://127.0.0.1/api/attachments', {
            body: new Uint8Array([1]),
            headers: {
              'content-type': 'text/plain',
              'x-waterlily-filename': encodeURIComponent('notes.txt'),
            },
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(503);
  });

  it('runs validated Python requests through the configured local runner', async () => {
    const run = vi.fn(() =>
      Promise.resolve({
        durationMilliseconds: 4,
        exitCode: 0,
        stderr: '',
        stdout: '42\n',
        timedOut: false,
        truncated: false,
      }),
    );
    const handle = createWaterLilyHandler({
      codeRunner: { run },
      providers: [],
      workspaces: new MemoryStore(),
    });
    const input = {
      cells: [{ nodeId: 'node-code', source: 'print(42)' }],
      graphId: 'graph-server',
    };
    const response = await handle(
      jsonRequest('/api/executions/python', 'POST', input),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stdout: '42\n' });
    expect(run).toHaveBeenCalledWith(input, expect.any(AbortSignal));

    expect(
      (
        await handle(
          jsonRequest('/api/executions/python', 'POST', {
            cells: [],
            graphId: 'graph-server',
          }),
        )
      ).status,
    ).toBe(400);
    const unavailable = createWaterLilyHandler({
      providers: [],
      workspaces: new MemoryStore(),
    });
    expect(
      (await unavailable(jsonRequest('/api/executions/python', 'POST', input)))
        .status,
    ).toBe(503);
  });

  it('returns sanitized JSON for unknown routes and invalid API bodies', async () => {
    const service = handler();
    expect(
      (await service.handle(new Request('http://127.0.0.1/nope'))).status,
    ).toBe(404);
    const invalid = await service.handle(
      jsonRequest('/api/generations', 'POST', { graphId: 3 }),
    );
    expect(invalid.status).toBe(200);
    expect(await streamItems(invalid)).toEqual([
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'generation graphId must be a string',
        },
        type: 'generation-error',
      },
    ]);
  });
});

import type {
  GenerationApiRequest,
  GenerationStreamItem,
  ProviderDescriptor,
  WorkspaceSnapshot,
} from '@waterlily/api-contract';
import { createNode } from '@waterlily/domain';
import {
  createWaterLilyArchive,
  parseWaterLilyArchive,
  sha256Bytes,
} from '@waterlily/interchange';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sampleGraph } from '../sampleGraph';
import { useWaterLilyStore } from '../state/waterlilyStore';
import {
  useWaterLilyService,
  type UseWaterLilyServiceOptions,
} from './useWaterLilyService';

type ServiceClient = NonNullable<UseWaterLilyServiceOptions['client']>;

const providers: readonly ProviderDescriptor[] = [
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
];

function workspace(
  positions: WorkspaceSnapshot['state']['view']['positions'] = {},
): WorkspaceSnapshot {
  return {
    graph: structuredClone(sampleGraph),
    state: {
      contextSelections: {
        'node-note': { mode: 'excluded' },
      },
      version: 1,
      view: { groups: [], positions },
    },
  };
}

function createClient(overrides: Partial<ServiceClient> = {}): ServiceClient {
  return {
    createProviderProfile: vi.fn<
      NonNullable<ServiceClient['createProviderProfile']>
    >(() => Promise.resolve(providers[0] as ProviderDescriptor)),
    downloadAttachment: vi.fn<NonNullable<ServiceClient['downloadAttachment']>>(
      () => Promise.reject(new Error('Unexpected attachment download')),
    ),
    executePython: vi.fn<NonNullable<ServiceClient['executePython']>>(() =>
      Promise.resolve({
        durationMilliseconds: 4,
        exitCode: 0,
        stderr: '',
        stdout: '42\n',
        timedOut: false,
        truncated: false,
      }),
    ),
    generate: vi.fn<ServiceClient['generate']>(() =>
      Promise.resolve(workspace()),
    ),
    health: vi.fn<ServiceClient['health']>(() => Promise.resolve(providers)),
    load: vi.fn<ServiceClient['load']>(() => Promise.resolve(workspace())),
    removeProviderProfile: vi.fn<
      NonNullable<ServiceClient['removeProviderProfile']>
    >(() => Promise.resolve()),
    removeAttachment: vi.fn<NonNullable<ServiceClient['removeAttachment']>>(
      () => Promise.resolve(),
    ),
    save: vi.fn<ServiceClient['save']>((snapshot) => Promise.resolve(snapshot)),
    uploadAttachment: vi.fn<NonNullable<ServiceClient['uploadAttachment']>>(
      (file) =>
        Promise.resolve({
          id: 'attachment-uploaded',
          mediaType: file.type,
          name: file.name,
          sha256: 'a'.repeat(64),
          size: file.size,
        }),
    ),
    ...overrides,
  };
}

async function attachmentArchive(): Promise<
  Awaited<ReturnType<typeof createWaterLilyArchive>>
> {
  const bytes = new TextEncoder().encode('portable paper');
  const sha256 = await sha256Bytes(bytes);
  const graph = createNode(structuredClone(sampleGraph), {
    blocks: [
      {
        attachmentId: 'attachment-archive',
        id: 'block-archive-file',
        mediaType: 'text/plain',
        name: 'paper.txt',
        type: 'attachment',
      },
    ],
    createdAt: '2026-08-17T12:00:00.000Z',
    kind: 'attachment',
    nodeId: 'node-archive-file',
    revisionId: 'revision-archive-file',
    title: 'Archive paper',
  });
  return createWaterLilyArchive({
    attachments: [
      {
        bytes,
        descriptor: {
          id: 'attachment-archive',
          mediaType: 'text/plain',
          name: 'paper.txt',
          sha256,
          size: bytes.byteLength,
        },
      },
    ],
    exportedAt: '2026-08-17T12:01:00.000Z',
    exporter: { name: 'Test', version: '1' },
    workspace: {
      graph,
      state: {
        contextSelections: {
          'node-archive-file': { mode: 'excluded' },
        },
        version: 1,
        view: {
          groups: [],
          positions: { 'node-archive-file': { x: 22, y: 33 } },
        },
      },
    },
  });
}

describe('useWaterLilyService', () => {
  beforeEach(() => {
    useWaterLilyStore.getState().reset();
  });

  it('hydrates a saved workspace and selects the first available provider', async () => {
    const saved = workspace({ 'node-answer': { x: 31, y: 47 } });
    const client = createClient({
      load: vi.fn<ServiceClient['load']>(() => Promise.resolve(saved)),
    });
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('online'));
    expect(result.current.selectedProviderId).toBe('deepseek');
    expect(useWaterLilyStore.getState()).toMatchObject({
      contextSelections: { 'node-note': { mode: 'excluded' } },
      positions: { 'node-answer': { x: 31, y: 47 } },
    });
    expect(client.save).not.toHaveBeenCalled();
  });

  it('creates a missing workspace once without an immediate duplicate autosave', async () => {
    const client = createClient({
      load: vi.fn<ServiceClient['load']>(() => Promise.resolve(null)),
    });
    const { result } = renderHook(() =>
      useWaterLilyService({ client, enabled: true, saveDelayMilliseconds: 5 }),
    );

    await waitFor(() => expect(result.current.status).toBe('online'));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 15));
    expect(client.save).toHaveBeenCalledTimes(1);
    const firstSave = vi.mocked(client.save).mock.calls[0];
    expect(firstSave?.[0].graph.id).toBe(sampleGraph.id);
    expect(firstSave?.[1]).toBeNull();
  });

  it('autosaves graph view changes after initialization', async () => {
    const client = createClient();
    const { result } = renderHook(() =>
      useWaterLilyService({ client, enabled: true, saveDelayMilliseconds: 1 }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));
    vi.mocked(client.save).mockClear();

    act(() => {
      useWaterLilyStore
        .getState()
        .setPosition('node-answer', { x: 101, y: 202 });
    });

    await waitFor(() => expect(client.save).toHaveBeenCalledTimes(1));
    const autosave = vi.mocked(client.save).mock.calls[0];
    expect(autosave?.[0].state.view.positions['node-answer']).toEqual({
      x: 101,
      y: 202,
    });
    expect(autosave?.[1]).toBe(sampleGraph.updatedAt);
  });

  it('keeps working state local when a background save fails', async () => {
    const save = vi
      .fn<ServiceClient['save']>()
      .mockRejectedValue('storage unavailable');
    const client = createClient({ save });
    const { result } = renderHook(() =>
      useWaterLilyService({ client, enabled: true, saveDelayMilliseconds: 1 }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));

    act(() => {
      useWaterLilyStore.getState().setPosition('node-answer', { x: 12, y: 13 });
    });

    await waitFor(() =>
      expect(result.current.serviceError).toBe(
        'The local service request failed.',
      ),
    );
    expect(useWaterLilyStore.getState().positions['node-answer']).toEqual({
      x: 12,
      y: 13,
    });
  });

  it('streams public reasoning and text, then installs the committed workspace', async () => {
    const committed = workspace({ 'node-synthesis': { x: 900, y: 400 } });
    const generate: ServiceClient['generate'] = vi.fn<
      ServiceClient['generate']
    >((input, onItem) => {
      const items: readonly GenerationStreamItem[] = [
        {
          event: {
            createdAt: null,
            model: 'deepseek-v4-flash-resolved',
            responseId: 'response-1',
            type: 'response-start',
          },
          type: 'provider-event',
        },
        {
          event: { delta: 'Consider the gradient. ', type: 'reasoning-delta' },
          type: 'provider-event',
        },
        {
          event: { delta: 'ATP is formed.', type: 'text-delta' },
          type: 'provider-event',
        },
        { type: 'generation-complete', workspace: committed },
      ];
      items.forEach((item) => onItem(item));
      expect(input).toMatchObject({
        context: {
          heads: [{ nodeId: 'node-synthesis', slot: 0 }],
          overrides: [{ nodeId: 'node-note', selection: { mode: 'excluded' } }],
        },
        graphId: sampleGraph.id,
        providerId: 'deepseek',
        request: { model: 'deepseek-v4-flash' },
      });
      return Promise.resolve(committed);
    });
    const client = createClient({ generate });
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));

    await act(async () => {
      await result.current.generate(['node-synthesis']);
    });

    expect(result.current.generation).toEqual({
      error: null,
      model: 'deepseek-v4-flash-resolved',
      reasoning: 'Consider the gradient. ',
      status: 'idle',
      text: 'ATP is formed.',
    });
    expect(useWaterLilyStore.getState().positions['node-synthesis']).toEqual({
      x: 900,
      y: 400,
    });
    expect(client.save).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable providers, request failures, and cancellation', async () => {
    const unavailableClient = createClient({
      health: vi.fn<ServiceClient['health']>(() =>
        Promise.resolve(
          providers.map((provider) => ({ ...provider, available: false })),
        ),
      ),
    });
    const unavailable = renderHook(() =>
      useWaterLilyService({
        client: unavailableClient,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() =>
      expect(unavailable.result.current.status).toBe('online'),
    );
    await act(async () => {
      await unavailable.result.current.generate(['node-synthesis']);
    });
    expect(unavailable.result.current.generation.error).toMatch(
      /configure a provider/iu,
    );
    unavailable.unmount();

    const rejectedClient = createClient({
      generate: vi.fn<ServiceClient['generate']>(() =>
        Promise.reject(new Error('Provider request failed')),
      ),
    });
    const rejected = renderHook(() =>
      useWaterLilyService({
        client: rejectedClient,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(rejected.result.current.status).toBe('online'));
    await act(async () => {
      await rejected.result.current.generate(['node-synthesis']);
    });
    expect(rejected.result.current.generation.error).toBe(
      'Provider request failed',
    );
    rejected.unmount();

    const generate: ServiceClient['generate'] = vi.fn<
      ServiceClient['generate']
    >(
      (
        _input: GenerationApiRequest,
        _onItem: (item: GenerationStreamItem) => void,
        signal?: AbortSignal,
      ) =>
        new Promise<WorkspaceSnapshot>((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Canceled', 'AbortError')),
          );
        }),
    );
    const client = createClient({ generate });
    const active = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(active.result.current.status).toBe('online'));
    act(() => {
      void active.result.current.generate(['node-synthesis']);
    });
    await waitFor(() =>
      expect(active.result.current.generation.status).toBe('streaming'),
    );
    expect(active.result.current.activeFlow).toEqual({
      edgeIds: [
        'edge-answer-side-question',
        'edge-answer-synthesis',
        'edge-question-answer',
        'edge-side-answer-synthesis',
        'edge-side-question-answer',
        'edge-system-question',
      ],
      nodeIds: [
        'node-answer',
        'node-question',
        'node-side-answer',
        'node-side-question',
        'node-synthesis',
        'node-system',
      ],
      mode: 'running',
    });
    act(() => active.result.current.cancel());
    await waitFor(() =>
      expect(active.result.current.generation).toMatchObject({
        error: 'Generation canceled.',
        status: 'idle',
      }),
    );
    expect(active.result.current.activeFlow).toBeNull();
  });

  it('degrades to offline and can be explicitly disabled', async () => {
    const failure = createClient({
      health: vi.fn<ServiceClient['health']>(() =>
        Promise.reject(new Error('Service unavailable')),
      ),
    });
    const offline = renderHook(() =>
      useWaterLilyService({ client: failure, enabled: true }),
    );
    await waitFor(() => expect(offline.result.current.status).toBe('offline'));
    expect(offline.result.current.serviceError).toBe('Service unavailable');
    offline.unmount();

    const disabledClient = createClient();
    const disabled = renderHook(() =>
      useWaterLilyService({ client: disabledClient, enabled: false }),
    );
    expect(disabled.result.current.status).toBe('disabled');
    expect(disabledClient.health).not.toHaveBeenCalled();
  });

  it('creates, selects, removes, and uploads through local provider profiles', async () => {
    const stored: ProviderDescriptor = {
      ...(providers[0] as ProviderDescriptor),
      id: 'profile-stored',
      name: 'Stored profile',
      source: 'stored',
    };
    const health = vi
      .fn<ServiceClient['health']>()
      .mockResolvedValueOnce(providers)
      .mockResolvedValueOnce([...providers, stored])
      .mockResolvedValueOnce(providers);
    const client = createClient({
      createProviderProfile: vi.fn(() => Promise.resolve(stored)),
      health,
    });
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));

    await act(async () => {
      await result.current.createProviderProfile({
        apiKey: 'secret',
        baseUrl: null,
        label: 'Stored profile',
        models: [],
        providerType: 'deepseek',
      });
    });
    expect(result.current.selectedProviderId).toBe('profile-stored');
    expect(result.current.selectedModelId).toBe('deepseek-v4-flash');
    const file = new File(['note'], 'note.txt', { type: 'text/plain' });
    await expect(result.current.uploadAttachment(file)).resolves.toMatchObject({
      name: 'note.txt',
    });
    await act(async () => {
      await result.current.removeProviderProfile('profile-stored');
    });
    expect(result.current.selectedProviderId).toBe('deepseek');

    act(() => result.current.setSelectedModelId('another-model'));
    expect(result.current.selectedModelId).toBe('another-model');
    act(() => result.current.setSelectedProviderId('deepseek'));
    expect(result.current.selectedModelId).toBe('deepseek-v4-flash');
    act(() => result.current.setSelectedProviderId('missing'));
    expect(result.current.selectedModelId).toBeNull();
  });

  it('exports a portable archive with the complete workspace state', async () => {
    const client = createClient();
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));

    let exported:
      Awaited<ReturnType<typeof result.current.exportArchive>> | undefined;
    await act(async () => {
      exported = await result.current.exportArchive();
    });
    if (exported === undefined) throw new Error('Archive export did not run');
    const parsed = await parseWaterLilyArchive(exported.bytes);
    expect(parsed.workspace.state.contextSelections).toEqual({
      'node-note': { mode: 'excluded' },
    });
    expect(parsed.workspace.graph).toEqual(sampleGraph);
    expect(parsed.attachments).toEqual([]);
    expect(client.downloadAttachment).not.toHaveBeenCalled();
    expect(result.current.archiveStatus).toBe('idle');
  });

  it('downloads every referenced attachment into the exported archive', async () => {
    const bytes = new TextEncoder().encode('export me');
    const sha256 = await sha256Bytes(bytes);
    const downloadAttachment = vi.fn<
      NonNullable<ServiceClient['downloadAttachment']>
    >(() =>
      Promise.resolve({
        bytes,
        descriptor: {
          id: 'attachment-export',
          mediaType: 'text/plain',
          name: 'export.txt',
          sha256,
          size: bytes.byteLength,
        },
      }),
    );
    const client = createClient({ downloadAttachment });
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));
    act(() => {
      useWaterLilyStore.getState().addFileContexts({
        createdAt: '2026-08-17T12:00:00.000Z',
        files: [
          {
            attachment: {
              id: 'attachment-export',
              mediaType: 'text/plain',
              name: 'export.txt',
              sha256,
              size: bytes.byteLength,
            },
            blockId: 'block-export',
            edgeId: null,
            file: {
              file: new File([bytes], 'export.txt', { type: 'text/plain' }),
              lastModified: 1,
              mediaType: 'text/plain',
              name: 'export.txt',
              size: bytes.byteLength,
            },
            nodeId: 'node-export',
            position: { x: 1, y: 2 },
            revisionId: 'revision-export',
          },
        ],
        targetNodeId: null,
      });
    });

    const exported = await result.current.exportArchive();
    const parsed = await parseWaterLilyArchive(exported.bytes);
    expect(downloadAttachment).toHaveBeenCalledWith('attachment-export');
    expect(parsed.attachments[0]?.descriptor.name).toBe('export.txt');
  });

  it('imports an attachment-free archive without attachment service calls', async () => {
    const archive = await createWaterLilyArchive({
      attachments: [],
      exportedAt: '2026-08-17T12:01:00.000Z',
      exporter: { name: 'Test', version: '1' },
      workspace: workspace(),
    });
    const client = createClient();
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));
    vi.mocked(client.save).mockClear();

    await expect(result.current.importArchive(archive.bytes)).resolves.toEqual({
      attachmentCount: 0,
      nodeCount: 7,
    });
    expect(client.uploadAttachment).not.toHaveBeenCalled();
    expect(client.removeAttachment).not.toHaveBeenCalled();
    expect(client.save).toHaveBeenCalledOnce();
  });

  it('restores archive attachments, remaps state, and commits one merged workspace', async () => {
    const archive = await attachmentArchive();
    const uploadAttachment = vi.fn<
      NonNullable<ServiceClient['uploadAttachment']>
    >(async (file) => ({
      id: 'attachment-restored',
      mediaType: file.type,
      name: file.name,
      sha256: await sha256Bytes(new Uint8Array(await file.arrayBuffer())),
      size: file.size,
    }));
    const client = createClient({ uploadAttachment });
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));
    vi.mocked(client.save).mockClear();

    let summary:
      Awaited<ReturnType<typeof result.current.importArchive>> | undefined;
    await act(async () => {
      summary = await result.current.importArchive(archive.bytes);
    });

    expect(summary).toEqual({ attachmentCount: 1, nodeCount: 8 });
    expect(uploadAttachment).toHaveBeenCalledOnce();
    expect(client.save).toHaveBeenCalledOnce();
    const state = useWaterLilyStore.getState();
    expect(Object.keys(state.graph.nodes)).toHaveLength(15);
    const importedNode = Object.values(state.graph.nodes).find(
      (node) => node.title === 'Archive paper',
    );
    expect(importedNode).toBeDefined();
    const importedRevision =
      state.graph.revisions[importedNode?.currentRevisionId ?? ''];
    expect(importedRevision?.blocks[0]).toMatchObject({
      attachmentId: 'attachment-restored',
      name: 'paper.txt',
    });
    expect(state.contextSelections[importedNode?.id ?? '']).toEqual({
      mode: 'excluded',
    });
    expect(state.positions[importedNode?.id ?? '']).toEqual({ x: 22, y: 33 });
    expect(client.removeAttachment).not.toHaveBeenCalled();
  });

  it('rolls back uploaded attachment bytes when archive persistence fails', async () => {
    const archive = await attachmentArchive();
    const save = vi.fn<ServiceClient['save']>(() =>
      Promise.reject(new Error('Database unavailable')),
    );
    const client = createClient({ save });
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));

    await expect(
      act(async () => result.current.importArchive(archive.bytes)),
    ).rejects.toThrow('Database unavailable');
    expect(client.removeAttachment).toHaveBeenCalledWith('attachment-uploaded');
    expect(Object.keys(useWaterLilyStore.getState().graph.nodes)).toHaveLength(
      7,
    );
    expect(result.current.archiveStatus).toBe('idle');
  });

  it('clears provider selection when the selected stored profile has no fallback', async () => {
    const stored: ProviderDescriptor = {
      ...(providers[0] as ProviderDescriptor),
      id: 'profile-only',
      source: 'stored',
    };
    const client = createClient({
      health: vi
        .fn<NonNullable<ServiceClient['health']>>()
        .mockResolvedValueOnce([stored])
        .mockResolvedValueOnce([]),
    });
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() =>
      expect(result.current.selectedProviderId).toBe('profile-only'),
    );
    await act(async () => {
      await result.current.removeProviderProfile('profile-only');
    });
    expect(result.current.selectedProviderId).toBeNull();
    expect(result.current.selectedModelId).toBeNull();
  });

  it('replays included Python cells and records bounded output as a graph node', async () => {
    useWaterLilyStore.getState().addCodeCell({
      blockId: 'block-code-1',
      createdAt: '2026-08-17T10:00:00.000Z',
      edgeId: 'edge-code-1',
      nodeId: 'node-code-1',
      parentNodeId: 'node-answer',
      revisionId: 'revision-code-1',
      source: 'value = 40',
      title: 'Setup',
    });
    useWaterLilyStore.getState().addCodeCell({
      blockId: 'block-code-2',
      createdAt: '2026-08-17T10:00:01.000Z',
      edgeId: 'edge-code-2',
      nodeId: 'node-code-2',
      parentNodeId: 'node-code-1',
      revisionId: 'revision-code-2',
      source: 'print(value + 2)',
      title: 'Calculate',
    });
    const executePython = vi.fn<NonNullable<ServiceClient['executePython']>>(
      () =>
        Promise.resolve({
          durationMilliseconds: 8,
          exitCode: 1,
          stderr: 'warning\n',
          stdout: '42\n',
          timedOut: false,
          truncated: true,
        }),
    );
    const client = createClient({
      executePython,
      load: vi.fn(() => Promise.resolve(null)),
    });
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));

    await act(async () => {
      await result.current.executePython('node-code-2');
    });
    expect(executePython).toHaveBeenCalledWith(
      {
        cells: [
          { nodeId: 'node-code-1', source: 'value = 40' },
          { nodeId: 'node-code-2', source: 'print(value + 2)' },
        ],
        graphId: sampleGraph.id,
      },
      expect.any(AbortSignal),
    );
    expect(result.current.execution).toMatchObject({
      error: null,
      result: { exitCode: 1, truncated: true },
      status: 'idle',
    });
    const state = useWaterLilyStore.getState();
    const output = state.graph.nodes[state.selectedNodeId ?? ''];
    expect(output).toMatchObject({ kind: 'execution', title: 'Python error' });
    expect(
      state.graph.revisions[output?.currentRevisionId ?? '']?.blocks[0],
    ).toMatchObject({
      text: '42\n\n[stderr]\nwarning\n\n[output truncated at the local size limit]',
    });
  });

  it('reports invalid, unavailable, failed, and canceled Python runs', async () => {
    const { executePython: _executePython, ...unavailableClient } =
      createClient();
    void _executePython;
    const unavailable = renderHook(() =>
      useWaterLilyService({ client: unavailableClient, enabled: true }),
    );
    await waitFor(() =>
      expect(unavailable.result.current.status).toBe('online'),
    );
    await act(async () => {
      await unavailable.result.current.executePython('node-answer');
    });
    expect(unavailable.result.current.execution.error).toMatch(/unavailable/iu);
    unavailable.unmount();

    let rejectExecution: ((cause: unknown) => void) | undefined;
    const executePython = vi.fn<NonNullable<ServiceClient['executePython']>>(
      () =>
        new Promise((_resolve, reject) => {
          rejectExecution = reject;
        }),
    );
    useWaterLilyStore.getState().addCodeCell({
      blockId: 'block-code-cancel',
      createdAt: '2026-08-17T10:00:00.000Z',
      edgeId: 'edge-code-cancel',
      nodeId: 'node-code-cancel',
      parentNodeId: 'node-answer',
      revisionId: 'revision-code-cancel',
      source: 'import time\ntime.sleep(20)',
      title: null,
    });
    const active = renderHook(() =>
      useWaterLilyService({
        client: createClient({
          executePython,
          load: vi.fn(() => Promise.resolve(null)),
        }),
        enabled: true,
      }),
    );
    await waitFor(() => expect(active.result.current.status).toBe('online'));
    act(() => {
      void active.result.current.executePython('node-code-cancel');
    });
    await waitFor(() =>
      expect(active.result.current.execution.status).toBe('running'),
    );
    await waitFor(() => expect(executePython).toHaveBeenCalledOnce());
    const executionSignal = executePython.mock.calls[0]?.[1];
    act(() => active.result.current.cancel());
    expect(executionSignal?.aborted).toBe(true);
    await act(async () => {
      rejectExecution?.(new DOMException('Canceled', 'AbortError'));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(active.result.current.execution.error).toBe(
        'Python execution canceled.',
      ),
    );
  });

  it('blocks native attachments on incompatible models before provider I/O', async () => {
    useWaterLilyStore.getState().addFileContexts({
      createdAt: '2026-08-17T10:00:00.000Z',
      files: [
        {
          attachment: {
            id: 'attachment-pdf',
            mediaType: 'application/pdf',
            name: 'paper.pdf',
            sha256: 'a'.repeat(64),
            size: 3,
          },
          blockId: 'block-pdf',
          edgeId: 'edge-pdf',
          file: {
            file: new File(['pdf'], 'paper.pdf', { type: 'application/pdf' }),
            lastModified: 1,
            mediaType: 'application/pdf',
            name: 'paper.pdf',
            size: 3,
          },
          nodeId: 'node-pdf',
          position: { x: 0, y: 0 },
          revisionId: 'revision-pdf',
        },
      ],
      targetNodeId: 'node-synthesis',
    });
    const client = createClient({ load: vi.fn(() => Promise.resolve(null)) });
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));
    await act(async () => {
      await result.current.generate(['node-synthesis']);
    });
    expect(result.current.generation.error).toMatch(
      /cannot receive paper.pdf/iu,
    );
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('guards missing optional local service features and invalid selections', async () => {
    const full = createClient();
    const {
      createProviderProfile: _create,
      downloadAttachment: _download,
      executePython: _execute,
      removeAttachment: _removeAttachment,
      removeProviderProfile: _remove,
      uploadAttachment: _upload,
      ...client
    } = full;
    void _create;
    void _download;
    void _execute;
    void _removeAttachment;
    void _remove;
    void _upload;
    const { result } = renderHook(() =>
      useWaterLilyService({
        client,
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));
    await expect(
      result.current.createProviderProfile({
        apiKey: 'secret',
        baseUrl: null,
        label: 'Missing',
        models: [],
        providerType: 'openai',
      }),
    ).rejects.toThrow('storage is unavailable');
    await expect(result.current.removeProviderProfile('id')).rejects.toThrow(
      'storage is unavailable',
    );
    await expect(
      result.current.uploadAttachment(new File(['x'], 'x.txt')),
    ).rejects.toThrow('storage is unavailable');
    await expect(result.current.exportArchive()).rejects.toThrow(
      'export is unavailable',
    );

    await act(async () => {
      await result.current.executePython('node-answer');
    });
    expect(result.current.execution.error).toMatch(/unavailable/iu);
    act(() => result.current.setSelectedModelId('missing-model'));
    await act(async () => {
      await result.current.generate([]);
      await result.current.generate(['node-answer']);
    });
    expect(result.current.generation.error).toMatch(
      /choose an available model/iu,
    );
  });

  it('records empty and timed-out Python output and honors excluded cells', async () => {
    useWaterLilyStore.getState().addCodeCell({
      blockId: 'block-code-output-cases',
      createdAt: '2026-08-17T10:00:00.000Z',
      edgeId: 'edge-code-output-cases',
      nodeId: 'node-code-output-cases',
      parentNodeId: 'node-answer',
      revisionId: 'revision-code-output-cases',
      source: 'value = 1',
      title: null,
    });
    const executePython = vi
      .fn<NonNullable<ServiceClient['executePython']>>()
      .mockResolvedValueOnce({
        durationMilliseconds: 1,
        exitCode: 0,
        stderr: '',
        stdout: '',
        timedOut: false,
        truncated: false,
      })
      .mockResolvedValueOnce({
        durationMilliseconds: 10_000,
        exitCode: null,
        stderr: '',
        stdout: '',
        timedOut: true,
        truncated: false,
      });
    const { result } = renderHook(() =>
      useWaterLilyService({
        client: createClient({
          executePython,
          load: vi.fn(() => Promise.resolve(null)),
        }),
        enabled: true,
        saveDelayMilliseconds: 100_000,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('online'));
    await act(async () => {
      await result.current.executePython('node-answer');
    });
    expect(result.current.execution.error).toMatch(/select a Python/iu);

    await act(async () => {
      await result.current.executePython('node-code-output-cases');
    });
    let state = useWaterLilyStore.getState();
    let output = state.graph.nodes[state.selectedNodeId ?? ''];
    expect(
      state.graph.revisions[output?.currentRevisionId ?? '']?.blocks[0],
    ).toMatchObject({ text: '[no output]' });

    await act(async () => {
      await result.current.executePython('node-code-output-cases');
    });
    state = useWaterLilyStore.getState();
    output = state.graph.nodes[state.selectedNodeId ?? ''];
    expect(
      state.graph.revisions[output?.currentRevisionId ?? '']?.blocks[0],
    ).toMatchObject({
      text: '[execution stopped after the local time limit]',
    });

    act(() => {
      useWaterLilyStore
        .getState()
        .setContextSelection('node-code-output-cases', { mode: 'excluded' });
    });
    await act(async () => {
      await result.current.executePython('node-code-output-cases');
    });
    expect(result.current.execution.error).toMatch(
      /no included Python cells/iu,
    );
  });
});

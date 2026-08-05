import type {
  GenerationApiRequest,
  GenerationStreamItem,
  ProviderDescriptor,
  WorkspaceSnapshot,
} from '@waterlily/api-contract';
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
    name: 'DeepSeek',
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
    generate: vi.fn<ServiceClient['generate']>(() =>
      Promise.resolve(workspace()),
    ),
    health: vi.fn<ServiceClient['health']>(() => Promise.resolve(providers)),
    load: vi.fn<ServiceClient['load']>(() => Promise.resolve(workspace())),
    save: vi.fn<ServiceClient['save']>((snapshot) => Promise.resolve(snapshot)),
    ...overrides,
  };
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
      await result.current.generate('node-synthesis');
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
      await unavailable.result.current.generate('node-synthesis');
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
      await rejected.result.current.generate('node-synthesis');
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
      void active.result.current.generate('node-synthesis');
    });
    await waitFor(() =>
      expect(active.result.current.generation.status).toBe('streaming'),
    );
    act(() => active.result.current.cancel());
    await waitFor(() =>
      expect(active.result.current.generation).toMatchObject({
        error: 'Generation canceled.',
        status: 'idle',
      }),
    );
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
});

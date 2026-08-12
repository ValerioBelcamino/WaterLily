import type {
  GenerationStreamItem,
  ProviderDescriptor,
  WorkspaceSnapshot,
} from '@llm-graph/api-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { nodeTitle } from '../graph/graphViewModel';
import { useWorkbenchStore } from '../state/workbenchStore';
import { WorkbenchApiError, WorkbenchClient } from './workbenchClient';

export type ServiceStatus = 'connecting' | 'disabled' | 'offline' | 'online';
export type GenerationStatus = 'idle' | 'saving' | 'streaming';

export interface GenerationViewState {
  readonly error: string | null;
  readonly model: string | null;
  readonly reasoning: string;
  readonly status: GenerationStatus;
  readonly text: string;
}

interface ServiceClient {
  generate: WorkbenchClient['generate'];
  health: WorkbenchClient['health'];
  load: WorkbenchClient['load'];
  save: WorkbenchClient['save'];
}

export interface UseWorkbenchServiceOptions {
  readonly client?: ServiceClient;
  readonly enabled?: boolean;
  readonly saveDelayMilliseconds?: number;
}

export interface WorkbenchServiceState {
  readonly cancel: () => void;
  readonly generate: (headNodeId: string) => Promise<void>;
  readonly generation: GenerationViewState;
  readonly providers: readonly ProviderDescriptor[];
  readonly selectedProviderId: string | null;
  readonly serviceError: string | null;
  readonly setSelectedProviderId: (providerId: string) => void;
  readonly status: ServiceStatus;
}

const IDLE_GENERATION: GenerationViewState = {
  error: null,
  model: null,
  reasoning: '',
  status: 'idle',
  text: '',
};

function errorMessage(error: unknown): string {
  if (error instanceof WorkbenchApiError || error instanceof Error)
    return error.message;
  return 'The local service request failed.';
}

export function useWorkbenchService(
  options: UseWorkbenchServiceOptions = {},
): WorkbenchServiceState {
  const enabled = options.enabled ?? import.meta.env.MODE !== 'test';
  const saveDelayMilliseconds = options.saveDelayMilliseconds ?? 300;
  const client = useMemo<ServiceClient>(
    () => options.client ?? new WorkbenchClient(),
    [options.client],
  );
  const contextSelections = useWorkbenchStore(
    (state) => state.contextSelections,
  );
  const graph = useWorkbenchStore((state) => state.graph);
  const groups = useWorkbenchStore((state) => state.groups);
  const positions = useWorkbenchStore((state) => state.positions);
  const replaceWorkspace = useWorkbenchStore((state) => state.replaceWorkspace);
  const [generation, setGeneration] =
    useState<GenerationViewState>(IDLE_GENERATION);
  const [providers, setProviders] = useState<readonly ProviderDescriptor[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [status, setStatus] = useState<ServiceStatus>(
    enabled ? 'connecting' : 'disabled',
  );
  const abortRef = useRef<AbortController | null>(null);
  const initializedRef = useRef(false);
  const lastSavedUpdatedAtRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const skipAutosaveRef = useRef(false);
  const workspace: WorkspaceSnapshot = useMemo(
    () => ({
      graph,
      state: {
        contextSelections,
        version: 1,
        view: { groups, positions },
      },
    }),
    [contextSelections, graph, groups, positions],
  );
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const persist = useCallback(
    async (snapshot: WorkspaceSnapshot): Promise<void> => {
      const saved = await client.save(snapshot, lastSavedUpdatedAtRef.current);
      lastSavedUpdatedAtRef.current = saved.graph.updatedAt;
      setServiceError(null);
    },
    [client],
  );

  useEffect(() => {
    if (!enabled) return;
    const initialization = new AbortController();
    const wasCanceled = (): boolean => initialization.signal.aborted;
    void (async () => {
      try {
        const availableProviders = await client.health();
        const loaded = await client.load(workspaceRef.current.graph.id);
        if (wasCanceled()) return;
        setProviders(availableProviders);
        setSelectedProviderId(
          availableProviders.find((provider) => provider.available)?.id ?? null,
        );
        if (loaded === null) {
          const saved = await client.save(workspaceRef.current, null);
          if (wasCanceled()) return;
          lastSavedUpdatedAtRef.current = saved.graph.updatedAt;
        } else {
          replaceWorkspace(loaded);
          lastSavedUpdatedAtRef.current = loaded.graph.updatedAt;
        }
        skipAutosaveRef.current = true;
        initializedRef.current = true;
        setStatus('online');
        setServiceError(null);
      } catch (error: unknown) {
        if (wasCanceled()) return;
        setStatus('offline');
        setServiceError(errorMessage(error));
      }
    })();
    return () => {
      initialization.abort();
      abortRef.current?.abort();
    };
  }, [client, enabled, replaceWorkspace]);

  useEffect(() => {
    if (!enabled || status !== 'online' || !initializedRef.current) return;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    const snapshot = workspace;
    const timeout = globalThis.setTimeout(() => {
      saveQueueRef.current = saveQueueRef.current
        .then(() => persist(snapshot))
        .catch((error: unknown) => {
          setServiceError(errorMessage(error));
        });
    }, saveDelayMilliseconds);
    return () => globalThis.clearTimeout(timeout);
  }, [enabled, persist, saveDelayMilliseconds, status, workspace]);

  const cancel = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const generate = useCallback(
    async (headNodeId: string): Promise<void> => {
      if (generation.status !== 'idle') return;
      const provider = providers.find(
        (candidate) =>
          candidate.id === selectedProviderId && candidate.available,
      );
      if (provider === undefined) {
        setGeneration({
          ...IDLE_GENERATION,
          error: 'Configure a provider in the local service environment first.',
        });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setGeneration({ ...IDLE_GENERATION, status: 'saving' });
      try {
        await saveQueueRef.current.catch(() => undefined);
        await persist(workspaceRef.current);
        setGeneration({ ...IDLE_GENERATION, status: 'streaming' });
        const result = await client.generate(
          {
            context: {
              heads: [
                {
                  label: nodeTitle(workspaceRef.current.graph, headNodeId),
                  nodeId: headNodeId,
                  slot: 0,
                },
              ],
              overrides: Object.entries(
                workspaceRef.current.state.contextSelections,
              ).map(([nodeId, selection]) => ({ nodeId, selection })),
            },
            graphId: workspaceRef.current.graph.id,
            providerId: provider.id,
            request: { model: provider.defaultModel },
            title: `Response to ${nodeTitle(workspaceRef.current.graph, headNodeId)}`,
          },
          (item: GenerationStreamItem) => {
            if (item.type !== 'provider-event') return;
            const event = item.event;
            if (event.type === 'response-start')
              setGeneration((current) => ({
                ...current,
                model: event.model,
              }));
            if (event.type === 'reasoning-delta')
              setGeneration((current) => ({
                ...current,
                reasoning: current.reasoning + event.delta,
              }));
            if (event.type === 'text-delta')
              setGeneration((current) => ({
                ...current,
                text: current.text + event.delta,
              }));
          },
          controller.signal,
        );
        skipAutosaveRef.current = true;
        replaceWorkspace(result);
        lastSavedUpdatedAtRef.current = result.graph.updatedAt;
        setGeneration((current) => ({ ...current, status: 'idle' }));
      } catch (error: unknown) {
        const canceled = controller.signal.aborted;
        setGeneration((current) => ({
          ...current,
          error: canceled ? 'Generation canceled.' : errorMessage(error),
          status: 'idle',
        }));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [
      client,
      generation.status,
      persist,
      providers,
      replaceWorkspace,
      selectedProviderId,
    ],
  );

  return {
    cancel,
    generate,
    generation,
    providers,
    selectedProviderId,
    serviceError,
    setSelectedProviderId,
    status,
  };
}

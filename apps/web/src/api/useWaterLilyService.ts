import type {
  AttachmentDescriptor,
  CreateProviderProfileRequest,
  GenerationStreamItem,
  ProviderDescriptor,
  PythonExecutionResult,
  WorkspaceSnapshot,
} from '@waterlily/api-contract';
import { compileContext } from '@waterlily/context-engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  deriveActiveContextFlow,
  nodeTitle,
  type ActiveContextFlow,
} from '../graph/graphViewModel';
import { attachmentCompatibilityByNode } from '../files/compatibility';
import { createPortableId } from '../ids';
import { useWaterLilyStore } from '../state/waterlilyStore';
import { WaterLilyApiError, WaterLilyClient } from './waterlilyClient';

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
  createProviderProfile?: WaterLilyClient['createProviderProfile'];
  removeProviderProfile?: WaterLilyClient['removeProviderProfile'];
  uploadAttachment?: WaterLilyClient['uploadAttachment'];
  executePython?: WaterLilyClient['executePython'];
  generate: WaterLilyClient['generate'];
  health: WaterLilyClient['health'];
  load: WaterLilyClient['load'];
  save: WaterLilyClient['save'];
}

export interface UseWaterLilyServiceOptions {
  readonly client?: ServiceClient;
  readonly enabled?: boolean;
  readonly saveDelayMilliseconds?: number;
}

export interface WaterLilyServiceState {
  readonly activeFlow: ActiveContextFlow | null;
  readonly cancel: () => void;
  readonly createProviderProfile: (
    input: CreateProviderProfileRequest,
  ) => Promise<void>;
  readonly executePython: (headNodeId: string) => Promise<void>;
  readonly execution: PythonExecutionViewState;
  readonly generate: (headNodeIds: readonly string[]) => Promise<void>;
  readonly generation: GenerationViewState;
  readonly providers: readonly ProviderDescriptor[];
  readonly removeProviderProfile: (profileId: string) => Promise<void>;
  readonly selectedModelId: string | null;
  readonly selectedProviderId: string | null;
  readonly serviceError: string | null;
  readonly setSelectedProviderId: (providerId: string) => void;
  readonly setSelectedModelId: (modelId: string) => void;
  readonly status: ServiceStatus;
  readonly uploadAttachment: (file: File) => Promise<AttachmentDescriptor>;
}

export interface PythonExecutionViewState {
  readonly error: string | null;
  readonly result: PythonExecutionResult | null;
  readonly status: 'idle' | 'running';
}

const IDLE_GENERATION: GenerationViewState = {
  error: null,
  model: null,
  reasoning: '',
  status: 'idle',
  text: '',
};

const IDLE_EXECUTION: PythonExecutionViewState = {
  error: null,
  result: null,
  status: 'idle',
};

function errorMessage(error: unknown): string {
  if (error instanceof WaterLilyApiError || error instanceof Error)
    return error.message;
  return 'The local service request failed.';
}

export function useWaterLilyService(
  options: UseWaterLilyServiceOptions = {},
): WaterLilyServiceState {
  const enabled = options.enabled ?? import.meta.env.MODE !== 'test';
  const saveDelayMilliseconds = options.saveDelayMilliseconds ?? 300;
  const client = useMemo<ServiceClient>(
    () => options.client ?? new WaterLilyClient(),
    [options.client],
  );
  const contextSelections = useWaterLilyStore(
    (state) => state.contextSelections,
  );
  const graph = useWaterLilyStore((state) => state.graph);
  const groups = useWaterLilyStore((state) => state.groups);
  const positions = useWaterLilyStore((state) => state.positions);
  const replaceWorkspace = useWaterLilyStore((state) => state.replaceWorkspace);
  const addExecutionResult = useWaterLilyStore(
    (state) => state.addExecutionResult,
  );
  const [generation, setGeneration] =
    useState<GenerationViewState>(IDLE_GENERATION);
  const [execution, setExecution] =
    useState<PythonExecutionViewState>(IDLE_EXECUTION);
  const [activeFlow, setActiveFlow] = useState<ActiveContextFlow | null>(null);
  const [providers, setProviders] = useState<readonly ProviderDescriptor[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [status, setStatus] = useState<ServiceStatus>(
    enabled ? 'connecting' : 'disabled',
  );
  const abortRef = useRef<AbortController | null>(null);
  const executionAbortRef = useRef<AbortController | null>(null);
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
        const initialProvider = availableProviders.find(
          (provider) => provider.available,
        );
        setSelectedProviderId(initialProvider?.id ?? null);
        setSelectedModelId(initialProvider?.defaultModel ?? null);
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
      executionAbortRef.current?.abort();
    };
  }, [client, enabled, replaceWorkspace]);

  useEffect(() => {
    if (
      !enabled ||
      status !== 'online' ||
      generation.status !== 'idle' ||
      !initializedRef.current
    )
      return;
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
  }, [
    enabled,
    generation.status,
    persist,
    saveDelayMilliseconds,
    status,
    workspace,
  ]);

  const cancel = useCallback((): void => {
    abortRef.current?.abort();
    executionAbortRef.current?.abort();
  }, []);

  const executePython = useCallback(
    async (headNodeId: string): Promise<void> => {
      if (execution.status !== 'idle') return;
      if (client.executePython === undefined) {
        setExecution({
          ...IDLE_EXECUTION,
          error: 'Local Python execution is unavailable.',
        });
        return;
      }
      const snapshot = workspaceRef.current;
      if (snapshot.graph.nodes[headNodeId]?.kind !== 'code') {
        setExecution({
          ...IDLE_EXECUTION,
          error: 'Select a Python code cell to run.',
        });
        return;
      }
      const controller = new AbortController();
      executionAbortRef.current = controller;
      setExecution({ ...IDLE_EXECUTION, status: 'running' });
      try {
        const compiled = await compileContext({
          graph: snapshot.graph,
          heads: [{ label: 'Python notebook', nodeId: headNodeId, slot: 0 }],
          overrides: Object.entries(snapshot.state.contextSelections).map(
            ([nodeId, selection]) => ({ nodeId, selection }),
          ),
        });
        const items = [
          ...compiled.common.items,
          ...compiled.branches.flatMap((branch) => branch.items),
        ];
        const cells = items.flatMap((item) =>
          item.nodeKind !== 'code'
            ? []
            : [
                {
                  nodeId: item.nodeId,
                  source: item.blocks
                    .flatMap((block) =>
                      block.type === 'text' ? [block.text] : [],
                    )
                    .join('\n\n'),
                },
              ],
        );
        if (cells.length === 0)
          throw new Error('The selected flow has no included Python cells.');
        const result = await client.executePython(
          { cells, graphId: snapshot.graph.id },
          controller.signal,
        );
        const outputParts: string[] = [];
        if (result.stdout.length > 0) outputParts.push(result.stdout.trimEnd());
        if (result.stderr.length > 0)
          outputParts.push(`[stderr]\n${result.stderr.trimEnd()}`);
        if (result.timedOut)
          outputParts.push('[execution stopped after the local time limit]');
        if (result.truncated)
          outputParts.push('[output truncated at the local size limit]');
        if (outputParts.length === 0) outputParts.push('[no output]');
        const createdAt = new Date().toISOString();
        addExecutionResult({
          blockId: createPortableId('block'),
          codeNodeId: headNodeId,
          createdAt,
          durationMilliseconds: result.durationMilliseconds,
          edgeId: createPortableId('edge'),
          exitCode: result.exitCode,
          nodeId: createPortableId('node'),
          output: outputParts.join('\n\n'),
          revisionId: createPortableId('revision'),
          timedOut: result.timedOut,
          truncated: result.truncated,
        });
        setExecution({ error: null, result, status: 'idle' });
      } catch (error: unknown) {
        setExecution({
          ...IDLE_EXECUTION,
          error: controller.signal.aborted
            ? 'Python execution canceled.'
            : errorMessage(error),
        });
      } finally {
        if (executionAbortRef.current === controller)
          executionAbortRef.current = null;
      }
    },
    [addExecutionResult, client, execution.status],
  );

  const selectProvider = useCallback(
    (providerId: string): void => {
      const provider = providers.find(
        (candidate) => candidate.id === providerId,
      );
      setSelectedProviderId(providerId);
      setSelectedModelId(provider?.defaultModel ?? null);
    },
    [providers],
  );

  const createProviderProfile = useCallback(
    async (input: CreateProviderProfileRequest): Promise<void> => {
      if (client.createProviderProfile === undefined)
        throw new Error('Provider profile storage is unavailable.');
      const created = await client.createProviderProfile(input);
      const availableProviders = await client.health();
      setProviders(availableProviders);
      setSelectedProviderId(created.id);
      setSelectedModelId(created.defaultModel);
    },
    [client],
  );

  const removeProviderProfile = useCallback(
    async (profileId: string): Promise<void> => {
      if (client.removeProviderProfile === undefined)
        throw new Error('Provider profile storage is unavailable.');
      await client.removeProviderProfile(profileId);
      const availableProviders = await client.health();
      setProviders(availableProviders);
      if (selectedProviderId === profileId) {
        const fallback = availableProviders.find(
          (provider) => provider.available,
        );
        setSelectedProviderId(fallback?.id ?? null);
        setSelectedModelId(fallback?.defaultModel ?? null);
      }
    },
    [client, selectedProviderId],
  );

  const uploadAttachment = useCallback(
    async (file: File): Promise<AttachmentDescriptor> => {
      if (client.uploadAttachment === undefined)
        throw new Error('Attachment storage is unavailable.');
      return client.uploadAttachment(file);
    },
    [client],
  );

  const generate = useCallback(
    async (headNodeIds: readonly string[]): Promise<void> => {
      if (generation.status !== 'idle') return;
      if (headNodeIds.length === 0) return;
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
      const model = provider.models.find(
        (candidate) => candidate.id === selectedModelId,
      );
      if (model === undefined) {
        setGeneration({
          ...IDLE_GENERATION,
          error: 'Choose an available model before generating.',
        });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setGeneration({ ...IDLE_GENERATION, status: 'saving' });
      try {
        const generationWorkspace = workspaceRef.current;
        const heads = headNodeIds.map((nodeId, slot) => ({
          label: nodeTitle(generationWorkspace.graph, nodeId),
          nodeId,
          slot,
        }));
        const title =
          heads.length === 1
            ? (heads[0]?.label ?? 'Selected context')
            : `${String(heads.length)} selected context heads`;
        const overrides = Object.entries(
          generationWorkspace.state.contextSelections,
        ).map(([nodeId, selection]) => ({ nodeId, selection }));
        const flow = await deriveActiveContextFlow(
          generationWorkspace.graph,
          heads,
          generationWorkspace.state.contextSelections,
          'running',
        );
        const compatibility = attachmentCompatibilityByNode(
          generationWorkspace.graph,
          model,
        );
        const incompatible = flow.nodeIds.filter(
          (nodeId) => compatibility[nodeId] === 'unsupported',
        );
        if (incompatible.length > 0) {
          const names = incompatible.map((nodeId) =>
            nodeTitle(generationWorkspace.graph, nodeId),
          );
          throw new Error(
            `${model.name} cannot receive ${names.join(', ')}. Exclude ${incompatible.length === 1 ? 'that file' : 'those files'} or choose a compatible model.`,
          );
        }
        setActiveFlow(flow);
        await saveQueueRef.current.catch(() => undefined);
        await persist(generationWorkspace);
        setGeneration({ ...IDLE_GENERATION, status: 'streaming' });
        const result = await client.generate(
          {
            context: { heads, overrides },
            graphId: generationWorkspace.graph.id,
            providerId: provider.id,
            request: { model: model.id },
            title: `Response to ${title}`,
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
        setActiveFlow(null);
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
      selectedModelId,
    ],
  );

  return {
    activeFlow,
    cancel,
    createProviderProfile,
    executePython,
    execution,
    generate,
    generation,
    providers,
    removeProviderProfile,
    selectedModelId,
    selectedProviderId,
    serviceError,
    setSelectedModelId,
    setSelectedProviderId: selectProvider,
    status,
    uploadAttachment,
  };
}

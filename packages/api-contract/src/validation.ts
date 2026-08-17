import type {
  ContextOverride,
  ContextSelection,
} from '@waterlily/context-engine';
import {
  validateGraph,
  type GraphSnapshot,
  type NodeRevision,
} from '@waterlily/domain';
import { validateGraphViewState } from '@waterlily/interchange';
import type { ChatStreamEvent } from '@waterlily/providers';

import { ApiContractError, failContract } from './errors.js';
import type {
  CreateProviderProfileRequest,
  GenerationApiRequest,
  GenerationStreamItem,
  PythonExecutionRequest,
  WorkspaceSnapshot,
  WorkspaceStateV1,
  WorkspaceWriteRequest,
} from './types.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) failContract(`${label} must be an object`);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  )
    failContract(`${label} has unsupported or missing fields`);
}

function text(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0)
    failContract(`${label} must be a non-blank string`);
  return value;
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value))
    failContract(`${label} must be a portable identifier`);
  return value;
}

function selection(
  value: unknown,
  nodeId: string,
  revision: NodeRevision,
): ContextSelection {
  const item = record(value, `context selection ${nodeId}`);
  if (item.mode === 'full' || item.mode === 'excluded') {
    exactKeys(item, ['mode'], [], `context selection ${nodeId}`);
    return { mode: item.mode };
  }
  if (item.mode !== 'blocks' || !Array.isArray(item.blockIds))
    failContract(`context selection ${nodeId} is invalid`);
  exactKeys(item, ['blockIds', 'mode'], [], `context selection ${nodeId}`);
  const blockIds = item.blockIds.filter(
    (blockId): blockId is string => typeof blockId === 'string',
  );
  if (
    blockIds.length === 0 ||
    blockIds.length !== item.blockIds.length ||
    new Set(blockIds).size !== blockIds.length
  )
    failContract(`context selection ${nodeId} requires unique block ids`);
  const validBlockIds = new Set(revision.blocks.map((block) => block.id));
  if (blockIds.some((blockId) => !validBlockIds.has(blockId)))
    failContract(`context selection ${nodeId} references a missing block`);
  return { blockIds, mode: 'blocks' };
}

export function validateWorkspaceState(
  graph: GraphSnapshot,
  value: unknown,
): WorkspaceStateV1 {
  validateGraph(graph);
  const state = record(value, 'workspace state');
  exactKeys(
    state,
    ['contextSelections', 'version', 'view'],
    [],
    'workspace state',
  );
  if (state.version !== 1)
    failContract('workspace state version is unsupported');
  const contextSelections = record(
    state.contextSelections,
    'workspace context selections',
  );
  const normalizedSelections: Record<string, ContextSelection> = {};
  for (const [nodeId, rawSelection] of Object.entries(contextSelections)) {
    const node = graph.nodes[nodeId];
    if (node === undefined)
      failContract('context selection references a missing node');
    const revision = graph.revisions[node.currentRevisionId] as NodeRevision;
    normalizedSelections[nodeId] = selection(rawSelection, nodeId, revision);
  }
  return {
    contextSelections: normalizedSelections,
    version: 1,
    view: validateGraphViewState(graph, state.view),
  };
}

function graphValue(value: unknown): GraphSnapshot {
  try {
    const graph = value as GraphSnapshot;
    validateGraph(graph);
    return graph;
  } catch (cause) {
    throw new ApiContractError('workspace graph is invalid', { cause });
  }
}

export function parseWorkspaceWriteRequest(
  value: unknown,
): WorkspaceWriteRequest {
  const input = record(value, 'workspace write request');
  exactKeys(
    input,
    ['expectedUpdatedAt', 'graph', 'state'],
    [],
    'workspace write request',
  );
  const workspace = parseWorkspaceSnapshot({
    graph: input.graph,
    state: input.state,
  });
  const expectedUpdatedAt = input.expectedUpdatedAt;
  if (expectedUpdatedAt !== null && typeof expectedUpdatedAt !== 'string')
    failContract('expectedUpdatedAt must be a string or null');
  return {
    expectedUpdatedAt,
    graph: workspace.graph,
    state: workspace.state,
  };
}

export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  const input = record(value, 'workspace snapshot');
  exactKeys(input, ['graph', 'state'], [], 'workspace snapshot');
  const graph = graphValue(input.graph);
  return {
    graph: structuredClone(graph),
    state: validateWorkspaceState(graph, input.state),
  };
}

function contextSelectionForOverride(
  graph: GraphSnapshot,
  value: unknown,
  nodeId: string,
  revisionId: string | undefined,
): ContextSelection {
  const node = graph.nodes[nodeId];
  if (node === undefined)
    failContract('context override references a missing node');
  const resolvedRevisionId = revisionId ?? node.currentRevisionId;
  const revision = graph.revisions[resolvedRevisionId];
  if (revision?.nodeId !== nodeId)
    failContract('context override revision does not belong to its node');
  return selection(value, nodeId, revision);
}

function generationContext(
  graph: GraphSnapshot,
  value: unknown,
): GenerationApiRequest['context'] {
  const context = record(value, 'generation context');
  exactKeys(
    context,
    ['heads', 'overrides'],
    ['tokenBudget'],
    'generation context',
  );
  if (!Array.isArray(context.heads) || context.heads.length === 0)
    failContract('generation context requires at least one head');
  const slots = new Set<number>();
  const heads = context.heads.map((rawHead, index) => {
    const head = record(rawHead, `context head ${String(index)}`);
    exactKeys(
      head,
      ['label', 'nodeId', 'slot'],
      ['revisionId'],
      'context head',
    );
    const nodeId = id(head.nodeId, 'context head nodeId');
    const node = graph.nodes[nodeId];
    if (node?.deletedAt !== null) failContract('context head is unavailable');
    const revisionId =
      head.revisionId === undefined
        ? undefined
        : id(head.revisionId, 'context head revisionId');
    if (
      revisionId !== undefined &&
      graph.revisions[revisionId]?.nodeId !== nodeId
    )
      failContract('context head revision does not belong to its node');
    if (!Number.isInteger(head.slot) || (head.slot as number) < 0)
      failContract('context head slot must be a non-negative integer');
    if (slots.has(head.slot as number))
      failContract('context head slots must be unique');
    slots.add(head.slot as number);
    return {
      label: text(head.label, 'context head label') as string,
      nodeId,
      ...(revisionId === undefined ? {} : { revisionId }),
      slot: head.slot as number,
    };
  });
  if (!Array.isArray(context.overrides))
    failContract('generation context overrides must be an array');
  const overrides = context.overrides.map(
    (rawOverride, index): ContextOverride => {
      const override = record(rawOverride, `context override ${String(index)}`);
      exactKeys(
        override,
        ['nodeId', 'selection'],
        ['revisionId'],
        'context override',
      );
      const nodeId = id(override.nodeId, 'context override nodeId');
      const revisionId =
        override.revisionId === undefined
          ? undefined
          : id(override.revisionId, 'context override revisionId');
      return {
        nodeId,
        ...(revisionId === undefined ? {} : { revisionId }),
        selection: contextSelectionForOverride(
          graph,
          override.selection,
          nodeId,
          revisionId,
        ),
      };
    },
  );
  const tokenBudget = context.tokenBudget;
  if (
    tokenBudget !== undefined &&
    (!Number.isInteger(tokenBudget) || (tokenBudget as number) <= 0)
  )
    failContract('tokenBudget must be a positive integer');
  return {
    heads,
    overrides,
    ...(tokenBudget === undefined
      ? {}
      : { tokenBudget: tokenBudget as number }),
  };
}

function generationSettings(value: unknown): GenerationApiRequest['request'] {
  const request = record(value, 'generation request settings');
  exactKeys(
    request,
    ['model'],
    ['maxOutputTokens', 'stop', 'temperature', 'topP'],
    'generation request settings',
  );
  const model = text(request.model, 'model') as string;
  if (
    request.maxOutputTokens !== undefined &&
    (!Number.isInteger(request.maxOutputTokens) ||
      (request.maxOutputTokens as number) <= 0)
  )
    failContract('maxOutputTokens must be a positive integer');
  if (
    request.temperature !== undefined &&
    (typeof request.temperature !== 'number' ||
      !Number.isFinite(request.temperature) ||
      request.temperature < 0 ||
      request.temperature > 2)
  )
    failContract('temperature must be between 0 and 2');
  if (
    request.topP !== undefined &&
    (typeof request.topP !== 'number' ||
      !Number.isFinite(request.topP) ||
      request.topP < 0 ||
      request.topP > 1)
  )
    failContract('topP must be between 0 and 1');
  if (
    request.stop !== undefined &&
    typeof request.stop !== 'string' &&
    (!Array.isArray(request.stop) ||
      request.stop.length === 0 ||
      request.stop.some((stop) => typeof stop !== 'string'))
  )
    failContract('stop must be a string or non-empty string array');
  return {
    model,
    ...(request.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: request.maxOutputTokens as number }),
    ...(request.stop === undefined
      ? {}
      : { stop: request.stop as string | readonly string[] }),
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(request.topP === undefined ? {} : { topP: request.topP }),
  };
}

export function parseGenerationApiRequest(
  value: unknown,
  graph: GraphSnapshot,
): GenerationApiRequest {
  const input = record(value, 'generation API request');
  exactKeys(
    input,
    ['context', 'graphId', 'providerId', 'request', 'title'],
    [],
    'generation API request',
  );
  const graphId = id(input.graphId, 'graphId');
  if (graphId !== graph.id)
    failContract('generation graphId does not match the graph');
  return {
    context: generationContext(graph, input.context),
    graphId,
    providerId: id(input.providerId, 'providerId'),
    request: generationSettings(input.request),
    title: text(input.title, 'title', true),
  };
}

export function parseCreateProviderProfileRequest(
  value: unknown,
): CreateProviderProfileRequest {
  const input = record(value, 'provider profile request');
  exactKeys(
    input,
    ['apiKey', 'baseUrl', 'label', 'models', 'providerType'],
    [],
    'provider profile request',
  );
  const providerTypes = new Set(['deepseek', 'openai', 'openai-compatible']);
  if (
    typeof input.providerType !== 'string' ||
    !providerTypes.has(input.providerType)
  )
    failContract('providerType is unsupported');
  const apiKey =
    input.apiKey === null ? null : (text(input.apiKey, 'apiKey') as string);
  const baseUrl =
    input.baseUrl === null ? null : (text(input.baseUrl, 'baseUrl') as string);
  if (!Array.isArray(input.models)) failContract('models must be an array');
  const models = input.models.map((model, index) =>
    text(model, `model ${String(index)}`),
  ) as string[];
  if (new Set(models).size !== models.length)
    failContract('models must be unique');
  if (input.providerType === 'openai-compatible' && models.length === 0)
    failContract('OpenAI-compatible profiles require at least one model');
  if (input.providerType !== 'openai-compatible' && apiKey === null)
    failContract('This provider requires an API key');
  if (input.providerType === 'openai-compatible' && baseUrl === null)
    failContract('OpenAI-compatible profiles require a base URL');
  if (baseUrl !== null) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      failContract('baseUrl must be a valid URL');
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    )
      failContract(
        'baseUrl must use HTTP(S) without credentials, query, or fragment',
      );
  }
  return {
    apiKey,
    baseUrl,
    label: text(input.label, 'label') as string,
    models,
    providerType:
      input.providerType as CreateProviderProfileRequest['providerType'],
  };
}

export function parsePythonExecutionRequest(
  value: unknown,
): PythonExecutionRequest {
  const input = record(value, 'Python execution request');
  exactKeys(input, ['cells', 'graphId'], [], 'Python execution request');
  const graphId = id(input.graphId, 'Python execution graphId');
  if (
    !Array.isArray(input.cells) ||
    input.cells.length === 0 ||
    input.cells.length > 64
  )
    failContract('Python execution requires between 1 and 64 cells');
  let totalCharacters = 0;
  const cells = input.cells.map((value, index) => {
    const cell = record(value, `Python cell ${String(index)}`);
    exactKeys(cell, ['nodeId', 'source'], [], 'Python cell');
    if (typeof cell.source !== 'string' || cell.source.length > 100_000)
      failContract('Python cell source must be at most 100000 characters');
    totalCharacters += cell.source.length;
    return {
      nodeId: id(cell.nodeId, 'Python cell nodeId'),
      source: cell.source,
    };
  });
  if (totalCharacters > 500_000)
    failContract('Python execution source exceeds 500000 characters');
  return { cells, graphId };
}

function streamEvent(value: unknown): ChatStreamEvent {
  const event = record(value, 'provider event');
  switch (event.type) {
    case 'response-start':
      exactKeys(
        event,
        ['createdAt', 'model', 'responseId', 'type'],
        [],
        'provider event',
      );
      if (event.createdAt !== null && typeof event.createdAt !== 'string')
        failContract('response start createdAt is invalid');
      return {
        createdAt: event.createdAt,
        model: text(event.model, 'response model') as string,
        responseId: text(event.responseId, 'response id') as string,
        type: event.type,
      };
    case 'reasoning-delta':
    case 'text-delta':
      exactKeys(event, ['delta', 'type'], [], 'provider event');
      if (typeof event.delta !== 'string')
        failContract('stream delta must be a string');
      return { delta: event.delta, type: event.type };
    case 'usage':
      exactKeys(
        event,
        ['inputTokens', 'outputTokens', 'totalTokens', 'type'],
        [],
        'provider event',
      );
      if (
        !Number.isInteger(event.inputTokens) ||
        !Number.isInteger(event.outputTokens) ||
        !Number.isInteger(event.totalTokens) ||
        (event.inputTokens as number) < 0 ||
        (event.outputTokens as number) < 0 ||
        (event.totalTokens as number) < 0
      )
        failContract('usage tokens must be non-negative integers');
      return {
        inputTokens: event.inputTokens as number,
        outputTokens: event.outputTokens as number,
        totalTokens: event.totalTokens as number,
        type: event.type,
      };
    case 'response-end': {
      exactKeys(
        event,
        ['finishReason', 'rawFinishReason', 'type'],
        [],
        'provider event',
      );
      const finishReasons = new Set([
        'content-filter',
        'length',
        'other',
        'stop',
        'tool-calls',
      ]);
      if (
        typeof event.finishReason !== 'string' ||
        !finishReasons.has(event.finishReason) ||
        (event.rawFinishReason !== null &&
          typeof event.rawFinishReason !== 'string')
      )
        failContract('response finish reason is invalid');
      return event as unknown as ChatStreamEvent;
    }
    default:
      failContract('provider event type is unsupported');
  }
}

export function parseGenerationStreamLine(line: string): GenerationStreamItem {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (cause) {
    throw new ApiContractError('generation stream line is not JSON', { cause });
  }
  const item = record(value, 'generation stream item');
  if (item.type === 'provider-event') {
    exactKeys(item, ['event', 'type'], [], 'generation stream item');
    return { event: streamEvent(item.event), type: item.type };
  }
  if (item.type === 'generation-error') {
    exactKeys(item, ['error', 'type'], [], 'generation stream item');
    const error = record(item.error, 'generation error');
    exactKeys(error, ['code', 'message'], [], 'generation error');
    return {
      error: {
        code: text(error.code, 'generation error code') as string,
        message: text(error.message, 'generation error message') as string,
      },
      type: item.type,
    };
  }
  if (item.type === 'generation-complete') {
    exactKeys(item, ['type', 'workspace'], [], 'generation stream item');
    return {
      type: item.type,
      workspace: parseWorkspaceSnapshot(item.workspace),
    };
  }
  failContract('generation stream item type is unsupported');
}

export function serializeNdjson(value: GenerationStreamItem): string {
  return `${JSON.stringify(value)}\n`;
}

export function toWorkspaceSnapshot(
  value: WorkspaceWriteRequest,
): WorkspaceSnapshot {
  return { graph: value.graph, state: value.state };
}

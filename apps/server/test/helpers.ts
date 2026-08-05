import type {
  WorkspaceSnapshot,
  WorkspaceStateV1,
} from '@waterlily/api-contract';
import { DatabaseError } from '@waterlily/database';
import {
  connectContext,
  createGraph,
  createNode,
  type GraphSnapshot,
} from '@waterlily/domain';
import type { ChatProvider, ChatStreamEvent } from '@waterlily/providers';

import type { WorkspaceStore } from '../src/types.js';

export const NOW = '2026-08-05T13:00:00.000Z';

export function graphFixture(): GraphSnapshot {
  let graph = createGraph({
    createdAt: '2026-08-05T12:00:00.000Z',
    graphId: 'graph-server',
  });
  graph = createNode(graph, {
    blocks: [
      {
        format: 'plain',
        id: 'block-system',
        text: 'Be precise.',
        type: 'text',
      },
    ],
    createdAt: '2026-08-05T12:00:01.000Z',
    kind: 'message',
    nodeId: 'node-system',
    revisionId: 'revision-system',
    role: 'system',
  });
  graph = createNode(graph, {
    blocks: [
      { format: 'plain', id: 'block-user', text: 'Explain ATP.', type: 'text' },
    ],
    createdAt: '2026-08-05T12:00:02.000Z',
    kind: 'message',
    nodeId: 'node-user',
    revisionId: 'revision-user',
    role: 'user',
  });
  return connectContext(graph, {
    createdAt: '2026-08-05T12:00:03.000Z',
    edgeId: 'edge-system-user',
    slot: 0,
    sourceNodeId: 'node-system',
    targetNodeId: 'node-user',
  });
}

export function stateFixture(): WorkspaceStateV1 {
  return {
    contextSelections: {},
    version: 1,
    view: { groups: [], positions: {} },
  };
}

export function workspaceFixture(): WorkspaceSnapshot {
  return { graph: graphFixture(), state: stateFixture() };
}

export class MemoryStore implements WorkspaceStore {
  readonly records = new Map<string, WorkspaceSnapshot>();
  replaceConflicts = 0;

  public get(graphId: string): WorkspaceSnapshot | null {
    const value = this.records.get(graphId);
    return value === undefined ? null : structuredClone(value);
  }

  public insert(workspace: WorkspaceSnapshot): void {
    if (this.records.has(workspace.graph.id))
      throw new DatabaseError('ALREADY_EXISTS', 'Already exists');
    this.records.set(workspace.graph.id, structuredClone(workspace));
  }

  public replace(
    workspace: WorkspaceSnapshot,
    expectedUpdatedAt: string,
  ): void {
    if (this.replaceConflicts > 0) {
      this.replaceConflicts -= 1;
      throw new DatabaseError('CONFLICT', 'Concurrent write');
    }
    const current = this.records.get(workspace.graph.id);
    if (current === undefined)
      throw new DatabaseError('NOT_FOUND', 'Missing workspace');
    if (current.graph.updatedAt !== expectedUpdatedAt)
      throw new DatabaseError('CONFLICT', 'Stale workspace');
    this.records.set(workspace.graph.id, structuredClone(workspace));
  }
}

export const completeEvents: readonly ChatStreamEvent[] = [
  {
    createdAt: NOW,
    model: 'fixture-resolved',
    responseId: 'response-1',
    type: 'response-start',
  },
  { delta: 'public reasoning', type: 'reasoning-delta' },
  { delta: 'ATP answer', type: 'text-delta' },
  { inputTokens: 4, outputTokens: 2, totalTokens: 6, type: 'usage' },
  { finishReason: 'stop', rawFinishReason: 'stop', type: 'response-end' },
];

export function fixtureProvider(
  events: readonly ChatStreamEvent[] = completeEvents,
): ChatProvider {
  return {
    id: 'fixture',
    name: 'Fixture',
    async *streamChat() {
      await Promise.resolve();
      for (const event of events) yield event;
    },
  };
}

export function generationRequest(providerId = 'fixture') {
  return {
    context: {
      heads: [{ label: 'Selected path', nodeId: 'node-user', slot: 0 }],
      overrides: [],
    },
    graphId: 'graph-server',
    providerId,
    request: { model: 'fixture-model', temperature: 0.2 },
    title: 'Generated answer',
  } as const;
}

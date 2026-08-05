import {
  connectContext,
  createGraph,
  createNode,
  type GraphSnapshot,
} from '@waterlily/domain';
import type {
  ChatProvider,
  ChatStreamEvent,
  StreamChatOptions,
} from '@waterlily/providers';

export const time = (offset: number): string =>
  new Date(
    Date.parse('2026-08-05T00:00:00.000Z') + offset * 1_000,
  ).toISOString();

export function linearGraph(): GraphSnapshot {
  let graph = createGraph({ createdAt: time(0), graphId: 'graph-workflow' });
  graph = createNode(graph, {
    blocks: [
      {
        format: 'plain',
        id: 'block-system',
        text: 'Be precise.',
        type: 'text',
      },
    ],
    createdAt: time(1),
    kind: 'message',
    nodeId: 'node-system',
    revisionId: 'revision-system',
    role: 'system',
  });
  graph = createNode(graph, {
    blocks: [
      { format: 'plain', id: 'block-user', text: 'Explain ATP.', type: 'text' },
    ],
    createdAt: time(2),
    kind: 'message',
    nodeId: 'node-user',
    revisionId: 'revision-user',
    role: 'user',
  });
  return connectContext(graph, {
    createdAt: time(3),
    edgeId: 'edge-system-user',
    slot: 0,
    sourceNodeId: 'node-system',
    targetNodeId: 'node-user',
  });
}

export function providerWith(
  events: readonly ChatStreamEvent[],
  inspect?: (options: StreamChatOptions) => void,
): ChatProvider {
  return {
    id: 'fixture-provider',
    name: 'Fixture provider',
    async *streamChat(_request, options = {}) {
      await Promise.resolve();
      inspect?.(options);
      for (const event of events) yield event;
    },
  };
}

export const completeEvents: readonly ChatStreamEvent[] = [
  {
    createdAt: time(10),
    model: 'fixture-model-resolved',
    responseId: 'response-1',
    type: 'response-start',
  },
  { delta: 'public thought', type: 'reasoning-delta' },
  { delta: 'ATP ', type: 'text-delta' },
  { delta: 'answer', type: 'text-delta' },
  { inputTokens: 5, outputTokens: 2, totalTokens: 7, type: 'usage' },
  { finishReason: 'stop', rawFinishReason: 'stop', type: 'response-end' },
];

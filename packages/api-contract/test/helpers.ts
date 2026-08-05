import {
  connectContext,
  createGraph,
  createNode,
  type GraphSnapshot,
} from '@waterlily/domain';

export const NOW = '2026-08-05T12:00:00.000Z';

export function graphFixture(): GraphSnapshot {
  let graph = createGraph({ createdAt: NOW, graphId: 'graph-api' });
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
      {
        format: 'markdown',
        id: 'block-user',
        text: 'Explain ATP.',
        type: 'text',
      },
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

export function workspaceState() {
  return {
    contextSelections: {
      'node-user': { blockIds: ['block-user'], mode: 'blocks' },
    },
    version: 1,
    view: {
      groups: [
        {
          collapsed: false,
          color: '#547a68',
          id: 'group-study',
          nodeIds: ['node-user'],
          title: 'Study',
        },
      ],
      positions: { 'node-user': { x: 12, y: 34 } },
    },
  } as const;
}

export function generationRequest() {
  return {
    context: {
      heads: [{ label: 'Selected path', nodeId: 'node-user', slot: 0 }],
      overrides: [{ nodeId: 'node-system', selection: { mode: 'excluded' } }],
      tokenBudget: 4_000,
    },
    graphId: 'graph-api',
    providerId: 'deepseek',
    request: {
      maxOutputTokens: 800,
      model: 'deepseek-v4-flash',
      stop: ['END'],
      temperature: 0.4,
      topP: 0.9,
    },
    title: 'Generated answer',
  } as const;
}

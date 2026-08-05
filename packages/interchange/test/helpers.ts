import {
  connectContext,
  connectProvenance,
  connectReference,
  createGraph,
  createNode,
  type GraphSnapshot,
} from '@waterlily/domain';

import {
  createGraphDocument,
  type CreateGraphDocumentInput,
  type GraphDocumentV1,
  type IdRemapper,
} from '../src/index.js';

export const time = (offset: number): string =>
  new Date(
    Date.parse('2026-08-05T00:00:00.000Z') + offset * 1_000,
  ).toISOString();

export function sampleGraph(): GraphSnapshot {
  let graph = createGraph({ createdAt: time(0), graphId: 'source-graph' });
  for (const [index, id, role] of [
    [1, 'system', 'system'],
    [2, 'user', 'user'],
    [3, 'answer', 'assistant'],
  ] as const) {
    graph = createNode(graph, {
      blocks: [
        {
          format: 'plain',
          id: `block-${id}`,
          text: `${id} text`,
          type: 'text',
        },
      ],
      createdAt: time(index),
      kind: 'message',
      metadata: { order: index },
      nodeId: `node-${id}`,
      revisionId: `revision-${id}`,
      role,
      title: `${id} title`,
    });
  }
  graph = createNode(graph, {
    blocks: [
      { format: 'plain', id: 'block-note', text: 'note text', type: 'text' },
    ],
    createdAt: time(4),
    kind: 'note',
    nodeId: 'node-note',
    revisionId: 'revision-note',
  });
  graph = connectContext(graph, {
    createdAt: time(5),
    edgeId: 'edge-system-user',
    slot: 0,
    sourceNodeId: 'node-system',
    targetNodeId: 'node-user',
  });
  graph = connectContext(graph, {
    createdAt: time(6),
    edgeId: 'edge-user-answer',
    slot: 0,
    sourceNodeId: 'node-user',
    targetNodeId: 'node-answer',
  });
  graph = connectProvenance(graph, {
    createdAt: time(7),
    edgeId: 'edge-answer-note',
    relation: 'derived',
    sourceNodeId: 'node-answer',
    targetNodeId: 'node-note',
  });
  return connectReference(graph, {
    createdAt: time(8),
    edgeId: 'edge-note-answer',
    label: 'explains',
    sourceNodeId: 'node-note',
    targetNodeId: 'node-answer',
  });
}

export function documentInput(): CreateGraphDocumentInput {
  return {
    exportedAt: time(20),
    exporter: { name: 'WaterLily', version: '0.0.0' },
    graph: sampleGraph(),
    view: {
      groups: [
        {
          collapsed: false,
          color: '#547a68',
          id: 'group-main',
          nodeIds: ['node-system', 'node-user', 'node-answer'],
          title: 'Main thread',
        },
      ],
      positions: {
        'node-answer': { x: 600, y: 0 },
        'node-system': { x: 0, y: 0 },
        'node-user': { x: 300, y: 0 },
      },
    },
  };
}

export function sampleDocument(): GraphDocumentV1 {
  return createGraphDocument(documentInput());
}

export const prefixedRemapper: IdRemapper = (kind, originalId) =>
  `import-${kind}-${originalId}`;

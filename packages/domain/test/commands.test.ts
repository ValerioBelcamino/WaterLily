import { describe, expect, it } from 'vitest';

import {
  connectContext,
  connectProvenance,
  connectReference,
  createGraph,
  createNode,
  reviseNode,
  validateGraph,
  type GraphSnapshot,
  type JsonValue,
} from '../src/index.js';
import {
  T0,
  addMessage,
  emptyGraph,
  expectGraphError,
  timestamp,
} from './helpers.js';

function threeNodes(): GraphSnapshot {
  let graph = emptyGraph();
  graph = addMessage(graph, 'node-a', 1);
  graph = addMessage(graph, 'node-b', 2, 'assistant');
  graph = addMessage(graph, 'node-c', 3);
  return graph;
}

describe('graph creation', () => {
  it('creates a valid empty versioned snapshot', () => {
    const graph = createGraph({ createdAt: T0, graphId: 'portable:id.1' });

    expect(graph).toEqual({
      createdAt: T0,
      edges: {},
      id: 'portable:id.1',
      nodes: {},
      revisions: {},
      updatedAt: T0,
      version: 1,
    });
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it('rejects invalid identifiers and non-canonical timestamps', () => {
    expectGraphError(
      () => createGraph({ createdAt: T0, graphId: 'contains spaces' }),
      'INVALID_ID',
    );
    expectGraphError(
      () => createGraph({ createdAt: '2026-08-05', graphId: 'graph' }),
      'INVALID_TIMESTAMP',
    );
  });
});

describe('node revisions', () => {
  it('creates a message with an immutable first revision', () => {
    const sourceBlocks: {
      format: 'markdown';
      id: string;
      text: string;
      type: 'text';
    }[] = [
      { format: 'markdown', id: 'block-1', text: 'Original', type: 'text' },
    ];
    const sourceMetadata: Record<string, JsonValue> = {
      nested: { provider: 'test' },
    };

    const graph = createNode(emptyGraph(), {
      blocks: sourceBlocks,
      createdAt: timestamp(1),
      kind: 'message',
      metadata: sourceMetadata,
      nodeId: 'node-1',
      revisionId: 'revision-1',
      role: 'user',
      tags: ['study', 'study'],
      title: 'Question',
    });

    const mutableBlock = sourceBlocks[0];
    if (mutableBlock?.type === 'text') {
      mutableBlock.text = 'Changed outside the graph';
    }
    sourceMetadata.nested = { provider: 'changed' };

    expect(graph.nodes['node-1']).toMatchObject({
      currentRevisionId: 'revision-1',
      kind: 'message',
      role: 'user',
      tags: ['study'],
      title: 'Question',
    });
    expect(graph.revisions['revision-1']?.blocks[0]).toMatchObject({
      text: 'Original',
    });
    expect(graph.revisions['revision-1']?.metadata).toEqual({
      nested: { provider: 'test' },
    });
  });

  it('requires roles only for message nodes', () => {
    expectGraphError(
      () =>
        createNode(emptyGraph(), {
          blocks: [],
          createdAt: timestamp(1),
          kind: 'message',
          nodeId: 'node-1',
          revisionId: 'revision-1',
        }),
      'INVALID_NODE',
    );
    expectGraphError(
      () =>
        createNode(emptyGraph(), {
          blocks: [],
          createdAt: timestamp(1),
          kind: 'note',
          nodeId: 'node-1',
          revisionId: 'revision-1',
          role: 'user',
        }),
      'INVALID_NODE',
    );
  });

  it('rejects duplicate content block identifiers and invalid metadata', () => {
    expectGraphError(
      () =>
        createNode(emptyGraph(), {
          blocks: [
            { format: 'plain', id: 'same', text: 'A', type: 'text' },
            { format: 'plain', id: 'same', text: 'B', type: 'text' },
          ],
          createdAt: timestamp(1),
          kind: 'note',
          nodeId: 'node-1',
          revisionId: 'revision-1',
        }),
      'INVALID_CONTENT',
    );
    expectGraphError(
      () =>
        createNode(emptyGraph(), {
          blocks: [],
          createdAt: timestamp(1),
          kind: 'note',
          metadata: { score: Number.POSITIVE_INFINITY },
          nodeId: 'node-1',
          revisionId: 'revision-1',
        }),
      'INVALID_CONTENT',
    );
  });

  it('adds revisions without changing previous content', () => {
    let graph = addMessage(emptyGraph(), 'node-a', 1, 'user', 'Version one');
    graph = reviseNode(graph, {
      blocks: [
        {
          format: 'markdown',
          id: 'node-a-block-v2',
          text: 'Version two',
          type: 'text',
        },
      ],
      createdAt: timestamp(2),
      nodeId: 'node-a',
      revisionId: 'node-a-revision-2',
    });

    expect(graph.nodes['node-a']?.currentRevisionId).toBe('node-a-revision-2');
    expect(graph.revisions['node-a-revision-1']?.blocks[0]).toMatchObject({
      text: 'Version one',
    });
    expect(graph.revisions['node-a-revision-2']?.blocks[0]).toMatchObject({
      text: 'Version two',
    });
  });

  it('uses globally unique identifiers across nodes, revisions, and edges', () => {
    const graph = addMessage(emptyGraph(), 'node-a', 1);

    expectGraphError(
      () =>
        createNode(graph, {
          blocks: [],
          createdAt: timestamp(2),
          kind: 'note',
          nodeId: 'node-a-revision-1',
          revisionId: 'revision-b',
        }),
      'DUPLICATE_ID',
    );
  });
});

describe('edges and causal invariants', () => {
  it('pins the current source revision on context creation', () => {
    let graph = threeNodes();
    graph = connectContext(graph, {
      createdAt: timestamp(4),
      edgeId: 'edge-ab',
      slot: 0,
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
    });
    graph = reviseNode(graph, {
      blocks: [{ format: 'plain', id: 'a-v2-block', text: 'v2', type: 'text' }],
      createdAt: timestamp(5),
      nodeId: 'node-a',
      revisionId: 'node-a-revision-2',
    });

    expect(graph.edges['edge-ab']).toMatchObject({
      sourceRevisionId: 'node-a-revision-1',
    });
  });

  it('accepts an explicitly pinned older source revision', () => {
    let graph = threeNodes();
    graph = reviseNode(graph, {
      blocks: [{ format: 'plain', id: 'a-v2-block', text: 'v2', type: 'text' }],
      createdAt: timestamp(4),
      nodeId: 'node-a',
      revisionId: 'node-a-revision-2',
    });
    graph = connectContext(graph, {
      createdAt: timestamp(5),
      edgeId: 'edge-ab',
      slot: 0,
      sourceNodeId: 'node-a',
      sourceRevisionId: 'node-a-revision-1',
      targetNodeId: 'node-b',
    });

    expect(graph.edges['edge-ab']).toMatchObject({
      sourceRevisionId: 'node-a-revision-1',
    });
  });

  it('rejects revisions belonging to another source node', () => {
    const graph = threeNodes();
    expectGraphError(
      () =>
        connectContext(graph, {
          createdAt: timestamp(4),
          edgeId: 'edge-ab',
          slot: 0,
          sourceNodeId: 'node-a',
          sourceRevisionId: 'node-b-revision-1',
          targetNodeId: 'node-b',
        }),
      'INVALID_REVISION',
    );
  });

  it('rejects causal cycles spanning context and provenance edges', () => {
    let graph = threeNodes();
    graph = connectContext(graph, {
      createdAt: timestamp(4),
      edgeId: 'edge-ab',
      slot: 0,
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
    });
    graph = connectProvenance(graph, {
      createdAt: timestamp(5),
      edgeId: 'edge-bc',
      relation: 'derived',
      sourceNodeId: 'node-b',
      targetNodeId: 'node-c',
    });
    const before = JSON.stringify(graph);

    expectGraphError(
      () =>
        connectContext(graph, {
          createdAt: timestamp(6),
          edgeId: 'edge-ca',
          slot: 0,
          sourceNodeId: 'node-c',
          targetNodeId: 'node-a',
        }),
      'CAUSAL_CYCLE',
    );
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('permits cycles made only of reference edges', () => {
    let graph = threeNodes();
    graph = connectReference(graph, {
      createdAt: timestamp(4),
      edgeId: 'reference-ab',
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
    });
    graph = connectReference(graph, {
      createdAt: timestamp(5),
      edgeId: 'reference-ba',
      sourceNodeId: 'node-b',
      targetNodeId: 'node-a',
    });

    expect(() => validateGraph(graph)).not.toThrow();
    expect(Object.keys(graph.edges)).toHaveLength(2);
  });

  it('rejects self edges of every kind', () => {
    const graph = threeNodes();
    expectGraphError(
      () =>
        connectReference(graph, {
          createdAt: timestamp(4),
          edgeId: 'self-reference',
          sourceNodeId: 'node-a',
          targetNodeId: 'node-a',
        }),
      'SELF_EDGE',
    );
    expectGraphError(
      () =>
        connectProvenance(graph, {
          createdAt: timestamp(4),
          edgeId: 'self-provenance',
          relation: 'derived',
          sourceNodeId: 'node-a',
          targetNodeId: 'node-a',
        }),
      'SELF_EDGE',
    );
  });

  it('rejects duplicate causal edges and duplicate incoming slots', () => {
    let graph = threeNodes();
    graph = connectContext(graph, {
      createdAt: timestamp(4),
      edgeId: 'edge-ab',
      slot: 0,
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
    });

    expectGraphError(
      () =>
        connectContext(graph, {
          createdAt: timestamp(5),
          edgeId: 'edge-ab-copy',
          slot: 1,
          sourceNodeId: 'node-a',
          targetNodeId: 'node-b',
        }),
      'DUPLICATE_EDGE',
    );
    expectGraphError(
      () =>
        connectContext(graph, {
          createdAt: timestamp(5),
          edgeId: 'edge-cb',
          slot: 0,
          sourceNodeId: 'node-c',
          targetNodeId: 'node-b',
        }),
      'DUPLICATE_SLOT',
    );
  });

  it('rejects negative and fractional context slots', () => {
    const graph = threeNodes();
    for (const slot of [-1, 0.5]) {
      expectGraphError(
        () =>
          connectContext(graph, {
            createdAt: timestamp(4),
            edgeId: `edge-${String(slot)}`,
            slot,
            sourceNodeId: 'node-a',
            targetNodeId: 'node-b',
          }),
        'INVALID_EDGE',
      );
    }
  });

  it('rejects missing and deleted edge endpoints', () => {
    const graph = threeNodes();
    expectGraphError(
      () =>
        connectReference(graph, {
          createdAt: timestamp(4),
          edgeId: 'edge-missing',
          sourceNodeId: 'node-a',
          targetNodeId: 'missing',
        }),
      'NOT_FOUND',
    );

    const nodeA = graph.nodes['node-a'];
    expect(nodeA).toBeDefined();
    if (nodeA === undefined) {
      throw new Error('Test fixture is missing node-a');
    }
    const manuallyDeleted: GraphSnapshot = {
      ...graph,
      nodes: {
        ...graph.nodes,
        'node-a': { ...nodeA, deletedAt: timestamp(4) },
      },
    };
    expectGraphError(
      () =>
        connectReference(manuallyDeleted, {
          createdAt: timestamp(5),
          edgeId: 'edge-deleted',
          sourceNodeId: 'node-a',
          targetNodeId: 'node-b',
        }),
      'NODE_DELETED',
    );
  });
});

describe('whole-snapshot validation', () => {
  it('detects record keys that disagree with entity identifiers', () => {
    const graph = addMessage(emptyGraph(), 'node-a', 1);
    const nodeA = graph.nodes['node-a'];
    expect(nodeA).toBeDefined();
    if (nodeA === undefined) {
      throw new Error('Test fixture is missing node-a');
    }
    const invalid: GraphSnapshot = {
      ...graph,
      nodes: { wrong: nodeA },
    };

    expectGraphError(() => validateGraph(invalid), 'INVALID_GRAPH');
  });

  it('detects orphaned revisions', () => {
    const graph = addMessage(emptyGraph(), 'node-a', 1);
    const invalid: GraphSnapshot = {
      ...graph,
      nodes: {},
    };

    expectGraphError(() => validateGraph(invalid), 'INVALID_REVISION');
  });
});

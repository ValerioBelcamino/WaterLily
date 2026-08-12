import { describe, expect, it } from 'vitest';

import {
  connectContext,
  createNode,
  validateGraph,
  type ContentBlock,
  type GraphSnapshot,
  type JsonValue,
} from '../src/index.js';
import {
  addMessage,
  emptyGraph,
  expectGraphError,
  timestamp,
} from './helpers.js';

function asGraph(value: unknown): GraphSnapshot {
  return value as GraphSnapshot;
}

function connectedGraph(): GraphSnapshot {
  let graph = addMessage(emptyGraph(), 'node-a', 1);
  graph = addMessage(graph, 'node-b', 2, 'assistant');
  return connectContext(graph, {
    createdAt: timestamp(3),
    edgeId: 'edge-ab',
    slot: 0,
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
  });
}

describe('runtime snapshot validation', () => {
  it('accepts every supported JSON value and attachment block', () => {
    const graph = createNode(emptyGraph(), {
      blocks: [
        {
          attachmentId: 'attachment-1',
          id: 'attachment-block',
          mediaType: 'application/pdf',
          name: null,
          type: 'attachment',
        },
      ],
      createdAt: timestamp(1),
      kind: 'attachment',
      metadata: {
        boolean: true,
        list: [null, 'text', false, 42, { nested: 'value' }],
        null: null,
        number: 3.14,
        object: { child: ['value'] },
        string: 'text',
      },
      nodeId: 'attachment-node',
      revisionId: 'attachment-revision',
    });

    expect(() => validateGraph(graph)).not.toThrow();
  });

  it('rejects non-JSON metadata encountered at runtime', () => {
    const invalidMetadata = { value: undefined } as unknown as Readonly<
      Record<string, JsonValue>
    >;
    expectGraphError(
      () =>
        createNode(emptyGraph(), {
          blocks: [],
          createdAt: timestamp(1),
          kind: 'note',
          metadata: invalidMetadata,
          nodeId: 'note-node',
          revisionId: 'note-revision',
        }),
      'INVALID_CONTENT',
    );
  });

  it('rejects unsupported text formats and blank attachment media types', () => {
    const invalidFormatBlocks = [
      { format: 'html', id: 'block-1', text: 'text', type: 'text' },
    ] as unknown as readonly ContentBlock[];
    expectGraphError(
      () =>
        createNode(emptyGraph(), {
          blocks: invalidFormatBlocks,
          createdAt: timestamp(1),
          kind: 'note',
          nodeId: 'note-node',
          revisionId: 'note-revision',
        }),
      'INVALID_CONTENT',
    );

    expectGraphError(
      () =>
        createNode(emptyGraph(), {
          blocks: [
            {
              attachmentId: 'attachment-1',
              id: 'block-1',
              mediaType: '   ',
              name: 'file',
              type: 'attachment',
            },
          ],
          createdAt: timestamp(1),
          kind: 'attachment',
          nodeId: 'attachment-node',
          revisionId: 'attachment-revision',
        }),
      'INVALID_CONTENT',
    );
  });

  it('rejects unsupported graph versions from persisted input', () => {
    const graph = emptyGraph();
    const invalid = asGraph({ ...graph, version: 2 });
    expectGraphError(() => validateGraph(invalid), 'INVALID_GRAPH');
  });

  it('rejects unsupported node kinds and roles from persisted input', () => {
    const graph = addMessage(emptyGraph(), 'node-a', 1);
    const node = graph.nodes['node-a'];
    expect(node).toBeDefined();
    if (node === undefined) {
      throw new Error('Test fixture is missing node-a');
    }

    const invalidKind = asGraph({
      ...graph,
      nodes: { ...graph.nodes, 'node-a': { ...node, kind: 'unknown' } },
    });
    expectGraphError(() => validateGraph(invalidKind), 'INVALID_NODE');

    const invalidRole = asGraph({
      ...graph,
      nodes: { ...graph.nodes, 'node-a': { ...node, role: 'unknown' } },
    });
    expectGraphError(() => validateGraph(invalidRole), 'INVALID_NODE');
  });

  it('rejects invalid deletion timestamps, current revisions, and tags', () => {
    const graph = addMessage(emptyGraph(), 'node-a', 1);
    const node = graph.nodes['node-a'];
    expect(node).toBeDefined();
    if (node === undefined) {
      throw new Error('Test fixture is missing node-a');
    }

    const invalidDeletedAt = asGraph({
      ...graph,
      nodes: { ...graph.nodes, 'node-a': { ...node, deletedAt: 'yesterday' } },
    });
    expectGraphError(
      () => validateGraph(invalidDeletedAt),
      'INVALID_TIMESTAMP',
    );

    const invalidCurrentRevision = asGraph({
      ...graph,
      nodes: {
        ...graph.nodes,
        'node-a': { ...node, currentRevisionId: 'missing-revision' },
      },
    });
    expectGraphError(
      () => validateGraph(invalidCurrentRevision),
      'INVALID_NODE',
    );

    const invalidTags = asGraph({
      ...graph,
      nodes: { ...graph.nodes, 'node-a': { ...node, tags: ['x', 'x'] } },
    });
    expectGraphError(() => validateGraph(invalidTags), 'INVALID_NODE');

    const blankTag = asGraph({
      ...graph,
      nodes: { ...graph.nodes, 'node-a': { ...node, tags: [''] } },
    });
    expectGraphError(() => validateGraph(blankTag), 'INVALID_NODE');
  });

  it('rejects revision and edge record-key mismatches', () => {
    const graph = connectedGraph();
    const revision = graph.revisions['node-a-revision-1'];
    const edge = graph.edges['edge-ab'];
    expect(revision).toBeDefined();
    expect(edge).toBeDefined();
    if (revision === undefined || edge === undefined) {
      throw new Error('Test fixture is incomplete');
    }

    const invalidRevisionKey = asGraph({
      ...graph,
      revisions: { ...graph.revisions, wrong: revision },
    });
    expectGraphError(() => validateGraph(invalidRevisionKey), 'INVALID_GRAPH');

    const invalidEdgeKey = asGraph({
      ...graph,
      edges: { ...graph.edges, wrong: edge },
    });
    expectGraphError(() => validateGraph(invalidEdgeKey), 'INVALID_GRAPH');
  });

  it('rejects unsupported edge kinds and missing endpoints', () => {
    const graph = connectedGraph();
    const edge = graph.edges['edge-ab'];
    expect(edge).toBeDefined();
    if (edge === undefined) {
      throw new Error('Test fixture is missing edge-ab');
    }

    const invalidKind = asGraph({
      ...graph,
      edges: { 'edge-ab': { ...edge, kind: 'unknown' } },
    });
    expectGraphError(() => validateGraph(invalidKind), 'INVALID_EDGE');

    const missingEndpoint = asGraph({
      ...graph,
      edges: { 'edge-ab': { ...edge, targetNodeId: 'missing-node' } },
    });
    expectGraphError(() => validateGraph(missingEndpoint), 'NOT_FOUND');
  });

  it('rejects causal edges pinning absent and foreign revisions', () => {
    const graph = connectedGraph();
    const edge = graph.edges['edge-ab'];
    expect(edge).toBeDefined();
    if (edge?.kind !== 'context') {
      throw new Error('Test fixture is missing its context edge');
    }

    const missingRevision = asGraph({
      ...graph,
      edges: {
        'edge-ab': { ...edge, sourceRevisionId: 'missing-revision' },
      },
    });
    expectGraphError(() => validateGraph(missingRevision), 'INVALID_EDGE');

    const foreignRevision = asGraph({
      ...graph,
      edges: {
        'edge-ab': { ...edge, sourceRevisionId: 'node-b-revision-1' },
      },
    });
    expectGraphError(() => validateGraph(foreignRevision), 'INVALID_EDGE');
  });
});

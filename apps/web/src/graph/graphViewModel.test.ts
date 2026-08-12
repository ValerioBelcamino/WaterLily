import {
  connectContext,
  connectReference,
  createGraph,
  createNode,
  type GraphNode,
  type GraphSnapshot,
} from '@waterlily/domain';
import { describe, expect, it } from 'vitest';

import { sampleGraph } from '../sampleGraph';
import {
  contextThread,
  deriveActiveContextFlow,
  deriveDefaultPositions,
  nodeTitle,
  revisionText,
  toFlowEdges,
  toFlowNodes,
} from './graphViewModel';

function attachmentGraph(name: string | null): GraphSnapshot {
  const graph = createGraph({
    createdAt: '2026-08-05T00:00:00.000Z',
    graphId: `attachment-${name ?? 'unnamed'}`,
  });
  return createNode(graph, {
    blocks: [
      {
        attachmentId: 'asset-1',
        id: 'block-1',
        mediaType: 'application/pdf',
        name,
        type: 'attachment',
      },
    ],
    createdAt: '2026-08-05T00:00:01.000Z',
    kind: 'attachment',
    nodeId: 'node-attachment',
    revisionId: 'revision-attachment',
  });
}

describe('graph view model', () => {
  it('projects domain nodes without mixing canvas positions into the graph', () => {
    const positions = { 'node-answer': { x: 41, y: 73 } };
    const nodes = toFlowNodes(sampleGraph, {
      positions,
      selectedNodeIds: ['node-answer'],
    });
    const answer = nodes.find((node) => node.id === 'node-answer');

    expect(nodes).toHaveLength(7);
    expect(answer).toMatchObject({
      data: {
        flowState: 'idle',
        kind: 'message',
        role: 'assistant',
        title: 'Mechanism overview',
      },
      position: { x: 41, y: 73 },
      selected: true,
      type: 'conversation',
    });
    expect(sampleGraph.nodes['node-answer']).not.toHaveProperty('position');
  });

  it('projects multi-selection, explicit context choices, and movable groups', () => {
    const nodes = toFlowNodes(sampleGraph, {
      contextSelections: { 'node-answer': { mode: 'excluded' } },
      groups: [
        {
          collapsed: false,
          color: '#7669a8',
          id: 'group-review',
          nodeIds: ['node-answer', 'node-side-answer'],
          title: 'Review path',
        },
      ],
      selectedNodeIds: ['node-answer', 'node-side-answer'],
    });
    const group = nodes.find((node) => node.id === 'view-group:group-review');
    const answer = nodes.find((node) => node.id === 'node-answer');
    const sideAnswer = nodes.find((node) => node.id === 'node-side-answer');

    expect(group).toMatchObject({
      data: {
        color: '#7669a8',
        memberNodeIds: ['node-answer', 'node-side-answer'],
        title: 'Review path',
      },
      position: { x: 630, y: -48 },
      type: 'canvasGroup',
    });
    expect(answer).toMatchObject({
      data: { contextMode: 'excluded' },
      parentId: 'view-group:group-review',
      position: { x: 30, y: 48 },
      selected: true,
    });
    expect(sideAnswer).toMatchObject({
      data: { contextMode: 'full' },
      parentId: 'view-group:group-review',
      selected: true,
    });
  });

  it('ignores empty groups when projecting a filtered graph', () => {
    const nodes = toFlowNodes(sampleGraph, {
      groups: [
        {
          collapsed: false,
          color: '#123456',
          id: 'group-empty',
          nodeIds: ['missing'],
          title: 'Nothing here',
        },
      ],
    });
    expect(nodes).toHaveLength(7);
  });

  it('derives a stable left-to-right layout from context depth', () => {
    const first = deriveDefaultPositions(sampleGraph);
    const second = deriveDefaultPositions(sampleGraph);

    expect(second).toEqual(first);
    expect(first['node-system']).toEqual({ x: 0, y: 0 });
    expect(first['node-question']?.x).toBeGreaterThan(
      first['node-system']?.x ?? 0,
    );
    expect(first['node-synthesis']?.x).toBeGreaterThan(
      first['node-side-answer']?.x ?? 0,
    );
    expect(first['node-note']).toEqual({ x: 0, y: 210 });
  });

  it('visually distinguishes context, provenance, and reference edges', () => {
    const edges = toFlowEdges(sampleGraph);
    const context = edges.find((edge) => edge.id === 'edge-answer-synthesis');
    const provenance = edges.find((edge) => edge.id === 'edge-answer-note');
    const reference = edges.find((edge) => edge.id === 'edge-synthesis-note');

    expect(edges).toHaveLength(8);
    expect(context).toMatchObject({
      data: { kind: 'context' },
      label: 'context',
      style: { strokeDasharray: undefined, strokeWidth: 2.4 },
    });
    expect(provenance).toMatchObject({
      data: { kind: 'provenance' },
      label: 'derived',
      style: { strokeDasharray: '7 6', strokeWidth: 1.8 },
    });
    expect(reference).toMatchObject({
      data: { kind: 'reference' },
      label: 'uses analogy',
      style: { strokeDasharray: '2 7', strokeWidth: 1.8 },
    });
  });

  it('derives and projects the exact included generation flow', async () => {
    const activeFlow = await deriveActiveContextFlow(
      sampleGraph,
      [{ label: 'Synthesis', nodeId: 'node-synthesis', slot: 0 }],
      { 'node-answer': { mode: 'excluded' } },
    );

    expect(activeFlow).toEqual({
      edgeIds: [
        'edge-side-answer-synthesis',
        'edge-side-question-answer',
        'edge-system-question',
      ],
      nodeIds: [
        'node-question',
        'node-side-answer',
        'node-side-question',
        'node-synthesis',
        'node-system',
      ],
    });
    const nodes = toFlowNodes(sampleGraph, { activeFlow });
    expect(
      nodes.find((node) => node.id === 'node-synthesis')?.data,
    ).toMatchObject({ flowState: 'active' });
    expect(nodes.find((node) => node.id === 'node-answer')?.data).toMatchObject(
      {
        flowState: 'inactive',
      },
    );
    const edges = toFlowEdges(sampleGraph, activeFlow);
    expect(
      edges.find((edge) => edge.id === 'edge-system-question'),
    ).toMatchObject({
      animated: true,
      className: 'context-flow-edge context-flow-edge--active',
      data: { flowState: 'active' },
      style: { opacity: 1 },
    });
    expect(
      edges.find((edge) => edge.id === 'edge-answer-synthesis'),
    ).toMatchObject({
      animated: false,
      className: 'context-flow-edge context-flow-edge--inactive',
      data: { flowState: 'inactive' },
      style: { opacity: 0.16 },
    });
  });

  it('reconstructs a merge thread once and excludes non-context edges', () => {
    expect(contextThread(sampleGraph, 'node-synthesis')).toEqual([
      'node-system',
      'node-question',
      'node-answer',
      'node-side-question',
      'node-side-answer',
      'node-synthesis',
    ]);
    expect(contextThread(sampleGraph, 'missing')).toEqual([]);
  });

  it('renders attachment and fallback labels safely', () => {
    const named = attachmentGraph('paper.pdf');
    const unnamed = attachmentGraph(null);

    expect(revisionText(named, 'node-attachment')).toBe(
      '[Attachment: paper.pdf]',
    );
    expect(revisionText(unnamed, 'node-attachment')).toBe(
      '[Attachment: application/pdf]',
    );
    expect(nodeTitle(named, 'node-attachment')).toBe('Attachment');
    expect(nodeTitle(named, 'missing')).toBe('Unknown node');
    expect(revisionText(named, 'missing')).toBe('');
  });

  it('uses role titles, truncates long previews, and hides deleted nodes', () => {
    let graph = createGraph({
      createdAt: '2026-08-05T00:00:00.000Z',
      graphId: 'fallbacks',
    });
    graph = createNode(graph, {
      blocks: [
        {
          format: 'plain',
          id: 'block-long',
          text: 'x'.repeat(220),
          type: 'text',
        },
      ],
      createdAt: '2026-08-05T00:00:01.000Z',
      kind: 'message',
      nodeId: 'node-long',
      revisionId: 'revision-long',
      role: 'user',
    });
    const hiddenGraph: GraphSnapshot = {
      ...graph,
      nodes: {
        ...graph.nodes,
        'node-long': {
          ...(graph.nodes['node-long'] as GraphNode),
          deletedAt: '2026-08-05T00:00:02.000Z',
        },
      },
    };

    expect(nodeTitle(graph, 'node-long')).toBe('You message');
    expect(toFlowNodes(graph)[0]?.data.preview).toHaveLength(178);
    expect(toFlowNodes(graph)[0]?.data.preview).toMatch(/…$/);
    expect(toFlowNodes(hiddenGraph)).toEqual([]);
  });

  it('handles equal timestamps and default edge labels deterministically', () => {
    let graph = createGraph({
      createdAt: '2026-08-05T00:00:00.000Z',
      graphId: 'equal-times',
    });
    for (const id of ['node-b', 'node-a'] as const) {
      graph = createNode(graph, {
        blocks: [],
        createdAt: '2026-08-05T00:00:01.000Z',
        kind: 'note',
        nodeId: id,
        revisionId: `revision-${id}`,
      });
    }
    graph = connectContext(graph, {
      createdAt: '2026-08-05T00:00:02.000Z',
      edgeId: 'edge-context',
      label: 'prerequisite',
      slot: 0,
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
    });
    graph = connectReference(graph, {
      createdAt: '2026-08-05T00:00:02.000Z',
      edgeId: 'edge-reference',
      sourceNodeId: 'node-b',
      targetNodeId: 'node-a',
    });

    expect(toFlowNodes(graph).map((node) => node.id)).toEqual([
      'node-a',
      'node-b',
    ]);
    expect(toFlowEdges(graph).map((edge) => edge.label)).toEqual([
      'prerequisite',
      'reference',
    ]);
  });

  it('fails closed when a current revision is absent', () => {
    const graph = attachmentGraph('paper.pdf');
    const corrupt: GraphSnapshot = { ...graph, revisions: {} };
    expect(revisionText(corrupt, 'node-attachment')).toBe('');
  });
});

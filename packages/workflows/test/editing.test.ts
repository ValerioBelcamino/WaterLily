import { reviseNode, validateGraph } from '@waterlily/domain';
import { describe, expect, it } from 'vitest';

import {
  branchFromNode,
  createCheckpoint,
  mergeBranches,
  splitNode,
  WorkflowError,
} from '../src/index.js';
import { linearGraph, time } from './helpers.js';

const message = {
  blockId: 'block-follow-up',
  createdAt: time(5),
  nodeId: 'node-follow-up',
  revisionId: 'revision-follow-up',
  text: 'What drives the rotation?',
  title: 'Follow-up',
} as const;

describe('editing workflows', () => {
  it('creates a persistent summary checkpoint with provenance-only sources', () => {
    const graph = createCheckpoint({
      graph: linearGraph(),
      provenanceEdgeIds: ['edge-summary-source'],
      sources: [{ nodeId: 'node-user', revisionId: 'revision-user' }],
      summary: {
        blockId: 'block-checkpoint',
        createdAt: time(5),
        nodeId: 'node-checkpoint',
        revisionId: 'revision-checkpoint',
        text: 'ATP formation depends on a proton gradient.',
        title: 'Energy checkpoint',
      },
    });

    expect(graph.nodes['node-checkpoint']).toMatchObject({
      kind: 'summary',
      title: 'Energy checkpoint',
    });
    expect(graph.revisions['revision-checkpoint']).toMatchObject({
      blocks: [
        {
          template: { bindings: [], version: 1 },
          text: 'ATP formation depends on a proton gradient.',
        },
      ],
      metadata: { checkpoint: { sourceCount: 1, version: 1 } },
    });
    expect(graph.edges['edge-summary-source']).toMatchObject({
      kind: 'provenance',
      relation: 'summarized',
      sourceRevisionId: 'revision-user',
      targetNodeId: 'node-checkpoint',
    });
    expect(
      Object.values(graph.edges).filter(
        (edge) =>
          edge.kind === 'context' && edge.targetNodeId === 'node-checkpoint',
      ),
    ).toEqual([]);
  });

  it.each([
    { edgeIds: [], sources: [], text: 'Summary' },
    {
      edgeIds: [],
      sources: [{ nodeId: 'node-user' }],
      text: 'Summary',
    },
    {
      edgeIds: ['a', 'b'],
      sources: [{ nodeId: 'node-user' }, { nodeId: 'node-user' }],
      text: 'Summary',
    },
    {
      edgeIds: ['a'],
      sources: [{ nodeId: 'node-user' }],
      text: '   ',
    },
  ])('rejects invalid checkpoints %#', ({ edgeIds, sources, text }) => {
    expect(() =>
      createCheckpoint({
        graph: linearGraph(),
        provenanceEdgeIds: edgeIds,
        sources,
        summary: { ...message, text },
      }),
    ).toThrow(WorkflowError);
  });

  it('branches from an explicitly pinned historical revision', () => {
    const original = linearGraph();
    const revised = reviseNode(original, {
      blocks: [
        { format: 'plain', id: 'block-user-2', text: 'Changed', type: 'text' },
      ],
      createdAt: time(4),
      nodeId: 'node-user',
      revisionId: 'revision-user-2',
    });
    const branched = branchFromNode({
      edgeId: 'edge-user-follow-up',
      graph: revised,
      message,
      parentNodeId: 'node-user',
      parentRevisionId: 'revision-user',
    });

    expect(branched.nodes['node-follow-up']).toMatchObject({
      kind: 'message',
      role: 'user',
      title: 'Follow-up',
    });
    expect(branched.edges['edge-user-follow-up']).toMatchObject({
      kind: 'context',
      slot: 0,
      sourceRevisionId: 'revision-user',
    });
    expect(original.nodes['node-follow-up']).toBeUndefined();
  });

  it('merges distinct heads in caller order with labels', () => {
    const graph = branchFromNode({
      edgeId: 'edge-user-follow-up',
      graph: linearGraph(),
      message,
      parentNodeId: 'node-user',
    });
    const merged = mergeBranches({
      edgeIds: ['edge-user-merge', 'edge-follow-up-merge'],
      graph,
      heads: [
        { nodeId: 'node-user', revisionId: 'revision-user' },
        { label: 'Side question', nodeId: 'node-follow-up' },
      ],
      message: {
        blockId: 'block-merge',
        createdAt: time(6),
        nodeId: 'node-merge',
        revisionId: 'revision-merge',
        text: 'Combine both lines of thought.',
      },
    });

    expect(merged.edges['edge-user-merge']).toMatchObject({
      label: null,
      slot: 0,
      sourceRevisionId: 'revision-user',
      targetNodeId: 'node-merge',
    });
    expect(merged.edges['edge-follow-up-merge']).toMatchObject({
      label: 'Side question',
      slot: 1,
    });
    expect(() => validateGraph(merged)).not.toThrow();
  });

  it.each([
    { edgeIds: [], heads: [{ nodeId: 'node-user' }] },
    {
      edgeIds: ['edge-1'],
      heads: [{ nodeId: 'node-system' }, { nodeId: 'node-user' }],
    },
    {
      edgeIds: ['edge-1', 'edge-2'],
      heads: [{ nodeId: 'node-user' }, { nodeId: 'node-user' }],
    },
  ])('rejects invalid merge inputs %#', ({ edgeIds, heads }) => {
    expect(() =>
      mergeBranches({ edgeIds, graph: linearGraph(), heads, message }),
    ).toThrow(WorkflowError);
  });

  it('splits verbatim content with inherited ancestry and pinned provenance', () => {
    const original = linearGraph();
    const result = splitNode({
      createdAt: time(4),
      graph: original,
      parts: [
        {
          blockId: 'block-part-a',
          contextEdgeIds: ['edge-context-part-a'],
          nodeId: 'node-part-a',
          provenanceEdgeId: 'edge-part-a',
          revisionId: 'revision-part-a',
          sourceBlockIds: ['block-user'],
          text: 'Explain',
          title: 'Prompt verb',
        },
        {
          blockId: 'block-part-b',
          contextEdgeIds: ['edge-context-part-b'],
          nodeId: 'node-part-b',
          provenanceEdgeId: 'edge-part-b',
          revisionId: 'revision-part-b',
          sourceBlockIds: ['block-user'],
          text: 'ATP',
        },
      ],
      sourceNodeId: 'node-user',
      sourceRevisionId: 'revision-user',
    });

    expect(result.nodeIds).toEqual(['node-part-a', 'node-part-b']);
    expect(result.graph.nodes['node-part-a']).toMatchObject({
      kind: 'excerpt',
      role: null,
    });
    expect(result.graph.revisions['revision-part-a']?.metadata).toEqual({
      sourceBlockIds: ['block-user'],
      splitIndex: 0,
    });
    expect(result.graph.edges['edge-part-b']).toMatchObject({
      kind: 'provenance',
      relation: 'excerpted',
      sourceRevisionId: 'revision-user',
    });
    expect(result.graph.edges['edge-context-part-a']).toMatchObject({
      kind: 'context',
      sourceNodeId: 'node-system',
      sourceRevisionId: 'revision-system',
      targetNodeId: 'node-part-a',
    });
    expect(
      Object.values(result.graph.edges).filter(
        (edge) => edge.kind === 'context' && edge.sourceNodeId === 'node-user',
      ),
    ).toEqual([]);
    expect(original.nodes['node-part-a']).toBeUndefined();
  });

  it('preserves the ordered context of a split merge node', () => {
    const branched = branchFromNode({
      edgeId: 'edge-user-follow-up',
      graph: linearGraph(),
      message,
      parentNodeId: 'node-user',
    });
    const merged = mergeBranches({
      edgeIds: ['edge-user-merge', 'edge-follow-up-merge'],
      graph: branched,
      heads: [
        { label: 'Original', nodeId: 'node-user' },
        { label: 'Follow-up', nodeId: 'node-follow-up' },
      ],
      message: {
        blockId: 'block-merge',
        createdAt: time(6),
        nodeId: 'node-merge',
        revisionId: 'revision-merge',
        text: 'Combine both lines of thought.',
      },
    });
    const result = splitNode({
      createdAt: time(7),
      graph: merged,
      parts: [
        {
          blockId: 'block-merge-a',
          contextEdgeIds: ['edge-merge-a-0', 'edge-merge-a-1'],
          nodeId: 'node-merge-a',
          provenanceEdgeId: 'provenance-merge-a',
          revisionId: 'revision-merge-a',
          sourceBlockIds: ['block-merge'],
          text: 'Combine',
        },
        {
          blockId: 'block-merge-b',
          contextEdgeIds: ['edge-merge-b-0', 'edge-merge-b-1'],
          nodeId: 'node-merge-b',
          provenanceEdgeId: 'provenance-merge-b',
          revisionId: 'revision-merge-b',
          sourceBlockIds: ['block-merge'],
          text: 'both lines of thought.',
        },
      ],
      sourceNodeId: 'node-merge',
    });

    expect(result.graph.edges['edge-merge-a-0']).toMatchObject({
      label: 'Original',
      slot: 0,
      sourceNodeId: 'node-user',
    });
    expect(result.graph.edges['edge-merge-a-1']).toMatchObject({
      label: 'Follow-up',
      slot: 1,
      sourceNodeId: 'node-follow-up',
    });
  });

  it.each([
    { parts: [], sourceNodeId: 'node-user', sourceRevisionId: undefined },
    {
      parts: [
        {
          blockId: 'a',
          contextEdgeIds: ['ca'],
          nodeId: 'a',
          provenanceEdgeId: 'pa',
          revisionId: 'ra',
          sourceBlockIds: ['block-user'],
          text: 'a',
        },
        {
          blockId: 'b',
          contextEdgeIds: ['cb'],
          nodeId: 'b',
          provenanceEdgeId: 'pb',
          revisionId: 'rb',
          sourceBlockIds: [],
          text: 'b',
        },
      ],
      sourceNodeId: 'node-user',
      sourceRevisionId: undefined,
    },
    {
      parts: [
        {
          blockId: 'a',
          contextEdgeIds: ['ca'],
          nodeId: 'a',
          provenanceEdgeId: 'pa',
          revisionId: 'ra',
          sourceBlockIds: ['missing-block'],
          text: 'a',
        },
        {
          blockId: 'b',
          contextEdgeIds: ['cb'],
          nodeId: 'b',
          provenanceEdgeId: 'pb',
          revisionId: 'rb',
          sourceBlockIds: ['block-user'],
          text: 'b',
        },
      ],
      sourceNodeId: 'node-user',
      sourceRevisionId: undefined,
    },
    { parts: [], sourceNodeId: 'missing', sourceRevisionId: undefined },
    {
      parts: [],
      sourceNodeId: 'node-user',
      sourceRevisionId: 'revision-system',
    },
  ])(
    'rejects invalid split inputs %#',
    ({ parts, sourceNodeId, sourceRevisionId }) => {
      expect(() =>
        splitNode({
          createdAt: time(8),
          graph: linearGraph(),
          parts,
          sourceNodeId,
          ...(sourceRevisionId === undefined ? {} : { sourceRevisionId }),
        }),
      ).toThrow(WorkflowError);
    },
  );

  it.each([
    {
      contextEdgeIds: [],
      sourceBlockIds: ['block-user'],
      text: 'Explain',
    },
    {
      contextEdgeIds: ['context-a'],
      sourceBlockIds: ['block-user', 'block-user'],
      text: 'Explain',
    },
    {
      contextEdgeIds: ['context-a'],
      sourceBlockIds: ['block-user'],
      text: 'A fabricated paraphrase',
    },
  ])(
    'rejects an unsafe excerpt definition %#',
    ({ contextEdgeIds, sourceBlockIds, text }) => {
      expect(() =>
        splitNode({
          createdAt: time(8),
          graph: linearGraph(),
          parts: [
            {
              blockId: 'a',
              contextEdgeIds,
              nodeId: 'a',
              provenanceEdgeId: 'pa',
              revisionId: 'ra',
              sourceBlockIds,
              text,
            },
            {
              blockId: 'b',
              contextEdgeIds: ['context-b'],
              nodeId: 'b',
              provenanceEdgeId: 'pb',
              revisionId: 'rb',
              sourceBlockIds: ['block-user'],
              text: 'ATP',
            },
          ],
          sourceNodeId: 'node-user',
        }),
      ).toThrow(WorkflowError);
    },
  );
});

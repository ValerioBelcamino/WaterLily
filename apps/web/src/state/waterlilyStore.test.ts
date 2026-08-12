import { compileContext } from '@waterlily/context-engine';
import { createGraphDocument } from '@waterlily/interchange';
import { beforeEach, describe, expect, it } from 'vitest';

import { sampleGraph } from '../sampleGraph';
import { useWaterLilyStore } from './waterlilyStore';

const CREATED_AT = '2026-08-05T14:00:00.000Z';

describe('WaterLily store', () => {
  beforeEach(() => {
    useWaterLilyStore.getState().reset();
  });

  it('keeps selection, view mode, and geometry as presentation state', () => {
    useWaterLilyStore.getState().selectNode('node-answer');
    useWaterLilyStore.getState().setViewMode('focus');
    useWaterLilyStore.getState().setPosition('node-answer', { x: 12, y: 34 });
    useWaterLilyStore.getState().setPositions({
      'node-note': { x: 50, y: 80 },
    });

    expect(useWaterLilyStore.getState()).toMatchObject({
      positions: {
        'node-answer': { x: 12, y: 34 },
        'node-note': { x: 50, y: 80 },
      },
      selectedNodeId: 'node-answer',
      selectedNodeIds: ['node-answer'],
      viewMode: 'focus',
    });
    expect(
      useWaterLilyStore.getState().graph.nodes['node-answer'],
    ).not.toHaveProperty('position');
  });

  it('adds and removes nodes from an ordered additive selection', () => {
    useWaterLilyStore.getState().selectNode('node-answer');
    useWaterLilyStore.getState().selectNode('node-side-answer', true);
    expect(useWaterLilyStore.getState().selectedNodeIds).toEqual([
      'node-answer',
      'node-side-answer',
    ]);

    useWaterLilyStore.getState().selectNode('node-side-answer', true);
    expect(useWaterLilyStore.getState()).toMatchObject({
      selectedNodeId: 'node-answer',
      selectedNodeIds: ['node-answer'],
    });
    useWaterLilyStore.getState().selectNode('node-answer', true);
    expect(useWaterLilyStore.getState()).toMatchObject({
      selectedNodeId: null,
      selectedNodeIds: [],
    });
  });

  it('branches from and pins the selected parent revision', () => {
    useWaterLilyStore.getState().branch({
      edgeId: 'edge-test-branch',
      message: {
        blockId: 'block-test-branch',
        createdAt: CREATED_AT,
        nodeId: 'node-test-branch',
        revisionId: 'revision-test-branch',
        text: 'What if complex IV is inhibited?',
        title: 'Inhibition branch',
      },
      parentNodeId: 'node-answer',
    });

    const state = useWaterLilyStore.getState();
    expect(state.graph.nodes['node-test-branch']).toMatchObject({
      role: 'user',
      title: 'Inhibition branch',
    });
    expect(state.graph.edges['edge-test-branch']).toMatchObject({
      kind: 'context',
      sourceNodeId: 'node-answer',
      sourceRevisionId: 'revision-node-answer',
      targetNodeId: 'node-test-branch',
    });
    expect(state.selectedNodeIds).toEqual(['node-test-branch']);
  });

  it('adds dropped text files as ordered context for the selected target', async () => {
    useWaterLilyStore.getState().addFileContexts({
      createdAt: CREATED_AT,
      files: [
        {
          blockId: 'block-file-a',
          edgeId: 'edge-file-a',
          file: {
            lastModified: 10,
            mediaType: 'text/markdown',
            name: 'lecture.md',
            size: 12,
            text: 'Lecture text',
          },
          nodeId: 'node-file-a',
          position: { x: 90, y: 120 },
          revisionId: 'revision-file-a',
        },
        {
          blockId: 'block-file-b',
          edgeId: 'edge-file-b',
          file: {
            lastModified: 20,
            mediaType: 'application/json',
            name: 'facts.json',
            size: 14,
            text: '{"fact":true}',
          },
          nodeId: 'node-file-b',
          position: { x: 90, y: 300 },
          revisionId: 'revision-file-b',
        },
      ],
      targetNodeId: 'node-synthesis',
    });

    const state = useWaterLilyStore.getState();
    expect(state.graph.nodes['node-file-a']).toMatchObject({
      kind: 'attachment',
      role: null,
      title: 'lecture.md',
    });
    expect(state.graph.revisions['revision-file-a']).toMatchObject({
      blocks: [
        {
          format: 'plain',
          id: 'block-file-a',
          text: 'Lecture text',
          type: 'text',
        },
      ],
      metadata: {
        file: {
          lastModified: 10,
          mediaType: 'text/markdown',
          name: 'lecture.md',
          size: 12,
          source: 'drop',
        },
      },
    });
    expect(state.graph.edges['edge-file-a']).toMatchObject({
      kind: 'context',
      slot: 2,
      sourceNodeId: 'node-file-a',
      targetNodeId: 'node-synthesis',
    });
    expect(state.graph.edges['edge-file-b']).toMatchObject({ slot: 3 });
    expect(state.positions).toMatchObject({
      'node-file-a': { x: 90, y: 120 },
      'node-file-b': { x: 90, y: 300 },
    });
    expect(state.selectedNodeIds).toEqual(['node-synthesis']);
    const compiled = await compileContext({
      graph: state.graph,
      heads: [{ label: 'Active branch', nodeId: 'node-synthesis', slot: 0 }],
    });
    expect(
      [
        ...compiled.common.items,
        ...compiled.branches.flatMap((part) => part.items),
      ]
        .filter((item) => item.nodeKind === 'attachment')
        .map((item) => item.blocks[0]),
    ).toEqual([
      {
        format: 'plain',
        id: 'block-file-a',
        text: 'Lecture text',
        type: 'text',
      },
      {
        format: 'plain',
        id: 'block-file-b',
        text: '{"fact":true}',
        type: 'text',
      },
    ]);
  });

  it('creates standalone file context and rejects invalid batches atomically', () => {
    const standalone = {
      blockId: 'block-standalone-file',
      edgeId: null,
      file: {
        lastModified: 10,
        mediaType: 'text/plain',
        name: 'standalone.txt',
        size: 4,
        text: 'text',
      },
      nodeId: 'node-standalone-file',
      position: { x: 1, y: 2 },
      revisionId: 'revision-standalone-file',
    } as const;
    useWaterLilyStore.getState().addFileContexts({
      createdAt: CREATED_AT,
      files: [standalone],
      targetNodeId: null,
    });
    expect(useWaterLilyStore.getState()).toMatchObject({
      selectedNodeId: 'node-standalone-file',
      selectedNodeIds: ['node-standalone-file'],
    });

    const graphBeforeFailure = useWaterLilyStore.getState().graph;
    expect(() =>
      useWaterLilyStore.getState().addFileContexts({
        createdAt: CREATED_AT,
        files: [],
        targetNodeId: null,
      }),
    ).toThrow('At least one');
    expect(() =>
      useWaterLilyStore.getState().addFileContexts({
        createdAt: CREATED_AT,
        files: [{ ...standalone, nodeId: 'another-node' }],
        targetNodeId: 'missing-node',
      }),
    ).toThrow('target does not exist');
    expect(() =>
      useWaterLilyStore.getState().addFileContexts({
        createdAt: CREATED_AT,
        files: [
          {
            ...standalone,
            blockId: 'block-new-file',
            nodeId: 'node-new-file',
            revisionId: 'revision-new-file',
          },
          standalone,
        ],
        targetNodeId: null,
      }),
    ).toThrow();
    expect(useWaterLilyStore.getState().graph).toBe(graphBeforeFailure);
    expect(() =>
      useWaterLilyStore.getState().addFileContexts({
        createdAt: CREATED_AT,
        files: [{ ...standalone, edgeId: null, nodeId: 'node-connected-file' }],
        targetNodeId: 'node-answer',
      }),
    ).toThrow('requires an edge ID');
  });

  it('merges ordered heads and selects the new merge node', () => {
    useWaterLilyStore.getState().merge({
      edgeIds: ['edge-test-merge-a', 'edge-test-merge-b'],
      heads: [
        { label: 'Overview', nodeId: 'node-answer' },
        { label: 'Side path', nodeId: 'node-side-answer' },
      ],
      message: {
        blockId: 'block-test-merge',
        createdAt: CREATED_AT,
        nodeId: 'node-test-merge',
        revisionId: 'revision-test-merge',
        text: 'Reconcile these explanations.',
      },
    });

    const state = useWaterLilyStore.getState();
    expect(state.graph.edges['edge-test-merge-a']).toMatchObject({ slot: 0 });
    expect(state.graph.edges['edge-test-merge-b']).toMatchObject({ slot: 1 });
    expect(state.selectedNodeIds).toEqual(['node-test-merge']);
  });

  it('splits a revision into independently selected provenance roots', () => {
    useWaterLilyStore.getState().split({
      createdAt: CREATED_AT,
      parts: [
        {
          blockId: 'block-split-a',
          contextEdgeIds: ['edge-split-context-a'],
          nodeId: 'node-split-a',
          provenanceEdgeId: 'edge-split-a',
          revisionId: 'revision-split-a',
          sourceBlockIds: ['block-node-answer'],
          text: 'electron transport chain pumps protons',
        },
        {
          blockId: 'block-split-b',
          contextEdgeIds: ['edge-split-context-b'],
          nodeId: 'node-split-b',
          provenanceEdgeId: 'edge-split-b',
          revisionId: 'revision-split-b',
          sourceBlockIds: ['block-node-answer'],
          text: 'ATP synthase drives rotation',
        },
      ],
      sourceNodeId: 'node-answer',
    });

    const state = useWaterLilyStore.getState();
    expect(state.selectedNodeIds).toEqual(['node-split-a', 'node-split-b']);
    expect(state.graph.nodes['node-split-a']).toMatchObject({
      kind: 'excerpt',
    });
    expect(state.graph.edges['edge-split-a']).toMatchObject({
      kind: 'provenance',
      relation: 'excerpted',
      sourceRevisionId: 'revision-node-answer',
    });
    expect(state.graph.edges['edge-split-context-a']).toMatchObject({
      kind: 'context',
      sourceNodeId: 'node-question',
      targetNodeId: 'node-split-a',
    });
  });

  it('stores explicit context decisions and validates presentation groups', () => {
    useWaterLilyStore
      .getState()
      .setContextSelection('node-answer', { mode: 'excluded' });
    useWaterLilyStore.getState().toggleContext('node-answer');
    useWaterLilyStore.getState().toggleContext('node-note');
    useWaterLilyStore.getState().addGroup({
      collapsed: false,
      color: '#547a68',
      id: 'group-study',
      nodeIds: ['node-answer', 'node-note'],
      title: 'Study set',
    });

    expect(useWaterLilyStore.getState().contextSelections).toEqual({
      'node-answer': { mode: 'full' },
      'node-note': { mode: 'excluded' },
    });
    expect(useWaterLilyStore.getState().groups[0]).toMatchObject({
      nodeIds: ['node-answer', 'node-note'],
      title: 'Study set',
    });
    expect(() =>
      useWaterLilyStore.getState().addGroup({
        collapsed: false,
        color: 'purple',
        id: 'group-invalid',
        nodeIds: ['node-answer'],
        title: '',
      }),
    ).toThrow('canvas group is invalid');
    expect(() =>
      useWaterLilyStore.getState().addGroup({
        collapsed: false,
        color: '#123456',
        id: 'group-overlap',
        nodeIds: ['node-answer'],
        title: 'Overlap',
      }),
    ).toThrow('canvas group is invalid');
  });

  it('remaps and merges an imported graph document with its view', () => {
    const document = createGraphDocument({
      exportedAt: CREATED_AT,
      exporter: { name: 'Test', version: '1' },
      graph: sampleGraph,
      view: {
        groups: [
          {
            collapsed: false,
            color: '#58779a',
            id: 'source-group',
            nodeIds: ['node-answer'],
            title: 'Imported path',
          },
        ],
        positions: { 'node-answer': { x: 12, y: 34 } },
      },
    });
    useWaterLilyStore
      .getState()
      .mergeDocument(document, (kind, originalId) =>
        kind === 'graph' ? 'import-graph' : `import-${kind}-${originalId}`,
      );

    const state = useWaterLilyStore.getState();
    expect(Object.keys(state.graph.nodes)).toHaveLength(14);
    expect(state.positions['import-node-node-answer']).toEqual({
      x: 12,
      y: 34,
    });
    expect(state.groups[0]).toMatchObject({
      id: 'import-group-source-group',
      nodeIds: ['import-node-node-answer'],
    });
    expect(state.selectedNodeId).toMatch(/^import-node-/u);
  });

  it('replaces persisted workspace state while preserving a valid selection', () => {
    useWaterLilyStore.getState().selectNode('node-answer');
    useWaterLilyStore.getState().replaceWorkspace({
      graph: sampleGraph,
      state: {
        contextSelections: { 'node-note': { mode: 'excluded' } },
        version: 1,
        view: {
          groups: [],
          positions: { 'node-answer': { x: 7, y: 9 } },
        },
      },
    });

    expect(useWaterLilyStore.getState()).toMatchObject({
      contextSelections: { 'node-note': { mode: 'excluded' } },
      positions: { 'node-answer': { x: 7, y: 9 } },
      selectedNodeId: 'node-answer',
      selectedNodeIds: ['node-answer'],
    });
  });

  it('resets graph and UI state without retaining mutated references', () => {
    useWaterLilyStore.getState().setPosition('node-answer', { x: 12, y: 34 });
    useWaterLilyStore.getState().selectNode(null);
    useWaterLilyStore.getState().branch({
      edgeId: 'edge-reset',
      message: {
        blockId: 'block-reset',
        createdAt: CREATED_AT,
        nodeId: 'node-reset',
        revisionId: 'revision-reset',
        text: 'Temporary',
      },
      parentNodeId: 'node-answer',
    });
    useWaterLilyStore.getState().reset();

    expect(useWaterLilyStore.getState()).toMatchObject({
      positions: {},
      selectedNodeId: 'node-synthesis',
      selectedNodeIds: ['node-synthesis'],
      viewMode: 'canvas',
    });
    expect(
      useWaterLilyStore.getState().graph.nodes['node-reset'],
    ).toBeUndefined();
  });
});

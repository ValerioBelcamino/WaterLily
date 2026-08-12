import { createGraphDocument } from '@llm-graph/interchange';
import { beforeEach, describe, expect, it } from 'vitest';

import { sampleGraph } from '../sampleGraph';
import { useWorkbenchStore } from './workbenchStore';

const CREATED_AT = '2026-08-05T14:00:00.000Z';

describe('workbench store', () => {
  beforeEach(() => {
    useWorkbenchStore.getState().reset();
  });

  it('keeps selection, view mode, and geometry as presentation state', () => {
    useWorkbenchStore.getState().selectNode('node-answer');
    useWorkbenchStore.getState().setViewMode('focus');
    useWorkbenchStore.getState().setPosition('node-answer', { x: 12, y: 34 });
    useWorkbenchStore.getState().setPositions({
      'node-note': { x: 50, y: 80 },
    });

    expect(useWorkbenchStore.getState()).toMatchObject({
      positions: {
        'node-answer': { x: 12, y: 34 },
        'node-note': { x: 50, y: 80 },
      },
      selectedNodeId: 'node-answer',
      selectedNodeIds: ['node-answer'],
      viewMode: 'focus',
    });
    expect(
      useWorkbenchStore.getState().graph.nodes['node-answer'],
    ).not.toHaveProperty('position');
  });

  it('adds and removes nodes from an ordered additive selection', () => {
    useWorkbenchStore.getState().selectNode('node-answer');
    useWorkbenchStore.getState().selectNode('node-side-answer', true);
    expect(useWorkbenchStore.getState().selectedNodeIds).toEqual([
      'node-answer',
      'node-side-answer',
    ]);

    useWorkbenchStore.getState().selectNode('node-side-answer', true);
    expect(useWorkbenchStore.getState()).toMatchObject({
      selectedNodeId: 'node-answer',
      selectedNodeIds: ['node-answer'],
    });
    useWorkbenchStore.getState().selectNode('node-answer', true);
    expect(useWorkbenchStore.getState()).toMatchObject({
      selectedNodeId: null,
      selectedNodeIds: [],
    });
  });

  it('branches from and pins the selected parent revision', () => {
    useWorkbenchStore.getState().branch({
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

    const state = useWorkbenchStore.getState();
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

  it('merges ordered heads and selects the new merge node', () => {
    useWorkbenchStore.getState().merge({
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

    const state = useWorkbenchStore.getState();
    expect(state.graph.edges['edge-test-merge-a']).toMatchObject({ slot: 0 });
    expect(state.graph.edges['edge-test-merge-b']).toMatchObject({ slot: 1 });
    expect(state.selectedNodeIds).toEqual(['node-test-merge']);
  });

  it('splits a revision into independently selected provenance roots', () => {
    useWorkbenchStore.getState().split({
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

    const state = useWorkbenchStore.getState();
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
    useWorkbenchStore
      .getState()
      .setContextSelection('node-answer', { mode: 'excluded' });
    useWorkbenchStore.getState().toggleContext('node-answer');
    useWorkbenchStore.getState().toggleContext('node-note');
    useWorkbenchStore.getState().addGroup({
      collapsed: false,
      color: '#547a68',
      id: 'group-study',
      nodeIds: ['node-answer', 'node-note'],
      title: 'Study set',
    });

    expect(useWorkbenchStore.getState().contextSelections).toEqual({
      'node-answer': { mode: 'full' },
      'node-note': { mode: 'excluded' },
    });
    expect(useWorkbenchStore.getState().groups[0]).toMatchObject({
      nodeIds: ['node-answer', 'node-note'],
      title: 'Study set',
    });
    expect(() =>
      useWorkbenchStore.getState().addGroup({
        collapsed: false,
        color: 'purple',
        id: 'group-invalid',
        nodeIds: ['node-answer'],
        title: '',
      }),
    ).toThrow('canvas group is invalid');
    expect(() =>
      useWorkbenchStore.getState().addGroup({
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
    useWorkbenchStore
      .getState()
      .mergeDocument(document, (kind, originalId) =>
        kind === 'graph' ? 'import-graph' : `import-${kind}-${originalId}`,
      );

    const state = useWorkbenchStore.getState();
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
    useWorkbenchStore.getState().selectNode('node-answer');
    useWorkbenchStore.getState().replaceWorkspace({
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

    expect(useWorkbenchStore.getState()).toMatchObject({
      contextSelections: { 'node-note': { mode: 'excluded' } },
      positions: { 'node-answer': { x: 7, y: 9 } },
      selectedNodeId: 'node-answer',
      selectedNodeIds: ['node-answer'],
    });
  });

  it('resets graph and UI state without retaining mutated references', () => {
    useWorkbenchStore.getState().setPosition('node-answer', { x: 12, y: 34 });
    useWorkbenchStore.getState().selectNode(null);
    useWorkbenchStore.getState().branch({
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
    useWorkbenchStore.getState().reset();

    expect(useWorkbenchStore.getState()).toMatchObject({
      positions: {},
      selectedNodeId: 'node-synthesis',
      selectedNodeIds: ['node-synthesis'],
      viewMode: 'canvas',
    });
    expect(
      useWorkbenchStore.getState().graph.nodes['node-reset'],
    ).toBeUndefined();
  });
});

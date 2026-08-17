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
          attachment: {
            id: 'attachment-file-a',
            mediaType: 'text/markdown',
            name: 'lecture.md',
            sha256: 'a'.repeat(64),
            size: 12,
          },
          blockId: 'block-file-a',
          edgeId: 'edge-file-a',
          file: {
            lastModified: 10,
            mediaType: 'text/markdown',
            name: 'lecture.md',
            size: 12,
            file: new File(['Lecture text'], 'lecture.md', {
              type: 'text/markdown',
            }),
          },
          nodeId: 'node-file-a',
          position: { x: 90, y: 120 },
          revisionId: 'revision-file-a',
        },
        {
          attachment: {
            id: 'attachment-file-b',
            mediaType: 'application/json',
            name: 'facts.json',
            sha256: 'b'.repeat(64),
            size: 14,
          },
          blockId: 'block-file-b',
          edgeId: 'edge-file-b',
          file: {
            lastModified: 20,
            mediaType: 'application/json',
            name: 'facts.json',
            size: 14,
            file: new File(['{"fact":true}'], 'facts.json', {
              type: 'application/json',
            }),
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
          attachmentId: 'attachment-file-a',
          id: 'block-file-a',
          mediaType: 'text/markdown',
          name: 'lecture.md',
          type: 'attachment',
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
        attachmentId: 'attachment-file-a',
        id: 'block-file-a',
        mediaType: 'text/markdown',
        name: 'lecture.md',
        type: 'attachment',
      },
      {
        attachmentId: 'attachment-file-b',
        id: 'block-file-b',
        mediaType: 'application/json',
        name: 'facts.json',
        type: 'attachment',
      },
    ]);
  });

  it('creates standalone file context and rejects invalid batches atomically', () => {
    const standalone = {
      attachment: {
        id: 'attachment-standalone-file',
        mediaType: 'text/plain',
        name: 'standalone.txt',
        sha256: 'c'.repeat(64),
        size: 4,
      },
      blockId: 'block-standalone-file',
      edgeId: null,
      file: {
        lastModified: 10,
        mediaType: 'text/plain',
        name: 'standalone.txt',
        size: 4,
        file: new File(['text'], 'standalone.txt', { type: 'text/plain' }),
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

  it('adds Python cells and execution outputs as notebook context', () => {
    useWaterLilyStore.getState().addCodeCell({
      blockId: 'block-code',
      createdAt: CREATED_AT,
      edgeId: 'edge-code',
      nodeId: 'node-code',
      parentNodeId: 'node-answer',
      revisionId: 'revision-code',
      source: 'value = 40\nprint(value + 2)',
      title: 'Calculate answer',
    });
    let state = useWaterLilyStore.getState();
    expect(state.graph.nodes['node-code']).toMatchObject({
      kind: 'code',
      title: 'Calculate answer',
    });
    expect(state.graph.revisions['revision-code']).toMatchObject({
      blocks: [{ text: 'value = 40\nprint(value + 2)' }],
      metadata: { code: { language: 'python' } },
    });
    expect(state.graph.edges['edge-code']).toMatchObject({
      label: 'notebook state',
      sourceNodeId: 'node-answer',
      targetNodeId: 'node-code',
    });

    useWaterLilyStore.getState().addExecutionResult({
      blockId: 'block-output',
      codeNodeId: 'node-code',
      createdAt: '2026-08-05T14:00:01.000Z',
      durationMilliseconds: 8,
      edgeId: 'edge-output',
      exitCode: 0,
      nodeId: 'node-output',
      output: '42',
      revisionId: 'revision-output',
      timedOut: false,
      truncated: false,
    });
    state = useWaterLilyStore.getState();
    expect(state.graph.nodes['node-output']).toMatchObject({
      kind: 'execution',
      title: 'Python output',
    });
    expect(state.graph.revisions['revision-output']?.metadata).toEqual({
      execution: {
        durationMilliseconds: 8,
        exitCode: 0,
        language: 'python',
        timedOut: false,
        truncated: false,
      },
    });
    expect(state.graph.edges['edge-output']).toMatchObject({
      label: 'execution output',
      sourceNodeId: 'node-code',
      targetNodeId: 'node-output',
    });
    expect(state.selectedNodeId).toBe('node-output');
  });

  it('supports root cells and rejects invalid notebook relationships', () => {
    useWaterLilyStore.getState().addCodeCell({
      blockId: 'block-root-code',
      createdAt: CREATED_AT,
      edgeId: null,
      nodeId: 'node-root-code',
      parentNodeId: null,
      revisionId: 'revision-root-code',
      source: 'print("root")',
      title: null,
    });
    expect(
      useWaterLilyStore.getState().graph.nodes['node-root-code'],
    ).toMatchObject({
      title: 'Python cell',
    });
    expect(() =>
      useWaterLilyStore.getState().addCodeCell({
        blockId: 'block-missing-parent',
        createdAt: CREATED_AT,
        edgeId: 'edge-missing-parent',
        nodeId: 'node-missing-parent',
        parentNodeId: 'missing',
        revisionId: 'revision-missing-parent',
        source: 'x = 1',
        title: null,
      }),
    ).toThrow('parent does not exist');
    expect(() =>
      useWaterLilyStore.getState().addCodeCell({
        blockId: 'block-no-edge',
        createdAt: CREATED_AT,
        edgeId: null,
        nodeId: 'node-no-edge',
        parentNodeId: 'node-answer',
        revisionId: 'revision-no-edge',
        source: 'x = 1',
        title: null,
      }),
    ).toThrow('requires an edge ID');
    expect(() =>
      useWaterLilyStore.getState().addExecutionResult({
        blockId: 'block-bad-output',
        codeNodeId: 'node-answer',
        createdAt: CREATED_AT,
        durationMilliseconds: 1,
        edgeId: 'edge-bad-output',
        exitCode: 1,
        nodeId: 'node-bad-output',
        output: 'bad',
        revisionId: 'revision-bad-output',
        timedOut: false,
        truncated: false,
      }),
    ).toThrow('require a code cell');
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

  it('creates editable checkpoint roots and revision-pinned template inputs', async () => {
    const store = useWaterLilyStore.getState();
    store.createCheckpoint({
      blockId: 'block-checkpoint',
      createdAt: CREATED_AT,
      nodeId: 'node-checkpoint',
      provenanceEdgeIds: ['edge-checkpoint-a', 'edge-checkpoint-b'],
      revisionId: 'revision-checkpoint',
      sourceNodeIds: ['node-answer', 'node-side-answer'],
      text: 'Stable exam summary',
      title: 'Exam checkpoint',
    });
    let state = useWaterLilyStore.getState();
    expect(state.selectedNodeIds).toEqual(['node-checkpoint']);
    expect(state.graph.nodes['node-checkpoint']).toMatchObject({
      kind: 'summary',
      title: 'Exam checkpoint',
    });
    expect(state.graph.revisions['revision-checkpoint']?.metadata).toEqual({
      checkpoint: { sourceCount: 2, version: 1 },
    });
    expect(
      Object.values(state.graph.edges)
        .filter((edge) => edge.targetNodeId === 'node-checkpoint')
        .map((edge) => edge.kind),
    ).toEqual(['provenance', 'provenance']);

    store.reviseText({
      blockId: 'block-checkpoint',
      createdAt: '2026-08-05T14:00:01.000Z',
      nodeId: 'node-checkpoint',
      revisionId: 'revision-checkpoint-template',
      text: 'Stable exam summary\n\nRecall: {{mechanism}}',
    });
    store.bindTemplateVariable({
      createdAt: '2026-08-05T14:00:02.000Z',
      name: 'mechanism',
      revisionId: 'revision-checkpoint-bound',
      sourceNodeId: 'node-answer',
      targetBlockId: 'block-checkpoint',
      targetNodeId: 'node-checkpoint',
    });
    state = useWaterLilyStore.getState();
    expect(
      state.graph.revisions['revision-checkpoint-bound']?.blocks[0],
    ).toMatchObject({
      template: {
        bindings: [
          {
            name: 'mechanism',
            sourceNodeId: 'node-answer',
            sourceRevisionId: 'revision-node-answer',
          },
        ],
      },
    });
    const compiled = await compileContext({
      graph: state.graph,
      heads: [{ label: 'Checkpoint', nodeId: 'node-checkpoint', slot: 0 }],
    });
    expect(compiled.common.items).toHaveLength(1);
    const compiledBlock = compiled.common.items[0]?.blocks[0];
    expect(compiledBlock?.type).toBe('text');
    expect(compiledBlock?.type === 'text' ? compiledBlock.text : '').toContain(
      'ATP synthase',
    );

    store.unbindTemplateVariable({
      createdAt: '2026-08-05T14:00:03.000Z',
      name: 'mechanism',
      revisionId: 'revision-checkpoint-unbound',
      targetBlockId: 'block-checkpoint',
      targetNodeId: 'node-checkpoint',
    });
    expect(
      useWaterLilyStore.getState().graph.revisions[
        'revision-checkpoint-unbound'
      ]?.blocks[0],
    ).toMatchObject({ template: { bindings: [] } });
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

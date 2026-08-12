import { describe, expect, it } from 'vitest';

import {
  connectContext,
  connectProvenance,
  connectReference,
  reviseNode,
  type GraphSnapshot,
} from '@llm-graph/domain';

import { compileContext, type ContextHead } from '../src/index.js';
import {
  addNode,
  connect,
  emptyGraph,
  expectContextErrorAsync,
  textBlock,
  timestamp,
} from './helpers.js';

function linearGraph(): GraphSnapshot {
  let graph = emptyGraph();
  graph = addNode(graph, { id: 'question', offset: 1, text: 'Question' });
  graph = addNode(graph, {
    id: 'answer',
    offset: 2,
    role: 'assistant',
    text: 'Answer',
  });
  graph = addNode(graph, { id: 'follow-up', offset: 3, text: 'Follow up' });
  graph = connect(graph, 'question', 'answer', 0, 4);
  return connect(graph, 'answer', 'follow-up', 0, 5);
}

function branchGraph(): GraphSnapshot {
  let graph = emptyGraph();
  graph = addNode(graph, { id: 'root', offset: 1, text: 'Root question' });
  graph = addNode(graph, {
    id: 'base',
    offset: 2,
    role: 'assistant',
    text: 'Base answer',
  });
  graph = addNode(graph, { id: 'left', offset: 3, text: 'Left question' });
  graph = addNode(graph, { id: 'right', offset: 4, text: 'Right question' });
  graph = connect(graph, 'root', 'base', 0, 5);
  graph = connect(graph, 'base', 'left', 0, 6);
  return connect(graph, 'base', 'right', 0, 7);
}

function ids(items: readonly { readonly nodeId: string }[]): readonly string[] {
  return items.map((item) => item.nodeId);
}

describe('context traversal', () => {
  it('compiles a linear history in causal order', async () => {
    const compiled = await compileContext({
      graph: linearGraph(),
      heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
    });

    expect(ids(compiled.common.items)).toEqual([
      'question',
      'answer',
      'follow-up',
    ]);
    expect(compiled.branches).toEqual([]);
    expect(compiled.estimatedTokens).toBeNull();
    expect(compiled.warnings).toMatchObject([
      { code: 'TOKEN_ESTIMATE_UNAVAILABLE' },
    ]);
    expect(compiled.hash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('factors shared ancestry once and orders branches by explicit head slot', async () => {
    const graph = branchGraph();
    const heads: ContextHead[] = [
      { label: 'Right', nodeId: 'right', slot: 1 },
      { label: 'Left', nodeId: 'left', slot: 0 },
    ];
    const compiled = await compileContext({ graph, heads });

    expect(ids(compiled.common.items)).toEqual(['root', 'base']);
    expect(compiled.branches.map((branch) => branch.label)).toEqual([
      'Left',
      'Right',
    ]);
    expect(ids(compiled.branches[0]?.items ?? [])).toEqual(['left']);
    expect(ids(compiled.branches[1]?.items ?? [])).toEqual(['right']);
  });

  it('uses incoming context slots to order an internal merge', async () => {
    let graph = branchGraph();
    graph = addNode(graph, { id: 'merge', offset: 8, text: 'Merge branches' });
    graph = connect(graph, 'left', 'merge', 1, 9);
    graph = connect(graph, 'right', 'merge', 0, 10);

    const compiled = await compileContext({
      graph,
      heads: [{ label: 'Merged', nodeId: 'merge', slot: 0 }],
    });
    expect(ids(compiled.common.items)).toEqual([
      'root',
      'base',
      'right',
      'left',
      'merge',
    ]);
  });

  it('never traverses provenance or reference edges', async () => {
    let graph = linearGraph();
    graph = addNode(graph, {
      id: 'source-note',
      kind: 'note',
      offset: 6,
      text: 'Not context',
    });
    graph = connectProvenance(graph, {
      createdAt: timestamp(7),
      edgeId: 'provenance-note-follow-up',
      relation: 'derived',
      sourceNodeId: 'source-note',
      targetNodeId: 'follow-up',
    });
    graph = connectReference(graph, {
      createdAt: timestamp(8),
      edgeId: 'reference-note-answer',
      sourceNodeId: 'source-note',
      targetNodeId: 'answer',
    });

    const compiled = await compileContext({
      graph,
      heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
    });
    expect(ids(compiled.common.items)).toEqual([
      'question',
      'answer',
      'follow-up',
    ]);
  });

  it('keeps a causal edge pinned after the source receives a new revision', async () => {
    let graph = linearGraph();
    graph = reviseNode(graph, {
      blocks: [textBlock('question-v2-block', 'Changed question')],
      createdAt: timestamp(9),
      nodeId: 'question',
      revisionId: 'question-revision-2',
    });

    const compiled = await compileContext({
      graph,
      heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
    });
    expect(compiled.common.items[0]).toMatchObject({
      revisionId: 'question-revision-1',
    });
    expect(compiled.common.items[0]?.blocks[0]).toMatchObject({
      text: 'Question',
    });
  });

  it('can compare two explicitly pinned revisions of the same node', async () => {
    let graph = emptyGraph();
    graph = addNode(graph, { id: 'source', offset: 1, text: 'Version one' });
    graph = addNode(graph, { id: 'comparison', offset: 2, text: 'Compare' });
    graph = reviseNode(graph, {
      blocks: [textBlock('source-v2-block', 'Version two')],
      createdAt: timestamp(3),
      nodeId: 'source',
      revisionId: 'source-revision-2',
    });
    graph = connectContext(graph, {
      createdAt: timestamp(4),
      edgeId: 'source-v1-comparison',
      slot: 0,
      sourceNodeId: 'source',
      sourceRevisionId: 'source-revision-1',
      targetNodeId: 'comparison',
    });
    graph = connectContext(graph, {
      createdAt: timestamp(5),
      edgeId: 'source-v2-comparison',
      slot: 1,
      sourceNodeId: 'source',
      sourceRevisionId: 'source-revision-2',
      targetNodeId: 'comparison',
    });

    const compiled = await compileContext({
      graph,
      heads: [{ label: 'Comparison', nodeId: 'comparison', slot: 0 }],
    });
    expect(
      compiled.common.items.map((item) => [item.nodeId, item.revisionId]),
    ).toEqual([
      ['source', 'source-revision-1'],
      ['source', 'source-revision-2'],
      ['comparison', 'comparison-revision-1'],
    ]);
  });
});

describe('context selection and token budgets', () => {
  it('selects blocks in source order and can exclude an ancestor', async () => {
    let graph = emptyGraph();
    graph = addNode(graph, {
      blocks: [
        textBlock('block-a', 'A'),
        textBlock('block-b', 'B'),
        textBlock('block-c', 'C'),
      ],
      id: 'answer',
      offset: 1,
      role: 'assistant',
    });
    graph = addNode(graph, { id: 'question', offset: 2, text: 'Next' });
    graph = connect(graph, 'answer', 'question', 0, 3);

    const compiled = await compileContext({
      graph,
      heads: [{ label: 'Main', nodeId: 'question', slot: 0 }],
      overrides: [
        {
          nodeId: 'answer',
          selection: { blockIds: ['block-c', 'block-a'], mode: 'blocks' },
        },
        { nodeId: 'question', selection: { mode: 'excluded' } },
      ],
    });

    expect(compiled.common.items).toHaveLength(1);
    expect(compiled.common.items[0]?.blocks.map((block) => block.id)).toEqual([
      'block-a',
      'block-c',
    ]);
    expect(compiled.decisions).toContainEqual({
      includedBlockIds: [],
      mode: 'excluded',
      nodeId: 'question',
      revisionId: 'question-revision-1',
    });
  });

  it('prefers an exact revision override over a node-wide override', async () => {
    const graph = linearGraph();
    const compiled = await compileContext({
      graph,
      heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
      overrides: [
        { nodeId: 'answer', selection: { mode: 'excluded' } },
        {
          nodeId: 'answer',
          revisionId: 'answer-revision-1',
          selection: { mode: 'full' },
        },
      ],
    });

    expect(ids(compiled.common.items)).toContain('answer');
  });

  it('reports token overflow without dropping content', async () => {
    const compiled = await compileContext({
      graph: linearGraph(),
      heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
      tokenBudget: 5,
      tokenEstimator: {
        estimate: (blocks) =>
          blocks.reduce(
            (total, block) =>
              total + (block.type === 'text' ? block.text.length : 0),
            0,
          ),
        id: 'character-test-estimator',
      },
    });

    expect(compiled.estimatedTokens).toBe(23);
    expect(ids(compiled.common.items)).toHaveLength(3);
    expect(compiled.warnings).toEqual([
      {
        code: 'TOKEN_BUDGET_EXCEEDED',
        details: { estimatedTokens: 23, tokenBudget: 5 },
        message: 'The selected context exceeds the configured token budget.',
      },
    ]);
  });
});

describe('determinism', () => {
  it('is independent from record and input-head insertion order', async () => {
    const graph = branchGraph();
    const reverseRecord = <Value>(
      record: Readonly<Record<string, Value>>,
    ): Readonly<Record<string, Value>> =>
      Object.fromEntries(Object.entries(record).reverse());
    const reordered: GraphSnapshot = {
      ...graph,
      edges: reverseRecord(graph.edges),
      nodes: reverseRecord(graph.nodes),
      revisions: reverseRecord(graph.revisions),
    };
    const heads = [
      { label: 'Left', nodeId: 'left', slot: 0 },
      { label: 'Right', nodeId: 'right', slot: 1 },
    ] as const;

    const first = await compileContext({ graph, heads });
    const second = await compileContext({
      graph: reordered,
      heads: [...heads].reverse(),
    });
    expect(second).toEqual(first);
    expect(second.hash).toBe(first.hash);
  });

  it('changes the hash when the visible selection changes', async () => {
    const graph = linearGraph();
    const full = await compileContext({
      graph,
      heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
    });
    const excluded = await compileContext({
      graph,
      heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
      overrides: [{ nodeId: 'answer', selection: { mode: 'excluded' } }],
    });
    expect(excluded.hash).not.toBe(full.hash);
  });
});

describe('invalid compiler inputs', () => {
  it('rejects absent, duplicate-slot, fractional-slot, and blank-label heads', async () => {
    const graph = linearGraph();
    await expectContextErrorAsync(
      () => compileContext({ graph, heads: [] }),
      'INVALID_HEAD',
    );
    await expectContextErrorAsync(
      () =>
        compileContext({
          graph,
          heads: [
            { label: 'A', nodeId: 'answer', slot: 0 },
            { label: 'B', nodeId: 'follow-up', slot: 0 },
          ],
        }),
      'DUPLICATE_HEAD_SLOT',
    );
    await expectContextErrorAsync(
      () =>
        compileContext({
          graph,
          heads: [{ label: 'A', nodeId: 'answer', slot: 0.5 }],
        }),
      'INVALID_HEAD',
    );
    await expectContextErrorAsync(
      () =>
        compileContext({
          graph,
          heads: [{ label: '   ', nodeId: 'answer', slot: 0 }],
        }),
      'INVALID_HEAD',
    );
  });

  it('rejects missing heads and foreign head revisions', async () => {
    const graph = linearGraph();
    await expectContextErrorAsync(
      () =>
        compileContext({
          graph,
          heads: [{ label: 'Missing', nodeId: 'missing', slot: 0 }],
        }),
      'NOT_FOUND',
    );
    await expectContextErrorAsync(
      () =>
        compileContext({
          graph,
          heads: [
            {
              label: 'Wrong revision',
              nodeId: 'answer',
              revisionId: 'question-revision-1',
              slot: 0,
            },
          ],
        }),
      'INVALID_HEAD',
    );
  });

  it('rejects invalid override selectors and block selections', async () => {
    const graph = linearGraph();
    await expectContextErrorAsync(
      () =>
        compileContext({
          graph,
          heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
          overrides: [
            { nodeId: 'answer', selection: { mode: 'full' } },
            { nodeId: 'answer', selection: { mode: 'excluded' } },
          ],
        }),
      'DUPLICATE_OVERRIDE',
    );
    await expectContextErrorAsync(
      () =>
        compileContext({
          graph,
          heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
          overrides: [{ nodeId: 'missing', selection: { mode: 'full' } }],
        }),
      'INVALID_OVERRIDE',
    );
    await expectContextErrorAsync(
      () =>
        compileContext({
          graph,
          heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
          overrides: [
            {
              nodeId: 'answer',
              revisionId: 'question-revision-1',
              selection: { mode: 'full' },
            },
          ],
        }),
      'INVALID_OVERRIDE',
    );
    for (const blockIds of [
      [],
      ['missing'],
      ['answer-block', 'answer-block'],
    ]) {
      await expectContextErrorAsync(
        () =>
          compileContext({
            graph,
            heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
            overrides: [
              {
                nodeId: 'answer',
                selection: { blockIds, mode: 'blocks' },
              },
            ],
          }),
        'INVALID_BLOCK_SELECTION',
      );
    }
  });

  it('rejects invalid budgets and estimator results', async () => {
    const graph = linearGraph();
    for (const tokenBudget of [0, -1, 1.5]) {
      await expectContextErrorAsync(
        () =>
          compileContext({
            graph,
            heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
            tokenBudget,
          }),
        'INVALID_TOKEN_BUDGET',
      );
    }
    await expectContextErrorAsync(
      () =>
        compileContext({
          graph,
          heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
          tokenEstimator: { estimate: () => 1, id: '   ' },
        }),
      'INVALID_ESTIMATE',
    );
    for (const estimate of [-1, 1.5]) {
      await expectContextErrorAsync(
        () =>
          compileContext({
            graph,
            heads: [{ label: 'Main', nodeId: 'follow-up', slot: 0 }],
            tokenEstimator: { estimate: () => estimate, id: 'invalid' },
          }),
        'INVALID_ESTIMATE',
      );
    }
  });
});

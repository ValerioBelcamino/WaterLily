import {
  createGraph,
  createNode,
  reviseTextBlock,
  setTemplateBinding,
  validateGraph,
  type GraphSnapshot,
} from '@waterlily/domain';
import { describe, expect, it } from 'vitest';

import {
  cloneGraphDocument,
  cloneGraphSnapshot,
  importGraphDocument,
  mergeGraphDocument,
  mergeGraphSnapshot,
  serializeGraphDocument,
  type GraphDocumentV1,
  type IdRemapper,
} from '../src/index.js';
import { prefixedRemapper, sampleDocument, time } from './helpers.js';

function targetGraph(updatedAtOffset = 30): GraphSnapshot {
  let graph = createGraph({ createdAt: time(0), graphId: 'target-graph' });
  graph = createNode(graph, {
    blocks: [
      { format: 'plain', id: 'target-block', text: 'Target', type: 'text' },
    ],
    createdAt: time(updatedAtOffset),
    kind: 'message',
    nodeId: 'target-node',
    revisionId: 'target-revision',
    role: 'user',
  });
  return graph;
}

describe('graph document importing', () => {
  it('clones every identifier, view reference, and source revision', () => {
    const result = cloneGraphDocument(sampleDocument(), {
      graphId: 'chosen-graph-id',
      remapId: prefixedRemapper,
    });

    expect(result.graph.id).toBe('chosen-graph-id');
    expect(result.mapping).toMatchObject({
      graphId: 'chosen-graph-id',
      nodes: { 'node-user': 'import-node-node-user' },
      revisions: { 'revision-user': 'import-revision-revision-user' },
    });
    expect(result.graph.nodes['import-node-node-user']).toMatchObject({
      currentRevisionId: 'import-revision-revision-user',
      id: 'import-node-node-user',
    });
    expect(result.graph.edges['import-edge-edge-system-user']).toMatchObject({
      sourceNodeId: 'import-node-node-system',
      sourceRevisionId: 'import-revision-revision-system',
      targetNodeId: 'import-node-node-user',
    });
    expect(
      result.graph.edges['import-edge-edge-note-answer'],
    ).not.toHaveProperty('sourceRevisionId');
    expect(
      result.graph.revisions['import-revision-revision-user']?.metadata,
    ).toMatchObject({
      $llmGraphImport: {
        sourceGraphId: 'source-graph',
        sourceNodeId: 'node-user',
        sourceRevisionId: 'revision-user',
      },
      order: 2,
    });
    expect(result.view.positions['import-node-node-user']).toEqual({
      x: 300,
      y: 0,
    });
    expect(result.view.groups[0]).toMatchObject({
      id: 'import-group-group-main',
      nodeIds: [
        'import-node-node-system',
        'import-node-node-user',
        'import-node-node-answer',
      ],
    });
    expect(() => validateGraph(result.graph)).not.toThrow();
  });

  it('remaps revision-pinned template bindings with their imported graph', () => {
    const templated = setTemplateBinding(
      reviseTextBlock(sampleDocument().graph, {
        blockId: 'block-user',
        createdAt: time(9),
        nodeId: 'node-user',
        revisionId: 'revision-user-template',
        text: 'Question about {{system_prompt}}',
      }),
      {
        createdAt: time(10),
        name: 'system_prompt',
        nodeId: 'node-user',
        revisionId: 'revision-user-bound',
        sourceNodeId: 'node-system',
        targetBlockId: 'block-user',
      },
    );
    const result = cloneGraphSnapshot({
      graph: templated,
      remapId: prefixedRemapper,
    });
    expect(
      result.graph.revisions['import-revision-revision-user-bound']?.blocks[0],
    ).toMatchObject({
      template: {
        bindings: [
          {
            name: 'system_prompt',
            sourceNodeId: 'import-node-node-system',
            sourceRevisionId: 'import-revision-revision-system',
          },
        ],
      },
    });
    expect(() => validateGraph(result.graph)).not.toThrow();
  });

  it('imports serialized JSON with default and explicit size limits', () => {
    const json = serializeGraphDocument(sampleDocument());
    expect(
      importGraphDocument(json, { remapId: prefixedRemapper }).graph.id,
    ).toBe('import-graph-source-graph');
    expect(() =>
      importGraphDocument(json, { remapId: prefixedRemapper }, 10),
    ).toThrow('size limit');
  });

  it('merges a clone into a target without changing the target identity', () => {
    const target = targetGraph();
    const result = mergeGraphDocument({
      document: sampleDocument(),
      remapId: prefixedRemapper,
      targetGraph: target,
      targetView: {
        groups: [
          {
            collapsed: true,
            color: '#112233',
            id: 'target-group',
            nodeIds: ['target-node'],
            title: 'Target',
          },
        ],
        positions: { 'target-node': { x: -100, y: 5 } },
      },
    });

    expect(result.graph.id).toBe('target-graph');
    expect(result.graph.nodes['target-node']).toEqual(
      target.nodes['target-node'],
    );
    expect(result.graph.nodes['import-node-node-answer']).toBeDefined();
    expect(result.graph.updatedAt).toBe(target.updatedAt);
    expect(result.view.positions).toMatchObject({
      'import-node-node-user': { x: 300, y: 0 },
      'target-node': { x: -100, y: 5 },
    });
    expect(result.view.groups.map((group) => group.id)).toEqual([
      'target-group',
      'import-group-group-main',
    ]);
  });

  it('uses the imported update time when it is newer and view defaults when absent', () => {
    const result = mergeGraphDocument({
      document: sampleDocument(),
      remapId: prefixedRemapper,
      targetGraph: targetGraph(6),
    });
    expect(result.graph.updatedAt).toBe(time(8));
    expect(result.view.groups).toHaveLength(1);
  });

  it('rejects entity and group collisions before combining state', () => {
    const entityCollision: IdRemapper = (kind, id) =>
      kind === 'node' && id === 'node-user'
        ? 'target-node'
        : `safe-${kind}-${id}`;
    const groupCollision: IdRemapper = (kind, id) =>
      kind === 'group' ? 'target-group' : `safe-${kind}-${id}`;

    expect(() =>
      mergeGraphDocument({
        document: sampleDocument(),
        remapId: entityCollision,
        targetGraph: targetGraph(),
      }),
    ).toThrow(expect.objectContaining({ code: 'ID_COLLISION' }));
    expect(() =>
      mergeGraphDocument({
        document: sampleDocument(),
        remapId: groupCollision,
        targetGraph: targetGraph(),
        targetView: {
          groups: [
            {
              collapsed: false,
              color: '#000000',
              id: 'target-group',
              nodeIds: [],
              title: 'Target',
            },
          ],
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'ID_COLLISION' }));
  });

  it('rejects remappers that collide within entities or groups', () => {
    const oneId: IdRemapper = (kind) =>
      kind === 'group' ? 'one-group' : 'one-entity';
    expect(() =>
      cloneGraphDocument(sampleDocument(), { remapId: oneId }),
    ).toThrow(expect.objectContaining({ code: 'ID_COLLISION' }));

    const document: GraphDocumentV1 = {
      ...sampleDocument(),
      view: {
        ...sampleDocument().view,
        groups: [
          ...sampleDocument().view.groups,
          {
            collapsed: false,
            color: '#445566',
            id: 'group-note',
            nodeIds: ['node-note'],
            title: 'Note',
          },
        ],
      },
    };
    const groupOnlyCollision: IdRemapper = (kind, id) =>
      kind === 'group' ? 'same-group' : `safe-${kind}-${id}`;
    expect(() =>
      cloneGraphDocument(document, { remapId: groupOnlyCollision }),
    ).toThrow(expect.objectContaining({ code: 'ID_COLLISION' }));
  });

  it('validates direct document inputs before invoking the remapper', () => {
    const remap = () => 'unused';
    const invalid = {
      ...sampleDocument(),
      schemaVersion: 2,
    } as unknown as GraphDocumentV1;
    expect(() => cloneGraphDocument(invalid, { remapId: remap })).toThrow(
      'unsupported',
    );
  });

  it('clones and merges validated snapshots with default view state', () => {
    const cloned = cloneGraphSnapshot({
      graph: sampleDocument().graph,
      remapId: prefixedRemapper,
    });
    expect(cloned.view).toEqual({ groups: [], positions: {} });

    const merged = mergeGraphSnapshot({
      remapId: prefixedRemapper,
      sourceGraph: sampleDocument().graph,
      targetGraph: targetGraph(),
    });
    expect(merged.graph.id).toBe('target-graph');
    expect(merged.view).toEqual({ groups: [], positions: {} });
  });

  it('rejects an incomplete remapper result at its first graph reference', () => {
    const incomplete: IdRemapper = (kind, id) =>
      kind === 'revision' && id === 'revision-user'
        ? (undefined as unknown as string)
        : `complete-${kind}-${id}`;
    expect(() =>
      cloneGraphSnapshot({
        graph: sampleDocument().graph,
        remapId: incomplete,
      }),
    ).toThrow('mapping is incomplete');
  });
});

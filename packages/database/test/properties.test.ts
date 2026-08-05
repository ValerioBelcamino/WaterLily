import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  connectContext,
  createGraph,
  createNode,
  type GraphSnapshot,
} from '@waterlily/domain';

import { GraphRepository, openGraphDatabase } from '../src/index.js';
import { timestamp } from './helpers.js';

function arbitraryChain(texts: readonly string[]): GraphSnapshot {
  let graph = createGraph({
    createdAt: timestamp(0),
    graphId: 'property-graph',
  });
  texts.forEach((text, index) => {
    const nodeId = `node-${String(index)}`;
    graph = createNode(graph, {
      blocks: [
        {
          format: 'markdown',
          id: `${nodeId}-block`,
          text,
          type: 'text',
        },
      ],
      createdAt: timestamp(index + 1),
      kind: 'message',
      metadata: { index, nested: [text, null, true] },
      nodeId,
      revisionId: `${nodeId}-revision-1`,
      role: index % 2 === 0 ? 'user' : 'assistant',
    });
    if (index > 0) {
      graph = connectContext(graph, {
        createdAt: timestamp(texts.length + index + 1),
        edgeId: `edge-${String(index - 1)}-${String(index)}`,
        slot: 0,
        sourceNodeId: `node-${String(index - 1)}`,
        targetNodeId: nodeId,
      });
    }
  });
  return graph;
}

describe('repository round-trip properties', () => {
  it('preserves arbitrary Unicode content and linear graph sizes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 80 }), { maxLength: 20, minLength: 1 }),
        (texts) => {
          const handle = openGraphDatabase(':memory:');
          try {
            const repository = new GraphRepository(handle.db);
            const graph = arbitraryChain(texts);
            repository.insert(graph);
            expect(repository.get(graph.id)).toEqual(graph);
          } finally {
            handle.close();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

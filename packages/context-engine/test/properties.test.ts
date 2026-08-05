import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type GraphSnapshot } from '@waterlily/domain';

import { compileContext } from '../src/index.js';
import { addNode, connect, emptyGraph } from './helpers.js';

function chain(count: number): GraphSnapshot {
  let graph = emptyGraph();
  for (let index = 0; index < count; index += 1) {
    graph = addNode(graph, {
      id: `node-${String(index)}`,
      offset: index + 1,
      role: index % 2 === 0 ? 'user' : 'assistant',
    });
    if (index > 0) {
      graph = connect(
        graph,
        `node-${String(index - 1)}`,
        `node-${String(index)}`,
        0,
        count + index,
      );
    }
  }
  return graph;
}

describe('context compiler properties', () => {
  it('emits every node in an arbitrary linear chain exactly once', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ max: 60, min: 1 }), async (count) => {
        const graph = chain(count);
        const compiled = await compileContext({
          graph,
          heads: [
            {
              label: 'Chain',
              nodeId: `node-${String(count - 1)}`,
              slot: 0,
            },
          ],
        });

        expect(compiled.common.items.map((item) => item.nodeId)).toEqual(
          Array.from({ length: count }, (_, index) => `node-${String(index)}`),
        );
        expect(
          new Set(compiled.common.items.map((item) => item.nodeId)).size,
        ).toBe(count);
      }),
      { numRuns: 100 },
    );
  });
});

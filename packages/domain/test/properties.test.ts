import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  connectContext,
  connectReference,
  reviseNode,
  validateGraph,
  type GraphSnapshot,
} from '../src/index.js';
import {
  addMessage,
  emptyGraph,
  expectGraphError,
  timestamp,
} from './helpers.js';

function graphWithNodes(count: number): GraphSnapshot {
  let graph = emptyGraph();
  for (let index = 0; index < count; index += 1) {
    graph = addMessage(
      graph,
      `node-${String(index)}`,
      index + 1,
      index % 2 === 0 ? 'user' : 'assistant',
    );
  }
  return graph;
}

describe('graph invariant properties', () => {
  it('rejects a closing edge for every non-trivial causal chain', () => {
    fc.assert(
      fc.property(fc.integer({ max: 35, min: 2 }), (nodeCount) => {
        let graph = graphWithNodes(nodeCount);
        for (let index = 0; index < nodeCount - 1; index += 1) {
          graph = connectContext(graph, {
            createdAt: timestamp(nodeCount + index + 1),
            edgeId: `edge-${String(index)}-${String(index + 1)}`,
            slot: 0,
            sourceNodeId: `node-${String(index)}`,
            targetNodeId: `node-${String(index + 1)}`,
          });
        }

        const before = JSON.stringify(graph);
        expectGraphError(
          () =>
            connectContext(graph, {
              createdAt: timestamp(nodeCount * 3),
              edgeId: 'closing-edge',
              slot: 0,
              sourceNodeId: `node-${String(nodeCount - 1)}`,
              targetNodeId: 'node-0',
            }),
          'CAUSAL_CYCLE',
        );
        expect(JSON.stringify(graph)).toBe(before);
      }),
      { numRuns: 150 },
    );
  });

  it('accepts reference cycles of arbitrary length', () => {
    fc.assert(
      fc.property(fc.integer({ max: 35, min: 2 }), (nodeCount) => {
        let graph = graphWithNodes(nodeCount);
        for (let index = 0; index < nodeCount; index += 1) {
          const target = (index + 1) % nodeCount;
          graph = connectReference(graph, {
            createdAt: timestamp(nodeCount + index + 1),
            edgeId: `reference-${String(index)}-${String(target)}`,
            sourceNodeId: `node-${String(index)}`,
            targetNodeId: `node-${String(target)}`,
          });
        }
        expect(() => validateGraph(graph)).not.toThrow();
      }),
      { numRuns: 150 },
    );
  });

  it('never retargets a pinned edge after arbitrary source revisions', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 100 }), {
          maxLength: 30,
          minLength: 1,
        }),
        (contents) => {
          let graph = graphWithNodes(2);
          graph = connectContext(graph, {
            createdAt: timestamp(3),
            edgeId: 'edge-0-1',
            slot: 0,
            sourceNodeId: 'node-0',
            targetNodeId: 'node-1',
          });

          contents.forEach((content, index) => {
            graph = reviseNode(graph, {
              blocks: [
                {
                  format: 'plain',
                  id: `revision-block-${String(index + 2)}`,
                  text: content,
                  type: 'text',
                },
              ],
              createdAt: timestamp(index + 4),
              nodeId: 'node-0',
              revisionId: `node-0-revision-${String(index + 2)}`,
            });
          });

          expect(graph.edges['edge-0-1']).toMatchObject({
            sourceRevisionId: 'node-0-revision-1',
          });
          expect(() => validateGraph(graph)).not.toThrow();
        },
      ),
      { numRuns: 150 },
    );
  });
});

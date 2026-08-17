import { describe, expect, it } from 'vitest';

import {
  reviseNode,
  reviseTextBlock,
  setTemplateBinding,
  type JsonValue,
} from '@waterlily/domain';

import {
  GraphRepository,
  openGraphDatabase,
  WorkspaceRepository,
  type GraphDatabase,
} from '../src/index.js';
import { expectDatabaseError, sampleGraph, timestamp } from './helpers.js';

function withDatabase(operation: (handle: GraphDatabase) => void): void {
  const handle = openGraphDatabase(':memory:');
  try {
    operation(handle);
  } finally {
    handle.close();
  }
}

const state = {
  contextSelections: { 'graph-1-answer': { mode: 'full' } },
  view: {
    groups: [],
    positions: { 'graph-1-answer': { x: 12, y: 34 } },
  },
} as const;

describe('workspace repository', () => {
  it('round-trips graph and JSON state atomically', () => {
    withDatabase((handle) => {
      const repository = new WorkspaceRepository(handle.db);
      const graph = sampleGraph();
      repository.insert({ graph, state });
      expect(repository.get(graph.id)).toEqual({ graph, state });
    });
  });

  it('round-trips revision-pinned templates through SQLite', () => {
    withDatabase((handle) => {
      const templated = setTemplateBinding(
        reviseTextBlock(sampleGraph(), {
          blockId: 'graph-1-question-block-v2',
          createdAt: timestamp(20),
          nodeId: 'graph-1-question',
          revisionId: 'graph-1-question-template',
          text: 'Connect {{answer}}',
        }),
        {
          createdAt: timestamp(21),
          name: 'answer',
          nodeId: 'graph-1-question',
          revisionId: 'graph-1-question-bound',
          sourceNodeId: 'graph-1-answer',
          targetBlockId: 'graph-1-question-block-v2',
        },
      );
      const repository = new WorkspaceRepository(handle.db);
      repository.insert({ graph: templated, state });
      expect(
        repository.get(templated.id)?.graph.revisions['graph-1-question-bound']
          ?.blocks[0],
      ).toMatchObject({
        template: {
          bindings: [
            {
              name: 'answer',
              sourceNodeId: 'graph-1-answer',
              sourceRevisionId: 'graph-1-answer-revision-1',
            },
          ],
        },
      });
    });
  });

  it('replaces both graph and state behind the graph timestamp', () => {
    withDatabase((handle) => {
      const repository = new WorkspaceRepository(handle.db);
      const graph = sampleGraph();
      repository.insert({ graph, state });
      const updated = reviseNode(graph, {
        blocks: [
          { format: 'plain', id: 'updated-block', text: 'New', type: 'text' },
        ],
        createdAt: timestamp(30),
        nodeId: 'graph-1-answer',
        revisionId: 'updated-revision',
      });
      const updatedState = { view: { groups: [], positions: {} } } as const;
      repository.replace(
        { graph: updated, state: updatedState },
        graph.updatedAt,
      );
      expect(repository.get(graph.id)).toEqual({
        graph: updated,
        state: updatedState,
      });

      expectDatabaseError(
        () => repository.replace({ graph, state }, graph.updatedAt),
        'CONFLICT',
      );
      expect(repository.get(graph.id)?.state).toEqual(updatedState);
    });
  });

  it('returns null for missing workspaces and rejects graph-only corruption', () => {
    withDatabase((handle) => {
      const repository = new WorkspaceRepository(handle.db);
      expect(repository.get('missing')).toBeNull();
      const graph = sampleGraph();
      new GraphRepository(handle.db).insert(graph);
      expectDatabaseError(() => repository.get(graph.id), 'CORRUPT_DATA');
    });
  });

  it('rolls back graph insertion when workspace state insertion fails', () => {
    withDatabase((handle) => {
      handle.sqlite.exec(`
        CREATE TRIGGER reject_workspace
        BEFORE INSERT ON graph_workspace_state
        BEGIN
          SELECT RAISE(ABORT, 'rejected');
        END;
      `);
      const graph = sampleGraph();
      const repository = new WorkspaceRepository(handle.db);
      expectDatabaseError(
        () => repository.insert({ graph, state }),
        'PERSISTENCE_FAILED',
      );
      expect(new GraphRepository(handle.db).get(graph.id)).toBeNull();
    });
  });

  it('preserves typed duplicate errors from the graph transaction', () => {
    withDatabase((handle) => {
      const graph = sampleGraph();
      const repository = new WorkspaceRepository(handle.db);
      repository.insert({ graph, state });
      expectDatabaseError(
        () => repository.insert({ graph, state }),
        'ALREADY_EXISTS',
      );
    });
  });

  it.each([
    { name: 'non-finite number', value: Number.NaN },
    { name: 'undefined', value: undefined },
    { name: 'non-plain object', value: new Date() },
  ])('rejects $name in workspace state', ({ value }) => {
    withDatabase((handle) => {
      const repository = new WorkspaceRepository(handle.db);
      expectDatabaseError(
        () =>
          repository.insert({
            graph: sampleGraph(),
            state: value as unknown as JsonValue,
          }),
        'INVALID_STATE',
      );
    });
  });

  it('rejects cyclic workspace state', () => {
    withDatabase((handle) => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expectDatabaseError(
        () =>
          new WorkspaceRepository(handle.db).insert({
            graph: sampleGraph(),
            state: cyclic as JsonValue,
          }),
        'INVALID_STATE',
      );
    });
  });

  it('reports malformed stored state JSON as corruption', () => {
    withDatabase((handle) => {
      const graph = sampleGraph();
      const repository = new WorkspaceRepository(handle.db);
      repository.insert({ graph, state });
      handle.sqlite.pragma('ignore_check_constraints = ON');
      handle.sqlite
        .prepare(
          "UPDATE graph_workspace_state SET state_json = 'not-json' WHERE graph_id = ?",
        )
        .run(graph.id);
      handle.sqlite.pragma('ignore_check_constraints = OFF');

      const error = expectDatabaseError(
        () => repository.get(graph.id),
        'CORRUPT_DATA',
      );
      expect(error.cause).toBeInstanceOf(SyntaxError);
    });
  });

  it('does not disguise unexpected read failures', () => {
    const handle = openGraphDatabase(':memory:');
    const repository = new WorkspaceRepository(handle.db);
    handle.close();
    expect(() => repository.get('graph-1')).toThrow();
  });
});

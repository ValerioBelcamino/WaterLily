import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createGraph, reviseNode, type GraphSnapshot } from '@llm-graph/domain';

import {
  DatabaseError,
  GraphRepository,
  openGraphDatabase,
  type GraphDatabase,
} from '../src/index.js';
import { expectDatabaseError, sampleGraph, timestamp } from './helpers.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function withDatabase(operation: (handle: GraphDatabase) => void): void {
  const handle = openGraphDatabase(':memory:');
  try {
    operation(handle);
  } finally {
    handle.close();
  }
}

function expectRoundTrip(
  repository: GraphRepository,
  graph: GraphSnapshot,
): void {
  repository.insert(graph);
  expect(repository.get(graph.id)).toEqual(graph);
}

describe('graph repository', () => {
  it('returns null for a graph that does not exist', () => {
    withDatabase((handle) => {
      const repository = new GraphRepository(handle.db);
      expect(repository.get('missing')).toBeNull();
    });
  });

  it('round-trips revisions and every edge kind without semantic loss', () => {
    withDatabase((handle) => {
      expectRoundTrip(new GraphRepository(handle.db), sampleGraph());
    });
  });

  it('round-trips an empty graph without issuing empty bulk inserts', () => {
    withDatabase((handle) => {
      const graph = createGraph({
        createdAt: timestamp(0),
        graphId: 'empty-graph',
      });
      expectRoundTrip(new GraphRepository(handle.db), graph);
    });
  });

  it('rejects duplicate graph insertion', () => {
    withDatabase((handle) => {
      const repository = new GraphRepository(handle.db);
      const graph = sampleGraph();
      repository.insert(graph);

      expectDatabaseError(() => repository.insert(graph), 'ALREADY_EXISTS');
      expect(repository.get(graph.id)).toEqual(graph);
    });
  });

  it('replaces a graph only when the optimistic timestamp matches', () => {
    withDatabase((handle) => {
      const repository = new GraphRepository(handle.db);
      const original = sampleGraph();
      repository.insert(original);
      const updated = reviseNode(original, {
        blocks: [
          {
            format: 'markdown',
            id: 'graph-1-answer-block-v2',
            text: 'Updated answer',
            type: 'text',
          },
        ],
        createdAt: timestamp(20),
        nodeId: 'graph-1-answer',
        revisionId: 'graph-1-answer-revision-2',
      });

      repository.replace(updated, original.updatedAt);
      expect(repository.get(original.id)).toEqual(updated);

      const staleError = expectDatabaseError(
        () => repository.replace(original, original.updatedAt),
        'CONFLICT',
      );
      expect(staleError.details).toMatchObject({
        actualUpdatedAt: updated.updatedAt,
        expectedUpdatedAt: original.updatedAt,
      });
      expect(repository.get(original.id)).toEqual(updated);
    });
  });

  it('rejects replacement of a missing graph', () => {
    withDatabase((handle) => {
      const repository = new GraphRepository(handle.db);
      const graph = sampleGraph();
      expectDatabaseError(
        () => repository.replace(graph, graph.updatedAt),
        'NOT_FOUND',
      );
    });
  });

  it('rolls back a partially inserted graph after a database constraint fails', () => {
    withDatabase((handle) => {
      const repository = new GraphRepository(handle.db);
      const first = sampleGraph('graph-one', 'shared');
      const second = sampleGraph('graph-two', 'shared');
      repository.insert(first);

      const error = expectDatabaseError(
        () => repository.insert(second),
        'PERSISTENCE_FAILED',
      );
      expect(error.cause).toBeDefined();
      expect(repository.get('graph-two')).toBeNull();
      expect(repository.get('graph-one')).toEqual(first);
    });
  });

  it('detects graph corruption when loading persisted rows', () => {
    withDatabase((handle) => {
      const repository = new GraphRepository(handle.db);
      const graph = sampleGraph();
      repository.insert(graph);

      handle.sqlite.pragma('foreign_keys = OFF');
      handle.sqlite
        .prepare(
          "UPDATE graph_nodes SET current_revision_id = 'missing-revision' WHERE id = ?",
        )
        .run('graph-1-answer');
      handle.sqlite.pragma('foreign_keys = ON');

      const error = expectDatabaseError(
        () => repository.get(graph.id),
        'CORRUPT_DATA',
      );
      expect(error.cause).toBeDefined();
    });
  });

  it('reports malformed stored JSON as graph corruption', () => {
    withDatabase((handle) => {
      const repository = new GraphRepository(handle.db);
      const graph = sampleGraph();
      repository.insert(graph);
      handle.sqlite.pragma('ignore_check_constraints = ON');
      handle.sqlite
        .prepare("UPDATE graph_nodes SET tags_json = 'not-json' WHERE id = ?")
        .run('graph-1-answer');
      handle.sqlite.pragma('ignore_check_constraints = OFF');

      const error = expectDatabaseError(
        () => repository.get(graph.id),
        'CORRUPT_DATA',
      );
      expect(error.cause).toBeInstanceOf(SyntaxError);
    });
  });

  it.each([
    {
      mutation:
        "UPDATE graph_edges SET source_revision_id = NULL WHERE kind = 'context'",
      name: 'causal edge without source revision',
    },
    {
      mutation: "UPDATE graph_edges SET slot = NULL WHERE kind = 'context'",
      name: 'context edge without slot',
    },
    {
      mutation:
        "UPDATE graph_edges SET relation = NULL WHERE kind = 'provenance'",
      name: 'provenance edge without relation',
    },
  ])('detects a corrupt $name', ({ mutation }) => {
    withDatabase((handle) => {
      const repository = new GraphRepository(handle.db);
      const graph = sampleGraph();
      repository.insert(graph);
      handle.sqlite.pragma('foreign_keys = OFF');
      handle.sqlite.pragma('ignore_check_constraints = ON');
      handle.sqlite.exec(mutation);
      handle.sqlite.pragma('ignore_check_constraints = OFF');
      handle.sqlite.pragma('foreign_keys = ON');

      expectDatabaseError(() => repository.get(graph.id), 'CORRUPT_DATA');
    });
  });

  it('uses foreign keys and WAL for a file-backed database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'llm-graph-database-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'graph.sqlite');
    const handle = openGraphDatabase(path);
    try {
      expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe(
        'wal',
      );
      const repository = new GraphRepository(handle.db);
      repository.insert(sampleGraph());
      expect(handle.sqlite.pragma('foreign_key_check')).toEqual([]);
      expect(handle.sqlite.pragma('integrity_check', { simple: true })).toBe(
        'ok',
      );
    } finally {
      handle.close();
    }

    const readonlyHandle = openGraphDatabase(path, { readonly: true });
    try {
      expect(new GraphRepository(readonlyHandle.db).get('graph-1')).toEqual(
        sampleGraph(),
      );
    } finally {
      readonlyHandle.close();
    }
  });

  it('does not hide unexpected errors from a closed connection', () => {
    const handle = openGraphDatabase(':memory:');
    const repository = new GraphRepository(handle.db);
    handle.close();

    expect(() => repository.get('graph-1')).toThrow();
    try {
      repository.get('graph-1');
    } catch (error: unknown) {
      expect(error).not.toBeInstanceOf(DatabaseError);
    }
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  loadMigrations,
  type Migration,
} from '../src/index.js';
import { expectDatabaseError } from './helpers.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function withMemoryDatabase(
  operation: (sqlite: Database.Database) => void,
): void {
  const sqlite = new Database(':memory:');
  try {
    operation(sqlite);
  } finally {
    sqlite.close();
  }
}

describe('migration loading and application', () => {
  it('loads ordered versioned migrations with stable checksums', () => {
    const migrations = loadMigrations();
    expect(migrations.map((migration) => migration.id)).toEqual([
      '0001_initial',
      '0002_workspace_state',
      '0003_code_execution_nodes',
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(migrations[0]?.sql).toContain('CREATE TABLE graphs');
  });

  it('applies migrations exactly once', () => {
    withMemoryDatabase((sqlite) => {
      const migrations = loadMigrations();
      applyMigrations(sqlite, migrations);
      applyMigrations(sqlite, migrations);

      expect(
        sqlite.prepare('SELECT count(*) AS count FROM schema_migrations').get(),
      ).toEqual({ count: 3 });
      expect(
        sqlite
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'graphs'",
          )
          .get(),
      ).toEqual({ count: 1 });
    });
  });

  it('preserves existing graphs while enabling code and execution nodes', () => {
    withMemoryDatabase((sqlite) => {
      const migrations = loadMigrations();
      applyMigrations(sqlite, migrations.slice(0, 2));
      sqlite.transaction(() => {
        sqlite
          .prepare(
            'INSERT INTO graphs (id, version, created_at, updated_at) VALUES (?, 1, ?, ?)',
          )
          .run(
            'graph-upgrade',
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
          );
        sqlite
          .prepare(
            `INSERT INTO graph_nodes (
              id, graph_id, kind, role, title, tags_json,
              current_revision_id, created_at, updated_at, deleted_at
            ) VALUES (?, ?, 'note', NULL, ?, '[]', ?, ?, ?, NULL)`,
          )
          .run(
            'node-existing',
            'graph-upgrade',
            'Existing note',
            'revision-existing',
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
          );
        sqlite
          .prepare(
            `INSERT INTO node_revisions (
              id, graph_id, node_id, blocks_json, metadata_json, created_at
            ) VALUES (?, ?, ?, '[]', '{}', ?)`,
          )
          .run(
            'revision-existing',
            'graph-upgrade',
            'node-existing',
            '2026-01-01T00:00:00.000Z',
          );
      })();

      applyMigrations(sqlite, migrations);

      expect(
        sqlite
          .prepare('SELECT kind, title FROM graph_nodes WHERE id = ?')
          .get('node-existing'),
      ).toEqual({ kind: 'note', title: 'Existing note' });
      sqlite.transaction(() => {
        for (const kind of ['code', 'execution']) {
          sqlite
            .prepare(
              `INSERT INTO graph_nodes (
                id, graph_id, kind, role, title, tags_json,
                current_revision_id, created_at, updated_at, deleted_at
              ) VALUES (?, ?, ?, NULL, ?, '[]', ?, ?, ?, NULL)`,
            )
            .run(
              `node-${kind}`,
              'graph-upgrade',
              kind,
              `${kind} node`,
              `revision-${kind}`,
              '2026-01-01T00:00:01.000Z',
              '2026-01-01T00:00:01.000Z',
            );
          sqlite
            .prepare(
              `INSERT INTO node_revisions (
                id, graph_id, node_id, blocks_json, metadata_json, created_at
              ) VALUES (?, ?, ?, '[]', '{}', ?)`,
            )
            .run(
              `revision-${kind}`,
              'graph-upgrade',
              `node-${kind}`,
              '2026-01-01T00:00:01.000Z',
            );
        }
      })();
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    });
  });

  it('rejects a changed checksum for an applied migration', () => {
    withMemoryDatabase((sqlite) => {
      const first: Migration = {
        checksum: 'checksum-one',
        id: '0001_test',
        sql: 'CREATE TABLE test_table (id TEXT PRIMARY KEY) STRICT;',
      };
      applyMigrations(sqlite, [first]);

      expectDatabaseError(
        () =>
          applyMigrations(sqlite, [
            {
              ...first,
              checksum: 'checksum-two',
              sql: `${first.sql}\n-- changed`,
            },
          ]),
        'MIGRATION_CHECKSUM_MISMATCH',
      );
    });
  });

  it('rolls back every statement and migration record on failure', () => {
    withMemoryDatabase((sqlite) => {
      const failing: Migration = {
        checksum: 'failing-checksum',
        id: '0001_failing',
        sql: `
          CREATE TABLE should_rollback (id TEXT PRIMARY KEY) STRICT;
          THIS IS NOT SQL;
        `,
      };
      expectDatabaseError(
        () => applyMigrations(sqlite, [failing]),
        'MIGRATION_FAILED',
      );
      expect(
        sqlite
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'should_rollback'",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        sqlite.prepare('SELECT count(*) AS count FROM schema_migrations').get(),
      ).toEqual({ count: 0 });
    });
  });

  it('rejects an empty migrations directory', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'llm-graph-empty-migrations-'),
    );
    temporaryDirectories.push(directory);
    const directoryUrl = pathToFileURL(`${directory}/`);

    expectDatabaseError(() => loadMigrations(directoryUrl), 'MIGRATION_FAILED');
  });
});

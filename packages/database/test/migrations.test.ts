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
      ).toEqual({ count: 2 });
      expect(
        sqlite
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'graphs'",
          )
          .get(),
      ).toEqual({ count: 1 });
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

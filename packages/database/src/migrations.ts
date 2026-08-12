import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import type Database from 'better-sqlite3';

import { failDatabase } from './errors.js';

export interface Migration {
  readonly checksum: string;
  readonly id: string;
  readonly sql: string;
}

const migrationFilePattern = /^\d{4}_[A-Za-z0-9_-]+\.sql$/u;

export const defaultMigrationsDirectory = new URL(
  '../migrations/',
  import.meta.url,
);

export function loadMigrations(
  directory: URL = defaultMigrationsDirectory,
): readonly Migration[] {
  const migrations = readdirSync(directory)
    .filter((fileName) => migrationFilePattern.test(fileName))
    .sort()
    .map((fileName): Migration => {
      const sql = readFileSync(new URL(fileName, directory), 'utf8');
      return {
        checksum: createHash('sha256').update(sql).digest('hex'),
        id: fileName.slice(0, -'.sql'.length),
        sql,
      };
    });

  if (migrations.length === 0) {
    failDatabase('MIGRATION_FAILED', 'No database migrations were found', {
      details: { directory: directory.href },
    });
  }
  return migrations;
}

interface MigrationRow {
  readonly checksum: string;
  readonly id: string;
}

export function applyMigrations(
  sqlite: Database.Database,
  migrations: readonly Migration[] = loadMigrations(),
): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const findMigration = sqlite.prepare(
    'SELECT id, checksum FROM schema_migrations WHERE id = ?',
  );
  const recordMigration = sqlite.prepare(
    'INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of migrations) {
    const applied = findMigration.get(migration.id) as MigrationRow | undefined;
    if (applied !== undefined) {
      if (applied.checksum !== migration.checksum) {
        failDatabase(
          'MIGRATION_CHECKSUM_MISMATCH',
          `Applied migration ${migration.id} no longer matches its checksum`,
          { details: { migrationId: migration.id } },
        );
      }
      continue;
    }

    try {
      sqlite.transaction(() => {
        sqlite.exec(migration.sql);
        recordMigration.run(
          migration.id,
          migration.checksum,
          new Date().toISOString(),
        );
      })();
    } catch (error: unknown) {
      failDatabase('MIGRATION_FAILED', `Migration ${migration.id} failed`, {
        cause: error,
        details: { migrationId: migration.id },
      });
    }
  }
}

import Database from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';

import {
  applyMigrations,
  loadMigrations,
  type Migration,
} from './migrations.js';
import { databaseSchema } from './schema.js';

export interface OpenDatabaseOptions {
  readonly migrations?: readonly Migration[];
  readonly readonly?: boolean;
  readonly timeoutMilliseconds?: number;
}

export interface GraphDatabase {
  readonly db: BetterSQLite3Database<typeof databaseSchema>;
  readonly sqlite: Database.Database;
  close(): void;
}

export function openGraphDatabase(
  path: string,
  options: OpenDatabaseOptions = {},
): GraphDatabase {
  const sqlite = new Database(path, {
    readonly: options.readonly ?? false,
    timeout: options.timeoutMilliseconds ?? 5_000,
  });
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = FULL');
  sqlite.pragma('trusted_schema = OFF');
  if (path !== ':memory:' && !(options.readonly ?? false)) {
    sqlite.pragma('journal_mode = WAL');
  }

  if (!(options.readonly ?? false)) {
    applyMigrations(sqlite, options.migrations ?? loadMigrations());
  }

  return {
    close: () => {
      sqlite.close();
    },
    db: drizzle(sqlite, { schema: databaseSchema }),
    sqlite,
  };
}

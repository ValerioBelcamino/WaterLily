import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import type { Migration } from '@waterlily/database';

const migrationModules = import.meta.glob<string>(
  '../../../packages/database/migrations/*.sql',
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
);

export const bundledMigrations: readonly Migration[] = Object.entries(
  migrationModules,
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([path, sql]) => ({
    checksum: createHash('sha256').update(sql).digest('hex'),
    id: basename(path, '.sql'),
    sql,
  }));

if (bundledMigrations.length === 0)
  throw new Error('The desktop bundle contains no database migrations');

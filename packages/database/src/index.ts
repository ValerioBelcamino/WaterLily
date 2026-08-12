export {
  openGraphDatabase,
  type GraphDatabase,
  type OpenDatabaseOptions,
} from './connection.js';
export {
  DATABASE_ERROR_CODES,
  DatabaseError,
  type DatabaseErrorCode,
} from './errors.js';
export {
  applyMigrations,
  defaultMigrationsDirectory,
  loadMigrations,
  type Migration,
} from './migrations.js';
export { GraphRepository } from './repository.js';
export {
  WorkspaceRepository,
  type StoredWorkspace,
} from './workspaceRepository.js';
export {
  databaseSchema,
  graphEdges,
  graphNodes,
  graphWorkspaceState,
  graphs,
  nodeRevisions,
} from './schema.js';

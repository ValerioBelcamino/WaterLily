import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { GraphSnapshot, JsonValue } from '@waterlily/domain';

import { DatabaseError, failDatabase } from './errors.js';
import { GraphRepository } from './repository.js';
import { graphWorkspaceState } from './schema.js';
import type { databaseSchema } from './schema.js';

type GraphDrizzleDatabase = BetterSQLite3Database<typeof databaseSchema>;

export interface StoredWorkspace {
  readonly graph: GraphSnapshot;
  readonly state: JsonValue;
}

function assertJsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    failDatabase('INVALID_STATE', 'Workspace state numbers must be finite');
  }
  if (typeof value !== 'object') {
    failDatabase(
      'INVALID_STATE',
      'Workspace state must contain only JSON values',
    );
  }
  if (ancestors.has(value)) {
    failDatabase('INVALID_STATE', 'Workspace state cannot contain cycles');
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, ancestors);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      failDatabase(
        'INVALID_STATE',
        'Workspace state objects must be plain objects',
      );
    }
    for (const item of Object.values(value)) assertJsonValue(item, ancestors);
  }
  ancestors.delete(value);
}

export class WorkspaceRepository {
  readonly #db: GraphDrizzleDatabase;

  public constructor(db: GraphDrizzleDatabase) {
    this.#db = db;
  }

  public insert(workspace: StoredWorkspace): void {
    assertJsonValue(workspace.state);
    try {
      this.#db.transaction((transaction) => {
        new GraphRepository(transaction).insert(workspace.graph);
        transaction
          .insert(graphWorkspaceState)
          .values({ graphId: workspace.graph.id, state: workspace.state })
          .run();
      });
    } catch (error: unknown) {
      this.#rethrow(error, workspace.graph.id, 'insert');
    }
  }

  public replace(workspace: StoredWorkspace, expectedUpdatedAt: string): void {
    assertJsonValue(workspace.state);
    try {
      this.#db.transaction((transaction) => {
        new GraphRepository(transaction).replace(
          workspace.graph,
          expectedUpdatedAt,
        );
        transaction
          .insert(graphWorkspaceState)
          .values({ graphId: workspace.graph.id, state: workspace.state })
          .onConflictDoUpdate({
            set: { state: workspace.state },
            target: graphWorkspaceState.graphId,
          })
          .run();
      });
    } catch (error: unknown) {
      this.#rethrow(error, workspace.graph.id, 'replace');
    }
  }

  public get(graphId: string): StoredWorkspace | null {
    const graph = new GraphRepository(this.#db).get(graphId);
    if (graph === null) return null;
    try {
      const row = this.#db
        .select({ state: graphWorkspaceState.state })
        .from(graphWorkspaceState)
        .where(eq(graphWorkspaceState.graphId, graphId))
        .get();
      if (row === undefined) {
        failDatabase('CORRUPT_DATA', `Workspace ${graphId} has no state`, {
          details: { graphId },
        });
      }
      assertJsonValue(row.state);
      return { graph, state: row.state };
    } catch (error: unknown) {
      if (error instanceof DatabaseError) throw error;
      if (error instanceof SyntaxError) {
        failDatabase('CORRUPT_DATA', `Stored workspace ${graphId} is invalid`, {
          cause: error,
          details: { graphId },
        });
      }
      throw error;
    }
  }

  #rethrow(error: unknown, graphId: string, operation: string): never {
    if (error instanceof DatabaseError) throw error;
    failDatabase(
      'PERSISTENCE_FAILED',
      `Could not ${operation} workspace ${graphId}`,
      { cause: error, details: { graphId, operation } },
    );
  }
}

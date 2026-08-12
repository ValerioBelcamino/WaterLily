import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import {
  GraphDomainError,
  validateGraph,
  type GraphEdge,
  type GraphNode,
  type GraphSnapshot,
  type NodeRevision,
} from '@llm-graph/domain';

import { DatabaseError, failDatabase } from './errors.js';
import { graphEdges, graphNodes, graphs, nodeRevisions } from './schema.js';
import type { databaseSchema } from './schema.js';

type GraphDrizzleDatabase = BetterSQLite3Database<typeof databaseSchema>;

function insertRows(db: GraphDrizzleDatabase, graph: GraphSnapshot): void {
  db.insert(graphs)
    .values({
      createdAt: graph.createdAt,
      id: graph.id,
      updatedAt: graph.updatedAt,
      version: graph.version,
    })
    .run();

  const nodes = Object.values(graph.nodes).map((node) => ({
    createdAt: node.createdAt,
    currentRevisionId: node.currentRevisionId,
    deletedAt: node.deletedAt,
    graphId: graph.id,
    id: node.id,
    kind: node.kind,
    role: node.role,
    tags: node.tags,
    title: node.title,
    updatedAt: node.updatedAt,
  }));
  if (nodes.length > 0) {
    db.insert(graphNodes).values(nodes).run();
  }

  const revisions = Object.values(graph.revisions).map((revision) => ({
    blocks: revision.blocks,
    createdAt: revision.createdAt,
    graphId: graph.id,
    id: revision.id,
    metadata: revision.metadata,
    nodeId: revision.nodeId,
  }));
  if (revisions.length > 0) {
    db.insert(nodeRevisions).values(revisions).run();
  }

  const edges = Object.values(graph.edges).map((edge) => ({
    createdAt: edge.createdAt,
    graphId: graph.id,
    id: edge.id,
    kind: edge.kind,
    label:
      edge.kind === 'context' || edge.kind === 'reference' ? edge.label : null,
    relation: edge.kind === 'provenance' ? edge.relation : null,
    slot: edge.kind === 'context' ? edge.slot : null,
    sourceNodeId: edge.sourceNodeId,
    sourceRevisionId: edge.kind === 'reference' ? null : edge.sourceRevisionId,
    targetNodeId: edge.targetNodeId,
  }));
  if (edges.length > 0) {
    db.insert(graphEdges).values(edges).run();
  }
}

function toNode(row: typeof graphNodes.$inferSelect): GraphNode {
  return {
    createdAt: row.createdAt,
    currentRevisionId: row.currentRevisionId,
    deletedAt: row.deletedAt,
    id: row.id,
    kind: row.kind,
    role: row.role,
    tags: row.tags,
    title: row.title,
    updatedAt: row.updatedAt,
  };
}

function toRevision(row: typeof nodeRevisions.$inferSelect): NodeRevision {
  return {
    blocks: row.blocks,
    createdAt: row.createdAt,
    id: row.id,
    metadata: row.metadata,
    nodeId: row.nodeId,
  };
}

function toEdge(row: typeof graphEdges.$inferSelect): GraphEdge {
  const base = {
    createdAt: row.createdAt,
    id: row.id,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
  };
  if (row.kind === 'reference') {
    return { ...base, kind: row.kind, label: row.label };
  }
  if (row.sourceRevisionId === null) {
    failDatabase(
      'CORRUPT_DATA',
      `Causal edge ${row.id} has no source revision`,
      {
        details: { edgeId: row.id },
      },
    );
  }
  if (row.kind === 'context') {
    if (row.slot === null) {
      failDatabase('CORRUPT_DATA', `Context edge ${row.id} has no slot`, {
        details: { edgeId: row.id },
      });
    }
    return {
      ...base,
      kind: row.kind,
      label: row.label,
      slot: row.slot,
      sourceRevisionId: row.sourceRevisionId,
    };
  }
  if (row.relation === null) {
    failDatabase('CORRUPT_DATA', `Provenance edge ${row.id} has no relation`, {
      details: { edgeId: row.id },
    });
  }
  return {
    ...base,
    kind: row.kind,
    relation: row.relation,
    sourceRevisionId: row.sourceRevisionId,
  };
}

function indexById<Value extends { readonly id: string }>(
  values: readonly Value[],
): Readonly<Record<string, Value>> {
  return Object.fromEntries(values.map((value) => [value.id, value]));
}

export class GraphRepository {
  readonly #db: GraphDrizzleDatabase;

  public constructor(db: GraphDrizzleDatabase) {
    this.#db = db;
  }

  public insert(graph: GraphSnapshot): void {
    validateGraph(graph);
    try {
      this.#db.transaction((transaction) => {
        const existing = transaction
          .select({ id: graphs.id })
          .from(graphs)
          .where(eq(graphs.id, graph.id))
          .get();
        if (existing !== undefined) {
          failDatabase('ALREADY_EXISTS', `Graph ${graph.id} already exists`, {
            details: { graphId: graph.id },
          });
        }
        insertRows(transaction, graph);
      });
    } catch (error: unknown) {
      this.#rethrowPersistenceError(error, graph.id, 'insert');
    }
  }

  public replace(graph: GraphSnapshot, expectedUpdatedAt: string): void {
    validateGraph(graph);
    try {
      this.#db.transaction((transaction) => {
        const existing = transaction
          .select({ updatedAt: graphs.updatedAt })
          .from(graphs)
          .where(eq(graphs.id, graph.id))
          .get();
        if (existing === undefined) {
          failDatabase('NOT_FOUND', `Graph ${graph.id} does not exist`, {
            details: { graphId: graph.id },
          });
        }
        if (existing.updatedAt !== expectedUpdatedAt) {
          failDatabase(
            'CONFLICT',
            `Graph ${graph.id} changed since it was read`,
            {
              details: {
                actualUpdatedAt: existing.updatedAt,
                expectedUpdatedAt,
                graphId: graph.id,
              },
            },
          );
        }
        transaction.delete(graphs).where(eq(graphs.id, graph.id)).run();
        insertRows(transaction, graph);
      });
    } catch (error: unknown) {
      this.#rethrowPersistenceError(error, graph.id, 'replace');
    }
  }

  public get(graphId: string): GraphSnapshot | null {
    try {
      const graphRow = this.#db
        .select()
        .from(graphs)
        .where(eq(graphs.id, graphId))
        .get();
      if (graphRow === undefined) {
        return null;
      }
      const nodes = this.#db
        .select()
        .from(graphNodes)
        .where(eq(graphNodes.graphId, graphId))
        .all()
        .map(toNode);
      const revisions = this.#db
        .select()
        .from(nodeRevisions)
        .where(eq(nodeRevisions.graphId, graphId))
        .all()
        .map(toRevision);
      const edges = this.#db
        .select()
        .from(graphEdges)
        .where(eq(graphEdges.graphId, graphId))
        .all()
        .map(toEdge);
      const graph: GraphSnapshot = {
        createdAt: graphRow.createdAt,
        edges: indexById(edges),
        id: graphRow.id,
        nodes: indexById(nodes),
        revisions: indexById(revisions),
        updatedAt: graphRow.updatedAt,
        version: 1,
      };
      validateGraph(graph);
      return graph;
    } catch (error: unknown) {
      if (error instanceof DatabaseError && error.code === 'CORRUPT_DATA') {
        throw error;
      }
      if (error instanceof GraphDomainError || error instanceof SyntaxError) {
        failDatabase('CORRUPT_DATA', `Stored graph ${graphId} is invalid`, {
          cause: error,
          details: { graphId },
        });
      }
      throw error;
    }
  }

  #rethrowPersistenceError(
    error: unknown,
    graphId: string,
    operation: string,
  ): never {
    if (error instanceof DatabaseError || error instanceof GraphDomainError) {
      throw error;
    }
    failDatabase(
      'PERSISTENCE_FAILED',
      `Could not ${operation} graph ${graphId}`,
      {
        cause: error,
        details: { graphId, operation },
      },
    );
  }
}

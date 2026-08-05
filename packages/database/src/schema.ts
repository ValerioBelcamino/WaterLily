import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import type {
  ContentBlock,
  JsonValue,
  MessageRole,
  NodeKind,
  ProvenanceRelation,
} from '@waterlily/domain';

export const graphs = sqliteTable('graphs', {
  createdAt: text('created_at').notNull(),
  id: text('id').primaryKey(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
});

export const graphNodes = sqliteTable(
  'graph_nodes',
  {
    createdAt: text('created_at').notNull(),
    currentRevisionId: text('current_revision_id').notNull(),
    deletedAt: text('deleted_at'),
    graphId: text('graph_id')
      .notNull()
      .references(() => graphs.id, { onDelete: 'cascade' }),
    id: text('id').primaryKey(),
    kind: text('kind').$type<NodeKind>().notNull(),
    role: text('role').$type<MessageRole | null>(),
    tags: text('tags_json', { mode: 'json' })
      .$type<readonly string[]>()
      .notNull(),
    title: text('title'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('graph_nodes_graph_id_idx').on(table.graphId),
    uniqueIndex('graph_nodes_id_graph_id_unique_idx').on(
      table.id,
      table.graphId,
    ),
    check(
      'graph_nodes_role_check',
      sql`(${table.kind} = 'message' AND ${table.role} IS NOT NULL) OR (${table.kind} <> 'message' AND ${table.role} IS NULL)`,
    ),
  ],
);

export const nodeRevisions = sqliteTable(
  'node_revisions',
  {
    blocks: text('blocks_json', { mode: 'json' })
      .$type<readonly ContentBlock[]>()
      .notNull(),
    createdAt: text('created_at').notNull(),
    graphId: text('graph_id')
      .notNull()
      .references(() => graphs.id, { onDelete: 'cascade' }),
    id: text('id').primaryKey(),
    metadata: text('metadata_json', { mode: 'json' })
      .$type<Readonly<Record<string, JsonValue>>>()
      .notNull(),
    nodeId: text('node_id')
      .notNull()
      .references(() => graphNodes.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('node_revisions_graph_id_idx').on(table.graphId),
    index('node_revisions_node_id_idx').on(table.nodeId),
    uniqueIndex('node_revisions_id_node_id_unique_idx').on(
      table.id,
      table.nodeId,
    ),
  ],
);

export const graphEdges = sqliteTable(
  'graph_edges',
  {
    createdAt: text('created_at').notNull(),
    graphId: text('graph_id')
      .notNull()
      .references(() => graphs.id, { onDelete: 'cascade' }),
    id: text('id').primaryKey(),
    kind: text('kind')
      .$type<'context' | 'provenance' | 'reference'>()
      .notNull(),
    label: text('label'),
    relation: text('relation').$type<ProvenanceRelation | null>(),
    slot: integer('slot'),
    sourceNodeId: text('source_node_id')
      .notNull()
      .references(() => graphNodes.id, { onDelete: 'cascade' }),
    sourceRevisionId: text('source_revision_id').references(
      () => nodeRevisions.id,
    ),
    targetNodeId: text('target_node_id')
      .notNull()
      .references(() => graphNodes.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('graph_edges_graph_id_idx').on(table.graphId),
    index('graph_edges_source_idx').on(table.graphId, table.sourceNodeId),
    index('graph_edges_target_idx').on(table.graphId, table.targetNodeId),
    uniqueIndex('graph_edges_context_slot_unique_idx')
      .on(table.graphId, table.targetNodeId, table.slot)
      .where(sql`${table.kind} = 'context'`),
  ],
);

export const graphWorkspaceState = sqliteTable('graph_workspace_state', {
  graphId: text('graph_id')
    .primaryKey()
    .references(() => graphs.id, { onDelete: 'cascade' }),
  state: text('state_json', { mode: 'json' }).$type<JsonValue>().notNull(),
});

export const databaseSchema = {
  graphEdges,
  graphNodes,
  graphWorkspaceState,
  graphs,
  nodeRevisions,
};

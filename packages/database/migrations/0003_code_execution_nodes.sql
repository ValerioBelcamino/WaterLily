PRAGMA defer_foreign_keys = ON;

CREATE TABLE graph_nodes_next (
  id TEXT PRIMARY KEY NOT NULL,
  graph_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'message',
      'note',
      'excerpt',
      'summary',
      'attachment',
      'code',
      'execution'
    )
  ),
  role TEXT CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  title TEXT,
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  current_revision_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (id, graph_id),
  FOREIGN KEY (graph_id) REFERENCES graphs (id) ON DELETE CASCADE,
  FOREIGN KEY (current_revision_id, id)
    REFERENCES node_revisions_next (id, node_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (kind = 'message' AND role IS NOT NULL)
    OR (kind <> 'message' AND role IS NULL)
  )
) STRICT;

CREATE TABLE node_revisions_next (
  id TEXT PRIMARY KEY NOT NULL,
  graph_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  blocks_json TEXT NOT NULL CHECK (json_valid(blocks_json)),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE (id, node_id),
  FOREIGN KEY (graph_id) REFERENCES graphs (id) ON DELETE CASCADE,
  FOREIGN KEY (node_id, graph_id)
    REFERENCES graph_nodes_next (id, graph_id)
    ON DELETE CASCADE
) STRICT;

CREATE TABLE graph_edges_next (
  id TEXT PRIMARY KEY NOT NULL,
  graph_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('context', 'provenance', 'reference')),
  source_node_id TEXT NOT NULL,
  source_revision_id TEXT,
  target_node_id TEXT NOT NULL,
  slot INTEGER,
  label TEXT,
  relation TEXT CHECK (
    relation IN ('derived', 'excerpted', 'imported', 'summarized')
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (graph_id) REFERENCES graphs (id) ON DELETE CASCADE,
  FOREIGN KEY (source_node_id, graph_id)
    REFERENCES graph_nodes_next (id, graph_id)
    ON DELETE CASCADE,
  FOREIGN KEY (target_node_id, graph_id)
    REFERENCES graph_nodes_next (id, graph_id)
    ON DELETE CASCADE,
  FOREIGN KEY (source_revision_id, source_node_id)
    REFERENCES node_revisions_next (id, node_id),
  CHECK (
    (
      kind = 'context'
      AND source_revision_id IS NOT NULL
      AND slot IS NOT NULL
      AND slot >= 0
      AND relation IS NULL
    )
    OR (
      kind = 'provenance'
      AND source_revision_id IS NOT NULL
      AND slot IS NULL
      AND label IS NULL
      AND relation IS NOT NULL
    )
    OR (
      kind = 'reference'
      AND source_revision_id IS NULL
      AND slot IS NULL
      AND relation IS NULL
    )
  )
) STRICT;

INSERT INTO graph_nodes_next SELECT * FROM graph_nodes;
INSERT INTO node_revisions_next SELECT * FROM node_revisions;
INSERT INTO graph_edges_next SELECT * FROM graph_edges;

DROP TABLE graph_edges;
DROP TABLE node_revisions;
DROP TABLE graph_nodes;

ALTER TABLE graph_nodes_next RENAME TO graph_nodes;
ALTER TABLE node_revisions_next RENAME TO node_revisions;
ALTER TABLE graph_edges_next RENAME TO graph_edges;

CREATE INDEX graph_nodes_graph_id_idx ON graph_nodes (graph_id);
CREATE INDEX node_revisions_graph_id_idx ON node_revisions (graph_id);
CREATE INDEX node_revisions_node_id_idx ON node_revisions (node_id);
CREATE INDEX graph_edges_graph_id_idx ON graph_edges (graph_id);
CREATE INDEX graph_edges_source_idx ON graph_edges (graph_id, source_node_id);
CREATE INDEX graph_edges_target_idx ON graph_edges (graph_id, target_node_id);

CREATE UNIQUE INDEX graph_edges_semantic_unique_idx
  ON graph_edges (
    graph_id,
    kind,
    source_node_id,
    COALESCE(source_revision_id, ''),
    target_node_id
  );

CREATE UNIQUE INDEX graph_edges_context_slot_unique_idx
  ON graph_edges (graph_id, target_node_id, slot)
  WHERE kind = 'context';

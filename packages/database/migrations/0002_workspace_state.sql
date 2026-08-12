CREATE TABLE graph_workspace_state (
  graph_id TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  FOREIGN KEY (graph_id) REFERENCES graphs (id) ON DELETE CASCADE
) STRICT;

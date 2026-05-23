CREATE TABLE context_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT,
  task_id TEXT,
  run_id TEXT,
  source_message_id TEXT,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  confidence REAL,
  version INTEGER NOT NULL,
  owner_id TEXT,
  owner_type TEXT,
  created_by TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deprecated_at INTEGER
);

CREATE TABLE context_versions (
  context_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  PRIMARY KEY (context_id, version)
);

CREATE INDEX idx_ctx_workspace_scope ON context_items (workspace_id, scope, status);
CREATE INDEX idx_ctx_room ON context_items (room_id, status);
CREATE INDEX idx_ctx_task ON context_items (task_id, status);

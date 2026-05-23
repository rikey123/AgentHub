CREATE TABLE events (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('main', 'detail', 'both')),
  workspace_id TEXT,
  room_id TEXT,
  task_id TEXT,
  run_id TEXT,
  agent_id TEXT,
  trace_id TEXT,
  causation_id TEXT,
  correlation_id TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_events_seq ON events (seq);
CREATE INDEX idx_events_workspace_created ON events (workspace_id, created_at);
CREATE INDEX idx_events_room_created ON events (room_id, created_at);
CREATE INDEX idx_events_run_created ON events (run_id, created_at);
CREATE INDEX idx_events_trace ON events (trace_id);
CREATE INDEX idx_events_type_created ON events (type, created_at);
CREATE INDEX idx_events_room_visibility ON events (room_id, visibility, seq);

CREATE TABLE outbox (
  event_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enqueued_at INTEGER NOT NULL,
  dispatched_at INTEGER
);

CREATE TABLE handler_cursors (
  handler_name TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE dead_letter_events (
  id TEXT PRIMARY KEY,
  handler_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  last_error TEXT NOT NULL,
  failed_at INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE run_locks (
  lock_type TEXT NOT NULL CHECK (lock_type IN ('agent', 'room', 'file', 'workspace')),
  lock_key TEXT NOT NULL,
  workspace_id TEXT,
  run_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (lock_type, lock_key)
);

CREATE TABLE command_records (
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_type TEXT NOT NULL,
  command_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  trace_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (actor_type, actor_id, idempotency_key)
);

CREATE INDEX idx_outbox_pending ON outbox (status, seq) WHERE status = 'pending';
CREATE INDEX idx_dlq_handler ON dead_letter_events (handler_name, status);
CREATE INDEX idx_run_locks_runid ON run_locks (run_id);
CREATE INDEX idx_run_locks_workspace ON run_locks (workspace_id, lock_type);
CREATE INDEX idx_command_records_expires ON command_records (expires_at);

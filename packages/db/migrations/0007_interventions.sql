CREATE TABLE interventions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  source_agent_id TEXT NOT NULL,
  target_run_id TEXT,
  target_message_id TEXT,
  target_context_id TEXT,
  target_artifact_id TEXT,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  preview TEXT,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  snoozed_until INTEGER,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX idx_int_room_status ON interventions (room_id, status);
CREATE INDEX idx_int_source_status ON interventions (source_agent_id, status);

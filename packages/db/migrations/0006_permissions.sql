CREATE TABLE permission_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE permission_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT,
  profile_id TEXT,
  resource_type TEXT NOT NULL,
  resource_match TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ask', 'allow', 'deny')),
  remember INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE permission_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT,
  agent_id TEXT,
  run_id TEXT,
  adapter_session_id TEXT,
  idempotency_key TEXT,
  resource TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL,
  remember_decision INTEGER NOT NULL DEFAULT 0,
  scope TEXT,
  decision TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  expires_at INTEGER
);

CREATE INDEX idx_permission_rules_workspace_agent ON permission_rules (workspace_id, agent_id, resource_type);
CREATE INDEX idx_permission_requests_run_status ON permission_requests (run_id, status);
CREATE UNIQUE INDEX idx_permission_requests_pending_idempotency
  ON permission_requests (adapter_session_id, idempotency_key)
  WHERE status = 'pending' AND adapter_session_id IS NOT NULL AND idempotency_key IS NOT NULL;

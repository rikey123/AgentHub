-- 0014_v10.sql
-- V1.0 orchestration schema additions.

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name TEXT NOT NULL,
  avatar TEXT,
  description TEXT,
  prompt TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  default_permission_profile_id TEXT,
  tags TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  source_path TEXT,
  version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_roles_workspace ON roles (workspace_id, name);

CREATE TABLE runtimes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  command TEXT,
  args TEXT,
  env TEXT,
  detected_at INTEGER,
  detected_path TEXT,
  detected_version TEXT,
  supported_caps TEXT NOT NULL DEFAULT '[]',
  version TEXT,
  status TEXT,
  manifest_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_runtimes_workspace_kind ON runtimes (workspace_id, kind);

CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  base_url TEXT,
  api_key_ref TEXT,
  api_key_fingerprint TEXT,
  temperature REAL,
  max_tokens INTEGER,
  reasoning TEXT,
  extra TEXT,
  profile TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_model_configs_workspace ON model_configs (workspace_id, provider);

CREATE TABLE agent_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  role_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  model_config_id TEXT,
  override_permission_profile_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_agent_bindings_role ON agent_bindings (role_id);
CREATE INDEX idx_agent_bindings_runtime ON agent_bindings (runtime_id);

CREATE TABLE role_drafts (
  job_id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  target_work TEXT,
  preferred_tone TEXT,
  capabilities TEXT,
  model_config_id TEXT NOT NULL,
  draft_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'streaming', 'completed', 'failed', 'cancelled')),
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_role_drafts_expires_at ON role_drafts (expires_at);

CREATE TABLE task_activities (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'run_started', 'run_completed', 'run_failed', 'artifact_linked', 'blocker_set', 'status_change', 'assignee_change', 'priority_change', 'delegation_created')),
  by_kind TEXT NOT NULL CHECK (by_kind IN ('user', 'role', 'system')),
  by TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_task_activities_task_created ON task_activities (task_id, created_at DESC);

ALTER TABLE rooms ADD COLUMN leader_role_id TEXT;
ALTER TABLE tasks ADD COLUMN assignee_role_id TEXT;
ALTER TABLE tasks ADD COLUMN assignee_binding_id TEXT;
ALTER TABLE tasks ADD COLUMN delegation_chain TEXT;
ALTER TABLE tasks ADD COLUMN expects_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_participants ADD COLUMN agent_binding_id TEXT;

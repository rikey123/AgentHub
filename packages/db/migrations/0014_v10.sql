-- 0014_v10.sql
-- V1.0 orchestration schema additions.

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  permission_profile_id TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  source_path TEXT,
  version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE runtimes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  command TEXT,
  args TEXT,
  env TEXT,
  detected_at INTEGER,
  version TEXT,
  status TEXT,
  manifest TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  base_url TEXT,
  api_key_ref TEXT,
  api_key_fingerprint TEXT,
  profile TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE agent_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  role_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  model_config_id TEXT,
  name TEXT,
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
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_role_drafts_expires_at ON role_drafts (expires_at);

CREATE TABLE task_activities (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  actor_id TEXT,
  actor_type TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_task_activities_task_id ON task_activities (task_id, created_at DESC);

ALTER TABLE rooms ADD COLUMN leader_role_id TEXT;
ALTER TABLE tasks ADD COLUMN assignee_role_id TEXT;
ALTER TABLE tasks ADD COLUMN assignee_binding_id TEXT;
ALTER TABLE tasks ADD COLUMN delegation_chain TEXT;
ALTER TABLE tasks ADD COLUMN expects_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_participants ADD COLUMN agent_binding_id TEXT;

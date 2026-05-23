CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  room_id TEXT,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  assignee_agent_id TEXT,
  source_run_id TEXT,
  source_message_id TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  priority TEXT,
  due_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT,
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  adapter_id TEXT,
  adapter_session_id TEXT,
  provider_conversation_id TEXT,
  parent_run_id TEXT,
  status TEXT NOT NULL,
  wake_reason TEXT,
  waiting_reason TEXT,
  workspace_path TEXT,
  work_dir TEXT,
  workspace_mode TEXT,
  context_version INTEGER,
  target_files TEXT NOT NULL DEFAULT '[]',
  mailbox_claim_count INTEGER NOT NULL DEFAULT 0,
  pid_at_start INTEGER,
  claimed_at INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  cost_usd REAL,
  model_id TEXT,
  failure_class TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_runs_room_started ON runs (room_id, started_at);
CREATE INDEX idx_runs_agent_started ON runs (agent_id, started_at);
CREATE INDEX idx_runs_workspace_status ON runs (workspace_id, status);
CREATE INDEX idx_tasks_room_status ON tasks (room_id, status);
CREATE INDEX idx_tasks_assignee ON tasks (assignee_agent_id, status);
CREATE INDEX idx_tasks_parent ON tasks (parent_task_id);
CREATE INDEX idx_task_runs_task ON task_runs (task_id, created_at);
CREATE INDEX idx_task_runs_run ON task_runs (run_id);

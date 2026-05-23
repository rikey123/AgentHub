CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('solo', 'assisted', 'team', 'squad', 'war_room')),
  default_context_scope TEXT NOT NULL DEFAULT 'room',
  primary_agent_id TEXT,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE room_participants (
  room_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  participant_type TEXT NOT NULL CHECK (participant_type IN ('agent', 'user')),
  role TEXT NOT NULL,
  adapter_id TEXT,
  adapter_session_id TEXT,
  default_presence TEXT NOT NULL DEFAULT 'observing',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, participant_id)
);

CREATE TABLE agent_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  model TEXT,
  role_prompt TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '{}',
  permission_profile_id TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  source_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE agent_presence (
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('offline', 'observing', 'knocking', 'active', 'busy', 'blocked', 'error')),
  reason TEXT,
  status_line TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, agent_id)
);

CREATE INDEX idx_rooms_workspace_updated ON rooms (workspace_id, updated_at);
CREATE INDEX idx_agent_profiles_workspace ON agent_profiles (workspace_id, hidden);

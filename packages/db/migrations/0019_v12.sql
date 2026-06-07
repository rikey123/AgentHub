-- 0019_v12.sql
-- V1.2 contract-week schema foundation for artifact studio + deployment stubs.

ALTER TABLE rooms ADD COLUMN pinned_at INTEGER;
ALTER TABLE rooms ADD COLUMN last_activity_at INTEGER;

ALTER TABLE artifacts ADD COLUMN kind TEXT;

ALTER TABLE tasks ADD COLUMN last_unblocked_at INTEGER;

ALTER TABLE agent_bindings ADD COLUMN avatar_url TEXT;
ALTER TABLE agent_bindings ADD COLUMN contact_name TEXT;
ALTER TABLE agent_bindings ADD COLUMN contact_description TEXT;

ALTER TABLE artifact_files ADD COLUMN mime_type TEXT;
ALTER TABLE artifact_files ADD COLUMN size_bytes INTEGER;

CREATE TABLE artifact_versions (
  id               TEXT PRIMARY KEY,
  artifact_id      TEXT NOT NULL,
  version          INTEGER NOT NULL,
  content          TEXT,
  storage_path     TEXT,
  content_encoding TEXT NOT NULL DEFAULT 'text' CHECK (content_encoding IN ('text', 'binary')),
  metadata         TEXT,
  created_at       INTEGER NOT NULL,
  created_by       TEXT,
  message          TEXT,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
  UNIQUE (artifact_id, version),
  CHECK (
    (content_encoding = 'text' AND content IS NOT NULL AND storage_path IS NULL) OR
    (content_encoding = 'binary' AND content IS NULL AND storage_path IS NOT NULL)
  )
);

CREATE TABLE deployment_providers (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('caprover', 'dokploy', 'coolify')),
  name           TEXT NOT NULL,
  base_url       TEXT NOT NULL,
  credential_ref TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE deployments (
  id                   TEXT PRIMARY KEY,
  artifact_id          TEXT NOT NULL,
  room_id              TEXT,
  workspace_id         TEXT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('preview-url', 'static-site', 'source-zip', 'container-export', 'container-build', 'self-hosted')),
  provider             TEXT NOT NULL DEFAULT 'agenthub-local' CHECK (provider IN ('agenthub-local', 'caprover')),
  status               TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'in_progress', 'ready', 'failed', 'cancelled', 'expired', 'unpublished')),
  url                  TEXT,
  download_url         TEXT,
  image_tag            TEXT,
  provider_resource_id TEXT,
  provider_config_id   TEXT,
  source_path          TEXT,
  zip_path             TEXT,
  dockerfile_path      TEXT,
  log_path             TEXT,
  error                TEXT,
  pid                  TEXT,
  artifact_version     INTEGER,
  last_error           TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  started_at           INTEGER,
  finished_at          INTEGER,
  cancelled_at         INTEGER,
  expires_at           INTEGER,
  published_at         INTEGER,
  unpublished_at       INTEGER,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (provider_config_id) REFERENCES deployment_providers(id) ON DELETE SET NULL
);

CREATE TABLE wake_outbox (
  id             TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  reason         TEXT NOT NULL,
  payload        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatching', 'dispatched', 'failed')),
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  last_error     TEXT,
  created_at     INTEGER NOT NULL,
  dispatch_after INTEGER,
  dispatched_at  INTEGER,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agent_profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_artifact_versions_artifact_id ON artifact_versions(artifact_id, version DESC);
CREATE INDEX idx_deployment_providers_workspace_id ON deployment_providers(workspace_id, kind);
CREATE INDEX idx_deployments_artifact_id ON deployments(artifact_id, created_at DESC);
CREATE INDEX idx_deployments_status ON deployments(status, updated_at DESC);
CREATE INDEX idx_wake_outbox_status_dispatch_after ON wake_outbox(status, dispatch_after, created_at);

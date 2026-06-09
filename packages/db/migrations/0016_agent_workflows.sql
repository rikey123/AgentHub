-- 0016_agent_workflows.sql
-- Agent context workflow canvas foundations.

CREATE TABLE agent_workflows (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  room_id           TEXT,
  name              TEXT NOT NULL,
  description       TEXT,
  draft_version_id  TEXT,
  active_version_id TEXT,
  created_by        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER
);

CREATE INDEX idx_agent_workflows_workspace_name ON agent_workflows (workspace_id, name);
CREATE INDEX idx_agent_workflows_room ON agent_workflows (room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_agent_workflows_updated ON agent_workflows (workspace_id, updated_at DESC);
CREATE INDEX idx_agent_workflows_active_version ON agent_workflows (active_version_id) WHERE active_version_id IS NOT NULL;
CREATE INDEX idx_agent_workflows_draft_version ON agent_workflows (draft_version_id) WHERE draft_version_id IS NOT NULL;

CREATE TABLE agent_workflow_versions (
  id                      TEXT PRIMARY KEY,
  workflow_id             TEXT NOT NULL,
  version_number          INTEGER NOT NULL,
  state                   TEXT NOT NULL CHECK (state IN ('draft', 'locked')),
  valid                   INTEGER NOT NULL DEFAULT 0 CHECK (valid IN (0, 1)),
  validation_errors       TEXT NOT NULL DEFAULT '[]',
  viewport_json           TEXT NOT NULL DEFAULT '{}',
  created_from_version_id TEXT,
  locked_from_version_id  TEXT,
  locked_at               INTEGER,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  UNIQUE(workflow_id, version_number)
);

CREATE INDEX idx_agent_workflow_versions_workflow_state ON agent_workflow_versions (workflow_id, state);
CREATE INDEX idx_agent_workflow_versions_workflow_updated ON agent_workflow_versions (workflow_id, updated_at DESC);
CREATE UNIQUE INDEX idx_agent_workflow_versions_unique_draft ON agent_workflow_versions (workflow_id) WHERE state = 'draft';

CREATE TABLE agent_workflow_nodes (
  id                  TEXT PRIMARY KEY,
  workflow_version_id TEXT NOT NULL,
  node_id             TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('agent_context', 'note')),
  display_name        TEXT NOT NULL,
  agent_binding_id    TEXT,
  role_label          TEXT,
  prompt              TEXT NOT NULL DEFAULT '',
  position_x          REAL NOT NULL,
  position_y          REAL NOT NULL,
  width               REAL,
  height              REAL,
  enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  locked              INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  config_json         TEXT NOT NULL DEFAULT '{}',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE(workflow_version_id, node_id)
);

CREATE INDEX idx_agent_workflow_nodes_version ON agent_workflow_nodes (workflow_version_id);
CREATE INDEX idx_agent_workflow_nodes_agent_binding ON agent_workflow_nodes (agent_binding_id) WHERE agent_binding_id IS NOT NULL;

CREATE TABLE agent_workflow_edges (
  id                  TEXT PRIMARY KEY,
  workflow_version_id TEXT NOT NULL,
  edge_id             TEXT NOT NULL,
  source_node_id      TEXT NOT NULL,
  target_node_id      TEXT NOT NULL,
  label               TEXT,
  enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  config_json         TEXT NOT NULL DEFAULT '{}',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE(workflow_version_id, edge_id),
  UNIQUE(workflow_version_id, source_node_id, target_node_id)
);

CREATE INDEX idx_agent_workflow_edges_version ON agent_workflow_edges (workflow_version_id);
CREATE INDEX idx_agent_workflow_edges_source ON agent_workflow_edges (workflow_version_id, source_node_id);
CREATE INDEX idx_agent_workflow_edges_target ON agent_workflow_edges (workflow_version_id, target_node_id);

CREATE TABLE agent_workflow_runs (
  id                  TEXT PRIMARY KEY,
  workflow_id         TEXT NOT NULL,
  workflow_version_id TEXT NOT NULL,
  workspace_id        TEXT NOT NULL,
  room_id             TEXT,
  status              TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  seed_context        TEXT,
  started_by          TEXT,
  started_at          INTEGER,
  ended_at            INTEGER,
  failure_reason      TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX idx_agent_workflow_runs_workflow_status ON agent_workflow_runs (workflow_id, status, created_at DESC);
CREATE INDEX idx_agent_workflow_runs_version ON agent_workflow_runs (workflow_version_id, created_at DESC);
CREATE INDEX idx_agent_workflow_runs_workspace ON agent_workflow_runs (workspace_id, created_at DESC);
CREATE INDEX idx_agent_workflow_runs_room ON agent_workflow_runs (room_id, created_at DESC) WHERE room_id IS NOT NULL;

CREATE TABLE agent_workflow_node_runs (
  id                  TEXT PRIMARY KEY,
  workflow_run_id     TEXT NOT NULL,
  workflow_node_id    TEXT NOT NULL,
  node_id             TEXT NOT NULL,
  agent_run_id        TEXT,
  agent_binding_id    TEXT,
  status              TEXT NOT NULL CHECK (status IN ('waiting', 'queued', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
  input_context_json  TEXT NOT NULL DEFAULT '[]',
  output_context_json TEXT,
  error               TEXT,
  queued_at           INTEGER,
  started_at          INTEGER,
  completed_at        INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE(workflow_run_id, node_id)
);

CREATE INDEX idx_agent_workflow_node_runs_run_status ON agent_workflow_node_runs (workflow_run_id, status);
CREATE INDEX idx_agent_workflow_node_runs_workflow_node ON agent_workflow_node_runs (workflow_node_id);
CREATE INDEX idx_agent_workflow_node_runs_agent_run ON agent_workflow_node_runs (agent_run_id) WHERE agent_run_id IS NOT NULL;

CREATE TABLE agent_workflow_edge_deliveries (
  id                   TEXT PRIMARY KEY,
  workflow_run_id      TEXT NOT NULL,
  workflow_edge_id     TEXT NOT NULL,
  edge_id              TEXT NOT NULL,
  source_node_id       TEXT NOT NULL,
  target_node_id       TEXT NOT NULL,
  source_node_run_id   TEXT,
  target_node_run_id   TEXT,
  mailbox_message_id   TEXT,
  status               TEXT NOT NULL CHECK (status IN ('queued', 'mailbox_created', 'delivered', 'failed', 'skipped', 'cancelled')),
  context_json         TEXT NOT NULL DEFAULT '{}',
  idempotency_key      TEXT,
  attempt_count        INTEGER NOT NULL DEFAULT 0,
  error                TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  delivered_at         INTEGER
);

CREATE INDEX idx_agent_workflow_edge_deliveries_run_status ON agent_workflow_edge_deliveries (workflow_run_id, status);
CREATE INDEX idx_agent_workflow_edge_deliveries_edge ON agent_workflow_edge_deliveries (workflow_edge_id);
CREATE INDEX idx_agent_workflow_edge_deliveries_source ON agent_workflow_edge_deliveries (workflow_run_id, source_node_id);
CREATE INDEX idx_agent_workflow_edge_deliveries_target ON agent_workflow_edge_deliveries (workflow_run_id, target_node_id);
CREATE INDEX idx_agent_workflow_edge_deliveries_mailbox ON agent_workflow_edge_deliveries (mailbox_message_id) WHERE mailbox_message_id IS NOT NULL;
CREATE UNIQUE INDEX idx_agent_workflow_edge_deliveries_idempotency ON agent_workflow_edge_deliveries (workflow_run_id, edge_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

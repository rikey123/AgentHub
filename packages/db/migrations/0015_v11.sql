-- 0015_v11.sql
-- V1.1 multi-agent schema additions.
-- All new tables and columns land in one migration (D1) to prevent migration-number
-- collisions across three parallel feature branches.

-- ---------------------------------------------------------------------------
-- task_checkpoints: mid-flight context handoff (D2.8)
-- Stores a snapshot of task progress when a run terminates unexpectedly so the
-- next wake for the same task can inject a <prior-progress> block.
-- Schema per specs/multi-agent-reliability/spec.md §mid-flight-handoff:
--   progress_summary: last assistant message text, truncated to 2000 chars
--   files_touched: JSON array of paths written during the run
-- ---------------------------------------------------------------------------
CREATE TABLE task_checkpoints (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL,
  run_id           TEXT NOT NULL,
  progress_summary TEXT NOT NULL,
  files_touched    TEXT NOT NULL,  -- JSON array of file paths
  created_at       INTEGER NOT NULL
);

CREATE INDEX idx_task_checkpoints_task ON task_checkpoints (task_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- task_plans: planning phase output (D8)
-- Stores the PlanDocument produced by the leader's plan-phase wake.
-- ---------------------------------------------------------------------------
CREATE TABLE task_plans (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  plan_json    TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_task_plans_room ON task_plans (room_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- run_file_changes: per-run file change tracking (D12)
-- Written on session.ended; multiple rows per task accumulate over time.
-- ---------------------------------------------------------------------------
CREATE TABLE run_file_changes (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL,
  task_id          TEXT,
  files_changed    TEXT NOT NULL,  -- JSON: [{path, change, linesAdded, linesRemoved}]
  created_at       INTEGER NOT NULL
);

CREATE INDEX idx_run_file_changes_run ON run_file_changes (run_id);
CREATE INDEX idx_run_file_changes_task ON run_file_changes (task_id) WHERE task_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- skills: workspace skill packages (D9)
-- ---------------------------------------------------------------------------
CREATE TABLE skills (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  content      TEXT NOT NULL,   -- SKILL.md body (frontmatter + instructions)
  origin       TEXT NOT NULL CHECK (origin IN ('builtin', 'workspace', 'imported')),
  source_url   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE INDEX idx_skills_workspace ON skills (workspace_id, name);

-- ---------------------------------------------------------------------------
-- skill_files: supporting files within a skill package (D9)
-- ---------------------------------------------------------------------------
CREATE TABLE skill_files (
  id        TEXT PRIMARY KEY,
  skill_id  TEXT NOT NULL,
  path      TEXT NOT NULL,      -- relative path within skill package
  content   TEXT NOT NULL,
  UNIQUE(skill_id, path)
);

CREATE INDEX idx_skill_files_skill ON skill_files (skill_id);

-- ---------------------------------------------------------------------------
-- room_skills: skill pool assigned to a room (D9)
-- ---------------------------------------------------------------------------
CREATE TABLE room_skills (
  room_id   TEXT NOT NULL,
  skill_id  TEXT NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  PRIMARY KEY(room_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- agent_skills: per-participant skill overrides (D9)
-- mode = 'add' means add this skill on top of the room pool;
-- mode = 'restrict' means restrict to only this skill (remove others).
-- ---------------------------------------------------------------------------
CREATE TABLE agent_skills (
  room_participant_id TEXT NOT NULL,
  skill_id            TEXT NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('add', 'restrict')),
  PRIMARY KEY(room_participant_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- New columns on existing tables
-- ---------------------------------------------------------------------------

-- tasks.blocker_reason: structured reason when a task enters blocked/review state (D6)
ALTER TABLE tasks ADD COLUMN blocker_reason TEXT;

-- tasks.max_turns: per-task turn limit (D2.7)
ALTER TABLE tasks ADD COLUMN max_turns INTEGER;

-- tasks.board_column: user-overridden Kanban column placement (D11)
ALTER TABLE tasks ADD COLUMN board_column TEXT;

-- rooms.stalled_at: set when Level-2 timeout fires (D4)
ALTER TABLE rooms ADD COLUMN stalled_at INTEGER;

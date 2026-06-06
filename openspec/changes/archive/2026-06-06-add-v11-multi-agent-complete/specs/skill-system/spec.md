## ADDED Requirements

### Requirement: Skill package data model and storage (skill-data-model)

The system SHALL store skills as standard Agent Skill packages: a `SKILL.md` file with YAML frontmatter (`name`, `description`) plus optional supporting files. This is the same format used by Claude Code (`.claude/skills/`), OpenCode (`.opencode/skills/`), AionUi, and Multica.

**Reference:** WenzAgent `skill_manager.dart` — `Skill` interface with `id`, `name`, `description`, `content`, `tools`, lifecycle methods. Multica `skill` + `skill_file` tables — metadata + file content stored in DB. AionUi `src/process/resources/skills/_builtin/` — builtin skills as standard SKILL.md packages.

**Schema:**
```sql
skills (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  content      TEXT NOT NULL,   -- full SKILL.md body
  origin       TEXT NOT NULL,   -- builtin | workspace | imported
  source_url   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE(workspace_id, name)
)

skill_files (
  id        TEXT PRIMARY KEY,
  skill_id  TEXT NOT NULL REFERENCES skills(id),
  path      TEXT NOT NULL,      -- relative path within skill package
  content   TEXT NOT NULL,      -- UTF-8 text only; binary assets deferred to V1.3
  UNIQUE(skill_id, path)
)

room_skills (
  room_id   TEXT NOT NULL REFERENCES rooms(id),
  skill_id  TEXT NOT NULL REFERENCES skills(id),
  enabled   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(room_id, skill_id)
)

agent_skills (
  room_participant_id TEXT NOT NULL,
  skill_id            TEXT NOT NULL REFERENCES skills(id),
  mode                TEXT NOT NULL CHECK(mode IN ('add', 'restrict')),
  PRIMARY KEY(room_participant_id, skill_id)
)
```

**Builtin skills** are shipped with AgentHub as standard SKILL.md packages (`origin = "builtin"`). V1.1 ships at minimum: `task-planner` (helps agents break work into tasks) and `skill-creator` (helps users create new skills). These are NOT platform tool groups — platform tools remain controlled by `roles.capabilities`.

**Frontend:** Settings → Skills page lists all workspace skills with name, description, and origin badge. Users can create new skills (SKILL.md editor), import from URL, or browse builtin skills. There is NO global workspace-level enabled/disabled toggle — skill activation is managed at the room level (room settings) and agent level (Members panel overrides). This avoids a three-layer priority conflict (`workspace disabled + room enabled + agent add`).

- Each skill row: "Edit" (workspace/imported only), "Delete" (workspace/imported only), "View" (builtin)
- Builtin skills cannot be edited or deleted
- "New Skill" button → opens SKILL.md editor modal
- "Import" button → URL input or file picker

#### Scenario: User creates a workspace skill

- **WHEN** the user opens Settings → Skills and clicks "New Skill", fills in name/description/content, and saves
- **THEN** a `skills` row is created with `origin = "workspace"`; `skill.created` (durable, visibility: `detail`) is published; the skill appears in the skill list

#### Scenario: Builtin skills are available on first launch

- **WHEN** AgentHub starts for the first time in a workspace
- **THEN** builtin skills (`task-planner`, `skill-creator`) are seeded into the `skills` table with `origin = "builtin"`; they appear in Settings → Skills with a "Built-in" badge

#### Scenario: Skill with supporting files stores them in skill_files

- **WHEN** a user imports a skill package that includes `SKILL.md` and `scripts/run.sh`
- **THEN** the `skills` row stores the SKILL.md content; a `skill_files` row stores `scripts/run.sh` with `path = "scripts/run.sh"`

### Requirement: Room and agent skill assignment (skill-assignment)

The system SHALL allow users to assign skills to rooms (room-level pool) and to individual agents within a room (per-agent overrides). The room-level pool defines which skills are available to all agents in the room. Per-agent overrides can add skills not in the room pool or restrict skills that are in the pool.

**Reference:** AionUi `src/process/resources/skills/` — skills assigned per agent; `enabledSkills` list per conversation. Multica `agent_skill` table — `agent_id` + `skill_id` junction. WenzAgent `SkillLifecycleManager` — skills loaded per agent session.

**REST endpoints:**
```
GET  /rooms/:id/skills                          → list room skill assignments
POST /rooms/:id/skills { skillId, enabled }     → add/update room skill
DELETE /rooms/:id/skills/:skillId               → remove from room pool

GET  /rooms/:id/participants/:pid/skills        → list agent skill overrides
POST /rooms/:id/participants/:pid/skills { skillId, mode }  → add/restrict
DELETE /rooms/:id/participants/:pid/skills/:skillId         → remove override
```

**Frontend:**
- Room creation dialog: "Skills" section with multi-select from workspace skills
- Room settings (accessible from room header): skill pool management
- Members panel: each member row has a "Skills" expand section showing their effective skill set (room pool + overrides)
- Settings → Skills: each skill shows which rooms it's assigned to

#### Scenario: User assigns a skill to a room

- **WHEN** the user opens room settings and enables the "task-planner" skill
- **THEN** a `room_skills` row is created; `skill.activated { skillId, roomId }` (durable, visibility: `detail`) is published; all agents in the room will receive this skill on their next wake

#### Scenario: Agent-level skill restriction

- **WHEN** the user restricts the "terminal-access" skill for a specific reviewer agent in a room
- **THEN** an `agent_skills` row is created with `mode = "restrict"`; the reviewer's effective skill set excludes "terminal-access" even though it's in the room pool

### Requirement: Runtime-native skill materialization (skill-materialization)

The system SHALL materialize selected skills into the runtime's expected skill directory before each run starts. This enables runtimes to discover skills natively without AgentHub teaching them how to use skills.

**Reference:** AionUi `src/process/team/` — skills placed in runtime-specific directories; `claude: ['.claude/skills']`, `codex: ['.codex/skills']`, `opencode: ['.opencode/skills']`, `qwen: ['.qwen/skills']`, `cursor: ['.cursor/skills']`, `goose: ['.goose/skills']`. OpenCode skill discovery scans `.claude/skills/**/SKILL.md`, `.agents/skills/**/SKILL.md`, `{skill,skills}/**/SKILL.md`. Multica: "不教 runtime 怎么用 skill，只把文件摆到 runtime 已经会扫的位置" (don't teach the runtime how to use skills, just place files where it already scans).

**Runtime directory mapping:**

| Runtime | Skill directory |
|---------|----------------|
| Claude Code | `.claude/skills/<skillName>/` |
| Codex | `.codex/skills/<skillName>/` |
| OpenCode | `.opencode/skills/<skillName>/` |
| Qwen | `.qwen/skills/<skillName>/` |
| Cursor | `.cursor/skills/<skillName>/` |
| Native (AgentHub) | `.agenthub/skills/<skillName>/` |

**Materialization scope (critical invariant):** Skills are materialized per-run, scoped to that run's workspace. For isolated-worktree runs, skills are written into the worktree's runtime skill directory. For shared-mode runs, skills are written into a run-scoped temp overlay. `SkillRegistry.cleanupRun(runId)` removes materialized files in the run terminal hook. This prevents cross-room skill leakage when multiple rooms share the same workspace root.

**Fallback for runtimes without native skill discovery:** inject a skill index (name + description list) into the first-message system prompt, followed by full SKILL.md content for each selected skill. This matches AionUi's fallback model.

**Skill lifecycle events (complete table):**

| Event | Durability | Visibility | Payload | Consumer |
|-------|-----------|-----------|---------|---------|
| `skill.created` | durable | `detail` | `{ skillId, workspaceId, name, origin }` | audit/debug; Settings refreshes via REST |
| `skill.updated` | durable | `detail` | `{ skillId, workspaceId }` | audit/debug; Settings refreshes via REST |
| `skill.deleted` | durable | `detail` | `{ skillId, workspaceId }` | audit/debug; Settings refreshes via REST |
| `skill.imported` | durable | `detail` | `{ skillId, workspaceId, sourceUrl }` | audit/debug; Settings refreshes via REST |
| `skill.activated` | durable | `detail` | `{ skillId, roomId?, participantId? }` | audit/debug; Members panel refreshes via REST |
| `skill.deactivated` | durable | `detail` | `{ skillId, roomId?, participantId? }` | audit/debug; Members panel refreshes via REST |
| `skill.materialization_failed` | durable | `main` | `{ skillId, runId, error }` | projector shows inline error in chat view |

`skill.*` events with `visibility: detail` are NOT consumed by the main projector. Settings UI and Members panel use REST-only (fetch on open, write-then-refresh) — the same pattern as V1.0 SettingsModal. `skill.materialization_failed` is the only skill event that requires a projector handler because it affects the chat view.

Both `"skill"` and `"worktree"` EventCategory values MUST be added to the `EventCategory` union type in `packages/protocol/src/events/registry.ts`.

`skill.materialization_failed` has `visibility: main` because it blocks run start and the user must see it in the chat view. When any selected skill fails to materialize, the daemon SHALL:
1. Publish `skill.materialization_failed { skillId, runId, error }` (durable, visibility: `main`).
2. Fail the run before adapter start (do NOT proceed with reduced capability).
3. If the run is task-associated, transition the task to `blocked` with `blocker_reason = "skill_materialization_failed"`.
4. Show an inline error in the chat view: "Skill '<name>' failed to load. The run has been stopped."

**Why block rather than proceed?** The user explicitly assigned skills to the room/agent. Proceeding silently with reduced capability violates the user's intent and produces unpredictable agent behavior. Blocking is the safe default; the user can fix the skill and retry.

**Frontend:** When `skill.materialization_failed` is received, the chat view shows an inline error with the skill name and error message. The Kanban card shows a "Skill error" badge if the task is blocked.

#### Scenario: Skills materialized before run starts

- **WHEN** a run starts for an agent in a room with 2 enabled skills
- **THEN** `SkillRegistry` writes `SKILL.md` (and any `skill_files`) for each skill into the runtime's skill directory within the run's workspace; the runtime discovers them natively

#### Scenario: Materialization failure blocks run start

- **WHEN** `SkillRegistry` fails to write a skill file (e.g., disk full)
- **THEN** `skill.materialization_failed` is published; the run is failed before adapter start; if task-associated, the task transitions to `blocked` with `blocker_reason = "skill_materialization_failed"`; the chat view shows an inline error with the skill name

#### Scenario: Skill files cleaned up after run ends

- **WHEN** a run reaches a terminal state (completed/failed/cancelled)
- **THEN** `SkillRegistry.cleanupRun(runId)` removes the materialized skill directories for that run; no skill files remain in the workspace after cleanup

#### Scenario: Cross-room isolation maintained

- **WHEN** Room A has skill-x enabled and Room B does not, and both rooms share the same workspace root
- **THEN** skill-x is materialized only into Room A's run workspace; Room B's run workspace does not contain skill-x files

### Requirement: Skill management Settings UI (skill-settings-ui)

The system SHALL provide a Skills tab in the Settings modal for managing workspace skills.

**Reference:** AionUi settings UI pattern — skills listed with enable/disable toggles, origin badges, and edit actions. Multica skill management — CRUD operations with workspace scoping.

**Settings → Skills tab layout:**
- Skill list: name, description, origin badge (Built-in / Workspace / Imported)
- No global enabled/disabled toggle — activation is room-level and agent-level only
- "New Skill" button → opens SKILL.md editor modal (name, description, content textarea)
- "Import" button → URL input or file picker for importing SKILL.md packages
- Each skill row: "Edit" (workspace/imported only), "Delete" (workspace/imported only), "View" (builtin)
- Builtin skills cannot be edited or deleted

**REST endpoints (Settings UI):**
```
GET    /skills                          → list workspace skills
POST   /skills { name, description, content, origin }  → create
GET    /skills/:id                      → get with skill_files
PUT    /skills/:id { name, description, content }      → update
DELETE /skills/:id                      → delete (workspace/imported only)
POST   /skills/import { url }           → import from URL
```

Settings UI uses REST-only (no SSE subscription) — same pattern as V1.0 SettingsModal. Fetch on open, write-then-refresh.

#### Scenario: User creates a new workspace skill

- **WHEN** the user clicks "New Skill", fills in name "code-reviewer-guide", description, and SKILL.md content, then saves
- **THEN** `POST /skills` creates the skill; the skill list refreshes; the new skill appears with a "Workspace" badge

#### Scenario: User imports a skill from GitHub URL

- **WHEN** the user clicks "Import", enters a GitHub raw URL to a SKILL.md file, and confirms
- **THEN** the daemon fetches the URL, parses the SKILL.md, creates a `skills` row with `origin = "imported"` and `source_url` set; the skill appears in the list with an "Imported" badge

## MODIFIED Requirements

### Requirement: V1.1 Task Board 占位（task-board）

The V1.1 task-board capability SHALL be considered fulfilled. The Kanban board view replaces the V1.0 flat task list. The system SHALL expose the Kanban board at the Side Panel Tasks tab and SHALL NOT return 404 for board-related operations.

**What V1.1 delivers:**
- Kanban board view replacing the V1.0 flat task list
- Drag-to-move columns with `task.column.moved` event
- Priority badge UI (priority changes use existing `task.activity.added { kind: "priority_change" }` — no new `task.priority.changed` event)
- Dependency arrows (visualization only; auto-dispatch is V1.2)
- File-change badge from `run_file_changes` via `run.file_changes.recorded` event
- Worktree apply/discard UI in task detail drawer
- "Execution Plan" card from `task_plans`

**What remains deferred:**
- `task.assigned.changed` event (V1.2)
- Topology / Dependency DAG views (V1.2)
- Full collaboration timeline (V1.2)

#### Scenario: V1.1 Kanban board is accessible

- **WHEN** the user opens the Side Panel Tasks tab in V1.1
- **THEN** the Kanban board is displayed; the 404 from the V1.0 placeholder is no longer returned

#### Scenario: V1.1 drag-to-move works

- **WHEN** the user drags a card to a different column
- **THEN** `task.column.moved` is published; all connected clients update without refresh

### Requirement: V1.1 多 Agent 协作可视化占位（collab-visualization）

V1.1 SHALL deliver the task-board foundation and dependency arrows. The system SHALL render dependency arrows between Kanban cards. The full collaboration timeline and topology views SHALL remain deferred to V1.2 and SHALL return 404 when accessed.

**What V1.1 delivers:**
- Dependency arrows between Kanban cards (visualization only)
- "Execution Plan" card in the side panel
- File-change badge per task

**What remains deferred to V1.2:**
- Timeline view (Jaeger-style agent wake/run/complete visualization)
- Topology view (who-waked-whom causation graph)
- Dependency DAG view (Task → SubTask → Run tree)

#### Scenario: V1.1 dependency arrows visible

- **WHEN** Task B depends on Task A and both are in the Kanban board
- **THEN** a dependency arrow is rendered from A to B; no 404 is returned for the board view

#### Scenario: Timeline view still returns 404 in V1.1

- **WHEN** the user navigates to `/timeline`
- **THEN** 404 is returned; the timeline view is V1.2

### Requirement: V1.2 Skill System 占位（skill-system）

The skill system placeholder SHALL be considered fulfilled in V1.1 (moved forward from V1.2). The system SHALL load skills from the `skills` table and SHALL NOT emit the V1.2 rejection warning. The V1.2 placeholder rejection (`"Skill <id> not loaded: skill system is V1.2"`) SHALL be removed.

**What V1.1 delivers:**
- Standard SKILL.md package format (compatible with Claude Code, OpenCode, AionUi, Multica)
- Builtin / workspace / imported skill origins
- Room-level skill pool and per-agent overrides
- Runtime-native materialization into `.claude/skills/`, `.opencode/skills/`, etc.
- Prompt-injection fallback for runtimes without native skill discovery
- Settings UI for skill management

**What remains deferred:**
- Skills marketplace / skills.sh integration (V1.3)
- Skill version management and update notifications (V1.3)
- Skill trust review workflow (V1.3)

#### Scenario: V1.1 skill system is active

- **WHEN** the user opens Settings → Skills in V1.1
- **THEN** the Skills tab is shown with builtin skills pre-loaded; the V1.2 placeholder rejection is no longer active

#### Scenario: Skill loader no longer rejects in V1.1

- **WHEN** the daemon starts with skills in `~/.agenthub/skills/`
- **THEN** skills are loaded normally; the V1.2 warning `"Skill <id> not loaded: skill system is V1.2"` is no longer emitted

## ADDED Requirements

### Requirement: Kanban board view for tasks side panel (kanban-board)

The system SHALL add a Kanban board view to the tasks side panel. The Tasks tab keeps a clear flat/grouped task list as the default view, and exposes the Kanban board from an "Open Kanban" button/modal for denser board operations. The board displays all active tasks in the current room as cards organized into columns.

**Reference:** Hermes-Kanban `kanban-parser.ts` — `KanbanCard` / `KanbanBoard` data model; column-based state machine. Multica frontend uses `@dnd-kit/core` + `@dnd-kit/sortable` for drag-and-drop. AionUi `TaskManager.ts` — task status as source of truth with UI column as derived view.

**Column mapping** (default, when `tasks.board_column IS NULL`):

| Task status | Default column |
|-------------|---------------|
| `pending` | Backlog |
| `in_progress` | In Progress |
| `blocked` | Waiting |
| `review` | Review |
| `completed` | Done |
| `cancelled` | (hidden by default) |

Users can drag cards between columns. A drag sets `tasks.board_column` to the target column name and publishes `task.column.moved` (durable, visibility: `both`). Dragging does NOT change `tasks.status` — the column is a view-layer override.

**Card anatomy** (per card):
- Task title
- Assignee avatar + name
- Priority badge (if set)
- Blocker indicator + reason text (if `status = "blocked"`)
- "N files changed" badge (from `run_file_changes` count)
- "Waiting on N tasks" indicator (if unresolved dependencies)
- Turn count / max_turns indicator (if `max_turns` is set)
- "Missing report" badge (if `blocker_reason = "missing_completion_report"`)
- "Conflict" badge (if worktree artifact is in `conflict` state)

**Frontend implementation:**
- Uses `@dnd-kit/core` + `@dnd-kit/sortable` (same library as Multica) for drag-and-drop
- Board state maintained in the projector: `boardColumns: Map<taskId, string>`, updated by `task.column.moved` and `task.status.changed` events
- `task.status.changed` updates the default column mapping when `board_column IS NULL`
- Board re-renders without page refresh via SSE projector

**Backend:** `POST /rooms/:id/tasks/:taskId/column { column: string }` — sets `board_column`, publishes `task.column.moved`. Accessible to users and leader agent via `room.update_task { boardColumn }`.

#### Scenario: Task moves to Done column on completion

- **WHEN** a task transitions to `completed` via `room.complete_task`
- **THEN** `task.status.changed { nextStatus: "completed" }` is published; the projector moves the card to the Done column without a page refresh; if the user had manually moved the card to a different column, the `board_column` override is cleared on terminal status

#### Scenario: User drags card to In Progress

- **WHEN** the user opens the Kanban modal and drags a Backlog card to the In Progress column
- **THEN** `POST /rooms/:id/tasks/:taskId/column { column: "In Progress" }` is called; `tasks.board_column = "In Progress"` is set; `task.column.moved` is published; all connected clients update without refresh

#### Scenario: Blocked card shows reason on card face

- **WHEN** a task has `status = "blocked"` and `blocker_reason = "Waiting for design approval"`
- **THEN** the card in the Waiting column shows a red blocker icon and the text "Waiting for design approval" directly on the card face

### Requirement: Task dependency visualization in Kanban (dependency-arrows)

The system SHALL surface `tasks.dependencies` (JSON array of task IDs) in the Kanban board as visual dependency arrows between cards. When a task has unresolved dependencies (dependencies whose status is not `completed`), the card SHALL display a "Waiting on N tasks" indicator.

**Reference:** Hermes-Kanban `KanbanCard.linkedCards` — wikilink-style card-to-card references rendered as visual connections. AionUi `TaskManager.ts` `blockedBy/blocks` bidirectional arrays — dependency state maintained atomically.

The system SHALL NOT automatically dispatch `WakeAgent` when dependencies complete in V1.1; automatic DAG execution is deferred to V1.2.

**Frontend:** Dependency arrows are rendered as SVG lines between cards in the same board view. The arrow points from the dependency (must complete first) to the dependent (waiting). When a dependency completes, the arrow disappears and the "Waiting on N tasks" counter decrements in real-time via SSE.

#### Scenario: Dependency arrow shown between cards

- **WHEN** Task B has `dependencies = ["<A.id>"]` and both tasks are visible in the Kanban board
- **THEN** an arrow is rendered from Task A's card to Task B's card; Task B's card shows "Waiting on 1 task"

#### Scenario: Dependency resolved, indicator clears

- **WHEN** Task A transitions to `completed`
- **THEN** the arrow from A to B disappears; B's "Waiting on 1 task" indicator clears; B remains in its current column (no automatic dispatch)

### Requirement: Per-task file change badge and diff viewer (file-change-badge)

The system SHALL display a "N files changed" badge on each Kanban card and provide a diff viewer in the task detail drawer. File change data is sourced from `run_file_changes` rows aggregated by `task_id`.

**Reference:** AionUi `WorkspaceSnapshotService.ts` line 70 — `compare()` generates diff between current workspace and baseline. Multica task detail shows file change summary per task. The pattern: file changes are tracked per-run and aggregated to the task level for display.

`run_file_changes` schema:
```sql
run_file_changes (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  task_id      TEXT,
  files_changed TEXT NOT NULL,  -- JSON: [{path, change, linesAdded, linesRemoved}]
  created_at   INTEGER NOT NULL
)
```

`adapter-bridge.ts` writes a `run_file_changes` row on `session.ended` using the accumulated `fs.writeTextFile` / `fs.deleteFile` events from the run, then publishes `run.file_changes.recorded` (durable, visibility: `both`) inside the same transaction.

**Event:** `run.file_changes.recorded` — durable, visibility: `both`, payload: `{ runId, taskId?, artifactId?, filesChangedCount: number, filesChanged: [{path, change, linesAdded, linesRemoved, artifactId?}] }`

`artifactId` is optional because the Dev A publisher may emit file-change metadata before the diff artifact is fully associated; when present it lets the Kanban file diff entry open the existing artifact diff viewer directly.

**Frontend:**
- Kanban card badge: "3 files changed" (aggregate count across all runs for the task)
- Task detail drawer: expandable file list with per-file change type (added/modified/deleted) and line counts
- Clicking a file opens the existing artifact diff viewer (already implemented in V0.5)
- Badge updates in real-time when `run.file_changes.recorded` (durable, visibility: `both`, payload: `{ runId, taskId?, artifactId?, filesChangedCount, filesChanged }`) is received via SSE projector

#### Scenario: File change badge appears after run completes

- **WHEN** a run for Task T writes 3 files and reaches `session.ended`
- **THEN** a `run_file_changes` row is written; the Kanban card for Task T shows "3 files changed"; the task detail drawer lists the 3 files with their change types

#### Scenario: Multiple runs accumulate file changes

- **WHEN** Task T has been attempted twice, with 2 files changed in run 1 and 1 file changed in run 2
- **THEN** the Kanban card shows "3 files changed" (aggregate); the task detail drawer shows two sections, one per run

### Requirement: Worktree apply/discard UI (worktree-ui)

The system SHALL provide UI controls for applying or discarding a worktree diff artifact. These controls appear in the task detail drawer when a `worktree_diff` artifact is in `ready_for_review` or `conflict` state.

**Reference:** AionUi `WorkspaceSnapshotService.ts` lines 125/135/145 — `stageFile()`, `unstageFile()`, `discardFile()` as explicit user actions. OpenCode worktree model: create — agent works — show diff — user explicitly applies. The pattern: no automatic merge; user or leader decides.

**Frontend:**
- Task detail drawer shows a "Changes ready to apply" section when `worktree_diff` artifact is `ready_for_review`
- "Apply changes" button — calls `POST /rooms/:id/worktrees/:runId/apply`
- "Discard changes" button — calls `POST /rooms/:id/worktrees/:runId/discard` (with confirmation dialog)
- If artifact is `conflict`: shows "Merge conflict" warning with the conflict diff; "Discard" button only
- Kanban card shows a "Ready to apply" badge (green) or "Conflict" badge (red)

**Backend:**
- `POST /rooms/:id/worktrees/:runId/apply` — runs `git apply`; on success publishes `worktree.applied`; on conflict publishes `worktree.conflict_detected` and transitions task to `blocked`
- `POST /rooms/:id/worktrees/:runId/discard` — deletes worktree directory; publishes `worktree.discarded`

#### Scenario: User applies worktree changes

- **WHEN** the user clicks "Apply changes" in the task detail drawer for a `ready_for_review` worktree diff
- **THEN** `git apply` runs; on success the artifact transitions to `applied`; the "Ready to apply" badge disappears; the worktree directory is deleted

#### Scenario: Apply detects conflict

- **WHEN** the user clicks "Apply changes" but `git apply` exits non-zero
- **THEN** the artifact transitions to `conflict`; the task transitions to `blocked` with `blocker_reason = "worktree_apply_conflict"`; the task detail drawer shows the conflict diff; the Kanban card shows a red "Conflict" badge

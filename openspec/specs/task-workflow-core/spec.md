# task-workflow-core Specification

## Purpose
TBD - created by archiving change add-v10-orchestration. Update Purpose after archive.
## Requirements
### Requirement: 最小 Task 数据模型（MVP 必须实现）

The system SHALL upgrade the V0 minimal Task model to a V1.0 product-level work unit. Task is the **non-chat authoritative work carrier** for multi-agent collaboration.

**V1.0 Task 数据模型扩展**：

```ts
type Task = {
  id: string                          // ULID
  workspaceId: string                 // 派生字段（通过 room_id → rooms.workspace_id），不存 tasks 表列
  roomId: string
  parentTaskId?: string               // 嵌套深度上限 5
  delegationChain?: DelegationStep[]  // JSON: [{byRoleId, atRunId, atTimestamp}, ...]
  title: string
  description?: string                // markdown
  priority: 0 | 1 | 2 | 3            // 0=low, 1=normal, 2=high, 3=urgent（V1.0 启用）
  status: TaskStatus
  expectsReview: boolean              // false=Squad 轻量路径；true=Team review 路径
  assigneeRoleId?: string             // 逻辑归属（Role 维度，UI 主要展示）
  assigneeBindingId?: string          // 本次派发实际执行者（Run 创建时 resolve）
  assigneeAgentId?: string            // V0.5 兼容字段，3 个月后 V1.4 删除
  sourceRunId?: string                // 创建时的 Run id
  createdByRoleId: string             // 'user' 或 leader role id
  createdAt: number
  updatedAt: number
}

type TaskStatus =
  | "pending"        // 已创建，未开始
  | "in_progress"    // assignee 已 wake 并 active
  | "blocked"        // 外部依赖阻塞 / 超时
  | "review"         // assignee 完成，等 leader 确认（仅 expectsReview=true）
  | "completed"      // 终态：完成
  | "cancelled"      // 终态：取消（包含"删除"语义）
```

**V1.0 新增 `task_activities` 表**（参考 multica `packages/views/issues/` 的 activity timeline）：

```sql
CREATE TABLE task_activities (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  kind            TEXT NOT NULL CHECK (kind IN (
    'comment', 'run_started', 'run_completed', 'run_failed',
    'artifact_linked', 'blocker_set', 'status_change',
    'assignee_change', 'priority_change', 'delegation_created'
  )),
  by_kind         TEXT NOT NULL CHECK (by_kind IN ('user','role','system')),
  by              TEXT NOT NULL,       -- user_id 或 role_id 或 'system'
  payload         TEXT,                -- JSON
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_task_activities_task_created ON task_activities (task_id, created_at DESC);
```

**Task 事件契约（严格）**：

- `task.created`（V0 已注册，visibility=both）：Task 创建时发
- `task.status.changed`（V0 已注册，visibility=both）：所有状态变化（含"删除"走 cancelled）
- `task.activity.added`（V1.0 新增，visibility=both）：非状态型活动（comment / run_started / run_completed / artifact / blocker / priority_change）
- **不引入** `task.updated`（状态变化走 `task.status.changed`，非状态活动走 `task.activity.added`）
- **不引入** `task.deleted`（删除走 `task.status.changed { nextStatus: "cancelled" }`）

#### Scenario: Task 创建时 emit task.created

- **WHEN** Leader 调 `room.delegate` 创建 Task
- **THEN** 同一事务内 INSERT tasks + emit `task.created { taskId, roomId, assigneeRoleId, expectsReview }`（durable, visibility=both）
- **AND** 前端 projector 收到 `task.created`，更新 Side Panel Tasks tab

#### Scenario: Task 状态变化 emit task.status.changed

- **WHEN** teammate Run 完成，Task status: in_progress → review
- **THEN** emit `task.status.changed { taskId, prevStatus: "in_progress", nextStatus: "review" }`（durable, visibility=both）
- **AND** 前端 projector 更新 Task 状态 chip

#### Scenario: 添加 comment emit task.activity.added

- **WHEN** 用户在 Task detail 添加 comment
- **THEN** INSERT task_activities 行 + emit `task.activity.added { taskId, kind: "comment", by: "user", payload: { text } }`（durable, visibility=both）
- **AND** 前端 projector 更新 Task detail activity timeline

#### Scenario: Task "删除"走 cancelled

- **WHEN** 用户删除 Task t1
- **THEN** UPDATE tasks.status='cancelled' + emit `task.status.changed { nextStatus: "cancelled", reason: "user_deleted" }`（durable, visibility=both）
- **AND** **不**发 `task.deleted` 事件（该事件类型在 V1.0 不存在）

### Requirement: Task Workflow UI（Side Panel Tasks tab）

The Web UI SHALL provide a Tasks tab in the Side Panel showing the current Room's tasks as a clear list by default, with the Kanban board (V1.1) available from an "Open Kanban" modal.

**布局**（参考 Hermes-Kanban `KanbanBoard` + Multica `@dnd-kit` 拖拽）：

- Kanban board view，按 column 分组（Backlog / In Progress / Waiting / Review / Done）；
- 每张卡片：priority badge + title + assignee role avatar + status badge + "N files changed" badge + blocker indicator + dependency indicator；
- 拖拽卡片到其他列：调用 `POST /rooms/:id/tasks/:taskId/column`，发 `task.column.moved`；
- 点击卡片打开 detail slide-over：title / description / assignee / parent + children tree / activity timeline / file changes / worktree apply-discard UI；
- "Execution Plan" card（collapsible）显示当前 `task_plans` 最新记录；
- 依赖箭头：SVG lines between cards with `dependencies` links。

**Task detail activity timeline**（参考 multica `packages/views/common/task-transcript/`）：

- 按 `created_at DESC` 展示 task_activities 条目；
- 每条 activity 显示：kind icon + by（role avatar 或 user）+ payload 摘要 + 时间；
- `run_completed` 类型 activity 含"查看 Run Detail"链接；
- File changes section：per-run file list with change type and line counts；
- Worktree section：apply/discard controls when `worktree_diff` artifact is `ready_for_review` or `conflict`。

#### Scenario: Side Panel Tasks tab 显示 Kanban board

- **WHEN** 用户切到 Side Panel Tasks tab
- **THEN** 显示当前 Room 的所有 Tasks，以 Kanban board 形式按 column 分组
- **AND** 前端 projector 订阅 `task.created` / `task.status.changed` / `task.activity.added` / `task.column.moved`（visibility=both），实时更新

#### Scenario: Task detail 显示 activity timeline 和 file changes

- **WHEN** 用户点击 Task t1 打开 detail slide-over
- **THEN** 显示 t1 的 activity timeline 和 file changes section（来自 `run_file_changes`）
- **AND** `run_completed` 条目含"查看 Run Detail"链接

#### Scenario: Execution Plan card visible in side panel

- **WHEN** the leader has produced a `PlanDocument` for the room
- **THEN** a collapsible "Execution Plan" card appears at the top of the Tasks tab showing the task breakdown and assignee roles

### Requirement: room.update_task MCP tool 扩展

The system SHALL extend `room.update_task` MCP tool to support V1.1 fields.

```ts
room.update_task({
  taskId: string
  // 状态变化
  status?: TaskStatus
  reason?: string
  // 非状态型活动
  addComment?: string
  setBlocker?: string
  clearBlocker?: boolean
  linkArtifact?: string
  // V1.1 新增字段
  boardColumn?: string             // 覆盖 board_column
  maxTurns?: number | null         // 设置或清除 turn limit
  blockerReason?: string           // 直接设置 blocker_reason
  // 字段更新
  priority?: "0" | "1" | "2" | "3"  // TEXT 类型，与现有 DB schema 一致；"0"=low, "1"=normal, "2"=high, "3"=urgent
  assigneeRoleId?: string
})
```

每次调用产生对应的 `task.status.changed` 或 `task.activity.added` 或 `task.column.moved` 事件（不产生 `task.updated`）。

#### Scenario: agent 设置 blocker reason

- **WHEN** teammate agent 调 `room.update_task { taskId: t1, status: "blocked", blockerReason: "API key missing" }`
- **THEN** UPDATE tasks.status='blocked', tasks.blocker_reason='API key missing' + emit `task.status.changed`（durable, visibility=both）
- **AND** Kanban card 显示 blocker reason

#### Scenario: agent 添加 comment

- **WHEN** teammate agent 调 `room.update_task { taskId: t1, addComment: "Found a bug in line 42" }`
- **THEN** INSERT task_activities 行（kind='comment'）+ emit `task.activity.added`（durable, visibility=both）
- **AND** **不**发 `task.updated` 事件

### Requirement: V1.1 schema additions for multi-agent collaboration (v11-schema)

The system SHALL add the following columns and tables to support V1.1 multi-agent collaboration features. All additions are in `0015_v11.sql`.

**New columns on `tasks`:**
```sql
ALTER TABLE tasks ADD COLUMN blocker_reason TEXT;
ALTER TABLE tasks ADD COLUMN max_turns INTEGER;
ALTER TABLE tasks ADD COLUMN board_column TEXT;
```

**New columns on `rooms`:**
```sql
ALTER TABLE rooms ADD COLUMN stalled_at INTEGER;
```

**New tables:**
```sql
CREATE TABLE task_checkpoints (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL REFERENCES tasks(id),
  run_id           TEXT NOT NULL REFERENCES runs(id),
  progress_summary TEXT NOT NULL,   -- last assistant text, max 2000 chars
  files_touched    TEXT NOT NULL,   -- JSON array of paths
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_task_checkpoints_task ON task_checkpoints(task_id, created_at DESC);

CREATE TABLE task_plans (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id),
  run_id     TEXT NOT NULL REFERENCES runs(id),
  plan_json  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_task_plans_room ON task_plans(room_id, created_at DESC);

CREATE TABLE run_file_changes (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(id),
  task_id       TEXT REFERENCES tasks(id),
  files_changed TEXT NOT NULL,   -- JSON: [{path, change, linesAdded, linesRemoved}]
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_run_file_changes_task ON run_file_changes(task_id);
CREATE INDEX idx_run_file_changes_run  ON run_file_changes(run_id);
```

#### Scenario: V1.1 schema migration runs cleanly on V1.0 database

- **WHEN** the daemon starts with a V1.0 database and runs `0015_v11.sql`
- **THEN** all new columns and tables are created; existing rows are unaffected; the daemon starts normally

### Requirement: Kanban board supplements clear task list (kanban-modal)

The system SHALL keep a clear flat/grouped task list as the default Side Panel Tasks tab view and provide the Kanban board view defined in the `task-board` capability behind an "Open Kanban" button/modal.

**Reference:** Hermes-Kanban column-based state machine. Multica `@dnd-kit` drag-and-drop. The V1.0 list view was explicitly marked as "V1.1 做 Kanban" in the V1.0 spec.

The flat/grouped list is the primary glanceable task view. The Kanban board is the dense drag/drop view. The task detail slide-over (activity timeline, run links) is retained and accessible by clicking either a list row or a Kanban card.

#### Scenario: Tasks tab shows list and opens Kanban board

- **WHEN** the user opens the Side Panel Tasks tab in a room with tasks
- **THEN** the clear task list is displayed by default with an "Open Kanban" control
- **AND** clicking "Open Kanban" displays the Kanban board with tasks organized into columns


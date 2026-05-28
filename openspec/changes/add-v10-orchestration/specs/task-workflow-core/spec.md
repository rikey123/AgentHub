# task-workflow-core (V1.0 delta)

> **参考来源**：
> - **multica**（仅借模式）：
>   - `server/internal/handler/issue.go`：Issue 作为一等实体的字段集合 / 列表查询 / 子 issue / 状态机——V1.0 Task 数据模型直接对照此实现。
>   - `packages/core/issues/{ws-updaters,cache-helpers,queries,mutations}.ts`：所有 issue 变化通过 WS 实时推送 + 客户端 query cache 增量更新——V1.0 Task 的 SSE projector 模式对照此实现。
>   - `packages/views/issues/{actions,components,hooks,utils}/`：Issue list / detail / activity timeline / assignee filter / parent-child hierarchy——V1.0 Side Panel Tasks tab 的 UI 模式对照此实现。
>   - `server/internal/issueguard/`：防止重复创建 / parent depth 限制——V1.0 Task 防循环规则借鉴此模式。
> - **总线契约**：
>   - 写路径（V1.0 Task 事件契约，**不引入** `task.updated` / `task.deleted`）：
>     - Task 创建：沿用既有 `task.created`（visibility=both）
>     - Task 状态变化 / 取消 / 阻塞 / 完成：沿用既有 `task.status.changed`（visibility=both）
>     - 非状态型活动（comment / run_started / run_completed / artifact / blocker / priority_change）：emit `task.activity.added`（visibility=both）
>     - 派发链路：emit `task.delegation.created` / `task.delegation.completed`（visibility=both，由 squad-mode / team-mode 发）
>     - Task "删除"走 `task.status.changed { nextStatus: "cancelled" }`，不引入独立 `task.deleted` 事件
>   - 读路径：前端 projector 订阅 `task.created` / `task.status.changed` / `task.activity.added` / `task.delegation.*`（visibility=both），更新 Side Panel Tasks tab + Task detail view model
>   - 失败路径：Task 超时 → emit `task.status.changed { nextStatus: "blocked", reason: "timeout" }`（durable, visibility=both）

## MODIFIED Requirements

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

The Web UI SHALL provide a Tasks tab in the Side Panel showing the current Room's tasks grouped by status. V1.0 is a minimal list view; drag-and-drop Kanban is V1.1.

**布局**（参考 multica `packages/views/issues/components/`）：

- 列表 view，按 status 分组（Backlog / In Progress / Blocked / Review / Done）；
- 每行：priority chip + title + assignee role avatar + status badge + updated_at；
- 点击 Task 打开 detail slide-over：title / description / assignee / parent + children tree / activity timeline；
- **不做**拖拽（V1.1）；**不做** search / filter / agent grouping（V1.1）。

**Task detail activity timeline**（参考 multica `packages/views/common/task-transcript/`）：

- 按 `created_at DESC` 展示 task_activities 条目；
- 每条 activity 显示：kind icon + by（role avatar 或 user）+ payload 摘要 + 时间；
- `run_completed` 类型 activity 含"查看 Run Detail"链接。

#### Scenario: Side Panel Tasks tab 显示 Task 列表

- **WHEN** 用户切到 Side Panel Tasks tab
- **THEN** 显示当前 Room 的所有 Tasks，按 status 分组
- **AND** 前端 projector 订阅 `task.created` / `task.status.changed` / `task.activity.added`（visibility=both），实时更新列表

#### Scenario: Task detail 显示 activity timeline

- **WHEN** 用户点击 Task t1 打开 detail slide-over
- **THEN** 显示 t1 的 activity timeline（comment / run_started / run_completed / artifact / status_change 等）
- **AND** `run_completed` 条目含"查看 Run Detail"链接，点击打开对应 Run Detail slide-over

### Requirement: room.update_task MCP tool 扩展

The system SHALL extend `room.update_task` MCP tool to support V1.0 activity operations.

```ts
room.update_task({
  taskId: string
  // 状态变化
  status?: TaskStatus
  reason?: string
  // 非状态型活动
  addComment?: string                  // markdown
  setBlocker?: string                  // blocker 描述
  linkArtifact?: string                // artifact id
  // 字段更新
  priority?: 0 | 1 | 2 | 3
  assigneeRoleId?: string              // 仅 leader 可改
})
```

每次调用产生对应的 `task.status.changed` 或 `task.activity.added` 事件（不产生 `task.updated`）。

#### Scenario: agent 添加 comment

- **WHEN** teammate agent 调 `room.update_task { taskId: t1, addComment: "Found a bug in line 42" }`
- **THEN** INSERT task_activities 行（kind='comment'）+ emit `task.activity.added`（durable, visibility=both）
- **AND** **不**发 `task.updated` 事件

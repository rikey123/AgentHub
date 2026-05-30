# squad-mode Specification

## Purpose
TBD - created by archiving change add-v10-orchestration. Update Purpose after archive.
## Requirements
### Requirement: Squad 模式调度

The system SHALL implement Squad Mode as a lightweight Leader-routing collaboration mode. Room.mode='squad' allows a Leader agent to receive user messages and route work to teammates via `room.delegate { expectsReview: false }`. **Squad also creates Tasks** (unlike the original design that proposed mailbox-only)—this prevents multi-agent chat loops by providing a non-chat authoritative work carrier.

**Squad 与 Team 的差异**：

- Squad：`room.delegate { expectsReview: false }` → Task 走 `pending → in_progress → completed`（**跳过** review）→ Leader 通过 mailbox + `task.delegation.completed` wake
- Team：`room.delegate { expectsReview: true }` → Task 走 `pending → in_progress → review → completed`（Leader 二次审阅）

**Squad Leader 时间线**（参考 multica `issue_child_done.go`）：

```
t=0   user 消息进 squad room
t=1   Leader Run 1 启动（reason='primary_turn'）
t=2   Leader 在 Run 1 内调 room.delegate × 2（expectsReview: false）
      → 创建 2 个 Task（status='pending'）
      → dispatch WakeAgent(teammate1, reason='delegated_task')
      → dispatch WakeAgent(teammate2, reason='delegated_task')
      → emit task.delegation.created × 2（durable, visibility=both）
t=3   Leader Run 1 终结（complete）
t=4-5 2 个 teammate Run 并行执行
t=6   teammate1 Run 完成 → Task1 status: pending→in_progress→completed
      → emit task.delegation.completed { taskId, byTeammateRunId }（durable, visibility=both）
      → mailbox 给 Leader（task summary）
t=7   Leader 收到 mailbox → wake Leader Run 2（reason='mailbox_received'）
t=8   Leader Run 2 汇总所有 teammate 结果 → 回复用户
```

**防循环规则**（参考 multica `issueguard/`）：

1. `parentTaskId` 嵌套深度上限 5；超出 → `room.delegate` 返回 `{ error: "delegation_too_deep" }` + audit log；
2. 同 room 同 leader 在 5 分钟内重复创建相同 title + description 的 Task → 拒绝（防 prompt loop）；
3. Task 在 `pending` / `in_progress` 状态下 30 分钟无更新 → emit `task.status.changed { nextStatus: "blocked", reason: "timeout" }`；Leader 收到 wake（reason='task_blocked'）决定重新 dispatch 或取消。

#### Scenario: Squad Leader 派发两个 teammate

- **WHEN** Squad Room 中用户发消息，Leader 在 Run 内调 `room.delegate { toRoleId: "reviewer", taskTitle: "Review auth.ts", expectsReview: false }`
- **THEN** 创建 Task（status='pending', assignee_role_id='reviewer', expectsReview=false）
- **AND** dispatch WakeAgent(reviewer binding, reason='delegated_task', taskId)
- **AND** emit `task.delegation.created { taskId, byRoleId: "project-manager", atRunId, expectsReview: false }`（durable, visibility=both）
- **AND** Leader Run 终结（不等 teammate）

#### Scenario: teammate 完成后 Leader 被 wake

- **WHEN** reviewer Run 完成，Task status 自动变 completed
- **THEN** emit `task.delegation.completed { taskId, byTeammateRunId }`（durable, visibility=both）
- **AND** mailbox 给 Leader（含 task summary）
- **AND** Orchestrator terminal hook wake Leader Run 2（reason='mailbox_received'）

#### Scenario: 防循环：嵌套深度超限

- **WHEN** Leader 尝试创建第 6 层嵌套 Task（parentTaskId 链深度 = 5）
- **THEN** `room.delegate` 返回 `{ error: "delegation_too_deep", maxDepth: 5 }`
- **AND** 不创建 Task，不 dispatch WakeAgent，audit log 记录

### Requirement: room.delegate MCP tool（V1.0 新增）

The system SHALL add `room.delegate` to the Room MCP Server tool list. This tool is the **only** way for a Leader agent to dispatch work to teammates; it creates a Task and dispatches WakeAgent in a single atomic operation.

```ts
room.delegate({
  toRoleId: string                 // 必填，必须 ∈ room teammate roles
  taskTitle: string
  taskDescription?: string         // markdown
  parentTaskId?: string            // 嵌套派发（深度上限 5）
  promptDelta: AgentPromptDelta    // 给 teammate 的 prompt
  expectsReview?: boolean          // 默认由 room.mode 决定（squad=false, team=true）
}): { taskId: string, runId: string }
```

**权限**：仅 `role=leader` 的 agent 可调用；非 leader 调用 → `{ error: "delegate_requires_leader_role" }`。

#### Scenario: room.delegate 原子创建 Task + dispatch

- **WHEN** Leader 调 `room.delegate { toRoleId: "builder", taskTitle: "Implement login", expectsReview: false }`
- **THEN** 同一事务内：INSERT tasks + dispatch WakeAgent(builder binding, reason='delegated_task') + emit task.delegation.created
- **AND** 返回 `{ taskId, runId }`

#### Scenario: 非 leader 调用被拒

- **WHEN** observer agent 调 `room.delegate`
- **THEN** 返回 `{ error: "delegate_requires_leader_role" }`；不创建 Task


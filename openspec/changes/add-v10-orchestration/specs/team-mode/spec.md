# team-mode (V1.0 delta)

> **参考来源**：
> - **multica**（仅借模式）：
>   - `server/internal/handler/issue_child_done.go`：子任务完成判定 + 父级回顾——Team Mode 的"所有子 Task 进 review 后 wake Leader"逻辑直接对照此实现。
>   - `server/internal/handler/issue.go`：Issue 状态机（pending/in_progress/review/completed/cancelled）——Team Mode Task 状态机沿用此模式。
> - **总线契约**：
>   - 写路径：`room.delegate { expectsReview: true }` → INSERT tasks（review Task）+ dispatch WakeAgent → emit `task.delegation.created`（durable, visibility=both）；所有 sibling Task 进 review → wake Leader → Leader approve → emit `task.delegation.completed`（durable, visibility=both）
>   - 读路径：前端 projector 订阅 `task.delegation.created/completed` + `task.status.changed`（visibility=both），更新 Side Panel Tasks tab + Run Detail Tools tab
>   - 失败路径：teammate Run fail → Task status=blocked → emit `task.status.changed`；Leader 收到 wake（reason='task_blocked'）

## ADDED Requirements

### Requirement: Team 模式调度

The system SHALL implement Team Mode as a task-decomposition collaboration mode. Room.mode='team' requires the Leader to use `room.delegate { expectsReview: true }` to create Tasks with review flow. All sibling Tasks must reach `review` status before the Leader is woken for approval.

**Team Leader 时间线**（参考 multica `issue_child_done.go`）：

```
t=0   user 消息进 team room
t=1   Leader Run 1 启动（reason='primary_turn'）
t=2   Leader 在 Run 1 内调 room.delegate × 3（expectsReview: true）
      → 创建 3 个 Task（status='pending', expectsReview=true）
      → dispatch WakeAgent × 3（reason='delegated_task'）
      → emit task.delegation.created × 3（durable, visibility=both）
t=3   Leader Run 1 终结（complete）
t=4-6 3 个 teammate Run 并行 / 串行（受 RunQueue 锁矩阵约束）
t=7   teammate1 Run 完成 → Task1 status: pending→in_progress→review
      → emit task.status.changed { nextStatus: "review" }（durable, visibility=both）
t=8   Orchestrator terminal hook：检查 sibling tasks——只有部分进 review，**不** wake Leader
t=9   3 个 Task 都进 review → wake Leader Run 2（reason='task_review', taskIds=[...]）
      → emit team.dispatch.started { leaderRunId, targetTaskIds }（durable, visibility=both）
t=10  Leader 在 Run 2 内审阅 → approve（task.status='completed'）或 dispatch 重做
t=11  所有 child task completed → wake Leader Run 3（reason='task_review_done'）
      → emit team.dispatch.completed { leaderRunId, taskIds, summary }（durable, visibility=both）
      → Leader 回复用户最终结果
```

**sibling Task 完成判定**（参考 multica `issue_child_done.go`）：

- Orchestrator terminal hook 在每个 teammate Run 终结时检查：该 Leader Run 派发的所有 sibling Tasks 是否全部 ∈ {review, completed, cancelled}；
- 全部满足 → wake Leader（reason='task_review'）；
- 有任一 Task 仍在 pending/in_progress/blocked → 不 wake Leader；
- 有任一 Task 超时（30 分钟无更新）→ emit `task.status.changed { nextStatus: "blocked", reason: "timeout" }` → wake Leader（reason='task_blocked'）。

#### Scenario: 所有子 Task 进 review 后 wake Leader

- **WHEN** 3 个 teammate Run 全部完成，3 个 Task 全部 status='review'
- **THEN** Orchestrator terminal hook wake Leader Run 2（reason='task_review', taskIds=[t1,t2,t3]）
- **AND** emit `team.dispatch.started { leaderRunId: run_2, targetTaskIds: [t1,t2,t3] }`（durable, visibility=both）

#### Scenario: Leader approve 子 Task

- **WHEN** Leader 在 Run 2 内调 `room.update_task { taskId: t1, status: "completed" }`
- **THEN** Task t1 status: review → completed
- **AND** emit `task.status.changed { taskId: t1, prevStatus: "review", nextStatus: "completed" }`（durable, visibility=both）

#### Scenario: Leader 要求重做

- **WHEN** Leader 在 Run 2 内调 `room.delegate { toRoleId: "builder", parentTaskId: t2, taskTitle: "Fix the bug in auth.ts", expectsReview: true }`
- **THEN** 创建新子 Task t2_retry（parentTaskId=t2）
- **AND** dispatch WakeAgent(builder, reason='delegated_task', taskId=t2_retry)
- **AND** t2 status 保持 review（等待 t2_retry 完成后再次进入 Leader review 流程）

#### Scenario: 子 Task 超时

- **WHEN** Task t3 在 in_progress 状态下 30 分钟无更新
- **THEN** emit `task.status.changed { taskId: t3, nextStatus: "blocked", reason: "timeout" }`（durable, visibility=both）
- **AND** wake Leader（reason='task_blocked', taskId=t3）
- **AND** Leader 决定重新 dispatch 或 cancel t3

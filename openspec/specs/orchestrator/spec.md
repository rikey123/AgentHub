# orchestrator Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: Solo 模式调度

In Solo mode, every user message SHALL trigger exactly one Run on the room's primary Agent **via `WakeAgent` Command alone**. Orchestrator MUST dispatch `WakeAgent`（origin='internal'）； WakeAgent handler atomically claims any mailbox and calls `RunLifecycleService.create(...)` in the same IMMEDIATE transaction. Orchestrator MUST NOT dispatch any other Command to create the Run, MUST NOT call adapters directly, and MUST go through `bus-runtime/RunQueue` for actual scheduling. **MVP 没有 `StartRun` Command**。

调度流程（与 `bus-runtime` 对齐，**WakeAgent 是模型调用唯一入口**）：

```
durable: message.created (role=user, turnDispatchMode='immediate')
  ↓ Orchestrator handler
  ├─ check room.mode === "solo"
  ├─ resolve primaryAgentId
  ├─ assembleContext({ agent, budget })  // 仅 read，不 mutate
  └─ commandBus.dispatch({
       type: "WakeAgent",
       roomId, agentId: primaryAgentId,
       reason: "primary_turn",
       triggerEventId: message.created.id,
       promptDelta: { kind: <first_wake|delta_only>, ... },
       idempotencyKey: `wake:msg:${messageId}:${primaryAgentId}`
     }, { origin: "internal" })
  ↓ WakeAgent handler (orchestrator 模块内部)
  └─ IMMEDIATE 单事务原子完成：
        1) activeWakes guard（已 active → append next_turn 而非新 run；详见唤醒去重）
        2) 原子认领 mailbox 未读消息（claimed_run_id=newRunId）
        3) RunLifecycleService.create({ runId: newRunId, agentId, roomId, wakeReason, mailboxClaimIds, promptDelta, ... })
           → service 在同事务内 INSERT runs(status='queued', wake_reason, mailbox_claim_count) + INSERT events(agent.run.queued) + INSERT outbox
        # WakeAgent handler 不再 dispatch StartRun（MVP 不存在该 Command）；不再做 INSERT runs 之外的事
  ↓ RunQueue Worker (subscribes agent.run.queued)
  ├─ try acquire (agent / room / file) locks
  ├─ ok → INSERT run_locks (事务 1)
  │       → RunLifecycleService.markClaimed(null, runId)        # 事务 2
  │       → RunLifecycleService.markStarting(null, runId, pid)  # 事务 3 + agent.run.started
  │       → AdapterManager.startRun(runId, profile, ...)
  │       → AdapterBridge subscribes adapter Stream<AdapterEvent>
  └─ blocked → publish agent.run.waiting (de-duplicated)
  ↓ AdapterBridge
  └─ translates AdapterEvent → durable events
       (tool.call.*, file.changed, agent.run.completed/failed/cancelled, ...)
```

**Orchestrator 边界**：

- Orchestrator 是 durable handler；订阅 `message.created` 后只 dispatch `WakeAgent`（origin='internal'）；**不**写 runs 表、**不**直接调 adapter、**不**发 `agent.run.*` durable event；**不**额外 dispatch 其它 Command（不存在 StartRun）。
- `assembleContext()` 是同步只读 query（详见订阅图谱"Allowed sync queries"），无副作用。
- `WakeAgent` 是 model 调用唯一入口（详见 `Observing 是被动状态 + WakeAgent`）。`agent.run.queued` 的唯一来源是 WakeAgent handler 调 `RunLifecycleService.create`。
- 普通用户消息唤醒 primary 用 `wakeReason="primary_turn"`；@mention 唤醒用 `"user_mention"`；rule 用 `"rule_review"`；这些都在 [P1-1b WakeReason 单一枚举] 中合并到同一份 `WakeReason` 枚举。

#### Scenario: Solo Room 用户发消息只 dispatch WakeAgent

- **WHEN** Solo Room 中用户发送一条 `message.created (turnDispatchMode='immediate')`
- **THEN** Orchestrator 调 `commandBus.dispatch(WakeAgent, { origin: "internal" })`；WakeAgent handler 在 IMMEDIATE 事务内 claim mailbox + 调 `RunLifecycleService.create` → `agent.run.queued` 在同事务发出；Orchestrator 自身不写 runs、不发任何 `agent.run.*` 事件，也不 dispatch 其它创建类 Command

#### Scenario: pending message 不触发 wake

- **WHEN** primary busy 时用户发消息，message 被标记 `turnDispatchMode='pending'` + 创建 PendingTurn
- **THEN** Orchestrator handler 看到 turnDispatchMode='pending' → **不** dispatch WakeAgent；等待上一轮终结后由 `ConsumePendingTurn` Command 内部触发 WakeAgent

#### Scenario: Solo Room 用户连发两条消息（primary busy）

- **WHEN** 在同一 Solo Room 用户在 1 秒内发 m1、m2 两条消息；m1 触发 primary busy
- **THEN** m1 走 immediate → WakeAgent → run_1；m2 因 primary busy 被 SendMessage handler 标记 turnDispatchMode='pending' + 创建 PendingTurn pt_2；Orchestrator handler 见到 m2 turnDispatchMode='pending' → 不 wake；run_1 终结后 Orchestrator 派发 `ConsumePendingTurn(pt_2)` → handler 内部 dispatch WakeAgent(reason='consume_pending_turn') → run_2

#### Scenario: 用户连发但显式 cancel 第一条

- **WHEN** m1 触发 run_1 后，用户 `POST /runs/run_1/cancel`，然后发 m2
- **THEN** `CancelRun` Command 触发 RunService UPDATE runs.status='cancelling' → AdapterBridge 收到 session.ended 后发 `agent.run.cancelled` → RunQueue 释放锁 → run_2 自动 started（按 PendingTurn 调度）

### Requirement: Assisted 模式调度

The system SHALL implement Assisted-mode scheduling such that:

1. 用户消息默认只触发 primary（通过 `WakeAgent { reason: "primary_turn" }`）。
2. `@<agentName>` 解析成 mention list；mention 中的 agent SHALL 临时进入 `active` 并被调度（与 primary 串行；@agent 顺序按 mention 在文本中出现顺序），通过 `WakeAgent { reason: "user_mention" }`。**V0.5 落实真实 dispatch 路径**（MVP §9.2 缺；之前仅枚举值存在）。
3. Observer MUST NOT 被普通用户消息直接唤醒，仅通过 `rule_review` / `knock_approved` / `group_review` / `phase_completed` / `agent_crashed` / `delegated_task` 进入。

`WakeReason` 的唯一定义见 `Observing 是被动状态 + WakeAgent`。本 spec 不再单独声明短枚举。

V0.5 dispatch 顺序（多 mention）：

- 在 `SendMessage` Command handler 内（daemon/commands.ts）解析 mentions（详见 `Mention 解析` Requirement）；
- 若 `room.mode='assisted'` 且 mention list 非空：① 先 dispatch `WakeAgent { reason: "primary_turn", ... }`（**仅当用户消息含 @primary 或不含任何 @ 时**——不含 @ 时仍走 primary，含 @ 但不含 primary 时**不**唤醒 primary）；② 再按文本出现顺序对每个 @agent dispatch `WakeAgent { reason: "user_mention", agentId: <each> }`；③ 每次 dispatch idempotencyKey = `wake:${messageId}:${agentId}`；
- 多 @ dispatch 之间**不串行等待**（CommandBus 各自异步），但 RunQueue 锁矩阵会按 (agent, room) 锁顺序保证同 agent 不并发；
- 所有 dispatch 都受唤醒去重（activeWakes guard）保护，重复 @ 已 active agent 走 `run_next_turns` 路径（详见 §19.12）。

#### Scenario: 用户 @ 多个 Agent 不含 primary

- **WHEN** Assisted Room 中用户消息 `"@security 检查这段，@reviewer 也看下" + DiffCard`，primary 是 builder
- **THEN** Orchestrator 顺序 dispatch WakeAgent(security, user_mention) → WakeAgent(reviewer, user_mention)
- **AND** primary（builder）**不被**本条消息触发（用户没 @ primary）
- **AND** RunQueue 按 agent 锁串行执行 security run → reviewer run

#### Scenario: 用户 @ primary 也 @ observer

- **WHEN** 用户消息 `"@builder 改下 @reviewer 看看"`
- **THEN** Orchestrator dispatch WakeAgent(builder, primary_turn) + WakeAgent(reviewer, user_mention)
- **AND** 两个 Run 因 RunQueue agent 锁不同可并行

#### Scenario: 用户消息不含 @ 走默认

- **WHEN** Assisted Room 中用户消息无 @
- **THEN** 仅 dispatch WakeAgent(primary, primary_turn)
- **AND** observer 不被触发

#### Scenario: 规则触发 Observer

- **WHEN** 用户 confirm 一个 DiffCard 中含 `auth.ts` 文件变更，规则配置 `match: { artifact.files: ["auth.ts"] }, wake: "security-reviewer"`
- **THEN** security-reviewer 状态转 `knocking`，发 `intervention.requested` 事件等待用户 approve；用户 approve 后转 `active` 并触发 run

### Requirement: Mailbox 是 durable inbox

The system SHALL persist Mailbox messages in a SQLite table; in-memory EventEmitter MUST NOT be used for cross-Agent message delivery.

```ts
type MailboxMessage = {
  id: string
  roomId: string
  from:
    | { type: "user"; id: string }
    | { type: "agent"; id: string }
    | { type: "system"; id: "system" }
  toAgentId: string
  kind:
    | "message"          // 自由文本
    | "task"             // 子任务派发
    | "context_patch"    // 建议的 ContextItem
    | "review_request"   // 评审请求
    | "intervention"     // 介入摘要
  content: string
  files?: string[]
  read: boolean
  createdAt: number
}
```

```sql
CREATE TABLE mailbox_messages (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL,
  from_type    TEXT NOT NULL,
  from_id      TEXT NOT NULL,
  to_agent_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,
  content      TEXT NOT NULL,
  files        TEXT,                    -- JSON array
  read         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_mb_to_room_unread ON mailbox_messages (to_agent_id, room_id, read);
```

#### Scenario: Observer 写 mailbox 给 primary

- **WHEN** Observer 通过 `room.send_message` 被 Permission 降级，content 转写到 mailbox
- **THEN** daemon 写 mailbox_messages 表，发 `mailbox.message.created` durable 事件；primary 下一次 `room.read_mailbox` 会读到

#### Scenario: daemon 重启后 mailbox 不丢

- **WHEN** 用户写过 mailbox 给 reviewer 后 daemon 重启
- **THEN** reviewer 在 reviewer 下一次被唤醒时调 `room.read_mailbox` 仍能看到该留言

### Requirement: Room MCP Tools

The system SHALL add `room.delegate` to the Room MCP Server tool list for V1.0 Squad/Team modes. All other existing tools remain unchanged.

新增工具（V1.0）：

| Tool | 描述 | 权限要求 |
|---|---|---|
| `room.delegate` | Leader 派发 Task 给 teammate（Squad/Team mode 专用）| role=leader |

`room.delegate` 完整规范见 `squad-mode/Squad 模式调度` Requirement。

#### Scenario: room.delegate 仅 leader 可调

- **WHEN** observer agent 调 `room.delegate`
- **THEN** 返回 `{ error: "delegate_requires_leader_role" }`；不创建 Task

### Requirement: Mention 解析

The system SHALL parse mentions in user messages by matching `@<agentName>` where agentName is the kebab-case `id` of an Agent participant in the room; matches MUST be at word boundaries. **V0.5 落实真实 parser 用于 Assisted 调度**（MVP 之前仅 spec 描述）。

正则：`/(^|\s)@([a-z0-9][a-z0-9-]*)\b/g`，且匹配的 `agentName` 必须在 `room.participants` 中。

V0.5 实现位置：`packages/orchestrator/src/mention-parser.ts`，导出 `parseMentions(text: string, members: AgentMember[]): MentionMatch[]`，按出现顺序返回 unique agent ids（去重保留首次出现位置）。前端 `@` 自动补全（详见 `web-ui/输入框`）插入的是已校验的 agentId，但后端仍重新解析以防客户端伪造。

#### Scenario: 邮箱地址不被误识别

- **WHEN** 用户消息 `"please CC reviewer@example.com about this"`
- **THEN** 不解析为 @ reviewer

#### Scenario: 不存在的 agent 名不解析

- **WHEN** 用户消息 `"@nonexistent please review"`
- **THEN** Orchestrator 不触发任何 run；UI 在消息下方显示警告"@nonexistent 不在本房间"

#### Scenario: 多 @ 去重保留首次出现顺序

- **WHEN** 用户消息 `"@reviewer 看下 @security 也看下 @reviewer 别忘了"`
- **THEN** parseMentions 返回 `[{agentId: "reviewer", offset: 0}, {agentId: "security", offset: 12}]`（reviewer 第二次出现被去重）

#### Scenario: 前端补全后后端仍重新解析

- **WHEN** 前端通过 `@` 补全插入 `@security` 但用户手改成 `@security-fake`
- **THEN** 后端 parseMentions 校验 `security-fake` 不在 members 中 → 不触发；UI 显示警告

### Requirement: 唤醒去重（loop guard）

The system SHALL track per-Agent `activeWakes` set; the same Agent MUST NOT be re-woken while it is already `active` or `working`.

```ts
type ActiveWakes = Map<roomId, Map<agentId, { wakeReason: WakeReason; runId?: string }>>
```

#### Scenario: 用户在 reviewer 还在跑时再 @ 它

- **WHEN** reviewer 处于 `working` 状态，用户又发消息 `@reviewer 还有一个`
- **THEN** Orchestrator 把新消息内容追加到 reviewer 当前 run 的 pending input（next_turn）；不并行启动第二个 run

#### Scenario: knock 已 pending 时再次 knock 去重

- **WHEN** Agent 已有 pending intervention，再次调 `room.request_intervention`
- **THEN** Tool 返回已存在的 interventionId，不创建新条目

### Requirement: 状态行节流

The system SHALL throttle agent status line updates (`agent.status_line.updated` ephemeral events) to at most 1 visible update per 30 seconds per Agent per Room. **V0.5 落实真实节流逻辑**（MVP §9.7 缺）。

实际写 events / publish 次数不限（adapter 仍按需发），UI 渲染节流由 daemon-side ephemeral PubSub coalesce + 客户端 Projector 节流双层实现：

- **Daemon 侧**：`agent.status_line.updated` 在 BoundedPubSub `status_line` 通道（capacity=64，drop_oldest+coalesce by `(agentId, roomId)`，与 §19.7 一致），daemon 仅每 30 秒 flush 一次该通道到 SSE。
- **客户端 Projector**：再做一层 30 秒节流（用 `requestAnimationFrame` + 时间戳判断），保证即便 daemon flush 偶尔超频也不刷新 UI。
- 进入 / 离开 working 状态的边界（如 `agent.run.started` / `completed` 时）**强制刷新**一次（不受节流约束），以保证状态过渡可见。

#### Scenario: 频繁状态更新

- **WHEN** Agent 在 60 秒内 emit 20 条 `agent.status_line.updated`（每 3 秒一条）
- **THEN** Daemon SSE 仅在 t=0 和 t=30 各推一次（每条携带最新合并状态）
- **AND** Web UI Projector 只更新 view model 2 次（30 秒一帧）

#### Scenario: Run 状态边界强制刷新

- **WHEN** Agent 在 t=10 emit `agent.run.completed`（即 working → idle 边界）
- **THEN** Daemon 立即 flush 该 agent 的 status_line（不等 30 秒窗口），SSE 推送
- **AND** UI 立刻看到状态从 "working" 变 "idle"

#### Scenario: 多 agent 节流相互独立

- **WHEN** agent A 和 agent B 同时频繁 emit status_line
- **THEN** A 和 B 的节流计时器独立（按 `(agentId, roomId)` 维度），A 的 flush 不影响 B 的窗口

### Requirement: 最小 Task 数据模型（MVP 必须实现）

The system SHALL persist a minimal `Task` entity in the `tasks` table so that:

1. Room MCP Tools `room.create_task` / `room.update_task` / `room.list_tasks` 有真实读写对象；
2. WakeReason `delegated_task` 能从 promptDelta 引用一个真实 `taskId`；
3. V1.1 `task-board` 直接消费此模型，**不**临时发明字段；
4. V1.0 Squad / Team 调度 Task 拆解 / 依赖 / 派发时复用此模型。

**MVP `tasks` 表 schema（必须落地）**：

```sql
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,             -- ULID
  room_id           TEXT NOT NULL REFERENCES rooms(id),
  parent_task_id    TEXT REFERENCES tasks(id),    -- V1.0 Team Mode 任务拆解才用；MVP 允许写但 orchestrator 忽略层级调度
  title             TEXT NOT NULL,
  description       TEXT,                          -- markdown
  status            TEXT NOT NULL,                 -- 见状态枚举
  assignee_agent_id TEXT REFERENCES agents(id),    -- 单 assignee（MVP）；V1.0 Team Mode 引入 multi-assignee 通过 tasks_assignees 联表
  source_run_id     TEXT REFERENCES runs(id),      -- 哪个 Run 创建的（room.create_task 调用时记录）；NULL = 用户在 UI 创建
  source_message_id TEXT REFERENCES messages(id),  -- 关联消息（如 user 通过 /task 命令创建）
  dependencies      TEXT,                          -- JSON array of taskId；MVP 写表但 orchestrator 调度忽略；V1.2 collab-visualization Dependency 视图消费
  priority          INTEGER DEFAULT 0,             -- MVP 仅占位（默认 0）；V1.1 task-board 启用 priority.changed
  due_at            INTEGER,                       -- epoch ms；MVP 仅占位
  created_by        TEXT NOT NULL,                 -- "user" | agentId
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_tasks_room_status ON tasks(room_id, status);
CREATE INDEX idx_tasks_assignee   ON tasks(assignee_agent_id, status);
CREATE INDEX idx_tasks_parent     ON tasks(parent_task_id);
```

**Task.status 枚举（MVP 唯一权威）**：

```ts
type TaskStatus =
  | "pending"        // 已创建，未开始（默认）
  | "in_progress"    // assignee 已 wake 并 active（由 RunLifecycle 联动设置：assignee 的 Run 进 running 时自动）
  | "blocked"        // 显式被外部依赖阻塞（permission pending / waiting on user / dependency 未完成）
  | "review"         // assignee 完成实质工作，等用户或 leader 确认；通常 link DiffArtifact 或 phase summary
  | "completed"      // 终态：被用户或 leader 标记完成
  | "cancelled"      // 终态：被用户或 leader 取消
```

终态规则：`completed` / `cancelled` 之后**不可**重新激活；如需重做请新建子 Task。

**Task ↔ Run 关联**：

- 一个 Task 在生命周期内**可能产生 0..N 个 Run**（assignee 可能被多次 wake；review 后可能 wake 第二次）；
- `runs.task_id` 列指向触发该 Run 的 Task（NULL 表示非 Task 驱动的 Run，如用户直接 @primary）；
- Run 终结时**不**自动改 Task.status；只有 `agent.run.completed` 后由 orchestrator handler 决定是否把 Task 推到 `review`（依据 promptDelta / phase 标记）。这避免 Run 完成 ≠ Task 完成的语义混乱。

**Task ↔ Room 投影**：

- Task 的所有 lifecycle 事件 visibility = `both`（主流 + Run Detail 都需要）；
- 主流不展示 Task 的 brief；Task 通过独立卡片 `TaskCard` 在主流引用一次（创建时），后续状态变化通过 SSE projector 在 UI 标记 Card 变化，**不**重复发主流消息（避免聊天流被状态变化淹没）。

**事件契约（与 `event-system/事件分级` canonical registry 一致）**：

- `task.created`：visibility=both，含 `{ taskId, roomId, parentTaskId?, title, assigneeAgentId?, sourceRunId?, createdBy }`
- `task.assigned`：visibility=both，**仅在初次分配 / 重新分配 assignee 时发**，含 `{ taskId, prevAssignee?, newAssignee }`
- `task.status.changed`：visibility=both，含 `{ taskId, prevStatus, nextStatus, reason?: string }`
  - **`task.status.changed { nextStatus: "completed" }` 是任务完成的唯一权威信号**；MVP / V1.1 / 后续阶段都不引入独立的 `task.completed` 事件
  - 状态转移合法集合（其他被 orchestrator 拒绝并记 `task.status.changed.rejected` debug 事件）：
    - `pending` → `in_progress` | `blocked` | `cancelled`
    - `in_progress` → `blocked` | `review` | `completed` | `cancelled`
    - `blocked` → `pending` | `in_progress` | `cancelled`
    - `review` → `in_progress` | `completed` | `cancelled`
    - `completed` / `cancelled`：终态，无出边

#### Scenario: 用户在 Solo Room 创建 Task

- **WHEN** 用户 `POST /rooms/:id/tasks { title: "实现登录页", assigneeAgentId: "claude" }`
- **THEN** 同一事务内：
  - 写 `tasks` 行 `status="pending"`, `created_by="user"`
  - 发 `task.created` durable event
  - 发 `task.assigned` durable event（initial assignment）
- **AND** UI 主流插入一张 TaskCard（一次性引用），后续不重复发消息

#### Scenario: Agent 通过 room.create_task 派发子任务

- **WHEN** assistant primary 在 Run 内调用 MCP tool `room.create_task { parentTaskId, title, assigneeAgentId: "reviewer" }`
- **THEN** orchestrator 验证 `role=primary` + `assigneeAgentId` 在 Room 内
- **AND** 同一事务写 `tasks` 行 `parent_task_id=parentTaskId`, `source_run_id=<当前 RunId>`, `created_by=<primary agentId>`
- **AND** 发 `task.created` + `task.assigned`
- **AND** orchestrator dispatch `WakeAgent` 到 reviewer，wakeReason=`delegated_task`，promptDelta 注入 task description

#### Scenario: assignee 完成实质工作进 review

- **WHEN** assignee Run 终结时 promptDelta 含明确的 phase summary 或 DiffArtifact
- **THEN** orchestrator handler 在 `agent.run.completed` 后读 `runs.task_id`；若非 NULL，发 `task.status.changed { prevStatus: "in_progress", nextStatus: "review", reason: "run_completed_with_phase_summary" }`
- **AND** UI 在 TaskCard 显示"等待用户/leader 确认"

#### Scenario: 用户标记 Task 完成

- **WHEN** 用户 `POST /tasks/:id/complete`
- **THEN** orchestrator 验证当前 status ∈ {`in_progress`, `review`}（其他状态拒绝并 4xx）
- **AND** 同一事务写 `status="completed"`, `updated_at=now`
- **AND** 发 `task.status.changed { prevStatus, nextStatus: "completed", reason: "user_marked" }`

#### Scenario: 非法状态转移被拒

- **WHEN** Agent 通过 `room.update_task { status: "completed" }` 直接从 `pending` 跳到 `completed`
- **THEN** orchestrator 拒绝（不在合法集合内）；返回 `{ error: "invalid_task_transition", from: "pending", to: "completed" }`
- **AND** 不写表、不发 durable event；记一条 ephemeral `task.status.changed.rejected` debug 事件供 Debug Panel 排查

### Requirement: V1.0 / V1.1 / V1.2 占位（Team / Squad / Board / DAG）

The system SHALL remove the Squad and Team mode placeholders from this requirement as they are now implemented in V1.0. War Room remains V1.5.

**V1.0 已实现**：`squad` mode（squad-mode capability）、`team` mode（team-mode capability）。

**仍为占位**：`war_room` mode（V1.5）；Task dependencies DAG 调度（V1.2 collab-visualization）；Task Board 拖拽（V1.1 task-board）。

#### Scenario: 创建 squad room

- **WHEN** `POST /rooms { mode: "squad", leaderRoleId: "project-manager", ... }`
- **THEN** daemon 创建 squad room，leaderRoleId 写入 `rooms.leader_role_id`
- **AND** **不**返回 501（V1.0 已实现）

#### Scenario: 创建 war_room 仍返回 501

- **WHEN** `POST /rooms { mode: "war_room", ... }`
- **THEN** 返回 501 + `{ error: "war_room mode is V1.5", capability: "v1-roadmap" }`

### Requirement: Observing 是被动状态 + WakeAgent 是模型调用唯一入口

The system SHALL treat `observing` as a **passive scheduling-eligibility state**, never as an active model session. While in `observing`, an Agent SHALL NOT consume any LLM / API call merely because the room received a new event. The only path that triggers an actual model call SHALL be a `WakeAgent` Command dispatched by Orchestrator (or its delegated rule engine). This is the canonical contract; `agents/spec.md` and `rooms/spec.md` reference it.

> **Why**：参考实现（AionUi team 模式、opencode background agent）一致表明：让 observer 后台轮询消息流会以接近 N×primary 的速度烧 token，且把"该 review 还是不该 review"的判断成本压给模型，最终产物质量也不稳定。把 wake 收紧成显式 Command 既降低成本，又让阶段触发可调试可回放。

```ts
type WakeReason =
  | "primary_turn"            // 普通用户消息唤醒 primary（Solo / Assisted 默认路径）
  | "user_mention"            // 用户消息含 @<agent>
  | "delegated_task"          // primary 通过 room.create_task 派发
  | "rule_review"             // rule.trigger 配置规则匹配
  | "knock_approved"          // 用户 approve 一个 intervention 后 Agent 转 active
  | "group_review"            // 用户显式 /review @all
  | "phase_completed"         // 上游 Run 阶段终结，触发下游 reviewer
  | "agent_crashed"           // 兜底：被监督 agent 崩溃，触发 supervisor
  | "consume_pending_turn"    // 上一轮 Run 终结后消费排队消息

type WakeAgentInput = {
  roomId: string
  agentId: string
  workspaceId: string                // 用户工作区 id（用于 RunLifecycleService.create 与 events envelope）
  reason: WakeReason
  triggerEventId?: string             // 触发本次 wake 的 durable event id（causationId）
  promptDelta?: AgentPromptDelta      // 见下文 prompt delta 协议
  // —— 调度相关字段（最终落到 RunLifecycleService.create）——
  targetFiles?: string[]              // best-effort 文件锁声明；未知时 RunQueue 退化为 workspace 级写锁
  workspaceMode?: "isolated_worktree" | "isolated_copy" | "shadow_buffer" | "shared" | "external"
  parentRunId?: string                // Run reuse；非空时 RunLifecycleService.create 复用 prior session
  messageId?: string                  // 关联的 user message
  pendingTurnId?: string              // 关联的 PendingTurn（consume_pending_turn 路径填）
  carryNextTurnIds?: string[]         // 来自旧 run 的未消费 run_next_turns ids；旧 run complete/fail 后由 hook 派发的新 wake 携带；RunLifecycleService.create 在事务内 rebind 这些 rows 到新 runId（详见 run_next_turns Requirement）；视为 hasInput 的一种合法输入源
  sourceRunId?: string                // carryNextTurnIds 来源的旧 run id；rebind SQL 加 AND run_id=:sourceRunId 防止跨 run 误绑定；与 carryNextTurnIds 同时填或同时不填
  idempotencyKey: string              // 默认 `${roomId}:${agentId}:${reason}:${triggerEventId ?? ulid()}`
  // 注：mailboxClaimIds 不在 WakeAgentInput 中 — handler 在 IMMEDIATE 事务内自己 claim 并把结果传给 RunLifecycleService.create
}

type AgentPromptDelta =
  | { kind: "first_wake"; fullRolePrompt: string }   // 第一次 wake 注入完整 role / system prompt
  | { kind: "delta_only"; instructions: string }     // 后续 wake 仅注入"该做什么"，role prompt 已在 session 里
```

**Stage Boundary 协议**：

下游 wake 的最佳触发点不是"消息流变了"，而是显式阶段边界。MVP 至少识别这五个：

```ts
type StageBoundary =
  | "plan.completed"           // primary 完成 plan 阶段，邀请 reviewer 评估方案
  | "run.completed"             // primary Run 终结，下游 reviewer 评估 diff / cost
  | "artifact.diff.created"     // DiffArtifact 出现，触发 security-reviewer / linter
  | "tests.failed"              // CI / 本地测试失败，触发 fixer
  | "user.review_requested"     // 用户 /review @all 或 approve knock
```

Orchestrator 的 rule engine MUST 把 wake rule 绑定到 StageBoundary 之一，不允许绑定到任意 ephemeral 事件流（如 message.part.delta、tool.update）。

**强制约束**：

1. observing Agent MUST NOT 因 `message.created` / `message.completed` / `agent.run.*` / `tool.call.*` / `artifact.*` 等 durable event 直接进入 LLM 调用；这些事件可以**触发 rule.trigger 评估**，但 rule 的产物只能是 `WakeAgent` Command，由 Orchestrator dispatch。
2. WakeAgent Command 是 model 调用的唯一入口；adapter `startRun` MUST 由 RunQueue Worker 在收到 `agent.run.queued`（由 WakeAgent handler 调 `RunLifecycleService.create` 时发出）后才发起；即 wake → RunLifecycleService.create → queued → worker → adapter。MVP 没有 StartRun Command。
3. `wakeReason` MUST 写入 `runs.wake_reason` 字段（agents capability schema 增补）便于 Run Replay 时追溯触发链。
4. `promptDelta.kind=first_wake` 仅在该 (room, agent) 在本 session 没有过 wake 时使用；后续 MUST 用 `delta_only` 避免重复发送 role prompt（这是 AionUi 优化文档明确踩过的成本坑）。
5. 同 (room, agent) 的并发 WakeAgent MUST 通过 `idempotencyKey` 与 `activeWakes` 双重去重（详见 `orchestrator/唤醒去重` + P2-8）。
6. 当 Run 因 wake 而启动后，Run 终结（completed / failed / cancelled）时 Agent presence 自动回 `observing`（不是 `active`），除非有新的 wake 入站。

#### Scenario: observer 不因 message 流自动调用模型

- **WHEN** Assisted Room 中 primary 正在跑 run，输出 100 条 message.part.delta，security-reviewer 处于 observing
- **THEN** 期间 security-reviewer 子进程 / API 调用次数 = 0；只有当 primary run 终结触发 `phase_completed` rule 后，Orchestrator dispatch `WakeAgent { agentId: security-reviewer, reason: "phase_completed" }`，才发生第一次 LLM 调用

#### Scenario: 第一次 wake 注入完整 role prompt

- **WHEN** security-reviewer 在 Room r_1 第一次被 wake（由 phase_completed 触发）
- **THEN** Orchestrator 构造 `promptDelta = { kind: "first_wake", fullRolePrompt: <完整 role + safety + style> }`；后续同 session 再 wake 用 `kind: "delta_only"`

#### Scenario: rule 只能产出 WakeAgent

- **WHEN** 用户配置 rule `match: { artifact.files: ["auth.ts"] }, action: { type: "speak", agentId: "security-reviewer", text: "..." }`
- **THEN** daemon 在加载规则时校验 action.type 必须是 `wake`；非 `wake` 类型规则注册失败 + audit log；用户在 settings UI 看到错误提示"rule action 必须是 wake"

#### Scenario: 同源 wake 去重

- **WHEN** 一个 phase_completed 事件因总线 retry 被 rule engine 评估两次，各自 dispatch WakeAgent
- **THEN** 两次 WakeAgent 的 idempotencyKey 相同（基于 triggerEventId）；CommandBus 命中幂等 → 第二次返回已存在 commandId 与已存在 runId；不创建第二个 Run

#### Scenario: knock 被 approve 走 knock_approved wake

- **WHEN** 用户 approve 一个 reviewer 的 intervention
- **THEN** intervention handler dispatch `WakeAgent { reason: "knock_approved" }`；Run 启动；Run 终结后 reviewer 回到 observing 而非保持 active

### Requirement: Mailbox 原子认领 + activeWakes 防重入

The system SHALL atomically claim mailbox messages when WakeAgent is dispatched, ensuring that concurrent wakes for the same `(roomId, agentId)` cannot double-deliver the same mailbox entry, AND that mailbox content is part of the wake's prompt assembly rather than a parallel side-channel that may race with the run.

> **Why**：参考 AionUi `team-implementation-diff-report.md` 的实测教训 — 多个 rule 同时把消息塞进 reviewer 的 mailbox + 同时 dispatch wake 时，内存级 EventEmitter 路径会把同一条留言投递两次；改成"wake 时事务内 SELECT FOR UPDATE → UPDATE read=1 + 拼 prompt"才彻底解决。MVP 内置 SQLite WAL 没 SELECT FOR UPDATE，但用 IMMEDIATE 事务 + UNIQUE constraint 能达到同等语义。

**Mailbox 字段扩展**（在现有 `mailbox_messages` 表基础上追加）：

```sql
ALTER TABLE mailbox_messages ADD COLUMN claimed_run_id TEXT;       -- 认领该消息的 runId
ALTER TABLE mailbox_messages ADD COLUMN claimed_at INTEGER;
CREATE INDEX idx_mb_claimable ON mailbox_messages (to_agent_id, room_id, read, claimed_run_id);
```

**WakeAgent 命令处理流程**（事务）：

```ts
function handleWakeAgent(input: WakeAgentInput): Effect.Effect<void, ...> {
  return Effect.gen(function* () {
    // 1. tryAcquireActiveWake 进 in-process activeWakes Map（防重入）
    //    返回 { kind: 'acquired', release } 或 { kind: 'already_active', existingRunId }
    const guard = yield* tryAcquireActiveWake(input.roomId, input.agentId, input.idempotencyKey)
    if (guard.kind === "already_active") {
      // 已有活跃 wake / 活跃 run — 不创建新 run，把 wake 输入（promptDelta / messageId / pendingTurnId）
      // 留给当前 run 在下一 turn 通过 room.read_mailbox 消费；mailbox 行保持 read=0，下次同样会被读到
      yield* mailboxService.appendNextTurn(null, guard.existingRunId, {
        roomId: input.roomId,
        agentId: input.agentId,
        promptDelta: input.promptDelta,
        messageId: input.messageId,
        pendingTurnId: input.pendingTurnId,
        sourceReason: input.reason,
        sourceIdempotencyKey: input.idempotencyKey,
      })
      return
    }

    // 2. 单 IMMEDIATE 事务原子完成 mailbox claim + RunLifecycleService.create
    //    关键：service 接受外层 tx，所以 mailbox UPDATE 与 INSERT runs/events/outbox 同事务
    //    无任何裸 SQL 写 runs/events/outbox（runs 表唯一写入口仍是 RunLifecycleService）
    //    activeWakes guard 必须 try/finally 释放 — 仅在创建成功后绑定到 runId，否则在 finally 释放 guard 自身
    let createdRunId: string | null = null
    try {
      yield* db.txImmediate(function* (tx) {
        // 2a. DB 级二次校验：同 (roomId, agentId) 是否已有非终结 run（防御 in-process activeWakes 绕过）
        const existing = yield* runRepo.findActive(tx, input.roomId, input.agentId)
        if (existing) {
          // 已有非终结 run；放弃创建，转为 next_turn 路径（同步语义与 already_active 分支一致）
          yield* mailboxService.appendNextTurn(tx, existing.runId, {
            roomId: input.roomId,
            agentId: input.agentId,
            promptDelta: input.promptDelta,
            messageId: input.messageId,
            pendingTurnId: input.pendingTurnId,
            sourceReason: input.reason,
            sourceIdempotencyKey: input.idempotencyKey,
          })
          return
        }

        // 2b. 原子认领 mailbox（同事务，UPDATE WHERE claimed_run_id IS NULL 保证不双投）
        const newRunId = ulid()
        const claimedIds = yield* mailboxService.claimUnread(tx, {
          toAgentId: input.agentId,
          roomId: input.roomId,
          runId: newRunId,
          limit: MAX_CLAIMS_PER_WAKE
        })

        // 2c. 零输入 wake 拒绝创建：白名单仅表示"允许不靠 mailbox"，但仍要求至少有一个有效输入源
        //     有效输入源 = 任一为真：
        //       - 认领到了 mailbox 行（claimedIds.length > 0）
        //       - promptDelta 含可运行内容（hasMeaningfulPromptDelta）
        //       - messageId 非空（user message 是天然输入）
        //       - pendingTurnId 非空（PendingTurn 必有 message 关联）
        //       - carryNextTurnIds 非空（旧 run 终结时携带过来的未消费 next_turn）
        const hasInput =
          claimedIds.length > 0 ||
          hasMeaningfulPromptDelta(input.promptDelta) ||
          !!input.messageId ||
          !!input.pendingTurnId ||
          (input.carryNextTurnIds?.length ?? 0) > 0
        if (!hasInput) {
          // 白名单允许零 mailbox，但不允许零输入；audit 后放弃
          yield* auditLog("wake_rejected_zero_input", { reason: input.reason, roomId: input.roomId, agentId: input.agentId, idempotencyKey: input.idempotencyKey })
          return
        }
        if (claimedIds.length === 0 && (input.carryNextTurnIds?.length ?? 0) === 0 && !ZERO_MAILBOX_ALLOWED.has(input.reason)) {
          // 非白名单 reason 必须有 mailbox 内容或 carryNextTurnIds（旧 run carry 视同 mailbox 等价的 input）；audit 后放弃
          yield* auditLog("wake_rejected_no_mailbox", { reason: input.reason, idempotencyKey: input.idempotencyKey })
          return
        }

        // 2d. 调 RunLifecycleService.create（service 内部继续在 tx 内 INSERT runs(queued) + INSERT events + outbox）
        //     若 carryNextTurnIds 非空：service 在同事务防御性 rebind（AND room_id / agent_id / run_id=sourceRunId / consumed_at IS NULL；affected rows 必须等于 carryNextTurnIds.length，否则回滚 StaleOrInvalidNextTurnIds）
        yield* runLifecycleService.create(tx, {
          runId: newRunId,
          agentId: input.agentId,
          roomId: input.roomId,
          workspaceId: input.workspaceId,
          wakeReason: input.reason,
          workspaceMode: input.workspaceMode,
          parentRunId: input.parentRunId,
          targetFiles: input.targetFiles,
          promptDelta: input.promptDelta,
          mailboxClaimIds: claimedIds,
          carryNextTurnIds: input.carryNextTurnIds,
          triggerEventId: input.triggerEventId,
          messageId: input.messageId,
          pendingTurnId: input.pendingTurnId,
        })
        createdRunId = newRunId
      })

      // 3. 成功路径：把 activeWake guard 绑定到 createdRunId，由 RunLifecycleService.complete/fail/cancelFinalized 钩子在 run 终结时释放
      if (createdRunId) {
        guard.bindToRun(createdRunId)
      }
    } finally {
      // 失败 / 拒绝 / 异常路径：activeWake guard 必须释放，避免后续 wake 永久挡住
      if (!createdRunId) {
        guard.release()
      }
    }
  })
}

/**
 * 是否存在可运行的 promptDelta：
 *   - first_wake：fullRolePrompt 非空白
 *   - delta_only：instructions 非空白
 *   - undefined / null / 空白字符串 → false
 */
function hasMeaningfulPromptDelta(d: AgentPromptDelta | undefined): boolean {
  if (!d) return false
  if (d.kind === "first_wake") return d.fullRolePrompt?.trim().length > 0
  if (d.kind === "delta_only") return d.instructions?.trim().length > 0
  return false
}

const ZERO_MAILBOX_ALLOWED = new Set<WakeReason>([
  "primary_turn",            // 必带 messageId（用户消息）；hasInput 由 messageId 兜底
  "user_mention",            // 必带 messageId
  "rule_review",             // 必须由 rule 在 promptDelta 里塞具体 review 任务；零输入直接拒
  "phase_completed",         // 必须由触发 rule 在 promptDelta 里塞上游 Run 摘要
  "agent_crashed",           // 必须由 supervisor 在 promptDelta 里塞错误摘要
  "group_review",            // 必须带 promptDelta
  "knock_approved",          // 必须带 sourceInterventionId 对应的 effectiveText（promptDelta）
  "consume_pending_turn",    // 必带 pendingTurnId
  "delegated_task"           // 必须由 primary 在 promptDelta 里塞子任务描述
])
```

> **关键点**：
> 1. handler 内部**不**再有 `INSERT_RUN / INSERT_EVENT / INSERT_OUTBOX` 裸 SQL；这些都收敛到 `runLifecycleService.create(tx, ...)` 内部完成（详见 `bus-runtime/RunLifecycleService 是 runs 表的唯一写入口`）。`runs` 表唯一写入口约束因此被严格遵守。
> 2. `tryAcquireActiveWake` 后 MUST `try/finally`：guard 在 `createdRunId` 非空时通过 `guard.bindToRun(runId)` 绑定到 run（由 RunLifecycleService 终结钩子释放）；否则在 finally 内 `guard.release()`，杜绝"DB 二次校验拒绝 / 零输入拒绝 / 事务异常"路径下 guard 永久泄漏。
> 3. 零输入判断含 `hasMeaningfulPromptDelta + messageId/pendingTurnId` 三重 OR，避免白名单变成"任何 reason 都可零输入创建空 run"的兜底口。

**强制约束**：

1. **单行 mailbox 只能被 claim 一次**（不是 `UNIQUE(claimed_run_id)`！同一个 run 可以 claim 多行 mailbox，所以 `claimed_run_id` MUST NOT 建全局唯一索引）。并发安全靠：① 每条 `claim` 走 `UPDATE mailbox_messages SET read=1, claimed_run_id=:newRunId WHERE id IN (...) AND claimed_run_id IS NULL` —— `WHERE claimed_run_id IS NULL` 子句保证已被 claim 的行不会被二次抢占；② 整个 SELECT + UPDATE 必须在 SQLite `IMMEDIATE` 事务内执行，让多个并发 wake 串行进入。试图二次 claim 同一行 → UPDATE 命中 0 rows → 该行不会被多投。
2. `read=1` 与 `claimed_run_id=newRunId` 必须**同事务**写入；不允许"先 mark read 再 claim"两步。
3. 单次 wake claim 上限 `MAX_CLAIMS_PER_WAKE=20`；超出剩余的留言留给下一次 wake（避免单 prompt 过大）。
4. 若该 (room, agent) 已有活跃 wake（activeWakes 命中），新留言继续保持 unread + claimed_run_id=NULL，由当前 active run 在下一个 turn 通过 `room.read_mailbox` 主动读取（这是现有协议）；不重复 dispatch wake。
5. Run 终结（completed / failed / cancelled）时：
   - completed：mailbox 行保持 read=1 + claimed_run_id=runId（已消费）。
   - failed / cancelled 且 `failureClass ∈ {transient, retryable_visible, fresh_session_required}`：MUST 把 claimed mailbox 行回滚为 `read=0, claimed_run_id=NULL, claimed_at=NULL, delivery_batch_id=NULL`（让下次 wake 重新认领；清 `delivery_batch_id` 是关键，否则新 run 的 `read_mailbox` 查询会因 `delivery_batch_id` 非空而过滤掉这些行）。
   - failed `permission_denied / configuration / fatal`：保持 read=1（不重投，避免循环）；UI 在 Run Detail 提示"x 条 mailbox 未处理"。
6. `mailbox.message.created` 事件 visibility=`detail`（不污染主流，详见 messaging 双投影）。

**activeWakes 数据结构**：

```ts
type ActiveWake = {
  roomId: string
  agentId: string
  runId: string
  wakeReason: WakeReason
  startedAt: number
}

// 实例：
type ActiveWakesRegistry = Map<`${roomId}:${agentId}`, ActiveWake>
```

注册 / 释放由 RunLifecycleService.markStarting / complete / fail / cancelFinalized 调用 Orchestrator 钩子完成；Orchestrator 不直接监听 events 来释放（避免与 RunLifecycleService 竞争）。

`activeWakes` 是**进程内**结构 + daemon 启动时从 `runs WHERE status NOT IN terminal` 重建；多客户端 SSE 不感知此结构。

#### Scenario: 两个 rule 同时触发同 reviewer wake

- **WHEN** rule A 与 rule B 同时匹配 phase_completed，分别 dispatch WakeAgent for security-reviewer
- **THEN** 第一条进入 activeWakes，第二条命中 already_active → 把它的 mailbox claim 推迟到当前 run 完成后；只有一个 run 启动；第二条不会创建第二个 run

#### Scenario: 并发 wake claim 不双投 + DB 级二次校验拦截空 run

- **WHEN** 真实并发：两个 wake 几乎同时进事务（瞬态绕过进程内 activeWakes，比如 daemon 多进程 / fiber 调度边界 race）
- **THEN** 第一个 IMMEDIATE 事务 commit 后 runs 表新增 run_A (status='queued')；第二个事务进入后**先**做 DB 级二次校验 `runRepo.findActive(tx, roomId, agentId)` → 命中 run_A → 走 `mailboxService.appendNextTurn(tx, run_A, promptDelta)` 而非创建新 run；既不双投 mailbox 也不创建多余的空 run（避免烧 token）

#### Scenario: 零 mailbox 白名单的正确语义

- **WHEN** rule_review wake 触发，mailbox 空但 promptDelta 含具体 review 指令（rule_review ∈ ZERO_MAILBOX_ALLOWED 表示该 reason 允许"不靠 mailbox"，但仍要求 promptDelta / messageId / pendingTurnId 至少一个非空）
- **THEN** `hasInput = true`（promptDelta 满足 hasMeaningfulPromptDelta）；handler 创建 run；rule_review 白名单只解除"必须有 mailbox"约束，不解除"必须有任意输入源"约束

#### Scenario: 零 mailbox + 零 promptDelta + 无 message/pendingTurn → 拒绝创建

- **WHEN** rule_review wake 触发但 mailbox 空、promptDelta 也空（rule 配置错误）、messageId / pendingTurnId 都未提供
- **THEN** `hasInput = false`；audit log `wake_rejected_zero_input`；不发 `agent.run.queued`；activeWake guard 在 finally 释放；不烧 token

#### Scenario: activeWake guard 在拒绝路径不泄漏

- **WHEN** WakeAgent handler 因 DB 二次校验命中 / 零输入拒绝 / 事务异常等任意原因未能创建 run
- **THEN** `createdRunId` 仍是 null；try/finally 的 finally 分支调 `guard.release()`；同 `(roomId, agentId)` 后续 wake 不会被旧 guard 永久挡住

#### Scenario: failed transient 回滚 mailbox 让重投

- **WHEN** 认领了 3 条 mailbox 的 run_A 在 starting 阶段 failed("upstream_5xx", "transient")
- **THEN** RunLifecycleService.fail 在事务中回滚 mailbox：`UPDATE mailbox SET read=0, claimed_run_id=NULL, claimed_at=NULL, delivery_batch_id=NULL WHERE claimed_run_id='run_A'`；下一次 wake 重新认领这 3 条；不丢失留言

#### Scenario: failed permission_denied 不回滚 mailbox

- **WHEN** run_A 因 permission denied 失败
- **THEN** mailbox 行保持 read=1 claimed_run_id='run_A'；UI 在 Run Detail 显示"3 条留言已读但未生效"；用户决定如何处理

### Requirement: run_next_turns 表（active run 期间追加输入的持久化通道）

The system SHALL persist any input that arrives while a Run is active and would otherwise be lost—`promptDelta`, `messageId`, `pendingTurnId`—into a `run_next_turns` table; `mailboxService.appendNextTurn(tx, runId, payload)` is the **single canonical writer** of that table; the active Run consumes both `mailbox_messages` and `run_next_turns` at its next turn boundary.

> **Why**：当 WakeAgent handler 命中 in-process activeWakes 或 DB 二次校验发现已有 active run 时，新到的 `promptDelta` / `messageId` / `pendingTurnId` 会被路由到 `appendNextTurn`。`mailbox_messages` 表只能承载文本/附件型留言，无法表达 `promptDelta`（首次 wake 注入 vs delta 注入）、`pendingTurnId`（用户排队消息引用）等 wake 输入语义；如果不另起一张表，这些输入会丢失。

**与 mailbox / pending_turns 的边界**：

| 表 | 写入者 | 表达的语义 | 消费者 |
|---|---|---|---|
| `mailbox_messages` | 任意 actor（user / agent / system / tool）通过 MCP `room.send_message` 等 | room 内部 actor 间的"留言"，文本 + 可选附件；可被 wake 一次性 claim 到 run | 下一次 WakeAgent handler claim 或当前 active run 通过 `room.read_mailbox` 读 |
| `pending_turns` | `SendMessage` Command 在 primary busy 时创建 | 用户 turn 因 primary busy 而排队的状态机条目 | 上一轮 Run 终结后 Orchestrator 派发 `ConsumePendingTurn` → WakeAgent |
| `run_next_turns` | `mailboxService.appendNextTurn(tx, runId, payload)`（**唯一写入口**） | active run 期间追加的"等下一 turn 一起处理"的 wake 输入（promptDelta / messageId / pendingTurnId 引用） | 当前 active run 在下一个 adapter turn 通过 `room.read_mailbox` 同时拉 mailbox + next_turns；run 终结时未消费的 next_turns 由 fail 回滚或 complete 时按规则处理 |

**run_next_turns 表 schema**：

```sql
CREATE TABLE run_next_turns (
  id                 TEXT PRIMARY KEY,                  -- ULID
  run_id             TEXT NOT NULL,                      -- 目标 run（活跃中）
  room_id            TEXT NOT NULL,
  agent_id           TEXT NOT NULL,
  prompt_delta_json  TEXT,                               -- AgentPromptDelta JSON；可空
  message_id         TEXT,                               -- 关联 user message
  pending_turn_id    TEXT,                               -- 关联 PendingTurn（consume_pending_turn 路径）
  source_reason      TEXT NOT NULL,                      -- 触发本条 next_turn 的原始 wake reason
  source_idempotency_key TEXT NOT NULL,                  -- 原始 WakeAgent idempotencyKey；用于 audit
  created_at         INTEGER NOT NULL,
  consumed_at        INTEGER                             -- run 在 read_mailbox 时一次性 mark consumed
);
CREATE INDEX idx_next_turns_run_unconsumed ON run_next_turns (run_id) WHERE consumed_at IS NULL;
CREATE INDEX idx_next_turns_room_agent ON run_next_turns (room_id, agent_id, created_at);
```

**`mailboxService.appendNextTurn(tx, runId, payload)` 契约**：

```ts
interface MailboxService {
  /**
   * 把 wake 输入追加到 active run 的下一 turn。仅在 WakeAgent handler 命中
   * already_active / DB 二次校验命中 existing 时调用，**不**用于普通 mailbox 留言（那走 send_message）。
   * payload MUST 至少包含 promptDelta / messageId / pendingTurnId 三者中之一；零输入直接返回 0 行写入。
   */
  appendNextTurn(
    tx: SqliteTx | null,
    runId: string,
    payload: {
      roomId: string
      agentId: string
      promptDelta?: AgentPromptDelta
      messageId?: string
      pendingTurnId?: string
      sourceReason: WakeReason
      sourceIdempotencyKey: string
    }
  ): Effect.Effect<{ appended: boolean }, MailboxError>
}
```

**run 终结时的处理 + carry 链路**：

- `complete`：未消费的 `run_next_turns`（`consumed_at IS NULL`，`run_id = :runId`）**保留在表中、不动 `run_id`**。由订阅 `agent.run.completed` 的 Orchestrator hook 决定：
  - 若该 (room, agent) 仍有未消费 next_turn → hook 立即派发新 `WakeAgent`，**`carryNextTurnIds` 字段填这些 row id，`sourceRunId` 填旧 run id**（见 `WakeAgentInput` / `CreateRunInput`）。新 wake 的 idempotencyKey 派生自 `oldRunId + nextTurnIds.hash` 防止重复 wake。
  - WakeAgent handler 调 `RunLifecycleService.create(tx, { ..., carryNextTurnIds, sourceRunId })`，service 在同事务内执行**防御性 rebind**：
    ```sql
    UPDATE run_next_turns
       SET run_id = :newRunId, consumed_at = NULL
     WHERE id IN (:carryNextTurnIds)
       AND room_id = :roomId
       AND agent_id = :agentId
       AND run_id = :sourceRunId
       AND consumed_at IS NULL
    ```
    affected rows 数量 MUST 等于 `carryNextTurnIds.length`；不等则整个 `RunLifecycleService.create` 事务回滚，返回 `RunLifecycleError.StaleOrInvalidNextTurnIds`；Orchestrator hook 收到该错误后 audit log + 不重试（避免循环）。新 run 在下一 turn 通过 `room.read_mailbox` 一次性拉到 rebind 后的 rows。
  - 若该 (room, agent) 同时还有 PendingTurn `queued`：**优先 carry next_turn，其次 consume pending_turn**（详见 `bus-runtime/订阅图谱` Orchestrator 行的优先级规则）。理由：next_turn 是用户/规则在当前 run 期间追加给同一上下文的输入，语义上更贴近"继续当前任务"；pending_turn 是新一轮 user message。
- `fail` 且 `failureClass ∈ {transient, retryable_visible, fresh_session_required}`：与 `complete` 一致，未消费 next_turn rows 保留 `run_id` 不变，由 hook 派发新 wake 携带 `carryNextTurnIds` rebind。**fail 路径下原本 ` UPDATE consumed_at=NULL` 的写法不再需要**（因为它们本来就是 `IS NULL`；service.fail 不动 next_turns）。
- `fail` 且 `failureClass ∈ {permission_denied, configuration, fatal, user_cancelled}`：在同事务内 `UPDATE run_next_turns SET consumed_at = now() WHERE run_id = :runId AND consumed_at IS NULL`（标 consumed 但 audit log 记录"未实际处理"，UI 在 Run Detail 显示"x 条 next_turn 未处理"）；hook 不重发 wake。

#### Scenario: appendNextTurn 写 run_next_turns 而非 mailbox

- **WHEN** WakeAgent handler 在 IMMEDIATE 事务内通过 DB 二次校验发现 (room_1, agent_1) 已有 active run_A，新 wake 携带 `promptDelta = { kind: "delta_only", instructions: "also add tests" }`
- **THEN** handler 调 `mailboxService.appendNextTurn(tx, run_A, { roomId: room_1, agentId: agent_1, promptDelta, sourceReason: "primary_turn", sourceIdempotencyKey })` → `INSERT INTO run_next_turns ...`；**不**写 mailbox_messages；**不**创建新 run；run_A 在下一个 turn 通过 `room.read_mailbox` 同时拉到 next_turns 与 mailbox

#### Scenario: appendNextTurn 在 promptDelta 空但 pendingTurnId 非空时仍写入

- **WHEN** 用户在 primary busy 时连发消息触发 `consume_pending_turn` wake，但被 DB 二次校验命中 active run_A；payload 含 `pendingTurnId="pt_7"` 但 `promptDelta` 为 undefined、`messageId` 为 undefined
- **THEN** appendNextTurn 仍写入一行 run_next_turns（`pending_turn_id='pt_7', prompt_delta_json=NULL, message_id=NULL`），返回 `{ appended: true }`；run_A 在下一个 turn 通过 `room.read_mailbox` 拉到该 next_turn，并通过 pendingTurnId 解析出对应 user message 一并处理；不丢输入

#### Scenario: appendNextTurn 拒绝零输入

- **WHEN** 调用 `appendNextTurn(tx, run_A, { roomId, agentId, sourceReason, sourceIdempotencyKey })`，payload 中 promptDelta / messageId / pendingTurnId 都为空
- **THEN** 返回 `{ appended: false }`；不 INSERT；audit log `next_turn_rejected_zero_input`

#### Scenario: run 完成后未消费的 next_turn 通过 carryNextTurnIds rebind 到新 run

- **WHEN** run_A complete 时仍有 2 条 `run_next_turns` 行 `consumed_at IS NULL, run_id='run_A'`，假设 ids = ["nt_1", "nt_2"]
- **THEN** Orchestrator hook 查到未消费 next_turns → 立即派发 `WakeAgent({ ..., carryNextTurnIds: ["nt_1","nt_2"], sourceRunId: "run_A", idempotencyKey: hash("run_A:nt_1,nt_2") })`；WakeAgent handler 在 IMMEDIATE 事务内 `hasInput = true`（carryNextTurnIds 非空），调 `RunLifecycleService.create(tx, { ..., carryNextTurnIds, sourceRunId: "run_A" })`；service 在同事务防御性 rebind（`WHERE id IN ("nt_1","nt_2") AND room_id=room_1 AND agent_id=agent_1 AND run_id='run_A' AND consumed_at IS NULL`，affected rows=2 等于 carryNextTurnIds.length，通过）；run_B 在下一 turn 通过 `room.read_mailbox` 同时拉 mailbox 与 next_turns（此时 next_turns 已绑定到 run_B），处理完后由 `room.read_mailbox` 标 `consumed_at=now()`

#### Scenario: fail transient 保留 next_turn 给下一轮 wake carry

- **WHEN** run_A fail("upstream_5xx", "transient")，期间被 appendNextTurn 写入了 1 条 next_turn `nt_3`
- **THEN** RunLifecycleService.fail **不动** `run_next_turns`（rows 仍属 run_A 且 `consumed_at IS NULL`）；订阅 `agent.run.failed` 的 Orchestrator hook 派发 `WakeAgent({ ..., carryNextTurnIds: ["nt_3"], sourceRunId: "run_A", idempotencyKey: hash("run_A:nt_3") })`；同 complete 路径 rebind 到 run_B；输入不丢失

#### Scenario: fail permission_denied 标 next_turn consumed

- **WHEN** run_A fail("permission_denied"，failureClass="permission_denied")
- **THEN** RunLifecycleService.fail 在同事务内 `UPDATE run_next_turns SET consumed_at=now() WHERE run_id='run_A' AND consumed_at IS NULL`；不重投；UI 在 Run Detail 显示"x 条 next_turn 因权限拒绝未处理"

#### Scenario: next_turn 优先于 pending_turn

- **WHEN** run_A complete 时同 (room_1, primary) 既有 1 条未消费 next_turn `nt_5`，也有 1 条 `pending_turns.status='queued'` 的 `pt_9`
- **THEN** Orchestrator hook 先派发 `WakeAgent({ carryNextTurnIds: ["nt_5"], sourceRunId: "run_A", reason: <next_turn.source_reason>, idempotencyKey: hash("run_A:nt_5") })` → run_B；run_B 终结后 hook 再次评估，发现 next_turn 已无 unconsumed → 转而派发 `ConsumePendingTurn(pt_9)` → run_C；不混合调度

### Requirement: room.read_mailbox 双源原子消费

The `room.read_mailbox` MCP tool SHALL atomically consume both `mailbox_messages` and `run_next_turns` rows scoped to the current run, in a single SQLite `IMMEDIATE` transaction. The `runId` MUST be derived implicitly from the adapter session that issued the tool call; the agent MUST NOT pass `runId` (or be able to spoof it). Idempotency SHALL be scoped to a **delivery batch** identified by `deliveryBatchId`; the same `deliveryBatchId` returns the same batch on retry; a new `deliveryBatchId` only returns new unread/unconsumed input.

**`deliveryBatchId` 来源（稳定性要求）**：`deliveryBatchId` MUST be stable for the same logical tool call retry。优先级：① ACP `toolCallId`（最稳，来自 JSON-RPC request id）；② MCP request id / JSON-RPC id；③ adapter session 内单调 `tool_call_seq` 派生值；④ 只有确实没有重试语义的调用，才允许 MCP bridge 生成一次性 UUID。若 bridge 每次随机生成 UUID，则同一次网络重试会命中不同 batch，幂等失效。

**契约**：

```ts
// 由 Room MCP Tool 桥接层注入 runId / agentId / roomId / deliveryBatchId（来自 adapter session 上下文）
function readMailbox(ctx: {
  runId: string
  agentId: string
  roomId: string
  deliveryBatchId: string   // = ACP toolCallId 或 MCP bridge 生成的 UUID；同一 batch 重试返回同一结果
}): {
  mailbox: MailboxMessage[]    // 本次 batch 新读到的 mailbox 行
  nextTurns: RunNextTurn[]     // 本次 batch 新读到的 next_turn 行
  batchId: string              // = deliveryBatchId，供 prompt assembly 去重
}
```

**事务流**（`db.txImmediate` 内一次性完成）：

```sql
-- 0. 幂等检查：同 deliveryBatchId 是否已有 delivery 记录
SELECT * FROM mailbox_deliveries WHERE delivery_batch_id=:deliveryBatchId AND run_id=:runId
-- 命中 → 直接返回该 batch 的 mailbox_ids + next_turn_ids（不重复 mark）
-- 未命中 → 继续步骤 1-5

-- 1. 读 mailbox：
--    (a) 未读且未被任何 run claim（read=0 AND claimed_run_id IS NULL）
--    (b) 已被本 run claim（claimed_run_id=:runId，覆盖 WakeAgent 阶段 mailboxClaimIds 的延迟读）
--    注意：read=0 但 claimed_run_id=其他 run 的行 MUST NOT 被选出（防止幽灵投递）
SELECT * FROM mailbox_messages
 WHERE to_agent_id=:agentId AND room_id=:roomId
   AND (
     (read=0 AND claimed_run_id IS NULL)
     OR claimed_run_id=:runId
   )
   AND (delivery_batch_id IS NULL OR delivery_batch_id=:deliveryBatchId)  -- 未投递或本 batch 已投递
 ORDER BY created_at ASC

-- 2. 标 mailbox 为已消费：read=1, claimed_run_id=:runId, claimed_at=now(), delivery_batch_id=:deliveryBatchId
UPDATE mailbox_messages SET read=1, claimed_run_id=:runId, claimed_at=:now, delivery_batch_id=:deliveryBatchId
 WHERE id IN (returned ids) AND (claimed_run_id IS NULL OR claimed_run_id=:runId)
-- affected rows 必须等于 SELECT 返回的 mailbox 行数；不等 → 回滚整个事务，返回 MailboxDeliveryConflict
-- （说明：SELECT 与 UPDATE 之间若有并发 claim，UPDATE 命中 0 行，校验失败，防止幽灵投递）

-- 3. 读 run_next_turns：当前 run 未消费的（含 carry rebind 后的）
SELECT * FROM run_next_turns
 WHERE run_id=:runId AND consumed_at IS NULL
 ORDER BY created_at ASC

-- 4. 标 next_turn 为已消费：consumed_at=now()
UPDATE run_next_turns SET consumed_at=:now
 WHERE id IN (returned ids) AND consumed_at IS NULL

-- 5. 写 delivery 记录（幂等 key）
INSERT INTO mailbox_deliveries (delivery_batch_id, run_id, mailbox_ids, next_turn_ids, delivered_at)
 VALUES (:deliveryBatchId, :runId, :mailboxIds_json, :nextTurnIds_json, :now)
```

**`mailbox_deliveries` 表**（幂等 key 存储）：

```sql
CREATE TABLE mailbox_deliveries (
  delivery_batch_id  TEXT NOT NULL,
  run_id             TEXT NOT NULL,
  mailbox_ids        TEXT NOT NULL,    -- JSON array
  next_turn_ids      TEXT NOT NULL,    -- JSON array
  delivered_at       INTEGER NOT NULL,
  PRIMARY KEY (delivery_batch_id, run_id)
);
CREATE INDEX idx_mailbox_deliveries_run ON mailbox_deliveries (run_id, delivered_at);
```

**`mailbox_messages` 表新增列**：

```sql
ALTER TABLE mailbox_messages ADD COLUMN delivery_batch_id TEXT;  -- 首次投递的 batch id；后续同 batch 重试可识别
```

**强制约束**：

1. `runId` 由 adapter session 上下文隐式注入；MCP tool layer 在桥接到 ACP 的 `tools/call` 入参时 MUST NOT 暴露 runId 字段给 agent；任何 agent 试图伪造的 runId MUST 被 reject。
2. 整个 read + mark consumed MUST 在同一 `IMMEDIATE` 事务；不允许"先读再标"两步。
3. **mailbox SELECT 必须收紧为 `(read=0 AND claimed_run_id IS NULL) OR claimed_run_id=:runId`**，不允许 `read=0` 不加 `claimed_run_id IS NULL` 的宽泛条件。原因：`read=0 AND claimed_run_id=其他 run` 的行是"已被其他 run claim 但尚未 mark read"的中间态（可能来自 crash 恢复或并发 claim），当前 run 不应读取；否则 UPDATE 阶段命中 0 行，造成"SELECT 返回给 agent 了，但数据库没标成本 run 消费"的幽灵投递。
4. **UPDATE affected rows 必须等于 SELECT 返回的 mailbox 行数**；不等 → 回滚整个事务，返回 `MailboxDeliveryConflict`（说明 SELECT 与 UPDATE 之间有并发 claim 抢占）。
5. **幂等范围是 deliveryBatchId，不是 runId**：同一 `deliveryBatchId` 重试返回同一 batch（从 `mailbox_deliveries` 读）；新的 `deliveryBatchId` 只返回新 unread/unconsumed 输入。这防止 coding agent 多阶段调用 `room.read_mailbox` 时反复看到旧 mailbox 行导致上下文膨胀。
6. Prompt assembly 层 SHOULD 按 `mailbox.id` / `next_turn.id` 去重，作为额外防线。
7. **回滚语义与 RunLifecycleService.fail 一致**（详见 `bus-runtime/RunLifecycleService 是 runs 表的唯一写入口` 中 "failureClass 与 mailbox 回滚 + run_next_turns finalization"）：transient fail 回滚 mailbox claim（`read=0, claimed_run_id=NULL, claimed_at=NULL, delivery_batch_id=NULL`）；`run_next_turns` 不动（carry 链路接续）；`mailbox_deliveries` 中该 run 的 batch 记录保留作 audit。

#### Scenario: read_mailbox 同事务消费 mailbox + next_turns

- **WHEN** run_B（由 carry 链路从 run_A 继承了 nt_1 / nt_2）首次 turn 调用 `room.read_mailbox(deliveryBatchId="batch_1")`；同时 mailbox 内有 1 条 `mb_3` 未读
- **THEN** 单 IMMEDIATE 事务返回 `{ mailbox: [mb_3], nextTurns: [nt_1, nt_2], batchId: "batch_1" }`；mb_3 被标 `read=1, claimed_run_id='run_B', delivery_batch_id='batch_1'`；nt_1 / nt_2 被标 `consumed_at=now()`；写 `mailbox_deliveries(batch_1, run_B, [mb_3], [nt_1,nt_2])`；adapter 收到合并的 input

#### Scenario: read_mailbox deliveryBatchId 幂等

- **WHEN** adapter 因网络抖动对同 run_B 第二次调 `room.read_mailbox(deliveryBatchId="batch_1")`
- **THEN** 命中 `mailbox_deliveries(batch_1, run_B)` → 直接返回同一 batch `{ mailbox: [mb_3], nextTurns: [nt_1, nt_2] }`；不重复 mark；不返回新 unread 行（新 unread 需要新 deliveryBatchId）

#### Scenario: 新 deliveryBatchId 只返回新输入

- **WHEN** run_B 第二个 turn 调 `room.read_mailbox(deliveryBatchId="batch_2")`，此时 mailbox 有新 `mb_5` 未读
- **THEN** 未命中 `mailbox_deliveries(batch_2, run_B)` → 走正常事务流；只返回 `{ mailbox: [mb_5], nextTurns: [] }`；**不**返回 mb_3（已被 batch_1 消费）；agent 不会重复看到旧 mailbox 行

#### Scenario: agent 不能伪造 runId

- **WHEN** agent 通过 ACP `tools/call` 在 `room.read_mailbox` 入参中尝试塞 `runId="run_X"`（其他 run）
- **THEN** MCP tool layer 忽略入参 runId，从 adapter session 上下文取真实 runId；audit log `runid_spoof_attempt`

### Requirement: 群聊纪律执行器（Observer 发言降级）

The system SHALL enforce chat discipline at the `RoomMcpServer.handleSendMessage` boundary so that Observer agents cannot inject free-form messages into the main timeline. This is the canonical "observer 不能自由发言" guard described in MVP `rooms/群聊纪律执行器` (spec-only) — V0.5 实现真代码。

**判定规则**：

- 入口：agent 通过 MCP tool `room.send_message` 调用；
- 查 `room_participants WHERE room_id=:roomId AND participant_id=:agentId` 取 `role`；
- `role IN ('primary')` 且 agent 在 active wake 内 → 直发主流（emit `message.created` 等）；
- `role='observer'` AND `presence != 'active'`（即 observing / blocked / waiting_approval / knocking 等任何非显式激活态）→ **拒绝直发**，转 `mailbox.message.created`（target = primary agent）；返回给 agent `{ degraded: true, reason: "observer_must_knock_or_mailbox", mailboxMessageId: <new> }`；
- `role='observer'` AND `presence='active'`（敲门已被 user approve 后） → 允许直发，但**仍记 audit log** `observer_speaking_after_knock`；
- 其他 role（如 V1.0 Squad leader）走对应规则（V0.5 不实现）。

**降级时的事件链**：

- 同一事务内 INSERT `mailbox_messages` 行（target_agent_id=primary, source_agent_id=observer）+ INSERT events `mailbox.message.created`（visibility=detail）；
- 不发 `message.created`（观察者的话不进主流），不发 brief；
- agent 收到 `{ degraded: true, mailboxMessageId }` 响应可记录到自己的 transcript（adapter 自行决定如何提示 LLM "你的发言被降级"）。

**为什么不直接拒绝**：observer 想"提醒"primary 是合法行为；强制走 mailbox 既保留信息又不污染主流。如果 observer 想被人类看见，正确路径是 `room.request_intervention` 走敲门（intervention capability）。

#### Scenario: Observer 在 observing 状态调 send_message

- **WHEN** observer reviewer 在 `presence='observing'` 时调 `room.send_message { text: "I noticed an issue" }`
- **THEN** RoomMcpServer 同事务 INSERT mailbox_messages（target=primary）+ emit `mailbox.message.created`（visibility=detail）
- **AND** 返回给 reviewer `{ degraded: true, reason: "observer_must_knock_or_mailbox", mailboxMessageId: <id> }`
- **AND** 主流不出现 reviewer 的消息

#### Scenario: Observer 敲门被 approve 后允许直发

- **WHEN** reviewer 先调 `room.request_intervention`，user approve 后 reviewer 转 `presence='active'`，再调 `room.send_message`
- **THEN** RoomMcpServer 允许直发；同事务 INSERT messages + emit `message.created`
- **AND** 同时写 audit log `observer_speaking_after_knock { agentId, roomId, interventionId }`

#### Scenario: Primary 调 send_message 不受限

- **WHEN** primary builder 在 `presence='working'` 中（active wake 内）调 `room.send_message`
- **THEN** 直发主流，无降级


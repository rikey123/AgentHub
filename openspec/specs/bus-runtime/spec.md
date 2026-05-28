# bus-runtime Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: Command 与 Event 显式区分

The system SHALL maintain a strict separation between Commands (requests to the system) and Events (facts that have occurred). Commands MAY fail, MAY be rejected, MAY require validation; Events SHALL be immutable once persisted and SHALL only be undone via compensating events.

**Command 命名约定**：动词原型，命令式。

```ts
type Command =
  // —— 用户/HTTP 入口（外部可达）——
  | { type: "SendMessage"; roomId: string; text: string; quotedMessageId?: string; attachments?: AttachmentRef[]; idempotencyKey?: string }
  | { type: "RegenerateMessage"; messageId: string; idempotencyKey?: string }
  | { type: "DeleteMessage"; messageId: string }
  | { type: "PinMessage"; messageId: string }
  | { type: "EditMessage"; messageId: string; text: string; idempotencyKey?: string }     // 仅 user pending message
  | { type: "CancelPendingTurn"; pendingTurnId: string }
  | { type: "ApplyDiff"; artifactId: string }
  | { type: "RejectDiff"; artifactId: string; reason?: string }
  | { type: "RevertArtifact"; artifactId: string }
  | { type: "ResolvePermission"; permissionId: string; decision: "allow" | "deny"; remember?: boolean; scope?: PermissionScope }
  | { type: "ApproveIntervention"; interventionId: string; effectiveText?: string }
  | { type: "IgnoreIntervention"; interventionId: string }
  | { type: "RejectIntervention"; interventionId: string; reason?: string }
  | { type: "SnoozeIntervention"; interventionId: string; snoozeSeconds?: number }
  | { type: "ConfirmContextItem"; contextId: string; baseVersion: number }
  | { type: "DeprecateContextItem"; contextId: string; reason?: string }
  | { type: "CancelRun"; runId: string }
  | { type: "CreateTask"; roomId: string; title: string; parentTaskId?: string; description?: string; assigneeAgentId?: string; sourceRunId?: string; sourceMessageId?: string; dependencies?: string[]; priority?: string; dueAt?: number; idempotencyKey?: string }
  | { type: "UpdateTask"; taskId: string; status: "pending" | "in_progress" | "blocked" | "review" | "completed" | "cancelled" | "open" | "done"; reason?: string; idempotencyKey?: string }
  | { type: "CompleteTask"; taskId: string; idempotencyKey?: string }
  | { type: "CreateRoom"; mode: RoomMode; title: string; primaryAgentId?: string; observerAgentIds?: string[] }
  | { type: "ArchiveRoom"; roomId: string }
  | { type: "UnarchiveRoom"; roomId: string }
  | { type: "ReloadAgentProfile"; agentId: string }
  // —— 内部派发（origin='internal'，CommandBus 拒绝 origin='http'）——
  | { type: "WakeAgent"; roomId: string; agentId: string; workspaceId: string; reason: WakeReason; triggerEventId?: string; promptDelta?: AgentPromptDelta; targetFiles?: string[]; workspaceMode?: "isolated_worktree" | "isolated_copy" | "shadow_buffer" | "shared" | "external"; parentRunId?: string; messageId?: string; pendingTurnId?: string; carryNextTurnIds?: string[]; sourceRunId?: string; idempotencyKey: string }
  | { type: "RetryRun"; parentRunId: string; reuseSession: boolean; idempotencyKey: string }
  | { type: "InjectContext"; runId: string; sessionId: string; patch: ContextProjection; sourceInterventionId?: string; idempotencyKey: string }
  | { type: "ConsumePendingTurn"; pendingTurnId: string; idempotencyKey: string }            // 上一轮 Run 终结后由 Orchestrator 派发；handler 内部转 dispatch WakeAgent
  // 注：mailbox claim 的回滚是 RunLifecycleService.fail() 同事务一致性副作用，MVP 不引入补偿命令

type CommandResult<T = unknown> =
  | { ok: true; data: T; emittedEvents: { seq: number; type: string }[] }
  | { ok: false; error: { code: CommandErrorCode; message: string; details?: unknown } }

type CommandErrorCode =
  // 确定性失败：缓存到 command_records.status='failed'，同 key 同 body 重试返回缓存结果
  | "validation_failed"
  | "not_found"
  | "conflict"               // 乐观锁、状态机非法转换
  | "permission_denied"
  | "duplicate"              // 命中 idempotencyKey
  | "not_implemented"        // V1 占位
  // 瞬态失败：不缓存，事务回滚，同 key 同 body 可重试
  | "internal_error"
  | "transaction_rollback"
  | "crash"
  | "rate_limited"
  | "lock_timeout"
```

**外部 vs 内部 Command**：

`origin: "http"` 的 dispatch 仅允许触发外部可达 Command（上表第一段）；CommandBus MUST 拒绝来自 `http` 的 `WakeAgent / RetryRun / InjectContext / ConsumePendingTurn` 调用（返回 `{ ok: false, code: "validation_failed", reason: "internal_command_via_http" }`）。这四条命令只能由 daemon 内部模块（Orchestrator / RunLifecycleService / PermissionEngine / AdapterBridge）以 `origin: "internal"` dispatch。`origin: "mcp_tool"` 走外部命令子集，且额外受 Permission Engine 校验。

**MVP 没有 `StartRun` 这条 Command**：`agent.run.queued` 的唯一来源是 `WakeAgent` handler。HTTP 层不暴露"直接启动 Run"的入口；用户消息 → `SendMessage` → Orchestrator 在 `turn_dispatch_mode='immediate'` 时 dispatch `WakeAgent` 才是合法路径。这是 D30 决策的最终落地（"避免 WakeAgent 与 StartRun 双入口创建 Run"）。

**MVP 没有 `ApplyMailboxClaimRollback` 这条 Command**：mailbox claim 的回滚是 `RunLifecycleService.fail()` 在事务内按 failureClass 直接执行的一致性副作用（详见上方 "failureClass 与 mailbox 回滚"），不通过补偿命令异步处理。这避免了"`agent.run.failed` 已可见但 mailbox 还没回滚"的中间窗口。

**`WakeAgent` Command 字段与 `WakeAgentInput` / `CreateRunInput` 三者必须对齐**：

`WakeAgent` Command（本文件 Command union）、`orchestrator/WakeAgentInput`（orchestrator spec）、`bus-runtime/CreateRunInput`（本文件 RunLifecycleService 接口）三者的字段集合 MUST 保持一致；任何新增字段必须同时更新三处。CI `command:check` 应校验这三者字段对齐（详见 `event-system/events:check 与 visibility:check CI 校验`）。当前对齐字段：`roomId / agentId / workspaceId / reason / triggerEventId / promptDelta / targetFiles / workspaceMode / parentRunId / messageId / pendingTurnId / carryNextTurnIds / sourceRunId / idempotencyKey`。

**Command Bus 接口**：

```ts
interface CommandBus {
  dispatch<C extends Command>(cmd: C, meta: CommandMeta): Effect.Effect<CommandResult, never, never>
}

type CommandMeta = {
  actor: { type: "user"; id: string } | { type: "agent"; id: string } | { type: "system" }
  traceId: string
  idempotencyKey?: string             // 同 actor 内 24h 唯一；命中即返回上次结果
  origin: "http" | "internal" | "mcp_tool"
}
```

**HTTP 与 Command 的对应关系**：所有 mutating HTTP route SHALL 内部翻译成一条 Command 走 CommandBus，不直接操作数据库或 PubSub。

| HTTP | Command |
|---|---|
| `POST /rooms/:id/messages` | `SendMessage` |
| `POST /messages/:id/regenerate` | `RegenerateMessage` |
| `DELETE /messages/:id` | `DeleteMessage` |
| `POST /messages/:id/pin` | `PinMessage` |
| `POST /artifacts/:id/apply` | `ApplyDiff` |
| `POST /artifacts/:id/reject` | `RejectDiff` |
| `POST /artifacts/:id/revert` | `RevertArtifact` |
| `POST /permissions/:id/resolve` | `ResolvePermission` |
| `POST /interventions/:id/approve` | `ApproveIntervention` |
| `POST /interventions/:id/ignore` | `IgnoreIntervention` |
| `POST /interventions/:id/reject` | `RejectIntervention` |
| `POST /interventions/:id/later` | `SnoozeIntervention` |
| `POST /context/:id/confirm` | `ConfirmContextItem` |
| `PATCH /messages/:id` | `EditMessage`（仅 user pending message） |
| `DELETE /pending-turns/:id` | `CancelPendingTurn` |
| `POST /context/:id/deprecate` | `DeprecateContextItem` |
| `POST /runs/:id/cancel` | `CancelRun` |
| `POST /rooms` | `CreateRoom` |
| `POST /rooms/:id/archive` | `ArchiveRoom` |
| `POST /rooms/:id/unarchive` | `UnarchiveRoom` |
| `POST /agents/:id/reload` | `ReloadAgentProfile` |

#### Scenario: Command 校验失败不进 events 表

- **WHEN** 客户端发 `SendMessage` Command，body 缺 `text` 字段
- **THEN** CommandBus 返回 `{ ok: false, error: { code: "validation_failed", ... } }`；events 表无任何 `message.created`；HTTP 返回 400

#### Scenario: Command 成功后必有事件

- **WHEN** `ApplyDiff` Command 成功
- **THEN** `result.emittedEvents` 至少含 `artifact.applied`（可能附带 `artifact.reviewing`）；每条 event 都已在同一事务内被 INSERT 进 events 表

#### Scenario: 幂等 idempotencyKey 命中

- **WHEN** 客户端在 24 小时内用同一 `idempotencyKey` 重发同一 `SendMessage`
- **THEN** CommandBus 返回上次的 `CommandResult`；不再次写 messages / events 表

#### Scenario: HTTP route 不直接发 event

- **WHEN** 代码 review 阶段
- **THEN** lint 校验：`apps/daemon` 的 HTTP handler 不允许直接调用 `eventBus.publish()` 或操作 domain 表；必须通过 `commandBus.dispatch()`

### Requirement: Command 幂等表（`command_records`）

The system SHALL persist Command idempotency state in a `command_records` table; on dispatch, CommandBus SHALL atomically claim or hit-cache the record before performing any business logic.

```sql
CREATE TABLE command_records (
  -- (actor_type, actor_id, idempotency_key) 联合唯一
  actor_type        TEXT NOT NULL,             -- 'user' | 'agent' | 'system'
  actor_id          TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,

  command_type      TEXT NOT NULL,
  command_hash      TEXT NOT NULL,             -- sha256(canonical(command body))，用于检测同 key 不同 body
  status            TEXT NOT NULL,             -- 'in_flight' | 'succeeded' | 'failed' | 'expired'
  result_json       TEXT,                      -- 缓存的 CommandResult JSON（仅 succeeded/failed）
  trace_id          TEXT,
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,          -- 默认 created_at + 24h
  PRIMARY KEY (actor_type, actor_id, idempotency_key)
);
CREATE INDEX idx_command_records_expires ON command_records (expires_at);
```

**dispatch 流程**：

```text
1. 若 command 无 idempotencyKey：直接执行（无去重，单次性命令）。
2. 若有 idempotencyKey：
   2.1 在事务内尝试 INSERT command_records (status='in_flight', command_hash, ...)
       - 唯一键冲突 → 进入 2.2
   2.2 SELECT 已有行：
       - status='in_flight' + 未超时：返回 { ok: false, error: { code: "duplicate", message: "command in flight" } }
       - status='in_flight' + 超时（now > created_at + 60s）：标 status='expired'（视同未存在），重新 INSERT 走 2.1
       - status='succeeded' + 同 command_hash：直接返回 result_json（命中成功缓存）
       - status='failed' + 同 command_hash：直接返回 result_json（命中失败缓存，仅确定性失败才写入这条，见下文）
       - status='succeeded'/'failed' + 异 command_hash：返回 { ok: false, error: { code: "duplicate", message: "idempotencyKey reused with different body" } }
3. 业务逻辑执行：
   - 成功 → 在 outbox 事务尾部 UPDATE command_records SET status='succeeded', result_json=...
   - 失败 → 按失败分类（见下表）决定写 'failed' 或回滚 command_records
4. 后台 reaper（每分钟一次）：
   - 把 status='in_flight' 且 created_at < now()-60s 的行标 'expired'（用于客户端断线场景下被卡住的键的解锁）
   - DELETE 所有 expires_at < now() 的行
```

**失败分类**（决定是否缓存到 `command_records`）：

| 错误类别 | CommandErrorCode | 缓存为 `failed`？ | 客户端可同 key 重试？ | 理由 |
|---|---|---|---|---|
| 确定性失败 | `validation_failed` / `permission_denied` / `conflict` / `duplicate` / `not_found` / `not_implemented` | 是（缓存 result_json） | 否（同 key 同 body 会返回缓存的失败 = 同样错误） | 业务校验型失败，结果稳定；缓存避免反复执行 |
| 瞬态失败 | `internal_error` / `transaction_rollback` / `crash` / `rate_limited` / `lock_timeout` | 否（事务回滚 → command_records 行不存在） | 是（同 key 同 body 走全新 INSERT） | 与基础设施 / 资源相关，重试可能成功 |
| in_flight 超时 | （特例，无 errorCode） | reaper 标 'expired'，等价不存在 | 是 | daemon 崩溃 / 客户端断线导致键被卡住，需自动恢复 |

实现层面：

```ts
function shouldPersistFailedRecord(error: CommandErrorCode): boolean {
  return [
    "validation_failed",
    "permission_denied",
    "conflict",
    "duplicate",
    "not_found",
    "not_implemented",
  ].includes(error)
}
```

业务 handler 抛出 `TransientError`（含 `internal_error` / `transaction_rollback` / `crash` / `rate_limited` / `lock_timeout` 中的任一 `code`）→ CommandBus 把整个事务回滚（含 `command_records` 行）；handler 抛出 `DeterministicError`（含其余 code）→ 把 `command_records.status='failed'` + `result_json` 提交，但**业务事务**自身回滚（domain / events / outbox 不留下副作用）。

**关键约束**：

- `idempotencyKey` 在 `(actor_type, actor_id)` 范围内唯一（不同 actor 用同 key 互不影响）。
- 同 key 不同 body 视为客户端 bug，拒绝并报错；不静默覆盖。
- 成功路径：`command_records` 行 SHALL 与对应 Command 的 outbox 事务**同一事务提交**——成功时一起写、瞬态失败时一起回滚（避免"业务回滚但幂等键留下"）。
- 确定性失败路径：`command_records.status='failed'` 行写入提交（缓存失败结果），**业务事务**回滚（domain 无副作用）；这是唯一一种 `command_records` 与业务表"分裂提交"的合法情形，且仅用 `failed` + 已经回滚的业务结果。

#### Scenario: 同 key 同 body 重发命中缓存

- **WHEN** user_42 在 60s 内两次以 `idempotencyKey="msg-7"` 发同一 `SendMessage { text: "hi" }`
- **THEN** 第二次返回上次的 `CommandResult`（含原 emittedEvents）；不写新 messages / events / outbox 行

#### Scenario: 同 key 异 body 拒绝

- **WHEN** user_42 第一次以 `idempotencyKey="msg-7"` 发 `SendMessage { text: "hi" }`，第二次同 key 发 `SendMessage { text: "different" }`
- **THEN** 第二次返回 `{ ok: false, error: { code: "duplicate", message: "idempotencyKey reused with different body" } }`；不修改任何 domain 数据

#### Scenario: 24h 后 key 可复用

- **WHEN** user_42 在 25 小时后再用 `"msg-7"` 发 `SendMessage`
- **THEN** 后台清理任务已删除过期行；本次 INSERT 成功，按全新命令处理

#### Scenario: 确定性失败被缓存

- **WHEN** Command 因 `validation_failed`（缺字段）失败，client 用同 key 同 body 重试
- **THEN** 第一次：业务事务回滚（domain 无副作用），但 `command_records.status='failed', result_json={validation_failed, ...}` 提交；第二次：直接返回缓存的 failed result，不再走业务校验逻辑

#### Scenario: 瞬态失败可同 key 重试

- **WHEN** Command 因 `internal_error`（DB 临时不可用）失败
- **THEN** 整个事务（含 `command_records` 行）回滚；客户端用同 key 同 body 重试 → 走全新 INSERT，可能成功

#### Scenario: in_flight 超时自动解锁

- **WHEN** daemon 在处理 Command 中崩溃，留下 `command_records.status='in_flight', created_at = now-300s`；客户端用同 key 重试
- **THEN** reaper 已把该行标 `expired`；客户端重试 INSERT 成功（实际是先 UPDATE 已有行 status='in_flight' + 新 trace_id）；走全新业务路径

### Requirement: Outbox + 事务边界（domain + event 同事务提交）

The system SHALL persist `domain state changes`, the corresponding `events` rows, and `outbox` rows inside a single SQLite transaction. After commit, an asynchronous Outbox Dispatcher SHALL drain the outbox table to the in-process PubSub.

**事务约定**：

```text
TRANSACTION BEGIN
  -- 1. 写 / 更新 domain 表（messages / artifacts / interventions / ...）
  -- 2. 为每个 durable event 取下一 seq 并 INSERT events
  -- 3. INSERT outbox(event_id, status='pending')
COMMIT
  -- 4. （事务外）Outbox Dispatcher 批量取 outbox.status='pending' → PubSub.publish → outbox.status='dispatched'
```

```sql
CREATE TABLE outbox (
  event_id        TEXT PRIMARY KEY REFERENCES events(id),
  seq             INTEGER NOT NULL,
  status          TEXT NOT NULL,                -- 'pending' | 'dispatched' | 'failed'
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  enqueued_at     INTEGER NOT NULL,
  dispatched_at   INTEGER
);
CREATE INDEX idx_outbox_pending ON outbox (status, seq) WHERE status = 'pending';
```

**关键性质**：

1. domain 写成功 ⟺ event 写成功 ⟺ outbox 写成功（三者共事务，要么全在要么全不在）。
2. PubSub 失败不影响 domain 写（已在事务前提交）。
3. daemon 崩溃恢复后，启动时扫描 `outbox.status='pending'` 重新派发。

#### Scenario: Domain 写成功 publish 必能恢复

- **WHEN** Command handler 在事务内成功写了 messages 行 + events 行 + outbox 行，事务 COMMIT 后立即 `kill -9` daemon（PubSub 还没消费 outbox）
- **THEN** 重启后启动 hook 扫描 outbox 找到 `pending` 行 → 重新 publish → SSE 客户端能收到该事件；不漏事件

#### Scenario: Domain 写失败不留事件

- **WHEN** Command handler 在事务内 `INSERT messages` 因唯一键冲突失败
- **THEN** 整个事务 ROLLBACK；events / outbox 都没有该事件；CommandBus 返回 `{ ok: false, error: { code: "conflict" } }`

#### Scenario: Outbox Dispatcher 派发失败重试

- **WHEN** Outbox Dispatcher 调 `pubsub.publish()` 抛错（极少见，PubSub 实现层故障）
- **THEN** 把该 outbox 行 `attempts += 1`，`last_error` 写入；指数退避重试（1s / 4s / 16s / 60s 上限）；超过 10 次进入 DLQ（见后文 Requirement）

#### Scenario: 启动时 outbox 顺序恢复

- **WHEN** 重启时 outbox 有 5 条 pending（seq 100..104）
- **THEN** Dispatcher 按 `seq` 升序逐条派发，不允许乱序；派发完一条后才 `outbox.status='dispatched'`

### Requirement: 单调 seq 与 cursor 语义（指向 event-system）

The system's monotonic `seq` defined in `event-system` capability SHALL serve as the single durable cursor for all replay paths: SSE clients, durable handlers, and Debug Panel. Ephemeral events MUST NOT advance any cursor.

This requirement is the cross-cutting contract; concrete schema lives in `event-system/events 表 Schema`. `bus-runtime` adds the **cursor table** for handlers (next requirement).

#### Scenario: 三类消费者共用 seq 语义

- **WHEN** 系统中同时存在 SSE 客户端 / Orchestrator handler / Debug Panel
- **THEN** 三者推进游标的语义一致："已成功处理到 seq=X"；都通过查询 `events.seq > X ORDER BY seq ASC` 回放；不存在某个消费者用 createdAt / id 自行推进的代码路径

#### Scenario: ephemeral 不影响任何 cursor

- **WHEN** 系统在 1 秒内派发 100 条 ephemeral + 5 条 durable
- **THEN** 所有 cursor 只前进 5 步（最新 durable seq）；ephemeral 计数对 cursor 不可见

### Requirement: Durable Handler 注册 + 游标 + at-least-once 语义

The system SHALL register every business module's interest in durable events as a named **durable handler** with its own persisted cursor. Handlers SHALL receive each event at least once, in `seq` order; idempotency is the handler's responsibility.

**handler 注册**：

```ts
interface DurableHandler {
  readonly name: string                          // 'orchestrator' / 'context-ledger' / 'artifact-manager' / ...
  readonly subscribes: AgentHubEventType[]       // 关心的 event type 列表
  handle(event: DurableEvent): Effect.Effect<void, HandlerError>
}

interface DurableHandlerRegistry {
  register(handler: DurableHandler): Effect.Effect<void, never>
}
```

```sql
CREATE TABLE handler_cursors (
  handler_name    TEXT PRIMARY KEY,
  last_seq        INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);
```

**派发协议（方案 A：全局观察游标）**：

1. 启动时为每个 handler 拉取 `events WHERE seq > handler_cursors.last_seq ORDER BY seq ASC`，**不带 type 过滤**（`subscribes` 列表只控制是否调 `handle()`，不控制 SQL 范围）。
2. 按 seq 升序逐条处理：
   - `event.type ∈ subscribes` → 调 `handler.handle(event)`；成功 → UPDATE `handler_cursors.last_seq=event.seq`；失败 → 走重试（下一 Requirement）。
   - `event.type ∉ subscribes` → 不调 `handle()`，但**仍推进 cursor**（UPDATE `handler_cursors.last_seq=event.seq`）。
3. 实时阶段：Outbox Dispatcher 派发一条 → 通知所有 handler（不分订阅）；每个 handler 内部按 type 决定是否 `handle()`，无论是否调用都推进自己的游标。
4. 同一 handler 在 seq=X 处理完前不会处理 seq=X+1（保序）。
5. cursor 是观察游标 ⟹ 改 handler 的 `subscribes` 列表后**不需要回填历史**（历史已被观察过、按当时的列表决策过）；如果需要历史回填，必须显式 reset cursor（运维操作，记 audit）。

理由：

- 游标语义与 event-system 的全局 `seq` 完全一致（"我观察到第 X 步"），便于 Debug Panel 用同一游标查所有 handler 进度。
- 改 `subscribes` 列表不会因 SQL 过滤改变而出现"以为 handler 已经处理过 ≤ N，结果新加订阅又拉一遍"的二义性。
- 代价：每条 durable event 都要通知每个 handler 的游标推进。MVP 量级（单机几十 handler）无压力；后续阶段（V1.3 plugin-system 引入插件 handler、V1.5 War Room 引入更多内部 handler）仍能保留同一语义，单机 SQLite 在 plugin handler ≤ 50 量级足够。**路线红线 D32**：永不切 Postgres，并发上限通过队列 + 锁矩阵控制。

#### Scenario: daemon 崩溃恢复时 handler 自动追平

- **WHEN** daemon 崩溃前 events 写到 seq=120，但 Orchestrator handler `last_seq=90`（处理到一半）
- **THEN** 启动时 Orchestrator 启动 catch-up：按 seq 91..120 逐条遍历，对订阅类型调 `handle()`、对未订阅类型直接跳过；最终 `handler_cursors.orchestrator.last_seq=120`；之后才进入实时模式

#### Scenario: Handler 处理须保序

- **WHEN** Orchestrator 收到 seq=100 的 `message.created` 处理需 200 ms
- **THEN** seq=101 的事件即使已派发，也必须等 seq=100 处理完成才被调用；不允许并发处理同一 handler 的多个 seq

#### Scenario: at-least-once → handler 必须幂等

- **WHEN** 网络抖动导致同一事件被 handler 处理两次
- **THEN** handler 内部按 event.id（ULID 唯一）去重；外部副作用使用 idempotencyKey；测试用例显式覆盖"重复投递不产生重复 Run / 重复 message"

#### Scenario: 不订阅的事件推进 cursor 但不调 handle

- **WHEN** ContextLedger handler 的 `subscribes = ["context.snapshot"]`，seq=42 是 `permission.requested`
- **THEN** ContextLedger 的 `handle()` 不被调用，但 `handler_cursors.context-ledger.last_seq=42`；下次再看到 seq=42 时不会被重复观察

#### Scenario: 改 subscribes 列表不回填历史

- **WHEN** 开发者在 v0.5 给 ContextLedger 增加订阅 `tool.call.completed`，重新部署时 `last_seq` 仍是上次值
- **THEN** ContextLedger 不会回头处理历史 `tool.call.completed`；只对未来的事件起效。如果需要回填，必须显式跑 `agenthub admin handler reset-cursor context-ledger --to=<seq>` 并审计记录

### Requirement: Handler 重试 + 死信队列（DLQ）

The system SHALL retry failed `handle()` calls with exponential backoff up to 5 attempts; persistent failures SHALL be moved to a dead-letter table observable via Debug Panel.

```sql
CREATE TABLE dead_letter_events (
  id              TEXT PRIMARY KEY,                    -- ULID
  handler_name    TEXT NOT NULL,
  event_id        TEXT NOT NULL REFERENCES events(id),
  event_seq       INTEGER NOT NULL,
  attempts        INTEGER NOT NULL,
  last_error      TEXT NOT NULL,
  failed_at       INTEGER NOT NULL,
  status          TEXT NOT NULL                        -- 'unresolved' | 'replayed' | 'skipped'
);
CREATE INDEX idx_dlq_handler ON dead_letter_events (handler_name, status);
```

**重试策略**：1s → 4s → 16s → 60s → 300s（共 5 次），全失败移入 DLQ。

**关键决策**：handler 失败时游标 **不前进**——保证不丢事件，但同 handler 后续事件被阻塞。如果 DLQ 也满了或事件被显式 skip，游标才前进。

**Debug Panel 操作**：

- 查看 DLQ 列表（handler / event seq / 错误堆栈）
- `Replay`：重新尝试该事件（清 attempts，唤醒 handler）
- `Skip`：标 `status='skipped'` + 推进 cursor（接受丢一条事件的代价）

#### Scenario: handler 抛错后指数退避

- **WHEN** Orchestrator `handle(message.created seq=42)` 第一次抛错
- **THEN** 不推进 cursor；1 秒后重试；4 秒后重试；…；第 5 次仍失败 → INSERT dead_letter_events `status='unresolved'`，**仍不推进 cursor**；Orchestrator 在 seq=42 处停滞，发 `handler.stalled` durable 事件

#### Scenario: 用户在 Debug Panel skip DLQ

- **WHEN** 用户对 DLQ 中 `(orchestrator, seq=42)` 点 Skip
- **THEN** `dead_letter_events.status='skipped'`；`handler_cursors.orchestrator.last_seq=42`；handler 解阻塞，开始处理 seq=43+

#### Scenario: 用户 Replay DLQ

- **WHEN** 用户点 Replay
- **THEN** 重新调 `handler.handle(event)`；成功 → DLQ status='replayed' + 推进 cursor；失败 → 重新计数 attempts

### Requirement: RunLifecycleService 是 `runs` 表的唯一写入口

The system SHALL implement `RunLifecycleService` as the single write entry point to the `runs` table. Every state transition MUST go through one of its methods; `RunQueue Worker`、`AdapterBridge`、`CancelRun` handler、`RunService` and any other module **MUST NOT** issue raw `UPDATE runs` SQL.

```ts
type RunFailureClass =
  | "transient"
  | "retryable_visible"
  | "fresh_session_required"
  | "permission_denied"
  | "user_cancelled"
  | "configuration"
  | "fatal"

interface RunLifecycleService {
  // 所有 mutation 方法都接受可选的 tx；调用方传入即参与外层事务（不开新事务），不传则 service 自开 IMMEDIATE 事务。
  // 这是 mailbox claim + run create 同事务一致性的关键：WakeAgent handler 在 IMMEDIATE 事务里依次调
  //   mailboxService.claimUnread(tx, ...)
  //   runLifecycleService.create(tx, input)
  // 任一失败 tx 整体回滚。

  // WakeAgent handler 调用（在 IMMEDIATE 事务内 claim mailbox 后立即调）
  create(tx: SqliteTx | null, input: CreateRunInput): Effect.Effect<Run, RunLifecycleError>
  // RunQueue Worker 调用（按状态机顺序）
  markWaiting(tx: SqliteTx | null, runId: string, reason: string): Effect.Effect<void, RunLifecycleError>
  markClaimed(tx: SqliteTx | null, runId: string): Effect.Effect<void, RunLifecycleError>
  markStarting(tx: SqliteTx | null, runId: string, pidAtStart: number): Effect.Effect<void, RunLifecycleError>
  markRunning(tx: SqliteTx | null, runId: string, adapterSessionId: string): Effect.Effect<void, RunLifecycleError>
  // PermissionEngine 调用（详见 permissions/Per-session 串行化）
  markWaitingPermission(tx: SqliteTx | null, runId: string, permissionId: string): Effect.Effect<void, RunLifecycleError>
  // CancelRun handler 调用
  markCancelling(tx: SqliteTx | null, runId: string): Effect.Effect<void, RunLifecycleError>
  // AdapterBridge 调用
  complete(tx: SqliteTx | null, runId: string, cost: Cost): Effect.Effect<void, RunLifecycleError>
  /**
   * fail 是非终结状态都可进入的"统一失败入口"；
   * 调用方传入 tx 时（典型场景：fail() 同事务回滚 mailbox claim）失败处理与外层 mailbox UPDATE 一致原子；
   * 不传时 service 内部开 IMMEDIATE 事务并在事务内：UPDATE runs + INSERT events(agent.run.failed) + INSERT outbox + 按 failureClass 在同事务内 UPDATE mailbox_messages 回滚 claim（详见下方"failureClass 与 mailbox 回滚"段）。
   */
  fail(
    tx: SqliteTx | null,
    runId: string,
    reason: string,
    failureClass: RunFailureClass,         // 必填，决定重试策略与 mailbox 回滚
    error?: string
  ): Effect.Effect<void, RunLifecycleError>
  cancelFinalized(tx: SqliteTx | null, runId: string): Effect.Effect<void, RunLifecycleError>
  // AdapterBridge / RunQueue Worker 调用，不发 durable event（高频小变更）
  updateSessionState(
    tx: SqliteTx | null,
    runId: string,
    patch: Partial<{
      adapterSessionId: string
      workDir: string
      providerConversationId: string
      pidAtStart: number
    }>
  ): Effect.Effect<void, RunLifecycleError>
}

type CreateRunInput = {
  runId: string                     // ULID，由调用方分配（WakeAgent handler 生成）
  agentId: string
  roomId: string
  taskId?: string
  workspaceId: string
  wakeReason: WakeReason
  workspaceMode?: "isolated_worktree" | "isolated_copy" | "shadow_buffer" | "shared" | "external"
  parentRunId?: string              // Run reuse；非空时复用 prior session
  targetFiles?: string[]            // best-effort 文件锁声明；未知时 RunQueue 退化为 workspace 级写锁
  promptDelta?: AgentPromptDelta
  mailboxClaimIds?: string[]        // 已在外层事务 claim 的 mailbox 行 id（用于 fail 回滚）
  carryNextTurnIds?: string[]       // 来自旧 run 的未消费 run_next_turns ids；service 在事务内防御性 rebind（AND room_id / agent_id / run_id=sourceRunId / consumed_at IS NULL；affected rows 必须等于 carryNextTurnIds.length，否则回滚 StaleOrInvalidNextTurnIds）；详见 orchestrator/run_next_turns 表
  sourceRunId?: string              // carryNextTurnIds 来源的旧 run id；rebind SQL 加 AND run_id=:sourceRunId 防止跨 run 误绑定；与 carryNextTurnIds 同时填或同时不填
  triggerEventId?: string           // 触发本次创建的 durable event id（causationId）
  messageId?: string                // 关联的 user message
  pendingTurnId?: string            // 关联的 PendingTurn
}
```

**契约**：

- 每个方法 SHALL 在**单事务**内完成 UPDATE runs（含 status / waiting_reason / started_at / ended_at / cost / adapter_session_id / failure_class / pid_at_start 字段）；**会发出 durable event 的方法**（见下方对照表）必须在同一事务内 INSERT 对应 events 行（分配 seq）+ INSERT outbox 行；**不发 durable event 的方法**（`markCancelling` / `updateSessionState`）只 UPDATE runs 一张表。
- 状态机校验在方法内：
  - `markWaiting`：仅允许从 `queued` 进入；同 reason 重复视为幂等无副作用
  - `markClaimed`：允许从 `queued | waiting → claimed`（`waiting` 是因锁被占用而入队，锁释放后 RunQueue Worker 重新调度 → 直接走 `markClaimed`，无需先 `markRunning` / 退回 `queued`）
  - `markStarting`：仅允许从 `claimed` 进入（**不**从 `queued` / `waiting` 直接进入；`claimed` 是 RunQueue Worker 拿锁的中间态）
  - `markRunning`：允许从 `starting` 或 `waiting_permission` 进入；从 `waiting_permission` 进入时 SHALL 在事务内额外 INSERT `agent.run.resumed` event（visibility=detail）
  - `markWaitingPermission`：仅允许从 `running` 进入
  - `markCancelling`：允许从 `queued / waiting / claimed / starting / running / waiting_permission` 进入
  - `complete`：允许从 `starting / running / waiting_permission`；从 `cancelling` 进入 → `IllegalTransition`（取消语义只能走 fail/cancelFinalized）
  - `fail`：**允许从 `queued / waiting / claimed / starting / running / waiting_permission / cancelling` 任意非终结状态进入**。非终结状态都可能因锁超时（waiting）、Reclaim claim_aborted（claimed）、daemon_restarted（queued/starting/running/waiting_permission）等原因失败；payload 用 `failureClass + reason` 区分。
  - `cancelFinalized`：仅允许从 `cancelling` 进入
  - 从已终结状态（`completed / failed / cancelled`）进入任意 mutating 方法 → `IllegalTransition` 事务回滚
  - 非法转换抛 `RunLifecycleError.IllegalTransition`，事务回滚，不发事件。
- 方法名与发出的事件一一对应：

  | 方法 | 发出事件 |
  |---|---|
  | `create` | `agent.run.queued` |
  | `markWaiting` | `agent.run.waiting`（仅当 `(status, waiting_reason)` 与原值不同才发，避免刷屏） |
  | `markClaimed` | （无 durable event；仅 UPDATE runs.status='claimed' + claimed_at；claimed 是 worker 已拿锁但 adapter 未启动的瞬态窗口） |
  | `markStarting` | `agent.run.started` |
  | `markRunning` | （无 durable event 当 prevState='starting'；prevState='waiting_permission' 时 INSERT `agent.run.resumed`；UPDATE runs.status='running' + adapter_session_id） |
  | `markWaitingPermission` | `agent.run.waiting_permission`（payload 含 permissionId） |
  | `markCancelling` | （无 durable event；仅 UPDATE runs.status='cancelling'；最终 cancelFinalized 发 `agent.run.cancelled`） |
  | `complete` | `agent.run.completed`（payload 含完整 cost） |
  | `fail` | `agent.run.failed`（payload 含 `failureClass / reason / error?`） |
  | `cancelFinalized` | `agent.run.cancelled` |
  | `updateSessionState` | （无事件；详见 `RunLifecycleService.updateSessionState` Requirement） |

- 方法是幂等的：同 runId 重复调同一终结方法（complete/fail/cancelFinalized）→ 第二次返回 `IllegalTransition`，事务回滚（不重复发事件，不重复释放锁）。
- `fail()` 的 `failureClass` 决定下游行为（详见 `agents/Run 失败分类 + 与 Handler 重试隔离`）：mailbox 是否回滚、是否自动重试、是否复用 session、UI 表现。所有调用方 MUST 显式传 failureClass，**不**允许使用默认值。

**failureClass 与 mailbox 回滚 + run_next_turns finalization（同事务）**：

`fail()` 在事务内除 UPDATE runs / INSERT events(agent.run.failed) / INSERT outbox 外，MUST 按 failureClass 同事务处理 mailbox claim 与 run_next_turns：

| failureClass | mailbox 行为（同 fail 事务） | run_next_turns 行为（同 fail 事务） |
|---|---|---|
| `transient` / `retryable_visible` / `fresh_session_required` | `UPDATE mailbox_messages SET read=0, claimed_run_id=NULL, claimed_at=NULL, delivery_batch_id=NULL WHERE claimed_run_id=:runId`，让下次 wake 重新认领（清 `delivery_batch_id` 是关键：否则新 run 的 `read_mailbox` 查询会因 `delivery_batch_id` 非空而过滤掉这些行，导致"看起来已回滚，实际新 run 读不到"） | **不动**（rows 保留 `run_id=:runId, consumed_at IS NULL`）；Orchestrator terminal hook 查到未消费 rows 后派发 `WakeAgent({ carryNextTurnIds, sourceRunId })` carry 到新 run |
| `permission_denied` / `user_cancelled` / `configuration` / `fatal` | 保持 `read=1, claimed_run_id=:runId`（不重投，避免循环） | `UPDATE run_next_turns SET consumed_at=now() WHERE run_id=:runId AND consumed_at IS NULL`（标 consumed，audit log 记录"未实际处理"；terminal hook 不再 carry） |

`fail()` 内部通过 **注入接口** `RunLifecycleSideEffects.finalizeNextTurns(tx, runId, failureClass)` 完成 `run_next_turns` 处理，而不是直接 import orchestrator 模块。这避免了 `bus-runtime → orchestrator` 的反向依赖（orchestrator 本身依赖 bus-runtime 的 `RunLifecycleService`，若 bus-runtime 再反向 import orchestrator 会形成循环）。

**`RunLifecycleSideEffects` 注入接口**（bus-runtime 定义，orchestrator 实现，daemon composition root 注入）：

```ts
interface RunLifecycleSideEffects {
  /**
   * 在 RunLifecycleService.fail() 的同一事务内处理 run_next_turns finalization。
   * 由 orchestrator 模块实现，通过 daemon composition root 注入到 RunLifecycleService。
   * bus-runtime 不 import orchestrator；orchestrator 不 import bus-runtime 的 fail 实现。
   *
   * 失败语义：若 finalizeNextTurns 失败（SQLite busy / schema mismatch / 磁盘错误等），
   * RunLifecycleService.fail() 的整个事务 MUST rollback，不写 agent.run.failed event / outbox。
   * 这保证"mailbox 回滚、next_turn finalization、agent.run.failed event"三者同事务一致。
   */
  finalizeNextTurns(
    tx: SqliteTx,
    runId: string,
    failureClass: RunFailureClass
  ): Effect.Effect<void, RunLifecycleSideEffectError>
}

type RunLifecycleSideEffectError =
  | { _tag: "DbError"; cause: unknown }
  | { _tag: "SchemaError"; cause: unknown }
```

daemon composition root 注入示例：

```ts
// packages/daemon/src/composition-root.ts
const nextTurnService = new NextTurnService(db)
const runLifecycleService = new RunLifecycleServiceImpl(db, {
  finalizeNextTurns: (tx, runId, failureClass) =>
    nextTurnService.finalizeForRun(tx, runId, failureClass)
})
```

mailbox 回滚与 next_turn finalization 都是 run failure 的一致性副作用，**MUST** 与 `agent.run.failed` event 在同一事务，不引入补偿命令。

#### Scenario: RunQueue Worker 不裸写 runs

- **WHEN** RunQueue Worker 拿到所有锁
- **THEN** 先 `INSERT run_locks`（事务 1）→ 再调 `runLifecycleService.markClaimed(null, runId)`（事务 2，仅 UPDATE runs.status='claimed' + claimed_at）→ 再调 `runLifecycleService.markStarting(null, runId, process.pid)`（事务 3，UPDATE runs.status='starting' + INSERT events(agent.run.started) + outbox）；Worker 不在自己的事务内写 runs

#### Scenario: AdapterBridge 不裸写 runs

- **WHEN** AdapterBridge 收到 adapter 完成事件，决定终结一个 Run
- **THEN** 调 `runLifecycleService.complete(null, runId, cost)`；service 内部一个事务内 UPDATE runs.status='completed'+ended_at+cost + INSERT events(agent.run.completed) + INSERT outbox；AdapterBridge 自己不 UPDATE runs

#### Scenario: 重复终结被拒绝

- **WHEN** AdapterBridge 因网络抖动重发完成信号，第二次调 `runLifecycleService.complete(null, runId, cost)`
- **THEN** Service 检测到 runs.status 已是 'completed'，事务回滚抛 `IllegalTransition`；不重复发 `agent.run.completed`；调用方按幂等约定忽略错误

#### Scenario: 状态机校验

- **WHEN** 任意调用方对 `runs.status='completed'` 的 run 调 `markStarting`
- **THEN** Service 抛 `IllegalTransition`，事务回滚，runs / events / outbox 全无副作用

#### Scenario: claimed 是 markStarting 唯一前置

- **WHEN** RunQueue Worker 跳过 markClaimed 直接调 `markStarting`
- **THEN** prevState='queued' ≠ 'claimed' → IllegalTransition；事务回滚；CI 用单元测试覆盖此路径

#### Scenario: waiting_permission 恢复发 resumed

- **WHEN** Run 从 `waiting_permission` 通过 `markRunning(null, runId, sessionId)` 恢复
- **THEN** 事务内 UPDATE runs.status='running' + INSERT events(`agent.run.resumed`, visibility=detail) + outbox；UI Run Detail 据此显示恢复时间点

#### Scenario: fail 必须带 failureClass

- **WHEN** 任意调用方调 `fail(null, runId, "...", undefined as any)`
- **THEN** TypeScript 编译期拒绝（参数必填）；运行时也校验 `failureClass` ∈ canonical 枚举，否则抛 `RunLifecycleError.InvalidFailureClass`

**V0.5 扩展：terminal 事务包含 brief 发布**

V0.5 在 `complete / fail / cancelFinalized` 三个 terminal 方法的同一事务内，增加 `message.brief.published` durable event 发布；`briefText` 由调用方在事务外通过 `BriefGenerator.generate()` 生成后传入。

**V0.5 接口扩展**（在 V0 接口基础上加可选 `briefText` 参数）：

```ts
// V0.5: 三个 terminal 方法签名扩展（其余方法保持 V0 不变）
complete(tx: SqliteTx | null, runId: string, cost: Cost, briefText?: string): Effect.Effect<void, RunLifecycleError>
fail(tx: SqliteTx | null, runId: string, reason: string, failureClass: RunFailureClass, error?: string, briefText?: string): Effect.Effect<void, RunLifecycleError>
cancelFinalized(tx: SqliteTx | null, runId: string, briefText?: string): Effect.Effect<void, RunLifecycleError>
```

V0.5 terminal 事务内的写操作（如有 briefText）：

```
tx {
  UPDATE runs.status = terminal
  INSERT events(agent.run.completed/failed/cancelled)
  INSERT events(message.brief.published)               ← V0.5 新增（如 briefText 提供）
  UPDATE messages.brief_published_at WHERE run_id=...  ← V0.5 新增（如有匹配的 assistant message）
  INSERT outbox（两条 events 都进 outbox）
  -- fail() 还包含 mailbox 回滚 + finalizeNextTurns（V0 已有）
}
```

**V0.5 brief 约束**：

- `BriefGenerator.generate()` 必须在事务**外**调用（纯计算，不访问 DB），结果字符串传入事务内；
- 如果 `BriefGenerator.generate()` 抛出异常，调用方 MUST 捕获并传 `briefText=""`（不阻断 Run 终结）；
- `briefText` 未传时 RunLifecycleService **不发** `message.brief.published`（向后兼容 V0 调用约定）；
- `message.brief.published` 的 `runId` 字段必须与 `agent.run.completed/failed/cancelled` 的 `runId` 一致；
- `messages.brief_published_at` 更新：`UPDATE messages SET brief_published_at=:now WHERE run_id=:runId AND role='assistant' AND status='completed'`（通过 `messages.run_id` 反向关联，不依赖不存在的 `runs.message_id`）；如无匹配行则跳过（不报错）；
- 两条 durable events 都进 outbox，Outbox Dispatcher 按 seq 顺序派发（brief 在 run terminal event 之后）。

**V0.5 brief 回滚语义**：

- 如果整个 tx 回滚（如 DB 锁超时），两条 events 都不发布；Run 状态不变；
- 不存在"run terminal 发布但 brief 漏发"的情况（同事务保证）；
- 不存在"brief 发布但 run terminal 漏发"的情况（同事务保证）。

调用方（AdapterBridge / Orchestrator terminal hook）负责在调用前调 `BriefGenerator.generate()` 并传入 `briefText`；RunLifecycleService 不直接依赖 BriefGenerator（避免循环依赖）。

#### Scenario: complete 同事务发 brief（V0.5）

- **WHEN** AdapterBridge 调 `RunLifecycleService.complete(tx, runId, cost, "我已添加 OAuth 校验...")`
- **THEN** 同一 tx 内：① UPDATE runs.status='completed' ② INSERT events(agent.run.completed) ③ INSERT events(message.brief.published { text: "我已添加 OAuth 校验..." }) ④ UPDATE messages.brief_published_at WHERE run_id=:runId AND role='assistant'（通过 messages.run_id 反向关联）⑤ INSERT outbox（两条）
- **AND** 任一步失败整个 tx 回滚

#### Scenario: BriefGenerator 异常不阻断 Run 终结（V0.5）

- **WHEN** BriefGenerator.generate() 抛出异常（如 finalAssistantText 含异常字符）
- **THEN** AdapterBridge 捕获异常，传 `briefText=""` 调 complete
- **AND** tx 正常提交；`briefText=""` 时 RunLifecycleService 不发 `message.brief.published`（向后兼容）
- **AND** Run 状态正常变 completed

#### Scenario: 无关联 message 时不更新 brief_published_at（V0.5）

- **WHEN** Run 没有关联 user message（如 daemon 内部触发的 Run），但 briefText 提供
- **THEN** tx 内 UPDATE messages.brief_published_at 影响 0 行，不报错跳过
- **AND** `message.brief.published` 仍发布（runId 字段标识来源）


### Requirement: RunQueue 是 bus 的一条命名队列

The system SHALL implement a `RunQueue` as a first-class concept on top of the bus, not as ad-hoc Orchestrator code. RunQueue SHALL serialize Agent Runs by composite locks: `(roomId, agentId, [targetFiles])`. RunQueue Worker SHALL be the **sole owner** of `run_locks` table writes; AdapterManager and AdapterBridge MUST NOT touch locks. RunQueue Worker MUST NOT issue raw `UPDATE runs` SQL — all run state transitions go through `RunLifecycleService`（见上一 Requirement）.

**Run 触发的完整链路**：

```text
Orchestrator decision
  → CommandBus.dispatch(WakeAgent, { origin: "internal" })
        # WakeAgent 是模型调用唯一入口（详见 orchestrator/Observing 是被动状态 + WakeAgent）
        # MVP 没有 StartRun Command；用户路径在 SendMessage 事务里依据 turn_dispatch_mode 决定是否 dispatch WakeAgent
  → WakeAgent handler (orchestrator 模块内部)
      # IMMEDIATE 事务（单事务原子）：
      #   1) activeWakes guard — 已 active → append next_turn 而非新 run
      #   2) 原子 claim mailbox（详见 orchestrator/Mailbox 原子认领）
      #   3) RunLifecycleService.create(input)  — service 在同事务内 INSERT runs(status='queued', wake_reason, mailbox_claim_count) + INSERT events(agent.run.queued) + INSERT outbox
      # WakeAgent handler 不另行 dispatch StartRun（MVP 不存在该 Command）
  → RunQueue Worker (durable handler subscribed to agent.run.queued)
  → Worker tries to acquire (agent / room / file) locks against `run_locks`
      ├─ all locks acquired → INSERT run_locks (事务 1)
      │                     → RunLifecycleService.markClaimed(null, runId)        # 事务 2：UPDATE runs.status='claimed' + claimed_at（无 durable event）
      │                     → RunLifecycleService.markStarting(null, runId, pid)  # 事务 3：UPDATE runs.status='starting' + pid_at_start + INSERT events(agent.run.started) + outbox
      │                     → AdapterManager.startRun(runId, profile, ...)
      │                     → AdapterBridge subscribes to that adapter session's Stream<AdapterEvent>
      │                     → On adapter session opened (**canonical 两步顺序，独立事务，让 Reclaim 可恢复 starting+sessionId 窗口**):
      │                         tx1: RunLifecycleService.updateSessionState(null, runId, { adapterSessionId, workDir, providerConversationId? })
      │                         tx2: RunLifecycleService.markRunning(null, runId, adapterSessionId)
      │                         # 若 daemon 在 tx1 commit 后、tx2 之前崩溃 → status='starting' + adapter_session_id IS NOT NULL，
      │                         # 落入 ReclaimStaleClaimedRun 扫描候选 3，按 crashRecovery=resumable + status='starting' attach 后走 markRunning
      └─ blocked → RunLifecycleService.markWaiting(null, runId, reason)        # 事务：UPDATE runs.status='waiting'+waiting_reason + 仅在 (status, reason) 变化时 INSERT events(agent.run.waiting) + outbox
```

**终结链路**：

正常完成 / 失败：

```text
AdapterBridge sees adapter completion / error / session.ended
  → RunLifecycleService.complete(null, runId, cost)         # 单事务：UPDATE runs.status='completed' + ended_at + cost + INSERT events(agent.run.completed) + outbox
  → 或 .fail(null, runId, reason, failureClass)
  → RunQueue Worker (subscribed to .completed/.failed/.cancelled)
  → 释放 run_locks WHERE run_id = runId
  → scheduleTick()                                    # 唤醒等待队列
```

用户取消（同步驱动 adapter，不依赖 event 回环）：

```text
HTTP POST /runs/:id/cancel
  → CommandBus.dispatch(CancelRun)
  → RunService.handleCancelRun()
      → RunLifecycleService.markCancelling(null, runId)     # 事务 1：UPDATE runs.status='cancelling'（无 durable event）
      → AdapterManager.cancelRun(runId)               # 同步驱动 adapter（同 Allowed sync queries 表）
  ↓ adapter session 实际收尾后
AdapterBridge sees adapter session.ended
  → RunLifecycleService.cancelFinalized(null, runId)        # 事务 2：UPDATE runs.status='cancelled' + INSERT events(agent.run.cancelled) + outbox
  → RunQueue Worker 释放锁、scheduleTick
```

> **为何 cancel 走同步路径而非订阅事件**：若 AdapterBridge 订阅 `agent.run.cancelled` 才去调 `adapter.cancelRun()`，等该事件出现时 cancel 早已"完成态"，反而触发死循环 / 二次取消。MVP 用 CancelRun handler 在 `markCancelling` 成功后直接调 `AdapterManager.cancelRun(runId)` —— 简单、可靠、无回环。

**队列状态唯一来源**：

- The authoritative queue state SHALL live in `runs.status IN ('queued', 'waiting', 'starting', 'running')` (and `runs.waiting_reason`).
- `agent.run.queued` events are immutable facts — **the worker MUST NOT use any "notYetScheduled" event flag**; it MUST scan `runs` table for queued/waiting rows.
- The worker uses the durable event purely as a **wake-up signal** (handler cursor advances on each `agent.run.queued`); the actual scheduling decision reads `runs`.

**锁矩阵**：

| 锁类型 | lock_type | 作用 | 持有者 |
|---|---|---|---|
| Agent 锁 | `agent` | 同一 Agent 不能并发跑两个 Run | runId |
| Room 锁 | `room` | Solo / Assisted 模式下用户消息触发的 Run 串行 | runId |
| 文件锁 | `file` | 多 Run 声明同一 targetFile 时串行 | runId per file |
| Workspace 锁 | `workspace` | `targetFiles` 未知（如重型 coding agent 的 best-effort 退化）时申请整 workspace 写锁；与 file 锁互斥（详见下文 "workspace ↔ file 互斥规则"） | runId per workspace |

**workspace ↔ file 互斥规则**（关键，避免简单 `(lock_type, lock_key)` 主键不足以阻止 workspace+file 并行写）：

`run_locks` 表新增 `workspace_id` 字段（**`file` 与 `workspace` 类型**必填，`agent` / `room` 可空），并在锁申请阶段用以下两条规则做交叉互斥：

```text
申请 lock_type='file', lock_key='<path>', workspace_id='<W>' 前：
  SELECT 1 FROM run_locks
   WHERE lock_type='workspace' AND workspace_id='<W>' AND run_id != '<currentRunId>'
   LIMIT 1
  → 命中 → 阻塞（reason="workspace_lock_held_by:<runId>"）

申请 lock_type='workspace', lock_key='<W>', workspace_id='<W>' 前：
  SELECT 1 FROM run_locks
   WHERE lock_type='file' AND workspace_id='<W>' AND run_id != '<currentRunId>'
   LIMIT 1
  → 命中 → 阻塞（reason="file_locks_held_in_workspace:<W>"）
```

两条规则在同一个事务内 + 锁表上的 `IMMEDIATE` 事务保证检查与写入原子。`agent` / `room` 锁不参与该互斥（它们是不同维度的串行约束）。

**调度算法（伪码）**：

```ts
// On agent.run.queued event OR on lock release notification
async function scheduleTick() {
  // 队列状态来自 runs 表，不是 events 表
  const candidates = await db.select(`
    SELECT * FROM runs
    WHERE status IN ('queued', 'waiting')
    ORDER BY created_at ASC
    LIMIT BATCH
  `)

  for (const run of candidates) {
    const lockResult = tryAcquireAllLocks(run)   // 字典序：agent → room → files（targetFiles 未知时退化为 workspace 级写锁）
    if (lockResult.ok) {
      // 拿锁阶段（事务 1）：仅写锁表；runs 表不在此处更新
      await db.transaction(async (tx) => {
        await tx.insertMany('run_locks', lockResult.lockRows)
      })
      // claimed 阶段（事务 2）：UPDATE runs.status='claimed' + claimed_at（无 durable event）
      //   markClaimed 接受 prevState ∈ { queued, waiting }，因此从 waiting 醒来的 run 也走同一路径
      const claimed = await runLifecycleService.markClaimed(null, run.id)
      if (!claimed.ok) {
        await releaseLocks(run.id); continue
      }
      // starting 阶段（事务 3）：UPDATE runs.status='starting' + pid_at_start + INSERT events(agent.run.started) + outbox
      const transitioned = await runLifecycleService.markStarting(null, run.id, process.pid)
      if (transitioned.ok) {
        await adapterManager.startRun(run)         // 启动 adapter session
        // AdapterManager 创建 AdapterBridge，订阅 adapter Stream<AdapterEvent>，
        // 后续 markRunning / complete / fail / cancelFinalized 都由 AdapterBridge 调 RunLifecycleService
      } else {
        await releaseLocks(run.id)                  // 回收刚拿到的锁
      }
    } else {
      // 阻塞分支：调 RunLifecycleService.markWaiting，
      // 由 service 内部判定 (status, reason) 是否变化、变化才发 agent.run.waiting
      await runLifecycleService.markWaiting(null, run.id, lockResult.reason)
    }
  }
}
```

```sql
-- runs 表的 status / waiting_reason 字段（与 agents capability 的 Run 模型对齐；该 capability MUST 接收此扩展）
ALTER TABLE runs ADD COLUMN waiting_reason TEXT;       -- 例: 'agent_lock_held_by:run_42' / 'file_lock:auth.ts'

-- 锁表（lock_key 唯一即可保证同类型互斥；跨类型互斥靠申请阶段的 SELECT 检查 + IMMEDIATE 事务）
CREATE TABLE run_locks (
  lock_type      TEXT NOT NULL,           -- 'agent' | 'room' | 'file' | 'workspace'
  lock_key       TEXT NOT NULL,           -- agentId / roomId / file path / workspaceId
  workspace_id   TEXT,                    -- file / workspace 类型必填，agent / room 可空；用于 workspace ↔ file 跨类型互斥扫描
  run_id         TEXT NOT NULL,
  acquired_at    INTEGER NOT NULL,
  PRIMARY KEY (lock_type, lock_key)
);
CREATE INDEX idx_run_locks_runid ON run_locks (run_id);
CREATE INDEX idx_run_locks_workspace ON run_locks (workspace_id, lock_type);   -- 加速跨类型互斥扫描
```

**释放语义**：RunQueue Worker 订阅 `agent.run.completed` / `.failed` / `.cancelled` 事件，在事务内 `DELETE FROM run_locks WHERE run_id = ?` + 调用 `scheduleTick()`。

**崩溃恢复 startup hook（两阶段）**：

启动时 daemon **不**再一刀切把所有非终结 run 标 failed。改为以下两阶段流程，避免误杀可恢复 session 与可重新调度的 queued/waiting：

```text
Stage 1 — 锁清理（无副作用，全部清空）
  DELETE FROM run_locks                     # 锁是进程内调度状态，重启后必须重置

Stage 2 — 按 status 与 adapter_session_id 分类决策（每条独立事务）
  对每条 status NOT IN ('completed','failed','cancelled') 的 run：

    case status='queued' / 'waiting':
      # 没有外部副作用：保留状态，等待 RunQueue Worker 重新调度
      # 不调 fail，不发 agent.run.failed
      continue

    case status='claimed' AND claimed_at < now() - 30s:
      # worker 拿锁但 markStarting 之前崩溃；adapter 没启动，无外部副作用
      runLifecycleService.fail(null, runId, "claim_aborted", "transient")

    case status='starting' AND adapter_session_id IS NULL:
      # markStarting 已发 agent.run.started 但 adapter 没握手成功
      runLifecycleService.fail(null, runId, "daemon_restarted_before_session", "transient")

    case status IN ('starting','running','waiting_permission') AND adapter_session_id IS NOT NULL AND pid_at_start ≠ current pid:
      # 有外部 session：交给 ReclaimStaleClaimedRun 后台任务按 manifest.crashRecovery 决定 attach/restart/fail
      enqueueReclaim(runId)

    case status='cancelling':
      # 用户已显式 cancel；adapter 进程已死，直接 cancelFinalized
      runLifecycleService.cancelFinalized(null, runId)
```

`ReclaimStaleClaimedRun` 后续由 `bus-runtime/ReclaimStaleClaimedRun 后台任务` Requirement 详细规定 — attach 成功后的状态推进与当前 status 相关：`starting → markRunning`、`running / waiting_permission` 仅 `updateSessionState(pidAtStart)`；attach 失败 + `crashRecovery=resumable` → `fail("reclaim_attach_failed","fresh_session_required")`；`crashRecovery=restartable` → `fail("daemon_restarted","transient")`；`crashRecovery=fail_run` → `fail("daemon_restarted","retryable_visible")`。

**活锁防护**：

- 单 Run 等待锁默认超时 5 分钟，超时 → Worker 直接调 `runLifecycleService.fail(null, runId, "lock_timeout", "transient")`（`fail` 允许从 `waiting` 进入，详见上方状态机契约）；不再自动重试（避免反复失败造成的事件风暴）。
- 多文件锁按"按文件路径字典序排序"分阶段获取，避免循环依赖死锁；事务内一次性获取（要么全拿要么全释放），避免部分持有。

#### Scenario: 同 Agent 第二个 Run 排队

- **WHEN** Builder Agent 当前 run_A 跑了 30 秒，用户又发消息触发 run_B
- **THEN** run_B `agent.run.queued` 事件已写但 RunQueue 拿不到 Agent 锁 → 发 `agent.run.waiting { reason: "agent_lock_held_by", runId: run_A }`；run_A 完成（任意 terminal 状态）→ 锁释放 → run_B `agent.run.started`

#### Scenario: 文件锁字典序

- **WHEN** run_A 声明 `targetFiles = ["a.ts", "b.ts"]`，run_B 声明 `["b.ts", "a.ts"]`，并发到达
- **THEN** RunQueue 内部按字典序申请：run_A 申到 "a.ts" 后申 "b.ts"；run_B 必须等 a.ts 然后等 b.ts；不会出现 A 持 a.ts 等 b.ts、B 持 b.ts 等 a.ts 的死锁

#### Scenario: 锁超时降级

- **WHEN** run_B 等 5 分钟仍拿不到 a.ts 锁
- **THEN** Worker 调 `runLifecycleService.fail(null, run_B, "lock_timeout", "transient")`（fail 允许从 `waiting` 进入）；同事务发 `agent.run.failed { reason: "lock_timeout", waitedFor: "file:a.ts", failureClass: "transient" }`；run_B 不静默重试（避免反复失败），UI 提供"重试"按钮

#### Scenario: daemon 崩溃锁不残留

- **WHEN** daemon 崩溃时 run_locks 表有 3 条 `(agent, builder, run_42)` 等
- **THEN** 重启时 startup hook 两阶段：① `DELETE FROM run_locks` ② 按上文"崩溃恢复 startup hook（两阶段）" 分类决策；run_42 若 status=`running` + adapter_session_id 非空 → 进 Reclaim 队列（不直接 failed）；run_43 若 status=`queued` → 保留等待 RunQueue Worker 重新调度；新接 SSE 客户端不会被旧锁阻塞

#### Scenario: queued / waiting 不在重启时被一刀切 failed

- **WHEN** daemon 崩溃前 run_99 处于 `queued`，run_100 处于 `waiting{reason:"agent_lock_held_by:run_42"}`
- **THEN** 重启后 run_99 / run_100 status 保持原样；`DELETE FROM run_locks` 把 run_42 的锁清掉；RunQueue Worker scheduleTick 把 run_99 / run_100 重新拿出来调度（run_99 直接进 markClaimed → markStarting；run_100 因为锁已清空也走 markClaimed → markStarting）；不发 `agent.run.failed`

#### Scenario: claimed 中崩溃 Reclaim 走 transient

- **WHEN** run_50 status='claimed' claimed_at=now-2min adapter_session_id IS NULL（worker 拿锁但 markStarting 之前 daemon 崩溃）
- **THEN** Stage 2 case `claimed AND claimed_at < now-30s` 命中 → `runLifecycleService.fail(null, run_50, "claim_aborted", "transient")`；同事务发 `agent.run.failed`；UI 在 Run Detail 显示 "daemon 重启时已中断 — 可重试"

#### Scenario: starting 中崩溃但握手前

- **WHEN** run_60 status='starting' adapter_session_id IS NULL（markStarting 已 commit 发了 `agent.run.started`，但 adapter 还没回 session.opened 时 daemon 崩溃）
- **THEN** Stage 2 case `starting AND adapter_session_id IS NULL` → `fail(null, run_60, "daemon_restarted_before_session", "transient")`

#### Scenario: 锁与 markStarting 之间崩溃（两事务窗口）

> **背景**：RunQueue Worker 拿锁是事务 1（`INSERT run_locks`），状态推进是事务 2（`RunLifecycleService.markStarting`）。POSIX SQLite 没有跨事务的两阶段提交，所以中间存在崩溃窗口：事务 1 commit 之后、事务 2 begin 之前 daemon 挂掉，会留下 `run_locks` 行但 `runs.status` 仍是 `queued` / `waiting`。

- **WHEN** RunQueue Worker 在事务 1 提交 `(file, auth.ts) = run_99` 锁后、调用 `RunLifecycleService.markClaimed/markStarting(run_99)` 之前 daemon 崩溃
- **THEN** 重启 startup hook 两阶段：① Stage 1 `DELETE FROM run_locks` 清理所有残留锁；② Stage 2 看 run_99 — 此时 run_99 仍是 `queued`（markClaimed 还没 commit），属于 `case status='queued'` → 不动 status / 不发 `agent.run.failed`；RunQueue Worker scheduleTick 重新调度 run_99 → markClaimed → markStarting；不会有"锁悬挂导致后续 run 永远 waiting"或"queued run 被错杀"的死状态

#### Scenario: markStarting 状态机校验失败时锁回收

- **WHEN** RunQueue Worker 拿到锁后，run_99 因为另一条 `CancelRun` 命令已经被推进到 `cancelling`，`markStarting` 抛 `IllegalTransition`
- **THEN** Worker 立即 `DELETE FROM run_locks WHERE run_id = 'run_99'` 释放刚拿到的锁；不发 `agent.run.started`；不调 `AdapterManager.startRun`；触发 `scheduleTick()` 唤醒后续等待 run

#### Scenario: 队列状态来自 runs 表非 events

- **WHEN** RunQueue Worker 收到 `agent.run.queued` 事件，但实际数据库中 `runs.status` 已经被另一个事务推进到 'starting'（极少数竞态）
- **THEN** Worker 重新读 `runs` 表确认 status，发现非 queued/waiting → 跳过本次调度；不会重复调度同一 run

#### Scenario: waiting 事件去重避免刷屏

- **WHEN** run_B 在 `waiting reason='agent_lock_held_by:run_A'` 状态停留 30 秒，期间 RunQueue Worker 因别的事件被唤醒 5 次重新检查
- **THEN** 由于 run_B 的 status='waiting' 且 waiting_reason 未变，Worker 不重复发 `agent.run.waiting`；只在 reason 变化（如锁切换为 file:a.ts）或首次进入 waiting 时发

### Requirement: SSE 反压（buffer 上限 + 慢消费者策略）

The system SHALL bound per-SSE-client memory by limiting the in-flight buffer; when a client cannot keep up, the system SHALL drop ephemeral events first and disconnect the client only when durable events are at risk.

**默认参数**（可配置）：

```ts
type SSEBackpressurePolicy = {
  maxQueuedDurable: number          // 默认 1000；超出 → 断开客户端，让其重连走 catch-up
  maxQueuedEphemeral: number        // 默认 500；超出 → 丢弃最老 ephemeral（FIFO drop）
  slowClientThresholdMs: number     // 默认 30_000；连续 30s 未消费即视为慢
  durableSendTimeoutMs: number      // 默认 5_000；写 SSE 帧超时即断
}
```

**算法**（per client）：

```text
publish 入队
  if (event.durability === "ephemeral") {
    if (queue.ephemeralCount >= maxQueuedEphemeral) {
      drop oldest ephemeral
      emit ui.ephemeral_dropped count=N (debug)
    }
  } else {  // durable
    if (queue.durableCount >= maxQueuedDurable) {
      disconnect client with reason "client_too_slow_durable"
      // 客户端会自然重连，触发 events 表 catch-up（不丢事件）
    }
  }
write loop
  for each frame {
    write within durableSendTimeoutMs else disconnect "send_timeout"
    if last consumer ack > slowClientThresholdMs ago → disconnect "slow_consumer"
  }
```

#### Scenario: 慢消费者丢 ephemeral

- **WHEN** 客户端 1 秒内只能消费 50 条事件，daemon 1 秒推 200 条 ephemeral
- **THEN** 该客户端 `maxQueuedEphemeral=500` 满后开始 FIFO drop；durable 通道不受影响；UI 不出现卡顿（看到的是 "丢了 N 条 token delta"——视觉上仍合并）

#### Scenario: 慢消费者断开后 catch-up

- **WHEN** durable 队列累积到 1000 仍未消费
- **THEN** 服务端断开该 SSE 连接 reason=`client_too_slow_durable`；客户端用最后保存的 `Last-Event-ID` 重连 → 走 events 表回放 → 不丢任何 durable event

#### Scenario: 单客户端崩溃不影响别人

- **WHEN** 一个 SSE 客户端 freeze，其它客户端正常消费
- **THEN** 服务端 per-client 队列独立；该 freeze 客户端被超时断开；其它客户端无感知

### Requirement: Debug 流隔离

The system SHALL expose Debug Panel's full-event subscription on a separate logical stream that does NOT compete with the main `/event` channel for backpressure decisions.

**实现**：

- 主 `/event` 流：默认所有 SSE 客户端连接的 endpoint，按 `RoomViewModel` 需要 + 全局事件做投递。
- 调试 `/debug/event` 流：仅 dev mode 或 `auth.token + debug.enabled=true` 启用；订阅全部 durable + ephemeral；独立 buffer / 独立反压参数（默认 `maxQueuedDurable=10000`、`maxQueuedEphemeral=5000`）。
- 主流的反压策略不参考 Debug 流的拥塞情况（解耦）。

#### Scenario: Debug 客户端拥塞不影响主流

- **WHEN** 开发者打开 Debug Panel 订阅全量事件，但其本机处理慢
- **THEN** Debug 流自身按反压参数独立断开 / 丢弃；同时连接的 Web UI 主流不受影响，正常推送 durable 事件

#### Scenario: Debug 流默认关闭

- **WHEN** 生产模式启动且未开 `debug.enabled`
- **THEN** `GET /debug/event` 返回 404；只有 `/event` 可用

### Requirement: 模块订阅图谱（单一真相）

The system SHALL document a single canonical "publisher / subscriber" matrix below; module implementations MUST match this matrix and MUST NOT communicate via direct method calls except for read-only queries listed in the "Allowed sync queries" table.

**发布矩阵（哪些模块发哪些事件）**：

| 模块 | 发布事件 |
|---|---|
| HTTP Command Layer | （不直接发 event；只 dispatch Command） |
| RoomService | `room.created` / `room.opened` / `room.closed` |
| MessageService | `message.created` / `message.completed` / `message.cancelled` / `message.deleted` / `message.updated` / `message.brief.published` / `pending_turn.created` / `pending_turn.cancelled` / `pending_turn.scheduled` / `pending_turn.consumed` / `message.part.delta`（ephemeral） |
| Orchestrator | `agent.state.changed`（仅 presence 状态机驱动）；**不发任何 `agent.run.*`**，统一通过 dispatch `WakeAgent` Command（origin='internal'）触发模型调用；运行状态推进由 RunLifecycleService 完成。**MVP 没有 StartRun Command** |
| WakeAgent handler | （不直接 publish 事件；通过 `RunLifecycleService.create` 间接产生 `agent.run.queued`） |
| RunService（`CancelRun` Command handler） | （不直接 publish 事件；通过 `RunLifecycleService.markCancelling` 间接 UPDATE runs；adapter session 实际结束后 AdapterBridge 调 `cancelFinalized` 发 `agent.run.cancelled`） |
| RunLifecycleService | `agent.run.queued` / `agent.run.waiting` / `agent.run.started` / `agent.run.waiting_permission` / `agent.run.resumed` / `agent.run.completed` / `agent.run.failed` / `agent.run.cancelled`（**所有 `agent.run.*` durable 事件的唯一发布者**；其它模块只能调它的方法） |
| RunQueue Worker | （不直接 publish 任何 `agent.run.*`；通过调 `RunLifecycleService.markClaimed / markStarting / markWaiting` 间接发出） |
| AdapterBridge | `tool.call.requested` / `tool.call.completed` / `tool.update.diverted`（ephemeral） / `subagent.started` / `subagent.completed` / `file.changed` / `context.snapshot`（这些非 run 状态事件由 AdapterBridge 自身在事务内 publish；`agent.run.completed/failed/cancelled` 必须经 `RunLifecycleService`） |
| AdapterManager | `adapter.registered` / `adapter.session.created` / `.session.ended` / `.session.disposed` / `.crashed` / `adapter.liveness.changed` / `adapter.config.updated` / `adapter.raw.stdout`（ephemeral） / `adapter.raw.stderr`（ephemeral） |
| Adapter（per instance） | **不发 durable domain event**；只通过 `Stream<AdapterEvent>` 输出，由 AdapterBridge 翻译并发布。AdapterEvent 是 adapter-framework 的内部协议，不进 events 表 |
| ContextLedger | `context.item.created` / `.proposed` / `.confirmed` / `.update_requested` / `.conflict_created` / `.deprecated` / `context.item.visibility.changed` |
| PermissionEngine | `permission.requested` / `permission.resolved` |
| InterventionEngine | `intervention.requested` / `.approved` / `.ignored` / `.rejected` / `.snoozed` / `.injected` / `.resolved` / `.closed` / `intervention.invalid_transition` |
| ArtifactManager | `artifact.diff.created` / `artifact.file.created` / `artifact.reviewing` / `artifact.accepted` / `artifact.applying` / `artifact.applied` / `artifact.rejected` / `artifact.failed` / `artifact.preview.started` / `.stopped` |
| LocalDaemon GC | `worktree.gc.removed` / `worktree.gc.skipped` |
| MailboxService | `mailbox.message.created` |
| AgentService | `agent.profile.loaded` / `agent.profile.updated` / `agent.joined` / `agent.left` / `agent.blocked` / `agent.capabilities.updated` |
| AuthService | `auth.token.issued` / `auth.token.revoked` |
| BusRuntime | `handler.stalled` |
| SystemHealth | `server.connected` / `server.shutting_down` / `run.heartbeat`（ephemeral） / `agent.typing`（ephemeral） / `agent.status_line.updated`（ephemeral） |

**订阅矩阵（哪些模块订哪些事件）**：

| 模块 | 订阅事件 | 反应 |
|---|---|---|
| Orchestrator | `message.created` (role=user, turn_dispatch_mode='immediate') | 解析 mention / 决定调度 → dispatch `WakeAgent` Command（origin='internal'）；turn_dispatch_mode='pending' 的 message.created 不触发 wake |
| Orchestrator | `agent.run.completed` / `.failed` / `.cancelled` | 三步顺序处理（**next_turn 优先于 pending_turn**）：① 更新 presence、决定是否回到 observing → emit `agent.state.changed`；② 查 `run_next_turns WHERE run_id=:runId AND consumed_at IS NULL`；命中 → 派发 `WakeAgent({ ..., carryNextTurnIds: <ids>, sourceRunId: <runId>, reason: <next_turn.source_reason>, idempotencyKey: hash(runId + nt_ids) })`（**`sourceRunId` 必须填**，rebind SQL 依赖它做防御约束，详见 `orchestrator/run_next_turns 表`）；③ 否则若该 (room, primary) 还有 PendingTurn 'queued' → 派发 `ConsumePendingTurn`（内部转 dispatch WakeAgent reason='consume_pending_turn'）；④ 否则不再 wake。**优先级理由**：next_turn 是用户 / rule 在当前 run 期间追加给同一上下文的输入（"继续当前任务"），pending_turn 是新一轮 user message（"开始下一任务"）；先消费上下文延续，再开新一轮 |
| Orchestrator | `intervention.approved` | dispatch `InjectContext` 内部 Command（具体在 interventions capability）；**不直接调 adapter** |
| RunService | `CancelRun` Command | 调 `RunLifecycleService.markCancelling(null, runId)`（同步 UPDATE runs.status='cancelling'）；`markCancelling` 成功后**直接同步**调 `AdapterManager.cancelRun(runId)`（不等待 event 回环）；adapter session 实际结束后 AdapterBridge 调 `RunLifecycleService.cancelFinalized(null, runId)` 发 `agent.run.cancelled` |
| RunQueue Worker | `agent.run.queued` | 申请锁；获得 → 调 `RunLifecycleService.markClaimed(null, runId)` → `markStarting(null, runId, pid)` 发 `agent.run.started`；阻塞 → 调 `RunLifecycleService.markWaiting(null, runId, reason)` |
| RunQueue Worker | `agent.run.completed` / `.failed` / `.cancelled` | 释放锁，唤醒等待队列 |
| AdapterBridge | Adapter 内部 `Stream<AdapterEvent>` | 直接发布非 run 类 durable event（`tool.call.*` / `subagent.*` / `file.changed` / `context.snapshot`）；run 终结类（completed / failed / cancelFinalized）必须通过 `RunLifecycleService` 而非 `eventBus.publish`；**不订阅 `agent.run.cancelled`**，cancel 触发由 CancelRun handler 同步驱动 |
| AdapterManager | `intervention.approved` | 通过 AdapterBridge 调 `adapter.injectContext()`（按 manifest 决定时机） |
| ContextLedger | `context.snapshot` | 写 ContextItem `type=summary` draft |
| ContextLedger | `context.item.update_requested` | 校验版本，成功转 confirmed / 失败转 conflict |
| ArtifactManager | `tool.call.completed` | 若 output 含 file diff → 发 `artifact.diff.created` |
| ArtifactManager | `file.changed` | 同上（claude-code 路径） |
| MessageService | `tool.call.requested` / `tool.call.completed` | 把 tool 部分追加到对应 message |
| MessageService | `intervention.requested` / `permission.requested` / `artifact.diff.created` | 把对应 Card 追加到 message |
| MessageService | `agent.run.completed` / `.failed` / `.cancelled` | 生成 brief summary + emit `message.brief.published` |
| PermissionEngine | `agent.run.cancelled` | resolve 该 run 所有 pending PermissionRequest 为 expired |
| InterventionEngine | `agent.run.completed` / `.failed` / `.cancelled` | resolve / close 该 run 相关 intervention |
| ProjectorService（前端） | 全部 durable + 关心的 ephemeral（按 SSE view= 子集） | 更新 RoomViewModel |
| Debug Panel | 全部（durable + ephemeral） | 直接渲染（`/debug/event` 流） |
| AuditService | 全部 durable | 写日志 / 长期归档（V1） |

**Allowed sync queries**（同步函数调用允许，不走 bus）：

| 调用方 | 被调用方 | 调用 | 理由 |
|---|---|---|---|
| Command handler | RoomService | `getRoomById` | 校验 |
| Command handler | AgentService | `getAgentProfile` | 校验 |
| Command handler | PermissionEngine | `evaluate(resource)` | 同步决策（ask 时返回 Deferred 异步等待） |
| Command handler | RunLifecycleService | `create / markCancelling / ...` | runs 表唯一写入口；同步事务 |
| WakeAgent handler | MailboxService | `claimUnread(roomId, agentId, runId)` | IMMEDIATE 事务内原子认领 mailbox |
| WakeAgent handler | RunLifecycleService | `create(input)` | 同事务创建 Run + 发 `agent.run.queued` |
| `CancelRun` handler | AdapterManager | `cancelRun(runId)` | `markCancelling` 成功后直接驱动 adapter；不订阅 `agent.run.cancelled` 触发，避免回环 |
| RunQueue Worker | RunLifecycleService | `markWaiting / markClaimed / markStarting` | 状态推进；同步事务 |
| RunQueue Worker | AdapterManager | `startRun(run)` | 拿锁后直接驱动 adapter 启动 |
| AdapterBridge | RunLifecycleService | `markRunning / updateSessionState / complete / fail / cancelFinalized` | run 状态推进；同步事务 |
| Context Assembly | ContextLedger | `query(filter)` | 读取，无副作用 |
| 任意 module | EventStore | `replaySince(seq, type?)` | 启动 catch-up |

**禁止的直接调用**：

- ❌ HTTP handler 直接调 `eventBus.publish()`（必须经 CommandBus）
- ❌ Adapter 直接调 ContextLedger / PermissionEngine（必须经 event）
- ❌ Module A 直接 `import` Module B 的 mutator（必须经 Command 或 event）

#### Scenario: 新增模块必须更新订阅图

- **WHEN** 开发者新加一个 `MetricsCollector` 模块订阅 `agent.run.completed`
- **THEN** PR 必须修改本 spec 的订阅矩阵 + 在 `bus-runtime/订阅图谱` 加一行；CI 校验 `packages/*/subscribes.ts` 的声明与本 spec 一致

#### Scenario: 禁止跨模块直接 mutator

- **WHEN** Adapter 代码尝试 `import { contextLedger } from '@agenthub/context'` 然后 `contextLedger.write(...)`
- **THEN** ESLint 自定义规则 `no-cross-module-mutator` 报错，建议改用 `MCP tool: room.propose_context` 或派 `context.snapshot` event

#### Scenario: 订阅图与代码偏离时 CI 失败

- **WHEN** Orchestrator 实际不订阅 `intervention.approved` 但 spec 矩阵声明了
- **THEN** `bun run subscriptions:check` 比对模块声明 vs spec 矩阵 → 报错 `subscription mismatch: orchestrator declares but spec lists`，CI 失败

### Requirement: Bus 启动 / 关闭顺序

The system SHALL initialize bus components in the following order on startup, and reverse on shutdown.

**启动顺序**：

```text
1. SQLite open + pragma + migrate
2. EventStore (read-only readiness check)
3. EventBus (PubSub + per-type)
4. Outbox Dispatcher start (drain pending → 注意 5 之前不允许 publish 走过它)
5. Durable Handler Registry：
   5.1 register all handlers
   5.2 catch-up: 每个 handler 从 last_seq 追到当前 max(seq)
   5.3 进入实时模式
6. RunQueue Worker start
7. AdapterManager detect + register
8. CommandBus open（接受外部 Command）
9. HTTP server bind + SSE 接受连接
```

**关闭顺序**：

```text
1. HTTP server stop accept new connections
2. CommandBus refuse new commands（in-flight 等完成）
3. RunQueue Worker stop scheduling new runs
4. AdapterManager cancel all in-flight runs (with grace period)
5. Outbox Dispatcher drain
6. Durable Handler Registry stop（保存 last_seq）
7. EventBus close
8. EventStore close
9. SQLite close
```

#### Scenario: 启动时未追平不接受 Command

- **WHEN** daemon 启动，Orchestrator handler 还在 catch-up（last_seq 92，max_seq 120）
- **THEN** HTTP `POST /rooms/:id/messages` 返回 503 + `{ error: "service_starting", retryAfterMs: 500 }`；客户端等待并重试

#### Scenario: 关闭时 in-flight 命令完成

- **WHEN** SIGINT 时正有一个 `ApplyDiff` Command 在事务中
- **THEN** CommandBus 等该 Command 提交完成（最多 30 秒）→ 触发后续关闭顺序；不丢事件

### Requirement: 内部 PubSub Bounded + 优先级丢弃

The system SHALL use a **bounded** internal PubSub for ephemeral channels (typed message.delta / tool.update / adapter.raw / status_line / etc.) and SHALL apply explicit per-channel queue capacity + drop policy. Durable events MUST NOT be dropped under any pressure. Debug / raw streams MUST run on a dedicated bounded channel with its own (smaller) cap, isolated from main ephemeral traffic.

> **Why**：opencode 的 effect bus 用 `PubSub.unbounded` 在单进程小型场景可接受，但在 AgentHub 多 Run、多 adapter raw stream、多 SSE 客户端并发下，内存压力会顺着任意一条慢消费者堆积；当前 SSE 反压只解决"客户端慢"问题，未约束"内部生产侧爆量"问题。

**通道矩阵**：

| 通道 | 类型 | 容量（默认） | 满时策略 | 说明 |
|---|---|---|---|---|
| `durable.events` | durable | 4096 | **back-pressure**（生产者阻塞） | 永不丢；满则上游写入等待，触发 `handler.stalled` 警告 |
| `ephemeral.message.delta` | ephemeral | 1024 / room | drop_oldest + coalesce | 同 `(messageId, seq)` 合并；超出按 LRU 丢最旧未发送 |
| `ephemeral.tool.update` | ephemeral | 512 / session | drop_oldest | 单 session tool update 超容量丢最旧 |
| `ephemeral.status_line` | ephemeral | 64 / agent | drop_lowest_priority + coalesce | 已有 30s 节流，只是兜底 |
| `ephemeral.adapter.raw` | ephemeral (debug) | 256 / session | drop_oldest（不阻塞 stdout 读取） | 见下"raw 通道隔离" |
| `ephemeral.system.notice` | ephemeral | 128 / global | drop_oldest | 系统级提示 |

**关键约束**：

1. Durable 通道是**唯一不丢**的通道；其它所有 ephemeral 通道在容量满时按各自 drop 策略丢弃，但 MUST emit 一条聚合 `handler.stalled` 控制事件让用户感知（每 1000 次 drop 至多 1 条，避免再雪崩）。
2. `ephemeral.adapter.raw` 必须是**独立通道**，不与 `ephemeral.message.delta` / `ephemeral.tool.update` 共享 buffer；目的是 raw stream 暴涨（loop-print）不能挤掉用户可见的 message delta。
3. **每个 SSE 客户端**仍有自己的 backpressure 队列（详见现有"SSE 反压" Requirement），与内部 PubSub 容量解耦；两层独立。
4. 容量阈值 MUST 可配（`config.toml` `[bus.pubsub] capacity.<channel>`）但 daemon 启动时校验：durable 至少 1024，ephemeral 至少 64，否则 refuse start。
5. drop 计数 MUST 通过 `/debug/stats` 暴露（per-channel drop count），便于诊断。

```ts
type PubSubChannelStats = {
  channel: string
  capacity: number
  current: number
  highWatermark: number       // 历史峰值
  dropCount: number
  lastDropAt?: number
  policy: "back_pressure" | "drop_oldest" | "drop_oldest_coalesce" | "drop_lowest_priority"
}
```

#### Scenario: ephemeral 通道满后丢最旧

- **WHEN** 某 Run 短时间内产生 2000 条 message.part.delta，超出 1024 容量
- **THEN** 按 `(messageId, seq)` coalesce + drop_oldest；最终 SSE 客户端看到的最终文本仍正确（合流后 cursor 末尾态保留）；emit 一条 `handler.stalled { handler: "pubsub:message.delta", droppedCount: <N> }`

#### Scenario: durable 通道不丢

- **WHEN** 同时高频写 `agent.run.queued`，durable 通道接近满
- **THEN** 上游 publish 进入 back-pressure 等待（毫秒级）；其它生产者亦排队；MUST NOT 丢任何 durable event；满载持续 5s 触发 `handler.stalled { handler: "pubsub:durable", reason: "high_pressure" }`

#### Scenario: raw 通道暴涨不影响 main delta

- **WHEN** 一个 adapter 子进程无限 loop print 到 stderr，raw 通道满
- **THEN** raw 通道按 drop_oldest 丢；message.delta / tool.update 通道完全不受影响；用户主流体验不卡

#### Scenario: drop 统计可见

- **WHEN** `GET /debug/stats`
- **THEN** 返回 PubSubChannelStats 数组；含每个通道当前积压、历史峰值、drop 数；UI Debug Panel 渲染仪表

### Requirement: ReclaimStaleClaimedRun 后台任务

The system SHALL run a periodic `ReclaimStaleClaimedRun` background task that detects and resolves runs stuck in mid-flight states after daemon crashes or worker pid changes. This complements the `agents/Run 状态机扩展` requirement and the `bus-runtime/RunQueue 是 bus 的一条命名队列` requirement.

**触发与扫描规则**：

- 周期：daemon 启动时立即扫一次（startup pass）+ 每 60s 增量扫一次。
- 扫描候选（覆盖三类崩溃窗口；每类独立扫描）：
  1. `runs.status='claimed' AND claimed_at < now - 30s`（worker 拿锁但 markStarting 之前崩溃；adapter 还没启动 → 走 fail("claim_aborted","transient")）
  2. `runs.status='starting' AND started_at < now - 60s AND adapter_session_id IS NULL`（markStarting 已 commit 但 adapter 没回 session.opened；adapter 进程已死 → 走 fail("daemon_restarted_before_session","transient")）
  3. `runs.status IN ('starting','running','waiting_permission') AND adapter_session_id IS NOT NULL AND pid_at_start != current pid`（崩溃前 session 已建立并持久化；按 manifest.crashRecovery 决定 attach / restart / fail；**注意 `starting + adapter_session_id IS NOT NULL` 也在此分支**——daemon 在 AdapterBridge 已写 sessionId、调 markRunning 之前崩溃也属于这种情况，attach 成功后走 `starting → markRunning`）

**Reclaim 决策**：

按 adapter manifest 的 `reliability.crashRecovery` + run 当前 status 共同决定：

| crashRecovery | run.status（已通过扫描候选过滤） | attach 成功后行为 | attach 失败后行为 |
|---|---|---|---|
| `resumable` | `starting` (有 adapterSessionId) | `markRunning(tx, runId, adapterSessionId)` + `updateSessionState(tx, runId, { pidAtStart })`（Run 真正进入 running 状态） | `fail(tx, runId, "reclaim_attach_failed", "fresh_session_required")` |
| `resumable` | `running` | **仅** `updateSessionState(tx, runId, { pidAtStart })`；**不**调 markRunning（已经是 running，markRunning 会 IllegalTransition） | `fail(tx, runId, "reclaim_attach_failed", "fresh_session_required")` |
| `resumable` | `waiting_permission` | **仅** `updateSessionState(tx, runId, { pidAtStart })`；**不**调 markRunning（保持 waiting_permission，避免错误跳过审批等待） | `fail(tx, runId, "reclaim_attach_failed", "fresh_session_required")` |
| `restartable` | 任意 | — | `fail(tx, runId, "daemon_restarted", "transient")`；新 wake 由用户 / orchestrator 决定 |
| `fail_run` | 任意 | — | `fail(tx, runId, "daemon_restarted", "retryable_visible")`；UI 提示用户重试 |

> **关键约束**：`markRunning` 状态机仅允许 `starting → running` 与 `waiting_permission → running`（详见 RunLifecycleService 状态机契约）。Reclaim 不能对已经 `running` 或 `waiting_permission` 的 run 调 `markRunning`，否则触发 `IllegalTransition` 事务回滚 + 失败 fallback。Reclaim 对这两个状态只更新 session 元数据（`updateSessionState` 不发 durable event，不影响状态机），让 adapter 重新驱动后续状态推进。

`runs` 表追加 `pid_at_start INTEGER`：

```sql
ALTER TABLE runs ADD COLUMN pid_at_start INTEGER;
```

RunLifecycleService.markStarting MUST 写入当前 `process.pid` 到 pid_at_start。

#### Scenario: 启动时扫到 stuck claimed run

- **WHEN** daemon 重启，扫到 run_42 status='claimed' claimed_at=now-2min adapter_session_id=null
- **THEN** ReclaimStaleClaimedRun 调 RunLifecycleService.fail(null, run_42, "claim_aborted", "transient")；run_locks 在 `agent.run.failed` 释放；UI Run Detail 显示"daemon 重启时已中断，可重试"

#### Scenario: resumable adapter 重连

- **WHEN** ClaudeCodeAdapter manifest crashRecovery=resumable，daemon 重启扫到 run_50 running adapter_session_id=s_50 pid_at_start≠now
- **THEN** Reclaim 调 ClaudeCodeAdapter.attachSession(s_50)；成功 → 把 run_50.pid_at_start 更新为新 pid，状态保持 running；用户看不见任何中断

#### Scenario: attachSession 失败 fail-fresh

- **WHEN** attachSession 返回 `AdapterError(code="session_not_found")`
- **THEN** Reclaim 调 fail(run_50, "reclaim_attach_failed", "fresh_session_required")；UI 提示 session 已失效，重试将开新 session

#### Scenario: starting 阶段已写 sessionId 时崩溃 → Reclaim 走 markRunning

- **WHEN** AdapterBridge 已经在 session.opened 时调 `updateSessionState(tx, run_60, { adapterSessionId: "s_60" })`，但调 `markRunning(tx, run_60, "s_60")` 之前 daemon 崩溃；run_60 此时 status='starting'、adapter_session_id='s_60'、pid_at_start 是旧 pid
- **THEN** 周期 Reclaim 扫描候选 3 命中（`status IN ('starting','running','waiting_permission') AND adapter_session_id IS NOT NULL AND pid_at_start != current pid`）；按 crashRecovery=resumable + status='starting' 决策 → `attachSession("s_60")` 成功 → `markRunning(null, run_60, "s_60") + updateSessionState(null, run_60, { pidAtStart: currentPid })`；Run 进入 running，无重复 session、无 IllegalTransition

### Requirement: RunLifecycleService.updateSessionState（非事件方法）

The system SHALL extend `RunLifecycleService` with a non-event-emitting `updateSessionState(tx, runId, patch)` method per `agents/SessionId / WorkDir 中途持久化`. This is the **canonical** definition; agents capability references it.

```ts
interface RunLifecycleService {
  // ... methods from earlier requirements ...

  /**
   * 持久化 mid-flight session 元数据。
   * 不发 durable event（高频小变更，且不属于 user-actionable 状态变更）。
   * 仅 UPDATE runs；首参 tx 与其它 mutation 方法一致：传入参与外层事务，传 null 则 service 自开 IMMEDIATE 事务。
   */
  updateSessionState(
    tx: SqliteTx | null,
    runId: string,
    patch: Partial<{
      adapterSessionId: string
      workDir: string
      providerConversationId: string
      pidAtStart: number
    }>
  ): Effect.Effect<void, RunLifecycleError>
}
```

**调用边界**：

- AdapterBridge MUST 在收到 `session.opened` 时调一次（写 adapterSessionId + workDir）；典型调用 `updateSessionState(null, runId, { adapterSessionId, workDir })`。
- AdapterBridge MUST 在收到 provider 的 conversation id 变化（如 Codex / OpenCode 的 server-assigned id）时调用。
- RunQueue Worker / `markStarting` 路径 MUST 在写 `status='starting'` 的同一事务内通过 `updateSessionState(tx, runId, { pidAtStart })` 写入 pid。
- 其它路径 MUST NOT 调（避免误改）。

#### Scenario: session.opened 后能查到 sessionId

- **WHEN** AdapterBridge 收到 session.opened sessionId="s_42"，立即调 updateSessionState(null, run_42, { adapterSessionId: "s_42", workDir: "/tmp/wt_42" })
- **THEN** UPDATE runs SET adapter_session_id='s_42', work_dir='/tmp/wt_42'；不写 events / outbox；后续 GET /runs/run_42 返回最新值

#### Scenario: updateSessionState 不发 durable event

- **WHEN** updateSessionState 被调用
- **THEN** events 表不增行；订阅 `agent.run.*` 的 handler 不触发；保持 mid-flight metadata 与终结类 event 在事件流上的清晰分离


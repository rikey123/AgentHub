# event-system Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: 事件 Envelope 强制版本化

The system SHALL wrap every event in a typed Envelope that includes `id`, `type`, `schemaVersion`, `durability`, `traceId`, `causationId`, `correlationId`, `payload`, `createdAt`, and the relevant scope ids (`workspaceId`, `roomId?`, `taskId?`, `runId?`, `agentId?`). Durable events SHALL additionally carry a numeric `seq` assigned at persistence time; ephemeral events SHALL NOT carry `seq`.

```ts
type EventEnvelope<TPayload> = {
  id: string                    // ULID
  type: string                  // 事件类型
  schemaVersion: number         // 必须 ≥ 1
  durability: "durable" | "ephemeral"
  visibility: EventVisibility   // 详见下文 "事件 visibility" Requirement
  seq?: number                  // 仅 durable，由 daemon 写表事务分配，全局单调递增
  workspaceId: string
  roomId?: string
  taskId?: string
  runId?: string
  agentId?: string
  traceId?: string
  causationId?: string
  correlationId?: string
  payload: TPayload
  createdAt: number             // epoch ms
}

type EventVisibility = "main" | "detail" | "both"
```

#### Scenario: 缺少 schemaVersion 拒绝发布

- **WHEN** 任意 producer 发出一个不带 `schemaVersion` 字段的事件
- **THEN** EventBus 抛 `InvalidEventEnvelope` 错误，事件不进入 PubSub 也不写 events 表

#### Scenario: 旧版本事件读取时升级

- **WHEN** events 表中存在 `message.created` `schemaVersion=1` 的旧事件，当前代码已升级到 v2
- **THEN** Event Store 在读出时通过 `EventMigrator.migrate(event)` 升级到 v2 后再交付订阅者

#### Scenario: ephemeral 事件不分配 seq

- **WHEN** producer 发出一个 ephemeral 事件
- **THEN** 派发出去的 envelope `durability="ephemeral"` 且 `seq` 字段缺失；订阅者在使用 seq 前必须先判断 durability

### Requirement: 事件分级（durable / ephemeral）

The system SHALL classify every event as either `durable`（落 events 表，永不丢）or `ephemeral`（不落库，可丢可合并），and apply the canonical mapping below.

| 事件 | 类型 | durability | visibility |
|---|---|---|---|
| `message.created` | room/message | durable | both |
| `message.part.delta` | room/message | ephemeral | detail |
| `message.completed` | room/message | durable | both |
| `message.cancelled` | room/message | durable | both |
| `message.deleted` | room/message | durable | both |
| `message.updated` | room/message | durable | both |
| `message.brief.published` | room/message | durable | main |
| `pending_turn.created` | room/message | durable | main |
| `pending_turn.cancelled` | room/message | durable | main |
| `pending_turn.scheduled` | room/message | durable | main |
| `pending_turn.consumed` | room/message | durable | main |
| `room.created` / `room.opened` / `room.closed` | room | durable | both |
| `agent.profile.loaded` / `agent.profile.updated` | agent | durable | detail |
| `agent.joined` / `agent.left` | agent | durable | both |
| `agent.state.changed` | agent | durable | both |
| `agent.blocked` | agent | durable | both |
| `agent.capabilities.updated` | agent | durable | detail |
| `agent.token.delta` | agent | ephemeral | detail |
| `agent.typing` | agent | ephemeral | detail |
| `agent.status_line.updated` | agent | ephemeral | main |
| `agent.run.queued` / `agent.run.waiting` / `agent.run.started` / `agent.run.completed` / `agent.run.failed` / `agent.run.cancelled` | run | durable | both |
| `agent.run.waiting_permission` | run | durable | both |
| `agent.run.resumed` | run | durable | detail |
| `run.heartbeat` | run | ephemeral | detail |
| `tool.call.requested` / `tool.call.completed` | run | durable | detail |
| `tool.update.diverted` | run | ephemeral | detail |
| `tool.output.delta` | run | ephemeral | detail |
| `subagent.started` / `subagent.completed` | run | durable | detail |
| `role.created` / `role.updated` / `role.deleted` | role | durable | detail |
| `runtime.detected` / `runtime.updated` / `runtime.removed` | runtime | durable | detail |
| `model_config.created` / `model_config.updated` / `model_config.deleted` | model | durable | detail |
| `agent_binding.created` / `agent_binding.updated` / `agent_binding.removed` | binding | durable | detail |
| `task.created` / `task.assigned` / `task.status.changed` | task | durable | both |
| `task.activity.added` / `task.delegation.created` / `task.delegation.completed` | task | durable | both |
| `task.status.changed.rejected` | task | ephemeral | detail |
| `team.dispatch.started` / `team.dispatch.completed` | team | durable | both |
| `permission.run_summary` | permission | durable | detail |
| `context.item.created` / `.proposed` / `.confirmed` / `.update_requested` / `.conflict_created` / `.deprecated` / `.visibility.changed` | context | durable | detail |
| `context.snapshot` | context | durable | detail |
| `permission.requested` / `permission.resolved` | permission | durable | both |
| `intervention.requested` / `.approved` / `.ignored` / `.rejected` / `.snoozed` / `.injected` / `.resolved` / `.closed` | intervention | durable | both |
| `intervention.invalid_transition` | intervention | durable | detail |
| `artifact.diff.created` / `artifact.file.created` / `artifact.reviewing` / `artifact.accepted` / `artifact.applying` / `artifact.applied` / `artifact.rejected` / `artifact.failed` | artifact | durable | both |
| `artifact.preview.started` / `.stopped` | artifact | durable | both |
| `adapter.registered` / `adapter.session.created` / `.session.ended` / `.session.disposed` / `.crashed` | adapter | durable | detail |
| `adapter.liveness.changed` | adapter | durable | detail |
| `adapter.config.updated` | adapter | durable | both |
| `adapter.raw.stdout` / `adapter.raw.stderr` | adapter | ephemeral | detail |
| `mailbox.message.created` | mailbox | durable | detail |
| `worktree.gc.removed` / `worktree.gc.skipped` | local-daemon | durable | detail |
| `auth.token.issued` / `auth.token.revoked` | auth | durable | detail |
| `handler.stalled` | bus | durable | detail |
| `server.connected` / `server.shutting_down` | server | durable | detail |
| `ui.toast.shown` / `ui.presence.changed` / `stream.chunk` | ui/transient | ephemeral | main |
| `mailbox.delivery.failed` | mailbox | durable | both |
| `agent.profile.removed` | agent | durable | detail |
| `agent.profile.error` | agent | ephemeral | detail |
| `artifact.diff.detected` | artifact | ephemeral | detail |

This table is the **single canonical event registry**. Other capabilities (notably `bus-runtime`'s publisher / subscriber matrix) MUST only reference event types listed here. Adding a new event type SHALL require a PR that updates this table first; lint / spec-validate jobs SHALL flag references in any other spec to event types not present here. The `visibility` column is also canonical — `bus-runtime` and `messaging` and `web-ui` MUST NOT redefine visibility per event; they only consume it.

> **关于 `adapter.raw.stdout/stderr` 的 visibility**：表中记为 `detail` 仅作 schema 形式上的占位（`visibility:check` 要求每行非空）；这类 ephemeral raw 事件**不参与** `view=main` / `view=detail` SSE 路由。它们只通过独立的 `view=raw` 通道投递，并额外受 `admin` scope / 本地 `[debug] enabled=true` 控制（详见 `事件 visibility 字段` 的 raw 视图说明 + `security/Debug 授权边界`）。`view=detail` 的 Run Detail 客户端 MUST NOT 通过 visibility 矩阵收到 raw 帧。

#### Scenario: durable 事件落 events 表

- **WHEN** producer 发出 `message.created` 事件
- **THEN** EventBus 在 PubSub 派发前先 `INSERT INTO events ...` 持久化，事务失败则整个发布失败

#### Scenario: ephemeral 事件不进 events 表

- **WHEN** producer 发出 `message.part.delta` 事件
- **THEN** EventBus 直接派发到 PubSub，不写 events 表；订阅者收到的 envelope 字段完整

#### Scenario: 引用未登记事件失败

- **WHEN** 任意其他 spec / 代码引用 `agent.run.aborted`（不在 canonical 清单内）
- **THEN** `bun run events:check`（或 spec validate hook）报错 `event type 'agent.run.aborted' not found in event-system canonical registry`，CI 失败

### Requirement: events 表 Schema

The system SHALL persist durable events in a single SQLite table with the following columns. Every durable event SHALL be assigned a monotonic `seq` (INTEGER, autoincrement); the `seq` value is the canonical SSE resume cursor.

```sql
CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  seq             INTEGER NOT NULL UNIQUE,    -- 全局单调递增，SSE resume cursor
  type            TEXT NOT NULL,
  schema_version  INTEGER NOT NULL,
  visibility      TEXT NOT NULL,              -- 'main' | 'detail' | 'both'
  workspace_id    TEXT,
  room_id         TEXT,
  task_id         TEXT,
  run_id          TEXT,
  agent_id        TEXT,
  trace_id        TEXT,
  causation_id    TEXT,
  correlation_id  TEXT,
  payload         TEXT NOT NULL,           -- JSON
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_events_seq                  ON events (seq);
CREATE INDEX idx_events_workspace_created    ON events (workspace_id, created_at);
CREATE INDEX idx_events_room_created         ON events (room_id, created_at);
CREATE INDEX idx_events_run_created          ON events (run_id, created_at);
CREATE INDEX idx_events_trace                ON events (trace_id);
CREATE INDEX idx_events_type_created         ON events (type, created_at);
CREATE INDEX idx_events_room_visibility      ON events (room_id, visibility, seq);
```

`seq` 由 daemon 写表事务内分配（单写者），保证全局严格递增、无空洞。Ephemeral 事件 MUST NOT 进入 events 表，因此 SHALL NOT 占用 seq。

#### Scenario: durable 事件按 seq 严格递增

- **WHEN** daemon 在 1 秒内发出 100 个 durable 事件
- **THEN** events 表对应 100 行的 `seq` 严格单调递增、无跳号、无重复

#### Scenario: 按 traceId 检索完整链路

- **WHEN** Debug Panel 查询 `GET /events?traceId=<tid>`
- **THEN** daemon 返回该 traceId 下所有 durable 事件按 `seq` 升序，含 causationId 关系图

### Requirement: SSE id 与 cursor 的 durable-only 语义

The system SHALL only assign SSE `id:` fields to durable events using their numeric `seq`; ephemeral events SHALL NOT carry a resumable id and clients MUST NOT persist their identifier as a cursor.

```ts
// SSE 写出协议
function writeEvent(sse: SSEStream, event: AgentHubEvent, durability: "durable" | "ephemeral", seq?: number) {
  if (durability === "durable") {
    // 必填 id，等于 seq；客户端会持久化 Last-Event-ID
    sse.writeSSE({ id: String(seq), event: event.type, data: JSON.stringify(event) })
  } else {
    // 不写 id 字段，避免 EventSource 自动把 cursor 推进到未落库事件
    sse.writeSSE({ event: event.type, data: JSON.stringify(event) })
  }
}
```

EventSource 标准行为：客户端只在收到带 `id:` 的事件时才更新内部 `lastEventId`。因此本规范下 `Last-Event-ID` header 永远只反映客户端最后收到的 durable seq，不会被 ephemeral 帧污染。

`Last-Event-ID` 取值与解释：

- 数值字符串（如 `"42"`）：解释为 durable `seq`，daemon 重连时回放 `seq > 42` 的全部 durable 事件。
- 缺失或非数值：等价于首次连接，不回放历史。

#### Scenario: ephemeral 帧不带 SSE id

- **WHEN** daemon 通过 SSE 派发一个 ephemeral 事件（如 `message.part.delta`）
- **THEN** 写出的 SSE 帧不含 `id:` 行；浏览器 EventSource 不更新内部 `lastEventId`；下次重连发出的 `Last-Event-ID` 仍是上一个 durable seq

#### Scenario: durable 帧 id 等于 seq

- **WHEN** daemon 通过 SSE 派发一个 durable 事件（已分配 seq=128）
- **THEN** 写出的 SSE 帧 `id: 128` + `event: <type>` + `data: <JSON envelope>`；客户端 EventSource 自动把 `lastEventId` 更新为 `"128"`

### Requirement: SSE 桥接与 cursor 重连

The system SHALL bridge the in-process Effect PubSub to the SSE endpoint `/event`, supporting cursor-based resume via `Last-Event-ID` interpreted as a durable `seq`.

```ts
app.get("/event", async (c) => {
  const cursorRaw = c.req.header("Last-Event-ID")
  const cursorSeq = cursorRaw && /^\d+$/.test(cursorRaw) ? Number(cursorRaw) : null
  return streamSSE(c, async (sse) => {
    if (cursorSeq !== null) {
      // 1. 回放 events 表中 seq > cursorSeq 的全部 durable 事件，按 seq 升序
      yield* replayDurableSinceSeq(cursorSeq, sse)
    }
    // 2. 订阅实时 PubSub
    const fiber = Effect.runFork(
      bus.subscribeAll().pipe(
        Stream.runForEach(({ event, durability, seq }) =>
          Effect.promise(() => {
            if (durability === "durable") {
              return sse.writeSSE({ id: String(seq), event: event.type, data: JSON.stringify(event) })
            } else {
              return sse.writeSSE({ event: event.type, data: JSON.stringify(event) })
            }
          })
        )
      )
    )
    c.req.raw.signal.addEventListener("abort", () => {
      Effect.runFork(Fiber.interrupt(fiber))
    })
  })
})
```

#### Scenario: 客户端首次连接

- **WHEN** 客户端 `GET /event` 不带 `Last-Event-ID`
- **THEN** daemon 不回放历史，直接进入实时订阅

#### Scenario: 客户端断网 5 秒后重连，期间夹杂 ephemeral

- **WHEN** 客户端在断网期间 daemon 推送了 12 个 durable（seq 100..111）和 50 个 ephemeral；客户端最后收到的 durable seq=99
- **THEN** 客户端按 EventSource 标准只持久化 `Last-Event-ID="99"`（ephemeral 没设置 id，不污染）；重连后 daemon 回放 seq 100..111 共 12 个 durable，不补发 ephemeral

#### Scenario: 非数值 Last-Event-ID 兜底

- **WHEN** 客户端发来 `Last-Event-ID: ephemeral:abc`（旧客户端或异常值）
- **THEN** daemon 视为缺失 cursor，不回放历史，直接进入实时订阅；不报错

### Requirement: ephemeral delta 合流（反压）

The system SHALL coalesce successive `message.part.delta` events for the same `messageId` within a 40 ms window before pushing to SSE clients.

#### Scenario: 高速 token 流不打挂客户端

- **WHEN** adapter 在 100 ms 内连续 emit 50 个 `message.part.delta` 同 messageId
- **THEN** SSE 客户端最多收到 3 条合并后的 delta（每 40 ms 一帧），合并后的 `delta` 字段是各帧 text 的拼接

### Requirement: 双 PubSub（wildcard + per-type）

The system SHALL provide two subscription modes: subscribe to a specific event type, or subscribe to all events.

```ts
interface EventBus {
  publish<T extends AgentHubEvent>(event: T): Effect.Effect<PublishResult, never, never>
  subscribe<T extends AgentHubEvent["type"]>(
    type: T
  ): Stream.Stream<Extract<AgentHubEvent, { type: T }>, never, Scope.Scope>
  subscribeAll(): Stream.Stream<AgentHubEvent, never, Scope.Scope>
}

type PublishResult =
  | { durability: "durable"; seq: number }     // 事务内分配的 seq
  | { durability: "ephemeral" }
```

#### Scenario: per-type 订阅过滤其他事件

- **WHEN** 订阅者 `subscribe("intervention.requested")`
- **THEN** 只收到 `intervention.requested` 类型的事件，不会被 `message.part.delta` 干扰

#### Scenario: Scope 关闭自动取消订阅

- **WHEN** Effect Scope 关闭（如 SSE 客户端断开）
- **THEN** 订阅自动取消，不再收事件，PubSub 资源释放

### Requirement: 事件 schema 演进规则

The system SHALL evolve event schemas only by additive changes; renaming or removing fields requires a new event type with `.v2`.

允许：

- 新增可选字段
- 新增事件类型
- 字段类型从严到松（如 `string` → `string | null`）

禁止：

- 删除字段
- 重命名字段
- 字段类型从松到严

#### Scenario: 删除字段触发 lint 错误

- **WHEN** 开发者修改 `MessageCreatedPayload` 删除 `senderId` 字段
- **THEN** `bun run schema:check` 报 `BREAKING: field 'senderId' removed from message.created v1. Bump schemaVersion or rename type to message.created.v2.`

### Requirement: 客户端 Projector

The web client SHALL maintain a client-side projector that consumes the SSE stream and updates a typed view model; React components subscribe to the view model, not the raw event stream.

```
SSE Client
   ↓ (event)
Client Projector  (apply event → patch view model)
   ↓ (view model)
React Components
```

#### Scenario: 收到 message.part.delta 时累积文本

- **WHEN** projector 收到三条同 messageId 的 `message.part.delta`，分别为 "Hello"、" "、"world"
- **THEN** 该 message 的 view model `text` 字段为 `"Hello world"`，对应 React 组件触发一次重渲染（合并 setState）

#### Scenario: 收到 message.completed 后丢弃 delta 缓存

- **WHEN** projector 在累积 5 个 delta 后收到 `message.completed`
- **THEN** projector 用 completed 事件的最终 text 覆盖 view model，并清空该 messageId 的 delta 缓存

### Requirement: 事件 visibility 字段（main / detail / both）

The system SHALL include `visibility ∈ {"main", "detail", "both"}` on every event envelope. The visibility value SHALL be derived solely from the canonical event registry table; producers MUST NOT compute visibility per-publish (it is a per-event-type constant). SSE bridge SHALL filter delivery according to the connection's `view=` query parameter:

| client view | delivers | filter |
|---|---|---|
| `view=main` (default) | `visibility ∈ {main, both}` | 用户主流（chat 面板） |
| `view=detail&runId=<id>` | `visibility ∈ {detail, both}` AND `runId == <id>` | Run Detail 视图 |
| `view=raw` | adapter raw stream（独立通道） | 见下文 |

`raw` 视图**不**通过 `visibility` 控制，而是独立的 SSE 流（订阅 `ephemeral.adapter.raw` 通道），需要 `admin` scope 或本地 `[debug] enabled=true`。`visibility` 只表达"这条事件属于产品主流还是详情面"，不表达"这条事件是否敏感"。

```ts
// 派发顺序：先按 view 过滤，再按 durable/ephemeral 写帧
function shouldDeliver(envelope: EventEnvelope<unknown>, view: ClientView): boolean {
  if (view.kind === "main") return envelope.visibility === "main" || envelope.visibility === "both"
  if (view.kind === "detail") return (envelope.visibility === "detail" || envelope.visibility === "both") && envelope.runId === view.runId
  return false   // raw 走独立通道，不在 visibility 矩阵
}
```

#### Scenario: visibility 由 registry 决定不可逐 publish 改写

- **WHEN** 任意 publisher 在 publish 时尝试覆盖 envelope.visibility（比如手动改成 `"detail"`）
- **THEN** EventBus 在写表前从 registry 反查事件类型对应的 visibility，发现不一致 → 抛 `InvalidEventEnvelope { reason: "visibility_mismatch", expected, got }`，不写库不派发

#### Scenario: main 视图收不到 detail 事件

- **WHEN** 客户端 `GET /event?view=main&roomId=r_1`，服务端派发一条 `tool.call.requested`（visibility=detail）
- **THEN** 该客户端不收到该事件；同 daemon 的另一连接 `view=detail&runId=run_42` 若 runId 匹配则收到

#### Scenario: raw 视图独立

- **WHEN** 客户端 `GET /event?view=raw&adapterSessionId=s_42` + admin token
- **THEN** 派发 `adapter.raw.stdout/stderr` 等独立通道事件；不接 main / detail；权限不足直接 403

### Requirement: events:check 与 visibility:check CI 校验

The system SHALL provide CI scripts that fail when:

1. **events:check** — any spec / TypeScript file references an event type literal not present in the canonical event registry above.
2. **visibility:check** — any durable event's TypeScript schema lacks a registered visibility, OR any spec scenario / payload references a visibility value that disagrees with the registry.
3. **subscriptions:check** — a module's `subscribes.ts` declaration disagrees with the publisher/subscriber matrix in `bus-runtime`.
4. **command:check** — any internal call site references a Command type not in `bus-runtime`'s canonical Command union.
5. **run-state-machine:check** — `RunLifecycleService` method coverage matches every transition declared in `agents/Run 状态机扩展`.

These run on every PR and on `bun run check:all` locally; `openspec validate --strict` does **not** subsume them — these scripts are required.

#### Scenario: events:check 抓未登记事件

- **WHEN** 实现代码在某模块新加 `eventBus.publish({ type: "agent.run.aborted", ... })` 但 registry 没收录
- **THEN** `bun run events:check` 报错 `event 'agent.run.aborted' referenced from packages/agents/src/run-aborter.ts:42 but missing in event-system canonical registry`

#### Scenario: visibility:check 抓不一致

- **WHEN** messaging spec 或代码声明 `message.brief.published` visibility=detail，与 registry 中 main 不一致
- **THEN** `bun run visibility:check` 报错；CI 失败

#### Scenario: command:check 抓未登记 Command

- **WHEN** orchestrator 代码 dispatch `{ type: "WakeAgent", ... }` 但 `bus-runtime` 的 Command union 没有 WakeAgent
- **THEN** `bun run command:check` 报错


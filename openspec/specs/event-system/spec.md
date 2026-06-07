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

The canonical event registry SHALL be extended with the following V1.0 event types. All new types MUST be registered in `packages/protocol/src/events/registry.ts` and validated by `events:check` / `visibility:check` CI before any V1.0 capability spec references them.

**V0 baseline events（已在 registry 注册，补录到 canonical table）**：

| 事件类型 | category | durability | visibility | 来源 capability | 备注 |
|---|---|---|---|---|---|
| `message.created` | message | durable | both | messaging | 需要 projector handler |
| `message.part.delta` | message | ephemeral | detail | messaging | streaming delta |
| `message.part.added` | message | durable | both | messaging | 需要 projector handler |
| `message.completed` | message | durable | both | messaging | 需要 projector handler |
| `message.cancelled` | message | durable | both | messaging | 需要 projector handler |
| `message.deleted` | message | durable | both | messaging | 需要 projector handler |
| `message.updated` | message | durable | both | messaging | 需要 projector handler |
| `message.brief.published` | message | durable | main | messaging | 需要 projector handler |
| `pending_turn.created` | message | durable | main | messaging | 需要 projector handler |
| `pending_turn.cancelled` | message | durable | main | messaging | 需要 projector handler |
| `pending_turn.scheduled` | message | durable | main | messaging | 需要 projector handler |
| `pending_turn.consumed` | message | durable | main | messaging | 需要 projector handler |
| `room.created` | room | durable | both | rooms | 需要 projector handler |
| `room.opened` | room | durable | both | rooms | 需要 projector handler |
| `room.closed` | room | durable | both | rooms | 需要 projector handler |
| `agent.profile.loaded` | agent | durable | detail | agents | Settings REST-only |
| `agent.profile.updated` | agent | durable | detail | agents | Settings REST-only |
| `agent.profile.removed` | agent | durable | detail | agents | Settings REST-only |
| `agent.profile.error` | agent | ephemeral | detail | agents | 错误通知 |
| `agent.joined` | agent | durable | both | agents | 需要 projector handler |
| `agent.left` | agent | durable | both | agents | 需要 projector handler |
| `agent.state.changed` | agent | durable | both | agents | 需要 projector handler |
| `agent.blocked` | agent | durable | both | agents | 需要 projector handler |
| `agent.capabilities.updated` | agent | durable | detail | agents | Settings REST-only |
| `agent.token.delta` | agent | ephemeral | detail | agents | streaming delta |
| `agent.typing` | agent | ephemeral | detail | agents | typing indicator |
| `agent.status_line.updated` | agent | ephemeral | main | agents | status line |
| `agent.run.queued` | run | durable | both | run-lifecycle | 需要 projector handler |
| `agent.run.waiting` | run | durable | both | run-lifecycle | 需要 projector handler |
| `agent.run.started` | run | durable | both | run-lifecycle | 需要 projector handler |
| `agent.run.completed` | run | durable | both | run-lifecycle | 需要 projector handler |
| `agent.run.failed` | run | durable | both | run-lifecycle | 需要 projector handler |
| `agent.run.cancelling` | run | durable | both | run-lifecycle | 需要 projector handler |
| `agent.run.cancelled` | run | durable | both | run-lifecycle | 需要 projector handler |
| `agent.run.waiting_permission` | run | durable | both | run-lifecycle | 需要 projector handler |
| `agent.run.resumed` | run | durable | detail | run-lifecycle | Run Detail only |
| `run.heartbeat` | run | ephemeral | detail | run-lifecycle | heartbeat |
| `tool.call.requested` | run | durable | detail | run-lifecycle | Run Detail only |
| `tool.call.completed` | run | durable | detail | run-lifecycle | Run Detail only |
| `tool.update.diverted` | run | ephemeral | detail | run-lifecycle | streaming |
| `tool.output.delta` | run | ephemeral | detail | run-lifecycle | streaming |
| `subagent.started` | run | durable | detail | run-lifecycle | Run Detail only |
| `subagent.completed` | run | durable | detail | run-lifecycle | Run Detail only |
| `file.changed` | run | durable | detail | run-lifecycle | Run Detail only |
| `task.created` | task | durable | both | task-workflow-core | 需要 projector handler |
| `task.assigned` | task | durable | both | task-workflow-core | 需要 projector handler |
| `task.status.changed` | task | durable | both | task-workflow-core | 需要 projector handler |
| `task.status.changed.rejected` | task | ephemeral | detail | task-workflow-core | 错误通知 |
| `context.item.created` | context | durable | detail | context-ledger | Settings REST-only |
| `context.item.proposed` | context | durable | detail | context-ledger | Settings REST-only |
| `context.item.confirmed` | context | durable | detail | context-ledger | Settings REST-only |
| `context.item.update_requested` | context | durable | detail | context-ledger | Settings REST-only |
| `context.item.conflict_created` | context | durable | detail | context-ledger | Settings REST-only |
| `context.item.deprecated` | context | durable | detail | context-ledger | Settings REST-only |
| `context.item.visibility.changed` | context | durable | detail | context-ledger | Settings REST-only |
| `context.snapshot` | context | durable | detail | context-ledger | Settings REST-only |
| `permission.requested` | permission | durable | both | permissions | 需要 projector handler |
| `permission.resolved` | permission | durable | both | permissions | 需要 projector handler |
| `intervention.requested` | intervention | durable | both | interventions | 需要 projector handler |
| `intervention.approved` | intervention | durable | both | interventions | 需要 projector handler |
| `intervention.ignored` | intervention | durable | both | interventions | 需要 projector handler |
| `intervention.rejected` | intervention | durable | both | interventions | 需要 projector handler |
| `intervention.snoozed` | intervention | durable | both | interventions | 需要 projector handler |
| `intervention.injected` | intervention | durable | both | interventions | 需要 projector handler |
| `intervention.resolved` | intervention | durable | both | interventions | 需要 projector handler |
| `intervention.closed` | intervention | durable | both | interventions | 需要 projector handler |
| `intervention.invalid_transition` | intervention | durable | detail | interventions | 错误通知 |
| `artifact.diff.created` | artifact | durable | both | artifacts | 需要 projector handler |
| `artifact.diff.detected` | artifact | ephemeral | detail | artifacts | 检测通知 |
| `artifact.file.created` | artifact | durable | both | artifacts | 需要 projector handler |
| `artifact.reviewing` | artifact | durable | both | artifacts | 需要 projector handler |
| `artifact.review.added` | artifact | durable | detail | artifacts | Run Detail audit/review comment |
| `artifact.review.updated` | artifact | durable | detail | artifacts | Run Detail audit/review comment |
| `artifact.review.resolved` | artifact | durable | detail | artifacts | Run Detail audit/review comment |
| `artifact.review.deleted` | artifact | durable | detail | artifacts | Run Detail audit/review comment |
| `artifact.archived` | artifact | durable | detail | artifacts | Run Detail lifecycle audit |
| `artifact.deleted` | artifact | durable | detail | artifacts | Run Detail lifecycle audit |
| `artifact.accepted` | artifact | durable | both | artifacts | 需要 projector handler |
| `artifact.applying` | artifact | durable | both | artifacts | 需要 projector handler |
| `artifact.applied` | artifact | durable | both | artifacts | 需要 projector handler |
| `artifact.rejected` | artifact | durable | both | artifacts | 需要 projector handler |
| `artifact.failed` | artifact | durable | both | artifacts | 需要 projector handler |
| `artifact.preview.started` | artifact | durable | both | artifacts | 需要 projector handler |
| `artifact.preview.stopped` | artifact | durable | both | artifacts | 需要 projector handler |
| `adapter.registered` | adapter | durable | detail | adapter-framework | Settings REST-only |
| `adapter.session.created` | adapter | durable | detail | adapter-framework | Run Detail only |
| `adapter.session.ended` | adapter | durable | detail | adapter-framework | Run Detail only |
| `adapter.session.disposed` | adapter | durable | detail | adapter-framework | Run Detail only |
| `adapter.crashed` | adapter | durable | detail | adapter-framework | Run Detail only |
| `adapter.liveness.changed` | adapter | durable | detail | adapter-framework | Settings REST-only |
| `adapter.config.updated` | adapter | durable | both | adapter-framework | 需要 projector handler |
| `adapter.raw.stdout` | adapter | ephemeral | detail | adapter-framework | streaming |
| `adapter.raw.stderr` | adapter | ephemeral | detail | adapter-framework | streaming |
| `mailbox.message.created` | mailbox | durable | detail | mailbox | Run Detail only |
| `mailbox.delivery.failed` | mailbox | durable | both | mailbox | 需要 projector handler |
| `worktree.gc.removed` | local-daemon | durable | detail | local-daemon | 内部 GC |
| `worktree.gc.skipped` | local-daemon | durable | detail | local-daemon | 内部 GC |
| `auth.token.issued` | auth | durable | detail | auth | Settings REST-only |
| `auth.token.revoked` | auth | durable | detail | auth | Settings REST-only |
| `handler.stalled` | bus | durable | detail | bus | 内部监控 |
| `server.connected` | server | durable | detail | server | 内部监控 |
| `server.shutting_down` | server | durable | detail | server | 内部监控 |
| `ui.toast.shown` | ui | ephemeral | main | ui | toast 通知 |
| `ui.presence.changed` | ui | ephemeral | main | ui | presence 更新 |
| `stream.chunk` | ui | ephemeral | main | ui | streaming chunk |

**V1.0 新增 durable events（18 个）**：

| 事件类型 | category | durability | visibility | 来源 capability | 备注 |
|---|---|---|---|---|---|
| `role.created` | role | durable | detail | role-system | Settings REST-only；不要求 projector handler |
| `role.updated` | role | durable | detail | role-system | Settings REST-only；不要求 projector handler |
| `role.deleted` | role | durable | detail | role-system | Settings REST-only；不要求 projector handler |
| `runtime.detected` | runtime | durable | detail | runtime-settings | Settings REST-only；不要求 projector handler |
| `runtime.updated` | runtime | durable | detail | runtime-settings | Settings REST-only；不要求 projector handler |
| `runtime.removed` | runtime | durable | detail | runtime-settings | Settings REST-only；不要求 projector handler |
| `model_config.created` | model | durable | detail | model-provider-settings | Settings REST-only；不要求 projector handler |
| `model_config.updated` | model | durable | detail | model-provider-settings | Settings REST-only；不要求 projector handler |
| `model_config.deleted` | model | durable | detail | model-provider-settings | Settings REST-only；不要求 projector handler |
| `agent_binding.created` | binding | durable | detail | agents（MODIFIED） | Settings REST-only；不要求 projector handler |
| `agent_binding.updated` | binding | durable | detail | agents | Settings REST-only；不要求 projector handler |
| `agent_binding.removed` | binding | durable | detail | agents | Settings REST-only；不要求 projector handler |
| `task.activity.added` | task | durable | both | task-workflow-core | 需要 projector handler（Task detail + Side Panel Tasks tab）|
| `task.delegation.created` | task | durable | both | team-mode + squad-mode | 需要 projector handler（主流 brief + Run Detail Tools）|
| `task.delegation.completed` | task | durable | both | squad-mode + team-mode | 需要 projector handler |
| `team.dispatch.started` | team | durable | both | team-mode + squad-mode | 需要 projector handler（主流 brief）|
| `team.dispatch.completed` | team | durable | both | team-mode + squad-mode | 需要 projector handler |
| `permission.run_summary` | permission | durable | detail | permissions（V1.0 D8）| Run Detail Permissions tab；不要求 main projector handler |

**V1.1 新增 durable events（16 个）**：

| 事件类型 | category | durability | visibility | 来源 capability | 备注 |
|---|---|---|---|---|---|
| `task.column.moved` | task | durable | both | kanban-board | 需要 projector handler（更新 boardColumns map）|
| `task.plan.created` | task | durable | main | planning-phase | 需要 projector handler（侧边栏 Execution Plan 卡片）|
| `run.file_changes.recorded` | run | durable | both | worktree-isolation | 需要 projector handler（Kanban 卡片 file-change badge）|
| `worktree.diff.ready` | worktree | durable | both | worktree-isolation | 需要 projector handler（"Ready to apply" badge）|
| `worktree.applied` | worktree | durable | both | worktree-isolation | 需要 projector handler（清除 badge）|
| `worktree.discarded` | worktree | durable | both | worktree-isolation | 需要 projector handler（清除 badge）|
| `worktree.conflict_detected` | worktree | durable | both | worktree-isolation | 需要 projector handler（"Conflict" badge）|
| `room.stalled` | room | durable | main | timeout-escalation | 需要 projector handler（stalled banner）|
| `room.unstalled` | room | durable | main | timeout-escalation | 需要 projector handler（dismiss banner）|
| `skill.created` | skill | durable | detail | skill-system | Settings REST-only；不要求 projector handler |
| `skill.updated` | skill | durable | detail | skill-system | Settings REST-only；不要求 projector handler |
| `skill.deleted` | skill | durable | detail | skill-system | Settings REST-only；不要求 projector handler |
| `skill.imported` | skill | durable | detail | skill-system | Settings REST-only；不要求 projector handler |
| `skill.activated` | skill | durable | detail | skill-system | Members panel REST-only；不要求 projector handler |
| `skill.deactivated` | skill | durable | detail | skill-system | Members panel REST-only；不要求 projector handler |
| `skill.materialization_failed` | skill | durable | main | skill-system | 需要 projector handler（chat view inline error）|

**V1.2 新增 events（16 个）**：

| 事件类型 | category | durability | visibility | 来源 capability | 备注 |
|---|---|---|---|---|---|
| `artifact.version.created` | artifact | durable | both | artifacts | 需要 projector handler（版本徽标与历史列表） |
| `deployment.created` | deployment | durable | main | deployment-publish | 需要通过 `message.part.added` 插入 DeploymentCard |
| `deployment.status.changed` | deployment | durable | main | deployment-publish | 需要 projector handler（DeploymentCard 状态机） |
| `deployment.log.appended` | deployment | ephemeral | main | deployment-publish | 实时日志流；断线后由 REST 补全 |
| `deployment.ready` | deployment | durable | main | deployment-publish | 需要 projector handler（ready URL / 下载信息） |
| `deployment.failed` | deployment | durable | main | deployment-publish | 需要 projector handler（失败原因与重试动作） |
| `deployment.cancelled` | deployment | durable | main | deployment-publish | 需要 projector handler |
| `deployment.expired` | deployment | durable | main | deployment-publish | 需要 projector handler（preview-url 过期） |
| `deployment.unpublished` | deployment | durable | main | deployment-publish | 需要 projector handler（static-site stop / unpublish） |
| `deployment.provider.created` | deployment | durable | detail | deployment-publish | provider CRUD audit/settings refresh |
| `deployment.provider.updated` | deployment | durable | detail | deployment-publish | provider CRUD audit/settings refresh |
| `deployment.provider.deleted` | deployment | durable | detail | deployment-publish | provider CRUD audit/settings refresh |
| `room.pinned` | room | durable | both | collab-visualization | 需要 projector handler（房间置顶排序） |
| `room.unpinned` | room | durable | both | collab-visualization | 需要 projector handler（房间取消置顶） |
| `message.pinned` | message | durable | both | im-chat-core-completion | Required for `messages.pinned_at` live/replay state |
| `message.unpinned` | message | durable | both | im-chat-core-completion | Required for `messages.pinned_at` live/replay state |
| `agent.contact.updated` | agent | durable | both | agent-contact-custom | Required for contact display-name/avatar updates |
| `task.unblocked` | task | durable | both | task-workflow-core | 需要 projector handler（blocked 指示器清除） |
| `wake_outbox.dispatched` | orchestrator | durable | detail | local-daemon | 内部唤醒审计；不要求 main projector handler |

**V1.0 明确不引入的事件类型**（防止 spec agent 误加）：

- `task.updated`：状态变化走 `task.status.changed`（V0 已注册），非状态型活动走 `task.activity.added`
- `task.deleted`：删除走 `task.status.changed { nextStatus: "cancelled" }`
- `role.generation.delta` / `role.generation.completed` / `role.generation.failed`：role 生成走 REST job polling，不进 EventBus
- `runtime.test.result` / `model_config.test.result`：test 操作结果走 REST response / job polling，不进 EventBus

**projector 要求汇总**：

- visibility=both 的 V1.0 新事件（`task.activity.added` / `task.delegation.*` / `team.dispatch.*`）：**必须**在 `apps/web/src/hooks/useProjector.ts` 加 handler
- visibility=detail 的 V1.0 新事件（role / runtime / model_config / agent_binding / permission.run_summary）：**不要求** projector handler；Settings UI 通过 REST 消费；Debug Panel 通过 `/debug/events` 查询
- V1.2 的 main/both 新事件（`artifact.version.created` / `deployment.*` / `room.pinned` / `room.unpinned` / `message.pinned` / `message.unpinned` / `agent.contact.updated` / `task.unblocked`）：对应 capability 落地时**必须**在 `apps/web/src/hooks/useProjector.ts` 加 handler
- V1.2 的 detail 新事件（`wake_outbox.dispatched`）：**不要求** main projector handler；用于内部调度审计与 Debug/Event 查询

#### Scenario: events:check 校验 18 个新事件类型

- **WHEN** 开发者在代码中 emit 任何 V1.0 新事件（如 `role.created`、`task.activity.added`）
- **THEN** `pnpm events:check` 通过（事件类型已在 registry 注册）
- **AND** `pnpm visibility:check` 通过（visibility 字段与 registry 一致）

#### Scenario: task.updated 被拒绝

- **WHEN** 开发者尝试 emit `task.updated` 事件
- **THEN** `pnpm events:check` 失败，报 `event type 'task.updated' not found in event-system canonical registry`
- **AND** 开发者应改用 `task.status.changed`（状态变化）或 `task.activity.added`（非状态型活动）

#### Scenario: role.created 不触发 projector

- **WHEN** daemon emit `role.created`（visibility=detail）
- **THEN** SSE `?view=main` 不推送该事件（detail 不进 main 流）
- **AND** Settings UI 不订阅 SSE，通过 `GET /roles` REST 拉取最新列表
- **AND** Debug Panel 通过 `/debug/events?type=role.created` 或 Event Store audit query 可查到该事件；Run Detail **不**通过 Settings CRUD SSE 实时同步

#### Scenario: task.activity.added 触发 projector

- **WHEN** daemon emit `task.activity.added`（visibility=both）
- **THEN** SSE `?view=main` 推送该事件
- **AND** `useProjector.ts` 的 `task.activity.added` handler 更新 Task detail view model
- **AND** Side Panel Tasks tab 实时显示新活动条目

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

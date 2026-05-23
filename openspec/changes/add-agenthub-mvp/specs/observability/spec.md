# observability

## ADDED Requirements

> **Capability 概览**
>
> Debug Panel v0 + 结构化日志（pino）+ 审计 events 表 + Cost 字段记录。MVP 是开发者级最低门槛：能按 traceId 重放、按 runId 看 adapter 原始事件、按 traceId 串完整因果链。Jaeger / Tempo / OpenTelemetry / metrics 仪表盘留 V1.x 视需要评估（单机本地产品大概率不做完整集成）。
>
> **Goals / Non-Goals**
> - G：开发者能在 5 分钟内定位"为什么这条消息没回复 / 这次 Run 失败"。
> - G：所有 durable 事件可按 traceId / causationId / runId / roomId 检索。
> - G：adapter raw stdout/stderr 保存可查（ephemeral 但写日志文件）。
> - NG：MVP 不上 OpenTelemetry exporter / Jaeger / Tempo（V1.x 视需要，单机产品大概率不做）。
> - NG：MVP 不做仪表盘（metrics / dashboards），只有 Debug Panel。

### Requirement: Debug Panel v0

The system SHALL provide a "Debug" tab in the side panel (visible in dev mode or when toggled in settings) with the following views:

1. **Event Timeline**：时间线视图，按 createdAt 倒序列出 durable 事件；可按 type / actor 过滤。
2. **Trace View**：输入 traceId（或点 timeline 中事件 → 跳转），展开同 traceId 的所有事件按 causationId 形成树。
3. **Run Replay**：输入 runId 或选 Run，展示该 Run 完整事件流（含 adapter raw events）。
4. **Adapter Raw Stream**：实时显示当前所有 adapter 的 stdout/stderr（带 adapterId 颜色编码）。

#### Scenario: 用户点 timeline 一条事件跳转 trace

- **WHEN** 用户点击 timeline 中 `intervention.requested` 事件
- **THEN** 切到 Trace View，展示该 traceId 下完整事件树（含触发它的 message.created、它触发的 intervention.* / agent.state.changed / adapter.session.* 等）

#### Scenario: 重放 failed Run

- **WHEN** 用户在 Run Replay 输入 `run_42`，run_42 status=`failed`
- **THEN** 时间线显示 run_42 全部事件，最后一条标红 `agent.run.failed { error: "..." }`；可下载 JSON 用于 issue

### Requirement: traceId / causationId / correlationId 注入

The system SHALL inject traceId at the outermost user-facing boundary (e.g., HTTP request handler) and propagate causationId between cause→effect events.

```ts
function withTrace<R, A>(effect: Effect.Effect<A, never, R>, traceId?: string) {
  return Effect.gen(function* () {
    const tid = traceId ?? ulid()
    return yield* effect.pipe(Effect.provideService(TraceContext, { traceId: tid }))
  })
}
```

规则：

- HTTP Command API 入口生成新 traceId（除非客户端在 `X-Trace-Id` header 显式提供）。
- 内部 emit 事件时从 TraceContext 取 traceId 写入 envelope。
- causationId = "导致当前事件发生的上一事件 id"。例如 `agent.run.started.causationId = message.created.id`。
- correlationId = 同 Run 内所有事件共享 runId 即 correlationId（也可单独赋值）。

#### Scenario: HTTP 请求带 traceId

- **WHEN** 客户端 `POST /rooms/:id/messages` 带 `X-Trace-Id: my-trace-1`
- **THEN** 该请求触发的所有 durable 事件 envelope.traceId === "my-trace-1"

#### Scenario: causationId 链

- **WHEN** message.created → 触发 agent.run.started → 触发 tool.call.requested → 触发 permission.requested
- **THEN** 4 条事件 traceId 相同；causationId 形成链：tool.call.requested.causationId = agent.run.started.id；permission.requested.causationId = tool.call.requested.id

### Requirement: pino 结构化日志

The system SHALL use pino for daemon logs with the following fields on every line: `time`, `level`, `traceId?`, `runId?`, `roomId?`, `agentId?`, `module`, `msg`.

```ts
const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: undefined,
}).child({ module: "agenthub" })
```

日志输出位置：

- 默认 stdout（开发）
- `~/.agenthub/logs/agenthub-<yyyymmdd>.log`（生产）
- 可配置 rotation（V1）

#### Scenario: 开发模式可读日志

- **WHEN** `LOG_LEVEL=debug bun run dev`
- **THEN** stdout 输出 JSON 行，pino-pretty 美化后人类可读

### Requirement: Adapter raw stream 持久化

The system SHALL capture each adapter session's raw stdout/stderr to a per-session log file, even though `adapter.raw.*` events themselves are ephemeral. Every line written to disk **MUST** first pass through the `SecretRedactor` (详见 `security/SecretRedactor 日志脱敏`); raw lines containing API keys, Bearer tokens, or known secret values MUST be written as their redacted form, never as raw text.

文件路径：`~/.agenthub/logs/sessions/<sessionId>-<runId>.log`

```text
2026-05-22T03:14:01Z stdout claude-code | [tool] read_file auth.ts
2026-05-22T03:14:01Z stderr claude-code | warning: ...
```

保留：30 天，超过自动清理。

#### Scenario: 失败 Run 后查 adapter 日志

- **WHEN** Run 失败，用户在 Debug Panel 点"打开 adapter 原始日志"
- **THEN** UI 调 `GET /debug/sessions/:id/log?tail=500` 返回最后 500 行；用户可下载完整文件

### Requirement: events 检索 API

The system SHALL expose `/debug/events` for arbitrary querying of the events table.

```
GET /debug/events?traceId=&runId=&roomId=&type=&since=&until=&limit=
```

仅在 dev mode 或显式 `auth.token` + `debug.enabled = true` 时启用。

#### Scenario: 按 traceId 拉所有事件

- **WHEN** `GET /debug/events?traceId=t_42&limit=500`
- **THEN** 返回该 traceId 下全部 durable 事件 JSON 数组按 createdAt 升序

### Requirement: Cost 字段记录（不聚合）

Every `agent.run.completed` event SHALL include `cost: { inputTokens, outputTokens, cachedTokens, costUsd, modelId }`. The system SHALL store these in the `runs` table for query but SHALL NOT compute aggregations in MVP.

#### Scenario: 查询单 Run cost

- **WHEN** UI `GET /runs/:id`
- **THEN** 返回 Run 详情含 cost 字段（若 adapter 上报）

#### Scenario: 聚合 cost 是 V1

- **WHEN** 用户尝试 `GET /workspaces/:id/cost-summary`
- **THEN** 返回 501 + `{ error: "cost aggregation is V1", capability: "v1-roadmap" }`

### Requirement: 健康指标端点（最小）

The system SHALL expose `/healthz` (详见 local-daemon spec) and `/debug/stats` returning basic counters.

```ts
type DebugStats = {
  uptimeMs: number
  roomCount: number
  activeRunCount: number
  pendingPermissionCount: number
  pendingInterventionCount: number
  eventsLast5min: number
  sseClientCount: number
}
```

#### Scenario: 拉 stats

- **WHEN** `GET /debug/stats`
- **THEN** 返回最近 5 分钟事件数 / 当前活跃连接 / 待审批数等

### Requirement: 不在 MVP 范围

The system SHALL NOT implement in MVP:

- OpenTelemetry exporter（V1）
- Jaeger / Tempo / Datadog 集成（V1）
- 仪表盘 UI（V1.x，视实际需求评估，单机产品大概率不做完整仪表盘）
- 长期留存（events 表自动归档 / 压缩）（V1.x，规模上来后再视需要）
- 告警 / 异常自动通知（V1.5，与 permission-dsl 一起做表达式触发）

#### Scenario: 用户尝试启用 Jaeger exporter

- **WHEN** 配置文件中 `[telemetry] exporter = "jaeger"`
- **THEN** daemon 启动时打印警告"Jaeger exporter is V1; falling back to local logs"，不阻断启动

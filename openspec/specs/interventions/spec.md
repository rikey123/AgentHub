# interventions Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: Intervention 数据模型

The system SHALL persist Intervention with the following schema.

```ts
type InterventionType =
  | "knock"            // 主动敲门（Observer 想发言）
  | "tag"              // 提案打标签（建议补充 ContextItem）
  | "rule"             // 规则触发（如文件变更触发 security）
  | "emergency"        // 紧急停止（V1）
  | "rollback"         // 回滚 artifact（V1）

type Intervention = {
  id: string                              // ULID
  workspaceId: string
  roomId: string
  sourceAgentId: string
  targetRunId?: string
  targetMessageId?: string
  targetContextId?: string
  targetArtifactId?: string
  type: InterventionType
  reason: string                          // 必填，至少 10 字符
  preview?: string                        // 可选：要注入的具体文本（approve 后会送到 adapter）
  priority: "low" | "medium" | "high"
  status:
    | "requested"
    | "pending_user_decision"
    | "approved"
    | "ignored"
    | "rejected"
    | "snoozed"
    | "injected"
    | "resolved"
    | "closed"
  snoozedUntil?: number
  createdAt: number
  resolvedAt?: number
}
```

```sql
CREATE TABLE interventions (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL,
  room_id             TEXT NOT NULL,
  source_agent_id     TEXT NOT NULL,
  target_run_id       TEXT,
  target_message_id   TEXT,
  target_context_id   TEXT,
  target_artifact_id  TEXT,
  type                TEXT NOT NULL,
  reason              TEXT NOT NULL,
  preview             TEXT,
  priority            TEXT NOT NULL,
  status              TEXT NOT NULL,
  snoozed_until       INTEGER,
  created_at          INTEGER NOT NULL,
  resolved_at         INTEGER
);
CREATE INDEX idx_int_room_status ON interventions (room_id, status);
```

#### Scenario: 写入 Intervention

- **WHEN** Agent 通过 `room.request_intervention` 提交一条新 intervention
- **THEN** daemon 在 interventions 表写入一行 status='requested'，含 sourceAgentId / type / reason / priority / 可选 target* 字段

#### Scenario: reason 太短拒绝

- **WHEN** intervention.reason 字段长度 < 10 字符
- **THEN** 返回 400 + `{ error: "intervention.reason must be at least 10 characters" }`，不写表

### Requirement: 状态机

The system SHALL implement the following state transitions only:

```
[create]
   ↓
requested
   ↓
pending_user_decision
   ├─ approve → approved → (adapter.injectContext) → injected → resolved → closed
   ├─ ignore  → ignored → closed
   ├─ reject  → rejected → closed
   └─ later   → snoozed → (timer / re-activate) → pending_user_decision
```

非法转换 SHALL emit `intervention.invalid_transition` durable event 并保持原状态。

#### Scenario: Agent 主动敲门

- **WHEN** Reviewer 调用 `room.request_intervention { reason: "auth.ts 中的 JWT secret 是硬编码的", priority: "high", preview: "建议改用环境变量" }`
- **THEN** daemon 写 interventions 表 `status='requested'`，发 `intervention.requested` durable 事件；Reviewer 状态转 `knocking`；Orchestrator 把 status 推到 `pending_user_decision` 并在主聊天流插入 InterventionCard

#### Scenario: 用户 approve

- **WHEN** 用户在 InterventionCard 点 approve
- **THEN** intervention.status=`approved`、发 `intervention.approved` 事件；调 `adapter.injectContext({ targetSessionId, patch: { kind: "intervention", reason, preview } })`；按 adapter manifest 的 `injectionMode`：
  - `immediate` → 立即注入，发 `intervention.injected`、`intervention.resolved`
  - `next_turn` → 标记 pending，下一轮注入；UI 显示"将在下一轮生效"
  - `next_session` → UI 显示"将在下一个会话生效"

#### Scenario: 用户 ignore

- **WHEN** 用户点 ignore
- **THEN** status=`ignored` → `closed`；Reviewer 状态从 `knocking` 回 `observing`；不注入

#### Scenario: 用户 reject

- **WHEN** 用户点 reject
- **THEN** status=`rejected` → `closed`；Reviewer 回 `observing`；同 ignore 但语义更强（建议被否）；UI 可让用户填 reject reason 写入 audit log

#### Scenario: 用户 later（snooze）

- **WHEN** 用户点 later，可选 snooze 时长（默认 5 分钟）
- **THEN** status=`snoozed`、`snoozedUntil=now+300s`；定时器到期后 status 回 `pending_user_decision`、发 `intervention.requested.reactivated`（或 `intervention.requested` 重发）；Card 重新出现

### Requirement: 去重

If the same `sourceAgentId` already has a `pending_user_decision` intervention with the same `(targetRunId | targetArtifactId | targetContextId)` triple, the system SHALL refuse to create a new intervention and return the existing id.

#### Scenario: Reviewer 在同一 run 上重复敲门

- **WHEN** Reviewer 已有 pending intervention `int_42` 关于 run_5，再次调 `room.request_intervention` 同样针对 run_5
- **THEN** Tool 返回 `{ ok: true, existingId: "int_42", deduplicated: true }`，不创建新条目

### Requirement: Intervention API

The system SHALL expose the following HTTP routes; each mutating route MUST emit a corresponding durable event.

```
GET    /interventions?roomId=&status=
GET    /interventions/:id
POST   /interventions/:id/approve         # body: { effectiveText? }
POST   /interventions/:id/ignore
POST   /interventions/:id/reject          # body: { reason? }
POST   /interventions/:id/later           # body: { snoozeSeconds?: number, defaults to 300 }
```

#### Scenario: 用户给 approve 提供修订文本

- **WHEN** 用户 approve 时在 UI 编辑了 `preview`，body `{ effectiveText: "改用 env JWT_SECRET，并补单元测试" }`
- **THEN** 注入到 adapter 的内容是 `effectiveText` 而非原始 `preview`；audit log 记录两份

### Requirement: 优先级与 UI 排序

InterventionCards SHALL be rendered in the chat stream in `createdAt` order (oldest first), but a sticky high-priority card MAY be pinned at the top of the chat panel until resolved.

#### Scenario: 多个 pending intervention

- **WHEN** Room 当前有 3 条 pending intervention（low / high / medium）
- **THEN** 主聊天流按 createdAt 插入；右侧或顶部 sticky 显示 high 一条简短摘要 + 跳转锚点

### Requirement: Audit & Telemetry

Every state transition SHALL emit a corresponding durable event (`intervention.requested` / `.approved` / `.ignored` / `.rejected` / `.snoozed` / `.injected` / `.resolved` / `.closed`); the Debug Panel SHALL replay any intervention's full timeline.

#### Scenario: 通过 traceId 重放介入

- **WHEN** Debug Panel 查询某 intervention 的 traceId
- **THEN** 返回完整事件链：requested → pending_user_decision（系统推进）→ approved → injected → resolved → closed，每条带 timestamp / actor / reason

### Requirement: Reviewer 状态联动

The system SHALL transition the source Agent's presence based on intervention status:

- `requested` / `pending_user_decision` → `knocking`
- `approved` / `injected` → `active`（用于 inject 后的发言）
- `resolved` / `closed` / `ignored` / `rejected` → `observing`（默认）
- `snoozed` → `observing`

#### Scenario: 多个 intervention 中的状态

- **WHEN** Reviewer 有 1 条 pending、1 条 snoozed
- **THEN** presence 取最高优先级状态：`knocking`（因 pending 存在）

### Requirement: 不在 MVP 范围

The system SHALL NOT implement in MVP:

- 自动批准规则（如 "low priority 自动 ignore"）— 留 V1.5（permission-dsl）
- 紧急停止（emergency）/ 回滚（rollback）的实际行为 — type 字段保留，但创建时返回 501
- 多 Agent 同时敲门的"合议"机制（如要求 N 个 reviewer 共识）— 留 V1.5（war-room-mode 配套，与 War Room 共识协议合并设计）

#### Scenario: 创建 emergency 类型被拒

- **WHEN** Agent 调 `room.request_intervention { type: "emergency", ... }`
- **THEN** Tool 返回 501 + `{ error: "emergency intervention is V1" }`


# messaging

## ADDED Requirements

> **Capability 概览**
>
> 消息流是 IM 体验的核心。Message 由 MessagePart 组成；MessagePart 含 8 种 Card 类型实现富媒体内联（Diff、Context、Permission、Intervention、Artifact 等）。增量通过 `message.part.delta` 走 ephemeral 通道，40 ms 合流。
>
> **Goals / Non-Goals**
> - G：Agent 增量输出体验流畅，不卡顿。
> - G：富媒体（Diff、Card）能与文本交错，用户可一键应用 / 接受 / 拒绝。
> - G：消息操作（重生成、引用、应用 Diff、Pin、删除）固定一组（详见 D18）。
> - NG：MVP 不做 emoji 反应 / 表情面板（V1）。
> - NG：MVP 不做消息搜索（V1 用 SQLite FTS5）。

### Requirement: Message + MessagePart 数据模型

The system SHALL persist Message and MessagePart as separate tables, with a Message owning N MessagePart entries ordered by `seq`.

```ts
type Message = {
  id: string                              // ULID
  roomId: string
  sender:
    | { type: "user"; id: string }
    | { type: "agent"; id: string; runId?: string }
    | { type: "system"; id: "system" }
  role: "user" | "assistant" | "system" | "tool"
  status: "streaming" | "completed" | "failed" | "cancelled" | "deleted"
  quotedMessageId?: string                // 引用
  // 控制 message.created handler 是否触发自动调度（详见 messaging/用户 Turn 排队 + orchestrator/Solo 模式调度）
  // 'immediate'：Orchestrator handler 直接 dispatch WakeAgent
  // 'pending'：Orchestrator handler MUST 不 wake；调度由后续 ConsumePendingTurn 内部触发
  turnDispatchMode?: "immediate" | "pending"
  pendingTurnId?: string                   // 当 turnDispatchMode='pending' 时引用对应 PendingTurn
  createdAt: number
  updatedAt: number
}

type MessagePart =
  | TextPart
  | CodePart
  | ToolCallPart
  | ToolResultPart
  | CardPart
  | AttachmentPart

type TextPart       = { type: "text"; seq: number; text: string }
type CodePart       = { type: "code"; seq: number; lang: string; text: string }
type ToolCallPart   = { type: "tool_call"; seq: number; name: string; input: unknown }
type ToolResultPart = { type: "tool_result"; seq: number; toolCallId: string; output: unknown; ok: boolean }
type AttachmentPart = { type: "attachment"; seq: number; fileId: string; name: string; mimeType: string; sizeBytes: number }
type CardPart       = { type: "card"; seq: number; card: Card }
```

```sql
CREATE TABLE messages (
  id                    TEXT PRIMARY KEY,
  room_id               TEXT NOT NULL,
  sender_type           TEXT NOT NULL,
  sender_id             TEXT NOT NULL,
  run_id                TEXT,
  role                  TEXT NOT NULL,
  status                TEXT NOT NULL,
  quoted_message_id     TEXT,
  turn_dispatch_mode    TEXT,                      -- 'immediate' | 'pending'
  pending_turn_id       TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);
CREATE INDEX idx_messages_room_created ON messages (room_id, created_at);
CREATE INDEX idx_messages_pending      ON messages (room_id, turn_dispatch_mode);

CREATE TABLE message_parts (
  message_id   TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  part_type    TEXT NOT NULL,
  payload      TEXT NOT NULL,         -- JSON
  PRIMARY KEY (message_id, seq),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
```

#### Scenario: 写入 user 消息

- **WHEN** 用户 `POST /rooms/:id/messages` body `{ text: "Refactor auth.ts to use jwt" }`
- **THEN** daemon 创建 Message（role=user, status=completed）+ 一个 TextPart，发 `message.created` durable 事件，返回 201 + Message

#### Scenario: assistant message 流式追加

- **WHEN** Agent run 输出第一个 token
- **THEN** daemon 若该 message 不存在则创建（status=streaming），发 `message.created` durable 事件；后续每个 token 走 `message.part.delta` ephemeral，最终 `message.completed` durable 事件携带最终全文

### Requirement: Card 类型清单

The system SHALL define exactly the following Card union types within `CardPart`. The 6 MVP cards (TaskCard / ContextCard / DiffCard / PreviewCard / PermissionCard / InterventionCard) are **MVP renderable** — daemon MUST emit them and Web UI MUST provide a renderer component. The 3 V1 cards (DecisionCard / TrustCard / MemoryCard) are **V1 placeholder** — they are schema-only:

- 类型在 union 中预留，使前向兼容 (旧客户端能解析新枚举值)。
- daemon 在 MVP MUST NOT emit these card types from any built-in path.
- Web UI MUST NOT ship dedicated renderer components for placeholder cards in MVP；遇到时走未知 Card 降级路径（见 Scenario "未知 Card 类型降级"）。

```ts
type Card =
  // MVP renderable
  | TaskCard
  | ContextCard
  | DiffCard
  | PreviewCard
  | PermissionCard
  | InterventionCard
  // V1 placeholder (schema-only, no MVP renderer)
  | DecisionCard
  | TrustCard
  | MemoryCard

type TaskCard = {
  type: "task"
  taskId: string
  title: string
  status: "todo" | "queued" | "running" | "waiting_approval" | "blocked" | "review" | "done" | "failed" | "cancelled"
  assigneeAgentId?: string
}

type ContextCard = {
  type: "context"
  contextId: string
  title: string
  summary: string
  status: "draft" | "confirmed" | "deprecated" | "disputed"
  actions: ("confirm" | "edit" | "discard")[]
}

type DiffCard = {
  type: "diff"
  artifactId: string
  files: {
    path: string
    additions: number
    deletions: number
    status: "added" | "modified" | "deleted"
  }[]
  applyStatus: "draft" | "reviewing" | "accepted" | "applying" | "applied" | "rejected" | "failed"
}

type PreviewCard = {
  type: "preview"
  artifactId: string
  url: string                     // daemon 生成的临时 token URL
  kind: "html" | "markdown" | "image"
}

type PermissionCard = {
  type: "permission"
  permissionId: string
  agentId: string
  resource: PermissionResource    // 详见 permissions capability
  reason?: string
  status: "pending" | "allowed" | "denied" | "expired"
}

type InterventionCard = {
  type: "intervention"
  interventionId: string
  agentId: string
  reason: string
  priority: "low" | "medium" | "high"
  preview?: string
  actions: ("approve" | "later" | "ignore" | "reject")[]
  status: "pending_user_decision" | "approved" | "ignored" | "rejected" | "snoozed" | "injected" | "resolved" | "closed"
}

// V1 placeholder shapes — 仅作为占位，MVP 不绑定具体字段；V1 的 change 提案中再定义。
type DecisionCard = { type: "decision"; [key: string]: unknown }
type TrustCard    = { type: "trust";    [key: string]: unknown }
type MemoryCard   = { type: "memory";   [key: string]: unknown }
```

#### Scenario: 渲染 DiffCard

- **WHEN** Web UI 收到含 `DiffCard` 的 message part
- **THEN** UI 渲染缩略文件列表 + "查看 / 应用 / 拒绝"按钮；点击查看打开 Monaco Diff 全屏视图

#### Scenario: MVP 不发 V1 placeholder card

- **WHEN** 在 MVP 期间任意内置路径（adapter / orchestrator / artifacts / interventions / context / permissions 等）尝试构造 DecisionCard / TrustCard / MemoryCard
- **THEN** 该路径必须不存在；CI 通过 lint 校验内置代码不引用 V1 placeholder card 类型字面量

#### Scenario: V1 placeholder card 走未知 Card 降级

- **WHEN** 客户端收到 `card.type === "decision"` 的 part（来自旧客户端连了新服务端、或第三方插件提前发了 V1 形态）
- **THEN** UI 走未知 Card 降级路径，渲染为"未知卡片：<json>"占位，不抛错

#### Scenario: 未知 Card 类型降级

- **WHEN** 客户端收到一个 `card.type` 不在 union 中的 Card（旧客户端 / 新服务端）
- **THEN** UI 降级渲染为"未知卡片：<json>"并保留原 payload，不抛错

### Requirement: 增量流（delta）合流

The system SHALL coalesce successive `message.part.delta` events for the same `(messageId, seq)` within 40 ms and dispatch one merged delta to SSE clients.

`message.part.delta` payload：

```ts
type MessagePartDeltaPayload = {
  messageId: string
  seq: number                     // 对应 MessagePart 的 seq
  partType: "text" | "code"       // 仅文本 / 代码 part 支持 delta
  delta: string
  cursor?: number                 // 可选：本帧后的总长度
}
```

#### Scenario: 同 part 多帧合并

- **WHEN** 100 ms 内对 `(m1, seq=0)` 发出 5 条 delta `"He" "ll" "o " "wo" "rld"`
- **THEN** 客户端最多收到 3 条合并后的 delta，最终 view model 文本为 "Hello world"

#### Scenario: 不同 part 不合并

- **WHEN** 同 messageId 但 `seq=0` 与 `seq=1` 的 delta 同时到达
- **THEN** 两条独立合流窗口，分别派发；不会因合流跨越 part 边界

### Requirement: 消息操作（固定 6 个）

The system SHALL support exactly the following message operations on the API:

| 操作 | API | 适用消息 | 副作用 |
|---|---|---|---|
| 复制 | 客户端本地 | 全部 | 无 |
| 引用 | 通过 `POST /rooms/:id/messages` 带 `quotedMessageId` 字段 | 全部 | 创建新 user message |
| 重新生成 | `POST /messages/:id/regenerate` | 仅 assistant | 取消旧 message 状态置 cancelled，触发同 prompt 新 run |
| 应用 Diff | `POST /artifacts/:id/apply`（详见 artifacts） | DiffCard | Permission Engine → apply patch → `artifact.applied` |
| Pin | `POST /messages/:id/pin` | 包含 ContextItem 的消息 | ContextItem.scope 升级到 `workspace` |
| 删除 | `DELETE /messages/:id` | 仅 user 自己消息 | 软删除，发 `message.deleted` 事件 |

#### Scenario: 重新生成 assistant message

- **WHEN** 用户 `POST /messages/m_42/regenerate`，m_42 是 assistant 消息
- **THEN** daemon 把 m_42 状态改 `cancelled`、发 `message.cancelled`（`message.completed` 的变体），向同一 Agent 触发新 run（input 是 m_42 之前的所有上下文，不含 m_42 本身），新 run 输出新的 assistant message

#### Scenario: 重新生成 user message 拒绝

- **WHEN** 对一个 `role=user` 消息调用 regenerate
- **THEN** 返回 400 + `{ error: "regenerate is only for assistant messages" }`

#### Scenario: 软删除自己消息

- **WHEN** 用户 `DELETE /messages/m_7`，m_7 是该用户发的
- **THEN** 设置 `messages.status = 'deleted'`、发 `message.deleted` 事件；UI 显示"已删除"占位；后续 prompt assembly 不引用此消息内容

#### Scenario: 删除他人消息拒绝

- **WHEN** 用户尝试删除 sender 不是自己的消息
- **THEN** 返回 403

### Requirement: 引用消息（quote）

The system SHALL support quoting a previous message by including `quotedMessageId` when creating a new user message; UI SHALL render the quote inline above the new message body.

#### Scenario: 用户引用 Agent 的 Diff 消息

- **WHEN** 用户对一条含 DiffCard 的 assistant message 点击"引用"，输入"再加一个测试"
- **THEN** 新 user message 含 `quotedMessageId` 指向原消息；新 run 的 prompt 拼接时 quote 上下文优先级高于普通最近消息

### Requirement: Pin 与 Context Scope 升级

Pinning a message that contains one or more `ContextCard` SHALL elevate the underlying ContextItem(s) `scope` to `workspace`, and emit `context.item.visibility.changed`.

#### Scenario: Pin 一个含 ContextCard 的消息

- **WHEN** 消息含 ContextCard 引用 contextItem `c_5`（当前 scope=`task`），用户 `POST /messages/:id/pin`
- **THEN** `c_5.scope` 升级为 `workspace`，发 `context.item.visibility.changed`，UI 显示"已固定到工作区"

#### Scenario: Pin 不含 ContextCard 的消息

- **WHEN** Pin 一个普通文本消息
- **THEN** 该消息打上 `pinned=true` 标记（可选行为，仅 UI 高亮，不升级 ContextItem）；不发 visibility 事件

### Requirement: 消息列表分页

The system SHALL support cursor-based pagination on `GET /messages?roomId=&before=&limit=`.

#### Scenario: 加载历史消息

- **WHEN** 用户在 Room 中向上滚动到顶部，UI 调 `GET /messages?roomId=r_1&before=<oldest-id>&limit=50`
- **THEN** daemon 返回 50 条更早的消息按 createdAt 降序，包含其 MessagePart；若不足 50 条返回实际数量并 `hasMore: false`

### Requirement: 消息附件上传

The system SHALL support file attachment uploads via `POST /attachments` (multipart/form-data) returning a `fileId`, which can then be referenced in an `AttachmentPart`.

文件存储路径：`<workspace>/.agenthub/attachments/<yyyy>/<mm>/<fileId>`，元数据落 `attachments` 表（fileId / mime / size / sha256 / createdAt）。

#### Scenario: 上传 PDF 附件

- **WHEN** 用户上传 200 KB PDF
- **THEN** daemon 写入磁盘、计算 sha256、写 `attachments` 表，返回 `{ fileId, sizeBytes, sha256 }`

#### Scenario: 重复上传去重

- **WHEN** 上传同 sha256 的文件第二次
- **THEN** daemon 不复制磁盘文件，返回已有 fileId

### Requirement: 用户 Turn 排队（primary busy 时不阻止发送）

The system SHALL accept user messages even while the room's primary Agent has an in-flight Run. New messages SHALL be persisted, immediately rendered in the chat stream, and queued as **pending turns** to be picked up after the current Run terminates. The system MUST NOT silently drop or block user input.

> **Why**：参考 AionUi `queue-and-acp-state.md` 的实测结论：用户在 agent 忙时一定会继续发消息，要么是补充上下文、要么是更正方向、要么是说"算了别改了"。如果 UI 阻止发送，用户会困惑；如果立刻 dispatch WakeAgent 不排队，会与正在跑的 Run 同时刷新上下文造成竞争；最稳妥是承认排队是合法状态、显式建模、提供取消/编辑能力。

```ts
type PendingTurn = {
  id: string                     // ULID = userMessageId
  roomId: string
  userMessageId: string
  primaryAgentId: string
  status: "queued" | "scheduled" | "consumed" | "cancelled"
  enqueuedAt: number
  scheduledAt?: number
  attachments: AttachmentRef[]
  notes?: string                 // UI 编辑后的修订原因
}
```

```sql
CREATE TABLE pending_turns (
  id                  TEXT PRIMARY KEY,
  room_id             TEXT NOT NULL,
  user_message_id     TEXT NOT NULL UNIQUE,
  primary_agent_id    TEXT NOT NULL,
  status              TEXT NOT NULL,
  enqueued_at         INTEGER NOT NULL,
  scheduled_at        INTEGER,
  cancelled_at        INTEGER,
  notes               TEXT
);
CREATE INDEX idx_pending_turns_room_status ON pending_turns (room_id, status, enqueued_at);
```

**强制约束**：

1. **SendMessage Command 内部判 busy** — 在事务里 SELECT 当前 room primary 是否有 status ∈ {queued, claimed, starting, running, waiting_permission, cancelling} 的 Run；
   - **not busy** → INSERT messages (turn_dispatch_mode='immediate')；同事务 INSERT events(`message.created`)；handler 链下 Orchestrator 看到 immediate → dispatch `WakeAgent`。
   - **busy** → INSERT messages (turn_dispatch_mode='pending', pending_turn_id=<new>) + INSERT pending_turns + INSERT events(`message.created` visibility=both, `pending_turn.created` visibility=main) + outbox。
2. **Orchestrator handler 严格按 turn_dispatch_mode 决定是否 wake**：`turn_dispatch_mode='pending'` 的 message.created MUST 不 dispatch WakeAgent；这是 PendingTurn 与自动调度互斥的唯一闸门。
3. UI 立即显示该消息 + "等待上一轮完成" pending 徽章（基于 `pending_turn.created` 事件）。
4. **消费 PendingTurn（次于 run_next_turns）**：当上一轮 primary Run 终结（completed / failed / cancelled），Orchestrator terminal hook 按以下优先级处理（详见 `bus-runtime/订阅图谱` Orchestrator 行）：① 若该 (room, primary) 有未消费 `run_next_turns`（`consumed_at IS NULL`）→ 优先派发 `WakeAgent({ carryNextTurnIds, sourceRunId })`，**不**立即消费 PendingTurn；② 否则才按 enqueuedAt 升序对该 (room, primary) 待消费 PendingTurn 派发 `ConsumePendingTurn(pendingTurnId)`（origin='internal'）；handler 在事务内 UPDATE pending_turns.status='scheduled' + emit `pending_turn.scheduled` + 内部 dispatch `WakeAgent { reason: "consume_pending_turn", ... }`；WakeAgent handler 完成后 UPDATE pending_turns.status='consumed' + emit `pending_turn.consumed`。**理由**：`run_next_turns` 是用户/规则在当前 run 期间追加给同一上下文的输入（"继续当前任务"），PendingTurn 是新一轮 user message（"开始下一任务"）；先消费上下文延续，再开新一轮。
5. **批量合流**：同 (room, primaryAgentId) 连续多个 PendingTurn 在 30 秒内堆积，`ConsumePendingTurn` 派发时 MAY 把多条 user message 合并为单 Run prompt 输入；具体合流策略由 ContextAssembly 决定，但被合流的 PendingTurn 全部转 consumed。
6. **取消 PendingTurn**：DELETE `/pending-turns/:id` 翻译为 `CancelPendingTurn` Command（详见 bus-runtime canonical Command union）；handler UPDATE pending_turns.status='cancelled' + emit `pending_turn.cancelled`；UI 把对应 user message 标灰 + "已取消"。
7. **编辑 PendingTurn**：PATCH `/messages/:id` 翻译为 `EditMessage` Command；仅在该 message 关联 PendingTurn `status='queued'` 时允许；编辑等价于"删旧 + 入新"（cancelled + 新 PendingTurn）；emit `message.updated` + `pending_turn.cancelled` + `pending_turn.created`。
8. **限额**（防止滚雪球）：单 room 同时 queued 数 ≤ 20；超出 → POST 返回 429 + `{ error: "pending_turn_quota_exceeded", limit: 20 }`；UI 引导用户先取消已排队消息。单消息 ≤ 20 KB 文本；attachments ≤ 50 个。

#### Scenario: 用户在 agent busy 时连发两条

- **WHEN** Solo Room primary 正在跑 run_1，用户连发 m_2、m_3
- **THEN** daemon 创建 m_2、m_3、PendingTurn pt_2、pt_3 都 `status='queued'`；UI 主聊天流显示 m_2、m_3 带"排队中"徽章；run_1 完成后按 enqueuedAt 顺序触发 run_2 处理 m_2，run_2 完成后再 run_3 处理 m_3（或合流为单 Run）

#### Scenario: 用户取消 pending turn

- **WHEN** 用户点 m_3 旁的"取消"按钮
- **THEN** DELETE /pending-turns/pt_3；status='cancelled'；UI m_3 标灰 + "已取消，未触发 Agent"

#### Scenario: 配额超限拒绝

- **WHEN** 用户已有 20 条 queued PendingTurn 仍继续发
- **THEN** POST 返回 429 + 错误体；UI 顶部 banner 显示"待处理消息已达上限，请先取消"

#### Scenario: 编辑 pending message

- **WHEN** 用户编辑 m_3 内容
- **THEN** 旧 PendingTurn pt_3 cancelled，创建新 PendingTurn pt_3'；m_3 内容更新；emit `message.updated` + `pending_turn.cancelled` + `pending_turn.created`

### Requirement: 主流摘要 / Agent Run Detail 双投影

The system SHALL maintain **two distinct projections** of the same underlying durable event stream:

1. **Main Room Timeline projection** — what users see by default in the chat pane. Contains user messages, agent **briefs** (short summaries), phase summaries, actionable cards (DiffCard / PermissionCard / InterventionCard / TaskCard / ContextCard / PreviewCard), and final results. Excludes per-token deltas, per-tool-call traces, raw stdout/stderr, internal context patches, prompt assembly outputs.
2. **Agent Run Detail projection** — what users see when clicking into a specific Run from a brief. Contains the full transcript: AdapterMessage[], context projection used at run start, every tool call (input/output), permission history, raw adapter event log refs, generated artifacts, cost & token usage, debug timeline.

> **Why**：你提的核心产品判断 — 群聊主界面只展示简讯，每个 agent 有单独上下文界面。这是现有 spec 与 AionUi/multica/opencode 三个参考项目对比下最缺的一层"信息分层"。把它写进 spec 而不是只放 UI 层，是为了让 daemon 在事件订阅、视图模型、API 层就分流，而不是把所有事件塞进同一表然后 UI 自己滤。

**事件可见度（visibility）**：

每条 durable event 的 `visibility ∈ {"main", "detail", "both"}` 由 `event-system/事件分级 (durable / ephemeral)` 的 canonical registry 唯一定义；messaging capability MUST 不 redefine、不 ALTER `events` 表。下表是 messaging 域内事件相关的 visibility 视图（与 registry 一致），仅用于阅读对照：

| 事件类型 | visibility | 备注 |
|---|---|---|
| `message.created` (role=user) | both | 用户消息两边都出现 |
| `message.created` (role=assistant) + `message.completed` | both | 主流显示完整最终消息（折叠超长，详见下文）；detail 显示 + 所有 part 细节 |
| `message.brief.published` (新事件类型) | main | Agent / Orchestrator 显式发布的简讯 |
| `agent.run.queued/started/completed/failed/cancelled` | both | run 状态变化用户都需要看到 |
| `agent.run.waiting/waiting_permission` | both / 后者主流也展示等待徽章 | 主流只在转回 running 时刷新一次徽章 |
| `agent.run.resumed` | detail | 从 waiting_permission 恢复仅在 Run Detail 展示 |
| `tool.call.requested` / `tool.call.completed` | detail | 主流不显示工具调用细节；MVP 不设 `tool.call.started` / `tool.call.update` 这类细分事件，dedupe 在 AdapterBridge 内部处理 |
| `tool.update.diverted` | detail | 单 tool 输出 > 256KB 转 log 时的 ephemeral 通知 |
| `tool.output.delta` | detail | 工具输出流式增量（ephemeral） |
| `message.part.delta` (ephemeral) | detail | 流式 token 只在 Run Detail 渲染 |
| `adapter.raw.stdout/stderr` (ephemeral) | detail (raw stream tab) | 主流绝不展示 |
| `permission.requested/resolved` | both | 主流通过 PermissionCard 暴露 |
| `intervention.requested/...` | both | InterventionCard |
| `artifact.diff.created/applied/...` | both | DiffCard |
| `context.item.*` | detail（除非 ContextCard 被发布到主流） | 主流只在 ContextCard 被显式插入时显示 |
| `pending_turn.created/cancelled/scheduled/consumed` | main | 影响用户对话感知 |
| `agent.status_line.updated` (ephemeral) | main（节流后） | 30s 一次的状态行 |
| `mailbox.message.created` | detail | observer 间通信不污染主流 |

**SSE 订阅协议**：

客户端 SSE 连接 MUST 通过 query 显式声明订阅模式：

```
GET /event?view=main&roomId=r_1                    # 主聊天流（默认）
GET /event?view=detail&runId=run_42                 # 单 Run Detail
GET /event?view=raw&adapterSessionId=s_42&token=... # adapter raw stream（debug 模式 + 授权）
```

每个连接 MUST 仅推送其 view 对应的事件子集；同一用户两个 tab 各自 SSE 连接互不影响。

**Brief 发布协议**：

Agent / AdapterBridge / Orchestrator MUST 主动产出简讯到主流；具体规则：

- Run started → 自动发 `message.brief.published { kind: "run_started", agentId, runId, summary: "<agent_name> 正在 <wakeReason>..." }`。
- Run completed → 自动发 `message.brief.published { kind: "run_completed", summary: "<one-line 总结：N 文件改动，M 测试通过>" }`；总结文本由 ContextAssembly 在 Run 终结时同步生成（取 final assistant message 第一句 + Artifact 统计）。
- Run failed / cancelled → 同上，summary 改为失败原因或"已取消"。
- Phase boundary（plan.completed / tests.failed 等）→ 由触发方显式发 brief。

**主流上的 assistant 消息**：

- 流式过程的 `message.part.delta` 不进 main view（避免主流闪烁）；用户在主流只看到最终 `message.completed`（status=completed）的 assistant 消息。
- **超长折叠**：assistant final text 在主流默认仅显示前 240 字（约一段中文 / 一段英文），超出折叠为"展开 …"按钮；展开后仍在主流内联显示，不强制跳到 Run Detail。
- 无论是否折叠，message.brief.published 是单独事件（main visibility），是真正"对人友好"的一句话总结，由 ContextAssembly 在 Run 终结时基于 final assistant text + Artifact 统计同步生成；建议长度 ≤ 120 字。
- Run Detail 视图订阅 detail 事件，可以看到 delta 流和完整 transcript（无折叠）。
- 例外：用户显式打开"实时模式"（settings 开关）时，主流可订阅同 Run 的 delta（高级用户需求；MVP 默认关闭）。

```sql
-- visibility 列 / 索引由 event-system capability 在 events 表创建；messaging 不重复声明
```

#### Scenario: 主流只见简讯，Run Detail 见全量

- **WHEN** 用户在 Solo Room 触发 builder run，run 输出 200 token，调用 5 个 tool，最终给一句话总结
- **THEN** 主流只看到：用户消息、`run_started` brief、最终 assistant 消息、`run_completed` brief（"修改 3 文件，测试通过 12/12"）；点击 brief 进 Run Detail：完整 token 流、5 个 tool call 详情、context projection、adapter raw log link、cost

#### Scenario: 主流不接 raw stdout

- **WHEN** Agent 跑 npm test 输出 50KB stdout
- **THEN** 主流 SSE 不收到任何 raw 事件；Run Detail SSE（detail view）显示工具输出 truncated 视图；用户进 raw stream tab 看完整 log

#### Scenario: 多 tab 一个看主流一个看 detail

- **WHEN** 用户开 tab A `?view=main&roomId=r_1`、tab B `?view=detail&runId=run_42`
- **THEN** tab A 收到主流摘要；tab B 收到 run_42 的 token delta + tool 细节；两 tab 互不互扰

#### Scenario: 实时模式开启

- **WHEN** 用户在 settings 开启"主流实时显示 token"
- **THEN** main view 服务端开始把 `message.part.delta`（仅当前 active assistant message）也推到主流；关闭后立即回退默认行为

#### Scenario: brief 失败也发

- **WHEN** Run 失败，failureClass="retryable_visible"
- **THEN** 主流 brief 显示"<agent> 失败：<reason 简述> [重试]"；用户点重试进 Run Detail 决策

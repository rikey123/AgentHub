# messaging Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
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

The system SHALL add `TaskStatusCard` to the card type list for V1.0 Squad/Team mode dispatch notifications.

新增 Card 类型（V1.0）：

| Card 类型 | visibility | 描述 |
|---|---|---|
| `TaskStatusCard` | main | Leader 派发 / Task review 通知；显示 task title + assignee role + status + "查看 Task" 链接 |

`TaskCard` 升级（V1.0）：可显示 Task 树（child tasks + 状态 + activity 摘要）。

#### Scenario: Leader 派发后主流显示 TaskStatusCard

- **WHEN** Leader 调 `room.delegate` 创建 Task，emit `task.delegation.created`（visibility=both）
- **THEN** 主流显示 TaskStatusCard：`"<leader_name> dispatched '<task_title>' to <assignee_role_name>"`
- **AND** 点击"查看 Task"打开 Task detail slide-over

#### Scenario: 所有子 Task 进 review 后主流显示 TaskStatusCard

- **WHEN** Team Mode 所有子 Task 进 review，emit `team.dispatch.started`（visibility=both）
- **THEN** 主流显示 TaskStatusCard：`"<N> tasks ready for review"`
- **AND** 点击"查看 Task"打开 Side Panel Tasks tab

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

The system SHALL support exactly the following message operations on the API. **V0.5 落实 quote / regenerate / pin 在 Web UI 上的真实操作入口**（MVP §5.11 PARTIAL，之前仅 edit / delete 在 UI；后端 API 已存在）。

| 操作 | API | 适用消息 | 副作用 |
|---|---|---|---|
| 复制 | 客户端本地 | 全部 | 无 |
| 引用 | 通过 `POST /rooms/:id/messages` 带 `quotedMessageId` 字段 | 全部 | 创建新 user message |
| 重新生成 | `POST /messages/:id/regenerate` | 仅 assistant | 取消旧 message 状态置 cancelled，触发同 prompt 新 run |
| 应用 Diff | `POST /artifacts/:id/apply`（详见 artifacts） | DiffCard | Permission Engine → apply patch → `artifact.applied` |
| Pin | `POST /messages/:id/pin` | 包含 ContextItem 的消息 | ContextItem.scope 升级到 `workspace` |
| 删除 | `DELETE /messages/:id` | 仅 user 自己消息 | 软删除，发 `message.deleted` 事件 |

V0.5 Web UI 在每条消息 hover 时显示操作菜单（kebab icon），列出该消息适用的操作；键盘流：选中消息后按 `r` regenerate / `q` quote / `p` pin / `d` delete（V05-D15 键盘流第一轮）。

**V0.5 后端实现状态**：

- `POST /messages/:id/regenerate`：V0.5 实现 CommandBus handler `RegenerateMessage`（MVP 是 notImplemented）；
- `POST /messages/:id/pin`：V0.5 实现 CommandBus handler `PinMessage`（MVP 是 notImplemented）；
- `POST /rooms/:id/messages` 带 `quotedMessageId`：MVP 已实现（SendMessage handler 已接受 quotedMessageId 字段）；
- `DELETE /messages/:id`：MVP 已实现；
- `POST /artifacts/:id/apply`：MVP 已实现。

#### Scenario: 重新生成 assistant message

- **WHEN** 用户 `POST /messages/m_42/regenerate`，m_42 是 assistant 消息
- **THEN** daemon 把 m_42 状态改 `cancelled`、发 `message.cancelled`（`message.completed` 的变体），向同一 Agent 触发新 run（input 是 m_42 之前的所有上下文，不含 m_42 本身），新 run 输出新的 assistant message

#### Scenario: 重新生成 user message 拒绝

- **WHEN** 对一个 `role=user` 消息调用 regenerate
- **THEN** 返回 400 + `{ error: "regenerate is only for assistant messages" }`

#### Scenario: 软删除自己消息

- **WHEN** 用户 `DELETE /messages/m_7`，m_7 是该用户发的
- **THEN** 设置 `messages.deleted_at = now`、发 `message.deleted` 事件；默认 `GET /messages` 查询不返回这一行（删除即隐藏）；只有显式 `?includeDeleted=true` 才返回，便于审计；后续 prompt assembly 不引用此消息内容

#### Scenario: 删除他人消息拒绝

- **WHEN** 用户尝试删除 sender 不是自己的消息
- **THEN** 返回 403

#### Scenario: UI 键盘 quote

- **WHEN** 用户在主流用 `j/k` 选中 m_42，按 `q`
- **THEN** Web UI 把 m_42 引用插入输入框（`> @<sender>: <quoted text>` 块 + 焦点切到输入框）
- **AND** 用户输入新文本回车 → POST /rooms/:id/messages 带 quotedMessageId=m_42

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

The system SHALL support cursor-based pagination on `GET /messages?roomId=&before=&limit=`. **V0.5 落实真正的 cursor-based**（MVP §5.10 缺；之前是 `ORDER BY created_at ASC` 不带 cursor / limit）。

请求参数：

- `roomId`：必填
- `before`（可选）：游标，不透明 base64 编码的 `{ createdAt: number, id: string }`（**不**依赖 id 字典序 = 时间序，因为当前 message id 是 UUID 非 ULID）；缺省 = 取最新
- `after`（可选）：与 `before` 互斥，用于"加载更新"
- `limit`（可选）：默认 50，上限 200
- `includeDeleted`（可选）：默认 false（软删除消息默认不返回）

响应：

```ts
{
  messages: Message[]                  // 含 parts；按 createdAt DESC（即倒序）
  cursor: { before?: string; after?: string }
  hasMore: boolean
}
```

实现：用 `(created_at, id)` 复合游标做 keyset pagination，不用 OFFSET：

```sql
WHERE room_id = :roomId
  AND (created_at < :cursorCreatedAt
       OR (created_at = :cursorCreatedAt AND id < :cursorId))
ORDER BY created_at DESC, id DESC
LIMIT :limit
```

cursor 编码：`base64(JSON.stringify({ createdAt: number, id: string }))`，客户端不透明。新加索引 `idx_messages_room_created_desc (room_id, created_at DESC, id DESC)`（migration `0012_v05.sql`，**不**复用现有 `idx_messages_room_created`，改名避免冲突）。

#### Scenario: 加载历史消息

- **WHEN** 用户在 Room 中向上滚动到顶部，UI 调 `GET /messages?roomId=r_1&before=<oldest-id>&limit=50`
- **THEN** daemon 返回 50 条更早的消息按 createdAt DESC，包含其 MessagePart；若不足 50 条返回实际数量并 `hasMore: false`

#### Scenario: 首次加载取最新

- **WHEN** UI 进 Room，调 `GET /messages?roomId=r_1&limit=50`（不带 before/after）
- **THEN** 返回最近 50 条，cursor 含 `before=<oldest-returned-id>` 用于下一页

#### Scenario: 包含已删除

- **WHEN** 调 `GET /messages?roomId=r_1&includeDeleted=true`
- **THEN** 返回含 `deleted_at != null` 的行；调用方按 `deleted_at` 字段判定删除态；默认查询省略此参数时这些行不返回，前端不显示"此消息已删除"占位（删除即隐藏，更隐私友好；M0 实现选择）。

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

**V0.5 新增 PATCH 编辑**：MVP 已支持 DELETE /pending-turns/:id；V0.5 加 `PATCH /messages/:id`（编辑 PendingTurn 关联的 user message 内容），等价于"删旧 + 入新"，**不保留** enqueuedAt（按新提交时刻重排队，design.md V05-8 已采纳）。

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

**强制约束**（与 MVP 一致；V0.5 仅在第 7 项落实编辑路径）：

1. **SendMessage Command 内部判 busy** — 在事务里 SELECT 当前 room primary 是否有 status ∈ {queued, claimed, starting, running, waiting_permission, cancelling} 的 Run；
   - **not busy** → INSERT messages (turn_dispatch_mode='immediate')；同事务 INSERT events(`message.created`)；handler 链下 Orchestrator 看到 immediate → dispatch `WakeAgent`。
   - **busy** → INSERT messages (turn_dispatch_mode='pending', pending_turn_id=<new>) + INSERT pending_turns + INSERT events(`message.created` visibility=both, `pending_turn.created` visibility=main) + outbox。
2. **Orchestrator handler 严格按 turn_dispatch_mode 决定是否 wake**：`turn_dispatch_mode='pending'` 的 message.created MUST 不 dispatch WakeAgent；这是 PendingTurn 与自动调度互斥的唯一闸门。
3. UI 立即显示该消息 + "等待上一轮完成" pending 徽章（基于 `pending_turn.created` 事件）。
4. **消费 PendingTurn（次于 run_next_turns）**：当上一轮 primary Run 终结（completed / failed / cancelled），Orchestrator terminal hook 按以下优先级处理（详见 `bus-runtime/订阅图谱` Orchestrator 行）：① 若该 (room, primary) 有未消费 `run_next_turns`（`consumed_at IS NULL`）→ 优先派发 `WakeAgent({ carryNextTurnIds, sourceRunId })`，**不**立即消费 PendingTurn；② 否则才按 enqueuedAt 升序对该 (room, primary) 待消费 PendingTurn 派发 `ConsumePendingTurn(pendingTurnId)`（origin='internal'）；handler 在事务内 UPDATE pending_turns.status='scheduled' + emit `pending_turn.scheduled` + 内部 dispatch `WakeAgent { reason: "consume_pending_turn", ... }`；WakeAgent handler 完成后 UPDATE pending_turns.status='consumed' + emit `pending_turn.consumed`。
5. **批量合流**：同 (room, primaryAgentId) 连续多个 PendingTurn 在 30 秒内堆积，`ConsumePendingTurn` 派发时 MAY 把多条 user message 合并为单 Run prompt 输入；具体合流策略由 ContextAssembly 决定，但被合流的 PendingTurn 全部转 consumed。
6. **取消 PendingTurn**：DELETE `/pending-turns/:id` 翻译为 `CancelPendingTurn` Command；handler UPDATE pending_turns.status='cancelled' + emit `pending_turn.cancelled`；UI 把对应 user message 标灰 + "已取消"。
7. **编辑 PendingTurn（V0.5 落实）**：PATCH `/messages/:id` 翻译为 `EditMessage` Command；仅在该 message 关联 PendingTurn `status='queued'` 时允许；编辑等价于"删旧 + 入新"（cancelled + 新 PendingTurn，新 enqueuedAt = now()，**不**保留旧 enqueuedAt）；emit `message.updated` + `pending_turn.cancelled` + `pending_turn.created`；UI 在草稿编辑时本地存 sessionStorage 直至 PATCH 成功。
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

#### Scenario: 编辑 pending message 不保留 enqueuedAt

- **WHEN** 用户编辑 m_3 内容（m_3 关联 pt_3，enqueuedAt=t1）
- **THEN** 旧 PendingTurn pt_3 cancelled，创建新 PendingTurn pt_3'（enqueuedAt=t2，t2 > t1）；m_3 内容更新；emit `message.updated` + `pending_turn.cancelled` + `pending_turn.created`
- **AND** 排队顺序：原本在 pt_3 后的 pt_4（enqueuedAt > t1）现在排在 pt_3' 前（因为 pt_3' 的 t2 是最新）

#### Scenario: 编辑 already-scheduled turn 拒绝

- **WHEN** 用户尝试编辑 pt_3，但 pt_3 已 `status='scheduled'`（即将被 ConsumePendingTurn 消费）
- **THEN** PATCH 返回 409 + `{ error: "pending_turn_already_scheduled", currentStatus: "scheduled" }`
- **AND** UI 提示"此消息已开始处理，无法编辑"

### Requirement: 主流摘要 / Agent Run Detail 双投影

The system SHALL maintain **two distinct projections** of the same underlying durable event stream:

1. **Main Room Timeline projection** — what users see by default in the chat pane. Contains user messages, agent **briefs** (short summaries), phase summaries, actionable cards (DiffCard / PermissionCard / InterventionCard / TaskCard / ContextCard / PreviewCard), and final results. Excludes per-token deltas, per-tool-call traces, raw stdout/stderr, internal context patches, prompt assembly outputs.
2. **Agent Run Detail projection** — what users see when clicking into a specific Run from a brief. Contains the full transcript: AdapterMessage[], context projection used at run start, every tool call (input/output), permission history, raw adapter event log refs, generated artifacts, cost & token usage, debug timeline.

**V0.5 落实 brief summary 真实生成**（MVP §19.6.5 缺）：调用方（AdapterBridge / Orchestrator terminal hook）在事务**外**调 `BriefGenerator.generate()`（纯计算，不访问 DB），捕获异常后 fallback 到空字符串，再把 `briefText` 传给 `RunLifecycleService.complete/fail/cancelFinalized`；RunLifecycleService 在同事务内把 `briefText` 写入 `message.brief.published.payload.text`（详见 `bus-runtime/RunLifecycleService 是 runs 表的唯一写入口` V0.5 扩展）。**MVP 之前 brief 是 stub `"Run completed"`，V0.5 后是真实启发式总结**。

**事件可见度**与 MVP 保持一致（visibility 由 event-system 唯一定义）。messages 表 ALTER ADD COLUMN `brief_published_at INTEGER NULL`（migration `0012_v05.sql`）用于记录 brief 已发布时间戳，便于幂等检测与 UI 排序。

**Brief 发布协议（V0.5 完整版）**：

- Run started → 自动发 `message.brief.published { kind: "run_started", agentId, runId, summary: "<agent_name> 正在 <wakeReason>..." }`（与 MVP 一致）。
- Run completed → 自动发 `message.brief.published { kind: "run_completed", summary: <BriefGenerator output> }`，summary 由 V0.5 BriefGenerator 同步生成。
- Run failed → `summary: <BriefGenerator output for failure>`（启发式：`<failureReason 人类可读>` + artifact 后缀）。
- Run cancelled → `summary: "User cancelled this run"`（无 artifact 后缀）。
- Phase boundary（plan.completed / tests.failed 等）→ 由触发方显式发 brief。

`brief_published_at` 在事件成功 emit 后写入 `messages.brief_published_at`（虽然 brief 不写入 messages 表正文，但记录时间戳便于运维查"这个 message 的 brief 是何时发布的"）。

#### Scenario: 主流只见简讯，Run Detail 见全量

- **WHEN** 用户在 Solo Room 触发 builder run，run 输出 200 token，调用 5 个 tool，最终给一句话总结
- **THEN** 主流只看到：用户消息、`run_started` brief、最终 assistant 消息、`run_completed` brief（由 BriefGenerator 启发式生成，如"我已添加 OAuth 校验逻辑到 src/auth.ts...（artifacts: 1 diff / 0 files / 5 tools）"）；点击 brief 进 Run Detail：完整 token 流、5 个 tool call 详情、context projection、adapter raw log link、cost

#### Scenario: 主流不接 raw stdout

- **WHEN** Agent 跑 npm test 输出 50KB stdout
- **THEN** 主流 SSE 不收到任何 raw 事件；Run Detail SSE（detail view）显示工具输出 truncated 视图；用户进 raw stream tab 看完整 log

#### Scenario: 多 tab 一个看主流一个看 detail

- **WHEN** 用户开 tab A `?view=main&roomId=r_1`、tab B `?view=detail&runId=run_42`
- **THEN** tab A 收到主流摘要；tab B 收到 run_42 的 token delta + tool 细节；两 tab 互不互扰

#### Scenario: 失败 Run 的 brief 由启发式生成失败模板

- **WHEN** Run failureClass="retryable_visible"，reason="claude_session_expired"
- **THEN** brief = `"Claude session expired, please retry（artifacts: 0 diff / 0 files / 0 tools）"`（启发式失败模板）
- **AND** 主流显示该 brief 红色样式 + "重试"按钮

#### Scenario: brief 同事务原子发布

- **WHEN** RunLifecycleService.complete(tx, runId, cost) 被调用
- **THEN** 同一 tx 内：① UPDATE runs.status='completed' ② INSERT events(agent.run.completed) ③ INSERT events(message.brief.published) ④ UPDATE messages.brief_published_at WHERE run_id=:runId AND role='assistant'（通过 messages.run_id 反向关联）
- **AND** 任一步失败整个 tx 回滚；不会出现 run completed 但 brief 漏发的情况

### Requirement: mailbox.delivery.failed 失败可见性事件

The system SHALL emit a new durable event `mailbox.delivery.failed` (visibility=both) whenever a mailbox message cannot be successfully delivered to its target Run, so users can see explicit feedback instead of silent loss. The schema MUST be registered in `event-system` canonical registry.

```ts
type MailboxDeliveryFailedPayload = {
  mailboxMessageId: string
  roomId: string
  targetAgentId: string
  reason: "claim_conflict" | "max_retries" | "target_unavailable"
  attemptCount: number
  failedAt: number
}
```

`mailbox_messages` 表 ALTER ADD COLUMN `delivery_failure_reason TEXT NULL`（migration `0012_v05.sql`），冗余字段便于 Debug Panel 重放定位失败 mailbox 行；事件是真相来源。

**触发场景**：

1. **claim_conflict**：`room.read_mailbox` 双源原子消费时 UPDATE 影响行 ≠ SELECT 行（MailboxDeliveryConflict）；同事务回滚 UPDATE 但**事务外**发该事件。
2. **target_unavailable**：WakeAgent 失败回滚 mailbox claim 后，原 sender 已离开 Room 或 target agent 已 archived；由 Orchestrator terminal hook 在判断 carry/PendingTurn 之前补检测。
3. **max_retries**：同 mailbox 被 read_mailbox 重试 ≥ 5 次仍未成功消费（按 `mailbox_messages.attempt_count` 计数，新加列 `attempt_count INTEGER NOT NULL DEFAULT 0`，每次 claim 失败 +1）；达到上限时 daemon 标 `delivery_failure_reason="max_retries"` + 发事件 + **不**继续重试。

**Dedupe**：同 `(mailboxMessageId, reason)` 在 5 分钟 LRU 256 内只发一次 `mailbox.delivery.failed` 事件，避免重试风暴下事件爆炸（与 §19.9 raw output dedupe 同模式）。

**UI 行为**：

- 主流（visibility=main 子集）插入一条 system-level `MailboxFailureCard`（新增最小 card 类型，含 reason / target / 时间 / "查看详情"按钮）；
- Card 提供"重新投递"按钮（仅 `claim_conflict` / `target_unavailable` 显示，`max_retries` 已超上限不可重试）；
- 点击"查看详情"打开 Debug Panel 过滤同 `mailboxMessageId` 的 traceId。

#### Scenario: claim_conflict 触发可见性事件

- **WHEN** 两个 Run 几乎同时调 `room.read_mailbox`，第二个 Run 的 UPDATE 影响 0 行
- **THEN** 第二个 Run 的事务回滚 mailbox UPDATE，事务外 emit `mailbox.delivery.failed { reason: "claim_conflict", attemptCount: <n> }`
- **AND** UI 主流显示一条 MailboxFailureCard（含"重新投递"按钮）
- **AND** Run 自身不被中断，由 carry / 重试逻辑接管

#### Scenario: max_retries 上限拒绝

- **WHEN** 同 mailbox `attempt_count = 5` 仍未消费成功
- **THEN** daemon 标 `delivery_failure_reason="max_retries"` + emit `mailbox.delivery.failed`
- **AND** 后续 `room.read_mailbox` SELECT 跳过 `delivery_failure_reason IS NOT NULL` 的行
- **AND** UI MailboxFailureCard "重新投递"按钮 disabled，只有"删除"

#### Scenario: 5 分钟 dedupe 抑制风暴

- **WHEN** 同 mailbox 在 60 秒内连续被 retry 失败 10 次
- **THEN** 仅第一次发 `mailbox.delivery.failed`，后续 9 次按 `(mailboxMessageId, reason)` LRU 命中跳过事件
- **AND** `attempt_count` 字段照常累加；daemon 内部 metric counter `mailbox_delivery_failed_dedupe_suppressed` +1（**不**进 EventBus，不是 event 类型）


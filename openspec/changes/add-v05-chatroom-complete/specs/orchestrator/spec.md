# orchestrator (V0.5 delta)

## ADDED Requirements

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

## MODIFIED Requirements

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

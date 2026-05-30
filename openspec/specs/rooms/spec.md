# rooms Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: Room 数据模型

The system SHALL add `leader_role_id` to the rooms table for Squad/Team modes.

```sql
ALTER TABLE rooms ADD COLUMN leader_role_id TEXT;
-- 仅 mode IN ('squad', 'team') 时必填（应用层校验）
```

#### Scenario: 创建 squad room 需要 leaderRoleId

- **WHEN** `POST /rooms { mode: "squad" }` 不带 leaderRoleId
- **THEN** 返回 400 + `{ error: "squad_mode_requires_leader_role_id" }`

#### Scenario: 创建 solo room 不需要 leaderRoleId

- **WHEN** `POST /rooms { mode: "solo" }` 不带 leaderRoleId
- **THEN** 正常创建；`rooms.leader_role_id = NULL`

### Requirement: Room 列表与归档

The system SHALL list rooms ordered by last activity and support archiving without deletion.

#### Scenario: 列表按最近活跃排序

- **WHEN** 用户 `GET /rooms`
- **THEN** 返回的 Room 数组按 `updated_at` 降序，archived 房间默认不返回（除非传 `?includeArchived=true`）

#### Scenario: 归档不删数据

- **WHEN** 用户 `POST /rooms/:id/archive`
- **THEN** 设置 `archived_at = now()`，发 `room.closed` 事件，但 messages / events / context 都保留可查

#### Scenario: 取消归档

- **WHEN** 用户 `POST /rooms/:id/unarchive`
- **THEN** 设置 `archived_at = null`，发 `room.opened` 事件

### Requirement: Solo Mode 行为

In Solo mode, the room SHALL contain exactly one user (owner) and one Agent (primary), and the primary Agent's default presence SHALL be `active`.

#### Scenario: Solo 模式用户发消息直接触发 primary

- **WHEN** Solo Room 中用户发送 `message.created (turnDispatchMode='immediate')`
- **THEN** Orchestrator dispatch `WakeAgent { reason: "primary_turn" }`（origin='internal'）；WakeAgent handler 在 IMMEDIATE 事务内 claim mailbox + 调 `RunLifecycleService.create` → 发 `agent.run.queued`；RunQueue 调度后调 `markClaimed → markStarting` 发 `agent.run.started`（详见 `bus-runtime/RunQueue 是 bus 的一条命名队列` + `orchestrator/Solo 模式调度`）；Orchestrator 不直接写 runs / 发 `agent.run.*` 事件 / 调 adapter；MVP 不存在 `StartRun` Command

#### Scenario: Solo 模式禁止加入 Observer

- **WHEN** 在 Solo Room 调用 `POST /rooms/:id/participants` 添加 agent
- **THEN** 返回 409 + `{ error: "solo room cannot add more agents; switch to assisted mode" }`

### Requirement: Assisted Mode 行为

In Assisted mode, exactly one Agent SHALL be primary; all other Agents default to `observing` and SHALL NOT speak unless explicitly mentioned, woken by a rule, or having a knock approved.

#### Scenario: Observer 默认沉默

- **WHEN** Assisted Room 中用户发普通消息（无 @）
- **THEN** 只有 primary 进入 `active` 并触发 run；所有 observer 保持 `observing` 不触发

#### Scenario: 用户 @observer 临时唤醒

- **WHEN** 用户消息文本含 `@reviewer`
- **THEN** Orchestrator 把 reviewer 状态设为 `active`，触发其 run，run 完成后回到 `observing`

#### Scenario: Observer 主动敲门

- **WHEN** Observer 看到主聊天中 primary 准备改 auth.ts，决定敲门（详见 `interventions` capability）
- **THEN** Observer 经由 `room.request_intervention` MCP tool 发出请求，状态转 `knocking`；Intervention Card 出现在聊天流；用户 approve → 状态转 `active`，inject 介入文本；用户 reject → 状态回 `observing`

### Requirement: 唤醒规则总表

The system SHALL implement exactly five wake mechanisms; no other path may transition an Agent into `active`.

| 方式 | 触发 | 状态变化 |
|---|---|---|
| `@mention` | 用户消息文本含 `@<agentName>` | observer/observing → active |
| `orchestrator.delegate` | Primary 把子任务派给特定 Agent | observer/observing → active |
| `rule.trigger` | 配置规则匹配（如 `auth.ts` 变更触发 security） | observer/observing → knocking |
| `agent.knock` | Agent 主动敲门 | observer/observing → knocking |
| `group.review` | 用户显式 `/review @all` | 多个 observer → active（限轮次） |

#### Scenario: 不在五种规则内的"提及"不唤醒

- **WHEN** 用户消息含字符串 `email:reviewer@example.com`（不是真正的 @mention）
- **THEN** Orchestrator 不应把 reviewer 设为 active；@mention 解析必须按"@开头 + agentName 完整匹配"规则

### Requirement: 群聊纪律执行器

The system SHALL enforce the following speaking rules at the Orchestrator + Permission boundary:

1. 每个 Room 同时只能有一个 Primary。
2. Observer 的输出必须通过受控通道：mailbox / knock / draft context / review card。
3. Observer 直接 `room.send_message` 时，Permission 拦截并降级为 mailbox。
4. Agent 输出格式限制：短回复 / 卡片 / Diff / 状态行 / 最终总结。长链路过程进入"状态流"而非主聊天流。
5. 长任务每 30 秒最多发一条状态行。

#### Scenario: Observer 试图直接发消息

- **WHEN** Observer 通过 adapter 调用 `room.send_message`
- **THEN** Orchestrator 检查发送者 presence 不为 `active` → 拒绝；返回 `permission_denied` 给 adapter；同时把消息内容转写为 mailbox 写入 leader 的收件箱

#### Scenario: Agent 高频状态行被节流

- **WHEN** 同一 Agent 在 5 秒内连续发 10 条 `agent.status_line.updated` 事件
- **THEN** Orchestrator 仅推送第 1 条 + 第 6 条（30 秒窗口实际更宽，但本场景缩短为 5 秒说明节流存在）；未推送的事件仍写 events 表

### Requirement: Room 切换与多 tab 同步

The system SHALL support switching the active room from the client side and broadcast room state to all connected clients of the same user.

#### Scenario: 多 tab 同时显示同一 Room

- **WHEN** 用户开两个 tab 都打开同一 Room，在 tab A 发消息
- **THEN** tab B 通过 SSE 收到 `message.created` 与所有 delta，UI 实时同步

### Requirement: Post-MVP Mode 占位

The system SHALL implement `squad` and `team` modes in V1.0. `war_room` remains V1.5.

```ts
type RoomMode =
  | "solo"        // MVP
  | "assisted"    // MVP
  | "squad"       // V1.0：长期 Leader 路由
  | "team"        // V1.0：任务拆解派发
  | "war_room"    // V1.5：自由协作 + Leader 仲裁
```

#### Scenario: squad/team mode 不再返回 501

- **WHEN** `POST /rooms { mode: "squad", leaderRoleId: "project-manager", ... }`
- **THEN** 正常创建 squad room（V1.0 已实现）；**不**返回 501


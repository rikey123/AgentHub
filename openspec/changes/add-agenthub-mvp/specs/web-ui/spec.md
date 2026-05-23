# web-ui

## ADDED Requirements

> **Capability 概览**
>
> Vite + React + TypeScript Web UI。三栏布局：会话列表（左）/ 聊天流 + 卡片（中）/ 上下文与任务板（右）。SSE 接 daemon `/event`，客户端 Projector 维护 view model，组件订阅 view model 不订阅原始事件流。
>
> **Goals / Non-Goals**
> - G：消息流虚拟化，10 万条消息不卡。
> - G：高频 delta 渲染节流，CPU 占用平稳。
> - G：所有 Card 组件可独立测试。
> - NG：MVP 不做主题切换 / i18n（V1）。
> - NG：MVP 不做移动端响应式（V1）。

### Requirement: 三栏布局

The system SHALL provide a three-pane layout:

```
┌──────────────┬─────────────────────────┬─────────────────────┐
│  Rooms       │  Chat Stream            │  Side Panel         │
│  (sidebar)   │   - messages            │   - Context View    │
│              │   - cards               │   - Task Board      │
│   - new      │   - input box           │   - Agent Presence  │
│   - search   │                         │   - Debug Panel*    │
│   - archive  │                         │                     │
└──────────────┴─────────────────────────┴─────────────────────┘
```

侧边栏可折叠；聊天面板固定中间；右侧 panel 通过 tab 切换 4 个视图。

#### Scenario: 缩窄窗口收起侧栏

- **WHEN** 浏览器窗口宽度 < 1280px
- **THEN** 左右侧边栏自动折叠为图标条；点击图标抽出浮层

### Requirement: 客户端 Projector

The system SHALL implement a single client-side Projector that consumes SSE events and updates a typed view model; React components SHALL only subscribe to the view model.

```ts
type RoomViewModel = {
  id: string
  title: string
  participants: ParticipantViewModel[]
  messages: MessageViewModel[]               // 完整 list（虚拟化负责显示）
  unresolvedInterventions: InterventionViewModel[]
  pendingPermissions: PermissionViewModel[]
  contextItems: ContextItemViewModel[]
  tasks: TaskViewModel[]
  cursor?: string                            // SSE Last-Event-ID
}

interface Projector {
  apply(event: AgentHubEvent): void
  getRoom(roomId: string): RoomViewModel | undefined
  subscribe(roomId: string, listener: (vm: RoomViewModel) => void): () => void
}
```

#### Scenario: 多个组件共享 view model

- **WHEN** ChatStream 组件与 ContextView 组件都依赖 `room.contextItems`
- **THEN** 一次事件触发的 view model 更新，两个组件各自重渲染；不会因为组件各自订阅原始事件而出现状态不一致

### Requirement: 消息流虚拟化

The system SHALL render the message list using TanStack Virtual (or Virtua) such that DOM only contains the visible window plus a small overscan buffer.

#### Scenario: 1 万条消息

- **WHEN** Room 含 10 000 条消息加载完毕
- **THEN** DOM 中 message 节点数 ≤ 50（含 overscan）；滚动 60fps；首屏 < 200ms

### Requirement: Delta 累积与渲染节流

The system SHALL accumulate `message.part.delta` server-side at 40ms and additionally batch React renders client-side at 60fps; component MUST NOT re-render per-token.

#### Scenario: 高速 token 流不卡 UI

- **WHEN** Agent 1 秒输出 200 个 token
- **THEN** 客户端 Projector 收到 ~25 条合并 delta；React 该 message 组件最多重渲染 ~12 次（每 80ms 一次）；CPU 单核 < 10%

### Requirement: Card 组件清单

The system SHALL provide a React component for every **MVP renderable** Card type defined in `messaging` capability (TaskCard / ContextCard / DiffCard / PreviewCard / PermissionCard / InterventionCard). V1 placeholder cards (DecisionCard / TrustCard / MemoryCard) MUST NOT have dedicated components in MVP and SHALL be handled by the unknown-card fallback renderer.

| Card | 组件 | 关键交互 |
|---|---|---|
| TaskCard | `<TaskCard />` | 点击展开 Task 详情；状态徽章 |
| ContextCard | `<ContextCard />` | confirm / edit / discard 按钮（仅 draft） |
| DiffCard | `<DiffCard />` | 文件列表 + 查看 / 应用 / 拒绝按钮，点击查看进入 Monaco Diff 全屏 |
| PreviewCard | `<PreviewCard />` | iframe 预览 + 全屏切换 |
| PermissionCard | `<PermissionCard />` | allow / deny + "本项目总是允许"勾选 |
| InterventionCard | `<InterventionCard />` | approve / later / ignore / reject 四按钮，可编辑 effectiveText |

#### Scenario: V1 placeholder card 不渲染专属组件

- **WHEN** UI 收到 `card.type === "decision"` / `"trust"` / `"memory"` 的 part（极少见，可能来自旧服务端的预留路径或第三方插件）
- **THEN** 不查找 DecisionCard / TrustCard / MemoryCard 组件；直接走 `<UnknownCard />` 兜底，渲染为"未知卡片：<json>"占位

#### Scenario: PermissionCard 多 tab 同步

- **WHEN** 用户在 tab A 点 allow
- **THEN** tab B 上同一 PermissionCard 通过 SSE `permission.resolved` 自动切到"已同意"灰色态，不再可点

#### Scenario: DiffCard 应用按钮二次确认

- **WHEN** 用户点 DiffCard 的"应用"按钮，且 Permission file.write 是 ask
- **THEN** UI 不直接调 `POST /artifacts/:id/apply`，而是先 stage UI 弹 PermissionCard（嵌在卡片内），用户两步操作完成

### Requirement: 输入框

The system SHALL provide a chat input that supports:

- 普通文本
- `@<agent>` 自动补全（罗列当前 Room 的 Agent）
- Drag-and-drop 文件附件（多文件、显示上传进度）
- 引用消息（点击其他消息的"引用"按钮，自动填到输入框上方）
- Markdown 渲染预览（toggle）

#### Scenario: @ 触发补全

- **WHEN** 用户在输入框输入 `@`
- **THEN** 弹出 Agent 列表（presence 状态色标），方向键选 + 回车确认；选定后插入 `@<agent-id> ` 含尾空格

### Requirement: Side Panel 视图

The right side panel SHALL provide tabbed views: Context / Tasks / Members / Debug.

- **Context**：当前 Room 可见的 ContextItem 列表，按 status 分组（confirmed / draft / deprecated）
- **Tasks**：Task 看板（todo / running / review / done 列）
- **Members**：参与者列表（presence、capability、最近活动）
- **Debug**：见 observability capability 的 Debug Panel v0；仅在 dev mode 或显式开启时显示

#### Scenario: 切换到 Context 视图

- **WHEN** 用户点击 Context tab
- **THEN** 显示 ContextItem 列表；draft 在顶部带 confirm/discard 操作；deprecated 折叠在底部默认收起

### Requirement: 房间切换与未读提示

The system SHALL show unread count badges on rooms in the sidebar; counts SHALL increment on `message.created` for non-active rooms.

未读规则：

- 当前 Room 不计数
- 切换 Room 时清零
- daemon 重启后从 `messages.created_at > last_read_at` 重算

#### Scenario: 切换 Room 清未读

- **WHEN** 用户从 r_1 切到 r_2，r_1 之前未读 5
- **THEN** r_1 badge 变 0；r_2 当前所有消息标为已读

### Requirement: 错误与重连

The system SHALL show a non-blocking banner when SSE disconnects, retry with exponential backoff (initial 1s, max 30s, jitter), and resume from `Last-Event-ID` on reconnect.

#### Scenario: 网络中断

- **WHEN** 网络断开 10 秒
- **THEN** UI 顶部 banner 显示"重连中..."；内容只读；恢复后 banner 消失，缺失的 durable 事件由 SSE 回放补齐

### Requirement: 应用 Diff 的 UI 流程

The system SHALL implement the apply flow as: DiffCard 点应用 → 嵌入 PermissionCard（若 ask）→ 用户决策 → daemon 应用 → DiffCard 状态切换为 `applied` 显示成功 banner.

#### Scenario: 用户拒绝 Permission 后 Diff 状态

- **WHEN** 用户在嵌入的 PermissionCard 点 deny
- **THEN** DiffCard 状态保持 `accepted`（用户接受了 diff 但未授权写盘）；UI 显示"未应用：权限被拒绝"，可重试

### Requirement: 测试基础设施

The system SHALL provide:

- vitest 单元测试（projector / card 组件 / view model 还原）
- Playwright E2E（核心 golden path：新建 Room → 发消息 → DiffCard → apply）
- 与 MockAgentAdapter 联动的 storybook（不依赖真实 daemon）

#### Scenario: CI 跑 golden path

- **WHEN** CI 拉起 daemon + web，Playwright 跑 `golden_path.spec.ts`
- **THEN** 全程通过 < 60 秒；失败时截图保留

### Requirement: Main Timeline 与 Agent Run Detail 双视图

The Web UI SHALL implement two distinct chat-area views per the messaging-layer contract: **Main Timeline** as default in the room pane, and **Agent Run Detail** as a slide-over (or tab) shown when the user clicks an agent brief / run badge. Each view MUST connect its own SSE subscription with the right `view=` query so the daemon delivers a pre-filtered event subset.

```
┌──────────────┬─────────────────────────────────────┬─────────────────────┐
│  Rooms       │  Main Timeline (view=main)          │  Side Panel         │
│              │   - user messages                   │                     │
│              │   - agent briefs (clickable)        │                     │
│              │   - actionable cards                │                     │
│              │   - phase summaries                 │                     │
│              │   - pending turn badges             │                     │
│              │                                     │                     │
│              │  ◀── slide-over: Run Detail         │                     │
│              │     (view=detail&runId=<id>)        │                     │
│              │     ┌─ Tabs ─────────────────────┐  │                     │
│              │     │ Transcript | Tools | Context│ │                     │
│              │     │ Permissions | Artifacts     │ │                     │
│              │     │ Raw Stream | Cost           │ │                     │
│              │     └─────────────────────────────┘ │                     │
└──────────────┴─────────────────────────────────────┴─────────────────────┘
```

**视图约束**：

1. Main Timeline **不订阅** `message.part.delta`（除非用户在 settings 显式打开"主流实时模式"）；用户看到的 assistant message 只在 `message.completed` 后整条出现 + 流式打字机动画 fallback（前端伪装平滑感，但事件源是单条 completed）。
2. Agent Run Detail 默认 7 个 tab：
   - **Transcript**：完整 message + tool call 内联视图（按 seq 排序）。
   - **Tools**：每个 tool call 详情卡（input / output / 时长）。
   - **Context**：本次 Run 启动时的 ContextProjection 快照 + 期间增量。
   - **Permissions**：本 Run 的 permission 历史（pending / allowed / denied / expired）。
   - **Artifacts**：本 Run 产出的 artifact 列表（diff / file / terminal / preview）。
   - **Raw Stream**：adapter session 原始 stdout/stderr（虚拟化 + 搜索 + 下载）；走 `view=raw`，需要 debug.enabled 或 admin scope。
   - **Cost**：token 用量 / 模型 / 估算成本。
3. Run Detail 采用 slide-over 默认占右侧 60% 宽，可改全屏；ESC 关闭；URL 含 `?run=<id>`，可分享。
4. 用户从主流 brief 点进 Run Detail 时，前端 MUST 立即取消主流当前的高耗 SSE 项（否则两条 SSE 都拉数据）；切回主流时恢复。
5. `<UnknownCard />` 的兜底渲染同时适用于两个视图。

**Brief 渲染规则**：

```ts
type BriefViewModel = {
  kind: "run_started" | "run_completed" | "run_failed" | "run_cancelled" | "phase_completed"
  runId: string
  agentId: string
  summary: string             // 一句话
  artifactCount?: number
  cost?: { tokens: number; usd?: number }
  failureReason?: string
  failureClass?: string
}
```

UI 上 brief 显示为单行卡片，左 avatar + agent 名 + summary，右侧链接"打开详情"；click 触发 Run Detail。

#### Scenario: 主流不显示 token delta

- **WHEN** Builder run 输出 200 token，用户在主流默认视图
- **THEN** 主流不出现逐 token 闪烁；最终 `message.completed` 后整条 assistant 消息一次性出现（带打字机动画）

#### Scenario: 主流实时模式

- **WHEN** 用户在 settings 打开"主流实时模式"
- **THEN** Main Timeline SSE 订阅切换到 `view=main&realtime=1`，daemon 把当前 active assistant message 的 delta 也推到主流；UI 流式渲染

#### Scenario: 点击 brief 打开 Run Detail

- **WHEN** 用户点 `run_completed` brief
- **THEN** Run Detail slide-over 打开；URL 变成 `/rooms/r_1?run=run_42`；建立 `view=detail&runId=run_42` SSE 连接；7 tab 渲染 view model

#### Scenario: Raw Stream 需要授权

- **WHEN** 用户切到 Raw Stream tab，但当前 token 没有 admin scope（且未 debug.enabled）
- **THEN** tab 显示"需要 admin scope 或 debug 模式"；不建立 SSE；不暴露 raw 内容

### Requirement: Pending Turn 与排队 UI

The Web UI SHALL render queued user messages (pending turns from the messaging layer) inline with a visible "queued" badge, and SHALL provide cancel & edit actions for queued turns. The input box MUST NOT block the user from sending while the primary agent is busy.

**UI 行为**：

1. Input box 在 primary busy 时仍可输入 + 发送；按 Enter 触发 POST `/rooms/:id/messages`；该消息插入主流末尾，显示"⏳ 排队中（位置 N）"徽章。
2. 用户在 sessionStorage 维护本地草稿，断线重连后恢复未发送内容（区分"未发送"和"已发送排队"两个状态）。
3. 已 queued 的消息有"取消"+"编辑"两个操作；编辑等价于 cancel + new POST（与 messaging 层 PendingTurn 编辑契约对齐）。
4. Pending turn 数量 ≥ 15 时 banner 提示"已排队 15 条，建议先取消旧消息或等待 agent 完成"；20 条触发 429 后 UI 自动停止发送 + 红色 banner。
5. `pending_turn.cancelled` 事件到达时立即把对应消息标灰 + "已取消"占位；不重排序。
6. 当 pending_turn 进入 scheduled / consumed，徽章切到"处理中"图标，与正在跑的 Run 对应。

#### Scenario: agent busy 时仍可发消息

- **WHEN** primary 跑 run_1，用户输入 "additionally, also add tests" 按 Enter
- **THEN** UI 立刻显示该消息 + "⏳ 排队中（位置 1）" 徽章；输入框清空可继续输入；POST 返回 201 + PendingTurn id

#### Scenario: 取消 pending turn

- **WHEN** 用户点该消息旁的"取消"
- **THEN** UI 触发 DELETE /pending-turns/:id；消息变灰带"已取消"；不再触发 Run

#### Scenario: 配额超限 banner

- **WHEN** 用户已堆 20 条 pending，再发第 21 条
- **THEN** POST 返回 429；UI 输入框禁用 + 红 banner "已达 20 条上限，请先取消"

#### Scenario: 断线后草稿恢复

- **WHEN** 用户输入到一半，浏览器刷新
- **THEN** 输入框从 sessionStorage 恢复未发送内容；已发送的 queued 消息由 SSE 拉历史回填

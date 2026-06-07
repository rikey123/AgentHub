# web-ui Specification

## Purpose

V1.2 前端壳层与工作台契约：FeatureRail 不再占位，HeroUI 作为唯一 UI 组件体系，Artifact Studio / Contacts / Runs / Tasks / Settings 都必须有真实视图入口，Projector 需要有明确状态模型。

## MODIFIED Requirements

### Requirement: 三栏布局

The system SHALL keep the existing AgentHub shell layout, and V1.2 SHALL extend it with real FeatureRail-driven views rather than placeholder buttons.

FeatureRail 在 V1.2 中必须有以下真实入口：
- `chat`：左侧 RoomList，主区域 HomeView / ChatStream
- `contacts`：左侧 Agent Contact Directory，主区域联系人详情 / InlineAgentEditor
- `runs`：主区域运行列表或活动视图，可打开 RunDetailDrawer
- `tasks`：主区域任务工作台或聚焦 TasksPanel
- `artifacts`：主区域 Recent Artifacts / Artifact Library，可打开 ArtifactPreviewModal
- `settings`：SettingsModal

点击非 settings 项不得只是 set state 而无 UI 变化。FeatureRail 底部版本标签必须读取真实 package version，不得固定为 `v1.0`。

#### Scenario: FeatureRail 的每个入口都有真实结果

- **WHEN** 用户依次点击 `chat`、`contacts`、`runs`、`tasks`、`artifacts`、`settings`
- **THEN** 每个入口都显示对应 panel/view 或 modal
- **AND** 不存在点击后界面无可见变化的 rail item

---

### Requirement: 客户端 Projector

The projector SHALL maintain normalized room-level state for cards, deployments, artifact versions, and room ordering.

`RoomViewModel` 在 V1.2 新增：
```typescript
{
  pinnedAt?: number
  lastActivityAt?: number
  participantContactNames: string[]
  deploymentsById: Record<string, DeploymentViewModel>
  deploymentLogsById: Record<string, string[]>
  artifactVersionsById: Record<string, ArtifactVersionSummary[]>
}
```

Projector 规则：
- `message.part.added` 是聊天流插入卡片的唯一信号
- `deployment.created` 只初始化/patch `deploymentsById`，不直接插入聊天卡片
- `deployment.status.changed` / `deployment.ready` / `deployment.failed` / `deployment.cancelled` / `deployment.expired` / `deployment.unpublished` patch `deploymentsById`
- `deployment.log.appended` 追加到 `deploymentLogsById[deploymentId]`
- `artifact.version.created` patch `artifactVersionsById[artifactId]`，并刷新卡片 version badge / History tab
- `room.pinned` / `room.unpinned` patch `RoomViewModel.pinnedAt` 并重排 RoomList
- `message.pinned` / `message.unpinned` patch Pinned Context drawer 与消息 pin 状态
- `agent.contact.updated` patch Contacts、Room participant display、@mention autocomplete source
- `task.unblocked` 清除 blocker UI 并刷新 Tasks/Kanban
- Projector MUST tolerate out-of-order events（如 `deployment.ready` 先于 `message.part.added` 到达）
- Durable replay 后 MUST 能重建聊天卡片与状态，而无需刷新页面

#### Scenario: deployment.ready 先到时卡片仍能显示最新状态

- **WHEN** `deployment.ready` 事件先于对应 `message.part.added` 到达
- **THEN** projector 先缓存 `deploymentsById[deploymentId]`
- **AND** 当 `message.part.added` 到达时，DeploymentCard 立即以 ready 状态渲染

---

### Requirement: Card 组件清单

The system SHALL extend the card renderer with stable V1.2 card anatomy and payload handling.

所有 card 必须使用 HeroUI `Card`，并遵守统一解剖：
1. Header：图标 + title/filename + kind chip + status/version badge
2. Body：类型对应的缩略预览或摘要
3. Footer：统一操作区按钮

V1.2 前端必须稳定识别：
- `PreviewCard`
- `DocumentCard`
- `PresentationCard`
- `DeploymentCard`
- 现有 `DiffCard` / `TerminalCard`
- `UnknownCard` fallback

#### Scenario: 未知卡片不崩溃

- **WHEN** projector 收到未知 `card.type` 的 message part
- **THEN** 前端渲染 `UnknownCard` fallback
- **AND** 聊天流不崩溃

---

### Requirement: 输入框

The V1.2 input composer SHALL support a unified token/pill model.

支持的 token：
- `@AgentName`（mention）
- `@artifact:<id>#Lx-Ly`
- `@artifact:<id>#slide=N`
- `@workspace:<path>#Lx-Ly`
- quote preview
- attachment preview

输入 `@` 时，autocomplete 同时搜索 room participants + agent contacts。由 `Reference in Chat` 注入的引用必须作为结构化 pill，而不是仅仅把字符串拼进输入框。

#### Scenario: @AgentName 与 @artifact 引用共存

- **WHEN** 用户在输入框中同时选择 `@前端构建者` 和 `@report.md#L10-L25`
- **THEN** 输入框渲染两个独立 pill
- **AND** 发送时既保留可读 token 字符串，又携带可解析的稳定引用目标

---

### Requirement: Side Panel 视图

V1.2 SHALL keep the right-side panel model, but artifact and task workflows MUST also be reachable from FeatureRail primary navigation.

`ArtifactPreviewModal` 不是唯一入口。用户可从：
- Chat cards
- Artifacts rail view
- Tasks panel / proof-of-work panel
进入 Artifact Studio。

#### Scenario: Artifacts rail 可独立浏览产物

- **WHEN** 用户点击 FeatureRail 的 `artifacts`
- **THEN** 主区域显示最近产物列表
- **AND** 用户可直接打开任一 ArtifactPreviewModal，而不需要先回到聊天流

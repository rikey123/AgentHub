# messaging Specification

## Purpose

V1.2 扩展消息与卡片协议：稳定的 card payload shape、message.part.added 作为唯一插卡信号、Pinned Context drawer、消息操作六项完整入口。

## MODIFIED Requirements

### Requirement: Message + MessagePart 数据模型

The system SHALL keep `message.part.added` as the single timeline insertion signal for all V1.2 cards, and SHALL support typed card payloads for artifact and deployment cards.

新增消息与 card payload 契约：

```typescript
type ArtifactCardPayload = {
  type: "artifact"
  artifactId: string
  kind: "web_page" | "web_app" | "document" | "presentation" | "presentation_pptx" | "source_code" | "generic_file"
  title: string
  filename: string
  version: number
  mimeType?: string
  sizeBytes?: number
  previewUrl?: string
  downloadUrl?: string
  status?: string
}

type DeploymentCardPayload = {
  type: "deployment"
  deploymentId: string
  artifactId: string
  kind: "preview-url" | "static-site" | "source-zip" | "container-export" | "container-build" | "self-hosted"
  provider?: string
  status: "queued" | "in_progress" | "ready" | "failed" | "cancelled" | "expired" | "unpublished"
  url?: string
  downloadUrl?: string
  imageTag?: string
  expiresAt?: number
  lastError?: string
  logPreview?: string[]
}

type MentionPayload = {
  agentBindingId: string
  label: string           // 历史显示快照
  roleName?: string
  runtimeName?: string
}

type MessageCreatePayload = {
  content: string
  mentions?: MentionPayload[]
  refs?: Array<
    | { type: "artifact"; artifactId: string; lines?: [number, number]; slide?: number }
    | { type: "workspace"; path: string; lines: [number, number] }
  >
  quotedMessageId?: string
}
```

`message.part.added` 的 registry visibility 保持现有 `both`，不得降级为 `main`。

#### Scenario: message.part.added 插入 DeploymentCard

- **WHEN** daemon 在同一事务中写入 `deployments` 行和 deployment message part
- **THEN** `message.part.added` 携带的 payload 足以让前端插入 DeploymentCard
- **AND** `deployment.created` 本身不直接插卡

#### Scenario: mention payload 稳定指向 agent binding

- **WHEN** 用户发送包含 `@前端构建者` 的消息
- **THEN** 消息 payload 中保存 `mentions: [{ agentBindingId, label: "前端构建者", ... }]`
- **AND** 联系人后续改名不会改变这条历史消息的显示快照

---

### Requirement: Card 类型清单

V1.2 SHALL extend the card type list to include artifact and deployment card payloads while preserving existing diff/terminal cards.

新的前端可见卡片类型：
- `artifact`（PreviewCard / DocumentCard / PresentationCard / ArtifactCard）
- `deployment`（DeploymentCard）
- 现有 `diff` / `terminal`
- `unknown` fallback

#### Scenario: presentation_pptx card payload 可识别

- **WHEN** `message.part.added` 携带 `type='artifact'`, `kind='presentation_pptx'`
- **THEN** 前端渲染 PresentationCard 的 PptViewer 分支，而不是 UnknownCard

---

### Requirement: 消息操作（固定 6 个）

V1.2 SHALL expose the six existing message actions through stable UI entry points and keyboard/hover affordances.

动作：Reply / Quote / Regenerate / Copy Code / Apply Diff / Expand Preview。

此外，V1.2 增加：
- Pin/Unpin 图标（复用 `messages.pinned_at`）
- Artifact/Deployment card 的 Footer actions 区域

#### Scenario: Pin 图标与 Pinned Context drawer 联动

- **WHEN** 用户在某条消息上点击 Pin
- **THEN** 消息 action bar 图标变为 filled 状态
- **AND** 顶部 Pinned Context drawer badge 计数 +1

---

### Requirement: Pin 与 Context Scope 升级

The system SHALL reuse `messages.pinned_at` for room-scoped persistent context, SHALL expose a front-end Pinned Context drawer, and SHALL emit pin/unpin events for real-time UI updates.

Pinned Context drawer 要求：
- 位于聊天主区域顶部
- 默认折叠
- 显示 badge count
- 展开后列出所有 pinned messages
- 每条可 unpin
- 对大 artifact 只显示 compact ref + warning，不展开全文

事件：
- `message.pinned`（durable, both）`{ roomId, messageId, pinnedAt }`
- `message.unpinned`（durable, both）`{ roomId, messageId }`

前端通过事件更新 drawer；若事件缺失，成功响应 MAY 返回当前 pinned 列表作为兜底

#### Scenario: 大 artifact pin 不展开全文

- **WHEN** 用户 pin 一个 20KB 的 HTML artifact 消息
- **THEN** Pinned Context drawer 只显示 artifact 标题与 compact ref
- **AND** 显示“内容较大，已缩略”为 warning

---

### Requirement: Live attachment part update

The live attachment part update contract SHALL also apply to V1.2 artifact and deployment cards.

任何新增 ArtifactCard / DeploymentCard 都必须通过 `message.part.added` 进入聊天流；纯事件 (`artifact.version.created`, `deployment.created`) 不得作为唯一 UI 插卡路径。

#### Scenario: deployment.ready 只更新卡片状态

- **WHEN** DeploymentCard 已存在，随后收到 `deployment.ready`
- **THEN** 前端仅更新现有卡片状态/URL
- **AND** 不额外插入第二张卡片

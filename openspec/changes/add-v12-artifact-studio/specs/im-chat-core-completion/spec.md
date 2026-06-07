# im-chat-core-completion Specification

## Purpose

补齐初始课题需求中明确描述的 IM 聊天核心体验：会话搜索、新建对话选 Agent、置顶/最近活跃排序、多会话并行、消息操作六项、Pin 关键消息为长期上下文。

## ADDED Requirements

### Requirement: 会话搜索

The system SHALL support fuzzy search over rooms via `GET /rooms?q=<keyword>`.

搜索范围：`rooms.name`、关联参与者的 `agent_bindings.contact_name`、该 room 最近 5 条 `messages.content`。结果按 `last_activity_at DESC` 排序，`LIMIT 20`。

左侧列表顶部有常驻搜索框；输入时 debounce 200ms 后发请求，实时过滤显示结果；清空搜索框恢复完整列表。

#### Scenario: 按 Agent 名搜索房间

- **WHEN** 用户在搜索框输入 "Builder"
- **THEN** 列表显示所有包含 "Builder" Agent 参与者的房间，按最近活跃排序
- **AND** 不包含已归档的房间（`archived_at IS NOT NULL`）

#### Scenario: 无结果

- **WHEN** 搜索关键词无匹配
- **THEN** 显示空状态提示"未找到相关会话"，不显示错误

---

### Requirement: 联系人优先的新建对话流程

The system SHALL make Agent contacts the default entry point for creating a new room, while preserving the existing role/runtime/model/skills controls under an Advanced configuration section.

默认流程：
1. 选择联系人（搜索 Agent，显示 avatar / displayName / runtime chip / capability tags / status）
2. 选择模式
   - 单人默认可选 `Solo` 或 `Assisted`
   - 多人默认可选 `Assisted` 或 `Team`
   - `Squad` MAY 仅在 Advanced 中显示为 lightweight Team preset
3. Advanced Configuration
   - 对每个选中联系人可展开配置：role / runtime / model / skills / presence
   - 旧的 role/runtime/model picker 不删除，只移动到 Advanced

联系人本质上仍然是 `agent_binding` 的展示壳。最终创建 room 时保存的是 `agent_binding_id` 与相关高级配置，不创建第二套联系人实体。

#### Scenario: 从联系人发起单聊

- **WHEN** 用户点击联系人卡片上的"Start Chat"
- **THEN** 打开 New Chat 流程并预选该联系人
- **AND** 用户可在 `Solo` 与 `Assisted` 间选择其一后创建 room

#### Scenario: 多联系人默认可选 Assisted / Team

- **WHEN** 用户在新建对话面板勾选 3 个联系人
- **THEN** 模式选择优先显示 `Assisted` 和 `Team`
- **AND** `Squad` 仅在 Advanced 中可见（如启用）

#### Scenario: Advanced 保留精细配置

- **WHEN** 用户展开 Advanced Configuration
- **THEN** 仍可逐联系人修改 role/runtime/model/skills/presence
- **AND** 创建结果使用修改后的 `agent_binding` 配置，而不是默认联系人配置

---

### Requirement: 置顶与最近活跃排序

The system SHALL sort the active room list by pinned status first, then by `last_activity_at` descending.

`rooms.pinned_at` 非空的房间排在最前；多个置顶房间按 `pinned_at DESC` 排序；未置顶房间按 `last_activity_at DESC` 排序；归档房间（`archived_at IS NOT NULL`）不出现在主列表。

`rooms.last_activity_at` SHALL be updated (in the same SQLite transaction) when: a message is added, a run starts or completes, a task status changes, or a participant joins.

Pin/Unpin 通过房间右键菜单或三点菜单触发：

```
POST   /rooms/:id/pin   → rooms.pinned_at = now()，发 room.pinned（durable, both）
DELETE /rooms/:id/pin   → rooms.pinned_at = NULL，发 room.unpinned（durable, both）
```

归档继续使用已有的 `room.closed` / `room.opened`（不新增 archived 事件）。

#### Scenario: 置顶房间排在最前

- **WHEN** 用户置顶房间 A，房间 B 是最近活跃的未置顶房间
- **THEN** 房间列表显示：A（置顶）排在 B 之前，无论 B 的 last_activity_at 更新

#### Scenario: last_activity_at 随消息更新

- **WHEN** 用户在房间 C 发送一条消息
- **THEN** `rooms.last_activity_at` 更新为当前时间，房间 C 在未置顶房间中排到最前

---

### Requirement: 多会话并行不阻塞

The system SHALL allow multiple rooms to have active runs simultaneously. Switching between rooms SHALL NOT cancel runs in other rooms.

后台 run 的状态（pending_turn indicator、active_run badge）持续通过 SSE 同步到房间列表，用户切换房间时不影响其他房间的 run 执行。

#### Scenario: 后台 run 不被取消

- **WHEN** 房间 A 有正在执行的 run，用户切换到房间 B 并发送消息
- **THEN** 房间 A 的 run 继续执行；房间列表上房间 A 显示活跃指示器

---

### Requirement: 消息操作六项

The system SHALL support the following message actions, accessible from each message's action bar (hover or long-press):

**1. Reply（引用回复）**

点击"Reply"后 InputBox 出现被引用消息的预览条（摘要 + 发送人）；发送时消息携带 `quotedMessageId`；聊天流渲染为引用气泡 + 回复内容。

**2. Quote（引用插入输入框）**

点击"Quote"将消息内容以 `> ` 引用语法插入 InputBox 当前光标位置，用户可继续编辑后发送。

**3. Regenerate（重新生成）**

仅对 Agent 发出的最后一条消息可用。点击后取消当前 pending run（如有），创建新 run 重新生成该消息（保留上下文到该消息之前的状态）。

**4. Copy Code（代码块一键复制）**

所有代码块（`<pre><code>` 或 Markdown 代码围栏）必须渲染带 Copy 按钮；点击后复制到剪贴板，按钮短暂变为"已复制 ✓"。

**5. Apply Diff（一键应用 Diff）**

DiffCard 的操作区必须有"Apply"按钮，调用现有 `POST /artifacts/:id/accept` 流程；同时有"Reject"和"View Details"按钮。

**6. Expand Preview（展开产物全屏）**

ArtifactCard / PreviewCard / DocumentCard / PresentationCard 有"Expand"按钮打开全屏 `ArtifactPreviewModal`；DeploymentCard 有"Open Preview"打开外部 URL 和"View Logs"展开日志面板。

#### Scenario: 代码块 Copy 按钮

- **WHEN** Agent 回复中包含一个代码块
- **THEN** 代码块右上角显示 Copy 按钮；点击后剪贴板包含代码内容；按钮文字变为"Copied ✓" 1.5 秒后恢复

#### Scenario: Regenerate 只对最后一条 Agent 消息可用

- **WHEN** 用户对中间某条 Agent 消息点击操作菜单
- **THEN** Regenerate 选项不可用（置灰或隐藏）

#### Scenario: Reply 显示引用气泡

- **WHEN** 用户 Reply 某条消息并发送
- **THEN** 新消息在聊天流中显示被引用消息的摘要气泡，点击摘要可滚动到原消息

---

### Requirement: Pin 关键消息为长期上下文

The system SHALL allow users to pin messages as persistent context for Agent runs in the room.

`messages.pinned_at` 已存在（`0013_messages_pinned.sql`），V1.2 补充前端操作入口和 context assembly 优先级。

**Pin 操作：**
```
POST   /rooms/:id/messages/:msgId/pin   → messages.pinned_at = now()，并 publish `message.pinned`
DELETE /rooms/:id/messages/:msgId/pin   → messages.pinned_at = NULL，并 publish `message.unpinned`
```

事件 payload：
- `message.pinned`（durable, both）`{ roomId, messageId, pinnedAt }`
- `message.unpinned`（durable, both）`{ roomId, messageId }`

前端主路径通过上述事件 patch Pinned Context drawer；REST response 可作为兜底刷新。

**Context Assembly 优先级（更新后）：**
1. Workspace-scoped pinned ContextItems（现有）
2. Room pinned messages（V1.2 新增，查询 `messages WHERE room_id = ? AND pinned_at IS NOT NULL`）
3. Task-scoped confirmed items（现有）
4. Recent confirmed items（现有）
5. Recent messages（按窗口裁剪）

Pinned messages 不受 context window 裁剪影响，始终注入。  
Pinned artifact 以 `@artifact:<id>` compact ref 注入，不展开全文（避免 token 爆炸）。

**UI：** 消息操作区增加 pin 图标（已置顶的消息显示填充图标）；Pinned Context 抽屉位于聊天区域顶部（默认折叠），点击展开显示当前 pinned 消息列表，支持取消 pin。

#### Scenario: Pinned 消息进入 Agent 上下文

- **WHEN** 用户 pin 了一条包含"API base path is /api/v2"的消息，然后向 Agent 提问
- **THEN** Agent 的 prompt context 中包含该 pinned 消息，Agent 能正确引用该信息

#### Scenario: Pinned Artifact 以 compact ref 注入

- **WHEN** 用户 pin 了一条 PreviewCard 消息（对应一个 10KB 的 HTML artifact）
- **THEN** context assembly 注入 `@artifact:<id>`（compact ref），不注入完整 HTML 内容

#### Scenario: Pin 上限提示

- **WHEN** 房间内 pinned messages 总 token 数超过 800 token（估算）
- **THEN** UI 在 Pinned Context 抽屉中显示警告："已固定内容较多，较早的条目可能被截断"；系统按 `pinned_at DESC` 优先保留最近 pin 的消息

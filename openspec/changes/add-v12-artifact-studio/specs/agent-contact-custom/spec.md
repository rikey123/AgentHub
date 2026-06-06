# agent-contact-custom Specification

## Purpose

实现 Agent 联系人目录（Contact Directory）和对话式创建自建 Agent（InlineAgentEditor），让用户能像 IM 联系人一样发现、管理和创建 Agent，并从联系人直接发起会话。

## ADDED Requirements

### Requirement: Agent Contact Directory

The system SHALL expose a contacts panel in the left sidebar listing all configured `agent_bindings` with avatar, display name, capabilities, and real-time status.

`GET /agents/contacts` 返回：

```typescript
type AgentContact = {
  agentBindingId: string
  displayName: string           // contact_name || role.name
  avatarUrl?: string
  roleId: string
  runtimeKind: string           // 'claude-code' | 'opencode' | 'codex' | ...
  capabilities: string[]
  status: "available" | "busy" | "offline"
  description?: string
  lastUsedAt?: number           // 最近一次 run 的 started_at timestamp
}
```

**status 推导：**
- `"busy"` — 该 binding 有 `runs.status IN ('running', 'queued')` 的 run
- `"offline"` — `GET /runtimes/:id/health` 返回非 200（runtime 不可达）
- `"available"` — 其他情况

**UI：** 左侧 Contacts 面板（可折叠），每个联系人卡片显示：avatar / displayName / runtimeKind chip / capabilities tags（最多显示 3 个，其余折叠）/ status badge（绿色 available / 黄色 busy / 灰色 offline）/ lastUsedAt（"3 天前"）。点击卡片展开详情，详情底部有"Start Chat"按钮。

#### Scenario: Status 实时更新

- **WHEN** 某 Agent binding 的 run 进入 running 状态
- **THEN** 对应联系人卡片的 status badge 变为 busy（通过现有 SSE `agent.state.changed` 事件驱动）

#### Scenario: Offline 标记

- **WHEN** `GET /runtimes/:id/health` 连续 3 次返回非 200
- **THEN** 该 binding 的所有联系人显示为 offline；联系人详情显示"运行时不可达"提示

#### Scenario: 从联系人发起单聊

- **WHEN** 用户点击联系人详情页的"Start Chat"
- **THEN** 创建 `assisted` room，该 Agent binding 作为初始参与者，用户进入该 room

---

### Requirement: 对话式创建自建 Agent（InlineAgentEditor）

The system SHALL allow users to create a custom agent through an inline wizard without leaving the current view.

**触发路径：**
1. Contacts 面板右上角"+ New Agent"按钮
2. Chat InputBox 输入 `/create-agent` slash command

**向导表单（覆盖式，不跳转页面）：**

```typescript
type AgentCreationDraft = {
  name: string              // 必填，3–50 字符
  avatarUrl?: string        // URL 或上传图片（转 base64 存 agent_bindings.avatar_url）
  systemPrompt: string      // 必填
  runtimeId: string         // 从已配置 runtime 列表选择，必填
  modelConfigId?: string    // 可选，不填用 runtime 默认
  skillIds: string[]        // 从 workspace skills 多选
  capabilities: string[]    // 能力标签（自由填写 + 预设常用标签）
  description?: string
}
```

**向导步骤（单页滚动，不分 step）：**
1. 基本信息：name / avatar / description
2. 行为配置：system prompt（Markdown 编辑器，带语法高亮）
3. 运行环境：runtime 选择 / model config 选择
4. 技能与能力：skills 多选 / capabilities 标签

**Test Connection：** "测试连接"按钮调用 `POST /runtimes/:id/health`；成功显示绿色 badge + runtime 版本；失败显示红色 badge + 错误原因。保存前不强制要求连接成功（允许预配置离线 runtime）。

**保存流程：**
1. `POST /agents/custom { ...draft }` — daemon 创建 `roles` 行 + `agent_bindings` 行（写 `contact_name` / `avatar_url` / `contact_description`）。
2. 响应包含 `agentBindingId`。
3. Contacts 面板刷新，新 Agent 出现在列表顶部。
4. Toast 提示"Agent 创建成功"，附"Start Chat"快捷按钮。

**编辑已有 Agent：** 联系人详情页有"Edit"按钮，打开相同向导（预填已有数据），保存后更新 `roles` + `agent_bindings`。

#### Scenario: 成功创建自建 Agent

- **WHEN** 用户填写 name="前端专家" + system prompt + 选择 OpenCode runtime，点击保存
- **THEN** `agent_bindings` 新增一行，`contact_name='前端专家'`；Contacts 面板出现该 Agent；可从联系人发起单聊

#### Scenario: Test Connection 成功

- **WHEN** 用户在向导中点击"测试连接"，选中的 runtime 可达
- **THEN** 按钮旁显示绿色 badge + runtime 版本号（如"Claude Code v1.3.2"）

#### Scenario: Test Connection 失败

- **WHEN** 用户点击"测试连接"，runtime 不可达
- **THEN** 按钮旁显示红色 badge + 错误原因（如"Connection refused"）；用户仍可继续保存（离线预配置场景）

#### Scenario: 名称重复

- **WHEN** 用户输入的 name 与现有 `agent_bindings.contact_name` 重复
- **THEN** 保存时返回 400 `{ error: "agent_name_conflict" }`；向导在 name 字段下方显示"此名称已被使用"

---

### Requirement: Agent 能力标签展示

The system SHALL display each Agent's declared capabilities as tags on the contact card and in room member panels.

能力标签来源：`roles.capabilities`（V1.1 已有 validated token list）。

Contact card 最多显示 3 个 capability chip；多余的折叠为"+ N 更多"，hover 展开全部。

#### Scenario: 能力标签可见

- **WHEN** 用户查看一个声明了 `["code.write", "terminal.run", "web.search"]` 能力的 Agent 联系人
- **THEN** 联系人卡片显示 3 个 capability chip："code.write"、"terminal.run"、"web.search"

---

### Requirement: 通过自然语言预填 Agent 创建向导

The system SHALL parse a natural language description in the chat InputBox and pre-fill the InlineAgentEditor draft when the user invokes `/create-agent` with a description.

**触发语法：** `/create-agent 帮我创建一个前端专家 Agent，用 OpenCode，带 web-page-builder skill`

**解析逻辑（daemon side）：** 提取以下字段作为 draft：
- name hint（如"前端专家 Agent"）
- runtime hint（如"OpenCode" → 匹配 `runtimes` 表中 `kind='opencode'` 的行）
- skill hints（如"web-page-builder" → 匹配 `skills` 表中 `name='web-page-builder'` 的行）
- system prompt draft（如无明确 prompt，留空供用户填写）

**向导预填：** InlineAgentEditor 打开时 name / runtime / skills 字段已预填；system prompt 为空或有提示文字；用户确认 / 修改后保存。

#### Scenario: 通过自然语言创建 Agent 草稿

- **WHEN** 用户输入 `/create-agent 帮我创建一个前端专家 Agent，用 OpenCode，带 web-page-builder skill`
- **THEN** InlineAgentEditor 打开，name 预填"前端专家 Agent"，runtime 预选 OpenCode，skills 预选 web-page-builder
- **AND** 用户填写 system prompt 后点击保存，新 Agent 出现在联系人列表

---

### Requirement: 主流 Runtime 硬验收（Claude Code + OpenCode）

The system SHALL verify that Claude Code and OpenCode runtimes each work end-to-end in V1.2. These two runtimes are the only ones that count toward the "at least 2 mainstream agent platforms" requirement.

**Claude Code 验收条件（全部必须通过）：**
1. 可在 Agent Contact Directory 中显示（status 正确推导）
2. Test Connection 返回 green badge + 版本号
3. 可从联系人发起单聊，run 成功启动
4. run 中 `room.publish_artifact` 产出 web_page artifact，聊天流出现 PreviewCard
5. run 完成后 status 回到 available

**OpenCode 验收条件（同上）：**
1-5 项同 Claude Code

**Codex 验收说明：**
- Codex 在运行时目录 UI 中标注 `"experimental"`
- Codex 不计入"至少 2 个主流平台"的验收
- Codex Test Connection 可以返回 experimental badge（不要求 green）

#### Scenario: Claude Code 单聊 run 成功

- **WHEN** 用户从联系人点击 Claude Code Agent 的"Start Chat"，发送"生成一个简单的 Hello World 网页"
- **THEN** run 成功启动；Agent 产出 web_page artifact；PreviewCard 出现在聊天流；run 完成后 status 回到 available

#### Scenario: OpenCode 单聊 run 成功

- **WHEN** 用户从联系人点击 OpenCode Agent 的"Start Chat"，发送"生成一个 Markdown 文档"
- **THEN** run 成功启动；Agent 产出 document artifact；DocumentCard 出现在聊天流；run 完成后 status 回到 available

#### Scenario: Codex 标注 experimental

- **WHEN** 用户在 runtime 选择器或联系人面板查看 Codex Agent
- **THEN** 显示 `"experimental"` badge；不显示 green available status；Test Connection 返回 experimental 说明

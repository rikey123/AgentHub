# agents Specification

## Purpose

V1.2 为 AgentBinding 增加联系人身份模型，明确 Role / AgentBinding / Contact / Mention / Task Assignee 的关系，避免联系人式 IM 体验破坏现有多-agent 协作体系。

## MODIFIED Requirements

### Requirement: AgentBinding CRUD API

V1.2 SHALL treat contact identity as the presentation layer of `agent_bindings`, not as a separate execution entity.

数据模型分层：
- `Role` = 职责 / 能力 / persona / system prompt
- `Runtime` / `ModelConfig` = 执行环境与模型
- `AgentBinding` = 可运行 agent 实例 = role + runtime + model + permissions/skills
- `Contact` = AgentBinding 的 IM 展示身份（`contact_name` / `avatar_url` / `contact_description` / `status` / `lastUsedAt`）

所有现有 `agent_bindings` 自动生成默认联系人。默认显示名：
```ts
displayName = contact_name || `${role.name} · ${runtime.name}`
```

联系人字段只影响 UI 展示与 `@` autocomplete，不改变 `role.name`、capabilities 或 prompt 职责。

#### Scenario: 联系人改名不影响角色职责

- **WHEN** 用户把某个 binding 的 `contact_name` 从空改成“前端构建者”
- **THEN** UI 显示名变成“前端构建者”
- **AND** 该 binding 仍保留原 `role.name='Builder'` 和同样的 capabilities

---

### Requirement: Agent 注册与发现

The Contacts API SHALL return a presentation-friendly view model while preserving `agent_binding_id` as the stable identity.

```typescript
type AgentContact = {
  agentBindingId: string
  displayName: string
  roleName: string
  runtimeName: string
  modelName?: string
  avatarUrl?: string
  capabilities: string[]
  skills: string[]
  status: "available" | "busy" | "offline"
  lastUsedAt?: number
  isArchived?: boolean
  isDisabled?: boolean
}
```

联系人编辑后的刷新策略：
- 系统 MUST 通过 durable event `agent.contact.updated` 实时 patch Contact Directory、Room participant display、@ autocomplete source
- 历史消息显示名使用发送时的快照，不因联系人后续改名而重写
- Contacts / Members / New Chat picker MAY 在 mutation 成功后再做一次 REST refresh 作为兜底，但事件更新是主路径

#### Scenario: 联系人列表自动来自 agent_bindings

- **WHEN** 系统已有多个 `agent_bindings`
- **THEN** `/agents/contacts` 自动返回对应联系人列表
- **AND** 无需单独创建 Contact 实体

---

### Requirement: AgentProfile 数据模型

The system SHALL support contact-level editing on top of AgentBinding, including both “new role + binding” and “existing role + new binding” creation flows.

InlineAgentEditor 两种创建路径：
1. 创建新 `role` + 新 `agent_binding` + contact profile
2. 基于已有 `role` 创建新的 `agent_binding` + contact profile

联系人删除/禁用契约：
- `agent_bindings.disabled_at` 用于禁用联系人
- 若对应 binding 已被历史 `room_participants` / tasks / messages 引用，MUST NOT hard delete；只能设置 `disabled_at`
- disabled contact 默认不出现在 New Chat 联系人选择器中
- disabled contact 仍可在历史房间成员列表、历史消息 sender label、任务 assignee 中显示
- 若 binding 从未被任何历史实体引用，系统 MAY 允许真正删除

建议 API：
```text
DELETE /agents/contacts/:agentBindingId
- no historical references → hard delete allowed
- has historical references → set disabled_at, return { disabled: true }
```

#### Scenario: 基于已有 role 创建新联系人

- **WHEN** 用户选择已有 `Builder` role，并用 OpenCode runtime 创建一个新联系人
- **THEN** 系统创建新的 `agent_binding`
- **AND** 不创建重复的 `role`

#### Scenario: 历史引用存在时只禁用不硬删

- **WHEN** 用户删除一个已在历史 room 中出现过的联系人
- **THEN** 系统设置 `agent_bindings.disabled_at`
- **AND** 该联系人不再出现在默认联系人选择器中
- **AND** 历史房间和历史消息仍能显示该联系人的显示名快照

---

### Requirement: AgentPresence 状态机

The contact status badge SHALL derive from AgentBinding runtime availability and run activity.

- `available`：无 active runs 且 runtime health-check 通过
- `busy`：存在 `running` / `queued` run
- `offline`：runtime health-check 失败

此状态用于联系人卡、Room member list、New Chat contact picker。

#### Scenario: Busy badge 影响新建对话选择

- **WHEN** 某联系人处于 busy
- **THEN** Contact picker 仍允许选择，但显示 busy badge，提示用户该 agent 正在其他房间执行任务

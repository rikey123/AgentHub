# group-chat-orchestration Specification

## Purpose

补齐群聊 Orchestrator 的可见协调体验：@ 触发可见分派公告、成员短消息 + Artifact Card 分离、Orchestrator 最终汇总、失败降级可见。

## ADDED Requirements

### Requirement: 可见分派公告消息

The system SHALL insert a system-style message into the chat timeline when the Orchestrator delegates a task to a teammate.

`team-dispatch.ts` 在写 task delegation 记录的同一 SQLite 事务中，写一条 `messages` 行：

```typescript
{
  type: "system",
  sender: "orchestrator",
  content: "已将任务「{taskTitle}」分配给 {agentDisplayName}",
  roomId,
  runId,   // leader 的 run ID
}
```

此消息通过现有 `message.created` 事件（durable, main）进入 projector，不需要新的事件类型。UI 渲染为灰色小字的系统提示行（非气泡），视觉上与 Agent 聊天消息区分。

#### Scenario: 分派公告可见

- **WHEN** Orchestrator 将任务"实现登录页"分配给 Builder Agent
- **THEN** 聊天流中出现灰色系统消息："已将任务「实现登录页」分配给 Builder"
- **AND** 不需要用户刷新即可看到

#### Scenario: 并行分派多个任务

- **WHEN** Orchestrator 同时将 3 个任务分配给 3 个 Agent
- **THEN** 聊天流中出现 3 条分派公告，各自对应一个任务和 Agent

---

### Requirement: 成员短消息 + Artifact Card 分离

The system SHALL enforce that long-form Agent output appears as Artifact Cards, not as large chat bubbles.

通过 prompt 层面强化（不增加新后端机制）：

**Orchestrator prompt 和 teammate prompt 均包含以下指令：**
```
After completing a task:
1. Send a short conversational message (1-3 sentences) summarizing what you did.
2. Long content (code, documents, HTML, data) MUST be published via room.publish_artifact
   or room.send_file_message. Do NOT embed large content in chat messages.
3. Reference artifacts with @artifact:<id> in your summary message.
```

这与 V1.1 D17（file-message contract）一致，V1.2 通过更新内置 prompt 模板强化。

**系统侧保障：** `room.send_file_message` MCP tool 已在 V1.1 实现，使用 `message.part.added` 合约插入 Artifact Card。V1.2 不增加新机制，只确保 prompt 模板被更新。

#### Scenario: 长内容走 Artifact Card

- **WHEN** Builder Agent 完成 React 组件，内容约 200 行代码
- **THEN** 聊天流中 Builder 发一条简短消息"已完成 LoginForm 组件，代码如下"+ 一个 ArtifactCard
- **AND** 不出现包含 200 行代码的巨大气泡

#### Scenario: 短回复仍走普通消息

- **WHEN** Reviewer Agent 审查完成，结论是"代码结构清晰，无明显问题"
- **THEN** 聊天流中出现正常的消息气泡，不创建 Artifact

---

### Requirement: Orchestrator 最终汇总

The system SHALL wake the leader to send a synthesis message after all delegated tasks complete.

`team-dispatch.ts` 在最后一个 `task.delegation.completed` 事件触发时，检查该 room 的所有 delegated tasks 是否全部达到终态（`completed` / `blocked` / `review`）。若是，写一个 `wake_outbox` 行：

```typescript
{
  roomId,
  agentId: leaderAgentId,
  reason: "aggregate",
  payload: {
    completedTaskIds: string[],
    artifactIds: string[],          // 所有任务产出的 artifact IDs
    blockedTaskIds: string[],       // blocked 的任务（如有）
  }
}
```

Leader prompt 对 `reason="aggregate"` 的指令：
```
All delegated tasks have reached a terminal state.
Write a brief synthesis message summarizing:
- What was accomplished
- Any blocked tasks (if any)
- Key artifacts produced (reference with @artifact:<id>)
Keep it under 150 words.
```

Leader 的汇总消息通过正常 `message.created` 进入聊天流。

#### Scenario: 所有任务完成后 Leader 汇总

- **WHEN** squad room 中 3 个 teammate 各自完成任务，最后一个 task.delegation.completed 触发
- **THEN** Leader 被唤醒，发出一条汇总消息，包含各任务产出的 artifact 引用

#### Scenario: 有任务 blocked 时汇总仍触发

- **WHEN** 3 个任务中 2 个 completed，1 个 blocked（reason: "missing_context"）
- **THEN** Leader 汇总消息说明 2 个任务已完成，1 个任务被阻塞及原因，建议用户介入

---

### Requirement: 失败降级可见

The system SHALL insert a system message into the chat timeline when a teammate run fails, explaining the reason and fallback decision.

`team-dispatch.ts` 在 teammate run 进入 `failed` 状态时，在同一事务中写一条 system 消息：

```typescript
{
  type: "system",
  sender: "orchestrator",
  content: "{agentDisplayName} 执行失败：{failureReason}。决策：{fallbackDecision}",
  roomId,
}
```

`fallbackDecision` 枚举：
- `"skipped"` — 跳过该任务，继续其他任务
- `"retrying"` — 正在重试（最多 N 次）
- `"awaiting_user"` — 需要用户介入（任务进入 `blocked` 状态）

此消息通过 `message.created` 进入 projector，不需要新事件类型。

#### Scenario: 失败降级可见

- **WHEN** Builder Agent run 失败（超时），Orchestrator 决定跳过该任务
- **THEN** 聊天流出现系统消息："Builder 执行失败：运行超时。决策：已跳过该任务，继续执行其他任务。"
- **AND** 用户无需打开 Run Detail 即可知道发生了什么

#### Scenario: 需要用户介入

- **WHEN** Builder Agent 连续 2 次失败，Orchestrator 无法降级
- **THEN** 聊天流出现系统消息说明需要用户介入；任务进入 `blocked(leader_unavailable)` 状态；Kanban 卡片显示 blocked badge

---

### Requirement: @ 多 Agent 触发群聊

The system SHALL allow users to @mention one or more agents in a message to direct the Orchestrator's attention or force-include specific agents.

`@AgentName` 语法在 InputBox 中触发自动补全（从 room participants 和 agent contacts 列表中搜索）；发送时消息携带 `mentions: AgentBindingId[]`。

Orchestrator prompt 对 mentions 的处理指令：
```
If the user @mentions specific agents, prioritize delegating to those agents for this task.
If @all is used, involve all room participants.
```

#### Scenario: @ 指定 Agent

- **WHEN** 用户发送"@Builder 帮我优化这个函数的性能"
- **THEN** Orchestrator 优先将该任务分配给 Builder Agent；分派公告中显示"已将任务分配给 Builder（@指定）"

#### Scenario: @ 自动补全

- **WHEN** 用户在 InputBox 输入 "@B"
- **THEN** 显示下拉列表，包含名称以 B 开头的 room participants（如 "Builder", "Backend"）

---

### Requirement: 群聊 Orchestrator E2E 验收

The system SHALL satisfy the following end-to-end group chat orchestration scenario without requiring a page refresh at any step.

#### Scenario: 群聊 Orchestrator 完整端到端流程

- **WHEN** 用户在 squad room 发送任务描述并 @ 两个 Agent（Builder 和 Reviewer）
- **THEN** Orchestrator 接收任务，聊天流出现两条分派公告（分别对应 Builder 和 Reviewer）
- **AND** Builder 完成任务后，聊天流出现一条简短会话消息 + 一个 Artifact Card（不是巨大代码气泡）
- **AND** Reviewer 失败后，聊天流出现失败降级系统消息，说明原因和决策
- **AND** Orchestrator 检测到所有任务终态后，发出汇总消息并引用 Builder 产出的 Artifact
- **AND** 全程用户不需要刷新页面，所有状态更新实时可见（SSE projector 驱动）

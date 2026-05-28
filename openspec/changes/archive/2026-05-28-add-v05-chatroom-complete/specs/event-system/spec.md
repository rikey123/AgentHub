# event-system (V0.5 delta)

## MODIFIED Requirements

### Requirement: 事件分级（durable / ephemeral）

The canonical event registry SHALL be extended with the following V0.5 event types. All new types MUST be registered in `packages/protocol/src/events/registry.ts` and validated by `events:check` / `visibility:check` CI.

**V0.5 新增 durable events**：

| 事件类型 | category | durability | visibility | 备注 |
|---|---|---|---|---|
| `agent.profile.removed` | agent | durable | detail | AgentProfile 文件被删除（chokidar unlink）|
| `mailbox.delivery.failed` | mailbox | durable | both | mailbox 投递失败（claim_conflict / max_retries / target_unavailable）|

**V0.5 新增 ephemeral events**：

| 事件类型 | category | durability | visibility | 备注 |
|---|---|---|---|---|
| `agent.profile.error` | agent | ephemeral | detail | AgentProfile 文件解析失败（gray-matter 异常 / 缺字段）|
| `artifact.diff.detected` | artifact | ephemeral | detail | PostToolUse 写文件前置标记（不创建 artifact 行，仅供 Run Detail FS Changes tab 实时显示）|

**说明**：

- `agent.profile.removed` 与 `agent.profile.error` 补全 MVP 已有的 `agent.profile.loaded` / `agent.profile.updated` 事件族；
- `mailbox.delivery.failed` 是 V0.5 新增的 mailbox 失败可见性事件（详见 `messaging/mailbox.delivery.failed 失败可见性事件`）；
- `artifact.diff.detected` 与 `artifact.diff.created`（ArtifactManager 创建真实 DiffArtifact，durable）**语义不同**，不可混用（详见 `adapter-framework/ClaudeCodeAdapter 事件映射`）。

#### Scenario: events:check 校验新事件类型

- **WHEN** 开发者在代码中 emit `mailbox.delivery.failed` 或 `artifact.diff.detected`
- **THEN** `pnpm events:check` 通过（事件类型已在 registry 注册）
- **AND** `pnpm visibility:check` 通过（visibility 字段与 registry 一致）

#### Scenario: agent.profile.removed 触发

- **WHEN** 用户删除 `~/.agenthub/agents/security.md`（chokidar unlink）
- **THEN** daemon emit `agent.profile.removed { agentId: "security", workspaceId: null }`（durable, visibility=detail）
- **AND** `agent_profiles` 行标 `hidden=1`（如有 active Run 引用）或直接删除

#### Scenario: artifact.diff.detected 不进主流

- **WHEN** ClaudeCodeAdapter PostToolUse 写文件，emit `artifact.diff.detected`
- **THEN** SSE `?view=main` 不收到该事件（visibility=detail）
- **AND** SSE `?view=detail&runId=<id>` 收到该事件，Run Detail FS Changes tab 实时更新

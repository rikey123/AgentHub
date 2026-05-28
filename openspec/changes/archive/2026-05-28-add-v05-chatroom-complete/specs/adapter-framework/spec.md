# adapter-framework (V0.5 delta)

## ADDED Requirements

### Requirement: OpenCodeACPAdapter 真实现

The system SHALL implement `OpenCodeACPAdapter` as a real adapter (no longer stub) deriving from `ACPAdapter` base class in `packages/adapters/acp-base`. The adapter SHALL only override `spawnArgs() / detect() / mapProviderEvent() / mapProviderError()`; state machine, pending request table, line-splitter buffer, cancel/dispose, supervision, liveness ping, and `wrapExternalContent` integration SHALL be inherited from the base class with no copies.

The adapter manifest SHALL declare:

```ts
{
  id: "opencode",
  runtimeKind: "acp",
  capabilities: {
    canStreamTokens: true,
    canEmitToolEvents: true,
    canEmitPermissionEvents: true,
    canEmitSubagentEvents: true,           // OpenCode supports subagents
    canInjectAtStart: true,
    canInjectNextTurn: true,
    canInjectRuntime: true,
    canCancel: true,
    supportsMcp: true,
    supportsHooks: true,
    supportsWorkspaceIsolation: true
  },
  reliability: {
    level: "structured",                    // ACP native event stream
    eventSource: "native_event_stream",
    crashRecovery: "resumable",             // SHALL implement attachSession
    parseFailure: "skip_event"
  },
  context: {
    startupInjection: true,
    runtimeInjection: true,
    injectionMode: "immediate"              // same tier as ClaudeCodeAdapter
  },
  workspace: { mode: "worktree" }
}
```

`crashRecovery: "resumable"` MUST come with `attachSession()` implementation (CI manifest consistency check enforces this).

#### Scenario: detect 在已装 OpenCode CLI 时找到 binary

- **WHEN** 用户机器已安装 OpenCode CLI（PATH 中可执行）
- **THEN** `OpenCodeACPAdapter.detect()` 返回 `[{ id: "opencode", binary: "<path>", version: "<x.y.z>" }]`
- **AND** AdapterRegistry 注册该 adapter 到 AdapterManager

#### Scenario: detect 在未装 OpenCode 时返回空

- **WHEN** 用户机器没装 OpenCode CLI
- **THEN** `detect()` 返回 `[]`
- **AND** daemon 启动正常（不阻断）
- **AND** 用户在 builder-opencode profile 下创建 Run 时返回 `{ error: "opencode_not_installed", helpUrl: "<install link>" }`

#### Scenario: startRun 串接 ACPAdapter 基类

- **WHEN** AdapterManager 调用 `OpenCodeACPAdapter.startRun(input)`
- **THEN** 基类 `ACPAdapter.startRun()` 被调用
- **AND** spawnArgs 来自 `OpenCodeACPAdapter.spawnArgs(input)`（含 OpenCode 特有 CLI flags）
- **AND** mapProviderEvent 把 OpenCode native events 映射成 `AcpProviderEvent`
- **AND** AdapterBridge 收到统一的 `AdapterEvent` 流（与 ClaudeCodeAdapter 一致）

#### Scenario: attachSession 让 ReclaimStaleClaimedRun 可以恢复

- **WHEN** daemon 在 `running + sessionId + pid_at_start != 当前 pid` 时崩溃重启
- **AND** ReclaimStaleClaimedRun 扫到该 stuck run
- **THEN** 调 `OpenCodeACPAdapter.attachSession({ runId, adapterSessionId })`
- **AND** 基类把 sessionId 重新挂回 ACP supervision，不需要重启 OpenCode 子进程
- **AND** Run 继续走 markRunning + updateSessionState 路径

#### Scenario: cancel 协作式生效

- **WHEN** 用户在 Run 跑期间触发 CancelRun
- **THEN** 基类 `session/cancel` 协作式取消，仅 reject inflight prompt
- **AND** mapProviderError 把 OpenCode 取消信号映射成 `AdapterError("user_cancelled")`
- **AND** RunLifecycleService.markCancelling → cancelFinalized 同事务发 `agent.run.cancelled`

## MODIFIED Requirements

### Requirement: Post-MVP Adapter Stub（接口存在但 detect 返回空）

The system SHALL include stub implementations of `CodexAdapter`、`LangGraphAdapter`、`A2AAdapter` whose `detect()` returns `[]` and whose `startRun()` rejects with `AdapterNotImplemented`. **`OpenCodeAdapter` is no longer a stub as of V0.5** — see `OpenCodeACPAdapter 真实现` Requirement.

各 stub 的目标启用阶段（与 `v1-roadmap` 对齐）：

| Stub | 启用阶段 | 备注 |
|---|---|---|
| `CodexAdapter` | V1.x（具体子阶段视需求） | 半结构化事件，需在主路径稳定后再做 |
| `LangGraphAdapter` | V1.3 | Python AI worker，依赖 plugin-system 隔离基座 |
| `A2AAdapter`（即 `RemoteA2AAdapter`） | V1.3 | A2A Client 把外部 agent 装进 Room |

#### Scenario: 创建 Codex adapter 的 Run 拒绝

- **WHEN** 用户尝试用 CodexAdapter 启动 run
- **THEN** 返回 501 + `{ error: "CodexAdapter is V1.x (post V1.0)", capability: "adapter-framework" }`

#### Scenario: 创建 LangGraph / A2A adapter 的 Run 拒绝

- **WHEN** 用户尝试用 LangGraphAdapter 或 A2AAdapter 启动 run
- **THEN** 返回 501 + `{ error: "<Adapter> is V1.3; depends on plugin-system isolation infrastructure", capability: "adapter-framework" }`

#### Scenario: 创建 OpenCode adapter 的 Run 走真实现路径

- **WHEN** 用户用 OpenCodeAdapter 启动 run
- **THEN** **不**返回 501，而是走 `OpenCodeACPAdapter 真实现` 路径

### Requirement: ClaudeCodeAdapter 事件映射

The ClaudeCodeAdapter SHALL emit `AdapterEvent`s mapped from Claude Code provider events. V0.5 补齐 V0 PARTIAL/MISSING 的三个 hook 路径。

事件映射表（V0.5 完整版）：

| Provider event | AdapterEvent | 备注 |
|---|---|---|
| `prompt_started` | `prompt.started` | 与 V0 一致 |
| `tool/pre_use` | `tool.call.requested` + `permission.requested`（如需） | V0 已有 |
| `tool/post_use` | `tool.call.completed` + `file.changed`（如写文件）+ `artifact.diff.detected`（如写产生 diff，**V0.5 新增**） | V0 PostToolUse → file.changed 已有；`artifact.diff.detected` 是 V0.5 新增的**前置标记事件**，与 `artifact.diff.created`（ArtifactManager 创建真实 DiffArtifact）**语义不同**，不可混用 |
| `pre_compact` | `context.snapshot { snapshot: { kind: "claude_compact", text } }`（**V0.5 新增**） | V0 缺；V0.5 接入后 ContextLedger propose 一条 summary draft |
| `subagent_start` | `subagent.started`（**V0.5 新增**） | V0 缺；visibility=detail |
| `subagent_stop` | `subagent.completed`（**V0.5 新增**） | V0 缺；visibility=detail；含 cost / duration |
| `message_part_delta` | `message.part.delta` | 与 V0 一致 |
| `session_end` | `session.ended { reason, cost }` | 与 V0 一致 |

`pre_compact` 触发时 idempotencyKey = `claude_compact:<runId>` 防重复 propose。

`artifact.diff.detected`（V0.5 新增 ephemeral 事件，visibility=detail）在 PostToolUse 路径上是**前置标记**，与 `artifact.diff.created`（ArtifactManager 创建真实 DiffArtifact，durable）**语义不同**，不可混用。前置标记仅让 Run Detail FS Changes tab 在 Run 进行中实时显示"这次写过 X 文件"；不创建 artifact 行，不进主流 DiffCard。Run 终结时 `buildRunArtifact()` 仍是 DiffArtifact 的唯一权威来源，发 `artifact.diff.created`。

#### Scenario: PostToolUse 写文件触发 artifact.diff.detected marker

- **WHEN** Claude Code 调用 Write tool 写 `src/foo.ts`
- **THEN** AdapterBridge emit `tool.call.completed` + `file.changed { path: "src/foo.ts" }` + `artifact.diff.detected { runId, path: "src/foo.ts" }`（ephemeral, visibility=detail）
- **AND** Run Detail FS Changes tab 实时显示该文件
- **AND** 主流不出现 DiffCard（DiffCard 只在 `artifact.diff.created` 时出现）
- **AND** Run 终结时 `buildRunArtifact()` 仍生成最终 DiffArtifact（含完整 before/after），发 `artifact.diff.created`

#### Scenario: PreCompact 触发 ContextItem.summary draft

- **WHEN** Claude Code 内部触发 PreCompact hook
- **THEN** AdapterBridge emit `context.snapshot { kind: "claude_compact", text }` + idempotencyKey=`claude_compact:<runId>`
- **AND** ContextLedger 收到事件，调 `propose(workspaceId, { type: "summary", content: text, source: { kind: "tool", id: "claude_code_compact" } })`
- **AND** ContextItem `status="draft"`，UI 在 Context view 显示"Run XXX 的会话已压缩，可确认摘要"
- **AND** 同 runId 重复 PreCompact 不重复 propose（按 idempotencyKey 命中已有 draft）

#### Scenario: SubagentStart / SubagentStop 转 durable event

- **WHEN** Claude Code spawn 一个 subagent
- **THEN** AdapterBridge emit `subagent.started { runId, subagentId, role }`（durable, visibility=detail）
- **AND** subagent 完成时 emit `subagent.completed { runId, subagentId, cost, duration }`（durable, visibility=detail）
- **AND** Run Detail Tools tab 显示 subagent 时间轴
- **AND** Cost 累加到父 Run 的 cost 字段

#### Scenario: 真 Claude 集成测试覆盖单 Run 闭环

- **WHEN** 实际 spawn `claude` 子进程跑一个含 Read + Write + Bash tool 的 Run
- **THEN** 集成测试断言 ① permission.requested 触发 ② 用户 allow 后 tool.call.completed ③ Diff 成功 apply（status=applied）④ 中途 cancel 走 markCancelling → cancelFinalized
- **AND** 测试在 CI 标 `@integration:claude-code`，本地有 `claude` 时启用，无则 skip

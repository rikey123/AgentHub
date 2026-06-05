# adapter-framework Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: AgentRuntimeAdapter 接口

The system SHALL define the canonical `AgentRuntimeAdapter` interface that every adapter must implement.

```ts
type AgentRuntimeKind =
  | "native_sdk" | "cli" | "server" | "mcp" | "acp" | "a2a" | "langgraph"

interface AgentRuntimeAdapter {
  readonly id: string                     // adapter 实例 id
  readonly name: string
  readonly kind: AgentRuntimeKind
  readonly manifest: AgentAdapterManifest

  /** 检测当前环境是否可用（如 claude binary 是否存在） */
  detect(): Effect.Effect<DetectedRuntime[], AdapterError>

  /** 创建外部 session */
  createSession(input: CreateSessionInput): Effect.Effect<ExternalSession, AdapterError>

  /** 启动一次 Run，返回 AdapterEvent stream */
  startRun(input: StartRunInput): Stream.Stream<AdapterEvent, AdapterError>

  /** 向已有 session 追加消息（多轮） */
  sendMessage(sessionId: string, message: AdapterMessage): Effect.Effect<void, AdapterError>

  /** 取消 Run */
  cancelRun(runId: string): Effect.Effect<void, AdapterError>

  /** 注入 context patch（按 manifest.injectionMode 决定时机） */
  injectContext(
    sessionId: string,
    patch: ContextProjection,
  ): Effect.Effect<ContextInjectionResult, AdapterError>

  /** 读取外部 session 当前 context（用于快照 / 同步），可选 */
  readSnapshot?(sessionId: string): Effect.Effect<ExternalContextSnapshot, AdapterError>

  /**
   * 恢复一个先前持久化的 adapter session（崩溃恢复 / daemon 重启）。
   * 仅当 manifest.reliability.crashRecovery='resumable' 且 manifest.capabilities.canRestoreSession=true 时 MUST 实现。
   * 详见 `bus-runtime/ReclaimStaleClaimedRun 后台任务`。
   */
  attachSession?(input: AttachSessionInput): Effect.Effect<ExternalSession, AdapterError>

  /** 释放 session */
  dispose(sessionId: string): Effect.Effect<void, AdapterError>
}

type AttachSessionInput = {
  runId: string
  adapterSessionId: string
  workDir?: string
  providerConversationId?: string
}
```

**Manifest 一致性约束**（CI `bun run subscriptions:check` 同时校验）：

- `reliability.crashRecovery === "resumable"` MUST `capabilities.canRestoreSession === true` AND adapter 实例 MUST 实现 `attachSession`。
- `reliability.crashRecovery === "restartable"` 或 `"fail_run"`：`canRestoreSession` 应为 `false`；`attachSession` 可省略。
- 三者中任一不一致 → adapter 注册时抛 `AdapterManifestError`，daemon 启动失败。
```

```ts
type AdapterEvent =
  | { type: "session.opened"; sessionId: string }
  | { type: "message.delta"; messageId: string; delta: string }
  | { type: "message.completed"; messageId: string; text: string }
  | { type: "tool.call.requested"; toolCallId: string; name: string; input: unknown }
  | { type: "tool.call.completed"; toolCallId: string; output: unknown; ok: boolean }
  | { type: "permission.requested"; permissionId: string; resource: PermissionResource; reason?: string }
  | { type: "subagent.started"; subRunId: string; profileRef: string }
  | { type: "subagent.completed"; subRunId: string }
  | { type: "file.changed"; path: string; change: "added" | "modified" | "deleted" }
  | { type: "context.snapshot"; snapshot: ExternalContextSnapshot }
  | { type: "raw.stdout"; line: string }
  | { type: "raw.stderr"; line: string }
  | { type: "session.ended"; sessionId: string; reason: string }
  | { type: "session.crashed"; sessionId: string; error: string }
```

#### Scenario: Adapter 注册到 Manager

- **WHEN** daemon 启动加载 `packages/adapters/mock`
- **THEN** AdapterManager 调 `mockAdapter.detect()`，若返回非空 runtime 数组则注册到 manager；写 `adapter.session.created` 占位事件（或专用 `adapter.registered`，见 events 列表扩展）

#### Scenario: 不可用的 Adapter 不阻断启动

- **WHEN** ClaudeCodeAdapter `detect()` 返回空（用户未装 claude）
- **THEN** AdapterManager 标记其 `unavailable`，不抛错；UI 在 Agent 详情页显示"未检测到 Claude Code 安装"

### Requirement: AgentAdapterManifest（能力声明）

The system SHALL require every adapter to declare its full manifest at registration time, including capabilities, reliability, context injection mode, and workspace mode.

```ts
type AgentAdapterManifest = {
  id: string
  name: string
  runtimeKind: AgentRuntimeKind
  provider: "claude-code" | "codex" | "opencode" | "aion" | "langgraph" | "custom" | "mock"
  capabilities: {
    canStreamTokens: boolean
    canEmitToolEvents: boolean
    canEmitPermissionEvents: boolean
    canEmitSubagentEvents: boolean
    canInjectAtStart: boolean
    canInjectNextTurn: boolean
    canInjectRuntime: boolean
    canCancel: boolean
    canReadContextSnapshot: boolean
    canRestoreSession: boolean
    supportsMcp: boolean
    supportsHooks: boolean
    supportsWorkspaceIsolation: boolean
  }
  reliability: {
    level: "structured" | "semi_structured" | "scraped" | "manual"
    eventSource:
      | "native_event_stream"
      | "hooks"
      | "json_stdout"
      | "stdout_scraping"
      | "filesystem_polling"
    crashRecovery: "resumable" | "restartable" | "fail_run"
    parseFailure: "skip_event" | "degrade_to_text" | "fail_run" | "ask_user"
    maxRestartAttempts: number             // 默认 3
  }
  context: {
    startupInjection: boolean
    runtimeInjection: boolean
    injectionMode: "immediate" | "next_turn" | "next_session"
    canPullExternalContext: boolean
    canPushLedgerUpdates: boolean
  }
  workspace: {
    mode: "shared" | "isolated_copy" | "worktree" | "external"
  }
}
```

预填的 MVP 三个 manifest：

| 字段 | mock | claude-code | codex（预留） |
|---|---|---|---|
| reliability.level | structured | structured | semi_structured |
| canEmitPermissionEvents | true | true | false |
| canEmitSubagentEvents | true | true | false |
| canInjectRuntime | true | true | false |
| canInjectNextTurn | true | true | true |
| canInjectAtStart | true | true | true |
| supportsMcp | true | true | false |
| supportsHooks | true | true | false |
| injectionMode | immediate | immediate | next_turn |
| workspace.mode | external | worktree | isolated_copy |

#### Scenario: 注入能力为 next_turn 时 UI 提示

- **WHEN** 用户在 Codex 主导的 Room 提交一个上下文 patch，adapter manifest 显示 `injectionMode: "next_turn"`
- **THEN** UI 顶部显示提示："这条上下文已写入 AgentHub，但 Codex 当前 session 需下一轮才会看到"

#### Scenario: 不能 emit permission events 的 adapter 自动降级

- **WHEN** Codex adapter（`canEmitPermissionEvents: false`）的 Run 中 Agent 想跑 shell
- **THEN** AdapterManager 在 spawn 子进程前用本地 PermissionEngine 二次校验（基于配置的 PermissionProfile），不依赖 adapter 内部审批

### Requirement: MockAgentAdapter

The system SHALL ship a built-in `MockAgentAdapter` capable of replaying scripted scenarios for testing every other capability without external dependencies.

DSL（D21 推荐方案）：

```ts
type MockAgentScript = {
  id: string
  steps: Array<
    | { type: "say"; text: string; delayMs?: number }
    | { type: "tool"; name: string; input: unknown; resultDelayMs?: number; output?: unknown }
    | { type: "diff"; files: { path: string; patch: string }[] }
    | { type: "request_permission"; resource: PermissionResource; expect: "allow" | "deny" | "any" }
    | { type: "request_intervention"; reason: string; priority: "low" | "medium" | "high" }
    | { type: "fail"; error: string }
    | { type: "wait"; ms: number }
  >
}
```

#### Scenario: 用 Mock 跑完整介入闭环

- **WHEN** 测试加载脚本 `[say "let me edit auth.ts", request_intervention "found risky pattern", say "applying suggested fix"]`
- **THEN** 客户端按序收到 `message.created`、`intervention.requested`（卡片显示 4 actions）、用户 approve → Mock 收到注入文本 → 后续 `say` 反映介入结果

#### Scenario: Mock 验证 permission 流

- **WHEN** 脚本含 `request_permission { resource: { type: "shell", command: "rm -rf /tmp/test" }, expect: "deny" }`
- **THEN** Mock 触发 `permission.requested`，Permission Engine 按配置弹卡 / 直接 deny；Mock 校验实际结果与 `expect` 一致，否则 `fail`

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

### Requirement: 子进程隔离与 Crash Tombstone

The system SHALL spawn every external adapter process in an isolated workspace and persist crash tombstones to recover gracefully.

策略：

- Workspace 模式：
  - `worktree`（git 项目）：daemon 用 `simple-git` 创建 git worktree
  - `isolated_copy`：复制项目 root 到 `<userhome>/.agenthub/runs/<runId>/`（小项目）
  - `shared`：直接共享 workspace（仅 Mock / 用户显式开启）
  - `external`：adapter 自管 workspace
- Heartbeat：daemon 每 3 秒 poll adapter alive，每 15 秒 expect 一个 heartbeat；超时即视为崩溃。
- Tombstone：`adapter.crashed` durable 事件含 reason、exitCode、stderr 最后 1 KB；写完后按 `maxRestartAttempts` 重启。
- 重启失败：所有相关 Agent 转 `blocked`，UI 显示重启失败原因。

#### Scenario: Adapter 子进程异常退出

- **WHEN** ClaudeCode 子进程 OOM 退出，adapter 接到 SIGCHLD
- **THEN** daemon 写 `adapter.crashed { adapterId, reason: "OOM", exitCode: 137 }`，按 `maxRestartAttempts=3` 重启；每次重启发 `adapter.session.created` 新事件

#### Scenario: 超过 maxRestartAttempts 后 Agent blocked

- **WHEN** 重启 3 次仍失败
- **THEN** 所有该 Adapter 服务的 Agent 状态转 `blocked`，发 `agent.state.changed`；UI Agent 列表显示红点 + "Adapter 重启失败"

### Requirement: Adapter 参数层级（args）

The system SHALL resolve adapter args by priority: adapter default < workspace runtime policy < agent profile args < run-specific args.

```ts
type AdapterArgs = Record<string, unknown>

function resolveArgs(
  defaultArgs: AdapterArgs,
  workspacePolicy: AdapterArgs,
  profileArgs: AdapterArgs,
  runArgs: AdapterArgs,
): AdapterArgs {
  return { ...defaultArgs, ...workspacePolicy, ...profileArgs, ...runArgs }
}
```

#### Scenario: Workspace policy 覆盖 default

- **WHEN** ClaudeCodeAdapter default 是 `{ model: "claude-sonnet-4-6", maxTokens: 8000 }`，workspace policy 是 `{ maxTokens: 16000 }`
- **THEN** 实际使用 `{ model: "claude-sonnet-4-6", maxTokens: 16000 }`

#### Scenario: Run-specific 覆盖一切

- **WHEN** 用户 `POST /agents/:id/run` 显式传 `{ args: { model: "claude-opus-4-7" } }`
- **THEN** Run 用 opus 模型，不写回 profile

### Requirement: Post-MVP Adapter Stub（接口存在但 detect 返回空）

The system SHALL update the stub table to reflect that `OpenCodeAdapter` is now a real implementation (V0.5) and `NativeAgentAdapter` is a new real implementation (V1.0).

| Stub | 启用阶段 | 备注 |
|---|---|---|
| `CodexAdapter` | V1.x（具体子阶段视需求） | 半结构化事件，需在主路径稳定后再做 |
| `LangGraphAdapter` | V1.3 | Python AI worker，依赖 plugin-system 隔离基座 |
| `A2AAdapter`（即 `RemoteA2AAdapter`） | V1.3 | A2A Client 把外部 agent 装进 Room |

`OpenCodeAdapter`（V0.5 已实现）和 `NativeAgentAdapter`（V1.0 已实现）不再是 stub。

#### Scenario: NativeAgentAdapter 不返回 501

- **WHEN** 用户用 native runtime 创建 AgentBinding 并启动 Run
- **THEN** NativeAgentAdapter 正常启动（V1.0 已实现）；**不**返回 501

#### Scenario: CodexAdapter 仍返回 501

- **WHEN** 用户尝试用 CodexAdapter 启动 run
- **THEN** 返回 501 + `{ error: "CodexAdapter is V1.x (post V1.0)", capability: "adapter-framework" }`

### Requirement: Cost 字段上报

Each adapter SHALL emit a completion-class `AdapterEvent`（例如 `{ type: "session.ended"; reason: "completed"; cost?: Cost }` 或运行时定义的等价 event）carrying token usage when the run terminates normally. AdapterBridge SHALL translate it by calling `RunLifecycleService.complete(null, runId, cost)` — service will emit the durable `agent.run.completed` with the full `cost` payload. Adapters MUST NOT emit `agent.run.*` durable events directly.

If the adapter cannot determine token usage, the fields SHALL be reported as `0` and `costUsd: 0` (not undefined). Cost shape:

```ts
type Cost = {
  inputTokens: number       // 0 when unknown, never undefined
  outputTokens: number
  cachedTokens: number
  costUsd: number           // 0 when unknown
  modelId: string           // 'mock' / 'claude-sonnet-4-6' / ...
}
```

#### Scenario: Mock adapter 上报 0 cost

- **WHEN** Mock 完成一次 run
- **THEN** Mock adapter 在 AdapterEvent 中携带 `cost: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId: "mock" }`；AdapterBridge 调 `RunLifecycleService.complete(null, runId, cost)`；最终落库的 `agent.run.completed` 事件 payload 含完整 cost

#### Scenario: Adapter 不直接发 durable run event

- **WHEN** 任意 Adapter 实现尝试通过 `eventBus.publish({ type: "agent.run.completed", ... })` 直接发 durable event
- **THEN** ESLint 自定义规则 / 运行时 schema check 拒绝；AdapterBridge 是唯一通往 RunLifecycleService 的桥梁；CI 校验 `packages/adapters/*` 不引用 `agent.run.*` 字面量类型

### Requirement: ACPAdapter 会话状态机与 JSON-RPC pending 表

The system SHALL implement a generic `ACPAdapter` (`runtimeKind="acp"`) as a first-class integration path for any agent runtime that speaks Agent Client Protocol over stdio (NDJSON JSON-RPC). ACPAdapter MUST maintain an explicit per-session state machine and an explicit pending-request table; transport, prompt concurrency, cancel, and dispose semantics SHALL be fixed at the spec level so all ACP-provider-specific subclasses (ClaudeCodeACPAdapter / CodexACPAdapter / OpenCodeACPAdapter) inherit identical guarantees.

```
   disconnected ──connect──► connecting ──handshake──► initializing
                                  │                         │
                                  ▼                         ▼
                                failed ◄────error──── ready ◄──── prompt ended
                                                       │
                                                       │ session/prompt
                                                       ▼
                                                   prompting
                                                       │
                                          session/cancel│ (in-flight prompt)
                                                       ▼
                                                  cancelling
                                                       │
                                                  prompt actually ended
                                                       ▼
                                                     ready
                                                       │
                                                  dispose / kill
                                                       ▼
                                                   disposed
```

```ts
type AcpSessionState =
  | "disconnected" | "connecting" | "initializing"
  | "ready" | "prompting" | "cancelling" | "failed" | "disposed"

interface AcpAdapterSession {
  state: AcpSessionState
  acpSessionId: string
  workDir: string
  pendingRequests: Map<string, AcpPendingRequest>      // requestId → entry
  inflightPromptRequestId?: string                     // 当前 prompting 的 RPC requestId
  clientCapabilities: AcpClientCapabilities            // 见下文 P1-2 / P3-1
}

interface AcpPendingRequest {
  requestId: string
  method: string
  startedAt: number
  timeoutMs: number
  resolve: (result: unknown) => void
  reject: (err: AdapterError) => void
}
```

**强制约束**：

1. **Transport**：每个 ACP 子进程通信 MUST 是 NDJSON over stdin/stdout（一行一个完整 JSON-RPC 2.0 消息）；adapter 维护 line-splitter buffer 容忍跨 read 帧的部分行；非 JSON 行（debug 输出 / banner）按 `raw.stderr` 处理但 MUST NOT 进入 JSON-RPC 解析路径。
2. **Prompt 并发**：默认每个 ACP session 同时 **只允许一个 prompt in-flight**（`prompting` 状态互斥）；试图在 `prompting` 状态发起第二个 prompt MUST 返回 `AdapterError(code="prompt_in_flight")`，由上层 RunQueue 序列化（这与 `bus-runtime/run_locks` 中 agent 锁互补）。Manifest 可声明 `acp.concurrentPrompt=true` 但 MVP 内置 adapter 全部禁用。
3. **Cancel 与 Dispose 必须分离**：
   - `session/cancel` JSON-RPC 调用是**协作式**取消当前 prompt，session 仍存活、`acpSessionId` 不变、`pendingRequests` 中**非** prompt 类的 entry（fs.readTextFile、fs.writeTextFile、permission 等 client→server inbound）MUST 不被清空；状态从 `prompting` → `cancelling` → adapter 报告 prompt 真正结束后回 `ready`。
   - `dispose(sessionId)` 才是终结子进程：先尝试发 ACP `session/end`，若 5 秒未优雅结束则 SIGTERM，再 5 秒 SIGKILL；`pendingRequests` 全量 reject `AdapterError(code="session_disposed")`；状态走到 `disposed` 后 MUST NOT 复用。
4. **Pending request 生命周期**：每个出站 / 入站 JSON-RPC request MUST 入 `pendingRequests`；收到匹配 `id` 的 response 时 resolve 并移除；超时（默认 60s，可由 manifest 覆盖）→ reject `AdapterError(code="rpc_timeout")` 并继续移除（不重发，由调用方决定重试）。Cancel 阶段 MUST 仅 reject `inflightPromptRequestId` 对应 entry，不能整表清空。
5. **clientCapabilities 在 initialize 阶段一次声明**：默认值见 [P1-2 ArtifactFS]；MVP 内置 ACPAdapter MUST 声明 `fs.readTextFile=true`、`fs.writeTextFile=true`（实际转 ArtifactFS）、`terminal=false`（V1）、`permission.request=true`。
6. **Provider-specific 派生**：`ClaudeCodeACPAdapter` / `CodexACPAdapter` / `OpenCodeACPAdapter` MUST 继承 ACPAdapter 的状态机与 pending 表，不得各自实现一份；只允许覆盖 `spawnArgs()`、`detect()`、`mapProviderEvent()`、`mapProviderError()`。

#### Scenario: cancel 不清空非 prompt pending

- **WHEN** ACP session 处于 `prompting`，pendingRequests 含 `req_p1` (prompt) + `req_fs1` (server→client inbound `fs.writeTextFile`)；用户 `POST /runs/:id/cancel`
- **THEN** adapter 发 `session/cancel { sessionId }`、状态 → `cancelling`、`req_p1` 在 prompt 真正结束时 reject `AdapterError(code="cancelled")`；`req_fs1` 不被 reject（仍会被 ArtifactFS 正常 resolve 或自然 timeout）；状态最终回 `ready`，session 仍可复用

#### Scenario: dispose 强 kill 兜底

- **WHEN** dispose(sessionId) 调用后 5 秒内 ACP 子进程未自行退出
- **THEN** adapter SIGTERM；再 5 秒未退出 SIGKILL；pendingRequests 全部 reject `AdapterError(code="session_disposed")`；发 `adapter.session.disposed` durable 事件 payload `{ adapterSessionId, force: true }`

#### Scenario: prompt 并发被序列化

- **WHEN** 一个 ACP session 已在 `prompting`，AdapterBridge 试图再发 prompt（不应发生，但作为最后一道闸）
- **THEN** adapter 立即返回 `AdapterError(code="prompt_in_flight")`；不入 pending 表；上层 RunQueue 已经在 agent 锁上拦住了，这个 error 只作为防御（写 `handler.stalled { handler: "acp", reason: "prompt_in_flight" }` 让用户感知）

### Requirement: Adapter 事件去重 + Shell 哈希节流 + Raw Output 分流

The system SHALL implement event deduplication and throttling at AdapterBridge before translating `AdapterEvent` into durable / ephemeral domain events. Tool start/update events SHALL be deduplicated by composite key; shell stdout / pseudo-tty output SHALL be hash-throttled; oversized raw output SHALL be diverted to per-session log file or attachment, never carried in durable event payload.

**Tool 事件去重**：

- 复合键 = `(adapterSessionId, toolCallId, phase)`，phase ∈ {`requested`, `started`, `update`, `completed`}。
- 同一复合键的事件只允许 emit 一次；后续 emit 必须丢弃并写 debug log；`update` phase 例外但需按下一条 hash 节流。
- 解决 opencode 中观察到的 `toolStarts = new Set<string>()` 防重发同一 tool start 的实际问题。

**Shell / 长 stdout hash 节流**：

- 对每条 `raw.stdout` / `raw.stderr` / `tool.update.stdout` 计算 `sha256(line)`；adapter session 内维护最近 256 hash 的 LRU 集合。
- 命中 LRU → drop（计数器 +1，每 100 次 drop 写一条 `handler.stalled { handler: "adapter-stdout-throttle", droppedCount: N }` debug 提示）。
- 单条 line MUST 截断到 8 KB（超出则截断 + 末尾追加 `«...truncated, original size=Nb»`）；截断前先经 SecretRedactor。

**Raw output 大小上限**：

- 任意 ephemeral payload `line` / `chunk` 字段 MUST ≤ 8 KB；durable 事件 payload 中任意"原始输出"字段 MUST ≤ 1 KB。
- 单次 tool 调用累计 stdout > 256 KB → 不再 emit per-line update，转写到 `<sessionId>-<runId>.log` 同时 emit 一条 `tool.update.diverted { toolCallId, reason: "size_cap_exceeded", logPath }` ephemeral；UI 在 Run Detail 提示用户去看 log 文件。
- Terminal Artifact 路径（详见 `artifacts/Terminal Artifact`）天然走附件，不受 raw output 上限限制。

#### Scenario: 同一 toolCallId 重复 start 被丢

- **WHEN** ClaudeCodeAdapter 因 hook 重复触发对同一 `toolCallId=tc_42` emit 两次 `tool.call.requested`
- **THEN** AdapterBridge 第二次 dedupe key 命中，drop；durable 流中 `tool.call.requested` 只有一次；debug log 记录 `tool_event_deduped`

#### Scenario: 大量重复 stdout 被节流

- **WHEN** Agent 跑 `tail -f log` 输出大量重复行（同 hash）
- **THEN** AdapterBridge LRU 命中 → 不推 SSE；每 100 次 drop 写 `handler.stalled` debug；UI 仍可在 Run Detail 看到完整 log（落盘路径）

#### Scenario: 单次 tool 输出超 256 KB 转 log

- **WHEN** Agent 跑 `npm test` 输出 10 MB
- **THEN** AdapterBridge 在累计达 256 KB 时停止 emit `tool.update`；改写 sessions log 文件；emit 一条 `tool.update.diverted`；最终 `tool.call.completed` 不带 stdout 字段，改用 `outputRef: { logPath }`

### Requirement: Adapter Liveness 状态与心跳分离

The system SHALL maintain an adapter-instance-level liveness state independent of any client SSE heartbeat. SSE heartbeat measures browser↔daemon connectivity only and SHALL NOT be used to infer adapter health. AdapterManager SHALL expose adapter liveness via durable `adapter.liveness.changed` events and the `/healthz` payload.

```ts
type AdapterLiveness =
  | "available"     // detect() 通过，未 spawn
  | "starting"      // 正在 spawn / 握手
  | "ready"         // 已就绪，可接 startRun
  | "busy"          // 正在跑至少一个 prompt（不影响下一 run 排队，仅状态展示）
  | "blocked"       // 反复崩溃 / detect 失败 / 关键 capability 缺失
  | "crashed"       // 当前进程已死，待重启
  | "offline"       // 用户显式禁用 / 心跳超时

interface AdapterHealth {
  adapterId: string
  liveness: AdapterLiveness
  lastHeartbeatAt?: number
  pendingRunIds: string[]
  crashCount: number
  lastError?: { reason: string; at: number }
}
```

**心跳协议**：

- AdapterManager 每 3 秒对 `ready` / `busy` / `starting` 状态的 adapter 发 lightweight ping（ACPAdapter 用 `protocol/ping` JSON-RPC method；非 ACP adapter 用 in-process Effect call）。
- 连续 5 次 ping miss（约 15 秒）→ liveness 转 `crashed`；按 `manifest.reliability.maxRestartAttempts` 重启；超出 → `blocked` 并把所有受影响 Run 标 `failed { reason: "adapter_blocked" }`。
- adapter ping 心跳与 SSE `/event` heartbeat 完全独立，分别在不同 Effect Fiber，互不替代。

**与 SSE heartbeat 关系**：

- SSE heartbeat（`local-daemon/多客户端 SSE 连接`）：每 10s 给浏览器推 `: ping`，断线时浏览器 retry；只表征浏览器在线。
- adapter heartbeat：每 3s 内部 ping 子进程；表征 Agent runtime 健康。
- `/healthz` 必须分别返回这两类心跳的状态。

#### Scenario: 浏览器断网不影响 adapter

- **WHEN** 用户笔记本网络中断 30 秒，SSE 连接断开重连
- **THEN** 期间所有 adapter liveness 不变；in-flight Run 继续跑；重连后 SSE 通过 cursor 补 durable 事件即可

#### Scenario: adapter 崩溃但 SSE 在线

- **WHEN** ClaudeCodeAdapter OOM 退出
- **THEN** AdapterManager 心跳超时 → liveness=`crashed` → 重启；durable 事件 `adapter.crashed` 与 `adapter.liveness.changed` 通过 SSE 推到浏览器；SSE 自身仍正常

### Requirement: 跨平台 CLI 探测与 Provider-specific Spawn

The system SHALL define platform-specific discovery and spawn strategies per provider so that AdapterManager `detect()` reliably finds CLI binaries on macOS / Linux / Windows, and so that spawn failures classify into actionable error categories. Adapters relying on external CLIs MUST NOT just call `which` / `where`; they MUST follow the strategy below.

**探测顺序**（每个 provider 自顶向下尝试）：

1. **显式配置**：`config.toml` 中 `[adapter.<id>] command = "..."` / `args = [...]` / `env = {...}` 优先，跳过自动发现。
2. **PATH 解析（macOS / Linux）**：先 spawn 用户 login shell（`bash -lc 'command -v <bin>'` 或 `zsh -lc`），加载 `~/.zshrc` / `~/.bashrc` 后查 PATH（覆盖 GUI 启动应用 PATH 不全的常见坑）；fallback 到 `process.env.PATH`。
3. **PATH 解析（Windows）**：先 `where <bin>`；命中失败再 PowerShell `Get-Command <bin> -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source`；空格路径 spawn 时 MUST 使用数组式 `spawn(file, args, { windowsVerbatimArguments: false })`，不拼字符串。
4. **NPX / Node bridge**：当 provider 实际入口是 npm 包（如 Claude ACP 通过 `@zed-industries/claude-agent-acp`、Codex ACP 通过 `@openai/codex-acp` 等）：
   - 先校验 `node --version` ≥ provider 要求（默认 ≥ 20）。
   - 优先 `npx --yes -p <pkg>@<version> -c "<bin>"`，失败再尝试全局 `npm root -g` 路径下直接 spawn。
   - npx 缓存目录 MUST 显式设置（`NPM_CONFIG_CACHE=<userhome>/.agenthub/npm-cache`）避免与用户 npm 状态冲突。
5. **版本校验**：spawn `<bin> --version`，按 manifest 声明的 `minVersion` semver 比较；不满足 → `AdapterError(code="version_mismatch")`。

**Spawn 策略**：

- 任何 spawn MUST 通过 `security/子进程隔离` 中的 `filterSafeEnv`，不透传 `AGENTHUB_TOKEN` / API key。
- 子进程 MUST detached=false，确保 daemon 退出时进程树被一并 kill（Windows 用 `taskkill /T /F`，macOS / Linux 用 `process.kill(-pid, "SIGTERM")` 后 SIGKILL 兜底）。
- spawn 失败 MUST 分类为以下错误码之一供 UI 展示：

```ts
type AdapterDiscoveryErrorCode =
  | "not_found"             // bin 不在 PATH，且无显式 command
  | "node_missing"           // 需要 node 但未装或版本过低
  | "version_mismatch"       // bin 存在但版本不满足
  | "spawn_failed"           // OS 拒绝 spawn（权限 / EACCES / EPERM）
  | "handshake_timeout"      // spawn 成功但握手超时（如 ACP initialize 无响应 / 30s）
  | "auth_required"          // CLI 报告需要登录（claude auth login）
```

**Provider-specific 默认 spawn 配置**：

| Provider | 主入口 | 备选 | 特殊处理 |
|---|---|---|---|
| claude-code | `claude` (本地 hooks 模式) | `npx @zed-industries/claude-agent-acp` (ACP 模式) | `auth_required` 时引导用户跑 `claude auth login` |
| codex | `codex` (Codex App Server) | `npx @openai/codex-acp` (ACP 模式) | App Server 优先；ACP 兜底 |
| opencode | `opencode` (server mode) | ACP fallback | server mode 优先（更结构化） |

#### Scenario: macOS GUI 启动找不到 claude

- **WHEN** 用户从 macOS Dock 双击桌面端启动 daemon，PATH 不含 `/opt/homebrew/bin`
- **THEN** ACPAdapter detect 走 login shell 加载 `.zshrc`，重新解析 PATH，找到 `claude`；不要求用户手动配 PATH

#### Scenario: Windows 路径含空格

- **WHEN** 用户安装 claude 到 `C:\Program Files\Claude\claude.exe`
- **THEN** AdapterManager 通过 `where claude` 拿到带空格路径，spawn 时使用 args 数组形式不拼字符串，子进程正常启动

#### Scenario: Node 版本过低拒绝 npx

- **WHEN** 用户 `node --version` = v18，ACP package 要求 ≥ 20
- **THEN** ACPAdapter detect 报 `node_missing`；UI 在 Agent 详情显示"需要 Node.js ≥ 20，当前 v18，请升级 Node"

#### Scenario: spawn 后握手超时

- **WHEN** ACP 子进程 spawn 成功但 30 秒未响应 `initialize` JSON-RPC
- **THEN** ACPAdapter 报 `handshake_timeout`，强 kill 进程，状态 → `failed`；UI 显示握手超时 + 建议查看 raw stderr log

### Requirement: adapter.config.updated / agent.capabilities.updated 事件

The system SHALL emit a durable `adapter.config.updated` event whenever an adapter instance's runtime configuration changes (model id, available models list, MCP server list, manifest fields), and a durable `agent.capabilities.updated` event whenever a derived `AgentProfile.capabilities[]` changes due to upstream adapter changes. These events SHALL be consumed by Permission Engine, Orchestrator, and Web UI to keep their views consistent without polling.

```ts
type AdapterConfigUpdatedPayload = {
  adapterId: string
  changedFields: string[]                    // 例: ["currentModel", "availableModels"]
  current: Pick<AgentAdapterManifest, "id" | "name" | "capabilities" | "context"> & {
    currentModel?: string
    availableModels?: string[]
  }
}

type AgentCapabilitiesUpdatedPayload = {
  agentId: string
  before: AgentCapability[]
  after: AgentCapability[]
}
```

触发场景（非穷举）：

- ACP `protocol/configUpdated` notification
- 用户在 settings UI 切换 adapter 模型
- adapter detect 重新发现可用模型
- agent profile 编辑或 markdown 文件 hot reload

#### Scenario: 用户切模型后 Permission 立即用新模型 cost

- **WHEN** 用户在 settings 把 ClaudeCodeAdapter currentModel 从 sonnet-4-6 切到 opus-4-7
- **THEN** AdapterManager emit `adapter.config.updated { changedFields: ["currentModel"] }`；后续 Run completed 事件中 cost.modelId = opus-4-7

#### Scenario: 能力收缩触发 UI 警告

- **WHEN** ClaudeCodeAdapter 升级后失去 `canEmitSubagentEvents`
- **THEN** AdapterManager emit `adapter.config.updated`；依赖该 capability 的 Agent emit `agent.capabilities.updated { before: [..., "task.delegate"], after: [...] }`；UI 在 Agent 详情顶部 banner 提示"该 Agent 失去 task.delegate 能力，原因：adapter 能力变更"

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
- **AND** RunLifecycleService.markCancelling 发 `agent.run.cancelling`；adapter session 实际结束后 cancelFinalized 发 `agent.run.cancelled`

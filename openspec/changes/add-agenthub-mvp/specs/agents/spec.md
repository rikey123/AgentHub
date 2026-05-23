# agents

## ADDED Requirements

> **Capability 概览**
>
> Agent 模型分两层：① AgentProfile（静态配置，markdown frontmatter 文件）；② AgentPresence（运行时状态机）。本 capability 定义 Agent 注册、发现、状态机、能力标签。Adapter 接入与 Run 生命周期在 `adapter-framework` capability。
>
> **Goals / Non-Goals**
> - G：用户能用 markdown 文件配置 Agent，无需重启 daemon 即生效。
> - G：Agent 状态机限制为 7 态，避免 UI 复杂化。
> - G：Agent 能力以标签形式声明，Permission / Context Assembly 都可使用。
> - NG：MVP 不做 Agent marketplace（V1）。
> - NG：MVP 不做 Agent 间私聊（仅通过 Room mailbox）。

### Requirement: AgentProfile 数据模型

The system SHALL persist AgentProfile loaded from markdown files at `<workspace>/.agenthub/agents/*.md` and `<userhome>/.agenthub/agents/*.md`.

```ts
type AgentProfile = {
  id: string                          // 文件名去 .md 后的 kebab-case
  name: string                        // 展示名
  description?: string
  avatar?: string                     // emoji 或 url
  provider:
    | "native"                        // AgentHub 自建（Mock）
    | "claude-code"
    | "codex"
    | "opencode"
    | "langgraph"                     // V1
    | "a2a"                           // V1
  adapterId: string                   // 实际 adapter 实例 id
  model?: string                      // 如 "claude-sonnet-4-6"
  prompt: string                      // system prompt（markdown body）
  defaultPresence: "offline" | "observing" | "active"
  capabilities: AgentCapability[]
  permissionProfileId?: string        // 详见 permissions capability
  hidden?: boolean
}

type AgentCapability =
  | "chat"
  | "code.edit"
  | "code.review"
  | "terminal.run"
  | "file.read"
  | "file.write"
  | "web.search"
  | "web.fetch"
  | "context.read"
  | "context.write"
  | "intervention.knock"
  | "task.delegate"
```

markdown 配置文件示例：

```markdown
---
id: security-reviewer
name: Security Reviewer
avatar: 🛡️
provider: claude-code
adapterId: claude-code-default
model: claude-sonnet-4-6
defaultPresence: observing
capabilities: [chat, code.review, context.read, context.write, intervention.knock]
permissionProfileId: read-only
hidden: false
---

You are a senior security reviewer focused on auth, secret handling, and SQL injection. ...
```

```sql
CREATE TABLE agent_profiles (
  id                       TEXT PRIMARY KEY,
  workspace_id             TEXT,                -- NULL = 用户级
  name                     TEXT NOT NULL,
  description              TEXT,
  avatar                   TEXT,
  provider                 TEXT NOT NULL,
  adapter_id               TEXT NOT NULL,
  model                    TEXT,
  prompt                   TEXT NOT NULL,
  default_presence         TEXT NOT NULL,
  capabilities             TEXT NOT NULL,       -- JSON array
  permission_profile_id    TEXT,
  hidden                   INTEGER NOT NULL DEFAULT 0,
  source_path              TEXT,                -- 来源 markdown 路径
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
```

#### Scenario: 加载用户级 Agent 配置

- **WHEN** daemon 启动时扫描 `~/.agenthub/agents/`
- **THEN** 解析每个 `.md`（gray-matter）→ 写 `agent_profiles` 表 `workspace_id=NULL`，发 `agent.profile.loaded` durable 事件

#### Scenario: workspace 级覆盖用户级

- **WHEN** `~/.agenthub/agents/builder.md` 与 `<workspace>/.agenthub/agents/builder.md` 同时存在
- **THEN** workspace 级优先生效，用户级被覆盖；`GET /agents?workspaceId=<wid>` 返回 workspace 版

#### Scenario: 配置文件热更新

- **WHEN** 用户编辑保存 `<workspace>/.agenthub/agents/security.md`（chokidar 监听）
- **THEN** daemon 重新解析并 upsert agent_profiles 表，发 `agent.profile.updated` 事件；正在跑的 Run 不受影响（直到下一次 run 才用新 prompt）

### Requirement: AgentPresence 状态机

The system SHALL maintain Agent presence per (roomId, agentId) pair with exactly 7 states and the transitions below.

```
   offline ──────► observing ──────► active ──────► working
      ▲              │  ▲              │              │
      │              │  │              │              ▼
      │              ▼  │              ▼         waiting_approval
      │           knocking ─────► (decision)         │
      │              │                               ▼
      └──────────────┴──────── blocked ◄─────────────┘
```

| 状态 | 含义 |
|---|---|
| `offline` | Agent 不在 Room 中 |
| `observing` | 在 Room 但默认沉默 |
| `active` | 可发言（被 @ / 唤醒） |
| `working` | 正在执行 Run |
| `waiting_approval` | Run 中触发 permission ask，等待用户 |
| `knocking` | 主动敲门，等待用户裁决 |
| `blocked` | adapter 崩溃 / 重启失败 / permission deny 等错误状态 |

```sql
CREATE TABLE agent_presence (
  room_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  state       TEXT NOT NULL,
  reason      TEXT,                       -- 进入当前状态的原因
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (room_id, agent_id)
);
```

#### Scenario: Agent 加入 Room 自动 observing

- **WHEN** Room 添加一个 Agent 参与者，其 `defaultPresence = "observing"`
- **THEN** agent_presence 表写入 `state="observing"`，发 `agent.joined` + `agent.state.changed` 事件

#### Scenario: 用户 @ 唤醒 observer

- **WHEN** 用户消息文本含 `@security`，security 当前 `observing`
- **THEN** 状态转 `active`，发 `agent.state.changed`；触发 run 后转 `working`；run 完成后转回 `observing`（除非用户继续 @）

#### Scenario: Permission ask 中转 waiting_approval

- **WHEN** Agent 在 `working` 中遇到 `permission.requested`
- **THEN** 状态转 `waiting_approval`，UI 显示等待图标；用户 allow 后回 `working`；用户 deny 后视情况回 `active` 或转 `blocked`

#### Scenario: Adapter 崩溃转 blocked

- **WHEN** adapter manager 收到 `adapter.crashed` 且重启重试已用尽
- **THEN** 该 Agent 在所有相关 Room 转 `blocked`，发 `agent.state.changed` + `agent.blocked` 通知，UI 显示"Agent 不可用，请检查 adapter 配置"

### Requirement: Agent 注册与发现

The system SHALL expose Agent CRUD endpoints and a discovery endpoint that returns the merged user-level + workspace-level profiles.

API：

```
GET    /agents?workspaceId=          # 列表（含 workspace 覆盖）
GET    /agents/:id
POST   /agents                       # 通过 API 注册（不依赖 markdown）
PATCH  /agents/:id
DELETE /agents/:id
POST   /agents/:id/reload            # 强制重读 markdown
```

#### Scenario: 列出 workspace 下可用 Agent

- **WHEN** 用户 `GET /agents?workspaceId=w_1`
- **THEN** 返回合并后的 profile 列表，每个含 source（user / workspace），hidden=true 的不返回

#### Scenario: API 创建 Agent

- **WHEN** 用户 `POST /agents` body 含完整 profile 字段
- **THEN** daemon 写表（`source_path = NULL`），发 `agent.profile.loaded` 事件；后续 markdown 扫描不影响这个 Agent（直到用户删除该数据库记录）

### Requirement: Agent 能力声明与 Permission 衔接

The system SHALL use `AgentCapability[]` as the high-level intent layer; the `permissionProfileId` is the actual enforcement layer (详见 permissions capability).

约束：

- Agent 没有声明 `code.edit` 但试图通过 tool 写文件 → Permission Engine deny + 写 audit log
- Agent 声明 `code.edit` 但 `permissionProfileId` 实际不允许 → 仍然 deny（profile 是唯一真相）

#### Scenario: 能力与权限不一致时以权限为准

- **WHEN** Agent.capabilities 含 `file.write`，但 permissionProfile.file.write = "deny"
- **THEN** 实际写文件请求被 deny；UI 在 Agent 详情页提示"该 Agent 声明了 file.write 能力但当前权限策略禁用"

### Requirement: Run 生命周期

The system SHALL track each Agent execution as a Run entity with the following states.

```ts
type Run = {
  id: string                       // ULID
  taskId?: string
  roomId: string
  agentId: string
  adapterId: string
  adapterSessionId?: string
  status:
    | "queued"          // 已入队，等待 RunQueue Worker 调度
    | "waiting"         // RunQueue 调度中，但锁被占用
    | "starting"        // 锁已获取，正在拉起 adapter session
    | "running"         // adapter session 已开始
    | "waiting_permission" // Run 中触发 permission ask
    | "cancelling"      // 已收到 CancelRun，正在收尾
    | "completed" | "failed" | "cancelled"
  waitingReason?: string             // status='waiting' 时填，例 'agent_lock_held_by:run_42' / 'file:auth.ts'
  workspacePath?: string
  contextVersion?: number          // Context Ledger 当时的 version
  startedAt?: number
  endedAt?: number
  cost?: {
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    costUsd: number
    modelId: string
  }
}
```

```sql
CREATE TABLE runs (
  id                     TEXT PRIMARY KEY,
  task_id                TEXT,
  room_id                TEXT NOT NULL,
  agent_id               TEXT NOT NULL,
  adapter_id             TEXT NOT NULL,
  adapter_session_id     TEXT,
  status                 TEXT NOT NULL,
  waiting_reason         TEXT,
  workspace_path         TEXT,
  context_version        INTEGER,
  started_at             INTEGER,
  ended_at               INTEGER,
  input_tokens           INTEGER,
  output_tokens          INTEGER,
  cached_tokens          INTEGER,
  cost_usd               REAL,
  model_id               TEXT,
  error                  TEXT,
  created_at             INTEGER NOT NULL
);
CREATE INDEX idx_runs_room_started ON runs (room_id, started_at);
CREATE INDEX idx_runs_agent_started ON runs (agent_id, started_at);
```

#### Scenario: 触发新 Run（命令驱动）

- **WHEN** Orchestrator 决定让 `claude-code-builder` 处理用户消息 `m_42`
- **THEN** Orchestrator dispatch `WakeAgent` Command（origin='internal'）；WakeAgent handler 在 IMMEDIATE 事务内 activeWakes guard + 原子 claim mailbox + 调 `RunLifecycleService.create(...)`，service 在同事务内 INSERT runs(status='queued', wake_reason) + 发 `agent.run.queued` + outbox；Orchestrator / WakeAgent handler 均不直接写 runs 表、不直接调 adapter、不再 dispatch StartRun（MVP 不存在该 Command）；后续 `agent.run.started` 由 RunQueue Worker 拿锁后调 `markClaimed → markStarting` 触发（详见 `bus-runtime/RunLifecycleService 是 runs 表的唯一写入口` 与 `bus-runtime/RunQueue 是 bus 的一条命名队列`）

#### Scenario: Run 完成上报 cost

- **WHEN** AdapterBridge 收到 adapter 完成事件（含 token 用量）
- **THEN** AdapterBridge 调 `RunLifecycleService.complete(null, runId, cost)`；service 在单事务内 UPDATE runs `status='completed', ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, ...` + INSERT events(`agent.run.completed`) + outbox；AdapterBridge 自身不写 runs；RunQueue Worker 订阅该事件后释放锁

#### Scenario: 用户取消 Run

- **WHEN** 用户 `POST /runs/:id/cancel`
- **THEN** HTTP layer dispatch `CancelRun` Command；RunService 调 `RunLifecycleService.markCancelling(null, runId)`（事务 1：UPDATE runs.status='cancelling'，无 durable event），随后**同步**调 `AdapterManager.cancelRun(runId)`（不订阅 `agent.run.cancelled`，避免事件回环）；adapter session 实际结束后 AdapterBridge 调 `RunLifecycleService.cancelFinalized(null, runId)`（事务 2：UPDATE runs.status='cancelled' + INSERT events(`agent.run.cancelled`) + outbox）；RunQueue Worker 订阅该事件释放锁；MessageService 把对应 assistant message status 转 `cancelled` 并发 `message.cancelled`

### Requirement: 内置 Agent（MVP 必带）

The system SHALL ship with the following preconfigured AgentProfile templates, written into `~/.agenthub/agents/` on first launch but only if the file does not exist.

| Agent | provider | 能力 | 默认 presence |
|---|---|---|---|
| `mock-builder` | native | chat, code.edit, file.read, file.write | active |
| `mock-reviewer` | native | chat, code.review, context.read, context.write, intervention.knock | observing |
| `claude-code-builder` | claude-code | chat, code.edit, file.read, file.write, terminal.run, context.read, context.write | active |
| `claude-code-reviewer` | claude-code | chat, code.review, context.read, context.write, intervention.knock | observing |

#### Scenario: 首次启动写入模板

- **WHEN** daemon 第一次启动，`~/.agenthub/agents/` 不存在或为空
- **THEN** 创建该目录，写入上述 4 个 `.md` 模板；用户后续编辑不会被覆盖

### Requirement: Run 状态机扩展（claimed / sessionId 持久化 / wake_reason）

The system SHALL extend the Run state machine and the `runs` schema to include the `claimed` state, mid-flight session/workDir persistence, and a `wake_reason` field. This refines the original `agents/Run 生命周期` Requirement and reflects what is required by `bus-runtime/RunQueue` and `orchestrator/Observing 是被动状态 + WakeAgent`.

```
queued → claimed → starting → running → completed
                       │         │  │
                       │         │  └─→ waiting_permission ─→ running
                       │         │
                       │         ├─→ failed
                       │         └─→ cancelling → cancelled
                       │
                       └─→ failed (claim_aborted: adapter spawn / handshake failed)
```

新状态语义：

| 状态 | 含义 | 写入者 |
|---|---|---|
| `queued` | 已 INSERT，未被 RunQueue Worker claim | WakeAgent handler（在 IMMEDIATE 事务内调 `RunLifecycleService.create`） |
| `waiting` | RunQueue Worker 评估时锁被占；等待 `agent.run.completed/failed/cancelled` 通知 | RunQueue Worker |
| `claimed` | RunQueue Worker 已拿到 (agent / room / file) 锁，**adapter session 尚未确认启动** | RunQueue Worker（事务 1） |
| `starting` | RunLifecycleService.markStarting：AdapterManager.startRun 已发起，等待 `session.opened` | RunLifecycleService（事务 2） |
| `running` | adapter 已报告 `session.opened` 或第一条 message.delta | RunLifecycleService.markRunning |
| `waiting_permission` | 跑动中触发 permission ask | RunLifecycleService.markWaitingPermission |
| `cancelling` | 用户 CancelRun 同步路径中 | RunLifecycleService.markCancelling |
| `completed` / `failed` / `cancelled` | 终结 | RunLifecycleService.complete/fail/cancelFinalized |

`runs` 表字段增补：

```sql
ALTER TABLE runs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';   -- 来源 rooms.workspace_id；RunQueue workspace 级锁直接用此列，避免 join；migration 完成后该列实际由 RunLifecycleService.create 填充
ALTER TABLE runs ADD COLUMN wake_reason TEXT;              -- 见 orchestrator/WakeReason
ALTER TABLE runs ADD COLUMN work_dir TEXT;                  -- ArtifactFS 隔离工作目录（worktree/isolated_copy/shadow），不是真实 workspace 根
ALTER TABLE runs ADD COLUMN workspace_mode TEXT;            -- 'isolated_worktree' | 'isolated_copy' | 'shadow_buffer' | 'shared' | 'external'
ALTER TABLE runs ADD COLUMN provider_conversation_id TEXT;  -- claude / codex 内部 conversation id（用于复用）
ALTER TABLE runs ADD COLUMN claimed_at INTEGER;             -- 进入 claimed 的时间戳
ALTER TABLE runs ADD COLUMN failure_class TEXT;             -- 见 Run 失败分类
ALTER TABLE runs ADD COLUMN parent_run_id TEXT;             -- Run reuse 链，非空时复用 prior session
ALTER TABLE runs ADD COLUMN target_files TEXT;              -- best-effort：JSON array of paths；未知时 RunQueue 退化为 workspace 级写锁
ALTER TABLE runs ADD COLUMN mailbox_claim_count INTEGER NOT NULL DEFAULT 0; -- 本次 run 一次性认领的 mailbox 行数
ALTER TABLE runs ADD COLUMN pid_at_start INTEGER;           -- markStarting 时的 daemon pid，用于崩溃恢复区分前 / 当前进程

-- 索引：RunQueue workspace 级锁 / Reclaim 扫描
CREATE INDEX idx_runs_workspace_status ON runs (workspace_id, status);
```

#### Scenario: queued → claimed → starting → running 完整链

- **WHEN** WakeAgent handler 在 IMMEDIATE 事务内调 `RunLifecycleService.create`
- **THEN** RunLifecycleService 单事务内 INSERT runs(status='queued', wake_reason, mailbox_claim_count) + INSERT events(`agent.run.queued`) + outbox
- **THEN** RunQueue Worker 拿锁后在事务 1 中 UPDATE runs.status='claimed'（不发 durable event）；随后调 RunLifecycleService.markStarting 进入事务 2 UPDATE runs.status='starting' + INSERT events(`agent.run.started`) + outbox；adapter 报告 `session.opened` 后 markRunning 把 status 推到 `running`

#### Scenario: claimed 中崩溃可被 reclaim

- **WHEN** daemon 在 worker 已 UPDATE status='claimed'（事务 1 已提交，run_locks 已写入），但还未调 markStarting 时崩溃
- **THEN** daemon 重启时 `ReclaimStaleClaimedRun` 后台任务扫 `runs WHERE status='claimed' AND claimed_at < now - 30s`；对每条 run 调 RunLifecycleService.fail(null, runId, "claim_aborted", "transient")（事务 3：UPDATE runs.status='failed' + INSERT events(`agent.run.failed`, payload.failureClass="transient") + outbox）；run_locks 在 RunQueue 监听 `agent.run.failed` 时释放

#### Scenario: starting 阶段 adapter spawn 失败

- **WHEN** RunQueue Worker markStarting 后 AdapterManager.startRun 返回 `AdapterError(code="spawn_failed")`
- **THEN** AdapterBridge 调 `RunLifecycleService.fail(null, runId, reason="adapter_spawn_failed", failureClass="configuration", error?)`（详见 P1-6）；run_locks 因 `agent.run.failed` 释放；UI 在 Run Detail 显示失败原因 + "请检查 adapter 安装"提示

### Requirement: SessionId / WorkDir 中途持久化

The system SHALL persist `adapterSessionId`, `workDir`, and `providerConversationId` to the `runs` table **as soon as adapter reports them**, not only on terminal events. This enables:
- daemon crash recovery to know which adapter session belongs to which run;
- Room+Agent reuse of prior session for continuity (subject to adapter capability);
- Run Detail page to render the workspace path even before run completion.

`RunLifecycleService` MUST expose the following non-event-emitting method (it does NOT publish a durable event; it is a pure UPDATE because mid-flight session info changes are high-frequency and not user-actionable):

```ts
interface RunLifecycleService {
  // ... existing methods ...
  updateSessionState(
    tx: SqliteTx | null,
    runId: string,
    patch: { adapterSessionId?: string; workDir?: string; providerConversationId?: string; pidAtStart?: number }
  ): Effect.Effect<void, RunLifecycleError>
}
```

AdapterBridge MUST 在收到以下 AdapterEvent 时立即调 updateSessionState：
- `session.opened` → **canonical 两步顺序、独立事务**：tx1 `updateSessionState(null, runId, { adapterSessionId, workDir })` 先持久化；tx2 `markRunning(null, runId, adapterSessionId)` 推进状态。两步独立事务的目的是让 daemon 在 tx1 commit 后、tx2 之前崩溃时，`ReclaimStaleClaimedRun` 可通过扫描 `status='starting' AND adapter_session_id IS NOT NULL AND pid_at_start != current pid` 拿到该 run 并 attach（详见 `bus-runtime/ReclaimStaleClaimedRun 后台任务`）。
- adapter 内 `provider_conversation_id` 变化（如 Codex 创建 conversation）→ `updateSessionState(null, runId, { providerConversationId })` 单步即可。

**Run Reuse 策略**（与 P1-6 配合）：

```ts
type RunReusePolicy =
  | "always_fresh"       // 每次 wake 起新 adapter session（ACPAdapter 默认）
  | "reuse_per_room_agent" // 同 (room, agent) 复用上次 session；崩溃 / poisoned 才重建
  | "reuse_per_workspace" // 整个 workspace 共享 session（小型 agent 适用）
```

reuse 时 RunLifecycleService.create 接受 `parentRunId?: string` 字段；新 Run 复用 parent 的 `adapterSessionId` / `workDir` / `providerConversationId`。

#### Scenario: session.opened 立即写表

- **WHEN** adapter emit `session.opened { sessionId: "s_42" }`
- **THEN** AdapterBridge 调 `updateSessionState(null, runId, { adapterSessionId: "s_42" })`；UPDATE runs SET adapter_session_id='s_42'；不发 durable event；UI Run Detail 通过 `GET /runs/:id` 立即看到

#### Scenario: 崩溃后能找回 session

- **WHEN** daemon crash 后重启，扫到 runs WHERE status IN ('starting', 'running', 'waiting_permission') AND adapter_session_id IS NOT NULL
- **THEN** ReclaimStaleClaimedRun 任务对每条 run 按 `manifest.reliability.crashRecovery` 决定：`resumable` → 调 adapter.attachSession 复用 sessionId；`restartable` → fail + 触发新 wake；`fail_run` → 直接 fail

#### Scenario: 同 (room, agent) 复用 session

- **WHEN** ClaudeCodeAdapter manifest 声明 `reuse_per_room_agent`，第二次 wake 在同 (r_1, builder) 触发
- **THEN** RunLifecycleService.create 带 `parentRunId=run_prev`；新 Run 复用 prev 的 adapter_session_id；adapter sendMessage 接续上一轮

### Requirement: Run 失败分类 + 与 Handler 重试隔离

The system SHALL classify Run failures into a small set of canonical `FailureClass` values; classification SHALL determine whether to (a) retry transparently, (b) recover via fresh session, or (c) surface to user. Run-level retry policy MUST be **independent** of `bus-runtime/handler retry`：handler retry 是处理某条 durable event 的内部失败兜底，Run retry 是用户可感知的"再跑一遍 Agent"。两者的判断、UI 与统计完全分离。

```ts
type FailureClass =
  | "transient"          // 网络 / 短时 5xx / 上游 quota，可静默重试 1 次（仅在 visible output 之前）
  | "retryable_visible"  // 已对用户产出过 message，禁止静默重试；UI 提供"再跑一次"按钮
  | "fresh_session_required" // poisoned session（api_invalid_request / iteration_limit / context overflow）；MUST 弃用现 session 起新
  | "permission_denied"  // 用户 deny；不重试；UI 在 Run Detail 标注 deny 原因
  | "user_cancelled"     // CancelRun；不重试
  | "configuration"      // adapter 未装 / version_mismatch / auth_required；不重试，引导用户配置
  | "fatal"              // OOM / corrupted state；不重试
```

`RunLifecycleService.fail(null, runId, reason, failureClass, error?)` 中 `failureClass` MUST 必填；写入 `runs.failure_class`，并随 `agent.run.failed` event payload 透传。

**Run-level 自动重试规则**：

| FailureClass | 自动重试 | reuse 策略 | UI 表现 |
|---|---|---|---|
| `transient` 且 run 尚未产生 visible message | 1 次（指数退避 5s）| 同 session | "重试中" toast |
| `transient` 但已 visible | 否 | — | "失败，可重试"按钮 |
| `retryable_visible` | 否 | — | "失败，可重试"按钮 |
| `fresh_session_required` | 否（用户决定） | 用户点重试 → 强制新 session | "session 失效"提示 |
| `permission_denied` / `user_cancelled` | 否 | — | 状态徽章 |
| `configuration` / `fatal` | 否 | — | 配置引导 / 错误详情 |

**与 handler retry 隔离的关键点**：

- bus-runtime handler retry 的 `consumer_offsets.retries` 计数 MUST NOT 影响 `runs.failure_class`；两者写不同表。
- `agent.run.failed` durable 事件本身被 handler 处理时若失败，进入 handler retry / DLQ；Run 不会因为 handler retry 多被记录失败一次。

**Poisoned session 列表**（fresh_session_required 触发场景，非穷举）：

- ACP / provider 报告 `api_invalid_request`（如 prompt 包含违规 base64）
- adapter 报告 `iteration_limit_reached`
- adapter 报告 `context_window_overflow`
- adapter 连续两次返回相同 error fingerprint
- adapter 报告 semantic inactivity（>5 分钟无任何输出）

#### Scenario: transient 失败静默重试

- **WHEN** Builder run 在 starting 阶段因 anthropic 503 失败，run 尚未产 visible message
- **THEN** RunLifecycleService.fail(null, runId, reason="upstream_5xx", failureClass="transient")；调度器看到 `failureClass=transient` 且无 visible output → dispatch `RetryRun` Command；新 Run 用同 session 重试；UI 仅 toast "重试中"

#### Scenario: visible 阶段失败不静默重试

- **WHEN** Builder 已输出 200 字给用户后断流失败
- **THEN** failureClass="retryable_visible"；不自动重试；UI 在该 message 旁显示"失败 — 重试 / 报错"按钮，由用户决定

#### Scenario: poisoned session 强制新 session

- **WHEN** Builder 第二次返回 iteration_limit
- **THEN** failureClass="fresh_session_required"；UI 提示"session 上下文超限，已弃用"；用户点重试 → RunLifecycleService.create 不带 parentRunId，强制新 adapter session

#### Scenario: handler retry 不串流到 Run

- **WHEN** projector handler 处理 `agent.run.completed` 事件失败 3 次
- **THEN** 进入 DLQ + `handler.stalled`；Run 本身仍是 `completed` 状态；UI Run Detail 不显示失败

### Requirement: workspace_path / work_dir 字段语义区分

The system SHALL distinguish between two path-like Run fields and SHALL NOT expose absolute path values via普通 API / SSE / event payload.

| 字段 | 语义 | 暴露范围 |
|---|---|---|
| `workspace_path` | 用户真实项目根目录（用户工作区根） | 永不通过普通 API / SSE / event payload 暴露绝对值；只允许 admin scope 通过 `/workspaces/:id`（settings 视图）查看 |
| `work_dir` | 本次 Run 的隔离工作目录（worktree / isolated_copy 路径，shadow_buffer 模式下为 in-memory 标识） | adapter 子进程 cwd MUST 指向 `work_dir`；普通 API / SSE / event payload 中 MUST 仅暴露相对路径（如 `src/auth.ts`）+ `runId.workDir` 抽象引用；admin scope 在 Run Detail 才可读绝对值 |

**强制约束**：

1. AdapterManager spawn 子进程时 `cwd = run.work_dir`（绝不是 `workspace_path`）。
2. 任何 durable event payload / API response / SSE 帧中包含的 file path MUST 是相对 `work_dir`（或相对 `workspace_path`）的相对路径；MUST NOT 包含绝对路径片段。
3. `work_dir` 路径根 MUST ∈ `<userhome>/.agenthub/{worktrees,runs}/`，由 `local-daemon/Worktree 选择策略` 决定具体子目录。
4. Run Detail（admin scope only）通过 `GET /runs/:id` 返回 `work_dir` 绝对值；普通 read scope 不返回该字段。

#### Scenario: durable event 不暴露绝对路径

- **WHEN** ArtifactFS 触发 `file.changed`，绝对路径 `/Users/u/.agenthub/worktrees/run_42/src/auth.ts`
- **THEN** durable event payload 仅含 `{ runId: "run_42", path: "src/auth.ts" }`；Run Detail（admin） GET /runs/run_42 才能取到 `work_dir = "/Users/u/.agenthub/worktrees/run_42"`

#### Scenario: adapter cwd 指向 work_dir 而非 workspace_path

- **WHEN** RunQueue Worker 调 `AdapterManager.startRun(run)`，run.workspace_path=`/Users/u/code/myapp`，run.work_dir=`/Users/u/.agenthub/worktrees/run_42`
- **THEN** spawn 的 adapter 子进程 cwd=`/Users/u/.agenthub/worktrees/run_42`；agent 在该 worktree 内自由实验，不影响真实 workspace

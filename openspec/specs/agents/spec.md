# agents Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: AgentProfile 数据模型

The system SHALL migrate `AgentProfile` to `AgentBinding` in V1.0. An `AgentBinding` binds a Role to a Runtime (and optionally a ModelConfig), replacing the monolithic `AgentProfile` that combined Persona + Runtime + Model in a single entity.

**V1.0 新数据模型**：

```ts
type AgentBinding = {
  id: string                          // ULID
  workspaceId?: string
  roleId: string                      // → roles.id
  runtimeId: string                   // → runtimes.id
  modelConfigId?: string              // → model_configs.id（仅 runtime.kind="native" 必需）
  overridePermissionProfileId?: string // 覆盖 role 的默认 permission profile
  createdAt: number
  updatedAt: number
}
```

```sql
CREATE TABLE agent_bindings (
  id                        TEXT PRIMARY KEY,
  workspace_id              TEXT,
  role_id                   TEXT NOT NULL REFERENCES roles(id),
  runtime_id                TEXT NOT NULL REFERENCES runtimes(id),
  model_config_id           TEXT REFERENCES model_configs(id),
  override_permission_profile_id TEXT,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL
);
CREATE INDEX idx_agent_bindings_role ON agent_bindings (role_id);
CREATE INDEX idx_agent_bindings_runtime ON agent_bindings (runtime_id);
```

**V0.5 兼容层（3 个月）**：

- `agent_profiles` 表保留（标 deprecated，不再写入）；
- V1.0 daemon 启动时运行 `0014_data.ts` 把每行 `agent_profiles` 拆成对应的 `roles` + `runtimes` + `model_configs` + `agent_bindings` 四表行；
- HTTP middleware：收到旧 `agent_profile_id` 入参时自动 resolve 到对应 `agent_binding_id`；
- 3 个月后 V1.4 删除兼容层 + `agent_profiles` 表。

**Task 三层 assignee**（与 task-workflow-core 联动）：

- `tasks.assignee_role_id`：逻辑归属（Role 维度，UI 主要展示）
- `tasks.assignee_binding_id`：本次派发实际执行者（Run 创建时由 Room 内 role→binding resolve 后写入）
- `tasks.assignee_agent_id`：V0.5 兼容字段，迁移脚本回填，3 个月后 V1.4 删除

#### Scenario: 创建 AgentBinding

- **WHEN** 用户在 Room 创建时选择 role=builder + runtime=claude-code-default
- **THEN** daemon INSERT agent_bindings 行 + emit `agent_binding.created`（durable, visibility=detail）
- **AND** Settings UI 用 POST response 更新本地列表

#### Scenario: native runtime binding 必须有 model_config

- **WHEN** 用户创建 binding：role=builder + runtime=native-default，但未选 model_config
- **THEN** 返回 400 + `{ error: "native_runtime_requires_model_config" }`

#### Scenario: V0.5 旧 agent_profile_id 入参被兼容

- **WHEN** V0.5 客户端发送 `POST /rooms { agentProfileId: "ap_123" }`
- **THEN** daemon middleware 查 `agent_profiles` 表找到对应 `agent_binding_id`，继续处理
- **AND** 响应中返回新的 `agentBindingId` 字段（同时保留旧字段 3 个月）

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
- **THEN** HTTP layer dispatch `CancelRun` Command；RunService 调 `RunLifecycleService.markCancelling(null, runId)`（事务 1：UPDATE runs.status='cancelling' + INSERT events(`agent.run.cancelling`) + outbox），随后**同步**调 `AdapterManager.cancelRun(runId)`（不订阅 `agent.run.cancelled`，避免事件回环）；adapter session 实际结束后 AdapterBridge 调 `RunLifecycleService.cancelFinalized(null, runId)`（事务 2：UPDATE runs.status='cancelled' + INSERT events(`agent.run.cancelled`) + outbox）；RunQueue Worker 订阅该事件释放锁；MessageService 把对应 assistant message status 转 `cancelled` 并发 `message.cancelled`

### Requirement: 内置 Agent（MVP 必带）

The system SHALL ship with the following preconfigured AgentProfile templates, written into `~/.agenthub/agents/` on first launch but only if the file does not exist. **V0.5 新增 `builder-opencode` / `reviewer` / `archivist`**，把内置模板从 4 个 mock+claude pair 升级为开箱即用的 4 个真实角色。

| Agent | provider | 能力 | 默认 presence |
|---|---|---|---|
| `mock-builder` | native | chat, code.edit, file.read, file.write | active |
| `mock-reviewer` | native | chat, code.review, context.read, context.write, intervention.knock | observing |
| `claude-code-builder` | claude-code | chat, code.edit, file.read, file.write, terminal.run, context.read, context.write | active |
| `claude-code-reviewer` | claude-code | chat, code.review, context.read, context.write, intervention.knock | observing |
| `builder-opencode`（**V0.5 新增**） | opencode | chat, code.edit, file.read, file.write, terminal.run, context.read, context.write | active |
| `reviewer`（**V0.5 新增**） | claude-code（默认；可改） | chat, code.review, context.read, context.write, intervention.knock | observing |
| `archivist`（**V0.5 新增**） | claude-code（默认；可改） | chat, context.read, context.write | observing |

每份模板 markdown 头加 `version: <semver>` 字段；首启检查目标路径已存在但 version 较旧时仅 stderr 提示"内置模板有更新可用，运行 `agenthub agents reset --id=<id>` 覆盖"，**不**自动覆盖用户已编辑的文件。

`reviewer` 与 `archivist` 的默认 `provider` 保持 `claude-code`；用户可在 settings 切换 OpenCode（V0.5 新支持）或 V1.x 后续 adapter。`archivist` 默认 prompt 引导生成 `confirmed context summary`，与 PreCompact / Run 终结路径协作。

`builder-opencode` 默认 model = OpenCode CLI 默认（详见 design.md V05-5 开工前调研定）；用户可改。

#### Scenario: 首次启动写入 7 个模板

- **WHEN** daemon 第一次启动，`~/.agenthub/agents/` 不存在或为空
- **THEN** 创建该目录，写入上述 7 个 `.md` 模板；user override 优先（同名文件存在时跳过）

#### Scenario: 内置模板有更新但用户已改

- **WHEN** daemon 启动发现 `~/.agenthub/agents/builder-opencode.md` 存在但 `version` 字段早于内置版本
- **THEN** stderr 警告 `Builtin agent 'builder-opencode' has an update; run \`agenthub agents reset --id=builder-opencode\` to overwrite`
- **AND** **不**覆盖用户文件
- **AND** 不阻断 daemon 启动

#### Scenario: builder-opencode 默认模板含 OpenCode provider

- **WHEN** 用户首启后查 `~/.agenthub/agents/builder-opencode.md`
- **THEN** 模板 frontmatter `provider: opencode`、`adapterId: opencode-default`、`capabilities` 含 `terminal.run`
- **AND** Web UI agent 选择列表显示 builder-opencode

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

### Requirement: AgentBinding CRUD API

The system SHALL expose REST endpoints for AgentBinding management.

| Method | Path | 描述 |
|---|---|---|
| `GET` | `/agent-bindings?workspaceId=<id>` | 列出 bindings（含 role + runtime + model_config 展开信息）|
| `POST` | `/agent-bindings` | 创建 binding |
| `PATCH` | `/agent-bindings/:id` | 更新 binding（如切换 runtime 或 model_config）|
| `DELETE` | `/agent-bindings/:id` | 删除 binding（有 room_participants 引用时拒绝）|

#### Scenario: GET /agent-bindings 展开关联信息

- **WHEN** Settings UI 调 `GET /agent-bindings?workspaceId=w_1`
- **THEN** 返回列表，每行含 `role: { id, name, avatar }` + `runtime: { id, kind, name, detectedVersion }` + `modelConfig?: { id, name, provider, model, apiKeyFingerprint }`
- **AND** 不含 API key 明文

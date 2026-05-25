# permissions Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: PermissionProfile 数据模型

The system SHALL persist PermissionProfile entries that map (agent, resource, action) to one of `allow` / `ask` / `deny`.

```ts
type PermissionAction = "allow" | "ask" | "deny"

type PermissionProfile = {
  id: string
  name: string
  file: {
    read: PermissionAction
    write: PermissionAction
    delete: PermissionAction
    externalDirectory: PermissionAction      // 项目外目录
  }
  shell: Record<string, PermissionAction>    // 命令 glob → action，如 "git *": "allow"
  tool: Record<string, PermissionAction>     // toolName → action，如 "WebFetch": "ask"
  context: {
    read: PermissionAction
    write: PermissionAction
    share: PermissionAction
    memoryWrite: PermissionAction            // V1
  }
  agent: {
    mention: PermissionAction
    invoke: PermissionAction
    interrupt: PermissionAction
    control: PermissionAction
  }
  sensitiveFileWhitelist?: string[]          // glob 默认覆盖见下文
}
```

```sql
CREATE TABLE permission_profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  payload       TEXT NOT NULL,                -- JSON
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE permission_rules (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT,
  agent_id        TEXT,
  resource_type   TEXT NOT NULL,
  resource_match  TEXT NOT NULL,              -- glob 或 JSON
  action          TEXT NOT NULL,
  remember        INTEGER NOT NULL DEFAULT 0, -- "本项目总是允许"
  created_at      INTEGER NOT NULL
);
```

#### Scenario: 内置 PermissionProfile 模板

- **WHEN** daemon 首次启动
- **THEN** 创建以下三个内置 profile：`builder-strict`（写文件 ask、shell ask、tool 默认 ask）；`builder-loose`（项目内写文件 allow、git/test 命令 allow）；`read-only`（所有写都 deny，仅 read/context.read=allow）

### Requirement: 默认敏感文件白名单（deny）

The system SHALL deny `read` and `write` to the following globs unless an explicit per-rule allow exists for that workspace.

```text
.env
.env.*
*.pem
*.key
id_rsa
id_ed25519
.aws/**
.gcp/**
.ssh/**
.netrc
**/credentials.json
**/service-account*.json
```

#### Scenario: Agent 试图读 .env

- **WHEN** ClaudeCodeAdapter 通过 file.read 读 `<workspace>/.env`
- **THEN** Permission Engine 直接 deny；返回原因 `"Sensitive file pattern matched: .env"`；写 audit log；不弹审批卡（避免用户误点 allow）

#### Scenario: 用户显式开启 .env 读取

- **WHEN** 用户在 settings 显式添加规则 `{ workspaceId: "w_1", resource_type: "file.read", resource_match: ".env", action: "ask" }`
- **THEN** 后续读 `.env` 弹审批卡，不再硬 deny

### Requirement: PermissionRequest 与 Deferred 异步审批

The system SHALL create a `PermissionRequest` entity for every `ask` decision and use Effect `Deferred` to suspend the requesting Run until the user resolves it (or it times out).

```ts
type PermissionResource =
  | { type: "file"; path: string; operation: "read" | "write" | "delete" }
  | { type: "shell"; command: string }
  | { type: "tool"; toolName: string; input: unknown }
  | { type: "context"; contextId?: string; operation: "read" | "write" | "share" }
  | { type: "agent"; targetAgentId: string; operation: "invoke" | "interrupt" | "mention" | "control" }

type PermissionRequest = {
  id: string
  workspaceId: string
  roomId: string
  agentId: string
  runId?: string
  resource: PermissionResource
  reason?: string
  status: "pending" | "allowed" | "denied" | "expired"
  rememberDecision?: boolean             // 用户勾选"本项目总是允许"
  scope?: "once" | "this_run" | "this_room" | "this_workspace"
  createdAt: number
  resolvedAt?: number
  expiresAt: number
}
```

默认超时：60 秒 → 自动 `expired`，等价于 deny。

```sql
CREATE TABLE permission_requests (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL,
  room_id             TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  run_id              TEXT,
  resource            TEXT NOT NULL,        -- JSON
  reason              TEXT,
  status              TEXT NOT NULL,
  remember_decision   INTEGER NOT NULL DEFAULT 0,
  scope               TEXT,
  created_at          INTEGER NOT NULL,
  resolved_at         INTEGER,
  expires_at          INTEGER NOT NULL
);
```

#### Scenario: ask 资源进入审批流

- **WHEN** Agent 想跑 `npm install`，PermissionProfile.shell.`npm *` = `ask`
- **THEN** 创建 PermissionRequest `status='pending'`，发 `permission.requested` durable 事件 + 主聊天流 PermissionCard；adapter 的 startRun stream 在 Effect Deferred 上挂起

#### Scenario: 用户 allow 后 Run 继续

- **WHEN** 用户在 PermissionCard 点 allow + 勾选 `"本项目总是允许"`
- **THEN** PermissionRequest.status=`allowed`、scope=`this_workspace`，发 `permission.resolved`；插入 permission_rules 表 `remember=1`；Deferred resolve；Adapter 继续执行 tool

#### Scenario: 60 秒后超时

- **WHEN** 用户 60 秒未点
- **THEN** PermissionRequest.status=`expired`，等价于 deny；Deferred resolve(deny)；Adapter 收到拒绝原因 `"timeout"`；UI 卡片显示已过期

#### Scenario: 用户在多 tab 中操作

- **WHEN** 用户在 tab A 点 allow，tab B 上同一 PermissionCard
- **THEN** SSE 推 `permission.resolved`，tab B 的卡片 UI 自动更新为已解决状态；若 tab B 此时点 deny 后端忽略（已 resolved 不可再变）

### Requirement: 审批粒度（项目内 / 项目外 / 敏感）

The system SHALL classify file paths into three tiers and apply distinct default actions:

| 分类 | 判定 | 默认 action |
|---|---|---|
| 敏感 | 匹配敏感白名单 | deny（不弹卡） |
| 项目外 | 路径不在 `<workspace>` 子树内 | ask（必弹卡） |
| 项目内非敏感 | 在 `<workspace>` 内且不匹配敏感 | profile.file.write/read/delete 决定 |

#### Scenario: 写项目外文件

- **WHEN** Agent 写 `~/Documents/note.md`，workspace 是 `~/code/myapp`
- **THEN** 视为"项目外"，强制 ask（无视 profile.file.externalDirectory 的具体值，最少是 ask）

### Requirement: shell 命令 glob 匹配

The system SHALL match shell commands against `profile.shell` glob patterns; longest match wins; if no match, fall back to `profile.shell.*`（默认 `ask`）.

匹配示例：

```yaml
shell:
  "git *": allow
  "git push *": ask           # 更具体，覆盖 git *
  "rm *": deny
  "*": ask
```

#### Scenario: git push 触发 ask

- **WHEN** Agent 跑 `git push origin main`
- **THEN** 匹配 `git push *` → ask；不匹配 `git *`（被更具体规则覆盖）

#### Scenario: 命令包含管道

- **WHEN** Agent 跑 `cat README.md | wc -l`
- **THEN** Engine 解析顶层为 `cat`、`wc`，分别匹配；任意一段命中 deny 则整体 deny；任意一段触发 ask 则整体 ask

### Requirement: tool / context / agent 资源审批

The system SHALL apply the same `ask/allow/deny` flow uniformly across `tool`, `context`, and `agent` resources, with profile-driven defaults.

例：

- `profile.tool.WebFetch = "ask"` → 每次 WebFetch 弹卡
- `profile.context.share = "ask"` → 跨 workspace 分享 ContextItem 时弹卡
- `profile.agent.interrupt = "deny"` → Agent 不能取消其它 Agent 的 Run

#### Scenario: Agent 试图取消另一 Agent 的 Run

- **WHEN** Agent A 调 `room.cancel_run { runId: B's }`，A 的 profile.agent.interrupt = deny
- **THEN** Permission Engine deny；返回原因 `"agent.interrupt denied"`

### Requirement: "本项目总是允许"持久化

The system SHALL persist `remember=true` decisions into `permission_rules` and consult them on the fast path before issuing a new PermissionRequest.

#### Scenario: 二次写同文件直接 allow

- **WHEN** 用户上次 allow 过写 `src/auth.ts` 并勾选"本项目总是允许"
- **THEN** Agent 这次写 `src/auth.ts` 不弹卡，直接 allow；写 audit log（"matched stored rule rule_42"）

### Requirement: Permission API

The system SHALL expose the following HTTP routes for permission profiles, requests, and rules; mutating routes MUST emit `permission.requested` / `permission.resolved` durable events as appropriate.

```
GET    /permissions/profiles
GET    /permissions/profiles/:id
POST   /permissions/profiles
PATCH  /permissions/profiles/:id

GET    /permissions/requests?status=pending&roomId=
POST   /permissions/:id/resolve              # body: { decision: "allow"|"deny", remember?: boolean, scope? }
GET    /permissions/rules?workspaceId=
DELETE /permissions/rules/:id
```

#### Scenario: 列出待审批请求

- **WHEN** UI 启动时 `GET /permissions/requests?status=pending&roomId=r_1`
- **THEN** 返回该 Room 当前所有 pending 的请求（用于 SSE 重连后补卡片）

### Requirement: Audit log

Every permission decision SHALL be persisted as a `permission.resolved` durable event with full context (`resource`, `decision`, `reason`, `remembered`, `matchedRuleId?`).

#### Scenario: 通过 stored rule 直接 allow

- **WHEN** 命中 `permission_rules` 跳过 PermissionRequest 直接放行
- **THEN** 仍发 `permission.resolved` 事件 payload `{ decision: "allow", reason: "matched stored rule", matchedRuleId: "rule_42", requested: false }`

### Requirement: Per-session 串行化、幂等键、Prompt Timeout Pause

The system SHALL serialize pending permission prompts per `(adapterSessionId)`; SHALL deduplicate concurrent permission requests by `(adapterRequestId | toolCallId)` idempotency keys; AND SHALL pause adapter prompt timeouts while a permission is pending so users have time to decide without the prompt itself timing out underneath.

> **Why**：参考实现观察到三类真实事故 — opencode 的 per-session permission queue 解决了同一 session 多 permission 同时弹卡导致的顺序混乱；AionUi 文档记录了相同 toolCallId 重复 emit permission 时旧 pending 被覆盖、第一个 deferred 永远 resolve 不了的 bug；多个 ACP 实现观察到当 permission 等待 30s+ 时 adapter 内部 prompt timeout 触发，permission 决议来时 session 已死。三个坑 MVP 必须正面解决。

**1. Per-session 串行化**：

- PermissionEngine 维护 `Map<adapterSessionId, Queue<PermissionRequest>>`；同 session 同时只暴露**一个** pending 卡片给用户；后入的 request 入队列，前一个 resolve 后再 emit `permission.requested` durable event。
- 例外：adapter manifest 声明 `concurrentPermission: true` 才允许同 session 多卡（MVP 内置 adapter 全部为 false）。
- 跨 session 不串行：不同 adapter session 的 permission 仍并行展示。

**2. 幂等键**：

```ts
type PermissionIdempotencyKey =
  | { kind: "tool_call"; adapterSessionId: string; toolCallId: string }
  | { kind: "rpc_request"; adapterSessionId: string; adapterRequestId: string }
  | { kind: "explicit"; key: string }              // adapter 主动声明
```

PermissionEngine MUST：
- 入站新 PermissionRequest 时先按 idempotencyKey 查 `permission_requests WHERE status='pending'`；命中 → **返回已有 request**，不创建新行、不 emit 第二次 `permission.requested`、不覆盖原 Deferred（关键：opencode-style 的"覆盖 pending"是已知 bug）。
- 命中已 resolved 的同 idempotencyKey → 视情况：若 `resolved_at` 在最近 5s 内且 decision=allow，可 short-circuit allow（避免 adapter retry 误触发二次审批）；否则当作新 request。

`permission_requests` 表追加列：

```sql
ALTER TABLE permission_requests ADD COLUMN idempotency_key TEXT;
ALTER TABLE permission_requests ADD COLUMN adapter_session_id TEXT;
CREATE UNIQUE INDEX uniq_perm_idemp_pending
  ON permission_requests (idempotency_key, status)
  WHERE status = 'pending';
```

**3. Prompt Timeout Pause**：

- adapter prompt 内部 timeout（如 ACP `prompt` JSON-RPC 默认 60s）MUST 在该 session 进入 permission pending 时**暂停**，permission resolved（或 expired）后**恢复**。
- 实现：AdapterBridge 在 emit `permission.requested` 时调 `adapter.pausePromptTimeout(sessionId)`；在 `permission.resolved` 后调 `adapter.resumePromptTimeout(sessionId)`。
- 兜底：单条 permission 等待时长 MUST ≤ `maxPermissionWait`（默认 600s = 10 分钟，可配）；超出强 deny `expired_max_wait`，UI 解释"此次已超过最长等待，自动拒绝；下次再触发时重新弹卡"。
- 与 60s 自动 expired 的关系：默认 `expires_at = createdAt + 60s` 仍生效，但 60s timeout 是单次卡片 UI 显式倒计时；用户在 60s 内点击"延后"或"还在看"按钮 → expires_at 顺延（最多到 maxPermissionWait）。

#### Scenario: 同 session 两 tool 串行弹卡

- **WHEN** Claude 同 session 内并行触发 `Bash npm install` 与 `Bash git push`，两者都是 ask
- **THEN** Engine 先 emit `permission.requested` for npm install；用户 resolve 后再 emit for git push；UI 不会同时显示两张 PermissionCard

#### Scenario: 同 toolCallId 重发 permission 不覆盖

- **WHEN** Adapter 因 retry 对同 `toolCallId=tc_42` 第二次 emit `permission.requested`
- **THEN** Engine 命中幂等键 → 返回已有 PermissionRequest id；不写第二行；不覆盖原 Deferred；adapter 收到原 PermissionRequest 状态

#### Scenario: 等待 permission 时不被 adapter timeout 干掉

- **WHEN** 用户花 90s 决定一个 permission，adapter ACP prompt 默认 60s 超时
- **THEN** AdapterBridge 在 `permission.requested` 时调 pausePromptTimeout，prompt 不超时；resolved 后 resume；adapter session 仍存活完成 tool

#### Scenario: 超长等待自动 expired_max_wait

- **WHEN** 用户离开电脑 12 分钟未处理 permission，maxPermissionWait=600s
- **THEN** 600s 时 PermissionRequest.status='expired'、reason='expired_max_wait'；adapter 收到 deny + 原因；UI 展示"超过最长等待自动拒绝"

#### Scenario: 5 秒内 retry 短路 allow

- **WHEN** adapter 因为内部重试在 2s 内对同 idempotencyKey 再次发 permission，上次刚 allow
- **THEN** Engine 不弹第二张卡，直接返回 allowed；emit `permission.resolved { reason: "short_circuit_repeat", requested: false }` audit；adapter 继续 tool 调用


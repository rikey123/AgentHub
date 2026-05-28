# context-ledger Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: ContextItem 数据模型

The system SHALL persist ContextItem with the following schema, and Agent-originated rows SHALL only be created with `status='draft'`.

```ts
type ContextItem = {
  id: string                              // ULID
  workspaceId: string
  roomId?: string
  taskId?: string
  runId?: string
  type:
    | "fact"                              // 客观事实（如"项目用 Supabase Auth"）
    | "decision"                          // 决策（如"暂不引入 Redis"）
    | "constraint"                        // 约束（如"必须支持 IE11"）
    | "issue"                             // 已知问题（如"X 在 Y 浏览器有 bug"）
    | "artifact"                          // 关联产物（如"v3 设计图"）
    | "preference"                        // 用户偏好（如"喜欢 named exports"）
    | "summary"                           // 长会话压缩摘要
  scope: "conversation" | "task" | "workspace" | "user"
  content: string                         // 主体（短句优先，最多 ~500 字符）
  source: {
    type: "user" | "agent" | "tool" | "file" | "system"
    id?: string                           // userId / agentId / toolName / filePath
  }
  visibility: {
    agents?: string[]                     // 允许看到的 agentIds（空=全部）
    roles?: string[]                      // 角色白名单
    users?: string[]
  }
  status: "draft" | "confirmed" | "deprecated" | "disputed"
  confidence: "verified" | "inferred" | "unverified"
  version: number                         // 乐观锁
  ownerId?: string
  ownerType?: "user" | "agent" | "system"
  createdBy: string                       // userId 或 agentId
  pinned?: boolean
  createdAt: number
  updatedAt: number
}
```

```sql
CREATE TABLE context_items (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  room_id         TEXT,
  task_id         TEXT,
  run_id          TEXT,
  type            TEXT NOT NULL,
  scope           TEXT NOT NULL,
  content         TEXT NOT NULL,
  source          TEXT NOT NULL,           -- JSON
  visibility      TEXT NOT NULL,           -- JSON
  status          TEXT NOT NULL,
  confidence      TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  owner_id        TEXT,
  owner_type      TEXT,
  created_by      TEXT NOT NULL,
  pinned          INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_ctx_workspace_scope ON context_items (workspace_id, scope, status);
CREATE INDEX idx_ctx_room ON context_items (room_id, status);
CREATE INDEX idx_ctx_task ON context_items (task_id, status);

CREATE TABLE context_versions (
  context_id      TEXT NOT NULL,
  version         INTEGER NOT NULL,
  payload         TEXT NOT NULL,           -- 该版本的完整 JSON 快照
  changed_by      TEXT NOT NULL,
  changed_at      INTEGER NOT NULL,
  PRIMARY KEY (context_id, version)
);
```

#### Scenario: Agent 提议 ContextItem

- **WHEN** ClaudeCodeAdapter 通过 `room.propose_context` MCP tool 提出 `{ type: "fact", content: "API base path is /api/v2" }`
- **THEN** daemon 写 context_items 表 `status='draft', source={ type: "agent", id: <agentId> }, confidence='inferred', version=1`，发 `context.item.created` + `context.item.proposed` 事件，UI 在右侧 Context View 显示草稿带 ✅/❌ 操作

#### Scenario: 用户确认 ContextItem

- **WHEN** 用户点 ContextCard 的 confirm
- **THEN** daemon 把 `status` 从 `draft` 改 `confirmed`，bump `version`，写 context_versions 历史，发 `context.item.confirmed` 事件

#### Scenario: Agent 直接写 confirmed 被拒

- **WHEN** Adapter 试图通过任何方式提交一条 `status='confirmed'` 的 ContextItem
- **THEN** ContextLedger 服务拒绝该写入，强制改成 `draft`；写 audit log；返回 `{ ok: false, downgraded: true }`

### Requirement: 版本乐观锁与冲突

The system SHALL require every `update` to include the base `version`; mismatched versions emit `context.item.conflict_created` and surface a "判决卡" UI.

```ts
type UpdateContextItemInput = {
  id: string
  baseVersion: number
  patch: Partial<Pick<ContextItem, "content" | "scope" | "visibility" | "status" | "type" | "pinned">>
}
```

#### Scenario: Reviewer 在 Builder 改完后试图修改同 ContextItem

- **WHEN** ContextItem `c_5` 当前 version=3，Builder 刚把它改成 version=4，Reviewer 用 baseVersion=3 提交修改
- **THEN** ContextLedger 拒绝写入，发 `context.item.conflict_created { contextId: "c_5", baseVersion: 3, currentVersion: 4 }`；UI 弹"判决卡"显示两版差异 + 三个选项（保留 Builder / 保留 Reviewer / 手动合并）

#### Scenario: 用户裁决保留版本

- **WHEN** 用户在判决卡选"保留 Reviewer 版本"
- **THEN** daemon 用 Reviewer 内容覆盖、version 升到 5，发 `context.item.update_requested` + 完成事件，关闭判决卡

### Requirement: Scope 升级（Pin）

The system SHALL allow scope upgrade via `POST /context/:id/pin` which sets `scope='workspace'` and `pinned=true`, emitting `context.item.visibility.changed`.

层级：`conversation < task < workspace < user`。降级（unpin）允许但要求显式确认。

#### Scenario: 把任务级事实升级到工作区级

- **WHEN** ContextItem 当前 `scope='task'`，用户 `POST /context/:id/pin`
- **THEN** scope 变 `workspace`、pinned=true、发 `context.item.visibility.changed`；后续所有该 workspace 下的 Run 都会在 prompt assembly 看到该 ContextItem

### Requirement: 可见性矩阵

The system SHALL filter ContextItems for each Agent at prompt-assembly time according to `visibility.agents` / `visibility.roles` rules.

```ts
function isVisible(ci: ContextItem, agent: AgentProfile): boolean {
  const v = ci.visibility ?? {}
  if (v.agents && v.agents.length > 0 && !v.agents.includes(agent.id)) return false
  if (v.roles && v.roles.length > 0 && !v.roles.some(r => agent.capabilities.includes(r as AgentCapability))) return false
  // users 字段不影响 Agent 可见性，仅影响 UI
  return true
}
```

#### Scenario: 仅对 reviewer 可见的 ContextItem

- **WHEN** ContextItem 设置 `visibility.agents = ["security-reviewer"]`
- **THEN** Builder 的 prompt assembly 不包含该 ContextItem；Security 的 prompt 包含

### Requirement: Context Assembly v0（规则版）

The system SHALL assemble context for a Run using the following deterministic priority order, truncating at the configured token budget.

优先级（高 → 低）：

1. workspace 级 `pinned` ContextItem（confirmed）
2. 当前 task 的 confirmed ContextItem（按 updatedAt 降序）
3. 当前 room 最近 N 条 confirmed ContextItem（默认 N=20）
4. 当前 task 的 draft ContextItem（标注"未确认"前缀）
5. 最近 K 条 messages（默认 K=30，按 createdAt 降序，去除已删除）
6. 引用的 attachment 文件（仅文件名 + size，正文 V1.2 才接入，与 vector-search / BM25 召回一起）

Token 预算（D9 推荐）：

```ts
type ContextBudget = {
  systemRoleCapsPct: number       // 默认 0.15
  pinnedConfirmedPct: number      // 默认 0.20
  taskSummaryPct: number          // 默认 0.15
  recentMessagesPct: number       // 默认 0.25
  attachmentsPct: number          // 默认 0.15
  safetyMarginPct: number         // 默认 0.10
  totalTokens: number             // 由 adapter manifest 提供，默认 16000
}
```

#### Scenario: Prompt assembly 输出顺序

- **WHEN** 触发 Run 时调 `assembleContext({ runId, agentProfile, budget })`
- **THEN** 返回值按上述 1→6 顺序排列，每段标记来源；超过预算时按"draft 先丢、最远 message 先丢"策略裁剪

#### Scenario: 用户 pin 后下一次 Run 立刻包含

- **WHEN** 用户在 Run 之间 pin 了一条 ContextItem
- **THEN** 下一次该 workspace 内任意 Run 的 assembled context 第一段就包含该项

### Requirement: 注入三档与 UI 透明

The system SHALL classify every Context update by `injectionMode = adapter.manifest.context.injectionMode` and surface this to the UI.

- `immediate`：当前 in-flight Run 通过 `adapter.injectContext()` 实时注入。
- `next_turn`：标记 sessionId 为 `pending_inject`，下一条 user message 触发 Run 时 prepend 注入文本。
- `next_session`：标记 sessionId 为 `requires_restart`；UI 提示"需重启会话才会生效"，下次 createSession 时注入。

```ts
type ContextInjectionResult = {
  mode: "immediate" | "next_turn" | "next_session"
  applied: boolean
  effectiveAt?: "now" | "next_turn" | "next_session"
  reason?: string
}
```

#### Scenario: Claude Code 实时注入

- **WHEN** 用户 confirm 一条 ContextItem，Claude Code adapter 当前在 active Run
- **THEN** adapter `injectContext()` 走 hook 立即写入下一个 prompt 边界；返回 `{ mode: "immediate", applied: true, effectiveAt: "now" }`

#### Scenario: Codex 必须下一轮

- **WHEN** Codex adapter `injectionMode = "next_turn"`，用户在 Codex 跑某 prompt 中途 confirm context
- **THEN** adapter 标记 pending；UI 显示"已记录，下一轮 Codex 才会看到"

### Requirement: ContextItem 写入 / 修改 / 状态流的 MCP Tools

The system SHALL expose the following Room MCP Tools to Agents (详见 orchestrator capability):

```
room.read_context        # 列出对该 Agent 可见的 ContextItem
room.propose_context     # 写 draft ContextItem
room.write_context       # 写 confirmed ContextItem，仅当 source.type='tool' 且 confidence='verified' 时被 Engine 接受；其余强制降级为 draft
room.deprecate_context   # 标记 deprecated（带 reason）
```

#### Scenario: Tool 来源的 verified 写入

- **WHEN** 一个外部 tool（如 git blame 工具）通过 MCP `room.write_context` 提交 `{ type: "fact", content: "auth.ts last touched by alice 2 weeks ago", source: { type: "tool", id: "git" }, confidence: "verified" }`
- **THEN** ContextLedger 接受 `confirmed` 状态写入；事件标 `context.item.confirmed { byUserId: null, source: "tool" }`

#### Scenario: Agent 用 write_context 试图绕过 draft

- **WHEN** Agent 通过 MCP `room.write_context` 想直接写 confirmed
- **THEN** ContextLedger 强制降级为 draft，发 `context.item.proposed`；UI 仍只显示"待确认"

### Requirement: confirmed 写入需 trusted_system_tool 白名单

The system SHALL accept `room.write_context` confirmed-status writes ONLY when the call's `source.kind` is in a daemon-managed `trusted_system_tool` allowlist. Even if a caller declares `source.type='tool'` and `confidence='verified'`, ContextLedger MUST further check that `source.kind` is allowlisted; otherwise the write SHALL be downgraded to `draft` and emit `context.item.proposed`. This closes the "verified-by-tool" loophole noted in design red lines.

```ts
type TrustedSystemToolEntry = {
  kind: string                       // 例: "git-blame" / "lsp-definition" / "filesystem-watch"
  description: string
  managedBy: "daemon-builtin" | "user-explicit"  // 用户显式可加
}
```

allowlist 来源（按优先级）：

1. **daemon 内置**：`git-blame` / `git-log` / `filesystem-watch` / `lsp-definition` / `package-manifest-parse`（可由 daemon 升级扩展）。
2. **用户显式开启**：`config.toml [context.trusted_tools] kinds = ["my-internal-validator"]`，并要求 daemon 启动时输出 audit log 列出当前白名单。
3. **adapter 自行声明**：MUST NOT 直接被信任；MUST 在用户 settings 显式批准后才进入 allowlist。

`source.kind` 不在白名单 → 即便携带 `confidence='verified'` 与 `source.type='tool'`，ContextLedger 也强制降级 `draft` + 写 audit log `"context_write_downgraded reason=untrusted_tool_kind"`。

#### Scenario: 内置 tool kind 通过

- **WHEN** daemon 内置 git-blame tool 通过 MCP `room.write_context { source: { type: "tool", kind: "git-blame", id: "git" }, confidence: "verified" }`
- **THEN** ContextLedger 接受 `confirmed` 写入；emit `context.item.confirmed { byUserId: null, source: "git-blame" }`

#### Scenario: agent 自定义 tool kind 被降级

- **WHEN** Agent 通过 adapter 声明的自定义 MCP tool（kind="my-claim-verifier"）调 `room.write_context` 提交 `confidence: "verified"`，但用户从未在 settings 批准该 kind
- **THEN** 强制降级 draft + emit `context.item.proposed` + audit log `untrusted_tool_kind`；UI 不展示 confirmed 状态

#### Scenario: 用户显式开启 kind

- **WHEN** 用户在 settings 加 `[context.trusted_tools] kinds = ["my-claim-verifier"]`，daemon 启动时打印 "Trusted context tools: git-blame, ..., my-claim-verifier"
- **THEN** 该 kind 后续 confirmed 写入被接受；用户可随时移除

### Requirement: 长会话压缩 → ContextItem.summary

The system SHALL convert any incoming `context.snapshot` AdapterEvent (e.g. Claude Code PreCompact, OpenCode summarize hook) into a ContextItem with `type='summary', scope='task', status='draft', confidence='inferred'`.

V0.5 落实 ClaudeCodeAdapter PreCompact 路径（MVP §12.7 缺）；OpenCodeACPAdapter 的 summarize hook 走相同路径（事件类型一致）。

幂等：context.snapshot 事件携带 idempotencyKey（推荐 `<adapter>_compact:<runId>`），ContextLedger 命中已有 draft 时不重复 propose。

#### Scenario: Claude Code 触发 PreCompact

- **WHEN** Claude Code 在 Run 内执行 PreCompact 钩子
- **THEN** Adapter emit `context.snapshot { snapshot: { kind: "claude_compact", text }, idempotencyKey: "claude_compact:<runId>" }`
- **AND** ContextLedger 写入 summary draft（`type='summary', status='draft', source.kind='tool', source.id='claude_code_compact'`）
- **AND** UI 显示"会话已压缩，可在 Context View 确认摘要"

#### Scenario: 同 runId 重复 PreCompact 幂等

- **WHEN** Claude Code 在同一 Run 内连续触发两次 PreCompact（如长会话自动二次压缩）
- **THEN** ContextLedger 第二次按 idempotencyKey 命中已有 draft，不重复 propose
- **AND** 第一次 propose 的 summary draft 保留（用户可在 UI 二选一或合并）

#### Scenario: OpenCode 触发同类 snapshot

- **WHEN** OpenCodeACPAdapter 触发 summarize hook 发 `context.snapshot { snapshot: { kind: "opencode_compact", text }, idempotencyKey: "opencode_compact:<runId>" }`
- **THEN** ContextLedger 走与 Claude Code 完全一致的 propose 路径
- **AND** source.id=`opencode_compact`（区分 adapter 来源用于 audit）

### Requirement: V1.2 向量检索接口预留

The system SHALL define `vectorIndex` interface stubs (no implementation in MVP) so that V1.2 can plug in `sqlite-vec` without changing assembly contract.

```ts
interface VectorIndex {
  search(query: string, k: number, filter?: ContextFilter): Effect.Effect<ContextHit[], never>
  upsert(item: ContextItem): Effect.Effect<void, never>
  remove(id: string): Effect.Effect<void, never>
}
```

MVP 提供 `NoopVectorIndex`：所有方法返回空 / no-op。

#### Scenario: Assembly 在 NoopVectorIndex 下回退到规则

- **WHEN** Context Assembly 调用 `vectorIndex.search("auth.ts changes", 8)` 但实际是 NoopVectorIndex
- **THEN** 返回空数组；assembly 仅按上述 6 步规则；不抛错

### Requirement: BriefGenerator 接口（V0.5 启发式 / V1.2 LLM）

The system SHALL define a `BriefGenerator` interface in `packages/context` that produces a one-line human-readable summary string for a finalized Run, used to fill the `message.brief.published` event payload (per `messaging/主流摘要 / Agent Run Detail 双投影`).

```ts
interface BriefGenerator {
  /**
   * Synchronously generate a brief summary for a finalized run.
   * MUST be deterministic for testability; MUST NOT block longer than 50ms in V0.5.
   * Called by the caller (AdapterBridge / Orchestrator terminal hook) OUTSIDE the transaction;
   * the resulting string is passed as briefText to RunLifecycleService.complete/fail/cancelFinalized
   * which writes it inside the transaction alongside the run terminal event.
   * Exceptions MUST be caught by the caller and fallback to empty string ("").
   */
  generate(input: BriefGeneratorInput): Effect.Effect<string, never>
}

type BriefGeneratorInput = {
  runId: string
  finalAssistantText?: string         // 最后一条 assistant message 全文（如有）
  artifactCounts: {
    diff: number
    file: number
    tool: number
  }
  failureClass?: RunFailureClass      // 失败 Run 才有
  failureReason?: string
  cancelled?: boolean
}
```

V0.5 默认实现 `HeuristicBriefGenerator`：

- 取 `finalAssistantText` 第一句作为主干（按空白行 + 中英文标点 `。？！.?!` 切分，跳过代码块开头三反引号行）
- 主干最长 **120 字符**截断，超出加 `…`
- 主干为空时（如失败 Run 无 assistant 输出）：
  - 失败：`<failureReason>`（取 failureClass 的人类可读模板，如 `"transient: lock_timeout"` → `"Lock timed out, retrying"`）
  - 取消：`"User cancelled this run"`
- 后缀拼接 artifact 统计：`（artifacts: ${diff} diff / ${file} files / ${tool} tools）`，**仅在任一计数 > 0 时**追加
- 解析失败 → 退化为 `finalAssistantText` 前 120 字符纯字符串截断 + `…`

V1.2 必换 `LlmBriefGenerator`：

- Memory pipeline 自然有 LLM 通路 + cost 已可治理（Memory Gateway / Cost 面板都已上线）
- 调用同步阻塞改为最长 5s 超时，超时退化到 `HeuristicBriefGenerator`
- 接口 `generate()` 签名不变；调用点 RunLifecycleService 不需要改

`BriefGenerator` 注入由 `cost-panel-local` 之外的所有 capability 完全无感知（接口 + Layer 注入）。

#### Scenario: 启发式生成成功 brief

- **WHEN** Run 完成，finalAssistantText = `"我已添加 OAuth 校验逻辑到 src/auth.ts，并修复了 cookie 过期处理。"`，artifactCounts = `{diff:1, file:0, tool:3}`
- **THEN** `HeuristicBriefGenerator.generate()` 返回 `"我已添加 OAuth 校验逻辑到 src/auth.ts，并修复了 cookie 过期处理。（artifacts: 1 diff / 0 files / 3 tools）"`
- **AND** RunLifecycleService 在同事务把该字符串写入 `message.brief.published.payload.text`

#### Scenario: 启发式截断超长第一句

- **WHEN** finalAssistantText 第一句长度 > 120 字符
- **THEN** brief 主干 = `<前 119 字符>…`
- **AND** 后缀 artifact 统计照常拼接（不计入 120 字符）

#### Scenario: 失败 Run 用 failureClass 模板

- **WHEN** Run failureClass=`transient`、reason=`lock_timeout`、finalAssistantText 缺失
- **THEN** brief = `"Lock timed out, retrying（artifacts: 0 diff / 0 files / 2 tools）"`（artifact 计数若有则拼）
- **AND** UI 主流显示该 brief 红色样式

#### Scenario: 取消 Run

- **WHEN** Run cancelled=true、finalAssistantText 缺失、artifacts 全零
- **THEN** brief = `"User cancelled this run"`
- **AND** 不追加 artifacts 后缀

#### Scenario: 解析失败退化为纯截断

- **WHEN** finalAssistantText 含异常 BiDi 字符或无标点的连续 200 字符
- **THEN** HeuristicBriefGenerator 退化为前 120 字符 + `…`
- **AND** 不抛错；不阻断 RunLifecycleService.complete

#### Scenario: V1.2 替换实现不改调用点

- **WHEN**（V1.2）daemon Layer 把 `BriefGenerator` 注入从 `HeuristicBriefGenerator` 换成 `LlmBriefGenerator`
- **THEN** RunLifecycleService 调用代码 0 行变更
- **AND** 启发式作为 fallback 仍可用（LLM 超时 5s 退化）


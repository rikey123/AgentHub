# artifacts Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: Artifact 数据模型

The system SHALL include `worktree_diff` as a first-class artifact type and SHALL include `ready_for_review`, `conflict`, and `discarded` as valid artifact statuses for the worktree review lifecycle.

`ArtifactFile` rows for diff-like artifacts SHALL expose enough per-file metadata for review UI:
- `path`
- optional `oldPath`
- `fileStatus`
- optional `patch`
- `additions`
- `deletions`
- optional binary/no-newline flags

#### Scenario: Worktree diff stores per-file rows

- **WHEN** a worktree run changes three files and reaches `session.ended`
- **THEN** the daemon creates one `worktree_diff` artifact and three `artifact_files` rows, one per changed file
- **AND** the artifact metadata retains the full patch for apply/recovery

### Requirement: Diff Artifact 状态机

The system SHALL move Diff Artifact through the following states with **applying** as an explicit intermediate "writing to disk" phase. Failure SHALL come from `accepted` or `applying`, never from `applied`.

```
draft
  ↓ (UI 展开 / 用户查看)
reviewing
  ├─ accept → accepted ─→ applying ─→ applied
  │                  │         │
  │                  ├─ failed ┘ (应用流程任一阶段失败)
  │                  └─ failed (校验阶段失败：stale_base / permission denied / 多文件部分失败)
  └─ reject → rejected
```

ArtifactStatus 含义：

- `draft`：Agent 刚提交，UI 未展开。
- `reviewing`：UI 展开 / 用户在审查。
- `accepted`：用户已点 accept，进入应用前的预校验阶段（sha256 对比、权限校验）。
- `applying`：预校验通过，正在写盘（多文件原子替换中，进入此状态时已无回头）。
- `applied`：所有目标文件原子替换完成。
- `rejected`：用户点 reject。
- `failed`：流程任一阶段失败；artifact 不可再 apply（用户需重新生成 Diff）。

`applied → failed` 不存在。已落盘后再发现问题，必须通过 `revert` 创建反向 patch 修复。

#### Scenario: Agent 提交 Diff

- **WHEN** Agent 通过 MCP `room.publish_artifact { type: "diff", files: [...] }` 提交一个 Diff
- **THEN** daemon 写 artifacts + artifact_files 表 `status='draft'`，发 `artifact.diff.created` durable 事件，主聊天流插入 DiffCard

#### Scenario: 用户展开 Diff 转 reviewing

- **WHEN** 用户点 DiffCard 上的"查看"按钮
- **THEN** status=`reviewing`、发 `artifact.reviewing` 事件；Monaco Diff 全屏视图打开

#### Scenario: 用户接受 + 应用（多文件 best-effort transactional）

> **命名澄清**：本流程称为 **best-effort transactional apply**，不是严格的多文件原子事务。POSIX 文件系统对单文件 `rename()` 提供原子语义，但**没有**跨多个文件的原子 commit 原语。我们通过"预校验 + sibling 临时文件 + 失败回滚 + 回滚失败兜底"组合，把不一致窗口压到最小，但实现者必须知道：在极端情况下（电源中断、回滚也失败）磁盘可能停在部分变更状态，此时 `artifact.failed` payload 会带 `recovery_required: true` + 受影响文件列表，由用户介入。

- **WHEN** 用户点 accept，artifact 含多个文件
- **THEN** 应用流程：
  1. status=`accepted`，发 `artifact.accepted`
  2. **预校验阶段**（仍在 accepted，未碰盘）：
     - 对**全部** files 计算当前磁盘 sha256，全部与 `oldSha256` 匹配；任一不匹配 → status=`failed`，发 `artifact.failed { reason: "stale_base", path: <first mismatch>, recoveryRequired: false }`，**不写任何文件**
     - 经 Permission Engine `file.write` 一次性请求覆盖所有 files；任一被 deny → status=`failed`，发 `artifact.failed { reason: "permission_denied", path, recoveryRequired: false }`
  3. **应用阶段**（best-effort transactional）：
     - status=`applying`，发 `artifact.applying`
     - 对每个 file 写到 sibling 临时文件 `<path>.agenthub-tmp-<artifactId>`（同目录、同 fs，确保 rename 原子）
     - 全部临时文件写盘成功后，再依次按**字典序** `rename(tmp, target)`（POSIX rename 单文件原子；多文件**串行**执行，不存在跨文件原子）
     - 所有 rename 成功 → status=`applied`、appliedAt=now、发 `artifact.applied`
     - 中途某次 write 或 rename 失败 → 进入**回滚**：① 删除尚未 rename 的临时文件 ② 已 rename 的文件按倒序用 `oldContent` 写回；
       - 回滚成功 → status=`failed`、发 `artifact.failed { reason: "apply_partial", failedAt: <path>, rolledBack: <count>, recoveryRequired: false }`
       - **回滚自身失败**（写回 oldContent 又出错，例如磁盘满 / 权限丢失）→ status=`failed`、发 `artifact.failed { reason: "recovery_required", failedAt: <path>, rolledBack: <count>, recoveryRequired: true, affectedFiles: [...] }`；artifact_files 行的 `applied_state` 字段标记每个文件最终落到了 `original` / `new` / `unknown`，UI 在 DiffCard 显示红色横幅 + 受影响文件清单 + 操作建议（"请人工核对这些文件，必要时从 git 恢复"）

`artifact.failed` payload 字段总结：

```ts
type ArtifactFailedPayload = {
  artifactId: string
  reason: "stale_base" | "permission_denied" | "apply_partial" | "recovery_required"
  failedAt?: string                    // 出错的文件路径
  rolledBack?: number                  // 已回滚的文件数（apply_partial / recovery_required）
  recoveryRequired: boolean
  affectedFiles?: { path: string; appliedState: "original" | "new" | "unknown" }[]   // recovery_required 时必填
}
```

#### Scenario: 应用前文件已被外部修改

- **WHEN** apply 预校验时检测到 `auth.ts` 当前 sha256 != `oldSha256`
- **THEN** 不进入 applying；status=`failed`、发 `artifact.failed { reason: "stale_base", path: "auth.ts", recoveryRequired: false }`；磁盘上**没有**任何文件被改动；UI 提示用户文件已外部变更，需重新生成 Diff

#### Scenario: 多文件 apply 中途失败回滚

- **WHEN** artifact 含 3 文件，前 2 个 rename 成功，第 3 个文件因磁盘满 rename 失败
- **THEN** 进入回滚：先删除第 3 个临时文件（如已写入磁盘）；再用 `oldContent` 把第 1、2 个文件回写到原内容；回滚成功 → status=`failed`、发 `artifact.failed { reason: "apply_partial", failedAt: <file3>, rolledBack: 2, recoveryRequired: false }`；用户在 UI 看到详细原因 + 文件列表

#### Scenario: 回滚也失败 → recovery_required

- **WHEN** artifact 含 3 文件，前 2 个 rename 成功，第 3 个 rename 失败 → 触发回滚；回滚阶段写回第 2 个文件 oldContent 又因磁盘满失败
- **THEN** status=`failed`、发 `artifact.failed { reason: "recovery_required", failedAt: <file2>, rolledBack: 1, recoveryRequired: true, affectedFiles: [{ path: <file1>, appliedState: "original" }, { path: <file2>, appliedState: "unknown" }, { path: <file3>, appliedState: "original" }] }`；artifact_files 表持久化 `applied_state` 列；UI DiffCard 显示红色横幅 + "需要人工恢复" + 各文件最终状态 + 建议从 git 恢复

#### Scenario: applied 后不再 failed

- **WHEN** artifact status=`applied`，磁盘文件之后被外部修改
- **THEN** 不会有 `artifact.failed` 事件回流；要恢复必须走 `POST /artifacts/:id/revert` 走完整的 reviewing → applied 流程

#### Scenario: 用户拒绝

- **WHEN** 用户点 reject 并填 reason
- **THEN** status=`rejected`、发 `artifact.rejected { reason }`；不写盘

### Requirement: Diff 应用可逆

The system SHALL retain `oldContent` for every applied DiffArtifact for at least 30 days, and SHALL expose `POST /artifacts/:id/revert` to roll back.

revert 实质上创建一个**新** artifact `type=diff` 反向 patch，按上述流程走 reviewing → applied。

#### Scenario: 用户 5 分钟后回滚

- **WHEN** 用户对一个 status=`applied` 的 Diff `POST /artifacts/:id/revert`
- **THEN** daemon 用 `oldContent` 与当前文件计算反向 patch，创建新 artifact `status='reviewing'` 自动跳过 draft；用户 accept 即回滚

### Requirement: 多 Agent 改同文件互斥（D7）

The system SHALL serialize Agent runs whose anticipated `targetFiles` overlap; concurrent runs touching different files MAY run in parallel. **File locks live in the `bus-runtime/RunQueue` capability** (`run_locks` table, `lock_type='file'`); AdapterManager and AdapterBridge MUST NOT touch locks.

实现要点：

- 每个 Run 在 `WakeAgent` Command 时声明 `targetFiles`（Agent 通过 MCP 主动声明，或 Orchestrator 从 prompt 解析；MVP 用 Agent 主动声明），由 WakeAgent handler 透传给 `RunLifecycleService.create`。**重型 coding agent（Claude Code / Codex）在 Run 开跑前往往无法精确预测会改哪些文件**，此时 `targetFiles` MAY 为 `undefined`：
  - **退化策略**：RunQueue Worker 看到 `targetFiles` 为空时申请 `lock_type='workspace', lock_key=<workspaceId>, workspace_id=<workspaceId>` 整 workspace 写锁。该锁与同 workspace 内所有 `lock_type='file'` 锁互斥（详见 `bus-runtime/RunQueue 是 bus 的一条命名队列` 中 "workspace ↔ file 互斥规则"），从而防止"声明了 file 锁的 Run_A 与未声明 targetFiles 的 Run_B 在同 workspace 并行写"的问题。
  - **未来优化**：V1 可让 adapter 在中途调 MCP `room.declare_targets` 上报新发现的目标文件，运行时升级到细粒度锁；MVP 不实现，仅保留 schema。
  - 完整 `apply` 阶段仍依赖 `oldSha256` stale_base 检查（详见 Diff Artifact 状态机），即便锁退化也能在 apply 前发现外部修改。
- 由 `RunQueue Worker` 在 `bus-runtime/RunQueue 是 bus 的一条命名队列` 定义的锁矩阵中负责申请、按字典序避免死锁、`agent.run.completed/failed/cancelled` 时释放。
- Artifact 模块对锁完全无感：它只在 `apply` 阶段做磁盘写入，互斥已经由调度层保证。

#### Scenario: 两个 Agent 同时声明改 auth.ts

- **WHEN** Builder run_A 声明 `targetFiles=["auth.ts"]`，与此同时 Reviewer run_B 也声明 `["auth.ts"]`，两者各自经 `WakeAgent` Command + `RunLifecycleService.create` 进入 `agent.run.queued`
- **THEN** RunQueue Worker 调度时 run_A 先拿到 `(file, auth.ts)` 锁 → `agent.run.started`；run_B 拿不到锁 → `agent.run.waiting { reason: "file:auth.ts" }`；run_A 完成（任意 terminal 状态）→ Worker 释放锁 → 唤醒 run_B → run_B started

#### Scenario: 不同文件并行

- **WHEN** Builder run_A 改 `auth.ts`，Reviewer run_B 改 `README.md`
- **THEN** 两 run 申请的锁互不冲突，并行 started，无 waiting 事件

### Requirement: File Artifact

The system SHALL support `type=file` artifact for non-diff file outputs (e.g., generated images, PDFs, large blob outputs from tools).

存储：与 attachment 同目录（`<workspace>/.agenthub/attachments/...`），但 artifact 实体记录关联 messageId/runId。

#### Scenario: Agent 生成 PNG 文件

- **WHEN** Agent 通过 tool 生成 chart.png
- **THEN** 写文件到 attachments 目录，artifacts 表 `type='file'` 关联，发 `artifact.file.created`；Card 渲染图片缩略图

### Requirement: Terminal Artifact

The system SHALL capture terminal output (stdout/stderr) as `type=terminal` artifact when an Agent runs a shell command via the approved tool.

```ts
type TerminalArtifact = Artifact & {
  type: "terminal"
  command: string
  exitCode?: number
  stdoutFileId: string         // 大输出落盘到 attachments
  stderrFileId?: string
  durationMs: number
}
```

#### Scenario: Agent 跑 npm test

- **WHEN** Agent 跑 `npm test`，输出 50 KB
- **THEN** 创建 terminal artifact，stdout 写入 attachments 文件；TerminalCard 显示前 200 行 + "查看完整日志"按钮

### Requirement: Preview Artifact（最小实现）

The system SHALL support `type=preview` artifact rendering single-file HTML / markdown / image previews via an iframe pointed at a daemon-issued temp-token URL.

iframe sandbox（**MVP 默认**）：`sandbox="allow-scripts"`（**不**给 `allow-same-origin`、`allow-top-navigation`、`allow-popups`、`allow-forms`、`allow-modals`），详见 D17 与 `security/Preview iframe 沙箱`。

Preview 服务 MUST 与主 daemon API 不同 origin（独立 host 或独立端口），以确保即使 preview 内含 `<script>` 也无法借 same-origin 读 `127.0.0.1:6677` 的 daemon API、也不带 daemon cookie；token 一次性短期（30 分钟），preview 响应 `Set-Cookie` 不发送 daemon session cookie。

API：

```
POST /artifacts/preview         # body: { type: "html"|"markdown"|"image", contentRef }
GET  http://127.0.0.1:<previewPort>/preview/:token   # 独立 origin，daemon 内独立 server
```

#### Scenario: HTML preview 默认严格 sandbox

- **WHEN** Agent 生成 `index.html` artifact，提交 preview
- **THEN** daemon 颁发一次性 token；UI 渲染 iframe 用 `sandbox="allow-scripts"`、`src` 指向独立 preview 端口；预览页 JS 不能 fetch `127.0.0.1:6677`（CORS + sandbox same-origin 缺失双层防御）；token 30 分钟后清理任务删除

#### Scenario: 不接受 same-origin sandbox

- **WHEN** 任意代码尝试用 `sandbox="allow-scripts allow-same-origin"` 渲染 preview
- **THEN** ESLint 自定义规则 `no-iframe-allow-same-origin` 拒绝；CI 失败；MVP 不开放 same-origin（V1 评估细分通道）

### Requirement: Deployment 占位

The system SHALL accept `type=deployment` in the database schema but `POST /artifacts` with this type SHALL return 501.

#### Scenario: 用户尝试创建 deployment

- **WHEN** `POST /artifacts { type: "deployment", ... }`
- **THEN** 返回 501 + `{ error: "deployment artifact is V1+", capability: "v1-roadmap" }`

### Requirement: 安全写白名单（仅 MVP 例外）

The system MAY allow Agents to write to specific whitelisted paths without going through the Diff Card flow; the default whitelist SHALL be empty, and any non-empty whitelist MUST be configured per workspace by the user.

```ts
type SafeWritePolicy = {
  workspaceId: string
  globs: string[]                   // 默认 [] = 无安全写
}
```

例：可配置 `[".agenthub/cache/**", "/tmp/agenthub-test/**"]`。

#### Scenario: 默认无安全写

- **WHEN** Agent 写任意路径
- **THEN** 全部走 Diff Card 流程；不绕过

#### Scenario: 显式开启 cache 安全写

- **WHEN** 用户配置 `globs: [".agenthub/cache/**"]`，Agent 写 `<workspace>/.agenthub/cache/x.json`
- **THEN** Permission Engine 仍校验（file.write profile），但跳过 Diff Card 流程，直接写盘；仍发 `artifact.file.created` 用于审计

### Requirement: Artifact API

The system SHALL expose durable review and lifecycle routes in addition to the existing artifact routes:

```text
GET    /artifacts/:id/reviews
POST   /artifacts/:id/reviews
PATCH  /artifacts/:id/reviews/:reviewId
POST   /artifacts/:id/reviews/:reviewId/resolve
DELETE /artifacts/:id/reviews/:reviewId
POST   /artifacts/:id/archive
DELETE /artifacts/:id
GET    /artifacts/:id/files/:path/raw
POST   /rooms/:id/tasks/:taskId/report
```

Every mutating route SHALL publish its matching durable artifact/task event inside the same SQLite transaction as the database mutation.

#### Scenario: Artifact review comment is durable

- **WHEN** the user adds a line comment to `src/a.ts` on a diff artifact
- **THEN** an `artifact_reviews` row is inserted with file path, side/range metadata, status `open`, reviewer metadata, and timestamps
- **AND** `artifact.review.added` is published with `visibility = detail`

#### Scenario: Artifact review comment can be updated, resolved, and deleted

- **WHEN** the user edits, resolves, then deletes an artifact review comment
- **THEN** the system publishes `artifact.review.updated`, `artifact.review.resolved`, and `artifact.review.deleted`
- **AND** refresh/replay preserves the final review timeline state

#### Scenario: Artifact archive and delete are audit-visible

- **WHEN** the user archives or deletes an artifact
- **THEN** the artifact is soft-updated locally and the system publishes `artifact.archived` or `artifact.deleted` with `visibility = detail`

### Requirement: ArtifactFS Shadow Write 与 Run-Level Diff（取代 per-write 拦截）

The system SHALL implement an `ArtifactFS` shadow filesystem that intercepts every Agent file write at the adapter boundary; agents MUST NOT write directly to the real workspace via ACP `fs.writeTextFile`, MCP write tools, or shell redirection (within sandboxed shell mode). At the boundary of a Run (run completion, explicit phase boundary, or Agent-emitted `artifact.publish`), AgentHub SHALL build a single Run-level DiffArtifact from the shadow filesystem versus the run's snapshot base, and only `ArtifactApplier` (after user accept + Permission Engine) SHALL write the real workspace.

> **Why**：重型 coding agent（Claude Code、Codex）在一次任务中可能改十几个文件、跑测试、回滚自己的实验。每改一个文件就拦截、弹审批、强制走 Diff Card，会把 agent 切成"改一个文件停一次"的糟糕体验，也违反它们 prompt 里"在 sandbox 中自由实验"的工作模型。把拦截边界从"每次工具调用"挪到"任务完成后整批 review"是 MVP 默认行为。

**核心数据结构**：

```ts
interface ArtifactFS {
  readonly runId: string
  readonly snapshotBase: SnapshotRef                  // 见下文
  readonly mode: "isolated_worktree" | "shadow_buffer"

  read(path: string): Effect.Effect<string, ArtifactFSError>
  write(path: string, content: string): Effect.Effect<void, ArtifactFSError>
  delete(path: string): Effect.Effect<void, ArtifactFSError>
  list(prefix?: string): Effect.Effect<string[], ArtifactFSError>

  /** 在 run 终结时把 shadow 状态对照 snapshotBase 算 diff，落 ArtifactBuilder */
  buildRunArtifact(): Effect.Effect<Artifact, ArtifactFSError>
}

type SnapshotRef =
  | { kind: "git_commit"; sha: string; worktreePath: string }    // 用 git worktree 隔离
  | { kind: "file_hashes"; entries: Record<string, string> }      // 无 git 项目，按文件 sha256 快照
```

**两种实现模式**：

- **isolated_worktree**（推荐，git 项目默认）：daemon 用 `simple-git` 创建 git worktree（路径 `<userhome>/.agenthub/worktrees/<runId>/`）；adapter 子进程的 `cwd` MUST 设为 worktree 路径；agent 任意 `fs.writeTextFile` / shell `> file` MUST 落到 worktree 内；运行完成时用 `git diff --name-status` 与 base commit 对比生成 ArtifactFiles。
- **isolated_copy**（非 git 但需要 shell 时的默认）：复制项目 root 到 `<userhome>/.agenthub/runs/<runId>/`（限项目 ≤ 200 MB）；adapter cwd 指向 copy；shell 写入也被天然隔离；运行完成时按文件 sha256 与初始快照对比。
- **shadow_buffer**（仅当 agent 不需要 shell 时）：ArtifactFS 在 run 启动时按 `targetFiles` 预读 sha256；adapter ACP/MCP 写入截获到内存 Map<path, content>；ACP `fs.readTextFile` 优先返回 shadow 中的最新内容，未写过则从真实 workspace 读；run 完成时按内存 Map 与初始 sha256 算 diff。**shadow_buffer 拦不住直接的 shell `> file`，因此 MUST NOT 与 terminal-enabled adapter 一起使用**（详见下文"ArtifactFS 模式与 shell / terminal 的强约束"）。

**ArtifactFS 模式与 shell / terminal 的强约束**（避免开发者误以为内存 shadow 能拦截 shell 文件写）：

| Agent / Adapter 配置 | 允许的 workspace.mode | 禁止的 mode | 理由 |
|---|---|---|---|
| AgentProfile.capabilities 含 `terminal.run` | `isolated_worktree` / `isolated_copy` | `shadow_buffer` / `shared` | shell `echo x > a.ts` 直接打 fs，shadow_buffer 内存 Map 无法拦 |
| AdapterManifest.capabilities.canEmitToolEvents 实现了 shell tool | 同上 | 同上 | 同上 |
| AgentProfile.capabilities 仅含 file.read/file.write（无 shell） | 任意（含 shadow_buffer） | — | ACP/MCP 写可被 ArtifactFS 拦截 |
| 用户显式开启 `shared` 模式 | `shared` | — | 仅测试或调试用途，UI MUST 红色警告 + 确认 dialog |
| Mock adapter | 任意 | — | 测试用 |

`shadow_buffer` 模式下 daemon 启动 adapter 时 MUST NOT 暴露 ACP `terminal=true`、MUST NOT 注入 shell tool；adapter 试图 spawn shell 也 MUST 被 Permission Engine deny。MVP ACP 默认 `terminal=false`（详见 adapter-framework）。

**ACP 客户端能力声明**：

ACPAdapter 在 `initialize` 中声明 `clientCapabilities`：

```ts
const ACP_CLIENT_CAPABILITIES = {
  fs: {
    readTextFile: true,         // 路由到 ArtifactFS.read
    writeTextFile: true,        // 路由到 ArtifactFS.write，绝不写真实 workspace
  },
  terminal: false,              // V1
  permission: { request: true },
}
```

**强制约束**：

1. AdapterBridge MUST 在 spawn adapter 子进程前为该 Run 创建 ArtifactFS，并把 `runId → ArtifactFS` 注册进 AdapterManager；adapter 子进程 cwd MUST 设为 ArtifactFS workdir（worktree 模式）。
2. 任何 ACP `fs.writeTextFile` JSON-RPC inbound 调用 MUST 路由到 `ArtifactFS.write`；MUST NOT 直写 `<real-workspace>/<path>`。
3. 任何 MCP 写文件 tool（Write / MultiEdit 等）MUST 在 tool layer 拦截后转发 ArtifactFS。
4. Run 终结（completed / failed / cancelled，凡有 shadow 写入）MUST 调 `ArtifactFS.buildRunArtifact()` 生成 `Artifact { type: "diff", status: "draft" }`；空写入则不创建 artifact。
5. 用户 accept artifact 后，Permission Engine `file.write` 一次性请求所有 files；通过后 ArtifactApplier 按 `Artifact 状态机` 中 best-effort transactional apply 流程写真实 workspace（已含 stale_base / partial / recovery_required 处理）。
6. **MVP 默认禁用** "实时 diff per write" 行为：Permission Engine `file.write = "ask"` 在 Run 内的写入 MUST NOT 弹卡；卡片在 Run 终结后整批出现。例外：sensitive file（敏感白名单）即使在 ArtifactFS 内写也 MUST 立即拦截：ArtifactFS.write 命中白名单后不写 shadow / 不写真实 workspace，向 adapter 返回 RPC error，**同事务 emit `permission.resolved` `{ decision: "deny", reason: "sensitive_pattern_match", requested: false }`**（**不**走 `permission.requested` 路径，因为这是 silent deny，不弹卡），Run 不被该单文件中断（详见 P1-2 与 `security/敏感文件白名单`）。
7. Worktree GC：详见 `local-daemon/Worktree 选择策略` 中的 GC 约束。

**与 D7 文件锁矩阵的关系**：

`bus-runtime/RunQueue` 的 `(file, <path>)` 锁仍按 Run 声明的 `targetFiles` 排他，目的是避免两个 Run 在 ArtifactBuilder 阶段对同一真实文件产生冲突 diff。Run 内部对 ArtifactFS 的写不再需要逐文件锁。

#### Scenario: ACP fs.writeTextFile 走 ArtifactFS

- **WHEN** ClaudeCodeACPAdapter session 在 prompting 阶段发起 `fs.writeTextFile { path: "src/auth.ts", content: "..." }`
- **THEN** AdapterBridge 路由到 ArtifactFS.write；真实 workspace `<workspace>/src/auth.ts` 内容**不变**；run 终结时该文件出现在生成的 DiffArtifact 中

#### Scenario: 重型任务一次产生 4 文件 diff

- **WHEN** Builder 在 isolated_worktree 中跑 "重构 auth 模块" 任务，先后写 4 个文件、跑测试、回滚 1 个文件再重写
- **THEN** Run completed 时 ArtifactFS.buildRunArtifact 用 `git diff` 对比 base commit，得到最终 4 文件变更（中间反复实验不计）；DiffCard 一次性出现 4 文件，用户 accept 后 ArtifactApplier 一次写真实 workspace

#### Scenario: Run 内不弹 file.write 卡

- **WHEN** Builder 在 ArtifactFS 内连续写 src/a.ts、src/b.ts、src/c.ts
- **THEN** Permission Engine 不为这 3 次写各自 emit `permission.requested`；Run 终结后整批 DiffCard 出现，用户在 DiffCard 内一次决定 apply / reject

#### Scenario: Run 内试图写 .env 仍立即 deny

- **WHEN** Builder 在 ArtifactFS 内写 `.env`
- **THEN** ArtifactFS.write 命中敏感白名单 → 立即返回 `ArtifactFSError(code="sensitive_file_blocked")`；adapter 收到 RPC error；emit `permission.resolved` durable 事件 payload `{ decision: "deny", reason: "sensitive_pattern_match", path: ".env", agentId, runId, requested: false }`（统一走 `permission.resolved`，不引入 `permission.requested.denied` 半结果命名）；Run 不被该单文件中断，但用户能在 Run Detail 看到该次拦截 audit；该写入既不写真实 workspace 也不写 ArtifactFS shadow

#### Scenario: 空写入 Run 不创建 artifact

- **WHEN** Reviewer 完成一次 review 但没有写任何文件
- **THEN** ArtifactFS.buildRunArtifact 检测到 shadow 与 base 一致；不创建 DiffArtifact；Run 正常完成

#### Scenario: 失败 Run 仍生成 artifact 供用户审查

- **WHEN** Builder 写了 3 文件后因 model error 失败
- **THEN** ArtifactFS.buildRunArtifact 仍执行；DiffArtifact 创建为 `status="draft"`；UI 在失败提示旁显示"已生成中间 diff，可查看 / 应用 / 丢弃"

### Requirement: Per-file diff review surface

The system SHALL render both ordinary `diff` artifacts and `worktree_diff` artifacts through a shared per-file review surface.

The review surface SHALL support:
- file accordions with path, status, additions, and deletions
- unified diff view
- split diff view when feasible
- line numbers
- line selection/comment targets
- inline comment display
- expand/collapse all
- large-diff guard
- empty, binary, and unsupported states
- stable file anchors of the form `#artifact:<artifactId>:<path>`

#### Scenario: Chat diff card and artifact workspace share review rendering

- **WHEN** a diff card appears in chat and the same artifact appears in the artifact workspace
- **THEN** both surfaces render through the same per-file review model
- **AND** a task proof link to `#artifact:<artifactId>:src%2Fa.ts` scrolls to the real per-file review block

### Requirement: Artifact preview contract

The system SHALL provide a shared artifact preview contract that derives preview behavior from file name and content type.

Supported preview kinds SHALL include:
- markdown
- text/code
- sandboxed HTML
- image
- PDF
- audio
- video
- unsupported/download fallback

The preview UI SHALL expose loading, retry, too-large, unsupported, open-in-new-tab, and download states. HTML preview SHALL render in a sandboxed iframe without same-origin access to the daemon API.

#### Scenario: Markdown artifact opens as a document

- **WHEN** the user opens a Markdown artifact file
- **THEN** the preview modal renders formatted Markdown and still offers raw open/download actions

#### Scenario: HTML artifact is sandboxed

- **WHEN** the user opens an HTML artifact file
- **THEN** the content renders in a sandboxed iframe and cannot read the daemon API as same-origin content

### Requirement: Task proof-of-work delivery report

The system SHALL aggregate task delivery evidence into a proof-of-work section and SHALL allow creating or refreshing a Markdown delivery report artifact for a task.

Proof-of-work SHALL include, when present:
- file change runs
- worktree review states
- proof or validation task activities
- artifact review decisions
- unresolved artifact review comment counts
- generated report metadata including template version and evidence counts

`POST /rooms/:id/tasks/:taskId/report` SHALL create or refresh one live Markdown delivery report for the task, link it through task activity, and expose it through the artifact workspace and preview flow.

#### Scenario: Task delivery report refreshes instead of duplicating

- **WHEN** the user generates a delivery report for a task twice
- **THEN** the second call refreshes the live report and soft-removes the previous live copy from the task's active report set
- **AND** the report contains evidence metadata and validation notes available at generation time


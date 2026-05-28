# local-daemon Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: Daemon 启动与端口绑定

The system SHALL provide a single executable daemon that binds to `127.0.0.1` by default and exposes an HTTP+SSE server on a configurable port. **V0.5 落实 config.toml 加载**（MVP §4.2 缺；之前是硬编码端口/默认）。

启动流程：

1. 读取配置（优先级：CLI flag > 环境变量 > `~/.agenthub/config.toml` > 默认值）
2. 初始化 SQLite（自动 migration、应用 D3 中的全部 pragma）
3. 加载 Effect Layer（EventBus / PermissionEngine / AdapterManager / RoomRuntime）
4. 启动 Hono HTTP server 绑定到 `127.0.0.1:<port>`
5. 进入主循环，等待信号

**config.toml 解析**：

- 用 `smol-toml`（轻量，详见 design V05-D10）；
- 路径：`<userhome>/.agenthub/config.toml`，缺省时使用全部默认值（不报错）；
- 解析失败 → stderr 警告 + 退化到默认值；不阻断启动。
- 启动后 stdout 打印 effective config（除 `[auth].token` / `[auth].allowedOrigins` 等 secret 字段，redact 显示 `***`）。

**支持的字段**：

```toml
[server]
bind = "127.0.0.1"           # 也接受 "0.0.0.0"，但需配套 [auth].token + [server.remote].enabled=true
port = 6677
preview_port = 6678          # MVP 已存在 (security/Preview iframe 沙箱)

[auth]
token = "..."                # 可选；0.0.0.0 必填
expires_days = 30
allowedOrigins = ["http://127.0.0.1:6677", "http://localhost:6677"]  # 与 security spec 一致

[server.remote]
enabled = false              # 默认 false，0.0.0.0 必须显式设 true（与 security spec 一致）

[debug]
enabled = false
allowRemote = false

[adapters]
# 每 adapter 子表（claude-code / opencode）可指定 binary 路径覆盖 detect

[adapters.claude-code]
binary = "/usr/local/bin/claude"

[adapters.opencode]
binary = "/usr/local/bin/opencode"

[bus.pubsub]
# 容量配置（与 §19.7.2 一致），缺省按 spec 默认；启动校验 durable >= 1024
```

**字段命名与 security spec 对齐**：`[server] bind`（不是 `host`）/ `[server.remote] enabled`（不是 `[security] allowRemote`）/ `auth.allowedOrigins`（与 security/浏览器 CSRF / Origin / Host 防护 一致）。

**优先级冲突示例**：CLI `--port=7000` > env `AGENTHUB_PORT=6900` > config.toml `port=6800` > 默认 `6677` → 生效 7000。

#### Scenario: 默认配置启动

- **WHEN** 用户在没有配置文件、没有 CLI flag 的环境运行 `agenthub start`
- **THEN** daemon 在 `127.0.0.1:6677`（默认端口）启动，初始化空的 SQLite 数据库于 `~/.agenthub/agenthub.db`，stdout 输出 `AgentHub daemon listening on http://127.0.0.1:6677`

#### Scenario: 端口被占用

- **WHEN** 启动时目标端口被其它进程占用
- **THEN** daemon 退出码 `EADDR_INUSE`，stderr 输出冲突端口与建议的备选端口；不发生静默切换

#### Scenario: 远程访问需显式开启 — 无 token

- **WHEN** 用户在配置中设置 `[server] bind = "0.0.0.0"` 但未设置 `[auth] token`
- **THEN** daemon 拒绝启动，stderr 输出 `Refusing to bind 0.0.0.0 without auth.token. Set [auth] token = "..." or use bind = "127.0.0.1".`

#### Scenario: 远程访问需显式开启 — 有 token 但 remote.enabled=false

- **WHEN** 用户设置 `[server] bind = "0.0.0.0"` + `[auth] token = "..."` 但 `[server.remote] enabled = false`（默认值）
- **THEN** daemon 拒绝启动，stderr 输出 `Refusing to bind 0.0.0.0 without [server.remote] enabled = true. Set enabled = true to allow remote access.`

#### Scenario: config.toml 加载

- **WHEN** `~/.agenthub/config.toml` 含 `[server] port = 8000`
- **THEN** daemon 在 8000 端口启动
- **AND** stdout 打印 `[server] port = 8000`、`[auth] token = "***"`（redact）

#### Scenario: config.toml 解析失败

- **WHEN** `~/.agenthub/config.toml` 含语法错误
- **THEN** stderr 警告 `Failed to parse config.toml: <reason>; using defaults`
- **AND** daemon 仍用默认值启动（不退出）

#### Scenario: CLI flag 覆盖 config.toml

- **WHEN** config.toml `port=8000`，用户跑 `agenthub start --port=9000`
- **THEN** 生效端口 = 9000

### Requirement: 多客户端 SSE 连接

The system SHALL support multiple concurrent SSE clients on `/event`, each maintaining an independent cursor for resume-on-disconnect.

#### Scenario: 单客户端首次连接

- **WHEN** 客户端 `GET /event` 不带 `Last-Event-ID` 头
- **THEN** daemon 写一个 `server.connected` 事件给该客户端、订阅全局 PubSub、每 10 秒推 heartbeat、客户端断开时释放 Effect Scope

#### Scenario: 客户端用 cursor 重连

- **WHEN** 客户端断开后用 `Last-Event-ID: <seq>` 重连（`<seq>` 为最后收到的 durable 事件的数值 seq）
- **THEN** daemon 把 `Last-Event-ID` 解析为数值 seq，按 `events WHERE seq > cursorSeq ORDER BY seq ASC` 回放全部 durable 事件，再开始订阅实时流；ephemeral 事件不补发；非数值 cursor 兜底为首次连接（详见 `event-system/SSE id 与 cursor 的 durable-only 语义` 与 `event-system/SSE 桥接与 cursor 重连`）

#### Scenario: 多个 tab 同一用户

- **WHEN** 同一用户开两个浏览器 tab，各自连 SSE
- **THEN** 两个客户端都能收到所有 durable 事件（PubSub 广播），不出现一条事件只到一个 tab

### Requirement: 优雅停止

The system SHALL handle SIGINT/SIGTERM gracefully and persist all in-flight durable state before exiting. **V0.5 落实 30s in-flight timeout 与强制 cancel 路径**（MVP §4.5 缺；之前 SIGINT 行为非确定）。

停止流程：

1. 收到 SIGINT/SIGTERM 后立即设置 `daemonState.shutdownRequested = true`；
2. HTTP server 拒绝新连接：所有非 `/healthz` 路由返回 503 `{ error: "service_stopping" }`；`/healthz` 返回 200 但 body `{ status: "shutting_down" }`；
3. 通知所有 SSE 客户端 `server.shutting_down` 事件 + 关闭连接（客户端会按 reconnect 策略尝试，但失败到 offline）；
4. **等待 in-flight Run 自然终结，最多 30 秒**：每 100ms 轮询 `runs WHERE status IN ('queued','claimed','starting','running','waiting_permission','cancelling')`；如全部为终态则提前进入下一步；
5. 30 秒超时后，对所有仍在非终态的 Run 调 `RunLifecycleService.markCancelling(null, runId)` + `cancelFinalized(null, runId)` 同事务发 `agent.run.cancelled { reason: "daemon_shutdown" }`；
6. shutdown phase 倒序运行（HTTP→AdapterManager→Handler Registry→Outbox Dispatcher→CommandBus→EventBus→DB）；
7. flush events 表（确保所有 in-flight outbox 已派发或回滚）；
8. 关闭 SQLite 连接 + 删除 PID 文件；
9. 退出码 0（正常关闭）/ 1（强制 timeout）。

`agenthub stop --force` 跳过步骤 4-5，直接发 SIGKILL（warn "可能丢失 in-flight Run 状态"）。

#### Scenario: 收到 SIGINT 时无在跑 Run

- **WHEN** daemon 收到 SIGINT 且无 in-flight Run
- **THEN** 在 1 秒内完成上述流程并退出 0

#### Scenario: 收到 SIGINT 时存在在跑 Run 在 30s 内完成

- **WHEN** daemon 收到 SIGINT 且有 2 个 in-flight Run，其中一个在 5 秒内完成、另一个在 20 秒内完成
- **THEN** daemon 在 20 秒后进入 phase 6+，约 21 秒退出，退出码 0

#### Scenario: 30 秒超时强制 cancel

- **WHEN** daemon 收到 SIGINT 且有 1 个 Run 跑超过 30 秒未完成
- **THEN** daemon 在 t=30s 调 markCancelling + cancelFinalized 发 `agent.run.cancelled { reason: "daemon_shutdown" }`
- **AND** 继续 shutdown phase 退出，退出码 1

#### Scenario: SSE 客户端被通知

- **WHEN** daemon 开始 shutdown，client SSE 在线
- **THEN** client 收到 `server.shutting_down` 事件后连接断开
- **AND** UI banner 显示"daemon stopping..."

#### Scenario: stop --force 跳过 30s 等待

- **WHEN** 用户跑 `agenthub stop --force`
- **THEN** CLI 发 SIGKILL；daemon 立即终止，无 phase 4-5
- **AND** in-flight Run 在下次 daemon 启动时由 ReclaimStaleClaimedRun 处理（pid mismatch 路径）

### Requirement: OpenAPI + 自动生成 SDK

The system SHALL expose `GET /openapi.json` with the full OpenAPI 3.1 spec, and `packages/sdk` SHALL be regenerated from this spec via build script.

接口分组（CQRS 轻量版）：

```
Command  (POST/PATCH/DELETE)
  POST   /rooms
  POST   /rooms/:id/messages
  POST   /agents/:id/run
  POST   /permissions/:id/resolve
  POST   /interventions/:id/approve
  ...

Query    (GET)
  GET    /rooms
  GET    /rooms/:id
  GET    /messages?roomId=
  GET    /context?roomId=
  GET    /artifacts?taskId=
  ...

Stream   (SSE)
  GET    /event
```

#### Scenario: SDK 与 daemon 类型一致

- **WHEN** 在 daemon 中新增一个 OpenAPI route
- **THEN** 运行 `bun run sdk:generate` 后，`packages/sdk` 暴露对应类型化方法，前端 `import { sdk } from '@agenthub/sdk'` 编译期类型检查通过

### Requirement: 健康检查

The system SHALL expose `GET /healthz` returning `{ status: "ok" | "degraded", version, uptimeMs, checks: { db, eventBus, adapterManager } }`.

#### Scenario: 全部子系统正常

- **WHEN** SQLite 可写、EventBus 在线、AdapterManager 已加载至少一个 adapter
- **THEN** `/healthz` 返回 200 + `status: "ok"`

#### Scenario: SQLite 不可写

- **WHEN** SQLite 文件被外部锁住
- **THEN** `/healthz` 返回 503 + `status: "degraded"` + `checks.db: { ok: false, reason: "..." }`

### Requirement: Worktree 选择策略与 GC 安全约束

The system SHALL select a workspace mode per Run based on adapter manifest, agent profile, and run policy; it SHALL run a garbage-collection task to reclaim disk space from terminated isolated worktrees, with hard safety bounds that prevent deleting `.git` directories or any path outside the AgentHub-managed root.

> **Why**：与 `artifacts/ArtifactFS` 配套 — 重型 coding agent 默认 isolated worktree，但 worktree 是 git 半结构化资源，GC 必须避开常见错删事故（误删用户主仓库、误删 .git internal、误删尚未 apply 的 work-in-progress）。

**选择优先级**（高到低）：

1. Run 级 explicit override：`WakeAgent.workspaceMode` / `RunLifecycleService.create` 入参字段
2. AgentProfile：`agent.workspaceMode`
3. Adapter manifest：`workspace.mode`（详见 adapter-framework）
4. Workspace 默认（用户配置）：`config.toml [workspace] defaultMode`
5. 最终兜底：`isolated_worktree`（git 项目）/ `shadow_buffer`（非 git）

**模式取值**：

| 模式 | 实现 | 适用 |
|---|---|---|
| `isolated_worktree` | `git worktree add <userhome>/.agenthub/worktrees/<runId> <baseRef>` | 重型 coding agent，git 项目 |
| `isolated_copy` | rsync 项目 → `<userhome>/.agenthub/runs/<runId>/`（限 ≤ 200 MB 项目） | 非 git 或不能 worktree |
| `shadow_buffer` | 内存中 Map<path, content> + ArtifactFS 拦截 | 短任务、reviewer 类只读 + 提议 |
| `shared` | 直接共享 workspace（所有写都被 ArtifactFS 拦截到 shadow） | Mock / 测试 / 用户显式开 |
| `external` | adapter 自管 workspace（不归 daemon GC） | A2A / 远程 adapter |

**GC 任务**：

- 周期：daemon 启动时 + 每 1 小时一次。
- 扫描根：仅扫 `<userhome>/.agenthub/worktrees/` 与 `<userhome>/.agenthub/runs/`；MUST NOT 扫真实 workspace 路径。
- 候选删除条件（同时满足）：
  1. 路径名 = `<rootPattern>/<runId>`，runId 是合法 ULID。
  2. `runs WHERE id=<runId>` 行存在且 `status IN (completed, failed, cancelled)`。
  3. 该 Run 在终结后 ≥ `gc.retentionDays`（默认 3 天）。
  4. 该 Run 无任何未 apply 的 DiffArtifact（`artifacts WHERE run_id=<runId> AND status IN (draft, reviewing, accepted, applying)` 为空）。
- 删除前 MUST：
  - 拒绝任何 `..` / 软链 解析后落到 `<userhome>/.agenthub/...` 之外的路径（详见 P3-1 路径校验）。
  - 拒绝删除根目录本身（`worktrees/`、`runs/`）。
  - 对 worktree 模式 MUST 用 `git worktree remove` 或 `git worktree prune`，不直接 `rm -rf`（git 内部状态需要清理）。
  - 对 isolated_copy MUST 检查目录顶层不存在 `.git/` 且不存在 `.agenthub-real-workspace` 标记（防御性兜底，避免误判）。

```ts
type GcConfig = {
  retentionDays: number              // 默认 3
  maxTotalSizeGb: number              // 默认 20，超出按 LRU 强制清理已终结 run（仍要经全部安全检查）
  excludeRunIds: string[]              // 用户显式 keep
}
```

**审计**：每次 GC 删除 MUST 写一条 `worktree.gc.removed` durable 事件 payload `{ runId, mode, sizeBytes, retainedDays }`。

#### Scenario: 重型 agent 默认 worktree

- **WHEN** ClaudeCodeAdapter manifest workspace.mode='worktree'，git 项目
- **THEN** Run 启动时 daemon 创建 `<userhome>/.agenthub/worktrees/<runId>/`；adapter cwd 指向该目录；ArtifactFS 拦截 fs.writeTextFile

#### Scenario: GC 跳过未 apply 的 run

- **WHEN** run_42 5 天前 completed，但 DiffArtifact 仍处于 reviewing
- **THEN** GC 不删除 run_42 worktree；UI 提示用户先决定该 diff

#### Scenario: GC 拒绝越界路径

- **WHEN** 攻击者构造软链 `<userhome>/.agenthub/worktrees/run_x` → `/`
- **THEN** GC 解析符号链接，目标在 AgentHub 管理根之外 → 跳过删除 + emit `worktree.gc.skipped { reason: "outside_managed_root" }`

#### Scenario: GC 不直接 rm -rf .git

- **WHEN** 删除 worktree 路径含 `.git` 文件（worktree 元数据）
- **THEN** MUST 走 `git worktree remove --force` 而非 `rm -rf`；失败则 fall back 到 `rm -rf` 但仅删除 worktree 路径自身，不递归删除外层

#### Scenario: 总磁盘超限触发强制 GC

- **WHEN** worktrees 与 runs 总大小 22 GB > maxTotalSizeGb=20
- **THEN** GC 按 LRU（终结时间最早）选择候选直到回到阈值；仍然适用全部安全约束（不删 in-flight、不删未 apply）；删完仍超限 → emit `handler.stalled { handler: "worktree-gc", reason: "size_overrun_blocked" }` 让用户介入

### Requirement: daemon CLI 子命令

The system SHALL provide a CLI binary `agenthub` (in `apps/cli`) with the following subcommands.

| Subcommand | 描述 | 输出 |
|---|---|---|
| `agenthub start [--port=<n>] [--config=<path>]` | 在前台启动 daemon | 等同直接调 `node packages/daemon/dist/index.js`；ctrl-c 退出 |
| `agenthub stop [--force] [--timeout=<s>]` | 停止运行中的 daemon | 读 PID 文件 → 发 SIGTERM；`--force` 发 SIGKILL；`--timeout` 默认 30s |
| `agenthub status` | 检查 daemon 健康 | HTTP `/healthz` 探测，输出 `ready` / `starting` / `shutting_down` / `unreachable` |
| `agenthub doctor` | 环境诊断 | 检查：① SQLite 文件锁状态 ② 端口是否被占 ③ 凭据存储模式（M0 输出固定 "AES fallback (file-based)"，不实写测 entry；keytar 真接入推到 V1.0）④ migrations 状态（DB schema vs 包内 migration 版本）⑤ config.toml 解析是否成功；每项 ✅ / ❌ 输出 |
| `agenthub auth issue --description=<s> [--scope=read,write,admin] [--expires-days=<n>]` | 发 token | 调 `/auth/tokens` API，stdout 输出新 token（仅一次显示）+ id |
| `agenthub auth list` | 列已有 token | 表格显示 id / description / scopes / created_at / expires_at / last_used_at（不显示 token 值本身，只显示 fingerprint） |
| `agenthub auth revoke <id>` | 吊销 token | 调 `/auth/tokens/:id` DELETE |
| `agenthub agents reset --id=<agentId>` | 覆盖单个内置 agent 模板（来自 `agents/内置 Agent`） | 复制内置 markdown 到 `~/.agenthub/agents/<id>.md`，覆盖用户改动 |
| `agenthub --version` | 显示版本 | 读 package.json |
| `agenthub --help` | 显示 help | 列所有子命令 |

PID 文件：daemon 启动时写 `<userhome>/.agenthub/daemon.pid`（含进程 PID + bind host + port），shutdown 时删除；`agenthub stop` / `status` 读此文件定位 daemon。`stop --force` 在 timeout 后发 SIGKILL，warn "可能丢失 in-flight Run 状态"。

`doctor` 子命令的 Keychain 行 M0 固定输出 "Keychain: AES fallback (file-based)"。理由：M0 不依赖 OS keychain，secrets 走文件级 AES（详见 `security` capability）；keytar 接入 + 真写读测试是 V1.0 OS 集成范畴。本行只验证"凭据存储模式被正确选定"，不试探可写性。

#### Scenario: agenthub status 探测 ready

- **WHEN** daemon 在 :6677 启动完成（startup phase 9 done），用户跑 `agenthub status`
- **THEN** stdout `daemon: ready (http://127.0.0.1:6677)`，退出码 0

#### Scenario: agenthub status 探测 starting

- **WHEN** daemon 还在 startup phase 5，用户跑 `agenthub status`
- **THEN** /healthz 返回 503 `service_starting`，CLI 显示 `daemon: starting`，退出码 0

#### Scenario: agenthub stop 默认 timeout

- **WHEN** 用户跑 `agenthub stop`，daemon 有 1 个 in-flight Run
- **THEN** CLI 发 SIGTERM，等最长 30s
- **AND** Run 在 20s 完成 → CLI 输出 `daemon stopped`，退出码 0
- **AND** 30s 超时 → CLI 输出 `daemon did not stop in 30s, use --force to send SIGKILL`，退出码 1

#### Scenario: agenthub doctor 全检

- **WHEN** 用户跑 `agenthub doctor`
- **THEN** 输出 5 行检查结果（SQLite / 端口 / Keychain / migrations / config）
- **AND** 任一失败时退出码非 0

#### Scenario: auth issue 一次显示 token

- **WHEN** 用户 `agenthub auth issue --description="ci" --scope=read`
- **THEN** stdout 显示 `Token (save it now, won't be shown again): <token>` + `Id: <id>`
- **AND** 调用方应立即把 token 存到 keychain / .env


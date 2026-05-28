# local-daemon (V0.5 delta)

## ADDED Requirements

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

## MODIFIED Requirements

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

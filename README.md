***# AgentHub

AgentHub 是一个本地优先的多 Agent 工作台。它把聊天房间、任务调度、权限审批、上下文记忆、产物预览和代码/文档生成放在同一个本地 daemon 里运行，前端只通过 HTTP/SSE 和事件投影更新状态，不直接读数据库。

## 核心功能

- 多 Agent 房间：支持 Solo、Assisted、Team 等协作方式，用户可以和主 Agent 对话，也可以让旁听 Agent 介入。
- 任务与运行管理：每次 Agent 执行都是一个 Run，包含排队、运行、完成、失败、取消和恢复流程。
- 产物工作流：Agent 可生成网页、Web App、文档、PPT、源码、Diff 和部署卡片，前端可预览、编辑、查看历史或应用变更。
- 权限与安全：文件、shell、工具、上下文写入等操作走 Permission Engine；默认只监听 `127.0.0.1`，远程访问必须显式配置 token。
- 事件驱动 UI：状态写入 SQLite 后，同事务发布 EventBus 事件；Web UI 通过 durable replay + live SSE 重建界面。
- 多运行时适配：当前重点支持 Mock、Claude Code、OpenCode/ACP 方向，运行时和模型配置可在设置中管理。
- 多端入口：Web 是主入口，Electron 桌面壳和 Capacitor 移动端复用同一套 daemon API。

## 项目结构

```text
apps/cli       命令行入口，根目录 agenthub.cmd 会调用它
apps/web       React + Vite Web UI
apps/desktop   Electron 桌面壳，加载 daemon 提供的 Web UI
apps/mobile    React + Capacitor 移动端
packages/daemon        本地 HTTP/SSE daemon
packages/bus           CommandBus、EventBus、outbox
packages/orchestrator  Agent 调度、Run 生命周期、任务与 mailbox
packages/db            SQLite schema 和 migrations
packages/protocol      事件、协议、领域类型
packages/*             agents、artifacts、permissions、context、security、sdk 等领域包
```

## 快速运行

要求：Node.js `>=22`、pnpm `>=10`、Bun `>=1.1`。

```powershell
pnpm.cmd install
pnpm.cmd build
.\agenthub.cmd web
```

`.\agenthub.cmd web` 会启动本地 daemon 并打开浏览器：

- daemon 默认地址：`http://127.0.0.1:6677`
- 如果 `apps/web/dist` 已存在，Web UI 由 daemon 直接提供
- 如果没有构建产物，会自动启动 Vite dev server：`http://127.0.0.1:5173`

开发时也可以跳过构建，直接运行：

```powershell
pnpm.cmd install
.\agenthub.cmd web
```

## 常用命令

```powershell
# daemon
.\agenthub.cmd start
.\agenthub.cmd status
.\agenthub.cmd stop
.\agenthub.cmd doctor

# 质量检查
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd check:all
pnpm.cmd lint

# Web
pnpm.cmd --filter @agenthub/web dev
pnpm.cmd --filter @agenthub/web build

# 桌面端
pnpm.cmd --filter @agenthub/desktop build
pnpm.cmd --filter @agenthub/desktop start
pnpm.cmd --filter @agenthub/desktop run package:dir

# 移动端
pnpm.cmd --filter @agenthub/mobile dev
pnpm.cmd --filter @agenthub/mobile build
pnpm.cmd --filter @agenthub/mobile run android:apk
```

## 本地数据

默认数据目录在用户主目录下：

```text
%USERPROFILE%\.agenthub\agenthub.db
%USERPROFILE%\.agenthub\config.toml
%USERPROFILE%\.agenthub\daemon.pid
```

默认只绑定 `127.0.0.1`。如果要让手机或局域网设备直连 daemon，需要在配置中改为 LAN IP，并同时启用 `[server.remote] enabled = true` 与 `[auth] token = "..."`。

## 参考文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 后端、事件和投影架构
- [docs/SECURITY.md](docs/SECURITY.md) - 本地安全、鉴权、脱敏和路径策略
- [docs/PERMISSION_PROFILES.md](docs/PERMISSION_PROFILES.md) - 内置权限 profile
- [docs/multi-platform-runbook.md](docs/multi-platform-runbook.md) - 桌面端、移动端和打包运行说明
**

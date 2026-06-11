<div align="center">

 
# AgentHub

**像使用群聊一样，和一组 AI Agent 协作完成真实任务。**

[![Version](https://img.shields.io/badge/version-1.2.0-blue)](#版本迭代)
[![npm](https://img.shields.io/npm/v/@rikey123/agenthub?label=npm&color=cb3837&logo=npm)](https://www.npmjs.com/package/@rikey123/agenthub)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A510-f69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Runtime](https://img.shields.io/badge/runtime-Claude%20Code%20%7C%20OpenCode%20%7C%20ACP-7c3aed)](#agent-运行时)

中文 | [English](README_en.md)

</div>

---

AgentHub 是一个**本地优先的多 Agent 协作平台**。它把对话式创建网页、文档、代码 Diff、Workflow 草图、部署包等产物的过程，整理成一个类似飞书/微信的 IM 工作台：Agent 是联系人，任务是会话，协作过程发生在群聊里，产物以内联卡片的方式预览、审查、编辑和发布。

这个项目不是只做一个聊天框，也不是只展示一次模型调用。AgentHub 重点解决的是 Agent 真正执行任务时绕不开的工程问题：多会话并行、群聊调度、上下文连续、权限审批、运行追踪、产物审查、部署发布和多端同步。

## 目录

- [项目亮点](#项目亮点)
- [功能概览](#功能概览)
- [架构一览](#架构一览)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [项目结构](#项目结构)
- [Agent 运行时](#agent-运行时)
- [多端支持](#多端支持)
- [AI 协作开发](#ai-协作开发)
- [版本迭代](#版本迭代)
- [路线图](#路线图)
- [文档入口](#文档入口)
- [开发约定](#开发约定)
- [许可证](#许可证)

## 项目亮点

- **IM 作为多 Agent 入口**：用户通过房间列表、聊天流、`@Agent`、消息引用和卡片操作完成任务，不需要理解底层 Agent 平台差异。
- **单聊、协作、团队三类任务形态**：支持 `solo`、`assisted`、`team`房间模式，覆盖从单 Agent 快速任务到多 Agent 分工协作。
- **Orchestrator 调度闭环**：显式 `@Agent` 优先，未指定时由 selector / leader 根据房间成员、角色、能力和上下文决定下一位参与者。
- **运行过程可追踪**：每次 Agent 执行都是一个 Run，Run Detail 记录 transcript、工具调用、权限请求、上下文、成本和产物。
- **产物不是纯文本**：代码 Diff、网页预览、Markdown 文档、PPT/演示稿、终端输出、部署状态都以 artifact/card 进入聊天流。
- **本地优先与权限边界**：默认绑定 `127.0.0.1`，数据落地 SQLite；文件、shell、工具、上下文写入统一通过 Permission Engine。
- **事件回放驱动 UI**：状态写入和事件发布在同一个 SQLite 事务中完成，前端通过 durable replay + live SSE 重建视图。
- **一套 daemon，多端复用**：Web、Electron 桌面端、Capacitor 移动端和 CLI 共享同一套 API、事件协议和安全模型。

## 功能概览

### IM 聊天式交互

左侧是会话列表，支持新建、搜索、置顶、归档和删除；中间是聊天流；右侧是上下文、任务、成员、成本与调试面板。用户可以像在群聊里发消息一样发起任务，也可以引用消息、引用 artifact、附带文件或使用 `@Agent` 指定参与者。

聊天流中的消息支持多种卡片：

| 卡片                           | 用途                                               |
| ------------------------------ | -------------------------------------------------- |
| `DiffCard`                     | 展示代码变更，进入逐文件审查、评论、应用或拒绝流程 |
| `PreviewCard` / `ArtifactCard` | 预览网页、Markdown、图片、PDF、文件等产物          |
| `PermissionCard`               | 展示文件、shell、工具等敏感操作请求，等待用户审批  |
| `TaskCard`                     | 把会话中的任务拆解为可跟踪状态                     |
| `DeploymentCard`               | 展示预览 URL、打包、容器构建、自托管发布等部署状态 |
| `TerminalCard`                 | 展示命令执行摘要和关键输出                         |

### 多 Agent 协作

| 模式       | 适用场景                                                    |
| ---------- | ----------------------------------------------------------- |
| `solo`     | 单 Agent 明确任务，例如“让 Claude Code 写一个 React 组件”   |
| `assisted` | 主 Agent + 协作者，适合讨论、审查、补充分析和 `@Agent` 指派 |
| `team`     | leader 拆解任务，teammate 分工执行，适合展示任务分派与汇总  |

AgentHub 使用 `pending turn`、`mailbox`、`wake outbox`、`run queue` 等机制管理长任务和并发输入：Agent 忙碌时用户仍可继续输入，系统会按顺序投递，不把后续消息丢在 UI 状态里。

### 产物预览、审查与部署

Agent 的输出会进入 artifact 系统，而不是停留在普通文本消息中：

- Diff 审查：统一/分栏视图、按文件折叠、增删统计、行级评论、大 Diff 防护、apply/reject/archive。
- 预览工作台：Markdown、代码文本、sandbox HTML、图片、PDF、音视频、PPT 预览桥、下载 fallback。
- 版本历史：artifact 保存后生成版本记录，可查看历史并恢复。
- 选区引用：支持 `@artifact:<id>#L12-L30` 和 `@workspace:<path>#L5-L20` 进入下一轮对话。
- 部署发布：支持本地预览 URL、静态站点、源码 zip、容器导出、容器构建和 CapRover 自托管 provider。

### 权限与安全

AgentHub 允许 Agent 参与本地任务，但不默认放开本地环境：

- daemon 默认只监听 `127.0.0.1`。
- 浏览器写操作需要 session、Origin/Host 校验、JSON Content-Type 和 CSRF。
- 远程/LAN 访问必须显式开启 remote 并配置 token。
- 文件、shell、工具、上下文、Agent 控制类动作都进入 Permission Engine。
- `.env`、私钥、云凭据、`.ssh`、`.netrc`、service-account JSON 等敏感路径默认 deny-first。
- 适配器原始输出进入持久化或事件流前会经过 SecretRedactor 脱敏。


## 架构一览

```text
Web / Desktop / Mobile / CLI
            |
            v
packages/daemon
HTTP API / SSE / static Web UI / auth / preview / deploy
            |
            v
CommandBus
            |
            v
Domain Services
RunLifecycleService / TaskService / ArtifactService
PermissionEngine / ContextLedger / AdapterRegistry
            |
            v
SQLite transaction
state mutation + EventBus.publish()
            |
            v
EventBus + events/outbox + durable replay
            |
            v
Web Projector / Run Detail / Task Panel / Artifact Workspace
```

AgentHub 的关键约束是：**任何会影响 UI 的状态变更，都必须和对应事件发布在同一个 SQLite 事务里完成**。事件进入 `events` / `outbox` 后，通过 SSE 推送给前端；前端 `useProjector` 根据事件重建房间、消息、成员、Run、Task、Permission、Artifact 和 Deployment 视图。

这让刷新、断线重连和多端同步不会依赖某个页面里的临时状态，也让 Demo 中的每一步操作都有可追踪的事件证据。

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) `>= 22`
- [pnpm](https://pnpm.io/) `>= 10`（源码安装 / 开发需要）
- [Bun](https://bun.sh/) `>= 1.1`（源码安装 / 开发需要）

### 安装与运行

#### 推荐：通过 npm 安装

```powershell
npm install -g @rikey123/agenthub
agenthub web
```

`@rikey123/agenthub` 是 npm 上发布的包名；安装后暴露的命令仍然是 `agenthub`。`agenthub web` 会检查 daemon 是否已启动；如果没有，会启动本地 daemon，并打开 Web 工作台。

#### 源码安装

```powershell
git clone https://github.com/rikey123/AgentHub.git
cd AgentHub
pnpm install
pnpm build
.\agenthub.cmd web
```

源码安装适合参与开发、调试 daemon / Web UI，或需要修改本地代码后重新构建的场景。`.\agenthub.cmd web` 的行为和全局安装后的 `agenthub web` 一致。

| 服务                     | 地址                  |
| ------------------------ | --------------------- |
| daemon / 构建后的 Web UI | http://127.0.0.1:6677 |
| Web 开发服务器           | http://127.0.0.1:5173 |
| 移动端开发 UI            | http://127.0.0.1:5174 |

首次体验建议选择 `mock` 运行时。它不依赖外部 Agent CLI，可以稳定产生消息、Diff 和 artifact，适合验收、录屏和端到端演示。

## 常用命令

以下命令以 npm 全局安装后的 `agenthub` 为例；源码安装时可以把 `agenthub` 替换为 `.\agenthub.cmd`。

```powershell
# daemon 生命周期
agenthub web            # 启动 daemon 并打开 Web 工作台
agenthub start          # 后台启动 daemon
agenthub status         # 查看 daemon 状态
agenthub stop           # 停止 daemon
agenthub doctor         # 环境自检
agenthub auth issue     # 签发远程/移动端访问 token

# 质量检查
pnpm typecheck
pnpm test
pnpm lint
pnpm check:all

# 单端开发
pnpm --filter @agenthub/web dev
pnpm --filter @agenthub/desktop start
pnpm --filter @agenthub/mobile dev

# 打包
pnpm --filter @agenthub/desktop run package:dir
pnpm --filter @agenthub/desktop run dist
pnpm --filter @agenthub/mobile run android:apk
```

`pnpm check:all` 会组合运行事件、schema、可见性、依赖、命令、Bun API、状态机和订阅检查，适合提交前兜底。

## 项目结构

```text
apps/
  cli         命令行入口；agenthub.cmd 调用它管理 daemon
  web         React + Vite 主工作台
  desktop     Electron 桌面端，打包 daemon sidecar 和 Web UI
  mobile      React + Capacitor 移动端轻量工作台

packages/
  daemon          本地 HTTP/SSE daemon、鉴权、预览、部署、路由
  bus             CommandBus、EventBus、outbox、durable handler
  db              SQLite schema 与 migrations
  protocol        事件 registry、领域类型、preview contract
  orchestrator    RunQueue、RunLifecycle、selector、team dispatch、mailbox、MCP room tools
  artifacts       ArtifactFS、Diff、review、versioning、apply/recovery
  permissions     Permission Engine、profiles、rules、审计事件
  context         Context Ledger、brief、上下文装配
  security        CSRF、Origin/Host、token、keychain、SecretRedactor、路径安全
  sdk             Web/Desktop/Mobile 共享客户端 SDK
  agents          内置 Agent 模板
  skills          SKILL.md 加载与运行时 materialization
  adapters/*      claude-code、opencode、codex、mock、acp-base、a2a、langgraph
```

## Agent 运行时

| 运行时                                             | 状态     | 说明                                                        |
| -------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `mock`                                             | 主路径   | 内置确定性适配器，适合测试、演示和无外部依赖体验            |
| `claude-code`                                      | 主路径   | Claude Code ACP 适配，适合作为代码实现 Agent                |
| `opencode`                                         | 主路径   | OpenCode ACP 适配，适合作为代码/工具型 Agent                |
| `native`                                           | 主路径   | AgentHub 原生运行时                                         |
| `custom-acp`                                       | 主路径   | 接入任意自定义 ACP runtime                                  |
| `codex`、`qwen`、`goose`、`kimi`、`kiro`、`hermes` | 扩展入口 | runtime catalog 已预留，实际可用性取决于本机 CLI 和协议支持 |

设置页可以管理角色、运行时、模型、技能和 Agent binding。用户也可以通过联系人视角创建自己的 Agent：设置名称、头像、System Prompt、运行时、模型配置和技能集。

## 多端支持

| 端      | 定位       | 当前能力                                                     |
| ------- | ---------- | ------------------------------------------------------------ |
| Web     | 主力工作台 | 完整 IM、Run Detail、任务面板、Artifact Studio、设置中心     |
| Desktop | 本地增强   | Electron shell、daemon sidecar、本地文件能力、系统通知、Windows 打包 |
| Mobile  | 轻量协作   | 房间查看、消息回复、权限审批、artifact 只读预览、弱网重连    |
| CLI     | 运维入口   | 启停 daemon、状态检查、doctor、token、agent reset、调试命令  |

桌面端不通过任意 IPC 重写业务逻辑，而是加载 daemon-served Web UI；preload bridge 只暴露目录选择、文件选择、通知、打开路径、daemon 状态、重启、导出日志等白名单能力。移动端通过 token 连接本地或 LAN daemon，并使用 cursor 做断线补齐。

## AI 协作开发

AgentHub 把 AI 协作过程沉淀在仓库中，而不是只留在聊天记录里：

- `openspec/specs/*`：按 capability 管理需求。
- `openspec/changes/*`：每个阶段的 proposal、design、tasks 和归档记录。
- `docs/agenthub-agent-workflow.md`：代码 Agent 协作、分工、审查和 Oracle gate 规范。
- `docs/assisted-selector-groupchat-design.md`：群聊 selector 与协作模式设计。
- `docs/artifact-diff-gap-closure.md`：Artifact / Diff 能力差距分析与闭环记录。
- `AGENTS.md` / `CLAUDE.md`：GitNexus、事件总线、状态变更规则。
- `packages/skills/builtin/*/SKILL.md`：可复用的产物生成技能。

这种方式让 AI 不只是“帮忙写代码”，而是参与需求拆解、设计讨论、测试思路、文档沉淀和交付流程。

## 版本迭代

| 版本 | 里程碑                           | 关键能力                                                    |
| ---- | -------------------------------- | ----------------------------------------------------------- |
| v0.1 | MVP                              | 本地 daemon、SQLite、CommandBus / EventBus、单 Agent 会话   |
| v0.5 | Chatroom Complete                | 房间管理、聊天流、消息卡片、上下文连续                      |
| v1.0 | Orchestration                    | Orchestrator、RunQueue、RunLifecycle、pending turn、mailbox |
| v1.1 | Multi-Agent Complete             | Assisted / Team、selector、team dispatch、任务闭环  |
| v1.2 | Artifact Studio + Multi-platform | 产物预览与编辑、Diff 审查、部署发布、桌面端、移动端         |

## 路线图

- [ ] 将 Codex / Qwen / Goose / Kimi / Kiro / Hermes 等扩展运行时逐项验证到稳定可用。
- [ ] 完善 Workflow Canvas，使对话生成的流程图可以执行、复用和版本化。
- [ ] 强化上下文记忆：BM25、向量检索、hybrid memory。
- [ ] 接入更完整的 IDE 级代码审查和 LSP 诊断。
- [ ] 增强远程对象存储、跨设备 artifact 同步和团队共享能力。
- [ ] 完成桌面端签名、自动更新源和公开发布链路。

## 文档入口

| 文档                                                | 内容                                               |
| --------------------------------------------------- | -------------------------------------------------- |
| [产品设计文档](docs/PRODUCT_DESIGN_zh.md)           | 产品定位、用户场景、核心流程、信息架构、体验设计   |
| [技术文档](docs/TECHNICAL_REPORT_zh.md)             | 系统架构、数据流、事件总线、调度、权限、产物、多端 |
| [架构说明](docs/ARCHITECTURE.md)                    | 分层架构和模块边界                                 |
| [安全说明](docs/SECURITY.md)                        | 本地访问、鉴权、脱敏和路径安全                     |
| [权限 Profiles](docs/PERMISSION_PROFILES.md)        | 内置权限策略                                       |
| [多端运行手册](docs/multi-platform-runbook.md)      | Web、桌面端、移动端运行和打包                      |
| [桌面端 Bridge](docs/desktop-native-bridge.md)      | Electron preload 白名单能力                        |
| [Agent 协作工作流](docs/agenthub-agent-workflow.md) | AI 协作开发规范                                    |
| [OpenSpec](openspec/)                               | 需求规格、设计和阶段任务                           |

## 开发约定

```powershell
git checkout -b feat/your-feature
pnpm install
pnpm check:all
```

开发遵循 OpenSpec 驱动：先明确 capability 和 change，再实现、测试、审查。涉及状态变更的代码必须遵守事件总线契约：**状态写入和事件发布同事务完成**。涉及文件、shell、工具、上下文写入的能力必须经过 Permission Engine。

## 许可证

本项目为比赛 / 学习项目，当前未附带正式开源许可证。如需复用代码，请先联系作者。

---

<div align="center">
把多 Agent 协作从一段聊天，变成可追踪、可审查、可交付的工作流。
</div>


# AgentHub 多端适配调研文档

调研时间：2026-06-08

本文用于重新整理 AgentHub 多端适配方案。结论先行：多端适配不应改造现有 Web 主端，也不应引入云端同步、登录、设备体系或第二套后端。推荐方案是现有 Web 保持不动，桌面端使用 Electron 套壳并管理本地 daemon，移动端新开一套轻量 UI 并产出移动 App；所有端共用当前 AgentHub daemon。

## 1. 原始需求

以下为本次需求原文，完整保留：

多端支持：作为加分项，预期支持 Web 端、桌面端和移动端平台及产物，需考虑多人协作和多端消息同步、冲突解决等问题。

多端支持： 

平台｜定位

Web 端｜主力端，完整 IM 体验 + 代码编辑 + 全功能

桌面端｜本地文件访问、系统通知、Agent 进程管理

移动端｜轻量 IM 体验：查看对话、审批确认、产物预览

## 2. 项目红线和规范

多端方案必须遵守 AgentHub 既有项目定位，而不是把项目改造成云协作产品。

从现有文档提炼出的约束如下：

- AgentHub 是 local-first 产品。
- 不做 SaaS。
- 不做云端团队版。
- 不做多用户认证。
- 不做账号登录体系。
- 不做 Postgres。
- 不做 Redis。
- 不做 WebSocket Hub。
- 不新增云端同步后端。
- 不让各端拥有各自独立状态源。
- daemon 默认仍应以本地安全边界为主。
- 所有业务状态仍由现有 SQLite、CommandBus、EventBus、RunLifecycle、PermissionEngine 等模块承载。

旧文档中曾写过 V1.4 桌面端使用 Tauri、不做 Electron。但本轮产品决策已调整为桌面端使用 Electron。这个调整只影响桌面壳选型，不改变 local-first、不做云端、不做登录、共用 daemon 的核心红线。

移动端应明确产出移动 App，不走 PWA 路线。这里的移动端是独立的轻量移动 UI 加移动 App 封装。它不运行 daemon，不直接访问手机本地文件系统，不承载完整代码编辑能力。

## 3. 当前方案总览

推荐目标形态：

```text
apps/web       现有完整 Web 主端，保持不动
apps/desktop   Electron 桌面壳，加载现有 Web UI，管理 daemon 和本地能力
apps/mobile    新移动端轻量 UI，面向 IM、审批、预览，并产出移动 App

packages/daemon      共用原 daemon
packages/sdk         共用 API/SDK
packages/protocol    共用事件协议
packages/bus         共用 CommandBus/EventBus
```

运行关系：

```text
Web 浏览器
Electron Renderer
Mobile UI / App Shell
        |
        | HTTP / SSE / durable replay
        v
同一个 AgentHub daemon
        |
        v
SQLite / CommandBus / EventBus / Agent Runtime
```

核心原则：

- Web 端不做任何适配性改动。
- 桌面端不重做业务系统，只做 Electron 壳和 native bridge。
- 移动端不复用现有 Web 页面结构，新开一套轻量 UI。
- 后端继续共用原 daemon，不新增移动后端、桌面后端或设备同步服务。
- 多端同步的本质是多个客户端连接同一个 daemon，而不是多端之间互相同步。

## 4. Web 端定位

Web 端是当前主力端，已经基本完成，因此本阶段不应改动现有 Web UI。

Web 端继续承担：

- 完整 IM 体验。
- 代码查看与编辑。
- Run Detail。
- 任务编排。
- Agent 配置。
- 权限审批。
- 产物查看与应用。
- Debug、Timeline、Cost 等完整功能。

对 Web 端的实现要求：

- 不为了移动端把现有三栏主界面强行响应式化。
- 不为了桌面端改写 Web 架构。
- 不把桌面 native 能力塞进 Web 组件。
- 保持当前 Web 作为完整工作台的产品定位。

这可以最大限度降低风险。移动端的信息架构与 Web 主端天然不同，强行让同一套 Web UI 兼容桌面大屏和手机小屏，反而会破坏已经做完的主力端体验。

## 5. 桌面端定位

桌面端使用 Electron。

桌面端的定位是：

```text
Electron Shell = 现有 Web UI 壳 + Sidecar/Native Bridge
```

这里的 Sidecar/Native Bridge 是一组桌面壳能力：

- Sidecar：负责启动、检测、重启和托管本地 daemon。
- Native Bridge：负责把浏览器没有的本机能力以白名单 API 暴露给 renderer，例如系统通知、文件选择、打开路径、托盘和日志导出。

两者都属于 Electron 壳层，不是新的业务后端。

桌面端不应是：

```text
Electron = 第二套业务系统 / 第二套数据库 / 第二套消息同步
```

### 5.1 Sidecar/Native Bridge

Electron main process 负责 Sidecar/Native Bridge：

- 检测 daemon 是否运行。
- 启动 daemon。
- 关闭或保留 daemon。
- 管理 daemon 端口和健康检查。
- 管理 daemon 子进程生命周期。
- 系统通知。
- 托盘。
- 文件/目录选择。
- 打开本地路径。
- 打开外部链接。
- 窗口聚焦。
- Agent 进程管理入口。
- 日志导出。

daemon 仍是原来的 `packages/daemon`，不是 Electron 内部重写的后端。Electron 只是作为 sidecar host 启动它、观察它、必要时重启它。

### 5.2 Electron Renderer

Electron renderer 加载现有 Web UI。

可选加载方式：

- 开发期加载 Vite dev server。
- 生产期加载打包后的 Web 静态资源。
- renderer 通过 HTTP/SSE 连接本地 daemon。

renderer 不直接访问 Node API，不直接读写文件，不直接操作 Agent 进程。需要本机能力时，renderer 通过 preload 调用 Sidecar/Native Bridge 暴露的白名单 API。

### 5.3 Preload 安全边界

Electron 应启用：

- `contextIsolation: true`
- `nodeIntegration: false`
- preload 只暴露白名单 API

preload 是 Sidecar/Native Bridge 给 renderer 的安全入口。暴露能力应保持很薄，例如：

- `openDirectoryPicker`
- `openFilePicker`
- `showNotification`
- `openPath`
- `openExternal`
- `getDaemonStatus`
- `restartDaemon`
- `exportLogs`

业务命令仍走 daemon API。preload 只补浏览器没有的本机能力，以及少量 daemon sidecar 管理能力。

### 5.4 OpenCode 可借鉴点

OpenCode 桌面端也是 Electron + sidecar/bridge 思路。它的价值不在于提供第二套业务状态，而在于：

- 管理本地 server/sidecar。
- 给 renderer 提供受控 IPC。
- 提供文件选择、系统通知、窗口控制等 native 能力。

AgentHub 可以借鉴这个壳层职责，但不照搬 OpenCode 的认证或 share/cloud 方案。

## 6. 移动端定位

移动端新开一套轻量 UI，不在现有 `apps/web` 上做响应式改造。

推荐形态：

```text
apps/mobile = 新移动端轻量 UI
移动端产物 = 独立移动 App
后端 = 连接同一个 AgentHub daemon
```

移动端只做轻量控制端，能力包括：

- 查看对话。
- 查看 Room 列表。
- 查看任务状态。
- 查看 Run 摘要。
- 审批确认。
- 产物预览。
- 简单回复。
- 接收通知。

移动端不做：

- 完整代码编辑。
- 完整 Run Detail。
- Debug 面板。
- 本地 daemon。
- 本地 Agent 进程管理。
- 手机本地文件系统读写。
- 高风险 shell/terminal 操作。

### 6.1 为什么新开一套 UI

移动端的核心任务不是“把完整 AgentHub 缩小到手机屏幕”，而是“让用户在手机上完成少数高频轻操作”。

Web 主端是工作台：

- 多栏。
- 信息密度高。
- 支持代码和复杂产物。
- 面向长时间工作。

移动端是控制台：

- 单栏。
- 信息密度低。
- 以消息、审批、预览为主。
- 面向短时间查看和确认。

两者信息架构不同，因此新开 `apps/mobile` 比改造 `apps/web` 更稳。

### 6.2 移动端连接方式

移动端不运行 daemon，因此不能默认连接手机自己的 `127.0.0.1:6677`。

可选连接方式：

- 局域网访问桌面机/开发机 daemon。
- 用户手动配置 daemon URL。
- 使用显式开启的本地 token。
- 后续可评估反向代理，但不引入云后端。

这不等于做登录，也不等于设备体系。它只是 local-first 产品对外暴露本地 daemon 的访问入口。

## 7. 共用 daemon

daemon 继续使用当前原有实现。

当前 daemon 已具备多端共享的关键基础：

- HTTP API。
- SSE 事件流。
- durable event replay。
- CommandBus。
- EventBus。
- SQLite。
- PermissionEngine。
- RunLifecycle。
- ArtifactService。
- SDK/OpenAPI 基础。

多端适配不应引入：

- 桌面专用 daemon。
- 移动专用 daemon。
- 云端同步 daemon。
- 登录服务。
- 设备表。
- 多租户表。

各端写操作仍进入 daemon：

```text
client request -> daemon route -> CommandBus -> domain service -> SQLite transaction -> EventBus.publish
```

各端读状态仍来自：

```text
durable replay + live SSE + read API
```

## 8. 多人协作的解释

原始需求中提到“多人协作”。结合项目红线，这里不应解释为账号体系、多租户、云团队空间。

在当前阶段，多人协作应收敛为：

- 同一台机器上多个窗口同时打开 AgentHub。
- Web 端和 Electron 端同时连接同一个 daemon。
- 局域网内移动端访问同一个本地 daemon。
- 多个客户端看到同一套 Room、Message、Run、Permission、Artifact 状态。

也就是说，协作边界是同一个本地 workspace 和同一个 daemon，而不是云端多人空间。

未来如果确实要做跨用户团队协作，需要单独立项，并且会违反当前 local-first 红线；不应混入本次多端适配。

## 9. 多端消息同步

多端消息同步不需要新建同步系统。

AgentHub 已经有正确方向：

```text
SQLite durable events
        |
EventBus / SSE
        |
frontend projector
```

多端同步只需确保：

- Web、Desktop、Mobile 都连接同一个 daemon。
- 各端都能从 durable events 重建状态。
- SSE 断线后能按 `seq` 补齐。
- 移动端可以只消费轻量视图。

推荐补充能力：

```text
GET /sync/events?sinceSeq=123&view=mobile
GET /sync/snapshot?view=mobile
```

这里的 `sinceSeq` 是客户端本地 cursor，不是设备身份。

客户端可以把最后消费到的 seq 存在本地：

- Web：localStorage/sessionStorage。
- Desktop：renderer localStorage 或 Electron store。
- Mobile：移动 App 本地存储。

服务端只负责根据 `sinceSeq` 返回 durable events，不需要保存“哪个设备消费到哪里”。

## 10. 冲突解决

冲突解决不应另起复杂体系。沿用 AgentHub 现有业务规则即可。

### 10.1 消息

消息采用 append-only。

- 新消息创建后就是事实。
- 重复提交通过 `clientMessageId` 或 `idempotencyKey` 去重。
- 编辑和撤回作为后续事件表达。

### 10.2 审批

审批采用 first-wins。

- 第一个有效审批写入结果。
- 其他端再点审批时返回“已处理”。
- UI 显示当前 permission 已 resolved。

这足以覆盖多个窗口或移动端同时点审批的情况。

### 10.3 任务状态

任务状态继续使用状态机和乐观并发。

- 请求带当前版本或当前状态。
- 服务端校验状态迁移是否合法。
- 冲突时返回当前状态。

### 10.4 Context

Context 继续使用版本化和 conflict event。

- patch 带 base version。
- 当前版本不一致时生成 conflict。
- 用户在 Web/Desktop 主端处理冲突。

### 10.5 文件和产物

移动端不直接编辑文件，因此文件冲突主要由 Web/Desktop 处理。

- Web/Desktop 可以 review/apply diff。
- 移动端可以预览和审批。
- worktree apply 冲突仍生成现有 conflict event。

## 11. 分阶段实现建议

### Phase 1：文档和边界确认

- 明确 Web 不动。
- 明确 Electron 桌面壳。
- 明确移动端新开 UI。
- 明确共用 daemon。
- 明确不做登录、设备层、云同步。

### Phase 2：Electron 桌面端

- 新建 `apps/desktop`。
- Electron main 管理 daemon。
- renderer 加载现有 Web。
- preload 暴露少量 native API。
- 支持系统通知、文件选择、打开路径、日志导出。

### Phase 3：移动端轻 UI

- 新建 `apps/mobile`。
- 复用 SDK/protocol。
- 实现 Room 列表、聊天流、审批卡、产物预览。
- 不复用 `apps/web` 页面结构。
- 产出移动 App，不按 PWA 路线交付。

### Phase 4：daemon 薄补强

只做多端必要的薄能力：

- 更稳定的 SSE reconnect。
- durable events 按 `sinceSeq` replay。
- `view=mobile` 或移动端轻量事件过滤。
- artifact preview 在移动端可安全访问。
- 显式 LAN bind/token 配置。

### Phase 5：体验打磨

- 桌面通知与权限卡联动。
- 移动端审批体验打磨。
- 移动端产物预览体验打磨。
- Electron 自动更新和打包。
- 移动 App 打包。

## 12. 最终结论

本次多端适配应定义为：

```text
现有 Web 主端保持不动
+ Electron 桌面壳
+ 独立移动轻 UI
+ 移动 App 产物
+ 共用原 daemon
```

这不是云端多用户同步项目，也不是设备管理项目，更不是三套后端。它是 local-first AgentHub 在不同载体上的产品化适配。

桌面端的核心价值是本地能力：本地文件访问、系统通知、Agent 进程管理。

移动端的核心价值是轻量控制：查看对话、审批确认、产物预览。

Web 端的核心价值是完整工作台：完整 IM 体验、代码编辑和全功能。

只要坚持共用 daemon，多端消息同步和冲突解决就不会变复杂；它们本质上仍是当前 EventBus、durable event、CommandBus 幂等和业务状态机的问题。

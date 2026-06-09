# AgentHub 多端适配需求文档

| 项 | 内容 |
|---|---|
| 文档类型 | 需求文档（Requirements Specification） |
| 版本 | v0.5（草案） |
| 创建日期 | 2026-06-08 |
| 状态 | 待评审 |
| 关联文档 | [多端适配调研文档](./multi-platform-adaptation-research.md)、[ARCHITECTURE.md](./ARCHITECTURE.md)、[SECURITY.md](./SECURITY.md)、[CLAUDE.md](../CLAUDE.md) 中的 Event Bus Contract |
| 适用范围 | `apps/web`、新增 `apps/desktop`、新增 `apps/mobile`、共用 `packages/daemon` 及相关 packages |

> 本文是在调研文档基础上收敛出的需求基线。调研文档负责论证方向与取舍，本文负责把方向落成可评审、可验收、可拆任务的需求条目。两者结论一致：多端适配的本质是“多个客户端连接同一个本地 daemon”，不是云协作、不是设备体系、不是三套后端。

## 1. 背景与目标

### 1.0 原始需求原文（逐字保留，供评审追溯）

> 多端支持：作为加分项，预期支持 Web 端、桌面端和移动端平台及产物，需考虑多人协作和多端消息同步、冲突解决等问题。
>
> 多端支持：
>
> | 平台 | 定位 |
> |---|---|
> | Web 端 | 主力端，完整 IM 体验 + 代码编辑 + 全功能 |
> | 桌面端 | 本地文件访问、系统通知、Agent 进程管理 |
> | 移动端 | 轻量 IM 体验：查看对话、审批确认、产物预览 |

本需求文档是对上述原始需求、在 local-first 红线下的工程化展开；如条目与原文有取舍差异（如“多人协作”收敛、移动端能力裁剪），均在对应章节标注理由。

### 1.1 背景

AgentHub 是 local-first 的多 Agent 工作台，当前 Web 主端（`apps/web`）已基本开发完成，承载完整 IM 体验、代码查看编辑、Run Detail、任务编排、Agent 配置、权限审批与产物管理。原始需求把“多端支持”列为加分项，预期覆盖 Web、桌面、移动三类平台及产物，并要求考虑多人协作、多端消息同步与冲突解决。

### 1.2 目标

在不破坏现有 Web 主端、不引入云后端、不新增登录与设备体系的前提下，交付：

- 桌面端（Electron 壳）：复用现有 Web UI，补齐本地能力（文件访问、系统通知、Agent 进程管理、daemon 托管）。
- 移动端（独立轻量 UI + 移动 App 产物）：面向查看、审批、预览等高频轻操作。
- 共用 daemon 的多端连接与消息同步能力。

### 1.3 非目标（红线）

以下内容明确**不在本次范围内**，与既有产品定位冲突，如未来要做需单独立项：

- 不做 SaaS / 云端团队版 / 多租户。
- 不做账号登录体系、用户表、设备表。
- 不引入 Postgres / Redis / WebSocket Hub / 云同步后端。
- 不新增桌面专用、移动专用或云端专用 daemon。
- 不让任何一端拥有独立状态源。
- 不把 Web 主端三栏工作台强行响应式化以兼容手机。
- 移动端不走 PWA 路线，需产出移动 App 安装包（技术栈 native / hybrid 待定，不在本文锁定）。
- 不做移动端后台推送（APNs/FCM）。后台 push 本质需云中继，与 local-first 冲突；移动端通知仅限 App 前台且在线时（见 §8 RISK-2）。
- 不引入新的鉴权体系（JWT / session / OAuth / 登录）。多端复用 daemon **已有的** Bearer token 机制即可，不新造（见 §6 开头说明）。
- **只支持同一局域网内访问**。移动端与电脑须连同一 WiFi/路由器访问 daemon；不做跨网络/公网穿透（VPN、隧道、中继均不在本次范围）。跨网络远程访问如未来需要，由用户在网络层自行解决，与本文无关。

## 2. 名词与角色

| 术语 | 定义 |
|---|---|
| daemon | 现有 `packages/daemon`，本地 HTTP/SSE 服务，所有业务状态的唯一来源 |
| 客户端 | 连接 daemon 的前端，包括 Web 浏览器、Electron renderer、移动 App |
| Sidecar | Electron main 进程托管本地 daemon 子进程的能力 |
| Native Bridge | Electron 通过 preload 白名单向 renderer 暴露的本机能力 |
| durable event | 注册为 `durable` 的事件，可在 SSE 重连时按 seq 重放，是各端重建状态的依据 |
| cursor / seq | 事件的单调递增序号；客户端记录本地消费到的 seq 作为重放游标 |
| 连接配置导入 | 移动端获取 daemon URL + token 的过程（行业惯称 pairing）。这里是“导入一份连接配置”，**不是设备绑定，也不建设备表** |

### 2.1 参考项目

工作区参考目录 `AgentHub/refrence/`（注意目录名拼写为 `refrence`，位于 AgentHub 仓库目录**内**，但已被 `.gitignore` 排除（`.gitignore:85-86`），不随仓库提交/分发）下放置了两个外部项目，仅供实现参考。**判断标准：只借鉴对“多端适配”有用的工程手法，与本任务无关的（如各自的 i18n/汉化方案）不纳入；与红线冲突的技术选型须剥离。** 注意区分“否决某个技术选型”与“否决整个项目”——后者不成立。

| 项目 | 技术栈 | 对多端适配可借鉴 | 须剥离 / 不参考 |
|---|---|---|---|
| AionUi | Electron（`electron-vite` + `electron-builder` + `electron-updater`）+ 移动端 Expo / React Native | ① Electron 壳分层（main/preload/renderer，`contextIsolation:true`、`nodeIntegration:false`）；② 其 dev `loadURL` / prod `loadFile` 双加载结构可参考，但本项目 prod 走 `loadURL` 同源加载、不用 `loadFile`（见 R-DSK-07）；③ 移动端**扫码导入连接配置**交互（`mobile/app/connect.tsx` 解析二维码取 host/port/token）；④ Expo hybrid 印证移动端不必锁纯 native；⑤ `docs/` 下 architecture/prds/specs 的产品文档组织（写本需求文档时的格式参照） | 其移动端走 **WebSocket + JWT 登录**——我们不引入 WebSocket Hub、不造 JWT，传输用现有 SSE + JSON 拉取，token 用 daemon 已有机制 |
| golutra | Tauri 桌面（`src-tauri`，Rust 后端）+ 多 AI CLI 编排 | ① 多外部 CLI runtime 进程编排（shim/pty/terminal_engine）思路，桌面端 Sidecar 托管 daemon 子进程时可参考；② notification orchestrator store 设计，桌面通知联动（R-DSK-06）可参考；③ 跨平台打包结构 | **Tauri 桌面选型已被否决**（桌面端定 Electron）；其 i18n/locale 方案与本任务无关，不参考 |

涉及的人类角色只有一类：**单用户在同一本地 workspace 下的多个客户端**。“多人协作”在本项目中收敛为“同一 daemon 的多客户端并发”，不是跨用户云空间（见 §7）。

## 3. 现状基线（已核对代码）

下表是对调研文档技术假设的代码核对结果，作为需求的事实基线。**标记“已具备”的能力不需要重新开发，需求只需复用或薄封装。**

| 能力 | 代码位置 | 状态 |
|---|---|---|
| 单一共用 daemon，多客户端连同一实例 | `packages/daemon/src/index.ts` | 已具备 |
| 按 cursor/seq 的 SSE durable 重放 | `/event?cursor=N&view=main\|detail\|raw`，支持 `Last-Event-ID` 头（index.ts:2474-2475） | 已具备 |
| 事件可见性分流（main/detail/raw） | `visible()`（index.ts:2483） | 已具备 |
| 显式 LAN bind + 强制 token 守卫 | config 默认 `127.0.0.1`，`0.0.0.0` 必须配 `auth.token` 且 `remote.enabled`（config.ts:206-211） | 已具备 |
| 非浏览器客户端 Bearer token 鉴权 | `authenticateBrowserRequest`：**先校验 Origin/Host，再处理 Bearer**（security/index.ts:237-243）。无 Origin 的原生请求走 Bearer 分支，免 Cookie/CSRF；但若客户端发了不被允许的 Origin，仍会被 403 挡下 | 已具备（注意 Origin 前置，见 §8 RISK-6） |
| token 签发与吊销 | `POST/GET /auth/tokens`、`agenthub auth issue\|list\|revoke` | 已具备 |
| 共用 SDK（fetch-based，接收 baseUrl + token） | `packages/sdk/src/index.ts` | 已具备但需增强（见 R-SY-04） |
| 幂等去重（idempotencyKey / clientMessageId） | SDK 多个写接口已带 `idempotencyKey` 参数 | 已具备 |
| 共用事件协议 | `packages/protocol` 事件注册表 | 已具备 |

**结论**：调研文档 Phase 4 中“按 sinceSeq replay”“显式 LAN bind/token”均已实现；真正的新增后端工作量只有 §6 列出的少数几项。

## 4. 需求编号与优先级约定

- 编号格式：`R-<域>-<序号>`。域：`WEB` Web 端、`DSK` 桌面端、`MOB` 移动端、`SY` 同步与协作、`SEC` 安全、`NFR` 非功能。
- 优先级：`P0` 必须（本次交付范围内的核心）、`P1` 应该（强烈建议）、`P2` 可选（视资源）。
- 每条需求带验收标准（Acceptance Criteria，AC），AC 可被测试或人工验证。

## 5. 功能需求

### 5.1 Web 端（保持不动）

Web 主端在本次适配中**不做适配性改动**，只承担约束性需求，确保其他端的改动不回流污染 Web。

| 编号 | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| R-WEB-01 | P0 | Web 主端 UI 架构、三栏布局、信息密度保持现状，不为移动端做响应式重构 | 多端工作期间 `apps/web` 的组件结构无破坏性改动；现有测试全绿 |
| R-WEB-02 | P0 | 桌面 native 能力不得以硬依赖形式进入 Web 组件 | Web 在纯浏览器环境（无 Electron preload）下功能完整，不报错、不出现“功能缺失”占位 |
| R-WEB-03 | P1 | Web 端可被 Electron renderer 原样加载（dev 加载 Vite server，prod 加载静态产物） | Electron 中加载的 Web UI 与浏览器中行为一致 |
| R-WEB-04 | P2 | native 能力优先在 Electron 壳层处理；**仅当现有 Web 已有对应入口**时，才让该入口在 Electron 中走 Native Bridge、在浏览器中降级或隐藏 | 不为此改动 Web 架构；浏览器环境功能完整不报错 |

### 5.2 桌面端 `apps/desktop`（Electron）

桌面端 = 现有 Web UI 壳 + Sidecar/Native Bridge，**不是第二套业务系统**。

| 编号 | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| R-DSK-01 | P0 | 新建 `apps/desktop`，Electron main + preload + renderer 三层结构 | 应用可在 Windows 启动并加载 Web UI（macOS/Linux 为 P2） |
| R-DSK-02 | P0 | Electron 启用 `contextIsolation: true`、`nodeIntegration: false`，renderer 不直接访问 Node API | 审查 BrowserWindow 配置；renderer 内 `require`/`process` 不可用 |
| R-DSK-03 | P0 | Sidecar：main 进程检测、启动、健康检查、必要时重启本地 daemon，并管理其子进程生命周期 | 冷启动时若 daemon 未运行则自动拉起；daemon 崩溃时可重启；应用退出时按策略关闭或保留 daemon |
| R-DSK-04 | P0 | Native Bridge 仅通过 preload 暴露白名单 API，业务命令仍走 daemon HTTP/SSE | preload 暴露面审查通过；无任意 IPC 透传 |
| R-DSK-05 | P0 | 白名单 native 能力至少包含：`openDirectoryPicker`、`openFilePicker`、`showNotification`、`openPath`、`openExternal`、`getDaemonStatus`、`restartDaemon`、`exportLogs` | 每个 API 有单测或手动验证用例 |
| R-DSK-06 | P1 | 系统通知与权限审批联动：daemon 产生待审批事件时桌面弹系统通知，点击聚焦到对应审批卡 | 触发一次权限请求，桌面收到通知并能跳转 |
| R-DSK-07 | P0 | **优先同源加载**：Electron renderer 通过 `loadURL(http://127.0.0.1:<port>/...)` 加载 daemon 托管的 Web 静态资源（daemon 已具备静态资源服务，index.ts:201/2833）。renderer 与 daemon 同源，请求自带合法 Origin，免去向不可改的 Web 注入配置。dev 期 `loadURL` 指向 Vite/daemon，prod 期同样 `loadURL` 指向 daemon-served 资源——**不用 `loadFile`**（`file://` 协议非 daemon 同源，会触发 Origin 校验问题） | renderer 经 http 同源加载；Web 无需为 Electron 改动即可消费连接；Origin 校验通过 |
| R-DSK-09 | P1 | 仅当走非同源/custom protocol 加载（不推荐）时，才需把该 origin 加入 daemon `allowedOrigins`，并通过 preload 注入 daemon URL/token，Web 以“可选读取”方式消费、缺失回退默认 loopback | 非同源场景 origin 在白名单内；注入缺失时 Web 仍以默认配置工作 |
| R-DSK-08 | P2 | Electron 应用打包与自动更新 | 产出可分发安装包；更新通道可配置 |

### 5.3 移动端 `apps/mobile`（独立轻 UI + 移动 App）

移动端新开一套轻量 UI，面向控制台场景，**不复用 Web 页面结构**。

| 编号 | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| R-MOB-01 | P0 | 新建 `apps/mobile`，独立轻量 UI，单栏信息架构，复用 `packages/sdk` 与 `packages/protocol` | 应用结构独立于 `apps/web`；不 import Web 组件 |
| R-MOB-02 | P0 | 支持查看：Room 列表、聊天流、任务状态、Run 摘要 | 列表与详情可从 daemon 数据正确渲染 |
| R-MOB-03 | P0 | 支持权限审批：展示待审批项、allow/deny，遵循 first-wins（见 R-SY-06） | 审批后 daemon 状态更新，其他端同步看到 resolved |
| R-MOB-04 | P0 | 支持产物预览（只读），不提供产物 apply/revert | 可预览 diff/文件内容；无写操作入口 |
| R-MOB-05 | P0 | 支持简单回复（发送文本消息），带 idempotencyKey 去重 | 弱网重发不产生重复消息 |
| R-MOB-06 | P1 | 产出移动 App 安装包（不走 PWA；native / hybrid 技术栈待定） | 至少一个平台（iOS 或 Android）可产出可安装包 |
| R-MOB-07 | P0 | 移动端不做：完整代码编辑、完整 Run Detail、Debug 面板、本地 daemon、本地 Agent 进程管理、手机本地文件读写、高风险 shell/terminal 操作 | 上述能力在移动端无入口 |
| R-MOB-08 | P0 | 移动端通过用户配置或配对获取的 daemon URL + token 连接，不假定 `127.0.0.1` | 首次启动有配置/配对流程；连接局域网内 daemon 成功 |
| R-MOB-09 | P1 | 移动端消费轻量事件视图，按本地 cursor 断线重连补齐 | 杀进程重进后状态可重建；不丢消息、不重复 |

### 5.4 同步、协作与冲突

多端同步的本质是“多客户端连同一 daemon”，不是端到端互相同步。

| 编号 | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| R-SY-01 | P0 | 所有端通过 durable event + live SSE 重建状态，写操作统一进 daemon（client → route → CommandBus → service → SQLite tx → EventBus.publish） | 任一端写入后，其他在线端无需刷新即可看到（遵循 Event Bus Contract） |
| R-SY-02 | P0 | SSE 断线重连后按客户端本地 cursor（seq）补齐 durable events | 模拟断网恢复，缺口事件被补齐且不重复 |
| R-SY-03 | P0 | 各端本地持久化最后消费的 seq：Web→localStorage、Desktop→Electron store/localStorage、Mobile→App 本地存储 | 重启客户端后从上次 cursor 续传 |
| R-SY-04 | P1 | `packages/sdk` 增强：补全类型（消除大面积 `Promise<unknown>`），并提供统一的事件订阅 + 自动重连 + cursor 管理抽象，供三端复用 | desktop/mobile 不各写一套 EventSource/重连逻辑；SDK 有对应单测 |
| R-SY-05 | P0 | 消息 append-only，靠 `clientMessageId`/`idempotencyKey` 去重；编辑撤回作为后续事件 | 重复提交同一 idempotencyKey 不产生重复消息 |
| R-SY-06 | P0 | 审批 first-wins：首个有效审批写结果，其余端再点返回“已处理”，UI 显示 resolved | 两端同时审批，仅一个生效，另一端得到已处理反馈 |
| R-SY-07 | P1 | 任务状态用状态机 + 乐观并发：请求带当前版本/状态，服务端校验迁移合法性，冲突返回当前状态 | 并发改任务状态时非法迁移被拒并返回现状 |
| R-SY-08 | P1 | Context 用版本化 + conflict event：patch 带 baseVersion，版本不一致生成 conflict，由 Web/Desktop 主端处理 | 并发改 context 产生 conflict event；移动端不处理写冲突 |
| R-SY-09 | P0 | 文件/产物写冲突主要由 Web/Desktop 处理；移动端只预览与审批；worktree apply 冲突沿用现有 conflict event | 移动端无 diff apply 入口；冲突在主端可见 |

### 5.5 daemon 侧新增/增强（本次唯一实质后端工作量）

调研文档把这部分预估为“薄补强”。核对后，多数能力已具备（见 §3），真正新增项如下：

| 编号 | 优先级 | 需求 | 验收标准 | 备注 |
|---|---|---|---|---|
| R-SY-10 | P0 | 提供**纯 JSON 的按 seq 拉取端点**（如 `GET /sync/events?sinceSeq=N&view=mobile`），不假定移动 App runtime 具备稳定 `EventSource`，故以 JSON 增量拉取为更稳妥的补齐通道 | 移动端可不依赖 SSE/polyfill 拉取增量事件 | 当前事件出口仅 SSE（`/debug/events` 受 admin 限制），见 §8 RISK-1 |
| R-SY-11 | P1 | 提供移动端轻量视图/快照（如 `view=mobile` 过滤、`GET /sync/snapshot?view=mobile`），降低移动端首屏与流量 | 移动端首屏仅拉取轻量字段，不拉完整 detail 流 | |
| R-SY-12 | P1 | 产物预览在移动端可安全访问（受 token 鉴权、经 SecretRedactor 脱敏、尺寸/类型受限） | 移动端预览不泄露绝对路径/密钥 | 复用现有 `file://`/`data:` 安全校验 |
| R-SEC-01 | P0 | 移动端**连接配置导入**：在已认证的 Web/Desktop 端生成 daemon URL + token（建议二维码），移动端扫码或手填导入。借鉴 AionUi `connect.tsx` 的扫码交互，但 token 用 daemon 已有签发机制，不引入 JWT | 无需登录体系即可让手机拿到连接配置；token 可吊销 | 见 §8 RISK-3；token 签发已具备，缺的是分发 UX |
| R-SEC-02 | P0 | 移动端走局域网，daemon 须绑定局域网 IP（如 `192.168.x.x`）而非 `127.0.0.1`。**任何非 loopback bind 都强制 `token` 且 `remote.enabled = true`**（index.ts:216 对任何非 loopback host 触发，不止 `0.0.0.0`；config.ts:206 是另一道仅针对 `0.0.0.0` 的守卫）。需求层面确认：为支持移动端而绑局域网时，token 是 daemon 强制项，不放松 | 绑局域网 IP 未配 token 或未开 remote 时，daemon 拒绝启动 | 这是移动端接入的主路径；token 即“连接口令”，非登录 |

## 6. 安全需求

> **关于“是否要鉴权”的结论**：本次**不新增**任何鉴权技术。daemon 已内建 Bearer token 校验与 `0.0.0.0` 强制 token 守卫，多端只是**复用**它。一旦移动端走局域网，不带 token 即等于把本地 workspace 暴露给同网段任意设备，违背 local-first 安全边界——所以 token 不是可省的新增项，而是既有边界的延续。要避免的是去造 JWT/session/登录体系（AionUi 的 JWT 方案不抄）。

| 编号 | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| R-SEC-03 | P0 | 默认仍以本地 loopback 为安全边界；LAN 暴露须用户显式开启并带 token | 默认配置不监听非 loopback |
| R-SEC-04 | P0 | **移动 App / native HTTP client**：用 Bearer token 鉴权，请求通常无 Origin，走 Bearer 分支免 CSRF | 移动端无 Origin + Bearer 请求鉴权通过 |
| R-SEC-04b | P0 | **Electron renderer**：本质 browser-like，请求会带 Origin，须按浏览器 Origin/Host 规则处理——因此必须同源加载（R-DSK-07）或把 origin 列入 `allowedOrigins`（R-DSK-09），不能依赖“无 Origin 免 CSRF” | Electron renderer 请求的 Origin 通过校验，写操作满足 CSRF 要求 |
| R-SEC-08 | P0 | Electron renderer **必须使用 daemon 同源页面**（R-DSK-07）；若用 custom protocol/非同源加载，须把该 origin 显式加入 daemon `allowedOrigins` | Electron 请求的 Origin 通过 daemon 校验，不被 403 |
| R-SEC-05 | P0 | 所有经 SSE/API/日志的输出沿用 `SecretRedactor` 脱敏，移动端预览同样脱敏 | 输出中无 Bearer/API key/绝对路径明文 |
| R-SEC-06 | P1 | token 可在任一已认证端列出与吊销，吊销后移动端连接失效 | 吊销后移动端请求返回 401 |
| R-SEC-07 | P1 | Electron preload 暴露面保持最小白名单，新增 native 能力须走评审 | preload API 清单有文档记录 |

## 7. “多人协作”的范围澄清（需求约束）

原始需求中的“多人协作”在本项目红线下收敛为：

- 同一台机器多个窗口同时打开 AgentHub；
- Web 与 Electron 端同时连同一 daemon；
- 局域网内移动端访问同一本地 daemon；
- 多客户端看到同一套 Room/Message/Run/Permission/Artifact 状态。

协作边界 = 同一本地 workspace + 同一 daemon（含同一局域网内接入的客户端）。**跨用户云团队协作不在本次范围**，若要做需单独立项且会触红线。

## 8. 未决问题与风险（需在 Phase 1 决策）

以下为核对代码后发现、调研文档未充分覆盖、且会影响移动端可行性的问题。每条须在文档/边界确认阶段给出结论。

| 编号 | 风险/问题 | 影响 | 建议处置 | 关联需求 |
|---|---|---|---|---|
| RISK-1 | **不能假定移动 App runtime 有稳定 `EventSource`。** 不同技术栈（RN/Expo/WebView）的 SSE 支持参差，且 daemon 普通 JSON 增量拉取仅 admin 受限的 `/debug/events`。 | 移动端事件流补齐不稳 | 新建纯 JSON 的 `GET /sync/events?sinceSeq=` 端点（更稳）；SSE 作为可选优化。 | R-SY-10 |
| RISK-2 | **移动端后台通知与 local-first 冲突。** 后台 push（APNs/FCM）本质需云中继；坚持不做云，则通知只能在“App 前台 + 同 LAN 连着 daemon”时工作。 | “接收通知”能力受限 | 已在 §1.3 非目标中明确：移动端仅前台/在线通知，后台 push 非目标。 | R-MOB-09 |
| RISK-3 | **移动端连接配置分发缺设计。** 签发 token 的 `POST /auth/tokens` 需 write scope（须先有 session），手机无从自助获取。 | 移动端无法接入 | 主端生成二维码（URL+token），手机扫码导入（借鉴 AionUi connect.tsx）。 | R-SEC-01, R-MOB-08 |
| RISK-4 | **SDK 无类型且无事件流封装。** 现为 `Promise<unknown>`，且不含订阅/重连/cursor 抽象。 | 各端重复造轮子，易出现独立状态源 | 先增强 SDK 再铺开 desktop/mobile。 | R-SY-04 |
| RISK-5 | 桌面端 daemon 生命周期（退出时关闭还是保留）影响其他端连接。 | 误关 daemon 会断掉 Web/移动端 | 默认保留 daemon 或提供用户选项；关闭前检测其他活跃客户端。 | R-DSK-03 |
| RISK-6 | **Origin 校验先于 Bearer。** Electron/WebView 若发出不被允许的 Origin，即使带合法 token 仍被 403。 | Electron renderer 可能连不上 daemon | Electron 同源加载 daemon-served 资源（R-DSK-07）；非同源须把 origin 加入 `allowedOrigins`。 | R-SEC-08, R-DSK-07 |

## 9. 非功能需求

| 编号 | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| R-NFR-01 | P0 | 不回归：多端工作不破坏现有 Web 测试与构建（`pnpm.cmd build`、`pnpm.cmd test` 全绿） | CI/本地构建与测试通过 |
| R-NFR-02 | P0 | 新增 `apps/desktop`、`apps/mobile` 纳入 monorepo（pnpm workspace + turbo），独立可构建 | 根目录 build 能识别并构建新 app |
| R-NFR-03 | P1 | 新增端的关键路径（连接、鉴权、事件补齐、审批）有测试覆盖 | 对应单测/集成测试存在 |
| R-NFR-04 | P1 | 移动端首屏与断线重连在弱网下可用（轻量视图、增量拉取） | 弱网模拟下首屏可渲染、重连可补齐 |
| R-NFR-05 | P2 | 文档与产物可复现：各端有启动/打包说明 | README/对应 app 文档具备构建步骤 |

## 10. 分阶段交付与需求映射

| 阶段 | 内容 | 覆盖需求 |
|---|---|---|
| Phase 1 边界确认 | 确认红线、决策 §8 全部风险、冻结本需求基线 | §1.3, §7, §8（RISK-1~6） |
| Phase 2 SDK 增强 + 桌面端 | `packages/sdk` 类型化与事件流抽象；`apps/desktop` Electron 壳、Sidecar、Native Bridge、同源加载 | R-SY-04, R-DSK-01~09, R-WEB-03/04, R-SEC-07/08 |
| Phase 3 daemon 薄补强 | JSON 拉取端点、轻量视图、移动产物预览、连接配置导入、局域网 bind + token——**移动端的前置依赖** | R-SY-10~12, R-SEC-01/02 |
| Phase 4 移动端 | `apps/mobile` 轻 UI、局域网连接配置导入与审批/预览/简单回复 | R-MOB-01~09, R-SEC-01/04 |
| Phase 5 体验打磨 | 通知联动、移动审批/预览打磨、Electron 自动更新、移动 App 打包 | R-DSK-06/08, R-MOB-06, R-NFR-04/05 |

> 调整说明：移动端（原 Phase 3）依赖 daemon 的 JSON 拉取端点、轻量视图与连接配置导入，故把 daemon 薄补强提前到移动端之前；SDK 增强（R-SY-04）前置到 Phase 2，避免 desktop/mobile 各写一套连接逻辑。

## 11. 验收总览

本次多端适配视为达成，当且仅当：

1. 现有 Web 主端零回归（R-NFR-01）。
2. 桌面端能托管 daemon 并加载 Web UI，具备白名单 native 能力（R-DSK-01~05）。
3. 移动端能连接局域网 daemon，完成查看 / 审批 / 预览 / 简单回复，且断线可重建状态（R-MOB-02~05/08/09）。
4. 多端写操作经同一 daemon、靠事件同步、冲突按既有规则解决（R-SY-01~09）。
5. §8 全部风险（RISK-1~6）在 Phase 1 有明确结论。
6. 安全红线不放松（R-SEC-*）。

## 12. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-06-08 | 基于调研文档与代码核对，首次形成需求基线草案 |
| v0.2 | 2026-06-08 | 采纳评审意见：移动 App 不锁技术栈、R-WEB-04 降级、R-DSK-07 改同源加载、修正 Bearer/Origin 校验顺序、EventSource 表述放宽、daemon 补强前置到移动端之前、pairing 改“连接配置导入”；新增参考项目（AionUi/golutra）借鉴与剥离边界、后台推送列入非目标、明确不新增鉴权体系（复用既有 token）、新增 R-DSK-09/R-SEC-08/RISK-6 |
| v0.3 | 2026-06-08 | 新增 §6.1 远程访问（VPN overlay 方案，R-SEC-09~12、RISK-7）；明确跨网络穿透非 AgentHub 目标、由用户侧 VPN 解决，daemon 仅需支持绑定 VPN 网卡 IP；修正 §2.1 参考项目矩阵——只保留对多端适配有用的借鉴点，剔除与本任务无关项（如各自 i18n 方案），区分“否决技术选型”与“否决整个项目” |
| v0.4 | 2026-06-08 | 二轮评审：核对后修正 §2.1 两处事实——`refrence/` 实为 AgentHub 仓库目录**内**但被 `.gitignore:85-86` 排除（原误写“仓库之外”）；AionUi 借鉴点②去除残留的 prod `loadFile` 表述，与 R-DSK-07 同源加载结论对齐。评审其余各条（R-SEC-11 VPN 必带 token、R-DSK-07 `loadURL`、R-SEC-04 拆分移动/Electron、§1.0 原始需求原文）经核对在 v0.3 已落实，无需重复修改 |
| v0.5 | 2026-06-08 | 范围收窄：**仅支持同一局域网访问，移除全部跨网络/VPN 内容**。删除 §6.1 远程访问整节（含 R-SEC-09~12、RISK-7）；§1.3 改为正向声明“只支持同一局域网”；§7 协作边界去除 VPN 远程客户端；§10 分期移除 VPN IP 绑定相关映射；R-SEC-02 改写为移动端主路径（绑局域网 IP 强制 token，引用更准确的 index.ts:216 守卫，非仅 config.ts:206 的 `0.0.0.0` 守卫） |

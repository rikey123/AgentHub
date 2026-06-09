## Why

AgentHub 的 Web 主端已基本完成，但多端支持（桌面、移动）这一加分项尚未落地。需要在不破坏 Web 主端、不引入云后端、不新增登录体系的前提下，让桌面端补齐本机能力、让移动端在同一局域网内完成轻量控制台操作，三端共用同一个本地 daemon。本变更将 `docs/multi-platform-adaptation-requirements.md`（v0.5 基线）工程化为可实施的 spec。

## What Changes

- **桌面端 `apps/desktop`（Electron）**：新增 Electron 壳（main/preload/renderer 三层，`contextIsolation:true`、`nodeIntegration:false`）；Sidecar 托管本地 daemon 子进程（检测/启动/健康检查/重启/退出策略）；Native Bridge 经 preload 白名单暴露本机能力（目录/文件选择、系统通知、打开路径/外链、daemon 状态/重启、导出日志）；renderer **同源加载** daemon 托管的 Web 静态资源（`loadURL(http://127.0.0.1:<port>/)`，不用 `loadFile`）。preload 白名单形态参照 `refrence/AionUi` 的 `src/preload/main.ts`（`contextBridge.exposeInMainWorld('electronAPI', {...})` 窄接口）；桌面端生成连接配置二维码参照其 `webuiGenerateQRToken` IPC。
- **移动端 `apps/mobile`（轻量 UI + 移动 App）**：新增独立单栏轻量 UI，复用 `packages/sdk`/`packages/protocol`，不复用 Web 页面结构；支持查看（Room/聊天流/任务/Run 摘要）、权限审批（first-wins）、产物只读预览、简单文本回复（带 idempotencyKey）；通过扫码/手填**导入局域网连接配置**（daemon URL + token），扫码解析+导入骨架参照 `refrence/AionUi` 的 `mobile/app/connect.tsx`（`parseQrLoginUrl` 取 host/port/token），但**剥离其 JWT 换取与 `wsService` WebSocket**，改用 daemon 既有 token + SSE/JSON 拉取。
- **多端同步与冲突**：所有端经 durable event + live SSE 重建状态，写操作统一进 daemon；断线按本地 cursor(seq) 补齐；审批 first-wins，任务状态机乐观并发，context 版本化 conflict event；移动端只预览/审批，不处理写冲突。
- **`packages/sdk` 增强**：补全类型（消除大面积 `Promise<unknown>`），提供统一的事件订阅 + 自动重连 + cursor 管理抽象，供三端复用。
- **daemon 薄补强**：新增纯 JSON 的按 seq 拉取端点（`GET /sync/events?sinceSeq=`，不假定移动端有稳定 `EventSource`）；移动端轻量视图/快照；移动端产物预览安全访问（token + SecretRedactor 脱敏）。Sidecar 进程托管思路参照 `refrence/golutra` 的多 CLI 进程编排（shim/pty）。
- **仅同一局域网**：移动端与电脑须连同一 WiFi/路由器；daemon 绑定局域网 IP（`192.168.x.x`）即触发既有非 loopback 守卫，**强制 token + `remote.enabled`**。不做跨网络/VPN/公网穿透。

非目标（红线）：不做云/登录/设备体系/多租户；不引入新鉴权（复用既有 Bearer token，不造 JWT）；不引入 WebSocket Hub；不新增桌面/移动/云专用 daemon；不让任一端有独立状态源；不把 Web 三栏强行响应式化；移动端不走 PWA；不做后台推送（APNs/FCM），仅前台/在线通知。

## Capabilities

### New Capabilities

- `desktop-shell`: Electron 桌面壳 —— main/preload/renderer 分层、Sidecar daemon 生命周期管理、Native Bridge 白名单本机能力、同源加载 daemon-served 资源、（P2）打包与自动更新。
- `mobile-client`: 移动端轻量 UI + App —— 查看/审批/只读预览/简单回复、局域网连接配置导入、按 cursor 断线重连、移动端能力裁剪边界。
- `multi-client-sync`: 多客户端状态同步与冲突解决 —— durable event + cursor 重放、审批 first-wins、任务乐观并发、context 版本化 conflict、各端 cursor 持久化、`packages/sdk` 统一订阅/重连/cursor 抽象。

### Modified Capabilities

- `local-daemon`: 新增纯 JSON 按 seq 拉取端点（`/sync/events?sinceSeq=`）、移动端轻量视图/快照、绑定局域网 IP 支持、移动端连接配置（token）签发分发路径。
- `security`: 明确移动端走局域网时非 loopback bind 强制 token + `remote.enabled`（`index.ts:216` 对任意非 loopback host 生效）；Bearer 鉴权 Origin 前置（Electron 须同源或白名单 origin）；移动端产物预览经 SecretRedactor 脱敏。

## Impact

- **新增 app**：`apps/desktop`（Electron：electron-vite/builder/updater 量级）、`apps/mobile`（轻量 UI + 移动 App 封装，native/hybrid 技术栈待定）。纳入 pnpm workspace + turbo。
- **`packages/sdk`**：从 `Promise<unknown>` 升级为类型化 + 事件流抽象（订阅/重连/cursor）。
- **`packages/daemon`**：新增 `/sync/events` JSON 拉取路由、移动端轻量视图/快照、移动端产物预览安全访问；局域网 bind 已支持（`bind` 配置 + 非 loopback token 守卫，`config.ts:206`/`index.ts:216`），需求层面确认不放松。
- **`packages/protocol`**：移动端轻量视图可能需要新的 view 过滤维度；事件注册表无破坏性变更。
- **`apps/web`**：保持不动（约束性需求）；不为多端做适配性改造。
- **无破坏性变更**：不改 EventBus 契约、SSE envelope schema、`AgentRuntimeAdapter` 接口；不改既有鉴权模型，仅复用。
- **参考项目**（`AgentHub/refrence/`，.gitignore 排除）：AionUi（Electron 分层、扫码导入连接配置、Expo hybrid）、golutra（多 CLI 进程编排、通知 store）；剥离其 WebSocket/JWT/Tauri 选型。

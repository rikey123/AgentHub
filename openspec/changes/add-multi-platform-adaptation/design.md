## Context

AgentHub 是 local-first 多 Agent 工作台，Web 主端（`apps/web`，React 19 + Vite 6 + HeroUI v3）已基本完成。本变更新增桌面端（Electron）与移动端（局域网轻量 App），三端共用现有 `packages/daemon`。需求基线见 `docs/multi-platform-adaptation-requirements.md` v0.5。

已核对的 daemon 现状（决定本设计的事实约束）：
- **事件出口仅 SSE**：`/event?cursor=N&view=main|detail|raw`，已支持按 seq 重放与 `Last-Event-ID`（`index.ts:2474`）。普通 JSON 增量拉取只有 admin 受限的 `/debug/events`。
- **非 loopback 双守卫**：`config.ts:206` 仅对 `0.0.0.0` 触发；`index.ts:216` 对**任意非 loopback host**（含局域网 `192.168.x.x`）强制 `token` + `allowRemote=true`。
- **鉴权 Origin 前置**：`authenticateBrowserRequest` 先校验 Origin/Host 再处理 Bearer（`security/index.ts:237-243`）。无 Origin 的原生请求走 Bearer 免 CSRF；带非法 Origin 即使有 token 也 403。
- **daemon 已托管 Web 静态资源**：`serveWebAsset`（`index.ts:201/2833`），可经 http 同源加载。
- **写路径契约**：所有状态变更须在同一 SQLite 事务内 `EventBus.publish`（见 CLAUDE.md Event Bus Contract），UI 经 `useProjector` 消费。

约束：不改 EventBus 契约/SSE envelope/`AgentRuntimeAdapter` 接口；不新增鉴权体系；仅同一局域网。

参考项目（`AgentHub/refrence/`，`.gitignore` 排除，不随仓库分发）——只借鉴对多端适配有用的工程手法，剥离与红线冲突的技术选型：
- **AionUi**（Electron `electron-vite`/`builder`/`updater` + 移动端 Expo/RN）。已核对的可借鉴实现：
  - `src/preload/main.ts`：`contextBridge.exposeInMainWorld('electronAPI', {...})` 窄接口 → Native Bridge 白名单形态（D-detail，对应 R-DSK-04）。
  - `webuiGenerateQRToken` IPC（同文件）：主端生成连接配置二维码 → 对应桌面端签发 token UX。
  - `mobile/app/connect.tsx`：`parseQrLoginUrl` 解析 `/qr-login?token=` 取 host/port/token → `POST .../qr-login` 换凭据 → `connect(host,port,...)`。借鉴其**解析 + 导入骨架**（D4）。
  - **须剥离**：connect 换到的是 JWT，且其后走 `wsService` WebSocket。我们两样都不要 —— 改用 daemon 既有 token + SSE/JSON 拉取。
- **golutra**（Tauri + 多 AI CLI 编排）。可借鉴：`src-tauri` 的多 CLI 进程编排（shim/pty/terminal_engine）→ Sidecar 托管 daemon 子进程的进程管理思路（D2）；`notificationOrchestratorStore` → 桌面通知联动（R-DSK-06）。**须剥离**：Tauri 桌面选型（已否决，桌面端定 Electron）、其 i18n 方案（与本任务无关）。

## Goals / Non-Goals

**Goals:**
- 桌面端复用 Web UI（同源加载），仅补 Sidecar + Native Bridge，不重做业务。
- 移动端独立轻 UI，覆盖查看/审批/只读预览/简单回复，局域网连接。
- 多端经同一 daemon 同步，断线按 cursor 重建，冲突按既有规则解决。
- `packages/sdk` 成为三端唯一连接/事件层，杜绝各端独立状态源。

**Non-Goals:**
- 跨网络/VPN/公网穿透；后台推送；PWA；云后端；登录/设备体系；新鉴权；WebSocket。
- Web 主端适配性改造；移动端完整代码编辑/Run Detail/Debug/本地 daemon。

## Decisions

### D1: 桌面端同源加载 daemon-served 资源，而非注入配置
Electron renderer 用 `loadURL(http://127.0.0.1:<port>/)` 加载 daemon 托管的 Web 资源（daemon 已具备，`index.ts:201/2833`）。**理由**：renderer 与 daemon 同源 → 请求自带合法 Origin，绕过 Origin 前置校验（D-fact）；且 Web 无需为 Electron 改一行（满足"Web 不动"）。Native Bridge 白名单形态参照 AionUi `src/preload/main.ts` 的 `contextBridge.exposeInMainWorld('electronAPI', {...})` 窄接口。
- **备选**：`loadFile`（`file://`）+ preload 注入 daemon URL/token。**否决**：`file://` 非同源，触发 Origin 校验失败，且要改 Web 去读注入配置。注意 AionUi 用的就是 `loadURL`/`loadFile` 双路径，但其 renderer 是自带的、非 daemon 同源，与我们场景不同；仅在非同源/custom protocol 场景作为退路（须把 origin 加入 `allowedOrigins`）。

### D2: Sidecar 托管 daemon，默认保留不随窗口退出
Electron main 进程检测/启动/健康检查/重启本地 daemon 子进程。退出时**默认保留 daemon**（或提供选项），关闭前检测是否有其他活跃客户端。**理由**：Web/移动端可能正连着同一 daemon，误关会断掉它们（RISK-5）。进程托管（拉起/监活/重启）思路参照 golutra `src-tauri` 的多 CLI 进程编排（shim/pty）。
- **备选**：退出即杀 daemon。**否决**：破坏多客户端共享前提。

### D3: 移动端事件流走新增 JSON 拉取端点，而非 SSE
新增 `GET /sync/events?sinceSeq=N&view=mobile`（纯 JSON 增量）。**理由**：不能假定移动 App runtime（RN/Expo/WebView）有稳定 `EventSource`（RISK-1）；JSON 轮询/拉取在移动端更可控。SSE 作为可选优化保留。
- **备选**：移动端引入 SSE polyfill。**否决**：polyfill 稳定性参差，且 daemon 现有 JSON 出口仅 admin 受限的 `/debug/events`，不可复用。

### D4: 鉴权复用既有 Bearer token，不新增体系
移动端走局域网 → daemon 绑 `192.168.x.x` → 触发 `index.ts:216` 强制 token + `remote.enabled`。token 即"连接口令"，非登录。分发用扫码导入连接配置（daemon URL + token），借鉴 AionUi `connect.tsx` 的扫码交互。**理由**：token 是既有安全边界的延续，不是新增；局域网暴露下不带 token 等于把 workspace 暴露给同网段任意设备。
- **备选**：AionUi 式 WebSocket + JWT 登录。**否决**：触红线（新鉴权体系 + WebSocket Hub）。

### D5: SDK 升级为三端统一连接/事件层
`packages/sdk` 补全类型（消除 `Promise<unknown>`），新增统一事件订阅 + 自动重连 + cursor 管理抽象。**理由**：否则 desktop/mobile 各写一套 EventSource/重连/cursor 逻辑，正是"各端独立状态源"的入口（RISK-4）。前置到桌面端开发之前。

### D6: 冲突解决沿用既有机制，移动端只读写边界收窄
写操作统一进 daemon 走 `CommandBus → SQLite tx → EventBus.publish`。审批 first-wins（首个有效审批写结果，余者返回 resolved）；任务状态机 + 乐观并发（带版本，非法迁移拒绝并回当前态）；context 版本化 + conflict event（由 Web/Desktop 主端处理）。移动端只预览/审批，无 diff apply 入口。**理由**：复用现有 worktree/context conflict 设施，不为移动端新造冲突模型。

## Risks / Trade-offs

- **移动端 runtime EventSource 不稳** → 新增 JSON 拉取端点（D3），SSE 仅作可选优化。
- **Electron Origin 校验挡连接**（RISK-6） → 同源加载（D1）；非同源须加 `allowedOrigins`。
- **Sidecar 误关 daemon 断其他端**（RISK-5） → 默认保留 + 退出前检测活跃客户端（D2）。
- **SDK 不统一导致状态源分裂**（RISK-4） → SDK 升级前置到桌面端之前（D5）。
- **移动端连接配置分发缺 UX**（RISK-3） → 主端生成二维码、手机扫码导入（D4）。
- **局域网暴露安全边界**：daemon 绑局域网 IP 后，同网段设备可达 → 强制 token（D4），且产物预览经 SecretRedactor 脱敏。
- **后台通知不可达**：仅前台/在线通知，后台 push 非目标（产品已接受）。
- **trade-off**：移动端能力刻意裁剪（无代码编辑/Run Detail），换取局域网弱网下的可用性与维护简单。

## Migration Plan

无数据库 schema 破坏性变更。分阶段（与需求文档 §10 对齐）：
1. **SDK 增强 + 桌面端**：`packages/sdk` 类型化与事件流抽象；`apps/desktop` Electron 壳/Sidecar/Native Bridge/同源加载。
2. **daemon 薄补强**：`/sync/events` JSON 端点、移动端轻量视图/快照、移动端产物预览、局域网 bind + token 确认。
3. **移动端**：`apps/mobile` 轻 UI、连接配置导入、审批/预览/简单回复。
4. **体验打磨**：通知联动、Electron 自动更新、移动 App 打包。

回滚：各 app 独立纳入 workspace，可单独不构建/移除；daemon 新增端点为增量，移除不影响既有 Web/SSE 路径。

## Open Questions

- 移动端技术栈（Expo/RN vs 其他 hybrid）在 Phase 3 启动前定，本设计不锁定。
- `/sync/events` 的 `view=mobile` 过滤维度与轻量快照字段集需在 daemon 补强阶段细化。
- Electron 打包/签名/自动更新通道（P2）的具体方案延后。

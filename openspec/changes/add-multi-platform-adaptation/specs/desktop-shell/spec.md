## ADDED Requirements

### Requirement: Electron 应用结构与安全基线

桌面端 SHALL 以新增 `apps/desktop` 提供 Electron 应用，分 main / preload / renderer 三层，并强制安全基线：`contextIsolation: true`、`nodeIntegration: false`、renderer 不可直接访问 Node API。`apps/desktop` MUST 纳入 pnpm workspace + turbo，可独立构建。

**Reference:** `refrence/AionUi` 使用 `electron-vite` + `electron-builder` + `electron-updater`，其 `BrowserWindow` 配置 `contextIsolation:true`、`nodeIntegration:false`（见 `src/process/ambient/ambientWindowManager.ts`）。本能力借鉴其分层与安全基线，不照搬其 renderer（AionUi renderer 为自带、非 daemon 同源）。

#### Scenario: renderer 无法访问 Node 能力

- **WHEN** 在 Electron renderer 中尝试访问 `require` 或 `process`
- **THEN** 二者不可用；任何本机能力只能经 preload 暴露的白名单接口获得

#### Scenario: 桌面应用纳入 monorepo 构建

- **WHEN** 在仓库根目录运行 turbo 构建
- **THEN** `apps/desktop` 被识别并可独立构建，不破坏现有 `apps/web` 构建

### Requirement: renderer 同源加载 daemon 托管资源

桌面端 renderer SHALL 通过 `loadURL(http://127.0.0.1:<port>/)` 加载 daemon 托管的 Web 静态资源（daemon 已具备静态资源服务），使 renderer 与 daemon 同源。生产期 MUST 优先使用 `loadURL` 同源加载，MUST NOT 使用 `loadFile`（`file://` 非 daemon 同源，会触发 Origin 校验失败）。仅当采用非同源 / custom protocol 加载（不推荐）时，才需把该 origin 加入 daemon `allowedOrigins`。

**Reference:** daemon 静态资源服务见 `packages/daemon/src/index.ts` 的 `serveWebAsset`（约 201/2833 行）。AionUi 采用 `loadURL`/`loadFile` 双路径，但其 renderer 为自带资源；本能力因 daemon 已托管 Web 资源，统一走 `loadURL` 同源，避免向不可改的 Web 注入配置。

#### Scenario: 同源加载使请求自带合法 Origin

- **WHEN** 桌面端经 `loadURL(http://127.0.0.1:<port>/)` 加载 Web 并向 daemon 发请求
- **THEN** 请求 Origin 与 daemon 同源，通过 Origin/Host 前置校验，不被 403；Web 无需为 Electron 改动

#### Scenario: 非同源加载需白名单

- **WHEN** 桌面端采用 custom protocol 等非同源方式加载
- **THEN** 必须把该 origin 加入 daemon `allowedOrigins`，否则写请求被 Origin 校验拒绝

### Requirement: Sidecar daemon 生命周期管理

桌面端 main 进程 SHALL 作为 Sidecar 检测、启动、健康检查并在需要时重启本地 daemon 子进程。冷启动时若 daemon 未运行 MUST 自动拉起；daemon 崩溃时 SHALL 可重启。应用退出时 SHALL 默认保留 daemon（或提供用户选项），并在关闭前检测是否仍有其他活跃客户端，避免误关断开 Web/移动端连接。

**Reference:** 多子进程托管（拉起/监活/重启）思路参照 `refrence/golutra` `src-tauri` 的多 CLI 进程编排（shim/pty/terminal_engine）。

#### Scenario: 冷启动自动拉起 daemon

- **WHEN** 桌面应用启动且本地 daemon 未运行
- **THEN** Sidecar 自动启动 daemon 子进程并完成健康检查后再加载 UI

#### Scenario: 退出时保留被其他端使用的 daemon

- **WHEN** 用户关闭桌面应用窗口，且存在其他活跃客户端（Web/移动端）连着同一 daemon
- **THEN** daemon 默认保留运行，不随窗口退出而被杀掉

### Requirement: Native Bridge 白名单本机能力

桌面端 SHALL 仅通过 preload 以最小白名单向 renderer 暴露本机能力，业务命令仍走 daemon HTTP/SSE，不做任意 IPC 透传。白名单 MUST 至少包含：目录选择、文件选择、系统通知、打开路径、打开外链、获取 daemon 状态、重启 daemon、导出日志。新增 native 能力 MUST 走评审并记录在 preload API 清单。

**Reference:** 白名单形态参照 `refrence/AionUi` `src/preload/main.ts` 的 `contextBridge.exposeInMainWorld('electronAPI', {...})` 窄接口；桌面端生成连接配置二维码参照其 `webuiGenerateQRToken` IPC。

#### Scenario: 业务请求不走 IPC

- **WHEN** renderer 需要读取 Room/消息等业务数据
- **THEN** 经 daemon HTTP/SSE 获取，而非通过 preload IPC；preload 仅承载本机能力

#### Scenario: 权限审批触发系统通知

- **WHEN** daemon 产生待审批权限事件
- **THEN** 桌面端经白名单通知能力弹出系统通知，点击聚焦到对应审批卡

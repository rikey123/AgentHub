# 实施任务

> 顺序对齐 design.md 的迁移计划与需求文档 §10：SDK 增强 → 桌面端 → daemon 薄补强 → 移动端 → 体验打磨。

## 1. SDK 增强（前置，R-SY-04 / multi-client-sync）

- [x] 1.1 为 `packages/sdk` 补全类型：用具体类型替换 Room/消息/事件等接口的 `Promise<unknown>`
- [x] 1.2 设计统一事件订阅抽象（封装 SSE `/event?cursor=` 与 JSON `/sync/events?sinceSeq=` 两种通道）
- [x] 1.3 实现自动重连 + 本地 cursor 管理（暴露读取/持久化 cursor 的接口，存储介质由调用端注入）
- [x] 1.4 为 SDK 新增订阅/重连/cursor 抽象补单测（含断线补齐、去重、cursor 续传）
- [x] 1.5 校验：现有 SDK 测试与类型检查通过（`pnpm.cmd test`、`typecheck`）

## 2. 桌面端 Electron 骨架（desktop-shell）

- [x] 2.1 新建 `apps/desktop`，纳入 pnpm workspace + turbo，可独立构建
- [x] 2.2 搭建 main/preload/renderer 三层；BrowserWindow 强制 `contextIsolation:true`、`nodeIntegration:false`
- [x] 2.3 renderer 同源加载：`loadURL(http://127.0.0.1:<port>/)` 加载 daemon 托管 Web 资源；dev 指向 Vite/daemon，prod 走 `loadURL`（不用 `loadFile`）
- [x] 2.4 验证同源加载下请求 Origin 通过 daemon Origin/Host 校验，Web 无需改动

## 3. 桌面端 Sidecar 与 Native Bridge（desktop-shell）

- [x] 3.1 Sidecar：main 进程检测/启动/健康检查 daemon 子进程；冷启动未运行则自动拉起
- [x] 3.2 Sidecar：daemon 崩溃可重启；退出时默认保留 daemon，关闭前检测其他活跃客户端
- [x] 3.3 Native Bridge：preload 经 `contextBridge.exposeInMainWorld` 暴露白名单（目录/文件选择、系统通知、打开路径/外链、daemon 状态/重启、导出日志）
- [x] 3.4 系统通知与权限审批联动：daemon 待审批事件触发系统通知，点击聚焦对应审批卡
- [x] 3.5 记录 preload API 白名单清单文档；校验业务请求走 daemon 而非 IPC

## 4. daemon 薄补强（local-daemon / security）
- [x] 4.0 补正 `GET /debug/stats` 的 `sseClientCount` 为真实活跃 SSE 客户端计数，供桌面退出检测复用，并补测试

- [x] 4.1 新增 `GET /sync/events?sinceSeq=N&view=mobile` 纯 JSON 增量端点（复用 `replayDurableSinceSeq` 语义），受 token 鉴权 + SecretRedactor 脱敏
- [x] 4.2 新增移动端轻量视图/快照（`view=mobile` 过滤或 `GET /sync/snapshot?view=mobile`）
- [x] 4.3 移动端产物只读预览安全访问：token 鉴权 + 脱敏 + 复用 `file://`/`data:` 校验
- [x] 4.4 确认局域网 IP 绑定 + 非 loopback 强制 token/remote 守卫（`config.ts:206`/`index.ts:216`）在局域网场景按预期工作，补测试
- [x] 4.5 token 签发分发：主端生成连接配置（含二维码 payload，host/port/token），支持列出与吊销
- [x] 4.6 为新增端点补单测（鉴权、脱敏、按 seq 拉取、吊销失效）

## 5. 移动端（mobile-client）

- [x] 5.1 新建 `apps/mobile`，独立单栏轻量 UI，复用 `packages/sdk`/`packages/protocol`，不 import `apps/web`；纳入 workspace + turbo
- [x] 5.2 连接配置导入：扫码（参照 AionUi `connect.tsx` 的 `parseQrLoginUrl` 解析骨架）+ 手填，取 host/port/token；剥离 JWT/WebSocket，用既有 token + SDK 通道
- [x] 5.3 查看能力：Room 列表、聊天流、任务状态、Run 摘要
- [x] 5.4 权限审批：展示待审批项、allow/deny，遵循 first-wins
- [x] 5.5 产物只读预览（无 apply/revert 写入口）
- [x] 5.6 简单文本回复，携带 `idempotencyKey` 去重
- [x] 5.7 按本地 cursor 断线重连补齐（经 SDK 抽象），杀进程后状态可重建

## 6. 体验打磨与产物（P1/P2）

- [x] 6.1 移动端弱网容忍打磨（轻量视图首屏、增量拉取重连）
- [x] 6.2 Electron 应用打包与自动更新（P2）
- [x] 6.3 移动 App 安装包产出（Android via Capacitor：原生壳 + CapacitorHttp 绕过 Origin，build 脚本与文档就绪；apk 需在装有 Android 工具链的机器上 `cap add android` + `android:apk` 产出）
- [x] 6.4 各端启动/打包说明文档

## 7. 回归与验收

- [x] 7.1 `apps/web` 零回归：现有构建与测试全绿（R-NFR-01）
- [x] 7.2 根目录 turbo 构建识别并构建新增 `apps/desktop`、`apps/mobile`
- [x] 7.3 端到端验证：多端写入经同一 daemon 同步、断线重建、审批 first-wins、移动端只读预览
- [x] 7.4 安全校验：局域网绑定强制 token、非法 Origin 被拒、移动端预览脱敏

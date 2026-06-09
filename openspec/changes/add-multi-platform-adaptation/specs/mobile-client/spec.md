## ADDED Requirements

### Requirement: 移动端独立轻量 UI 与能力边界

移动端 SHALL 以新增 `apps/mobile` 提供独立的单栏轻量 UI，复用 `packages/sdk` 与 `packages/protocol`，MUST NOT 复用或 import `apps/web` 的页面/组件结构。移动端 MUST NOT 提供：完整代码编辑、完整 Run Detail、Debug 面板、本地 daemon、本地 Agent 进程管理、手机本地文件读写、高风险 shell/terminal 操作。`apps/mobile` MUST 纳入 pnpm workspace + turbo。

**Reference:** `refrence/AionUi` 的 `mobile/` 采用 Expo / React Native（hybrid），印证移动端不必锁定纯 native；本能力借鉴其工程组织，技术栈 native/hybrid 留待实施前决策，不在本 spec 锁定。

#### Scenario: 移动端不含主力端重型能力

- **WHEN** 用户在移动端浏览界面
- **THEN** 无代码编辑、完整 Run Detail、Debug、terminal 等入口

#### Scenario: 移动端独立于 Web 结构

- **WHEN** 构建 `apps/mobile`
- **THEN** 其不依赖 `apps/web` 组件；仅依赖 `packages/sdk`/`packages/protocol`

### Requirement: 移动端查看、审批、预览与回复

移动端 SHALL 支持查看 Room 列表、聊天流、任务状态、Run 摘要；SHALL 支持权限审批（allow/deny，遵循 first-wins）；SHALL 支持产物只读预览，且 MUST NOT 提供产物 apply/revert/写操作入口；SHALL 支持发送简单文本消息，且每条消息 MUST 携带 `idempotencyKey` 以保证弱网重发不产生重复。

#### Scenario: 移动端审批生效并同步

- **WHEN** 用户在移动端对一条待审批项点击 allow
- **THEN** daemon 状态更新为 resolved，并经事件同步给其他在线端

#### Scenario: 产物仅可预览不可写

- **WHEN** 用户在移动端打开一个产物
- **THEN** 可预览 diff/文件内容；界面无 apply/revert 等写操作入口

#### Scenario: 弱网重发不重复

- **WHEN** 移动端在弱网下重发携带同一 `idempotencyKey` 的消息
- **THEN** daemon 去重，不产生重复消息

### Requirement: 移动端局域网连接配置导入

移动端 SHALL 通过扫码或手填**导入连接配置**（daemon 局域网 URL + token），MUST NOT 假定 `127.0.0.1`。连接配置由已认证的 Web/Desktop 端生成（建议二维码）。移动端 MUST 使用 daemon 既有 token 机制鉴权，MUST NOT 引入 JWT/登录体系。仅支持同一局域网连接，MUST NOT 内建跨网络/VPN/公网穿透。

**Reference:** 扫码解析 + 导入骨架参照 `refrence/AionUi` `mobile/app/connect.tsx` 的 `parseQrLoginUrl`（解析 `/qr-login?token=` 取 host/port/token）；**须剥离**其后续的 JWT 换取（`POST /api/auth/qr-login` 返回 jwt）与 `wsService` WebSocket 连接——本能力改用 daemon 既有 token + SSE/JSON 拉取。

#### Scenario: 扫码导入局域网连接配置

- **WHEN** 用户在移动端扫描由 Web/Desktop 端生成的连接配置二维码
- **THEN** 移动端解析出 host/port/token，以 `http://<lan-ip>:<port>` + token 连接同一局域网内的 daemon 成功

#### Scenario: 不带 token 无法接入局域网 daemon

- **WHEN** daemon 绑定局域网 IP 但移动端未提供 token
- **THEN** 请求被拒（401），符合局域网暴露下的安全边界

### Requirement: 移动端按 cursor 断线重连

移动端 SHALL 在本地持久化最后消费的事件 seq（cursor），断线重连后按该 cursor 补齐缺口的 durable events，MUST NOT 丢失或重复消费。移动端 SHALL 通过 `packages/sdk` 统一的事件订阅/重连/cursor 抽象消费事件，MUST NOT 自行实现独立的连接逻辑。

#### Scenario: 杀进程后状态可重建

- **WHEN** 用户杀掉移动端 App 进程后重新进入
- **THEN** 从上次持久化的 cursor 续传，状态被正确重建，不丢消息、不重复

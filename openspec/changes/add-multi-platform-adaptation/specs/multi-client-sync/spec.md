## ADDED Requirements

### Requirement: 单一 daemon 状态源与事件驱动同步

所有客户端（Web、Desktop、Mobile）SHALL 通过 durable event + live SSE 重建状态，所有写操作 MUST 统一进 daemon，遵循 `client → route → CommandBus → service → SQLite 事务 → EventBus.publish` 的写路径契约。任一客户端 MUST NOT 拥有独立状态源，MUST NOT 从渲染层直接发布事件。

#### Scenario: 一端写入，其他端无刷新可见

- **WHEN** 某客户端经 daemon 完成一次写入（含 SQLite 事务内 publish）
- **THEN** 其他在线客户端无需刷新即可看到更新

#### Scenario: 写操作不绕过 daemon

- **WHEN** 任一端需要改变业务状态
- **THEN** 经 daemon 命令路径完成，不在客户端本地维护权威状态

### Requirement: 按 cursor 的断线重连与重放

客户端 SHALL 在本地持久化最后消费的事件 seq：Web 用 localStorage、Desktop 用 Electron store/localStorage、Mobile 用 App 本地存储。SSE/拉取断线重连后 SHALL 按该 cursor 补齐 durable events，MUST NOT 重复或丢失。

#### Scenario: 断网恢复补齐缺口

- **WHEN** 客户端断网后恢复连接，携带本地 cursor
- **THEN** 缺口区间的 durable events 被补齐，且无重复

### Requirement: 统一 SDK 连接与事件层

`packages/sdk` SHALL 补全类型（消除大面积 `Promise<unknown>`），并提供统一的事件订阅 + 自动重连 + cursor 管理抽象，供 Web/Desktop/Mobile 三端复用。各端 MUST NOT 各自实现 EventSource/重连/cursor 逻辑。SDK 增强 SHALL 前置于桌面端与移动端开发之前。

#### Scenario: 三端共用同一连接抽象

- **WHEN** Desktop 或 Mobile 需要订阅事件并处理断线重连
- **THEN** 经 `packages/sdk` 的统一抽象完成，不新写一套连接逻辑

#### Scenario: SDK 类型化

- **WHEN** 调用方使用 SDK 的 Room/消息/事件接口
- **THEN** 返回类型为具体类型而非 `unknown`，编译期可校验

### Requirement: 多端写冲突解决规则

并发写冲突 SHALL 按既有机制解决，不为多端新造冲突模型：
- 消息 append-only，靠 `clientMessageId`/`idempotencyKey` 去重；编辑撤回作为后续事件。
- 审批 first-wins：首个有效审批写结果，其余端再点返回"已处理"，UI 显示 resolved。
- 任务状态用状态机 + 乐观并发：请求带当前版本/状态，服务端校验迁移合法性，冲突返回当前状态。
- Context 用版本化 + conflict event：patch 带 baseVersion，版本不一致生成 conflict，由 Web/Desktop 主端处理；移动端不处理写冲突。
- 文件/产物写冲突主要由 Web/Desktop 处理；移动端只预览与审批；worktree apply 冲突沿用现有 conflict event。

#### Scenario: 两端同时审批仅一个生效

- **WHEN** 两个客户端几乎同时对同一待审批项提交决策
- **THEN** 仅首个有效审批写入结果，另一端得到"已处理"反馈，UI 显示 resolved

#### Scenario: 任务非法状态迁移被拒

- **WHEN** 客户端提交一个带过期版本/非法迁移的任务状态变更
- **THEN** 服务端拒绝该迁移并返回任务当前状态

#### Scenario: context 并发修改产生 conflict

- **WHEN** 两端基于同一 baseVersion 并发修改同一 context
- **THEN** 生成 conflict event，由 Web/Desktop 主端处理；移动端无写冲突处理入口

# add-v05-chatroom-complete

> **状态**：初稿 · 待评审
> **目标周期**：6–8 周（V0.5）
> **基线**：`openspec/specs/`（MVP 已 archive 的 16 capability，180 requirements）
> **路线引用**：`openspec/changes/archive/2026-05-24-add-agenthub-mvp/design.md` "Roadmap Beyond MVP" V0.5 章节

## Why

MVP 内核稳定（Solo / Assisted 流程通、5 道 CI 全绿、180 requirement 落地），但**对真实用户而言还像一台跑得动的发动机，没装好车壳**。具体表现：

- **只有 ClaudeCode 一家真实 adapter**：adapter 抽象的鲁棒性没有第二家验证；万一 OpenCode 接入需要改 manifest / 接口，那是 V1.0 复杂调度上线前的内核风险；
- **Run Detail 7 tab 信息残缺**：tab 结构 E2E 通过，但 PreCompact / SubagentStart-Stop / PostToolUse→artifact.diff 这些产品差异化信号在 ClaudeCodeAdapter 中是 PARTIAL/MISSING；用户点开 Run Detail 看到的不是"这个 Run 真实发生了什么"而是"内核记下了哪些事";
- **聊天室手感不到位**：mailbox 投递失败静默、pending_turn 排队对用户不可见、@ 输入不补全、主流摘要质量差、Observer 敲门链路没真测、PTY 输出有数据但 UI 不渲染；
- **前端体验粗糙**：MVP UI 是工程师自用版本——没主题 / 信息密度未调 / 键盘流不顺 / 动效缺失 / 性能未调（无虚拟化、无 60fps batch、无骨架屏）/ 移动端布局塌；
- **Cost 字段已落库但无面板**：MVP §15.6 已把 cost 写进 runs 表，但用户没法看到自己花了多少；
- **部署 hygiene 缺角**：config.toml 加载、SIGINT 优雅停止、daemon CLI 子命令、vitest timeout flake——这些不是新功能但每一项都是 MVP closeout 时显式记录的真缺口。

V0.5 把这六块一次性闭环，让 MVP 从"开发者跑得动"升级到"开发者愿意每天用"。

## What Changes

> 全部基于 `openspec/specs/` 基线增量；除 `cost-panel-local`（从 v1-roadmap 占位升级为新独立 capability）外，其余都是 MODIFIED。

**第二真实 Adapter（OpenCodeAdapter）**

- `adapter-framework`：把 `OpenCodeAdapter` 从 V0.5 stub 升级为真实实现；派生自 ACPAdapter 基类（`OpenCodeACPAdapter extends ACPAdapter`）；manifest 声明 structured / 全能力 true / immediate injection；走 **ACP 协议路径**（与 ClaudeCodeAdapter 同基类，仅覆盖 spawnArgs/detect/mapProviderEvent/mapProviderError）。
- `adapter-framework`：补 `attachSession` 实现（resumable adapter 必须实现，CI manifest 校验通过）。
- `agents`：`internal Agent` 模板新增 OpenCode-driven 角色（如 builder-opencode），让用户开箱选 ClaudeCode 或 OpenCode。

**Run Detail 真信息（adapter 事件链路补全）**

- `adapter-framework` / `context-ledger`：ClaudeCodeAdapter `PreCompact` hook → `context.snapshot` event → `ContextItem.summary` draft（MVP §8.8 / §12.7 缺）。
- `adapter-framework`：`SubagentStart` / `SubagentStop` hook → `subagent.started` / `subagent.completed` durable events（MVP §12.8 缺）。
- `adapter-framework`：`PostToolUse` → `file.changed` 之外补 `artifact.diff.detected`（ephemeral 前置标记，供 Run Detail FS Changes tab 实时显示；不创建 artifact 行，不触发主流 DiffCard）路径（MVP §12.6 PARTIAL）。
- `adapter-framework`：真 Claude 集成测试覆盖单 Run 含 tool / 触发 ask 后 allow / Diff 成功 apply / cancel 中断（MVP §12.11 缺）。

**聊天室体验**

- `messaging`：ContextAssembly 在 Run 终结时**同步**生成 brief summary 写 `message.brief.published`（MVP §19.6.5 缺）；主流摘要质量调优。
- `messaging`：`mailbox.delivery.failed` durable event（新增），UI 渲染显式失败提示（不再静默）。
- `messaging`：`pending_turn.*` UI 操作面板：用户可看见排队列表 / 取消 / 编辑（MVP §19.6.12 缺）。
- `web-ui`：输入框 `@` 触发 agent 列表自动补全（MVP §14.12 缺）。
- `web-ui`：terminal artifact 的 PTY 输出在 UI 渲染（MVP §11.6 数据有，UI 缺）。
- `orchestrator`：Assisted Mode `@mention` 解析 + 唤醒 + 串行（MVP §9.2 缺）。
- `orchestrator`：群聊纪律执行器（Observer `room.send_message` → mailbox 降级）+ 状态行 30s/Agent/Room 节流（MVP §9.5 / §9.7 缺）。
- `agents`：内置 Agent 模板首启写入（MVP §5.6 缺；MVP 4 个 + V0.5 新增 3 个 = 7 个）+ AgentProfile chokidar 热更新（MVP §5.5 缺，从 stub 升级）。
- `messaging`：消息分页 cursor-based（MVP §5.10 缺）。

**单机 Cost 面板**（新 capability）

- `cost-panel-local`（**NEW**）：`cost_summary` 接口聚合 `runs.cost_*` 字段，按 `agent / model / day` 分组返回；不区分用户（路线红线 D32）；Web UI 在 Side Panel 加一个 "Cost" 视图。
- `v1-roadmap`：把 `cost-panel-local` 占位 Requirement 移除（已实现，不再是占位）。

**前端打磨（UI / UX / 性能）**

- `web-ui`：设计语言收口（亮 / 暗主题切换、密度档位 cozy/compact、间距 / 字号 / 字色 token 化）；MVP UI 在 V0.5 期完成第一轮主题化。
- `web-ui`：键盘流（Cmd/Ctrl+K 命令面板 / Esc 关 slide-over / `j/k` 切消息 / `r` 进 Run Detail / `?` 显示 keymap）。
- `web-ui`：性能 — 消息流虚拟化（TanStack Virtual，10k 流畅，MVP §14.6 缺）+ delta 累积 60fps batch（MVP §14.7 缺）+ 骨架屏 / loading 状态 + image 懒加载。
- `web-ui`：动效收口（消息进入 fade-in、Run Detail slide-over 缓动、PendingTurn 状态变化无闪屏）；尊重 `prefers-reduced-motion`。
- `web-ui`：a11y 基线（focus ring、aria-label、键盘可达、对比度 WCAG AA）。
- `web-ui`：**不做**响应式断点（响应式 / PWA / 离线壳是 V1.4 多端适配，不在 V0.5 范围）；V0.5 只保证 ≥ 1280px 三栏布局正常。
- `web-ui`：错误 / 重连 banner 视觉收口（不再是裸 `Reconnecting...`）+ 离线只读防误触。
- `web-ui`：消息操作集合补齐（quote / regenerate / pin，MVP §5.11 PARTIAL）。

**部署 hygiene**

- `local-daemon`：`config.toml` 加载（CLI flag > env > config.toml > 默认）（MVP §4.2 缺）；`SIGINT` / `SIGTERM` 优雅停止 + 30s in-flight Run 超时（MVP §4.5 缺）。
- `local-daemon`：daemon CLI 补 `start / stop / doctor / auth issue / auth list / auth revoke` 子命令（MVP §4.9 PARTIAL）。
- `observability`：vitest 默认 timeout 调到 10s，解决 MVP closeout 发现的 Windows 冷启动 flake（不是 capability 行为，但作为部署 hygiene 一并记录在 design.md 决策中，由 `tasks.md` 推进）。

**明确不做**（V0.5 红线）

- 不做 Codex adapter（推到 V1.x）/ 不做向量检索 / Memory（V1.2）/ 不做 Squad / Team Mode（V1.0）/ 不做 task-board Kanban（V1.1）/ 不做 Plugin / Skill System（V1.3 / V1.2）/ 不做 War Room（V1.5）；
- 永不做云端 / 多用户 / SaaS / Mobile Native（D32 红线，`v1-roadmap` 持续承载）。

## Capabilities

### New Capabilities

- `cost-panel-local`：单机 Cost 面板。读 `runs.cost_*` 字段聚合，按 agent / model / day 分组；UI Side Panel 视图。**不引入多用户归因**（D32）。

### Modified Capabilities

- `adapter-framework`：OpenCodeAdapter 真实现 + `attachSession` 落地 + ClaudeCodeAdapter 补 PreCompact / SubagentStart-Stop / PostToolUse→diff hooks + 真 Claude 集成测试 Requirement。
- `agents`：内置 Agent 模板首启写入（MVP 4 个 + V0.5 新增 3 个 = 7 个）+ AgentProfile chokidar 热更新 + builder-opencode 模板新增。
- `context-ledger`：长会话压缩入口接 PreCompact snapshot 真实写入（MVP 已有 Requirement，更新 acceptance 含 ClaudeCodeAdapter 路径）。
- `messaging`：brief summary 同步生成 + mailbox.delivery.failed event + pending_turn UI 操作 + 消息分页 cursor-based。
- `orchestrator`：Assisted Mode @mention 解析 + 群聊纪律执行器 + 状态行节流。
- `web-ui`：@ 输入补全 + PTY artifact 渲染 + Cost 面板视图 + pending_turn 操作面板 + mailbox 失败提示 + **主题 / 密度 / 键盘流 / 虚拟化 / delta 60fps batch / 骨架屏 / 动效收口 / a11y 基线 / 消息操作补齐**（前端打磨第一轮；**不含响应式**，响应式是 V1.4）。
- `local-daemon`：config.toml 加载 + SIGINT 优雅停止 + CLI 子命令补全。
- `v1-roadmap`：移除 `cost-panel-local` 占位（已升级为真 capability）；保留其余 V1.x 占位。

- `event-system`：新增 4 个 V0.5 事件类型（`agent.profile.removed` / `agent.profile.error` / `mailbox.delivery.failed` / `artifact.diff.detected`）到 canonical registry；同步 `packages/protocol/src/events/registry.ts`。
- `bus-runtime`：扩展 `RunLifecycleService.complete/fail/cancelFinalized` terminal 事务契约，同事务包含 `message.brief.published` durable event 发布。
- `security`：新增文件附件上传安全 Requirement（CSRF / MIME 白名单 / 大小限制 / 路径安全 / SVG 净化 / 清理策略）。

## Impact

- **新增包**：无（cost-panel-local 与 OpenCodeAdapter 都在已有目录下扩展）。
- **修改代码区**：`packages/adapters/{opencode,claude-code,acp-base}/`、`packages/agents/`、`packages/orchestrator/`、`packages/context/`、`packages/messages/`、`packages/daemon/`、`apps/web/`、`apps/cli/`、`scripts/`（CI 防线如有需要扩展）。
- **新增依赖**：可能引入 OpenCode 官方 npm package（如 `@opencode-ai/sdk` 或 `opencode-acp`，待 design.md 决策 [DECISION-NEEDED-V05-1]）；config.toml 需 toml 解析器（`@iarna/toml` 或 `smol-toml`，[DECISION-NEEDED-V05-2]）。
- **Migration**：`0012_v05.sql` 包含：`messages.brief_published_at INTEGER`；`mailbox_messages.delivery_failure_reason TEXT` + `attempt_count INTEGER DEFAULT 0`；`agent_profiles` 新增 5 列（description / avatar / version / provider / default_presence）；消息分页索引 `idx_messages_room_created_desc`；cost 查询索引 `idx_runs_workspace_ended`（使用现有 `ended_at` 列，不新增 `completed_at`）。
- **API 变更**：新增 `GET /workspaces/:id/cost-summary?groupBy=...`、`DELETE /pending-turns/:id` 已存在（V0.5 加 PATCH）、`GET /agents/profiles` 含 builder-opencode 模板。
- **CI**：`subscriptions:check` 因新增 brief / mailbox.delivery.failed event 自动校验通过；`events:check` 校验 registry 新增类型；其余 5 道 CI 不变。
- **路线红线（D32 不变）**：单机本地，不引入云端、多用户、SaaS、Postgres、Mobile Native、Marketplace。

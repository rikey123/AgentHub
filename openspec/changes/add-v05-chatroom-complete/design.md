# Design: add-v05-chatroom-complete

> 配套 `proposal.md` 阅读。本文聚焦"如何实现"——架构决策、技术选型、关键权衡、留白处的推荐方案。**不**重复 proposal 的需求叙述。基线引用 `openspec/specs/`（MVP archive）。

## Context

### MVP 已经做到的事

V0 archive 落地了 16 个 capability、180 个 requirement，关键内核已经稳定：

- bus-runtime（CommandBus + Outbox + DurableHandler + RunQueue + 5 道 CI）
- RunLifecycleService（runs 表唯一写入口，11 方法 + tx 首参 + 状态机校验）
- WakeAgent 是模型调用唯一入口，StartRun 不存在
- Mailbox 原子认领 + run_next_turns + carry rebind + deliveryBatchId 幂等
- Permission per-session 队列 + 幂等键 + Prompt Timeout Pause
- ArtifactFS Shadow Write + Run-Level Diff
- ACPAdapter 统一基类 + ClaudeCodeAdapter 实现 + adapter liveness ping
- 主流摘要 / Run Detail 双投影 + visibility 收归 event-system
- security 闭环（CSRF / Origin / SecretRedactor / 0.0.0.0 校验 / KeychainBridge with AES fallback / wrapExternalContent 接入 / audit log）
- 32 测试文件 / 199 通过 + 1 skip / 5 E2E / 5 道 CI 全绿

### V0.5 的范围信号

最近一次 drift audit（2026-05-24）把 322 项任务对齐到代码：199 DONE / 46 PARTIAL / 64 MISSING / 13 UNCLEAR。其中：

- **真实漏洞 8 项**已在 archive 前补完（4 安全 + 2 V0.5 前置 + 10 不变量测试）
- **V0.5 范畴 ≈ 30 项**正是本 change 要消化的：第二 adapter / Run Detail 信息完整 / 聊天室手感 / 前端打磨 / Cost UI / 部署 hygiene
- **V1.0+ 范畴**保持 `v1-roadmap` 占位不动

### 干系人

- **首要**：MVP 上线后试用的开发者（自己 + 早期试用者），希望"装两个 adapter 看协作"、"看 cost"、"@ 补全"、"输出可见"
- **次要**：后续 V1.0 复杂调度的实现者——V0.5 adapter 抽象的鲁棒性是他们的前置依赖

### 三条不可破的红线（沿用 D32）

1. **本地优先**：V0.5 不引入任何云服务、不强制登录；卸载等于删除 `.agenthub` 目录。
2. **诚实大于一致**：OpenCodeAdapter 必须如实声明能力差异（manifest reliability / injectionMode / canEmit*）；不为对齐 ClaudeCode 而虚报能力。
3. **单机不上云**：Cost 面板只看本机数据；不做多用户归因。

## Goals / Non-Goals

**Goals**

- **G1**：6–8 周交付 V0.5，MVP 用户可以 ① 选 OpenCode 或 ClaudeCode adapter 跑 Solo Run；② 在 Run Detail 看到完整 7 tab 真实信息（含 PreCompact summary / SubagentStart / artifact.diff）；③ 在 Side Panel 看 Cost 面板；④ 输入 `@` 补全；⑤ 看见 PTY 输出；⑥ 看见 pending_turn 排队 + 取消 + 编辑；⑦ 清晰看见 mailbox 失败提示。
- **G2**：通过引入第二真实 adapter（OpenCode）**不修改** `AgentRuntimeAdapter` / `AdapterManifest` / `ACPAdapter` 基类接口，验证 MVP 抽象的鲁棒性。
- **G3**：所有 V0.5 增量基于 `openspec/specs/` MODIFIED，不破已有 capability 的契约；v1-roadmap 仅做占位移除。
- **G4**：部署 hygiene 落地（config.toml / SIGINT / CLI 子命令 / vitest timeout），让 V1.0 复杂调度起步前的工程基础不再绊脚。
- **G5**：前端打磨第一轮收口——主题（亮 / 暗）+ 密度档位 + 键盘流 + 虚拟化 + 60fps + 骨架屏 + a11y AA + 动效——让 UI 从"工程师自用"升级到"愿意每天看"。**不含响应式**（响应式 / PWA / 离线壳是 V1.4 多端适配）。

**Non-Goals**

- **NG1**：不做 Codex adapter（V1.x）。原因：MVP D8 已明确 OpenCode（ACP 结构化协议）才是第二位，Codex 半结构化事件会拉低抽象。
- **NG2**：不做向量检索 / Memory（V1.2）。原因：BM25 + sqlite-vec + Memory hybrid 是 V1.2 一波做掉的栈，提前做意味着 Context Assembly 改两次。
- **NG3**：不做 Squad / Team Mode（V1.0）。
- **NG4**：不做 task-board Kanban / 协作可视化（V1.1）。
- **NG5**：不做 Plugin / Skill System（V1.3 / V1.2）。
- **NG6**：不做 War Room（V1.5）。
- **NG7**：不动 `bus-runtime` / `event-system` / `permissions` / `interventions` / `artifacts` / `security` / `observability` 的核心契约（仅在必要时新增 event 类型）。
- **NG8**：永不做云端 / 多用户 / Postgres / Redis / Mobile Native / Marketplace（D32 红线）。
- **NG9**：不做响应式 Web / PWA / 离线壳 / Tauri 桌面壳（V1.4）；不做 Storybook 工程化（V1.x 视需要）；不做完整设计系统提取（V0.5 只做 token 化的第一步）。

## Decisions

### V05-D1：OpenCodeAdapter 走 ACP 协议派生，不再走 server/SDK 双路

**决定**：`packages/adapters/opencode` 实现 `OpenCodeACPAdapter extends ACPAdapter`，仅覆盖 `spawnArgs() / detect() / mapProviderEvent() / mapProviderError()`；状态机、pending 表、line-splitter、cancel/dispose 全部继承基类。

**理由**：

- MVP `adapter-framework/ACPAdapter 会话状态机与 JSON-RPC pending 表` 已经把"如何接 NDJSON RPC adapter"做成基类；ClaudeCodeAdapter 验证过这条路径；
- 走 ACP 协议派生 ≈ 复用所有 MVP 已实现的 supervision / liveness / dispose / wrapExternalContent 通路；
- 走 HTTP/WS SDK 路径意味着重写 supervision + liveness + cancel——MVP 没有第二条 adapter runtime，这条新路径风险大；
- V05-1 resolved: package=none; spawn command is `opencode acp` (stdio JSON-RPC); docs URL: https://opencode.ai/docs/acp/; install via `npm i -g opencode-ai@latest`; do not scrape stdout.

**备选**：

- 走 OpenCode SDK Direct（HTTP/WS）：与 ClaudeCodeAdapter 异构，违反 MVP D25 "ACP 一等运行时" 的内核统一性；否决。
- 自己 scrape OpenCode CLI stdout：MVP D8 已显式拒绝；否决。

### V05-D2：PreCompact / SubagentStart-Stop / PostToolUse→diff 在 ClaudeCodeAdapter 一次补齐

**决定**：把 MVP 漏的三个 hook 路径（§12.6 / §12.7 / §12.8）作为一个事务在 ClaudeCodeAdapter 补齐，而非拆三个 PR：

- `PreCompact` → `mapToBridgeEvent` 输出 `context.snapshot { snapshot: { kind: "claude_compact", text } }` → ContextLedger `propose(summary, draft)`；
- `SubagentStart` → `subagent.started`；`SubagentStop` → `subagent.completed`（visibility=detail）；
- `PostToolUse` 在 file write 路径上除现有 `file.changed` 外，对每个写入产物补 `artifact.diff.detected`（ephemeral, visibility=detail，**不**创建 artifact 行，不触发主流 DiffCard；Run 终结时 buildRunArtifact 仍是 DiffArtifact 的唯一权威来源，发 `artifact.diff.created`）。

**理由**：三个 hook 共享同一个 mapping 文件，分批做会反复改同一处；一次补齐 + 加真 Claude 集成测试（§12.11）一并验证。

**备选**：拆 3 个 PR — 增加协调成本，否决。

### V05-D3：brief summary 同步生成，启发式取首句 + Artifact 统计（V1.2 必换 LLM）

**决定**：MVP `messaging/主流摘要 / Agent Run Detail 双投影` 已要求在 Run 终结时发 `message.brief.published`，但 brief 内容在 MVP 是 stub（"Run completed"）。V0.5 把生成逻辑落实到 ContextAssembly：

```
brief = "<final assistant 第一句>"  +
        "（artifacts: <diff_count> diff / <file_count> files / <tool_count> tools）" if any
```

- 第一句切分用空白行 + 句号/问号/感叹号（中英文），最长 120 字符截断 + `…`；
- Artifact 统计读 Run 期间 `artifact.diff.created` / `artifact.file.created` / `tool.call.completed` 计数；
- 失败 Run 用 `failureClass` + `reason`（人类可读模板）作为 brief，而非"Run completed"；
- `BriefGenerator.generate()` 由调用方在事务外同步执行（纯计算，不访问 DB）；`RunLifecycleService` 只在 terminal 事务内写入 `message.brief.published` 与 `messages.brief_published_at`，避免 brief 漏发。

**理由**：

- 同步生成保证 brief 与 Run 终态一致，无 race；
- 启发式简单 + 可测；任何"用 LLM 二次总结"的方案在 V0.5 拒绝（成本不可控、单元测试不稳）；
- 启发式不是终点 — V1.2 Memory + 向量上线后**必须换成 LLM 二次总结**（Memory pipeline 自然有 LLM 通路 + cost 已可治理）；**V0.5 已抽出 `BriefGenerator` 接口并使用 `HeuristicBriefGenerator`**（详见 `context-ledger/BriefGenerator 接口`）；V1.2 仅替换实现为 `LlmBriefGenerator`，保留启发式 fallback，调用点 RunLifecycleService 不需要改。

**承诺**：本 change 实现的 `BriefGenerator` 必须以接口形式留出 `generate(run, ctx): Effect.Effect<string, never>`，启发式是默认实现；V1.2 替换实现时不需要改 RunLifecycleService 调用点。

**备选**：异步 LLM 总结 — V0.5 拒绝；V1.2 必做。

### V05-D4：mailbox 失败可见性走新增 durable event，不改 mailbox state

**决定**：新增 `mailbox.delivery.failed` durable event（visibility=both），UI 在主流插入一条 system-level 提示卡。`mailbox_messages.delivery_failure_reason` 作为冗余字段（`NULL` / `"claim_conflict"` / `"max_retries"` / `"target_unavailable"`）便于 Debug Panel 重放。

**触发场景**：

- `room.read_mailbox` 双源原子消费时 `MailboxDeliveryConflict`（UPDATE 影响行 ≠ SELECT 行）；
- WakeAgent 失败回滚 mailbox claim 后该 mailbox 仍未被新 Run 拉到，且原 sender 已不在房间（target_unavailable）；
- 同 mailbox 重试 ≥ 5 次未被消费（max_retries，由 RunQueue Worker 计数）。

**理由**：

- MVP `orchestrator/Mailbox 是 durable inbox` 已有 happy path；失败路径之前是静默丢弃；
- 用 event 而非 message-level state 改动避免改 mailbox 状态机契约；
- 失败可见性是产品差异化的一部分（"Agent 没收到"用户必须能看见）。

**备选**：把 `delivery_failure_reason` 写在 `mailbox_messages.read=2` 这种衍生状态 — 改契约，否决。

### V05-D5：pending_turn UI 操作 = 现有 API + 新前端

**决定**：MVP 已有 `DELETE /pending-turns/:id`（§19.6.8）和 `pending_turn.created/cancelled/scheduled/consumed` 全套 durable events。V0.5 不新增后端契约，**只**：

- 在 Web UI 输入框上方加 PendingTurnList 组件（订阅 `pending_turn.*`）；
- 加 `PATCH /messages/:id`（编辑 PendingTurn 关联的 user message 内容，等价 cancel 旧 + 入新，不保留 enqueuedAt；路由与 MVP 现有 PATCH /messages/:id 一致，不新增 PATCH /pending-turns/:id）；
- 用 sessionStorage 存草稿（用户取消后能恢复）。

**理由**：MVP 后端已经把 pending_turn 做完了，V0.5 主要是 UI 工程。PATCH 语义简单（cancel + new），无需新事务模式。

### V05-D6：@mention 补全是纯前端，匹配规则全前端

**决定**：`@` 触发输入框弹 `RoomMembersPopover`，从 `RoomViewModel.members` 列表（已订阅 `room.member.*`）取候选。匹配规则：

- 显示名 / agentId / 角色（primary / observer）三字段子串匹配；
- 选中后插入 `@<displayName>` + 隐含 `agentId`（消息发送时序列化为 part.payload.mentions: [agentId]）；
- 多 @ 用空格分隔，按选中顺序写入 mentions 数组；
- Orchestrator 解析 `mentions[]` 触发 WakeAgent（这就是 §9.2 Assisted @mention 解析的后端入口）。

**理由**：MVP 已有 `Message.parts[].mentions` 字段（domain types）但未启用；V0.5 把前端补全 + 后端唤醒一次接通。

### V05-D7：群聊纪律执行器在 Room MCP `room.send_message` 实现

**决定**：MVP `orchestrator/群聊纪律执行器` 是 spec-only。V0.5 在 `RoomMcpServer.handleSendMessage` 实现：

- agent 调 `room.send_message` 时，查 `room_participants.role`；
- `role='observer'` 且 `presence != 'active'` 时拒绝直发，自动转 `mailbox.message.created` + 返回 `{ degraded: true, reason: "observer_must_knock_or_mailbox" }`；
- agent 仍可通过 `room.request_intervention` 走敲门；
- `state-line` 类消息（`room.update_status_line`）走 30s/Agent/Room 节流（§9.7）。

**理由**：纪律执行器是产品差异化核心（observer 不能自由发言），spec 已定，V0.5 落代码。

### V05-D8：内置 Agent 模板首启写入（MVP 4 个 + V0.5 新增 3 个 = 7 个）

**决定**：daemon 启动时若 `~/.agenthub/agents/` 不存在或为空，写入 4 个内置模板：

- `builder-claude.md`（primary，用 ClaudeCodeAdapter）
- `builder-opencode.md`（primary，用 OpenCodeAdapter）— **V0.5 新增**
- `reviewer.md`（observer，敲门审阅）
- `archivist.md`（observer，写 confirmed context summary）

每次首启检查 `<template>.version` 字段对比；用户改过的模板（version 不一致）不覆盖只 stderr 警告。

**理由**：MVP §5.6 缺；用户首次打开 daemon 没 agent 可选，体验断层。

### V05-D9：cost-panel-local 是新独立 capability，不挤进 observability

**决定**：cost 字段读取 + 聚合查询是新 capability `cost-panel-local`：

- 接口 `GET /workspaces/:id/cost-summary?groupBy=agent|model|day&from=...&to=...`；
- 内部 SQL 直读 `runs` 表 GROUP BY；不引入物化视图（数据量在单机 < 10 万 Run 内 GROUP BY 即时）；
- UI Side Panel 加 "Cost" tab（`apps/web/src/components/CostPanel.tsx`）；
- v1-roadmap 占位移除。

**为什么不放在 observability 下**：observability 当前覆盖审计 + Debug Panel + 日志，与 cost 聚合是不同心智模型；分开有利后续 V1.5 cost-aggregation 扩到预算告警时清晰演进。

### V05-D10：config.toml 用 `smol-toml`

**决定**：[DECISION-NEEDED-V05-2] 选 `smol-toml`（更轻、零依赖）而非 `@iarna/toml`。

**理由**：smol-toml 体积 4 KB / `@iarna/toml` ~50 KB；MVP 已经选了 better-sqlite3 / pino 这种轻量路线，保持一致。

**备选**：`@iarna/toml`（更成熟） — 留作 fallback，初版用 smol-toml。

### V05-D11：SIGINT 优雅停止流程

**决定**：

1. 收到 SIGINT/SIGTERM 后立刻把 `daemonState.shutdownRequested = true`；
2. HTTP server 拒绝新连接（返回 503 `service_stopping`）；
3. 在 30 秒内等 in-flight Run 自然完成或自然 cancel；
4. 仍未完成的 Run 调 `RunLifecycleService.markCancelling(null, runId)` + `cancelFinalized` 同事务发 `agent.run.cancelled` reason="daemon_shutdown"；
5. shutdown phase 倒序运行（HTTP→AdapterManager→Handler Registry→Outbox Dispatcher→CommandBus→EventBus→DB）；
6. 30 秒超时后 `process.exit(1)`。

**理由**：MVP §3.18 已实现 9 阶段启动 + 反向 shutdown，V0.5 加 in-flight Run 30s 等待 + 强制 cancel 路径。

### V05-D12：vitest timeout 调到 10s

**决定**：`vitest.config.ts` 加 `testTimeout: 10_000`。

**理由**：MVP closeout drift audit 发现 Windows 冷启动 + node_modules 文件系统竞争导致首次跑出现 6 个 timeout flake；后续重跑全绿。提高 timeout 是治标快路径，根因（node_modules 大 / esm 解析慢）在 V0.5 不计划解决。

### V05-D13：daemon CLI 子命令

**决定**：

- `agenthub start`：等价直接调 `node packages/daemon/dist/index.js`；
- `agenthub stop`：发 SIGTERM 给 PID 文件中的 daemon；
- `agenthub status`：HTTP `/healthz` 探测 + 显示 daemon ready / shutdown / starting；
- `agenthub doctor`：检查 SQLite 文件锁 / 端口占用 / KeychainBridge 是否可用 / migrations up-to-date；
- `agenthub auth issue --description=... --scope=read,write` / `auth list` / `auth revoke <id>`：调 `/auth/tokens` API。

**理由**：MVP §4.9 PARTIAL；V0.5 用户首次跑 daemon 没有 stop / doctor 这种基础工具体验断层。

### V05-D14：前端打磨第一轮 = 主题 + 密度 + 设计 token 化（不引入完整设计系统）

**决定**：

- **主题**：亮 / 暗双主题，CSS variables 实现，根 `data-theme="light|dark|auto"` 切换；`auto` 跟系统 `prefers-color-scheme`；用户偏好存 localStorage。
- **密度**：`cozy`（默认，间距大）/ `compact`（间距紧凑），CSS variables 切换间距 token；不影响信息架构。
- **设计 token 化**：所有 spacing / radius / font-size / line-height / color 改用 CSS variables（不引入 Tailwind / shadcn / styled-components），保留现有 vanilla CSS 路径；每个 token 起 `--ah-*` 前缀避免冲突。
- **不做**：完整设计系统（colors palette + 9 级 grayscale + semantic token 双层），那是 V1.4 前端美化轮次 2 的事；V0.5 只把现在硬编码的间距 / 字色统一抽成 token，至少能切主题。

**理由**：MVP UI 是工程师自用版本，文本色 / 背景色 / 间距全部 hard-coded；V0.5 第一轮先做"能切主题 + 能切密度"这条最低线；不引入设计系统库避免 V0.5 期突然要重绘所有组件。

**备选**：

- 直接接入 shadcn/ui — 工作量大、组件全重写、与 MVP 既有 Card 组件冲突；推到 V1.4。
- 不做主题 / 密度 — 用户体验断层最大的一项，否决。

### V05-D15：键盘流第一轮收口（命令面板 + j/k 切消息 + 全局 Esc）

**决定**：

- **命令面板**（`Cmd/Ctrl+K`）：搜索 Room / 切 agent / 跳 Run / 切主题 / 切密度；与 `RoomList` 共用数据；类似 Linear/Raycast 风格。
- **消息流键盘**：`j/k` 上下切，`Enter` 进 Run Detail（如有 brief），`r` 直接打开活跃 Run 的 Detail，`Esc` 退出 Run Detail slide-over。
- **输入框**：`Tab` 在 @ 候选列表切换，`Enter` 选中，`Shift+Enter` 换行，`Cmd+Enter` 发送。
- **全局**：`?` 显示 keymap cheat sheet。

**实现选择**：用 `react-hotkeys-hook`（已有依赖）；不引入 cmdk 库，命令面板用纯 React + virtualized list（与消息流虚拟化共用 TanStack Virtual）。

**理由**：键盘流是开发者工具的体感放大器；MVP 只能鼠标，V0.5 上线后能用键盘玩转所有功能。

### V05-D16：性能 = 虚拟化 + delta 60fps batch + 骨架屏，不上 server-rendering

**决定**：

- **虚拟化**：消息流用 TanStack Virtual（MVP §14.6 缺）；命令面板候选列表 ≥ 20 时也虚拟化（V05-D15 共用）。
- **delta 60fps batch**：`useProjector` 在 1 帧内 coalesce 多个 delta 事件，单次 setState；MVP §14.7 缺。
- **骨架屏**：Room 切换 / Run Detail 加载 / Cost 面板加载时显示骨架屏（pulse 动画），避免空白闪。
- **图片懒加载**：消息附件 image 用 `loading="lazy"` + IntersectionObserver 触发 thumbnail 解码。
- **不做**：server-rendering / RSC / streaming SSR — Vite + React + 本地 daemon 的场景永远不需要这些（D32 红线）。

**理由**：MVP 在 ≥ 1k 消息的房间已经感到卡顿；V0.5 必须解决，否则 V1.0 多 agent 场景下消息流暴涨直接退化。

### V05-D17：a11y AA 基线（不上 AAA）

**决定**：

- **键盘可达**：所有可点击元素必须 `tabIndex` 合理 + 有 focus 视觉反馈（`outline` 或 `box-shadow`，主题切换时要适配）。
- **aria-label**：所有 icon-only button / 状态徽章 / 输入框 placeholder 加 `aria-label`。
- **对比度**：文本与背景对比度 ≥ 4.5:1（WCAG AA）；亮 / 暗主题各做一次自动检查（用 axe-core CI）。
- **prefers-reduced-motion**：Run Detail slide-over / 动效在 `prefers-reduced-motion: reduce` 时退化为瞬时切换。
- **不做**：完整 WCAG AAA / 屏幕阅读器手动测试（需要专业 a11y 工具与人工时间，V1.4 前端美化时再上）；不做 i18n（MVP 已确定英文，V1.4 评估中文）。

**理由**：MVP 完全没考虑 a11y；V0.5 把"AA 不阻塞"作为最低线，避免后续要回头改一遍。axe-core 跑 CI 自动捕回归。

## Risks / Trade-offs

- **R1（OpenCode 上游 bridge 不稳）** → 选定 npm package 后做 e2e smoke test，发现 bridge bug 提 issue + fork patch；fallback 是临时 stub adapter，发 V0.5.1 修。
- **R2（PreCompact summary draft 写多了脏 ContextLedger）** → MVP `context-ledger/Agent 直接写 confirmed 被拒` 已确保 draft 不会自动转 confirmed；用户可在 Side Panel 批量 deprecated。每次 PreCompact 触发时 `idempotencyKey = "claude_compact:<runId>"` 防重复写。
- **R3（brief summary 启发式截断截到一半）** → 测试覆盖中文 / 英文 / 代码块开头 / 多行场景；最长 120 字符 + `…` 末尾；UI 在 brief 旁加 "查看完整 Run" 按钮兜底。
- **R4（mailbox.delivery.failed event 暴涨）** → 同 mailbox + 同 reason 在 5 分钟内 dedupe（按 `(mailboxId, reason)` LRU 256），与 §19.9 raw output dedupe 同模式。
- **R5（@mention 补全在大量 agent 时卡）** → 候选列表前端虚拟化（TanStack Virtual，与消息流虚拟化共用，V05-D16）；候选 ≤ 20 时直接 render，否则虚拟化。
- **R6（config.toml 与 CLI flag / env 冲突）** → 优先级 CLI > env > config.toml > 默认；启动时打印 effective config（除 secret 字段）便于排错。
- **R7（OpenCodeAdapter 真启动需要 OpenCode CLI 已装）** → detect 返回 [] 时 daemon 启动正常 + 用户在 builder-opencode profile 想用时给 friendly error "请先安装 OpenCode CLI（参考链接）"；不阻断 daemon。
- **R8（Cost 面板 SQL GROUP BY 在大量 Run 下慢）** → MVP 单机 < 10 万 Run；加 `idx_runs_workspace_ended (workspace_id, ended_at DESC)` 索引；预算告警 V1.5 才做。
- **R9（vitest timeout 调高掩盖真 perf 回归）** → 在 CI 加 perf baseline（M3 / M4 各跑一次大测试集，记 p95 时间），timeout 调高仅作 flake 缓解。
- **R10（SIGINT 30s 等待让运维觉得 hang）** → CLI `agenthub stop --force` 发 SIGKILL + warn "可能丢失 in-flight Run 状态"。
- **R11（前端打磨范围蔓延，6–8 周做不完）** → V0.5 前端打磨**只**做"主题 + 密度 + token 化 + 键盘流第一轮 + 虚拟化 + 60fps batch + 骨架屏 + a11y AA + 动效收口"这 9 项最低线（**移除响应式**，响应式是 V1.4）；完整设计系统 / 完整 i18n / Storybook 工程化 / PWA / 响应式推到 V1.4 前端美化轮次 2。tasks.md 每条强制引用 web-ui spec 的具体 Requirement，未引用的不开工。
- **R12（启发式 brief summary 在多语言 / 代码块 / 长 emoji 序列下切错）** → 测试覆盖中英文 / 代码块开头 / emoji / URL 场景；切失败时退化为前 120 字符纯截断 + `…`；V1.2 换 LLM 后此风险消失。

## Migration Plan

V0.5 是空仓库基础上的增量，没有破坏性 schema 变更。所有变更集中在 `0012_v05.sql`：

```sql
-- 0012_v05.sql

-- 1. messages 表：brief 发布时间戳
ALTER TABLE messages ADD COLUMN brief_published_at INTEGER;

-- 2. mailbox_messages 表：投递失败原因 + 重试计数
ALTER TABLE mailbox_messages ADD COLUMN delivery_failure_reason TEXT;
ALTER TABLE mailbox_messages ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

-- 3. agent_profiles 表：V0.5 新增字段（不改现有列名）
ALTER TABLE agent_profiles ADD COLUMN description TEXT;
ALTER TABLE agent_profiles ADD COLUMN avatar TEXT;
ALTER TABLE agent_profiles ADD COLUMN version TEXT;
ALTER TABLE agent_profiles ADD COLUMN provider TEXT;
ALTER TABLE agent_profiles ADD COLUMN default_presence TEXT;

-- 4. 消息分页索引（改名避免与现有 idx_messages_room_created 冲突）
CREATE INDEX IF NOT EXISTS idx_messages_room_created_desc
  ON messages (room_id, created_at DESC, id DESC);

-- 5. cost-panel-local 查询索引（使用现有 ended_at 列，不新增 completed_at）
CREATE INDEX IF NOT EXISTS idx_runs_workspace_ended
  ON runs (workspace_id, ended_at DESC);
```

**注意**：

- 不新增 `completed_at` 列（runs 表已有 `ended_at`，cost 查询改用 `ended_at`）；
- 消息分页索引命名为 `idx_messages_room_created_desc`（不复用现有 `idx_messages_room_created`）；
- `mailbox_messages.attempt_count` 默认 0，不需要 backfill；
- `agent_profiles` 新增列全部 NULL，不需要 backfill（现有行 provider/default_presence 从 markdown 重新解析时写入）。

回滚：删除 `~/.agenthub/agents/builder-opencode.md` 等 V0.5 新增模板 + 用户手动改 daemon 配置回退；不需要 DB 回滚（新增列 NULL 不影响 V0 代码读取）。

## Open Questions

> **用户裁决（2026-05-24）**：本表所有"推荐"列已采纳为 V0.5 默认实现。V05-1 / V05-5 在开工前**调研后即可定**，不阻塞 spec / tasks 起步。其余 6 项在实现期出现真问题再回头调整。

| ID | 主题 | 推荐（已采纳） | 备选 | 状态 |
|---|---|---|---|---|
| V05-1 | OpenCode ACP bridge npm package | package=none; spawn `opencode acp`; install `npm i -g opencode-ai@latest`; docs https://opencode.ai/docs/acp/ | scrape stdout (rejected by D8) | resolved |
| V05-2 | toml 解析器 | `smol-toml`（轻量） | `@iarna/toml`（成熟） | 采纳 smol-toml |
| V05-3 | brief summary 截断长度 | 120 字符 | 80 / 200 字符 | 采纳 120；V1.2 LLM 升级时随策略调 |
| V05-4 | mailbox.delivery.failed dedupe 窗口 | 5 分钟 LRU 256 | 1 分钟 / 不 dedupe | 采纳 5 分钟 |
| V05-5 | builder-opencode default model | `opencode/big-pickle` | OpenCode CLI default | resolved |
| V05-6 | Cost 面板默认时间窗口 | 最近 7 天 | 24 小时 / 30 天（用户在 UI 切换） | 采纳 7 天 |
| V05-7 | `agenthub stop` 默认 timeout | 30s | 60s / 用户配置 | 采纳 30s |
| V05-8 | PendingTurn 编辑是否保留 enqueuedAt | 不保留（按新提交时刻排队） | 保留 | 采纳"不保留" |

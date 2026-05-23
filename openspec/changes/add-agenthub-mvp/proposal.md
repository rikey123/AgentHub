# add-agenthub-mvp

> **状态**：初稿 · 待评审
> **目标周期**：8–10 周（MVP）
> **作者输入来源**：`chatgpt-export_AI多Agent协作平台设计 (4).md`（11 722 行设计稿）
> **范围**：本提案覆盖 MVP；后续阶段按 V0.5 / V1.0 / V1.1–V1.5 分阶段，由 `v1-roadmap` capability 占位承载，每阶段开独立 change 展开（详见 design.md "Roadmap Beyond MVP"）。

## Why

AgentHub 要解决的问题是**"多个外部 Coding Agent（Claude Code、Codex、OpenCode 等）如何在同一份本地工作区上像群聊一样协作，并且让用户随时安全、可审计地介入"**。

当前已有方案各自有缺：

- **OpenCode** 给了优秀的本地 daemon + Effect 内核 + SSE 事件流，但只服务一种 coding agent，没有多 Agent 协作语义。
- **AionUi** 给了 Room/Mailbox/TaskBoard/Room MCP Tools 这套群聊协作协议，但状态散在内存、没有 durable run、没有上下文账本。
- **Multica** 给了 Task/Run/Daemon 这种"任务运行时"，但主交互是 AI Jira 而非 IM。
- **Mem0 / ReMe** 关注记忆抽取与检索，但缺产品级治理（来源、版本、可见性、用户确认、可回滚）。

业内还没有一个 local-first 平台同时满足：① IM 群聊式多 Agent 协作；② 统一适配层屏蔽 Claude Code / Codex / OpenCode 差异；③ 可治理的 Context Ledger 让多 Agent 共享事实而非各自臆造；④ 用户可随时敲门介入并拥有审批权。AgentHub 的差异化壁垒就在这四点的交集。

## What Changes

本 change 从空仓库起步，建立 AgentHub MVP 的全部基础能力（**所有变更都是 ADDED**，没有 BREAKING）：

- **本地 Daemon**：基于 Hono（HTTP 外壳）+ Effect Kernel（异步内核）的 TypeScript 服务，默认绑定 `127.0.0.1`，提供 OpenAPI + SDK + SSE。
- **事件系统**：双层事件（durable Event Store + ephemeral PubSub），envelope 含 `schemaVersion / traceId / causationId / correlationId`，9 大类事件（room / message / agent / run / task / context / permission / intervention / artifact）。
- **Bus 运行时**：Command 与 Event 显式分离（CommandBus / EventBus 两条干路）；domain + event + outbox 同事务提交；durable handler 各有游标 + at-least-once + 重试 + DLQ；RunQueue 是 bus 一条命名队列，按 Agent/Room/文件锁串行调度；SSE 反压有显式 buffer 上限 + Debug 流隔离；模块订阅图谱集中维护、CI 校验。
- **存储**：SQLite + Drizzle + WAL，本地优先，不要求用户先装 Postgres。
- **Web UI**：Vite + React + TypeScript 三栏 IM（会话列表 / 聊天流 + 卡片 / 上下文与任务板），SSE 接 `/event`。
- **Room（房间）模型**：MVP 支持 Solo + Assisted Mode（一个 Primary + 多个 Observer，Observer 默认沉默只能敲门 / 写 mailbox / 提交 draft context）。
- **Message + Cards**：文本、代码块、Diff、Context、Permission、Intervention、Artifact 等卡片化富消息；增量通过 `message.part.delta`（ephemeral，30–50 ms 合流）。
- **Agent 模型**：AgentProfile（静态配置，markdown frontmatter）+ AgentPresence（运行时 7 态状态机）。
- **Adapter 框架**：统一 `AgentRuntimeAdapter` 接口 + 能力声明（`capabilities` / `reliability` / `injectionMode`），MVP 至少提供 `MockAgentAdapter` + 一个真实 adapter（**Claude Code 优先**，原因：hooks/MCP/PreToolUse 事件最丰富，能验证完整介入闭环）。
- **Context Ledger**：ContextItem 七种类型（fact / decision / constraint / issue / artifact / preference / summary）、四种状态（draft / confirmed / deprecated / disputed）、版本乐观锁，Agent 只能 propose draft、用户确认才转 confirmed。
- **Context Assembly v0**：手写规则的 Prompt 组装器（pinned > task-scope > recent confirmed > recent draft），暂不接向量检索。
- **Orchestrator（轻量）**：MVP 的 Orchestrator 只做 Solo / Assisted 两种模式；任务拆解 / Squad 路由留 V1.0，War Room 留 V1.5。
- **Permission Engine**：复用 OpenCode `ask / allow / deny` 思想，覆盖文件、shell、tool、context、agent 五类资源；敏感文件白名单默认 deny。
- **Intervention Engine**：完整的"敲门 → 待用户裁决 → approved / ignored / rejected / snoozed"状态机，是 AgentHub 的差异化核心。
- **Artifact 系统**：Diff Card（Monaco Diff）、文件附件、preview 占位；MVP 阶段 Agent **不直接改文件**，只产出 patch，用户批准后系统应用。
- **Observability**：Debug Panel v0（事件流时间线 + traceId 串联 + adapter 原始事件）、pino 结构化日志、本地审计落 events 表。
- **Security**：daemon 默认 `127.0.0.1` + 远程 token、API key 走 OS keychain、敏感文件白名单、prompt injection 防护。
- **后续阶段 Roadmap 占位**：单独的 `v1-roadmap` capability 给 V0.5（OpenCode / Run Detail / 单机 Cost 面板）/ V1.0（Squad / Team / static-zip Deploy）/ V1.1（Task Board / 协作可视化）/ V1.2（Skill / BM25 / Vector / Memory hybrid）/ V1.3（Plugin / LangGraph / A2A 双向）/ V1.4（Tauri / Responsive Web / Docker Deploy）/ V1.5（War Room / Permission DSL）提供接口承诺与扩展点，不展开实现细节。详见 design.md "Roadmap Beyond MVP"。
- **observe 是被动状态 + WakeAgent 是模型调用唯一入口**：observing Agent 不因 room 事件流自动调用 LLM；Orchestrator dispatch `WakeAgent` 才发生模型调用，含 wakeReason 枚举 + 首轮完整 role prompt / 后续 delta prompt。
- **ArtifactFS Shadow Write + Run-Level Diff**：ACP `fs.writeTextFile` / MCP write tool 一律路由到 ArtifactFS（worktree 或 shadow buffer），Run 终结时整批生成 DiffArtifact，用户在 DiffCard 一次审查；不再 per-write 拦截弹卡。
- **ACP 是一等运行时协议**：MVP 实现统一 `ACPAdapter` 基类（state machine + JSON-RPC pending 表 + cancel/dispose 分离 + prompt 串行 + line-splitter buffer + 跨平台 spawn），Claude / Codex / OpenCode 三家 ACP 实现继承同一基类。
- **Run 状态机扩展**：`queued → claimed → starting → running` 显式拆 claimed 中间态；新增 `RunLifecycleService.updateSessionState`（不发 durable event）持久化 sessionId/workDir/providerConversationId；`ReclaimStaleClaimedRun` 后台任务恢复 daemon crash 后的中间态；Run 失败分类（transient / retryable_visible / fresh_session_required / permission_denied / configuration / fatal）决定是否自动重试与是否复用 session；handler retry 与 Run retry 完全隔离。
- **Permission per-session 队列 + 幂等 + Prompt Timeout Pause**：同 adapter session 串行展示 PermissionCard；`(adapterSessionId, toolCallId)` UNIQUE 幂等键；adapter prompt timeout 在 permission pending 时 pause、resolved 时 resume；总等待上限 maxPermissionWait（默认 600s）。
- **群聊主流摘要 / Agent Run Detail 双投影 + PendingTurn**：daemon 给 durable event 标 `visibility ∈ {main, detail, both}`；SSE 客户端通过 `?view=` 显式订阅；主流只展示 brief + actionable cards；Run Detail slide-over 7 tab 展示完整执行上下文；用户在 primary busy 时可继续发消息，PendingTurn 排队（上限 20，可取消可编辑）。
- **内部 PubSub Bounded + Worktree GC + Adapter Liveness 与 SSE 心跳分离**：durable 通道 back-pressure 不丢、ephemeral 通道 drop_oldest/coalesce、adapter raw 独立通道；worktree GC 严格沿 `<userhome>/.agenthub/` 管理根 + 不动 .git；adapter ping 心跳与 SSE heartbeat 各自独立 + `/healthz` 分别返回。
- **URI 安全闸 + Debug 授权边界**：file:// 走 resolveWorkspacePath、data: 限 MIME + 1 MB、事件 payload 不暴露绝对路径；`/debug/*` 与 SSE `view=raw` 需要 admin scope 或本地 debug.enabled；远程默认禁用 debug，显式 `[debug] allowRemote=true` 才开。
- **adapter.config.updated / agent.capabilities.updated 事件**：adapter 模型 / 能力变更与 agent 派生能力变更通过 durable 事件广播给 Permission / Orchestrator / UI，避免轮询和状态漂移。
- **WakeAgent 是模型调用唯一入口（无 StartRun Command）**：MVP 直接把 `StartRun` 从 Command union 移除，CommandBus 类型系统不存在该命令；`agent.run.queued` 的唯一来源是 `WakeAgent` handler 在 IMMEDIATE 事务内调 `RunLifecycleService.create`；`SendMessage` 在事务里判 primary busy 并设 `messages.turn_dispatch_mode='immediate'|'pending'` 闸门，Orchestrator handler 严格按闸门决定是否 dispatch `WakeAgent`；`PendingTurn` 由 `ConsumePendingTurn` 内部命令在上一轮终结后消费（其 handler 内部转 dispatch WakeAgent）。
- **RunLifecycleService 接口补齐 + fail() failureClass 必填**：增加 `markClaimed / markWaitingPermission / updateSessionState`；`markStarting` 仅接受 `prevState='claimed'`；`markRunning` 从 `waiting_permission` 恢复时同事务发 `agent.run.resumed`；`fail()` 强制要求 `failureClass`，决定下游重试 / mailbox 回滚 / UI 表现。
- **visibility 收归 event-system**：`visibility ∈ {main, detail, both}` 是 envelope 一等字段，由 event-system canonical registry 唯一定义；events 表 schema 由 event-system 持有；其它 capability 仅消费不重写。
- **canonical 事件注册补齐**：新增 `message.brief.published / message.updated / pending_turn.* / agent.run.waiting_permission / agent.run.resumed / adapter.liveness.changed / adapter.config.updated / agent.capabilities.updated / adapter.session.disposed / tool.update.diverted / worktree.gc.removed / worktree.gc.skipped`；命名统一（`permission.requested.denied` 改回 `permission.resolved decision=deny`，`context.item.visibility.changed` 全文一致）。
- **CI 五道防线**：`events:check / visibility:check / subscriptions:check / command:check / run-state-machine:check` 是 strict validate 之外的必备 CI；M0 阶段就接入，每次 PR 跑。
- **ArtifactFS shadow_buffer / shell 边界**：terminal-enabled agent MUST `isolated_worktree` / `isolated_copy`，不允许 `shadow_buffer`；MVP ACP 默认 `terminal=false`；`shared` 仅测试。
- **Preview iframe 收紧**：sandbox 仅 `allow-scripts`（去掉 `allow-same-origin`）；preview 服务独立 origin / 端口；CSP 严格；token 一次性 + 30 分钟 TTL。
- **attachSession 接口 + canRestoreSession 一致性**：`AgentRuntimeAdapter.attachSession?(input)` 接口落实；manifest `crashRecovery=resumable` 必须 `canRestoreSession=true` 且实现 attachSession；CI 校验。
- **trusted_system_tool 白名单**：`room.write_context` 写 confirmed 必须 `source.kind` ∈ daemon 内置或用户显式开启的 trusted 列表；防止 agent 借 `confidence=verified` 绕过用户确认。

## Capabilities

### New Capabilities

> **能力切分原则**：按 _bounded context_ 切，不按目录切；每个 capability 至少一份 spec 文件。spec 内部用 RFC 风格（Goals / Non-Goals / Definitions / Detailed Design / Data Model / API / Events / State Machines / Edge Cases / Open Questions / Acceptance Criteria）填进 `### Requirement:` 描述，scenarios 作为可验收测试点。

- `local-daemon`：Hono + Effect Kernel 本地服务，OpenAPI + SDK 自动生成、SSE `/event` 主流、生命周期管理与多客户端连接。
- `event-system`：事件 envelope、9 大类事件、durable / ephemeral 分级、Event Store（SQLite events 表 + 单调 seq）+ Effect PubSub、SSE 桥接与 cursor 重连。
- `bus-runtime`：Command Bus 与 Event 显式分离、Outbox 事务边界、durable handler 游标 + 重试 + DLQ、RunQueue 锁矩阵（Agent / Room / 文件）、SSE 反压、Debug 流隔离、模块订阅图谱（单一真相）。
- `rooms`：Room 实体、参与者矩阵、5 种群聊模式定义（MVP 实现 Solo + Assisted）、唤醒规则与发言纪律。
- `messaging`：Message + MessagePart + 8 种 Card 类型、增量流（30–50 ms 合流）、消息操作（重生成、引用、应用 Diff、pin / 升级 scope）。
- `agents`：AgentProfile 配置（markdown frontmatter）、AgentPresence 7 态状态机、能力标签、Agent 注册与发现。
- `adapter-framework`：`AgentRuntimeAdapter` 接口、能力声明 manifest、MockAdapter + Claude Code Adapter（首批）、Codex / OpenCode adapter 接口预留、子进程隔离与 crash tombstone。
- `context-ledger`：ContextItem 模型与版本乐观锁、draft → confirmed 流程、可见性矩阵、Context Assembly v0（规则版）、注入三档（immediate / next_turn / next_session）UI 透明。
- `orchestrator`：群聊纪律执行器、@提及路由、规则触发、Mailbox（durable inbox）、Solo / Assisted 模式调度。
- `permissions`：PermissionProfile 模型、五类资源权限、敏感文件白名单、`ask / allow / deny` + Effect Deferred 异步审批。
- `interventions`：敲门介入状态机、Intervention Card UI、四种处置（approve / later / ignore / reject）、运行中注入。
- `artifacts`：Artifact 模型与状态机、Diff Card（Monaco Diff）+ 文件附件 + 终端日志、Agent-only-patch 原则、用户应用流程。
- `web-ui`：Vite + React 三栏布局、消息流虚拟化、卡片渲染、Debug Panel v0、Permission/Intervention 弹窗。
- `observability`：events 表审计、traceId 串联、Debug Panel 事件回放、pino 结构化日志、Cost Ledger 字段记录（单机 Cost 面板 = V0.5；预算告警 = V1.5 permission-dsl）。
- `security`：daemon 绑定策略、token 远程认证、OS keychain 集成、敏感文件白名单、prompt injection 防护、子进程隔离规则。
- `v1-roadmap`：本 capability **不实现任何功能**，只承诺后续阶段的接口与扩展点。按阶段归档：
  - **V0.5（多 Agent 聊天室完整化）**：`opencode-adapter`、`run-detail-projection`、`cost-panel-local`
  - **V1.0（复杂调度，Web-only）**：`squad-mode`、`team-mode`、`deployment-static-zip`
  - **V1.1（协作可视化）**：`task-board`（独立 capability，不污染 messaging）、`collab-visualization`（先做 Timeline，Topology/Dependency 顺延 V1.2）
  - **V1.2（上下文真生效）**：`skill-system`（声明式无代码）、`bm25-recall`、`vector-search`（sqlite-vec）、`memory-gateway`（混合记忆）
  - **V1.3（生态打开）**：`plugin-system`（worker/subprocess 隔离）、`langgraph-adapter`、`a2a-server` + `a2a-client` 双向
  - **V1.4（多端适配）**：`desktop-shell-tauri`、`responsive-web`（替代 Mobile Native）、`deployment-docker`
  - **V1.5（高级编排）**：`war-room-mode`、`permission-dsl`
  - **路线红线（design.md D32）**：单机本地产品，永不做 SaaS / 云端 / 团队云端 / 多用户认证 / Postgres / Redis / WebSocket Hub / Mobile Native / Marketplace。

### Modified Capabilities

无。`openspec/specs/` 当前为空，本 change 全部为 ADDED。

## Impact

- **新增代码区**：`apps/web/`、`apps/cli/`、`packages/daemon/`、`packages/protocol/`、`packages/sdk/`、`packages/db/`、`packages/bus/`、`packages/rooms/`、`packages/messages/`、`packages/agents/`、`packages/adapters/{mock,claude-code,opencode,codex}/`、`packages/context/`、`packages/orchestrator/`、`packages/permissions/`、`packages/interventions/`、`packages/artifacts/`、`packages/observability/`、`packages/ui/`。
- **运行时与外部依赖**：Bun（开发）/ Node 22（兼容）；Effect、Hono、Drizzle、better-sqlite3、Vite、React、TanStack Virtual、Monaco Diff、Shiki、pino、node-pty、chokidar、simple-git、micromatch、gray-matter、AI SDK、MCP SDK、@a2a-js/sdk（V1.3 才用）。
- **不依赖**：Next.js、PostgreSQL、Redis、Python（MVP 阶段），LangGraph 在 V1.3 通过 adapter 接入；Memory Gateway / hybrid memory（local + 外部 backend）在 V1.2 接入，外部 backend 选 Mem0 vs ReMe 待 V1.2 开工前裁决。
- **跨边界协议**：内部事件协议自有；对外兼容 MCP（工具）和 A2A（V1.3 server + client 双向）。
- **安全面**：daemon 默认 `127.0.0.1`-only，远程访问需要显式开启 token；任何文件写入与 shell 调用经 Permission Engine。
- **可逆性**：所有变更落 SQLite + 文件；MVP 不写云端；卸载 = 删除 `.agenthub` 目录。
- **未在本 change 内**：后续阶段能力（V0.5 OpenCode / V1.0 Squad·Team·static-zip Deploy / V1.1 Task Board · 协作可视化 / V1.2 Skill·BM25·Vector·Memory hybrid / V1.3 Plugin·LangGraph·A2A 双向 / V1.4 Tauri 桌面壳·响应式 Web·Docker Deploy / V1.5 War Room·Permission DSL）只占位接口，不实现。
- **路线红线（design.md D32）**：永不做 SaaS / 云端 / 团队云端 / 多用户认证 / Postgres / Redis / WebSocket Hub / Mobile Native Client / Marketplace。

# tasks: add-agenthub-mvp

> 8–10 周 MVP 实施清单。每条 task 引用具体 spec capability + requirement，便于验收。
> **格式**：`- [ ] N.M Task — refs: <capability>/<Requirement 名> [+ ...]`

## 0. Repo / Tooling Bootstrap (Week 0, ~3d)

- [ ] 0.1 创建 monorepo（pnpm workspaces / Bun workspaces 二选一，推荐 pnpm + Bun runtime），加 turborepo
- [ ] 0.2 加 TypeScript 基础（tsconfig.base.json + 各 package extends）
- [ ] 0.3 加 vitest + Playwright + ESLint + Prettier 基础
- [ ] 0.4 加 GitHub Actions（lint / typecheck / test：Bun 与 Node 22 双跑）— refs: design D5
- [ ] 0.5 创建空 packages：`daemon` `protocol` `sdk` `db` `bus` `rooms` `messages` `agents` `adapters/{mock,claude-code,opencode,codex}` `context` `orchestrator` `permissions` `interventions` `artifacts` `observability` `ui` `config`
- [ ] 0.6 创建 apps：`web` `cli`
- [ ] 0.7 写 README + CONTRIBUTING + 仓库 LICENSE 占位

## 1. 数据库与 Schema (Week 1)

- [ ] 1.1 安装 Drizzle + better-sqlite3，建 `packages/db` — refs: local-daemon/Daemon 启动与端口绑定
- [ ] 1.2 实现 SQLite pragma 启动配置（journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000, temp_store=MEMORY, mmap_size=256MB, page_size=4096）— refs: design D3
- [ ] 1.3 写 migration 文件 `0001_init.sql`：workspaces / rooms / room_participants / agent_profiles / agent_presence — refs: rooms/Room 数据模型, agents/AgentProfile 数据模型, agents/AgentPresence 状态机
- [ ] 1.4 写 migration `0002_messages.sql`：messages / message_parts / attachments — refs: messaging/Message + MessagePart 数据模型, messaging/消息附件上传
- [ ] 1.5 写 migration `0003_events.sql`：events 表 + 全部索引 — refs: event-system/events 表 Schema
- [ ] 1.6 写 migration `0004_runs_tasks.sql`：runs / tasks / task_runs — refs: agents/Run 生命周期
- [ ] 1.7 写 migration `0005_context.sql`：context_items / context_versions — refs: context-ledger/ContextItem 数据模型
- [ ] 1.8 写 migration `0006_permissions.sql`：permission_profiles / permission_rules / permission_requests — refs: permissions/PermissionProfile 数据模型, permissions/PermissionRequest 与 Deferred 异步审批
- [ ] 1.9 写 migration `0007_interventions.sql`：interventions — refs: interventions/Intervention 数据模型
- [ ] 1.10 写 migration `0008_artifacts.sql`：artifacts / artifact_files — refs: artifacts/Artifact 数据模型
- [ ] 1.11 写 migration `0009_mailbox.sql`：① `mailbox_messages` 表（含后续 `claimed_run_id / claimed_at / delivery_batch_id TEXT` 列）；② `run_next_turns` 表 + `idx_next_turns_run_unconsumed (run_id) WHERE consumed_at IS NULL` + `idx_next_turns_room_agent (room_id, agent_id, created_at)`；③ `mailbox_deliveries` 表（`delivery_batch_id TEXT, run_id TEXT, mailbox_ids TEXT, next_turn_ids TEXT, delivered_at INTEGER, PRIMARY KEY (delivery_batch_id, run_id)`）+ `idx_mailbox_deliveries_run (run_id, delivered_at)` — refs: orchestrator/Mailbox 是 durable inbox, orchestrator/run_next_turns 表（active run 期间追加输入的持久化通道）, orchestrator/room.read_mailbox 双源原子消费
- [ ] 1.12 写 migration `0010_auth.sql`：auth_tokens — refs: security/Token 协议
- [ ] 1.13 单元测试：每张表 CRUD + 索引命中

## 2. Protocol & Schema 包 (Week 1)

- [ ] 2.1 在 `packages/protocol` 用 Effect Schema 定义 EventEnvelope + 所有 9 大类事件 payload — refs: event-system/事件 Envelope 强制版本化, event-system/事件分级
- [ ] 2.2 定义 Domain types：Room / Message / MessagePart / AgentProfile / Run / ContextItem / PermissionRequest / Intervention / Artifact — refs: 各 capability 的"数据模型"requirement
- [ ] 2.3 定义 Adapter 接口 schema：AgentRuntimeAdapter / AgentAdapterManifest / AdapterEvent — refs: adapter-framework/AgentRuntimeAdapter 接口, adapter-framework/AgentAdapterManifest（能力声明）
- [ ] 2.4 定义 OpenAPI 3.1 spec（YAML 或 TS-first 用 hono-openapi）— refs: local-daemon/OpenAPI + 自动生成 SDK
- [ ] 2.5 写 `EventMigrator` 升级器骨架（只支持 v1，预留 v2 入口）— refs: event-system/事件 schema 演进规则
- [ ] 2.6 写 `bun run schema:check` 检测破坏性变更 — refs: event-system/事件 schema 演进规则
- [ ] 2.7 单元测试：events 序列化 / 反序列化 round-trip + 升级器

## 3. Effect Kernel & Event Bus & Bus Runtime (Week 1-2)

- [ ] 3.1 在 `packages/bus` 实现 Effect EventBus（PubSub + per-type Stream + Scope 管理）— refs: event-system/双 PubSub（wildcard + per-type）
- [ ] 3.2 实现 `EventBus.publish()` durable 路径（事务内 INSERT events + 分配 seq + INSERT outbox）— refs: event-system/事件分级, bus-runtime/Outbox + 事务边界（domain + event 同事务提交）
- [ ] 3.3 实现 ephemeral 路径（直接 PubSub，不写 outbox）— refs: event-system/事件分级
- [ ] 3.4 实现 delta 合流（40ms 窗口）— refs: event-system/ephemeral delta 合流（反压）
- [ ] 3.5 实现 `replayDurableSinceSeq(seq)` 用于 SSE 重连与 handler catch-up — refs: event-system/SSE 桥接与 cursor 重连, bus-runtime/Durable Handler 注册 + 游标 + at-least-once 语义
- [ ] 3.6 实现 traceId / causationId 注入辅助 — refs: observability/traceId / causationId / correlationId 注入
- [ ] 3.7 集成测试：1 publisher + 5 subscribers 不丢事件 / Scope 关闭自动取消 / 高速 delta 合流到 ≤ 25 帧/秒

### Bus Runtime 子模块（CommandBus / Outbox / Handler / RunQueue / 反压 / 订阅图）

- [ ] 3.8 写 migration `0011_bus_runtime.sql`：`outbox` / `handler_cursors` / `dead_letter_events` / `run_locks` / `command_records` 五张表 + `ALTER TABLE runs ADD COLUMN waiting_reason TEXT`；`run_locks` schema MUST 含 `lock_type ('agent'|'room'|'file'|'workspace')` / `lock_key` / `workspace_id TEXT`（file 与 workspace 类型必填）/ `run_id` / `acquired_at`；MUST 创建 `idx_run_locks_runid (run_id)` 与 `idx_run_locks_workspace (workspace_id, lock_type)` — refs: bus-runtime/Outbox + 事务边界, bus-runtime/Durable Handler 注册 + 游标, bus-runtime/Handler 重试 + 死信队列, bus-runtime/RunQueue 是 bus 的一条命名队列, bus-runtime/Command 幂等表（`command_records`）
- [ ] 3.9 实现 `CommandBus.dispatch()`：Command union schema、`command_records` 24h 幂等去重（同 key 同 body 命中缓存 / 同 key 异 body 拒绝 / in_flight 拒绝）、CommandResult 返回 emittedEvents；**失败分类**：DeterministicError（validation_failed / not_found / conflict / permission_denied / duplicate / not_implemented）写入 status='failed' 缓存、业务事务回滚；TransientError（internal_error / transaction_rollback / crash / rate_limited / lock_timeout）整事务回滚（含 command_records 行）；reaper 60s 标 in_flight→expired — refs: bus-runtime/Command 与 Event 显式区分, bus-runtime/Command 幂等表（`command_records`）
- [ ] 3.10 把所有 mutating HTTP route 改写成 `commandBus.dispatch(...)`；ESLint 规则禁止 HTTP handler 直接 `eventBus.publish` 或访问 domain 表 — refs: bus-runtime/Command 与 Event 显式区分
- [ ] 3.11 实现 Outbox Dispatcher（启动时 drain pending → 实时模式按 seq 升序派发 → 失败指数退避 1s/4s/16s/60s/300s 共 10 次）— refs: bus-runtime/Outbox + 事务边界
- [ ] 3.12 实现 DurableHandlerRegistry：register / catch-up（**全局观察游标 = 方案 A**：按 last_seq → max(seq) 顺序全量遍历，订阅类型才调 handle 否则跳过；任一情况都推进 cursor）/ 实时投递 / 保序（同 handler 不并发）/ at-least-once → handler 内幂等；`agenthub admin handler reset-cursor <name> --to=<seq>` CLI — refs: bus-runtime/Durable Handler 注册 + 游标 + at-least-once 语义
- [ ] 3.13 实现 Handler 重试 + DLQ：5 次失败转 dead_letter_events（status='unresolved'），cursor 不前进；Debug Panel 提供 Replay / Skip 操作 + `handler.stalled` 事件 — refs: bus-runtime/Handler 重试 + 死信队列（DLQ）
- [ ] 3.14 实现 RunService + RunLifecycleService + WakeAgent handler + RunQueue Worker（**职责严格分离**）：① **RunService** = `CancelRun` Command handler，仅做入参校验、调 `RunLifecycleService.markCancelling(tx)`；**MVP 不存在 StartRun Command**；② **RunLifecycleService** = `runs` 表唯一写入口，也是所有 `agent.run.*` durable event 的唯一发布者，方法 = `create / markWaiting / markClaimed / markStarting / markRunning / markWaitingPermission / markCancelling / complete / fail / cancelFinalized / updateSessionState`；**所有 mutation 方法首参 `tx: SqliteTx | null`**（传入参与外层事务，不传 service 自开 IMMEDIATE）；`fail()` 强制 `failureClass`，且按 failureClass 在同事务内 UPDATE mailbox 回滚 claim；`markClaimed` 接受 `queued | waiting → claimed`；`markStarting` 仅接受 `claimed → starting`；`markRunning` 接受 `starting | waiting_permission → running`，从 waiting_permission 进入时同事务 emit `agent.run.resumed`；`fail` 接受任意非终结状态进入；含状态机校验与幂等；③ **WakeAgent handler**（位于 orchestrator 模块）= `WakeAgent` Command 唯一 handler，IMMEDIATE 事务内 activeWakes guard（try/finally）+ DB 级二次校验 + 原子 mailbox claim + 零输入判断 + 调 `RunLifecycleService.create(tx, input)`；不另行 dispatch StartRun（不存在）；④ **RunQueue Worker** = `agent.run.queued` 的 durable handler，**只**写 `run_locks`，状态推进必须调 `RunLifecycleService.markClaimed(null, ...) → markStarting(null, ..., pid) → markRunning / markWaiting`；⑤ **CancelRun handler** 在 `markCancelling` 成功后**同步**调 `AdapterManager.cancelRun(runId)`，不订阅 `agent.run.cancelled` 触发；⑥ 锁超时 5 分钟降级 `fail(null, runId, "lock_timeout", "transient")`；⑦ **崩溃恢复 startup hook 两阶段**：Stage 1 `DELETE FROM run_locks`；Stage 2 按 status 分类（`queued/waiting` 保留状态等重新调度；`claimed AND claimed_at < now-30s` → fail("claim_aborted","transient")；`starting AND adapter_session_id IS NULL` → fail("daemon_restarted_before_session","transient")；`running/waiting_permission AND adapter_session_id IS NOT NULL AND pid_at_start ≠ 当前 pid` → 进 ReclaimStaleClaimedRun；`cancelling` → cancelFinalized）；不再一刀切把所有非 terminal 标 failed；⑧ markStarting `IllegalTransition` 时立即释放刚拿的锁 — refs: bus-runtime/RunLifecycleService 是 `runs` 表的唯一写入口, bus-runtime/RunQueue 是 bus 的一条命名队列, orchestrator/Solo 模式调度, orchestrator/Mailbox 原子认领, artifacts/多 Agent 改同文件互斥（D7）
- [ ] 3.14b 实现 AdapterBridge：每个 adapter session 一个 bridge，订阅 adapter `Stream<AdapterEvent>`；① 非 run 状态事件（`tool.call.requested` / `tool.call.completed` / `subagent.started` / `subagent.completed` / `file.changed` / `context.snapshot`）由 bridge 直接 publish；② run 状态终结（completed / failed / cancelFinalized）**禁止**直接 publish，必须调 `RunLifecycleService.complete / fail / cancelFinalized` 由 service 在单事务内发 durable event；③ **session.opened 时 canonical 两步顺序、独立事务**：tx1 调 `updateSessionState(null, runId, { adapterSessionId, workDir, providerConversationId? })` 先持久化 session 元数据，tx2 调 `markRunning(null, runId, adapterSessionId)` 推进状态到 running；这样 daemon 在两步之间崩溃可被 ReclaimStaleClaimedRun 扫描候选 3 命中并 attach；④ adapter 内部不直接发任何 durable event — refs: bus-runtime/RunLifecycleService 是 `runs` 表的唯一写入口, bus-runtime/模块订阅图谱（单一真相）, adapter-framework/AgentRuntimeAdapter 接口, adapter-framework/Cost 字段上报, bus-runtime/ReclaimStaleClaimedRun 后台任务
- [ ] 3.15 实现 SSE 反压：per-client 队列 maxQueuedDurable=1000 / maxQueuedEphemeral=500 / slowClientThresholdMs=30s / durableSendTimeoutMs=5s；durable 满 → 断开让客户端 catch-up；ephemeral 满 → FIFO drop — refs: bus-runtime/SSE 反压（buffer 上限 + 慢消费者策略）
- [ ] 3.16 实现 Debug 流隔离：`/debug/event` 独立 endpoint + 独立反压（durable 10000 / ephemeral 5000）；生产模式默认 404 — refs: bus-runtime/Debug 流隔离
- [ ] 3.17 写订阅图谱声明：每个模块在自己 package 下 `subscribes.ts` 列出订阅的 event type；`bun run subscriptions:check` 比对 `bus-runtime/订阅图谱` 矩阵，CI 失败时给出 diff — refs: bus-runtime/模块订阅图谱（单一真相）
- [ ] 3.18 实现 daemon 启动 / 关闭顺序（startup hook 顺序 1–9，shutdown 反向）+ 启动期未追平时返回 503 `service_starting` — refs: bus-runtime/Bus 启动 / 关闭顺序
- [ ] 3.19 集成测试：① 事务一致性（事务内 kill 后重启不漏事件）② handler 失败 5 次进 DLQ + Skip 后追上 ③ 同 Agent 多 Run 串行 / 文件锁字典序无死锁 ④ 慢客户端被断开后用 Last-Event-ID 追平 ⑤ Debug 流拥塞不影响主流

## 4. Daemon 主进程 (Week 2)

- [ ] 4.1 在 `packages/daemon` 装 Hono + 启动 server 绑 127.0.0.1:6677 — refs: local-daemon/Daemon 启动与端口绑定
- [ ] 4.2 实现配置加载（config.toml / 环境变量 / CLI flag 优先级）— refs: local-daemon/Daemon 启动与端口绑定
- [ ] 4.3 实现 0.0.0.0 绑定校验（必须 token + 显式 enabled）— refs: security/默认 127.0.0.1 绑定
- [ ] 4.4 实现 `/healthz` + `/debug/stats` — refs: local-daemon/健康检查, observability/健康指标端点（最小）
- [ ] 4.5 实现 SIGINT/SIGTERM 优雅停止（30s in-flight run 超时）— refs: local-daemon/优雅停止
- [ ] 4.6 实现 `/event` SSE endpoint（首次连接 / cursor 重连 / heartbeat 10s / 反压策略）— refs: local-daemon/多客户端 SSE 连接, event-system/SSE 桥接与 cursor 重连, bus-runtime/SSE 反压（buffer 上限 + 慢消费者策略）
- [ ] 4.7 实现 OpenAPI route + `bun run sdk:generate` 写到 `packages/sdk` — refs: local-daemon/OpenAPI + 自动生成 SDK
- [ ] 4.8 实现 token 中间件（Bearer + query token 兼容 SSE）— refs: security/Token 协议, v1-roadmap/V1.4 响应式 Web 占位（responsive-web）
- [ ] 4.9 加 `apps/cli` 的 `agenthub start/stop/status/doctor/auth issue/auth list/auth revoke` — refs: design Q-D, security/Token 协议
- [ ] 4.10 集成测试：daemon 启停 + SSE 多 tab + cursor 重连 + 端口冲突退出码

## 5. Rooms / Messages / Agents 基础 (Week 2-3)

- [ ] 5.1 实现 Room CRUD API（create solo / assisted、list、archive、unarchive）— refs: rooms/Room 数据模型, rooms/Room 列表与归档
- [ ] 5.2 实现 Solo / Assisted 校验（primary 必填、Solo 不允许多 agent）— refs: rooms/Solo Mode 行为, rooms/Assisted Mode 行为
- [ ] 5.3 实现 Team / Squad / War Room 创建返回 501 — refs: rooms/Post-MVP Mode 占位
- [ ] 5.4 实现 AgentProfile 加载器（gray-matter 解析 markdown，扫描用户级 + workspace 级）— refs: agents/AgentProfile 数据模型
- [ ] 5.5 实现 chokidar 热更新 + agent.profile.updated 事件 — refs: agents/AgentProfile 数据模型/配置文件热更新
- [ ] 5.6 实现内置 4 个 Agent 模板首启写入 — refs: agents/内置 Agent（MVP 必带）
- [ ] 5.7 实现 AgentPresence 状态机 + 7 态枚举校验 — refs: agents/AgentPresence 状态机
- [ ] 5.8 实现 Message + MessagePart CRUD API（含 quote / attachment）— refs: messaging/Message + MessagePart 数据模型, messaging/消息附件上传
- [ ] 5.9 实现 8 种 Card 类型 schema（前端 / 后端共享）— refs: messaging/Card 类型清单
- [ ] 5.10 实现消息分页（cursor-based）— refs: messaging/消息列表分页
- [ ] 5.11 实现消息操作 API：复制（前端）/ 引用 / 重新生成 / Pin / 删除 — refs: messaging/消息操作（固定 6 个）
- [ ] 5.12 集成测试：Solo Room 发消息触发 mock 回复 / Assisted 多 agent 列表

## 6. Adapter Framework + Mock Adapter (Week 3)

- [ ] 6.1 在 `packages/adapters/mock` 实现 MockAgentAdapter — refs: adapter-framework/MockAgentAdapter
- [ ] 6.2 实现 MockAgentScript DSL（7 个 step 类型）— refs: adapter-framework/MockAgentAdapter
- [ ] 6.3 实现 AdapterManager（注册、detect、生命周期、crash tombstone、重启）— refs: adapter-framework/Adapter 注册到 Manager, adapter-framework/子进程隔离与 Crash Tombstone
- [ ] 6.4 实现 Adapter args 层级解析 — refs: adapter-framework/Adapter 参数层级（args）
- [ ] 6.5 实现 Cost 字段强制上报 — refs: adapter-framework/Cost 字段上报
- [ ] 6.6 集成测试：MockAdapter 跑完 say + diff + permission + intervention 完整闭环

## 7. Permission Engine (Week 3-4)

- [ ] 7.1 在 `packages/permissions` 实现 PermissionProfile 加载 + 内置三个模板（builder-strict / builder-loose / read-only）— refs: permissions/内置 PermissionProfile 模板
- [ ] 7.2 实现敏感文件白名单匹配（micromatch）+ 默认 deny — refs: permissions/默认敏感文件白名单（deny）
- [ ] 7.3 实现 PermissionEngine 决策器（资源类型 → action）+ Effect Deferred 异步挂起 — refs: permissions/PermissionRequest 与 Deferred 异步审批
- [ ] 7.4 实现项目内 / 项目外 / 敏感三档 + 路径 canonicalize — refs: permissions/审批粒度（项目内 / 项目外 / 敏感）, security/工作区路径校验
- [ ] 7.5 实现 shell 命令 glob 匹配（含 pipeline 拆解）— refs: permissions/shell 命令 glob 匹配
- [ ] 7.6 实现 `permission_rules` 持久化 + "本项目总是允许" 快路径 — refs: permissions/"本项目总是允许"持久化
- [ ] 7.7 实现 60s 超时 → expired = deny — refs: permissions/PermissionRequest 与 Deferred 异步审批
- [ ] 7.8 实现 Permission API（profiles CRUD / requests / resolve / rules）— refs: permissions/Permission API
- [ ] 7.9 实现 audit 写 `permission.resolved` 事件 — refs: permissions/Audit log
- [ ] 7.10 集成测试：ask 流程 / deny 立即拒绝 / 超时 / 快路径

## 8. Context Ledger + Assembly v0 (Week 4)

- [ ] 8.1 在 `packages/context` 实现 ContextItem CRUD + 版本乐观锁 — refs: context-ledger/ContextItem 数据模型, context-ledger/版本乐观锁与冲突
- [ ] 8.2 实现 propose（draft）与 confirm 状态流 + 强制降级（Agent 写 confirmed → draft）— refs: context-ledger/Agent 提议 ContextItem, context-ledger/Agent 直接写 confirmed 被拒
- [ ] 8.3 实现 Pin（scope 升级）+ context.item.visibility.changed 事件 — refs: context-ledger/Scope 升级（Pin）, messaging/Pin 与 Context Scope 升级
- [ ] 8.4 实现可见性矩阵过滤 — refs: context-ledger/可见性矩阵
- [ ] 8.5 实现 Context Assembly v0（6 步规则 + token budget）— refs: context-ledger/Context Assembly v0（规则版）
- [ ] 8.6 实现注入三档（immediate / next_turn / next_session）+ ContextInjectionResult 返回 — refs: context-ledger/注入三档与 UI 透明
- [ ] 8.7 实现冲突检测 → context.item.conflict_created — refs: context-ledger/版本乐观锁与冲突
- [ ] 8.8 实现 PreCompact / SessionEnd snapshot → ContextItem.summary 草稿 — refs: context-ledger/长会话压缩 → ContextItem.summary
- [ ] 8.9 实现 NoopVectorIndex 占位 — refs: context-ledger/V1.2 向量检索接口预留, v1-roadmap/V1.2 向量检索占位（vector-search）
- [ ] 8.10 集成测试：Agent propose → 用户 confirm → 下一 run prompt 含 / pin 升级生效 / 冲突卡触发

## 9. Orchestrator + Mailbox + Room MCP Tools (Week 4-5)

- [ ] 9.1 在 `packages/orchestrator` 实现 Solo 调度（user message → primary run，串行）— refs: orchestrator/Solo 模式调度
- [ ] 9.2 实现 Assisted 调度（@mention 解析 + 唤醒 + 串行）— refs: orchestrator/Assisted 模式调度, orchestrator/Mention 解析
- [ ] 9.3 实现唤醒去重（activeWakes set）— refs: orchestrator/唤醒去重（loop guard）
- [ ] 9.4 实现 5 种唤醒规则（@mention / orchestrator.delegate / rule / knock_approved / group_review）— refs: rooms/唤醒规则总表, orchestrator/Assisted 模式调度
- [ ] 9.5 实现群聊纪律执行器（Observer send_message → mailbox 降级）— refs: rooms/群聊纪律执行器
- [ ] 9.6 实现 Mailbox CRUD（durable）+ mailbox.message.created 事件 — refs: orchestrator/Mailbox 是 durable inbox
- [ ] 9.7 实现状态行节流（30s/Agent/Room）— refs: orchestrator/状态行节流, rooms/群聊纪律执行器
- [ ] 9.8 实现锁矩阵 (agent / room / file / workspace) 互斥：Run 声明 `targetFiles` 非空 → 取 file 锁；`targetFiles` 未知 → 退化取 `lock_type='workspace', lock_key=workspaceId, workspace_id=workspaceId` 整 workspace 写锁；申请 file 锁前 SELECT WHERE lock_type='workspace' AND workspace_id=W 命中即阻塞；申请 workspace 锁前 SELECT WHERE lock_type='file' AND workspace_id=W 命中即阻塞；交叉互斥扫描在 IMMEDIATE 事务内完成 — refs: artifacts/多 Agent 改同文件互斥（D7）, bus-runtime/RunQueue 是 bus 的一条命名队列
- [ ] 9.9 实现 Room MCP Server + 15 个 tool — refs: orchestrator/Room MCP Tools
- [ ] 9.10 实现 MCP server 在 createSession 注入 — refs: orchestrator/Room MCP Tools
- [ ] 9.11 集成测试：Observer 不能发消息（被降级到 mailbox）/ @ 唤醒 / 多 @ 顺序执行 / 重复唤醒去重

## 10. Intervention Engine (Week 5)

- [ ] 10.1 在 `packages/interventions` 实现 Intervention CRUD + 状态机校验 — refs: interventions/Intervention 数据模型, interventions/状态机
- [ ] 10.2 实现 4 个 action API（approve / later / ignore / reject）— refs: interventions/Intervention API
- [ ] 10.3 实现 snooze 计时器 + 重新激活 — refs: interventions/状态机/用户 later（snooze）
- [ ] 10.4 实现 approve 后调 adapter.injectContext + 按 injectionMode 处理 — refs: interventions/状态机/用户 approve
- [ ] 10.5 实现去重（同 source + same target）— refs: interventions/去重
- [ ] 10.6 实现 source Agent presence 联动（knocking / active / observing）— refs: interventions/Reviewer 状态联动
- [ ] 10.7 实现 emergency / rollback 类型创建返回 501 — refs: interventions/不在 MVP 范围
- [ ] 10.8 集成测试：完整闭环（敲门 → 卡片 → approve → 注入 → resolved）

## 11. Artifacts (Week 5-6)

- [ ] 11.1 在 `packages/artifacts` 实现 Artifact + ArtifactFile CRUD — refs: artifacts/Artifact 数据模型
- [ ] 11.2 实现 Diff 状态机（draft → reviewing → accepted → applied）+ 失败路径 — refs: artifacts/Diff Artifact 状态机
- [ ] 11.3 实现 apply 流程（applying 中间态 + 多文件 best-effort transactional）：① 全部 oldSha256 预校验 ② Permission file.write 一次性请求 ③ status=applying 后写 sibling 临时文件 `<path>.agenthub-tmp-<artifactId>` ④ 全部成功后按字典序 rename ⑤ 中途失败回滚（删未 rename 的 tmp + 用 oldContent 写回已 rename 的）+ 发 `artifact.failed { reason: "apply_partial", recoveryRequired: false }` ⑥ **回滚自身失败** → 发 `artifact.failed { reason: "recovery_required", recoveryRequired: true, affectedFiles[].appliedState }` + UI 红色横幅 — refs: artifacts/Diff Artifact 状态机
- [ ] 11.4 实现 revert（创建反向 patch）+ 30 天保留 — refs: artifacts/Diff 应用可逆
- [ ] 11.5 实现 type=file 上传/读取 — refs: artifacts/File Artifact
- [ ] 11.6 实现 type=terminal 抓取（stdout/stderr 落盘 + Card 渲染前 200 行）— refs: artifacts/Terminal Artifact
- [ ] 11.7 实现 type=preview iframe + 临时 token URL（30 分钟过期）— refs: artifacts/Preview Artifact（最小实现）, design D17
- [ ] 11.8 实现 type=deployment 创建返回 501 — refs: artifacts/Deployment 占位
- [ ] 11.9 实现 SafeWritePolicy（默认 [] 空白名单）— refs: artifacts/安全写白名单（仅 MVP 例外）
- [ ] 11.10 集成测试：DiffCard 全流程 / revert / preview token 过期 / stale_base 拒绝 / 多文件 apply 中途磁盘满回滚 / Permission deny 时 status=failed 不写盘 / 回滚再失败时 recovery_required 路径 affectedFiles 字段正确

## 12. ClaudeCodeAdapter（首批真实 Adapter）(Week 6-7)

- [ ] 12.1 在 `packages/adapters/claude-code` 写 manifest（structured / 全能力 true / immediate injection）— refs: adapter-framework/AgentAdapterManifest（能力声明）
- [ ] 12.2 实现 detect（找 claude binary）— refs: adapter-framework/Adapter 注册到 Manager
- [ ] 12.3 实现 createSession（spawn 子进程，绑 worktree）— refs: adapter-framework/子进程隔离与 Crash Tombstone, security/子进程隔离
- [ ] 12.4 实现 startRun stream，hook 事件 → AdapterEvent 映射 — refs: adapter-framework/ClaudeCodeAdapter 事件映射
- [ ] 12.5 实现 PreToolUse → permission.requested + tool.call.requested — refs: adapter-framework/ClaudeCodeAdapter 事件映射/PreToolUse 触发审批
- [ ] 12.6 实现 PostToolUse / FileChanged → file.changed / artifact.diff.created — refs: adapter-framework/ClaudeCodeAdapter 事件映射
- [ ] 12.7 实现 PreCompact → context.snapshot → ContextItem.summary draft — refs: adapter-framework/ClaudeCodeAdapter 事件映射/PreCompact 生成 summary, context-ledger/长会话压缩 → ContextItem.summary
- [ ] 12.8 实现 SubagentStart/Stop → subagent.* — refs: adapter-framework/ClaudeCodeAdapter 事件映射
- [ ] 12.9 实现 injectContext 通过 hook 立即注入 — refs: context-ledger/注入三档与 UI 透明
- [ ] 12.10 实现 cancel + dispose
- [ ] 12.11 集成测试（用真实 claude）：单 Run 含 tool / 触发 ask 后 allow / Diff 成功 apply / cancel 中断

## 13. Post-MVP Adapter Stub (Week 7)

- [ ] 13.1 OpenCodeAdapter stub（detect 返回 [] / startRun 抛 AdapterNotImplemented；目标启用阶段 V0.5）— refs: adapter-framework/Post-MVP Adapter Stub（接口存在但 detect 返回空）
- [ ] 13.2 CodexAdapter stub（目标启用阶段 V1.x）
- [ ] 13.3 LangGraphAdapter stub（目标启用阶段 V1.3，依赖 plugin-system 隔离基座）
- [ ] 13.4 A2AAdapter stub（目标启用阶段 V1.3，与 a2a-client 一起做）
- [ ] 13.5 测试：试图启动这些 adapter 的 run 返回 501

## 14. Web UI (Week 5-8 与后端并行)

- [ ] 14.1 在 `apps/web` 装 Vite + React + TS + TanStack Virtual + Monaco + Shiki — refs: design 1.5
- [ ] 14.2 实现三栏布局 + 折叠 — refs: web-ui/三栏布局
- [ ] 14.3 实现 SSE 客户端（EventSource）+ Last-Event-ID + 指数退避 — refs: web-ui/错误与重连
- [ ] 14.4 实现 Projector（订阅 SSE → 派发到 view model）— refs: web-ui/客户端 Projector, event-system/客户端 Projector
- [ ] 14.5 实现 RoomViewModel + 多组件订阅 — refs: web-ui/客户端 Projector
- [ ] 14.6 实现消息流虚拟化（10k 消息流畅）— refs: web-ui/消息流虚拟化
- [ ] 14.7 实现 delta 累积 + 60fps batch — refs: web-ui/Delta 累积与渲染节流
- [ ] 14.8 实现 6 个 Card 组件 — refs: web-ui/Card 组件清单
- [ ] 14.9 实现 DiffCard + Monaco Diff 全屏 + 应用流程（嵌入 PermissionCard）— refs: web-ui/应用 Diff 的 UI 流程
- [ ] 14.10 实现 PermissionCard + InterventionCard 多 tab 同步 — refs: web-ui/Card 组件清单/PermissionCard 多 tab 同步
- [ ] 14.11 实现 ContextCard confirm/discard
- [ ] 14.12 实现输入框（@ 补全 / drag-drop / 引用 / markdown 预览）— refs: web-ui/输入框
- [ ] 14.13 实现 Side Panel 4 视图（Context / Tasks / Members / Debug）— refs: web-ui/Side Panel 视图
- [ ] 14.14 实现房间列表 + 未读 badge — refs: web-ui/房间切换与未读提示
- [ ] 14.15 实现重连 banner + 离线只读
- [ ] 14.16 写 Storybook（Card 组件 + Mock 联动）— refs: web-ui/测试基础设施
- [ ] 14.17 写 Playwright E2E：golden path（新建 Room → 发消息 → DiffCard → apply）— refs: web-ui/测试基础设施

## 15. Observability / Debug Panel v0 (Week 8)

- [ ] 15.1 在 `packages/observability` 实现 pino logger + traceId 注入辅助 — refs: observability/pino 结构化日志, observability/traceId / causationId / correlationId 注入
- [ ] 15.2 实现 adapter raw stream 落 `~/.agenthub/logs/sessions/<id>.log` — refs: observability/Adapter raw stream 持久化
- [ ] 15.3 实现 `/debug/events` 检索 API（traceId / runId / type 过滤）— refs: observability/events 检索 API
- [ ] 15.4 实现 `/debug/sessions/:id/log` — refs: observability/Adapter raw stream 持久化
- [ ] 15.5 实现 Debug Panel v0 UI（Timeline / Trace / Run Replay / Adapter Raw）— refs: observability/Debug Panel v0
- [ ] 15.6 实现 cost 字段写 `runs` 表 — refs: observability/Cost 字段记录（不聚合）
- [ ] 15.7 cost 聚合 API 返回 501 — refs: observability/Cost 字段记录（不聚合）
- [ ] 15.8 集成测试：traceId 串完整链路 / failed run 可下载

## 16. Security 闭环 (Week 8-9)

- [ ] 16.1 实现 OS keychain bridge（windows-credential-locker / macos-keychain / libsecret）— refs: security/API key / 密钥存 OS keychain
- [ ] 16.2 实现 token issue / list / revoke CLI 与 API — refs: security/Token 协议
- [ ] 16.3 实现 token 中间件 + query token fallback — refs: security/Token 协议, v1-roadmap/V1.4 响应式 Web 占位（responsive-web）
- [ ] 16.4 实现工作区路径 canonicalize + symlink 检测 — refs: security/工作区路径校验
- [ ] 16.5 实现 prompt injection 防护（external_content 包裹 + Permission 不提升）— refs: security/Prompt Injection 防护
- [ ] 16.6 实现 spawn filterSafeEnv（不透传 secrets）— refs: security/子进程隔离
- [ ] 16.7 实现 config.toml 文件权限警告（POSIX）— refs: security/配置文件权限校验
- [ ] 16.8 实现 audit 关键操作（token / permission / intervention / sensitive deny / settings change）— refs: security/Audit 边界
- [ ] 16.9 实现 CSRF / Origin / Host 防护中间件：mutating route 校验 Origin（白名单含 127.0.0.1/localhost/tauri/dev port）+ Host + Content-Type=application/json + Session+CSRF 双 token（POST /auth/session bootstrap：返回 HttpOnly+SameSite=Strict 的 `agenthub_session` cookie + body `{ csrfToken }`；后续 **mutating** 请求 cookie + `X-Agenthub-CSRF` header 服务端比对一致）；**GET（含 SSE `/event`）仅校验 cookie + Origin/Host，不要求 CSRF header**（原生 EventSource 不支持自定义 header）；`POST /auth/session` 是 bootstrap 豁免，不要求已有 cookie/CSRF 但仍需 Origin 白名单 + Content-Type；Bearer 路径不豁免 Origin 校验 — refs: security/浏览器 CSRF / Origin / Host 防护
- [ ] 16.10 实现 SecretRedactor：默认正则集（bearer/anthropic/openai/github/aws/jwt/agenthub/env-secret/url-userinfo）+ 用户自定义 + keychain 已知密钥字面量；fail-closed 异常路径；接到 pino sink / adapter raw log writer / SSE writer / API error response writer / `events.payload` sensitive 字段 — refs: security/SecretRedactor 日志脱敏, observability/Adapter raw stream 持久化
- [ ] 16.9 安全测试：试图读 .env / 试图通过 .. 越界 / 试图 file:// + symlink 越界 / 恶意 prompt injection

## 17. V1 接口预留 (Week 9)

- [ ] 17.1 实现 NoopVectorIndex / VectorIndex 接口 — refs: v1-roadmap/V1.2 向量检索占位（vector-search）
- [ ] 17.2 实现 NoopMemoryAdapter / MemoryAdapter / HybridMemoryRouter 接口 — refs: v1-roadmap/V1.2 Memory Gateway 占位（memory-gateway）
- [ ] 17.3 stub 返回 501 的能力清单（按 v1-roadmap 阶段）：
  - V0.5：`opencode-adapter`（adapter_not_found）/ `cost-panel-local`
  - V1.0：`squad-mode` / `team-mode` / `deployment-static-zip`
  - V1.1：`task-board`（/board 404）/ `collab-visualization`（/timeline 404）
  - V1.2：`skill-system`（loader 拒绝）/ `bm25-recall` / `memory-gateway`（room.search_memory tool_not_found）
  - V1.3：`plugin-system`（loader 拒绝）/ `langgraph-adapter`（adapter_not_found）/ `a2a-server` + `a2a-client`
  - V1.4：`desktop-shell-tauri`（--ipc-fd flag 占位）/ `responsive-web`（query token fallback 已在 4.8）/ `deployment-docker`
  - V1.5：`war-room-mode` / `permission-dsl`（rule.expr 拒绝加载）
  refs: v1-roadmap/各阶段 Requirement
- [ ] 17.4 SystemBridge 接口 + BrowserSystemBridge 实现 — refs: v1-roadmap/V1.4 桌面壳占位（desktop-shell-tauri）
- [ ] 17.5 验证清单：MVP 测试后续阶段接入不破内核（mock 一个 SqliteVecIndex 做 e2e）— refs: v1-roadmap/后续阶段接入清单（验收）

## 18. 收尾 / 文档 / 演示 (Week 9-10)

- [ ] 18.1 写 README（quick start: install / start daemon / open web）
- [ ] 18.2 写 docs/ARCHITECTURE.md（基于 design.md 简化）
- [ ] 18.3 写 docs/SECURITY.md（D16 + security capability 总结）
- [ ] 18.4 写 docs/AGENT_PROFILES.md（markdown 配置说明）
- [ ] 18.5 写 docs/PERMISSION_PROFILES.md
- [ ] 18.6 性能基线测试：1000 消息渲染 / 100k 事件流 / SSE 50 客户端
- [ ] 18.7 端到端 E2E：Solo + Assisted 模式 demo 视频
- [ ] 18.8 跑 `openspec validate add-agenthub-mvp --strict`，全部 spec 通过
- [ ] 18.9 修复 [DECISION-NEEDED] 的最终用户裁决（与 design.md Open Questions 表对齐）
- [ ] 18.10 准备 V0.5 plan：`OpenCodeAdapter`（第二真实 adapter）/ Run Detail 7 tab 完整化 / 聊天室体验打磨（mailbox / pending_turn / @mention / 主流摘要 / Observer 敲门 / PTY 输出展示）/ 单机 Cost 面板。**不**包括 Codex（V1.x）/ 向量检索（V1.2）/ Memory（V1.2）。

## 19. 产品化收口（参考实现 P1+P2+P3 落地）

### 19.1 ACPAdapter 统一基类（D25）

- [ ] 19.1.1 在 `packages/adapters/acp-base` 实现 `ACPAdapter` 基类：state machine（disconnected/connecting/initializing/ready/prompting/cancelling/failed/disposed）+ NDJSON line-splitter buffer + `pendingRequests: Map<requestId, AcpPendingRequest>` + `inflightPromptRequestId` + clientCapabilities 声明 — refs: adapter-framework/ACPAdapter 会话状态机与 JSON-RPC pending 表
- [ ] 19.1.2 实现 `session/cancel` 协作式取消：仅 reject inflight prompt 对应 entry，**不**清空 fs.* / permission 等非 prompt pending — refs: adapter-framework/ACPAdapter 会话状态机与 JSON-RPC pending 表
- [ ] 19.1.3 实现 `dispose(sessionId)` 流程：先发 `session/end` → 5s 优雅 → 5s SIGTERM → SIGKILL；pending 全 reject `session_disposed` — refs: adapter-framework/ACPAdapter 会话状态机与 JSON-RPC pending 表
- [ ] 19.1.4 prompt 默认串行：第二次 prompt in-flight 返回 `AdapterError(code="prompt_in_flight")`；manifest 可声明 `acp.concurrentPrompt=true` — refs: adapter-framework/ACPAdapter 会话状态机与 JSON-RPC pending 表
- [ ] 19.1.5 派生 ClaudeCodeACPAdapter / CodexACPAdapter / OpenCodeACPAdapter，仅覆盖 `spawnArgs()` / `detect()` / `mapProviderEvent()` / `mapProviderError()`，状态机与 pending 表共享 — refs: adapter-framework/ACPAdapter 会话状态机与 JSON-RPC pending 表

### 19.2 ArtifactFS Shadow Write + Run-Level Diff（D24）

- [ ] 19.2.1 在 `packages/artifacts` 实现 `ArtifactFS` 接口（read/write/delete/list/buildRunArtifact）+ 两种 mode（isolated_worktree、shadow_buffer）— refs: artifacts/ArtifactFS Shadow Write 与 Run-Level Diff
- [ ] 19.2.2 isolated_worktree 实现：用 `simple-git` 创建 `<userhome>/.agenthub/worktrees/<runId>/`；adapter cwd 设为 worktree；`buildRunArtifact` 用 `git diff --name-status` + 内容对比 — refs: artifacts/ArtifactFS Shadow Write 与 Run-Level Diff
- [ ] 19.2.3 shadow_buffer 实现：内存 Map<path, content> + 启动时按 targetFiles sha256 快照；read 优先查 shadow 再回落真实 workspace — refs: artifacts/ArtifactFS Shadow Write 与 Run-Level Diff
- [ ] 19.2.4 把 ACPAdapter clientCapabilities `fs.readTextFile` / `fs.writeTextFile` 路由到 ArtifactFS；MUST NOT 直写真实 workspace — refs: artifacts/ArtifactFS Shadow Write 与 Run-Level Diff, adapter-framework/ACPAdapter 会话状态机与 JSON-RPC pending 表
- [ ] 19.2.5 把 MCP Write / MultiEdit tool 在 tool layer 拦截转 ArtifactFS — refs: artifacts/ArtifactFS Shadow Write 与 Run-Level Diff
- [ ] 19.2.6 Run 终结（completed/failed/cancelled，凡有 shadow 写入）调 `buildRunArtifact()` 创建 `Artifact{type='diff', status='draft'}` — refs: artifacts/ArtifactFS Shadow Write 与 Run-Level Diff
- [ ] 19.2.7 敏感文件白名单仍立即拦截：ArtifactFS.write 命中 → 不写 shadow / 不写真实 workspace + 同事务 emit `permission.resolved decision=deny reason=sensitive_pattern_match requested=false`，即便在 ArtifactFS 内 — refs: artifacts/ArtifactFS Shadow Write 与 Run-Level Diff, security/敏感文件白名单 deny
- [ ] 19.2.8 集成测试：单 Run 写 4 文件 + 跑测试 + 回滚 1 文件 + 重写 → 最终 DiffArtifact 含正确 4 文件 diff
- [ ] 19.2.9 集成测试：失败 Run 仍生成 DiffArtifact（status=draft）供用户审查或丢弃

### 19.3 observe 被动语义 + WakeAgent 单一入口（D23）

- [ ] 19.3.1 在 `packages/orchestrator` 定义 `WakeAgent` Command + `WakeReason` 枚举（user_mention/delegated_task/rule_review/knock_approved/group_review/phase_completed/agent_crashed）— refs: orchestrator/Observing 是被动状态 + WakeAgent
- [ ] 19.3.2 改 rule engine：rule action MUST 是 `wake`；非 wake 类 rule 注册失败 + audit log — refs: orchestrator/Observing 是被动状态 + WakeAgent
- [ ] 19.3.3 引入 `StageBoundary` 枚举（plan.completed / run.completed / artifact.diff.created / tests.failed / user.review_requested）；rule 只能绑定到 StageBoundary — refs: orchestrator/Observing 是被动状态 + WakeAgent
- [ ] 19.3.4 实现 `AgentPromptDelta`（first_wake 完整 role / delta_only 后续）+ 在 PromptAssembly 检查"是否第一次 wake"决定 kind — refs: orchestrator/Observing 是被动状态 + WakeAgent
- [ ] 19.3.5 把 `runs.wake_reason` 字段写入；Run Detail 可展示 — refs: agents/Run 状态机扩展（claimed / sessionId 持久化 / wake_reason）
- [ ] 19.3.6 单元测试：100 条 message 流过 observer agent，LLM 调用次数 = 0（用 spy）— refs: orchestrator/Observing 是被动状态 + WakeAgent

### 19.4 Run claimed/dispatched + sessionId 持久化 + 失败分类（D26）

- [ ] 19.4.1 `runs` 表 schema 迁移：增加 `workspace_id (NOT NULL) / wake_reason / work_dir / workspace_mode / provider_conversation_id / claimed_at / failure_class / parent_run_id / target_files (JSON) / mailbox_claim_count (DEFAULT 0) / pid_at_start` 列 + `idx_runs_workspace_status` 索引 — refs: agents/Run 状态机扩展（claimed / sessionId 持久化 / wake_reason）
- [ ] 19.4.2 在 RunQueue Worker 拿锁后事务 1 INSERT run_locks，再调 `RunLifecycleService.markClaimed(null, runId)`（事务 2，UPDATE runs.status='claimed' + claimed_at），再调 `RunLifecycleService.markStarting(null, runId, pid)`（事务 3，UPDATE runs.status='starting' + pid_at_start + emit `agent.run.started`）；Worker 不裸写 runs 表 — refs: agents/Run 状态机扩展（claimed / sessionId 持久化 / wake_reason）, bus-runtime/RunQueue 是 bus 的一条命名队列
- [ ] 19.4.3 RunLifecycleService 增加 `updateSessionState(tx, runId, patch)` 方法（首参 tx；仅 UPDATE runs，不发 durable event）— refs: bus-runtime/RunLifecycleService.updateSessionState（非事件方法）
- [ ] 19.4.4 AdapterBridge 在 `session.opened` 时按 **canonical 两步顺序、独立事务** 推进：tx1 `updateSessionState(null, runId, { adapterSessionId, workDir })` 先持久化；tx2 `markRunning(null, runId, adapterSessionId)` 推进状态。两步独立事务的目的是让 ReclaimStaleClaimedRun 在 daemon 于 tx1 commit 后、tx2 之前崩溃时可通过 `status='starting' AND adapter_session_id IS NOT NULL AND pid_at_start != current pid` 命中并 attach；providerConversationId 变化时单步 `updateSessionState(null, runId, { providerConversationId })` 即可 — refs: agents/SessionId / WorkDir 中途持久化, bus-runtime/ReclaimStaleClaimedRun 后台任务
- [ ] 19.4.5 实现 `ReclaimStaleClaimedRun` 后台任务：daemon 启动时 + 每 60s；扫描候选三类（claimed 超时 / starting + sessionId IS NULL / status IN (starting,running,waiting_permission) AND sessionId IS NOT NULL AND pid_at_start != current pid）；按 `manifest.reliability.crashRecovery` + run.status 决定 attach / restart / fail（attach 成功后 starting → markRunning + updateSessionState；running / waiting_permission → 仅 updateSessionState） — refs: bus-runtime/ReclaimStaleClaimedRun 后台任务
- [ ] 19.4.6 `FailureClass` 枚举（transient / retryable_visible / fresh_session_required / permission_denied / user_cancelled / configuration / fatal）；`RunLifecycleService.fail(null, runId, reason, failureClass, error?)` 必填 failureClass — refs: agents/Run 失败分类 + 与 Handler 重试隔离
- [ ] 19.4.7 transient + 无 visible output 自动 1 次重试（指数退避 5s）；其它分类不静默重试，UI 提供"重试"按钮 — refs: agents/Run 失败分类 + 与 Handler 重试隔离
- [ ] 19.4.8 poisoned session 检测（iteration_limit / context_overflow / api_invalid_request 连续两次相同 fingerprint / 5 分钟无输出）→ failureClass='fresh_session_required'，下次重试强制新 session — refs: agents/Run 失败分类 + 与 Handler 重试隔离
- [ ] 19.4.9 Run reuse 策略：manifest 声明 `always_fresh / reuse_per_room_agent / reuse_per_workspace`；reuse 时 RunLifecycleService.create 接受 `parentRunId?` — refs: agents/SessionId / WorkDir 中途持久化
- [ ] 19.4.10 集成测试：daemon kill -9 → 重启 → 扫到 stuck `claimed` run → 按 crashRecovery 路径恢复

### 19.5 Permission per-session 队列 + 幂等 + Timeout Pause（D27）

- [ ] 19.5.1 PermissionEngine 增加 `Map<adapterSessionId, Queue<PermissionRequest>>` 结构 + manifest `concurrentPermission` 开关 — refs: permissions/Per-session 串行化、幂等键、Prompt Timeout Pause
- [ ] 19.5.2 `permission_requests` 表迁移：增加 `idempotency_key / adapter_session_id` 列 + UNIQUE pending index — refs: permissions/Per-session 串行化、幂等键、Prompt Timeout Pause
- [ ] 19.5.3 入站新 PermissionRequest：先按 idempotencyKey 查 pending；命中返回已有 request、不覆盖原 Deferred — refs: permissions/Per-session 串行化、幂等键、Prompt Timeout Pause
- [ ] 19.5.4 5 秒内 retry 同 idempotencyKey 已 allowed → short-circuit allow + audit — refs: permissions/Per-session 串行化、幂等键、Prompt Timeout Pause
- [ ] 19.5.5 在 ACPAdapter 暴露 `pausePromptTimeout(sessionId)` / `resumePromptTimeout(sessionId)`；AdapterBridge 在 `permission.requested` / `permission.resolved` 时联动 — refs: permissions/Per-session 串行化、幂等键、Prompt Timeout Pause
- [ ] 19.5.6 maxPermissionWait（默认 600s）超出强 deny `expired_max_wait` — refs: permissions/Per-session 串行化、幂等键、Prompt Timeout Pause

### 19.6 主流摘要 / Run Detail 双投影 + PendingTurn（D28）

- [ ] 19.6.1 `events` 表 schema 迁移：增加 `visibility` 列 NOT NULL DEFAULT 'both' + `idx_events_room_visibility` 索引 — refs: messaging/主流摘要 / Agent Run Detail 双投影
- [ ] 19.6.2 给每个 durable event 类型显式标 visibility（main / detail / both）；CI 校验 schema 中无未标字段 — refs: messaging/主流摘要 / Agent Run Detail 双投影
- [ ] 19.6.3 SSE handler 接受 `?view=main|detail|raw` query；按 visibility 子集推送 — refs: messaging/主流摘要 / Agent Run Detail 双投影
- [ ] 19.6.4 新增事件 `message.brief.published`（durable, visibility=main）；AdapterBridge / Orchestrator 在 run started / completed / failed / cancelled / phase_completed 时显式发 — refs: messaging/主流摘要 / Agent Run Detail 双投影
- [ ] 19.6.5 ContextAssembly 在 Run 终结时同步生成 brief summary（取 final assistant 第一句 + Artifact 统计）— refs: messaging/主流摘要 / Agent Run Detail 双投影
- [ ] 19.6.6 实现 `pending_turns` 表 + `PendingTurn` 类型；POST `/rooms/:id/messages` 在 primary busy 时仍 201 + 创建 PendingTurn `status='queued'` + emit `pending_turn.created`(visibility=main) — refs: messaging/用户 Turn 排队
- [ ] 19.6.7 Orchestrator terminal hook `agent.run.completed/failed/cancelled` 三步顺序：① presence 更新 ② 查 unconsumed run_next_turns 命中即派发 WakeAgent(carryNextTurnIds, sourceRunId) **优先于** PendingTurn ③ 否则按 enqueuedAt 升序对该 (room, primary) 待消费 PendingTurn 派发 `ConsumePendingTurn(pendingTurnId)`（origin='internal'）；handler 在事务内 UPDATE pending_turns.status='scheduled' + emit `pending_turn.scheduled` + 内部 dispatch `WakeAgent { reason: 'consume_pending_turn', ... }`；WakeAgent handler 完成 RunLifecycleService.create 后 UPDATE pending_turns.status='consumed' + emit `pending_turn.consumed` — refs: messaging/用户 Turn 排队, orchestrator/run_next_turns 表, bus-runtime/订阅图谱（单一真相）
- [ ] 19.6.8 实现 DELETE `/pending-turns/:id` + PATCH `/messages/:id`（编辑等价 cancel + new POST）— refs: messaging/用户 Turn 排队
- [ ] 19.6.9 单 room queued 数 ≤ 20，超出 429 — refs: messaging/用户 Turn 排队
- [ ] 19.6.10 Web UI Main Timeline 不订阅 message.part.delta（默认）；点击 brief 打开 Run Detail slide-over，URL 加 `?run=<id>`，建立 `view=detail` SSE — refs: web-ui/Main Timeline 与 Agent Run Detail 双视图
- [ ] 19.6.11 Run Detail 7 tab：Transcript / Tools / Context / Permissions / Artifacts / Raw Stream / Cost — refs: web-ui/Main Timeline 与 Agent Run Detail 双视图
- [ ] 19.6.12 输入框 primary busy 不阻止发送 + "⏳ 排队中（位置 N）"徽章 + sessionStorage 草稿 + 取消 / 编辑按钮 — refs: web-ui/Pending Turn 与排队 UI

### 19.7 Bus / 内部 PubSub Bounded（D29）

- [ ] 19.7.1 在 `packages/bus` 实现 per-channel bounded PubSub：durable 4096 back-pressure / message.delta 1024 drop_oldest+coalesce / tool.update 512 drop_oldest / status_line 64 / adapter.raw 256 独立通道 / system.notice 128 — refs: bus-runtime/内部 PubSub Bounded + 优先级丢弃
- [ ] 19.7.2 配置 `[bus.pubsub] capacity.<channel>` 启动校验：durable ≥ 1024、ephemeral ≥ 64，否则 refuse start — refs: bus-runtime/内部 PubSub Bounded + 优先级丢弃
- [ ] 19.7.3 drop 计数 + 高水位写入 `/debug/stats`（PubSubChannelStats[]）— refs: bus-runtime/内部 PubSub Bounded + 优先级丢弃
- [ ] 19.7.4 raw 通道暴涨不影响 message.delta 测试（infinite loop print + 验证 delta 通道 drop=0）

### 19.8 Adapter Liveness 与 SSE 心跳分离（D29）

- [ ] 19.8.1 在 AdapterManager 维护 `Map<adapterId, AdapterHealth>`；状态枚举 available / starting / ready / busy / blocked / crashed / offline — refs: adapter-framework/Adapter Liveness 状态与心跳分离
- [ ] 19.8.2 每 3s ping 子进程（ACPAdapter 用 `protocol/ping`）；连续 5 次 miss → crashed → 按 manifest 重启 — refs: adapter-framework/Adapter Liveness 状态与心跳分离
- [ ] 19.8.3 emit `adapter.liveness.changed` durable 事件；`/healthz` 分别返回 adapter ping + SSE heartbeat 状态 — refs: adapter-framework/Adapter Liveness 状态与心跳分离

### 19.9 Adapter 事件去重 + Shell 哈希节流（D29）

- [ ] 19.9.1 AdapterBridge 维护 `(adapterSessionId, toolCallId, phase)` dedupe set；duplicate 丢弃 + debug log — refs: adapter-framework/Adapter 事件去重 + Shell 哈希节流 + Raw Output 分流
- [ ] 19.9.2 raw.stdout/stderr/tool.update.stdout 按 sha256(line) LRU(256) 节流；命中 drop + 计数；100 次 drop emit 一条 `handler.stalled` — refs: adapter-framework/Adapter 事件去重 + Shell 哈希节流 + Raw Output 分流
- [ ] 19.9.3 单 line ≤ 8 KB（截断 + redactor 先于截断）；ephemeral payload "line/chunk" ≤ 8 KB；durable raw 字段 ≤ 1 KB — refs: adapter-framework/Adapter 事件去重 + Shell 哈希节流 + Raw Output 分流
- [ ] 19.9.4 单 tool 累计 stdout > 256 KB 转 log + emit `tool.update.diverted` — refs: adapter-framework/Adapter 事件去重 + Shell 哈希节流 + Raw Output 分流

### 19.10 跨平台 CLI 探测 + provider-specific spawn（D25）

- [ ] 19.10.1 macOS/Linux 探测：先 `bash -lc 'command -v <bin>'` / `zsh -lc`，fallback 到 process.env.PATH — refs: adapter-framework/跨平台 CLI 探测与 Provider-specific Spawn
- [ ] 19.10.2 Windows 探测：先 `where <bin>`；fallback `Get-Command`；spawn 时 args 数组形式不拼字符串 — refs: adapter-framework/跨平台 CLI 探测与 Provider-specific Spawn
- [ ] 19.10.3 NPX 路径：校验 node ≥ provider minVersion；优先 `npx --yes -p <pkg>@<ver> -c "<bin>"`；NPM_CONFIG_CACHE 设到 `<userhome>/.agenthub/npm-cache` — refs: adapter-framework/跨平台 CLI 探测与 Provider-specific Spawn
- [ ] 19.10.4 `--version` 校验 + AdapterDiscoveryErrorCode 分类（not_found / node_missing / version_mismatch / spawn_failed / handshake_timeout / auth_required）— refs: adapter-framework/跨平台 CLI 探测与 Provider-specific Spawn
- [ ] 19.10.5 子进程 detached=false + Windows `taskkill /T /F` + Unix `process.kill(-pid, 'SIGTERM')` 进程树兜底 — refs: adapter-framework/跨平台 CLI 探测与 Provider-specific Spawn

### 19.11 Worktree 选择 + GC（D29）

- [ ] 19.11.1 实现 workspace mode 选择优先级：`WakeAgent.workspaceMode`（透传到 `RunLifecycleService.create` 入参）> AgentProfile > AdapterManifest > config 默认 > worktree/shadow_buffer — refs: local-daemon/Worktree 选择策略与 GC 安全约束
- [ ] 19.11.2 GC 后台任务：daemon 启动 + 每 1h；扫 `<userhome>/.agenthub/{worktrees,runs}/`；不扫真实 workspace — refs: local-daemon/Worktree 选择策略与 GC 安全约束
- [ ] 19.11.3 删除前必须满足：runId 合法 ULID + status terminal + retentionDays 已过 + 无 in-flight artifact；解析符号链接落到管理根之外 → 跳过 + emit `worktree.gc.skipped` — refs: local-daemon/Worktree 选择策略与 GC 安全约束
- [ ] 19.11.4 worktree 模式必须 `git worktree remove --force` 而非 rm -rf；isolated_copy 检查目录顶层无 `.git` 与 `.agenthub-real-workspace` 标记 — refs: local-daemon/Worktree 选择策略与 GC 安全约束
- [ ] 19.11.5 maxTotalSizeGb=20 LRU 强制清理 + 仍超限 emit `handler.stalled` — refs: local-daemon/Worktree 选择策略与 GC 安全约束

### 19.12 Mailbox 原子认领 + activeWakes + run_next_turns（D23）

- [ ] 19.12.1 `mailbox_messages` 表迁移：`claimed_run_id / claimed_at` 列 + 新索引；`claimed_run_id` MUST NOT 建全局 UNIQUE（同一 run 可 claim 多行）— refs: orchestrator/Mailbox 原子认领 + activeWakes 防重入
- [ ] 19.12.2 WakeAgent handler IMMEDIATE 事务：① in-process activeWakes guard（try/finally）② DB 二次校验 `runRepo.findActive(tx, room, agent)` ③ `mailboxService.claimUnread(tx, ...)` ④ 零输入判断 `hasInput = mailbox 非空 || hasMeaningfulPromptDelta || messageId || pendingTurnId || carryNextTurnIds 非空`，零输入 audit `wake_rejected_zero_input` ⑤ 调 `runLifecycleService.create(tx, input)` 让 service 在同事务内 INSERT runs(queued) + INSERT events(agent.run.queued) + outbox；若 carryNextTurnIds 非空 service 同事务**防御性 rebind**（`UPDATE run_next_turns SET run_id=newRunId, consumed_at=NULL WHERE id IN (carryNextTurnIds) AND room_id=:roomId AND agent_id=:agentId AND run_id=:sourceRunId AND consumed_at IS NULL`；affected rows 必须等于 carryNextTurnIds.length，否则回滚 StaleOrInvalidNextTurnIds）；handler 不裸写 runs/events 表 — refs: orchestrator/Mailbox 原子认领 + activeWakes 防重入, orchestrator/run_next_turns 表, bus-runtime/RunLifecycleService 是 runs 表的唯一写入口
- [ ] 19.12.3 单次 wake claim 上限 20 — refs: orchestrator/Mailbox 原子认领 + activeWakes 防重入
- [ ] 19.12.4 ActiveWakes 进程内结构 + daemon 启动从 runs 非终结态重建 — refs: orchestrator/Mailbox 原子认领 + activeWakes 防重入
- [ ] 19.12.5 RunLifecycleService.complete/fail/cancelFinalized 钩子调 Orchestrator 释放 activeWake — refs: orchestrator/Mailbox 原子认领 + activeWakes 防重入
- [ ] 19.12.6 实现 `MailboxService.appendNextTurn(tx, runId, payload)` 唯一写入口；payload 至少含 promptDelta / messageId / pendingTurnId 之一，且必带 sourceReason / sourceIdempotencyKey；零输入返回 `{ appended: false }` 不 INSERT — refs: orchestrator/run_next_turns 表
- [ ] 19.12.7 实现 `room.read_mailbox` MCP tool 双源原子消费（0-5 步事务流）：① 幂等检查 `mailbox_deliveries WHERE delivery_batch_id=:batchId AND run_id=:runId`，命中直接返回 batch；② 读 mailbox（**`(read=0 AND claimed_run_id IS NULL) OR claimed_run_id=:runId`**，过滤 `delivery_batch_id IS NULL OR delivery_batch_id=:batchId`；MUST NOT 用 `read=0` 不加 `claimed_run_id IS NULL` 的宽泛条件，防止幽灵投递）；③ 标 mailbox `read=1, claimed_run_id, claimed_at, delivery_batch_id=:batchId`；**UPDATE affected rows 必须等于 SELECT 返回行数，不等回滚返回 MailboxDeliveryConflict**；④ 读 run_next_turns（`run_id=:runId AND consumed_at IS NULL`）；⑤ 标 next_turn `consumed_at=now()`；⑥ 写 `mailbox_deliveries`；runId 由 adapter session 上下文隐式注入；agent 不能伪造 runId；`deliveryBatchId` MUST stable for same logical retry（优先 ACP toolCallId，其次 MCP request id，最后才允许 bridge 生成 UUID）— refs: orchestrator/room.read_mailbox 双源原子消费
- [ ] 19.12.8 Orchestrator hook `agent.run.completed/failed/cancelled` 三步顺序：presence 更新 → 查 unconsumed run_next_turns 命中即派发 `WakeAgent({ carryNextTurnIds, sourceRunId=oldRunId, idempotencyKey=hash(oldRunId+ids) })` → 否则消费 PendingTurn；CI 集成测试覆盖 next_turn 优先于 pending_turn 的串行调度 — refs: bus-runtime/订阅图谱（单一真相）, orchestrator/run_next_turns 表
- [ ] 19.12.9 集成测试：① appendNextTurn 在 promptDelta 空但 pendingTurnId 非空时仍写入 ② run_A complete 后 carry 链路把 nt_1/nt_2 rebind 到 run_B（防御 SQL 含 sourceRunId），run_B 通过 read_mailbox 拉到 ③ fail transient 不动 next_turns、carry 链路接续 ④ fail permission_denied 标 next_turns consumed 不重投 ⑤ run_A complete 同时有 nt_5 与 pt_9，串行先 carry 再 consume ⑥ 同 deliveryBatchId 重试返回同 batch，新 deliveryBatchId 不返回旧 mailbox ⑦ transient fail 回滚 mailbox 清 delivery_batch_id，新 run read_mailbox 能读到 — refs: orchestrator/run_next_turns 表, orchestrator/room.read_mailbox 双源原子消费
- [ ] 19.12.10 failed transient/retryable_visible/fresh_session_required 回滚 mailbox claim（`read=0, claimed_run_id=NULL, claimed_at=NULL, delivery_batch_id=NULL`）；其它分类保持 read=1；通过 `RunLifecycleSideEffects.finalizeNextTurns(tx, runId, failureClass)` 注入接口完成 next_turn finalization（bus-runtime 不直接 import orchestrator）— refs: orchestrator/Mailbox 原子认领 + activeWakes 防重入, bus-runtime/RunLifecycleService 是 runs 表的唯一写入口

### 19.13 file:// / data: URI + Debug 授权（D29）

- [ ] 19.13.1 在 `packages/security` 实现 `resolveSafeUri(uri, ctx)`：file:// → resolveWorkspacePath；data: → MIME 白名单 + 1MB；http(s) 仅 daemon 自签 token URL — refs: security/file:// / data: URI 与附件路径安全
- [ ] 19.13.2 ACPAdapter `fs.readTextFile` / 附件 API / preview 路径统一调 `resolveSafeUri` — refs: security/file:// / data: URI 与附件路径安全
- [ ] 19.13.3 SVG 子集净化（DOMPurify SVG profile，移除 script / foreignObject）— refs: security/file:// / data: URI 与附件路径安全
- [ ] 19.13.4 API response / durable event payload / SSE 帧 不暴露绝对路径；Run Detail admin scope 才能取 work_dir — refs: security/file:// / data: URI 与附件路径安全
- [ ] 19.13.5 `AuthScope` 增加 `admin`；admin 自动包含 read+write；颁发 admin scope 时 UI 显式确认 — refs: security/Debug / Raw Log 授权边界
- [ ] 19.13.6 `/debug/sessions/:id/log` / `/debug/events` / SSE `view=raw` 授权矩阵实现：本地 + debug.enabled + read scope 通过；远程需 `[debug] allowRemote=true` + admin scope；workspace match 失败 404 — refs: security/Debug / Raw Log 授权边界

### 19.14 adapter.config.updated / agent.capabilities.updated 事件（D25 / D29）

- [ ] 19.14.1 在 event-system canonical registry 加 `adapter.config.updated`（durable, both）+ `agent.capabilities.updated`（durable, detail）— refs: adapter-framework/adapter.config.updated / agent.capabilities.updated 事件
- [ ] 19.14.2 ACP `protocol/configUpdated` notification → AdapterManager emit `adapter.config.updated` — refs: adapter-framework/adapter.config.updated / agent.capabilities.updated 事件
- [ ] 19.14.3 settings UI 切换 model / hot reload markdown / detect 重新发现 → 触发 emit — refs: adapter-framework/adapter.config.updated / agent.capabilities.updated 事件
- [ ] 19.14.4 派生 AgentProfile.capabilities 变化时 emit `agent.capabilities.updated`；UI banner 提示能力收缩 — refs: adapter-framework/adapter.config.updated / agent.capabilities.updated 事件

### 19.15 验收

- [ ] 19.15.1 跑 `openspec validate add-agenthub-mvp --strict` 通过
- [ ] 19.15.2 跑 19.x 全部 P1 / P2 / P3 集成测试
- [ ] 19.15.3 跑 observe 不烧 token 用例 + 多文件 run-level diff 用例 + adapter raw 暴涨不挤主流用例 + claimed reclaim 用例 + permission per-session 队列用例
- [ ] 19.15.4 在主流 + Run Detail 双视图下跑 golden path 验证
- [ ] 19.15.5 锁矩阵集成测试：① workspace 锁存在时 file 锁申请阻塞 ② file 锁存在时 workspace 锁申请阻塞 ③ 不同 workspace 间互不阻塞 ④ 同 workspace 内多个 file 锁可并行（lock_key 不同）⑤ targetFiles=undefined 自动退化为 workspace 锁 — refs: bus-runtime/RunQueue 是 bus 的一条命名队列

## 20. 一致性收口（Round-2 P1+P2 补丁）

### 20.1 WakeAgent 是 Run 创建唯一入口（D30）

- [ ] 20.1.1 在 `bus-runtime/CommandBus` 实现 `origin='http'` 拒绝 internal-only Command（WakeAgent / RetryRun / InjectContext / ConsumePendingTurn）；`StartRun` 与 `ApplyMailboxClaimRollback` 都不在 Command union 中（CI `command:check` 同时校验"无任何 dispatch type='StartRun' 或 type='ApplyMailboxClaimRollback'"）— refs: bus-runtime/Command 与 Event 显式分离
- [ ] 20.1.2 实现 `WakeAgent` Command handler：activeWakes guard（try/finally；release 在 createdRunId 为 null 时执行，bindToRun 在创建成功后执行）+ IMMEDIATE 事务（runRepo.findActive DB 二次校验 → mailboxService.claimUnread(tx) → 零输入判断 → runLifecycleService.create(tx, input)）；handler **不**裸写 INSERT_RUN / INSERT_EVENT / INSERT_OUTBOX；零输入定义（正向）= `hasInput = claimedIds.length > 0 || hasMeaningfulPromptDelta(promptDelta) || !!messageId || !!pendingTurnId || (carryNextTurnIds?.length ?? 0) > 0`；hasInput=false 时 audit `wake_rejected_zero_input` 并放弃创建 — refs: orchestrator/Solo 模式调度, orchestrator/Mailbox 原子认领, bus-runtime/RunLifecycleService 是 runs 表的唯一写入口
- [ ] 20.1.3 改 Orchestrator `message.created` handler：仅在 `turn_dispatch_mode='immediate'` 时 dispatch WakeAgent；pending → 不动 — refs: orchestrator/Solo 模式调度, messaging/用户 Turn 排队
- [ ] 20.1.4 实现 `ConsumePendingTurn` Command handler：UPDATE pending_turns.status='scheduled' + emit pending_turn.scheduled + 内部 dispatch WakeAgent(reason='consume_pending_turn')；完成后 UPDATE consumed + emit pending_turn.consumed — refs: messaging/用户 Turn 排队
- [ ] 20.1.5 集成测试：busy 时连发 5 条 user message，全部 PendingTurn `queued`；run_1 终结后按顺序 consume，调用 LLM 5 次仅由 WakeAgent 触发，无第二条调度路径

### 20.2 RunLifecycleService 接口补齐（D26 + D30）

- [ ] 20.2.1 实现 `markClaimed(tx, runId)` / `markWaitingPermission(tx, runId, permissionId)` / `updateSessionState(tx, runId, patch)` 方法；所有 mutation 方法首参 `tx: SqliteTx | null` — refs: bus-runtime/RunLifecycleService 是 runs 表的唯一写入口
- [ ] 20.2.2 状态机校验：`markClaimed` 接受 `queued | waiting → claimed`；`markStarting` 仅接受 `claimed → starting`；`markRunning` 接受 `starting → running` 与 `waiting_permission → running`（后者同事务 emit `agent.run.resumed`）；`fail` 接受所有非终结状态进入 — refs: bus-runtime/RunLifecycleService 是 runs 表的唯一写入口
- [ ] 20.2.3 改 `fail(tx, runId, reason, failureClass, error?)` 签名 + 强制 `failureClass` 必填；运行时校验枚举；TS 编译期参数必填；`fail` 在事务内按 failureClass UPDATE mailbox 回滚 claim（取代旧 ApplyMailboxClaimRollback Command） — refs: agents/Run 失败分类 + 与 Handler 重试隔离
- [ ] 20.2.4 改 RunQueue Worker 不再直写 runs.status='claimed'；改走 `markClaimed(null, ...) → markStarting(null, ..., pid)` 两次事务调用 — refs: bus-runtime/RunQueue 是 bus 的一条命名队列, agents/Run 状态机扩展（claimed / sessionId 持久化 / wake_reason）
- [ ] 20.2.5 改 ReclaimStaleClaimedRun / claim_aborted / lock_timeout / daemon_restarted 等所有 fail 调用补 failureClass；ReclaimStaleClaimedRun resumable 决策按 status 分支：`starting+sessionId` → `markRunning + updateSessionState(pidAtStart)`；`running` → 仅 `updateSessionState(pidAtStart)`；`waiting_permission` → 仅 `updateSessionState(pidAtStart)`，绝不调 markRunning（避免 IllegalTransition） — refs: bus-runtime/ReclaimStaleClaimedRun 后台任务, agents/Run 状态机扩展（claimed / sessionId 持久化 / wake_reason）

### 20.3 event-system 同步（D31）

- [ ] 20.3.1 events 表迁移：增加 `visibility` 列 NOT NULL + `idx_events_room_visibility` 索引（messaging 不再持有此 ALTER）— refs: event-system/events 表 Schema
- [ ] 20.3.2 EventEnvelope 类型增加 `visibility` 一等字段；publisher 在 publish 时 MUST 不传 visibility（runtime 从 registry 反查）— refs: event-system/事件 Envelope 强制版本化, event-system/事件 visibility 字段
- [ ] 20.3.3 在 `packages/protocol` 实现 EventVisibilityResolver（type → visibility 查表 + 防覆盖）；EventBus 在 publish 时调用 — refs: event-system/事件 visibility 字段
- [ ] 20.3.4 SSE handler 实现 `?view=main|detail|raw` 路由 + 按 visibility 过滤 — refs: event-system/事件 visibility 字段, web-ui/Main Timeline 与 Agent Run Detail 双视图
- [ ] 20.3.5 message.brief.published / pending_turn.* / agent.run.waiting_permission / agent.run.resumed / adapter.* 等 16 个新事件类型在 `packages/protocol` 落实 schema + payload 类型 — refs: event-system/事件分级（durable / ephemeral）

### 20.4 五道 CI 校验脚本（D31）

- [ ] 20.4.1 `events:check`：扫所有 spec / TS 引用，对照 event-system canonical registry — refs: event-system/events:check 与 visibility:check CI 校验
- [ ] 20.4.2 `visibility:check`：所有 durable event schema 都有 registered visibility，且与 registry 一致 — refs: event-system/events:check 与 visibility:check CI 校验
- [ ] 20.4.3 `subscriptions:check`：模块 `subscribes.ts` 与 bus-runtime 订阅图谱一致 — refs: bus-runtime/订阅图谱
- [ ] 20.4.4 `command:check`：① 所有 dispatch 引用的 Command type 在 canonical Command union；② `origin='http'` 不可触发 internal-only Command；③ 凡是 dispatch `WakeAgent` 且带 `carryNextTurnIds`，必须同时带 `sourceRunId`（carry 约束）；④ `WakeAgent Command union` / `orchestrator WakeAgentInput` / `bus-runtime CreateRunInput` 三者字段集合必须对齐（详见 bus-runtime/Command 与 Event 显式分离 "三者字段对齐"段）— refs: bus-runtime/Command 与 Event 显式分离
- [ ] 20.4.5 `run-state-machine:check`：`RunLifecycleService` 方法覆盖 `agents/Run 状态机扩展` 所有转换 — refs: bus-runtime/RunLifecycleService 是 runs 表的唯一写入口
- [ ] 20.4.6 `bun run check:all` 入口聚合 + CI 必跑 + 失败 block PR

### 20.5 ArtifactFS / Preview / Adapter / Context 收尾

- [ ] 20.5.1 ArtifactFS: 启动 Run 前根据 agent.capabilities + adapter manifest 自动选 mode；terminal-enabled agent 拒绝 shadow_buffer + UI 红警 — refs: artifacts/ArtifactFS Shadow Write 与 Run-Level Diff
- [ ] 20.5.2 ACPAdapter clientCapabilities 默认 `terminal=false`；如 V1.x（具体子阶段视实际需求）启用 terminal 必须配套 isolated_worktree/isolated_copy — refs: adapter-framework/ACPAdapter 会话状态机与 JSON-RPC pending 表
- [ ] 20.5.3 实现 Preview 独立 server（`127.0.0.1:6678`）+ token 一次性 + CSP/Sandbox 严格 + ESLint 规则 `no-iframe-allow-same-origin` — refs: security/Preview iframe 沙箱, artifacts/Preview Artifact（最小实现）
- [ ] 20.5.4 实现 `attachSession?(input: AttachSessionInput)` 接口；ClaudeCodeAdapter / OpenCodeAdapter 等 resumable adapter 必须实现；CI 校验 manifest 一致性 — refs: adapter-framework/AgentRuntimeAdapter 接口
- [ ] 20.5.5 实现 ContextLedger trusted_system_tool allowlist + UI 在 settings 显式批准 + audit log 输出当前白名单 — refs: context-ledger/confirmed 写入需 trusted_system_tool 白名单
- [ ] 20.5.6 命名扫尾：grep 全仓 `permission.requested.denied` / `context.visibility.changed`（不带 item）一律替换；ESLint rule 禁止再引入

### 20.6 验收

- [ ] 20.6.1 跑 `openspec validate add-agenthub-mvp --strict` 通过
- [ ] 20.6.2 跑 `bun run check:all`（5 道 custom check）全过
- [ ] 20.6.3 跑 observe 不烧 token（同 19.15.3）+ 双调度路径不存在用例 + waiting_permission 恢复发 resumed 用例 + claimed reclaim 走 transient failureClass 用例 + preview iframe 隔离用例

## 21. M-阶段交付建议（不属于 spec，仅作实施计划参考）

> 这些是工程实施 milestone，不是 spec 要求。tasks.md 1–20 描述的是"做什么"；M 阶段描述"按什么顺序做"。

- [ ] M0 Repo + DB + Protocol + EventBus + CommandBus + 5 道 CI（refs §1–§4 + §20.4）
- [ ] M1 RunLifecycle + RunQueue + MockAdapter 跑通 golden path（§5 + §11 + §13）
- [ ] M2 Permission + Intervention + Context Ledger + Debug Panel（§7 + §10 + §12 + §15）
- [ ] M3 ArtifactFS + Run-level Diff + Apply/Revert（§9 + §19.2 + §20.5）
- [ ] M4 Web UI 主流 / Run Detail 双投影 + PendingTurn UI（§14 + §19.6 + §19.10）
- [ ] M5 ACPAdapter + ClaudeCodeAdapter（§13 + §19.1）
- [ ] M6 安全加固 + raw stream + liveness + recovery（§16 + §19.7 / §19.8 / §19.9 / §19.11 / §19.13）

> 关键纪律：M5 之前所有功能都要在 MockAdapter 上跑通；ClaudeCodeAdapter 不要太早接入，避免外部 agent 不稳定性拖住核心内核。

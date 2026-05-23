# Design: add-agenthub-mvp

> 配套 `proposal.md` 阅读。本文聚焦"如何实现"——架构决策、技术选型、关键权衡、留白处的推荐方案。spec 内的 _what_ 与本文的 _how_ 配套；不重复 spec 的需求叙述。

## Context

### 设计稿与现状

设计来源：用户与外部 AI 多轮迭代得到的 312 KB / 11 722 行文稿（`chatgpt-export_AI多Agent协作平台设计 (4).md`）。文稿已经过了概念阶段，最大风险是"设计完美主义"——所以本 change 的范围严格收敛到 8–10 周可交付的 MVP，其余推到 V1。

仓库当前状态：

```
C:\project\AgentHub
├─ .claude/         # Claude Code 配置（已有）
├─ .codex/          # Codex 配置（已有）
├─ .opencode/       # OpenCode 配置（已有）
├─ .trae/           # Trae 配置（已有）
├─ openspec/        # spec 工作流目录（已初始化，本 change 在此创建）
└─ chatgpt-export_AI多Agent协作平台设计 (4).md
```

工作机：Windows 11 Pro，bash shell。

### 干系人与目标用户

- **首要使用者**：会用 Claude Code / Codex / OpenCode 的开发者，希望在一个 IM 式界面上同时驱动多个 Agent，并能介入复杂任务。
- **次要使用者**：希望本地跑、不愿把代码送上云的隐私敏感开发者。
- **未来使用者（V1+）**：团队场景（共享房间、远程 daemon）、移动端审批者、自建 Agent 的开发者。

### 三条不可破的红线

1. **本地优先**：MVP 不依赖云服务，不强制登录；卸载等于删除 `.agenthub` 目录。
2. **诚实大于一致**：Adapter 不强求能力一致，必须诚实声明（`reliability` / `injectionMode` / `canEmitToolEvents` 等），UI 据此显示真实状态。
3. **用户可介入**：任何 Agent 的写文件 / 跑 shell 行为必须经过 Permission Engine；任何 Agent 写 `confirmed` Context 必须经用户确认。

## Goals / Non-Goals

**Goals:**

- **G1**：8–10 周内交付一个可用 MVP，能让用户在一个 Room 内 ① 与 Builder Agent 单聊写代码 ② 让 Reviewer 旁听并敲门介入 ③ 看 Diff Card 并一键应用。
- **G2**：建立可演进的事件协议、Adapter 接口、Context Ledger 三大基石，使 V0.5+ 引入第二 adapter / V1.2 向量检索、Memory / V1.3 A2A、Plugin / V1.5 War Room 时不需要重写内核。
- **G3**：技术栈统一在 TypeScript（前后端共享类型），Effect 只在内核（Bus / Run / Permission），domain 用 plain TS。
- **G4**：所有 durable 事件完整审计，开发者可通过 Debug Panel 重放任意 traceId 的事件链。
- **G5**：建立 MockAgentAdapter 让所有 capability（Bus / Permission / Intervention / Context）能在不联网、不依赖外部 Agent 的情况下被自动化测试。

**Non-Goals:**

- **NG1**：不做完整后续阶段能力（V0.5 OpenCode / V1.0 Squad·Team·static-zip Deploy / V1.1 Task Board·协作可视化 / V1.2 Skill·BM25·Vector·Memory hybrid / V1.3 Plugin·LangGraph·A2A 双向 / V1.4 Tauri·响应式 Web·Docker Deploy / V1.5 War Room·Permission DSL）——只留接口。**明确不做**（D32 红线）：Marketplace / Mobile Native Client / SaaS / 多用户。
- **NG2**：不做 SaaS / 云端 / 团队云端 / 多用户认证 / Mobile Native Client / Marketplace（详见 D32 路线红线）。Postgres + Redis + WebSocket Hub 永不做。
- **NG3**：不做 CRDT 协同编辑。多 Agent 同时改一份代码用乐观锁 + 用户裁决（见 D7）。
- **NG4**：不做完整 Preview / Deploy。Artifact `type=deployment` 只是字段占位；static/zip deploy 留 V1.0，docker deploy 留 V1.4；Preview postMessage 通道 / 完整 CSP 留 V1.0（与 static-zip 一起做）。
- **NG5**：MVP 不引入 Python。LangGraph / Mem0 / ReMe 通过 adapter 在 V1.2 / V1.3 接入。

## Decisions

每条决策都标注作者强烈表态过的取舍来源。**[DECISION-NEEDED]** 标记的是原稿留白、本文给出推荐方案待用户 review 的项。

### D1：主语言 TypeScript，不全 Python

**决定**：前后端统一 TypeScript；Python 仅在 V1 通过 LangGraph Worker Adapter 接入，不做主后端。

**理由**：AgentHub 的核心难点是"大量实时状态 + 卡片协议 + 子进程管理 + 文件监听 + 桌面打包"，TS 在前后端共享类型系统的价值远大于"接 LangChain 生态"。原稿明确反复表态。

**备选**：全 Python（FastAPI + LangGraph）能跑但边界混乱；混合（TS daemon + Python AI worker）保留为 V1 选项。

### D2：Vite + React，不用 Next.js

**决定**：`apps/web` 用 Vite + React + TypeScript，浏览器打开 `http://127.0.0.1:<port>`。

**理由**：本地 app 不需要 SSR / 登录 / 团队空间 / 分享页，Next.js 的所有强项都用不上。原稿明确"弱化 Next.js"。

**备选**：Next.js（SaaS 假设场景）、Tauri/Electron（V1 桌面）。

### D3：SQLite + Drizzle，永不上 Postgres

**决定**：MVP 数据存 SQLite + Drizzle ORM，开 WAL；vector 留到 V1.2 用 sqlite-vec。**路线红线（D32）**：单机本地产品，永不引入 Postgres / pgvector；所有持续阶段的并发与扩展通过 SQLite + 锁矩阵 + 队列设计满足。

**SQLite pragma**：

```text
journal_mode = WAL
synchronous = NORMAL
foreign_keys = ON
busy_timeout = 5000
temp_store = MEMORY
mmap_size = 268435456    # [DECISION-NEEDED-1] 256 MB，本机内存足够，可调
page_size = 4096         # [DECISION-NEEDED-1] 默认 4 KB，建库时一次性设
```

**理由**：本地产品不应要求用户先装 Postgres；SQLite + WAL 在单机并发场景足够；`sqlite-vss` 已停止维护，向量统一用 `sqlite-vec`（V1.2）。原稿明确表态。

### D4：Hono + Effect Kernel（不上 Effect HTTP 全栈）

**决定**：HTTP 外壳用 Hono；异步内核（Bus / Run / Permission / Tool / Adapter Manager）用 Effect。

**纪律**：

1. Hono route 只做协议转换，不写业务流程。
2. Agent run / tool run / bus / permission 必须进 Effect runtime（用 Layer / Scope / Deferred / Stream / PubSub）。
3. 后端 Schema 统一 Effect Schema；前端只消费生成的 SDK 类型；**禁止 Zod + Effect Schema 双栈**。

**理由**：MVP 异步复杂度还不至于必须 Effect HTTP；先用 Hono 减少学习曲线，V1.3 异步规模上来（plugin / a2a / langgraph 引入跨进程异步）后再考虑迁移。原稿方案 B 选项。

**备选**：方案 A（Effect HttpApi 全链路）→ 留 V1.3 评估。

### D5：Bun 优先 + Node 兼容

**决定**：开发与本地默认 Bun；关键抽象保持 Node 兼容；**adapter 子进程相关代码必须走 Node API（`child_process` / `node-pty`），禁止 `Bun.serve` / `Bun.file` 等 Bun-only API**。

**理由**：node-pty / isomorphic-git / 多数 MCP server 包在 Bun 上仍有兼容问题；写死 Bun-only 等于把桌面端 / CI 兼容性烧死。

### D6：事件协议从第一天版本化

**决定**：所有事件用统一 envelope，含 `schemaVersion`、`traceId`、`causationId`、`correlationId`。schema 演进规则：

- 只新增 optional 字段
- 不删除 / 不重命名
- 重大变更新建事件类型（如 `message.created.v2`）
- 读取旧事件经 `EventMigrator` 升级

**事件分级**（反压关键）：

```text
durable    落 events 表，永不丢，可重放：
           message.created / message.completed / agent.state.changed /
           run.started / run.completed / task.* / context.item.* /
           permission.requested / permission.resolved /
           intervention.* / artifact.diff.created / artifact.preview.* /
           adapter.session.* / adapter.crashed

ephemeral  不落库，可丢可合并：
           message.part.delta / agent.token.delta / agent.typing /
           tool.output.delta / run.heartbeat / ui.toast.shown /
           ui.presence.changed / stream.chunk / adapter.raw.stdout
```

**`message.part.delta` 合流**：客户端窗口 30–50 ms（本文统一取 **40 ms**），同 message 的 delta 合并；`message.completed` 时用最终内容覆盖。

### D7：多 Agent 修改同文件 → 乐观锁 + 用户裁决（不上 CRDT）

**决定 [DECISION-NEEDED-2]**：

- Artifact `type=diff` 是不可变的 patch 单元；多 Agent 不允许同时持有同一文件的 in-flight diff，Orchestrator 在调度时**串行化**（按 `targetFile` 加运行时互斥锁）。
- 极少数并行情况下落到不同文件就并行；落到同文件就排队。
- Context Item 的并发修改用 `version` 乐观锁，失败时发 `context.item.conflict_created` 事件，用户裁决卡（保留 A / 保留 B / 手动合并）。

**理由**：原稿明确"第一版不上 CRDT"；MVP 用户少、并发低，互斥 + 排队成本极低，比 CRDT 简单一个数量级。

**风险**：Orchestrator 排队可能导致体感等待——Acceptance 给出"目标文件互斥时延 < 200 ms 检测响应"。

### D8：Adapter 阶段顺序 — Claude Code（MVP）→ OpenCode（V0.5）→ Codex / LangGraph / A2A（V1.x）

**决定**：

- **MVP**：`MockAgentAdapter` + `ClaudeCodeAdapter` 双轨。
- **V0.5**：加 `OpenCodeAdapter`（server/SDK 路径，结构化协议，验证 `AgentRuntimeAdapter` 抽象的鲁棒性）。
- **V1.3**：加 `LangGraphAdapter`（Python AI worker，验证 plugin-system 隔离基座）+ `RemoteA2AAdapter`（A2A Client 把外部 agent 装进 Room）。
- **V1.x（具体子阶段视实际需求）**：`CodexAdapter`（半结构化事件，需要在 MVP/V0.5/V1.0 几家 adapter 实现稳定后再做，避免在抽象层因为 Codex 的弱事件能力做让步而拖慢主路径）。

**理由**：

- Claude Code 有最丰富的 hooks / MCP / `PreToolUse` / `PermissionRequest` / `SubagentStart` / `PreCompact` 事件，能完整验证 Permission Engine、Intervention Engine、Context Snapshot 三大闭环 → MVP 首发；
- OpenCode 走 server/SDK 路径，**结构化程度高**且与 Claude Code 的协议差异足够大，是验证 adapter 抽象鲁棒性的最佳第二家 → V0.5；
- Codex 事件较弱（半结构化），如果在 V0.5 第二位上，会导致 adapter 抽象为了兼容半结构化能力做让步 → 推到 V1.x；
- LangGraph / A2A 都是"外部代码进 daemon"，与 Plugin System 共享隔离基座，集中在 V1.3 一起做。

**Adapter 能力声明（manifest）**：

```ts
type AgentAdapterManifest = {
  id: string
  runtimeKind: "native_sdk" | "cli" | "server" | "mcp" | "acp" | "a2a" | "langgraph"
  capabilities: {
    canStreamTokens: boolean
    canEmitToolEvents: boolean
    canEmitPermissionEvents: boolean
    canEmitSubagentEvents: boolean
    canInjectAtStart: boolean
    canInjectNextTurn: boolean
    canInjectRuntime: boolean
    canCancel: boolean
    supportsMcp: boolean
    supportsHooks: boolean
    supportsWorkspaceIsolation: boolean
  }
  reliability: {
    level: "structured" | "semi_structured" | "scraped" | "manual"
    eventSource: "native_event_stream" | "hooks" | "json_stdout" | "stdout_scraping" | "filesystem_polling"
    crashRecovery: "resumable" | "restartable" | "fail_run"
    parseFailure: "skip_event" | "degrade_to_text" | "fail_run" | "ask_user"
  }
  context: {
    startupInjection: boolean
    runtimeInjection: boolean
    injectionMode: "immediate" | "next_turn" | "next_session"
  }
  workspace: { mode: "shared" | "isolated_copy" | "worktree" | "external" }
}
```

UI 必须展示能力差异，例如"Codex 当前为 CLI 兼容模式：事件解析可能不完整，介入将在下一轮生效。"

### D9：Context Ledger ≠ Prompt

**决定**：Context Ledger 是**审计层**——记录"用户与 Agent 团队认可的事实"。Prompt 是 Context Assembly 的输出，Ledger 是输入。两者解耦：

```
Ledger（持久 / 版本化 / 可审计 / 可见性矩阵）
   ↓ ContextAssembly v0（规则）
Prompt（每次 run 即时组装 / 不持久）
```

**Context 写入纪律**：

- Agent 只能 propose `draft`；用户 confirm 后转 `confirmed`；deprecated 不删只标记
- 工具结果可标 `verified`（来源是 tool），但仍可被用户 deprecate
- 修改必须带 `version`（乐观锁）；冲突 → `context.item.conflict_created`

**Context Assembly v0 优先级**（手写规则，不上向量）：

```text
1. workspace 级 pinned ContextItem
2. 当前 task 的 confirmed ContextItem
3. 当前 room 最近 N 条 confirmed ContextItem
4. 当前 task 的 draft（标注"未确认"）
5. 最近 K 条 message（窗口式）
6. 文件 chunk（V1.2 引入向量后接入）
```

**Token 预算 [DECISION-NEEDED-3]**（默认值，可在 settings 调）：

```text
system / role / capabilities    : 15%
pinned + confirmed context      : 20%
recent task summary             : 15%
recent messages                 : 25%
attachments / file refs         : 15%
safety margin                   : 10%
```

设计稿原值（15/20/25/20/15/5%）的"最后 5% 安全边际"过紧；推荐改为 10% 缓冲，避开 token 数 ±5% 抖动。

**注入三档（必须 UI 透明）**：

- `immediate`：运行中可注入（Claude Code hooks / MCP）
- `next_turn`：下一轮 prompt 重组生效（多数 CLI adapter）
- `next_session`：必须重启 session（Codex 早期）

### D10：群聊纪律（受控协作，非自由发言）

**决定**：MVP 群聊 5 条铁律：

1. 每个 Room 只能有一个 Primary / Leader Agent。
2. 其他 Agent 默认 `observing`，**不能直接插话**，只能：写 mailbox / 提交 knock / 写 draft context / 提交 review card。
3. 用户 `@Agent` 后该 Agent 临时 `active`。
4. Agent 输出限制为：短回复 / 卡片 / Diff / 状态行 / 最终总结。
5. 长任务中间过程进入"状态流"，不进入主聊天流。

**唤醒规则**：

| 方式 | 是否进入 active |
|---|---|
| 用户 `@agent` | 是 |
| Orchestrator 分配任务 | 是 |
| 规则触发（如 auth 文件变更触发 Security） | 先 `knocking` |
| Agent 主动敲门 | 用户批准后 active |
| 群体评审 `/review @all` | 限制轮次后 active |

**Mailbox**：必须 durable 落表，不能用内存 EventEmitter——避免 daemon 重启后 leader 丢失子 Agent 的回执。

### D11：Permission Engine = `ask` / `allow` / `deny` + Effect Deferred

**决定**：复用 OpenCode 的 ask/allow/deny + Deferred 异步模式。

```
Agent 请求 tool
  → Permission Engine 查 PermissionProfile
  → allow → 直接执行
  → ask   → 发 permission.requested 事件 → UI Approval Card
            → await Deferred（用户决策前 Effect 挂起）
            → resolve → 继续执行 / reject → tool 拒绝 + 拒绝原因回流
  → deny  → 直接拒绝 + 拒绝原因回流
```

**敏感文件白名单**（默认 deny）：

```text
.env / .env.* / *.pem / *.key / id_rsa / id_ed25519 /
.aws/** / .gcp/** / .ssh/**
```

**审批粒度**：不能"每文件每次弹"——按"项目内 / 项目外 / 敏感"三档 + "本项目总是允许 / 允许一次 / 拒绝"三选项。

### D12：Intervention Engine 是差异化核心

**决定**：完整状态机：

```
requested → pending_user_decision
  → approve → injected → resolved
  → ignore → closed
  → reject → closed
  → later  → snoozed → pending_user_decision（重新激活）
```

Intervention Card 必须显示：来源 Agent / 原因 / 优先级 / 4 个 action（approve / later / ignore / reject）。

**注入实施**：approve 后通过 Adapter 的 `injectContext()` 把介入文本写入对应 session（按 adapter 的 `injectionMode` 决定立刻 / 下一轮 / 下一 session 生效）。

### D13：Agent 不直接改文件 → 只产出 patch

**决定**：MVP 阶段所有 Adapter 的"写文件"行为被 Permission Engine 拦截 → 转化成 Artifact `type=diff` `status=draft` → 用户 `accepted` 后系统 apply → `applied`。

**理由**：① 让用户始终是真理的最终来源；② 保证 Diff Card 是"先看再应用"流程；③ 统一回滚路径。

**例外**：MVP 可以白名单某些"安全写"路径（如 `/tmp/agenthub-cache/**`），但必须显式配置。

### D14：Debug Panel v0 = 可观测性的最低门槛

**决定**：MVP 必须有一个开发者 Debug Panel，能：

1. 按时间线展示所有 durable 事件
2. 按 `traceId` 过滤一次用户请求的完整链路
3. 按 `runId` 回放该 run 的所有事件
4. 查看 adapter 原始 stdout/stderr（标 `adapter.raw.*`）

不做：Jaeger / Tempo / OpenTelemetry 完整集成（V1.x 视需要评估，可能不做——单机产品 traceId + 本地 events 表已够）、metrics 仪表盘（V1.x 视需要）。

### D15：Cost Ledger 字段先记，不做聚合

**决定**：每个 `agent.run.completed` 事件必须含：

```ts
{ inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number; modelId: string }
```

聚合视图（单机 Cost 面板）= V0.5；预算告警 / 降级策略 = V1.5（permission-dsl）。

### D16：daemon 默认绑定 `127.0.0.1`，远程访问显式开启

**决定**：

```
daemon 默认 bind 127.0.0.1
远程访问需要：① 配置 bind = 0.0.0.0 ② 启用 token ③ 显式确认 prompt
API key 存 OS keychain（Windows: Credential Locker；macOS: Keychain；Linux: secret-service）
SQLite 存配置但不存密钥
```

**Token 协议 [DECISION-NEEDED-4]**：MVP 推荐用 32 字节随机字符串 + Bearer Header；过期时间默认 30 天可配；撤销 = 从 keychain 删除条目。完整 OAuth / 刷新 token 留 V1.4（响应式 Web + 桌面壳同时铺开时再评估，本地产品大概率不需要 OAuth）。

### D17：Web Preview / iframe 沙箱

**决定 [DECISION-NEEDED-5]**：MVP Preview Card 用 iframe `sandbox="allow-scripts"`（**不**给 `allow-same-origin / allow-top-navigation / allow-popups / allow-forms / allow-modals`）。Preview 服务独立 origin（如 `127.0.0.1:6678`，与 daemon `127.0.0.1:6677` 区分），不发送 daemon cookie，CSP `default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'`，token 一次性使用 + 30 分钟 TTL。详见 `security/Preview iframe 沙箱`。完整跨域 / postMessage 受控通道 / per-preview origin token 留 V1.0（与 deployment-static-zip 一起重做）。

**理由**：放开 `allow-same-origin` 会让 agent 生成的 HTML JS 在与 daemon 同源时获得读 daemon GET 接口的能力（即便 CORS 配得严，浏览器同源策略下仍有探测/利用空间）。"独立 origin + sandbox 严格 + CSP 严格 + token 一次性"四层防御对 MVP 已足够，且不显著影响 preview 体验。

### D18：消息操作集合 [DECISION-NEEDED-6]

设计稿散落提到，MVP 推荐固化为：

| 操作 | 适用消息 | 实现 |
|---|---|---|
| 复制 | 全部 | 浏览器 clipboard |
| 引用 | 全部 | 创建新 user message 含 quotedMessageId |
| 重新生成 | assistant message | 取消上一条 + 触发同一 run prompt |
| 应用 Diff | DiffCard | artifact.applyRequested 事件 → Permission → apply |
| Pin | 任意含 ContextItem 的 message | 升级 ContextItem.scope 至 workspace |
| 删除 | 仅 user 自己的消息 | 软删除 + 写 message.deleted 事件 |

### D19：prompt 系统语言 [DECISION-NEEDED-7]

**推荐**：默认英文（与 Claude Code / Codex / OpenCode 内部 prompt 一致），但所有 system prompt 抽到 `packages/prompts/` 模板化，UI / 用户消息保持中英自由。

**理由**：与外部 Agent 的内置 prompt 同语种能减少 prompt 反复翻译损耗；用户对话不受影响。

### D20：向量召回 top-k [DECISION-NEEDED-8]

V1.2 才上向量（sqlite-vec）。**推荐默认 top-k = 8**（confirmed context items + file chunks 合在一起后切到 token 预算）。MVP 不实现，spec 里只在 v1-roadmap 占位。

### D21：MockAgentAdapter DSL [DECISION-NEEDED-9]

设计稿给了 5 个 step 类型，本文补全到 7 个，固化在 spec：

```ts
type MockAgentScript = {
  steps: Array<
    | { type: "say"; text: string; delayMs?: number }
    | { type: "tool"; name: string; input: unknown; resultDelayMs?: number }
    | { type: "diff"; files: { path: string; patch: string }[] }
    | { type: "request_permission"; resource: PermissionResource; expect: "allow" | "deny" | "any" }
    | { type: "request_intervention"; reason: string; priority: "low" | "medium" | "high" }
    | { type: "fail"; error: string }
    | { type: "wait"; ms: number }
  >
}
```

### D22：Command 与 Event 在 bus 层显式分离 + Outbox 事务模式

**决定**：

- 内核两条独立干路：`CommandBus`（请求侧，可校验、可拒绝、有 idempotencyKey）+ `EventBus`（事实侧，durable 落表 + ephemeral PubSub）。
- 所有 mutating HTTP route → 翻译成 Command 走 CommandBus，**禁止** HTTP handler 直接 publish event 或操作 domain 表（ESLint 规则强制）。
- 写一致性用 **Outbox 模式**：`domain 表`、`events 行`、`outbox 行` 三者在同一 SQLite 事务内提交；事务外的 Outbox Dispatcher 异步把 outbox 推到 PubSub / SSE。
- 每个业务模块以**命名 durable handler** 形式订阅事件，各自有 `handler_cursors.last_seq` + 重试 + DLQ；at-least-once，handler 内部按 `event.id` 幂等。
- RunQueue 是 bus 上一条命名队列（不是 Orchestrator 的内部队列），按 `(agentId, roomId, [files])` 锁矩阵串行调度；锁元数据落 `run_locks` 表，崩溃恢复时清残留锁。
- SSE 反压：per-client 队列 durable 1000 / ephemeral 500；durable 满即断开让客户端走 catch-up；Debug 流（`/debug/event`）用独立反压参数，不与主流互相影响。

**理由**：原稿提到"双层事件 / typed bus"，但没有把"Command 与 Event 的边界、写一致性、handler 重试、慢消费者"这些 Bus Runtime 决策说透——这块如果在 MVP 没建好，后续引入向量检索 / A2A / 插件订阅 / 复杂调度时一定踩坑。把它独立成 `bus-runtime` capability + 本决策。

**EventBus 接口与 in-process PubSub 解耦的真正动机**：不是为换 NATS / Redis（路线红线 D32 已明确不做云端），而是为 V1.3 `plugin-system` 的事件订阅 API——插件通过受控的 `EventBus.subscribe(filter, handler)` 接口订阅 durable 事件，按 visibility 过滤，必须经过隔离边界（worker / subprocess）而非直接挂内部 PubSub。

**备选**：

- 不分 Command / Event（直接 publish）：HTTP 校验逻辑会和事件流耦合，且无法做 idempotencyKey。否决。
- 不用 Outbox，DB 写完后 publish：崩溃窗口内丢事件。否决。
- handler at-most-once：丢事件，必须靠 SSE 客户端发现并补，运维复杂度更高。否决。

**详见**：`bus-runtime` capability 的 8 个 Requirement。

### D23：observe 是被动状态 + WakeAgent 是模型调用唯一入口

**决定**：observing Agent 不允许因为 room 事件流变化而调用模型 / API；任何 LLM 调用必须由 Orchestrator dispatch `WakeAgent` Command 才能发生。WakeAgent 含 `wakeReason` 枚举（user_mention / delegated_task / rule_review / knock_approved / group_review / phase_completed / agent_crashed）+ 首次 wake 注入完整 role prompt，后续仅注入 delta。

**理由**：

- AionUi team 实现历史显示，让 observer 一直在线"听消息"会以接近 N×primary 的速度烧 token，且 review 质量不稳定；
- 把 wake 收紧成显式 Command 让阶段触发可调试可回放，Run Detail 能追溯完整因果链；
- 与 D7 文件锁矩阵 / RunQueue 互补：锁是物理调度，wake 是产品语义。

**备选**：

- 让 observer 真的常驻订阅事件流（成本不可控，否决）；
- 用心跳 + 拉式（变成轮询，仍烧）。

**详见**：`orchestrator/Observing 是被动状态 + WakeAgent`。

### D24：ArtifactFS Shadow Write + Run-Level Diff（取代 per-write 拦截）

**决定**：ACP `fs.writeTextFile` / MCP write tool / shell 重定向 MUST 路由到 ArtifactFS（worktree 或 shadow buffer），Agent 真实 workspace 不被 mid-run 改写；Run 终结时按 base 快照与 shadow 对比生成单个 DiffArtifact，由用户在 DiffCard 整批 review；ApplyDiff 才写真实 workspace。Permission Engine `file.write = "ask"` 在 Run 内不弹卡，统一在 Run 终结后整批审批。

**理由**：

- 重型 coding agent（Claude Code、Codex）在一次任务里频繁 read-modify-write，把"每写一个文件就 ask"硬塞到 prompt 流会破坏 agent 的工作模型；
- 按任务边界审查更接近开发者的真实 PR review 习惯；
- 与 D7 文件锁配合：锁仍按 Run 声明 targetFiles 排他，避免两个 Run 在 ArtifactBuilder 阶段碰撞。

**例外**：敏感文件白名单（.env / .ssh 等）即便在 ArtifactFS 内写也 silent deny：ArtifactFS.write 拦截 + 同事务 emit `permission.resolved decision=deny reason=sensitive_pattern_match requested=false`，不弹卡、不写盘。

**详见**：`artifacts/ArtifactFS Shadow Write` + `adapter-framework/ACPAdapter` 的 clientCapabilities 声明。

### D25：ACP 是一等运行时协议 + ACPAdapter 状态机统一基类

**决定**：MVP 把 ACP（Agent Client Protocol over stdio NDJSON JSON-RPC）作为 first-class adapter runtime kind；Claude Code / Codex / OpenCode 三家的 ACP 实现都继承同一份 `ACPAdapter` 基类，共用：state machine（disconnected/connecting/initializing/ready/prompting/cancelling/failed/disposed）、`pendingRequests` 表、`session/cancel` ≠ `dispose` 的语义、prompt 默认串行（manifest 可声明 concurrentPrompt）、line-splitter buffer、版本探测。

**理由**：

- AionUi `AcpConnection` / opencode agent.ts 的实测代码都已踩过同一组坑（cancel 清空了非 prompt pending、并发 prompt 撞车、stdout 跨帧切包、session 还活着却没了 RPC handler），把它们写进规约比每个 provider 各做一份再 debug 一遍便宜；
- ACP 在 Codex / Claude Code / OpenCode 这条链上能复用最多上游官方维护的 bridge（@zed-industries/claude-agent-acp、@openai/codex-acp 等），AgentHub 不应自己 scrape stdout。

**备选**：每个 provider 自定义 adapter（被否决；同样的 bug 在每家适配上重写一遍）。

**详见**：`adapter-framework/ACPAdapter 会话状态机` + `跨平台 CLI 探测与 Provider-specific Spawn`。

### D26：Run 状态 claimed/dispatched + sessionId 中途持久化 + 失败分类

**决定**：

1. Run 状态机在 `queued / starting / running` 中间插入 `claimed`：worker 已拿到锁、adapter session 尚未确认启动的窗口；
2. RunLifecycleService 增加 **不发 durable event** 的 `updateSessionState(runId, patch)` 方法，AdapterBridge 在收到 `session.opened` / providerConversationId 变化时立即调用，把 adapterSessionId / workDir / providerConversationId 持久化；
3. ReclaimStaleClaimedRun 后台任务（启动 + 每 60s）按 `manifest.reliability.crashRecovery` 复用 / 重启 / 失败；
4. 失败必须分类为 `transient / retryable_visible / fresh_session_required / permission_denied / user_cancelled / configuration / fatal`，决定 Run 是否自动重试以及是否复用 session；poisoned session（iteration_limit / context_overflow / api_invalid_request 连续两次相同 fingerprint / 5 分钟无输出）强制 fresh session；
5. **Run-level retry 与 bus handler retry 隔离**：handler retry 计数器在 `consumer_offsets`，Run failureClass 在 `runs.failure_class`，互不影响。

**理由**：multica `ReclaimStaleDispatchedTaskForRuntime` 的实测教训证明 starting 这一态承载太多语义会让恢复逻辑脏；显式拆 claimed 后崩溃路径更干净。失败分类直接决定"用户是否被打扰"——这是 IM 产品里最敏感的点。

**详见**：`agents/Run 状态机扩展` + `agents/Run 失败分类` + `bus-runtime/ReclaimStaleClaimedRun`。

### D27：Permission per-session 队列 + 幂等键 + Prompt Timeout Pause

**决定**：

- PermissionEngine 维护 `Map<adapterSessionId, Queue<PermissionRequest>>`，同 session 同时只展示一张 PermissionCard；manifest 可声明 `concurrentPermission=true` 解锁；
- PermissionRequest 用 `(adapterSessionId, toolCallId)` / `adapterRequestId` 幂等键，UNIQUE 在 pending 行；duplicate request 返回已有 ID 不覆盖原 Deferred；
- adapter prompt 内部 timeout 在该 session 进入 permission pending 时 pause，resolved 时 resume；总等待上限 maxPermissionWait（默认 600s）超出强 deny `expired_max_wait`。

**理由**：opencode 的 per-session permission queue + AionUi 的"重复 toolCallId 覆盖原 Deferred bug"是同一个根因 — 缺幂等；prompt timeout pause 是参考 AionUi `PromptTimer.pause/resume` 的实测必要项，否则用户决策慢就会撞 ACP prompt 超时。

**详见**：`permissions/Per-session 串行化、幂等键、Prompt Timeout Pause`。

### D28：群聊主流摘要 / Agent Run Detail 双投影 + 用户 Turn 排队

**决定**：

- daemon 端给每条 durable event 标 `visibility ∈ {main, detail, both}`；SSE 客户端通过 `?view=main|detail|raw` 显式声明订阅模式，daemon 推送对应子集；
- 主流（main）只展示用户消息、agent brief（一句话简讯）、阶段总结、actionable cards、最终结果；不展示 token delta、tool call 细节、raw stdout；
- Agent Run Detail（detail）作为 slide-over，7 tab：Transcript / Tools / Context / Permissions / Artifacts / Raw Stream / Cost；
- 用户在 primary busy 时可继续发消息，daemon 创建 PendingTurn `status='queued'`，UI 显示"⏳ 排队中（位置 N）"；上一轮终结后按 enqueuedAt 顺序触发；可取消、可编辑、上限 20 条；
- 主流 brief 通过新事件 `message.brief.published` 显式发布，含 run_started / run_completed / run_failed / phase_completed / cancelled。

**理由**：你提的产品判断 — 群聊只展示简讯，每个 agent 单独上下文界面 — 是当前 spec 与所有参考项目对比下最缺的一层"信息分层"。把它沉到事件 visibility 标记 + SSE view 协议，而不是放到前端过滤层，能让 daemon 在订阅时就分流，避免一个 raw 暴涨拖累主流。

**备选**：

- 全部事件都进主流，前端 toggle 显示（主流会变成日志瀑布，否决）；
- 单 SSE 通道客户端按 visibility 过滤（带宽浪费、分发延迟，否决）。

**详见**：`messaging/主流摘要 / Agent Run Detail 双投影` + `web-ui/Main Timeline 与 Agent Run Detail 双视图` + `messaging/用户 Turn 排队`。

### D29：内部 PubSub Bounded + Worktree GC + Adapter Liveness 与 SSE Heartbeat 分离

**决定**：

- 内部 PubSub 按通道明确容量 + drop 策略：durable 通道 4096 + back-pressure 不丢；ephemeral 通道 64–1024 之间 + drop_oldest / coalesce；adapter raw stream **独立通道**避免污染 message.delta；
- AdapterManager 维护独立 `AdapterLiveness`（available / starting / ready / busy / blocked / crashed / offline）+ 每 3s ping 子进程；与 SSE `/event` 心跳完全分离；`/healthz` 分别返回；
- Worktree GC 任务：保留 3 天 + 总盘 20 GB 上限 + LRU 强制清理；删除前必须满足 status terminal、无 in-flight artifact、路径在 `<userhome>/.agenthub/` 管理根内、不删 .git internal（必须用 `git worktree remove` 而非 `rm -rf`）；
- file:// / data: URI 全部走 `resolveSafeUri`：file:// 走 resolveWorkspacePath，data: 限 MIME 白名单 + 1 MB；事件 / API payload 不暴露绝对路径，只暴露 fileId / runId.workDir；
- `/debug/*` 与 SSE `view=raw` 需要 `admin` scope 或本地 + `debug.enabled`；远程默认禁用，需 `[debug] allowRemote=true` + admin。

**理由**：opencode 用 PubSub.unbounded 在多 agent 多 raw stream 下内存压力会顺着任意一条慢消费者堆积；multica heartbeat / orphan recovery 的细致度证明"adapter 心跳 ≠ SSE 心跳"是必要的；ACP fs.readTextFile 这种入口若不统一闸口很容易留越界后门。

**详见**：`bus-runtime/内部 PubSub Bounded` + `local-daemon/Worktree 选择策略与 GC 安全约束` + `adapter-framework/Adapter Liveness` + `security/file:// data: URI` + `security/Debug 授权边界`。

### D30：WakeAgent 是模型调用唯一入口 + 不存在 StartRun Command + PendingTurn 闸门

**决定**：

- **MVP 不存在 `StartRun` Command**。`agent.run.queued` 的唯一来源是 `WakeAgent` handler 在 IMMEDIATE 事务内调 `RunLifecycleService.create`（同事务 INSERT runs(queued) + INSERT events(agent.run.queued) + outbox）。HTTP 层不暴露"直接启动 Run"的入口；用户消息 → `SendMessage` Command → 在事务里判 primary busy 是闸门：
  - 非 busy → 写 `messages.turn_dispatch_mode='immediate'` + emit `message.created` → Orchestrator handler 看到 immediate → dispatch `WakeAgent { reason: "primary_turn" }`。
  - busy → 写 `messages.turn_dispatch_mode='pending'` + 创建 `PendingTurn` + emit `pending_turn.created` → Orchestrator handler 看到 pending → **不** wake；上一轮 Run 终结后由 `ConsumePendingTurn` handler 内部 dispatch `WakeAgent { reason: "consume_pending_turn" }`。
- 这是 D23（observe 被动）的延伸：消除"双调度路径"风险 — 之前我曾考虑过"WakeAgent 仅做意图校验、内部再 dispatch StartRun" 的方案 B，但实施时它仍允许 `StartRun` 作为可被错误使用的入口。直接砍掉 `StartRun` Command 后，所有 Run 创建路径只有一个：`WakeAgent handler → RunLifecycleService.create`。

**理由**：保留 `StartRun` 即便仅做内部命令也容易被误用（特别是后续多人开发时），第二条入口意味着 mailbox claim、activeWakes、wake_reason、promptDelta 这些上下文有概率不一致。最干净的做法是：方案 A — 把 RunLifecycle.create 直接绑定到 WakeAgent handler，让 Command union 里就不存在 StartRun。

**详见**：`bus-runtime/Command 与 Event 显式区分`（Command union 中不含 StartRun + "MVP 没有 StartRun Command" 段） + `orchestrator/Solo 模式调度`（已用 WakeAgent 改写） + `messaging/用户 Turn 排队`（SendMessage 事务闸门）。

### D31：visibility 收归 event-system 唯一持有

**决定**：

- `visibility ∈ {"main", "detail", "both"}` 是 event envelope 的一等字段，由 `event-system/事件分级` canonical registry 唯一定义；其他 capability MUST 不 redefine、不 ALTER `events` 表 schema。
- `raw` 不属于 visibility 维度，由 SSE `view=raw` + admin scope / debug.enabled 单独控制。
- 强制以下 CI 防线（`events:check` / `visibility:check` / `subscriptions:check` / `command:check` / `run-state-machine:check`）作为 `openspec validate --strict` 之外的关键防线 — strict 校验只看 spec 格式，不会发现"messaging 引用的 message.brief.published 在 event-system registry 中漏登记"。

**理由**：用户 review 准确指出 visibility 分裂在 messaging 与 event-system 两份所有者中。把 schema 与 visibility registry 一起收归 event-system，避免后续实现时出现"主流缺信息 / 详情漏卡"的语义漂移。

**备选**：让 messaging 持有 visibility 字段（被否决；event-system 是 envelope 唯一所有者）。

### D32：路线红线 — 单机本地产品，永不上云端 / 多用户 / SaaS

**决定**：AgentHub 是**单机本地产品**，所有阶段（MVP / V0.5 / V1.0 / V1.x）都遵守以下红线：

- **永不**做 SaaS / 云端 / 团队云端 / Marketplace / 账户体系 / 订阅；
- **永不**引入 Postgres / Redis / WebSocket Hub / pgvector / NATS / Kafka 等服务端基础设施；
- **永不**做多用户认证、多 workspace 用户隔离、跨用户协作；
- **永不**做 Mobile Native Client（iOS / Android 应用）——移动场景通过 V1.4 响应式 Web + PWA 离线壳满足；
- 所有看似需要云端的特性（如多端审批、远程协作）必须能用本地 daemon 暴露给 LAN 或反向代理满足，**不引入任何云后端**。

**理由**：

- 用户已明确表态：产品定位是单机本地工具，不做 SaaS、不做团队云端、不做多用户。这是产品根决定，不是阶段约束。
- 单机本地是 AgentHub 的差异化壁垒之一（隐私、零配置、无运维），引入云端会从"个人开发者工具"变成"团队协作平台"，两个市场逻辑完全不同。
- 把这条红线明确写下来，避免后续任何 change 提案"顺手"加云端选项。

**对前文决策的影响**：

- D3（SQLite + Drizzle）：永久结论，不再是"V2 视情况切 Postgres"。
- bus-runtime D22 / R5：EventBus 接口与 in-process PubSub 解耦的真正动机是 V1.3 plugin-system 的事件订阅 API，**不是**为换 NATS / Redis。
- v1-roadmap：原"team-cloud"占位删除；"mobile-client"改写成 V1.4 响应式 Web；"cost-aggregation"改写成 V0.5 单机 Cost 面板。

**备选**：留"V2+ 团队云端"作为开放选项（被否决；用户已明确不做，留开放选项会让设计者总在为不会发生的场景埋成本）。

## Roadmap Beyond MVP

> 本章节落实 add-agenthub-mvp 之外的版本规划。**不展开成完整 spec**——每个阶段在落地前由独立 change 提案展开。本节只锁定主题、相对顺序、Entry Criteria。

### 阶段一览

| 版本 | 主题 | 周期估算 | 入口前置 |
|---|---|---|---|
| **V0 / MVP** | 内核 + Solo / Assisted | 8–10w | 当前 change |
| **V0.5** | 多 Agent 聊天室完整化 | 6–8w | MVP 上线、Claude Code Adapter 跑通三个真实任务 |
| **V1.0** | 复杂调度（Web-only） | 10–14w | V0.5 上线、OpenCode Adapter 验证 adapter 抽象、Run Detail 7 tab 齐全 |
| **V1.1** | 协作可视化 | 4–6w | V1.0 上线、Squad/Team 在真实多 agent 任务跑通 |
| **V1.2** | 上下文真生效 | 6–8w | V1.1 上线、Kanban + Timeline 用户跑通 |
| **V1.3** | 生态打开（Plugin / LangGraph / A2A） | 6–8w | V1.2 上线、Skill System 至少 3 个内置 skill |
| **V1.4** | 多端适配（Tauri / 响应式 / Docker） | 4–6w | V1.3 上线、Plugin 隔离基座稳定 |
| **V1.5** | 高级编排（War Room / Permission DSL） | 6–8w | V1.4 上线、整体功能闭环 |

### 各阶段交付与 Entry Criteria

#### V0.5 多 Agent 聊天室完整化（6–8w）

**Goals**：让 MVP 已有的"多 Agent 在 Room 内协作"链路从可跑通到产品级；引入第二真实 adapter 以验证 adapter 抽象的鲁棒性。

**核心交付**：

- `OpenCodeAdapter`（第二真实 adapter）
- Run Detail 7 tab 完整化（Prompt / Tool Calls / FS Changes / Permissions / Context / Logs / Cost）
- 聊天室体验打磨：mailbox 失败可见性、pending_turn 操作面板、@mention 自动补全、主流摘要质量调优、Observer 敲门链路完整化、终端 PTY 输出展示
- 单机 Cost 面板（按 agent / model / day 分组）

**Entry Criteria**：

- MVP 在用户工作机上稳定运行 ≥ 1 周无 crash
- Claude Code Adapter 跑通三个真实任务（编辑、跨文件重构、需要 review 介入的任务）
- MVP `events:check / visibility:check / subscriptions:check / command:check / run-state-machine:check` 五条 CI 全绿

**Non-Goals**：不引入 Squad / Team / War Room；不做 Plugin / Skill / Memory / Vector。

#### V1.0 复杂调度（Web-only）（10–14w）

**Goals**：把 AgentHub 从"单 Primary + Observer 敲门"扩展到"Leader 调度多 Agent"。**Web-only**——桌面壳 / A2A / 响应式 / Docker 全部下放到 V1.x。

**核心交付**：

- `SquadMode`（长期 Leader 路由）
- `TeamMode`（任务拆解派发）
- `Deployment(static / zip)`（带 Permission Engine `shell.*` 审批）

**Entry Criteria**：

- V0.5 上线、OpenCode Adapter 验证了 `AgentRuntimeAdapter` 抽象的鲁棒性（无需修改接口）
- Run Detail 7 tab 在真实任务下信息齐全、用户能不依赖 Debug Panel 排查问题
- mailbox + pending_turn 在多并发场景下没有 ghost delivery / lost turn 报告

**Non-Goals**：不做 War Room（V1.5）；不做 Plugin（V1.3）；不做 A2A（V1.3）；不做桌面壳（V1.4）。

#### V1.1 协作可视化（4–6w）

**Goals**：V1.0 的 Squad / Team 产生大量复杂 Run / Task 图，聊天流看不全；V1.1 用独立视图层呈现协作结构。

**核心交付**：

- `task-board` capability：Trello / Linear 风格 Kanban（Backlog / In Progress / Waiting / Review / Done）；新建 capability 不污染 messaging 卡片协议
- `collab-visualization` capability：先做 **Timeline**（按时间轴展示 agent wake/run/complete，traceId 串联）；Topology / Dependency 视图顺延到 V1.1 末尾或挪到 V1.2
- 新增 durable 事件：`task.column.moved` / `task.priority.changed` / `task.assigned.changed`

**Entry Criteria**：

- V1.0 在真实多 agent 任务（≥ 3 agent，≥ 5 task）下稳定跑通
- 用户反馈"看不清协作结构"在调研中明确出现

**Non-Goals**：不做 Topology / Dependency 视图（V1.2）；不做 Skill / Memory（V1.2）。

#### V1.2 上下文真生效（6–8w）

**Goals**：让 confirmed Context Item 真实影响 prompt（不只是规则路径）；引入混合记忆。

**核心交付**：

- `skill-system`（声明式，无代码执行）：兼容 Claude Code `.skill` 形态，热加载
- `bm25-recall`：Context Ledger FTS5 关键词召回
- `vector-search`（sqlite-vec）：替换 NoopVectorIndex
- `memory-gateway`：**混合记忆**（local + 外部 backend 同时启用，按 visibility 路由）
- Topology / Dependency 视图（V1.1 顺延项）

**Entry Criteria**：

- V1.1 Kanban + Timeline 用户跑通 ≥ 2 周
- 用户在 V1.0/V1.1 阶段累积 ≥ 50 条 confirmed Context Item，能验证召回质量

**Non-Goals**：不做 Plugin（V1.3）；不做 LangGraph（V1.3）。

[DECISION-NEEDED-V1.2-A]：混合记忆的外部 backend 选 Mem0（成熟、商用倾向）vs ReMe（更轻、自主可控）。本阶段开工前裁决。

#### V1.3 生态打开（6–8w）

**Goals**：把"外部代码进 daemon"统一通过 plugin-system 的隔离基座做掉——Plugin / LangGraph Adapter / A2A Server+Client 共享同一套 worker / subprocess 隔离基础设施。

**核心交付**：

- `plugin-system`（worker / subprocess 隔离 + manifest + permission 沙箱）
- `langgraph-adapter`（Python AI worker，验证 plugin 隔离基座）
- `a2a-server`（暴露本地 AgentProfile）+ `a2a-client`（导入外部 agent 进 Room）

**Entry Criteria**：

- V1.2 Skill System 至少有 3 个内置 skill 在生产使用
- Memory Gateway 混合策略验证过（local + 外部 backend 召回结果合并无冲突）

**Non-Goals**：不做桌面壳（V1.4）；不做 Docker Deploy（V1.4）。

[DECISION-NEEDED-V1.3-A]：LangGraph subprocess 通信选 stdio JSON-RPC（简单）vs gRPC（结构化但重）。

#### V1.4 多端适配（4–6w）

**Goals**：覆盖载体——桌面、移动浏览器、容器化部署。

**核心交付**：

- `desktop-shell-tauri`：Tauri 桌面壳（Rust 栈与 plugin 隔离一致；不做 Electron）
- `responsive-web`：触屏适配 + PWA 离线壳 + SSE query token fallback
- `deployment-docker`：Artifact `subkind="docker"` 经 `shell.docker = ask`
- 前端美化轮次 2：设计语言收口、主题、密度、a11y

**Entry Criteria**：

- V1.3 Plugin 隔离基座在 ≥ 2 个真实 plugin 下稳定
- 用户反馈中出现"想在手机上审批" / "想在桌面 dock 看通知"

**Non-Goals**：不做 Mobile Native（红线 D32）；不做 Electron（只做 Tauri）。

#### V1.5 高级编排（6–8w）

**Goals**：闭环最复杂的多 agent 模式 + 表达式权限。

**核心交付**：

- `war-room-mode`：自由协作型多 agent，Leader 仲裁 + 多 agent 同时持锁 + 终止条件（共识 / 超时 / 用户中止）
- `permission-dsl`：从枚举 ask/allow/deny 进化到表达式（`if mime ∈ image && size < 1MB then allow`），适配 plugin / skill 生态的复杂场景

**Entry Criteria**：

- V1.4 多端适配上线、整体功能闭环
- Plugin / Skill 生态有 ≥ 5 个第三方贡献

**Non-Goals**：本阶段后路线进入"维护 + 按需求驱动迭代"模式，不再预设新主题。

### 路线红线交叉引用

- 所有阶段遵守 D32（单机本地、永不云端 / 多用户 / SaaS / Mobile Native）
- 所有阶段不引入 Postgres / Redis / pgvector / NATS / Kafka（D3 + D32）
- 所有阶段不修改 envelope schema / Adapter 接口 / ContextItem 模型 / PermissionResource enum / local-daemon 启动流程（v1-roadmap "后续阶段接入清单"）

### Roadmap 决策记录（防漂移）

| ID | 主题 | 决定 | 备选已否决 |
|---|---|---|---|
| Roadmap-1 | V0.5 第二 adapter | OpenCode | Codex |
| Roadmap-2 | A2A 方向 | server + client 双向（V1.3） | 仅 server |
| Roadmap-3 | 桌面壳协议 | Tauri | Electron |
| Roadmap-4 | War Room 阶段 | V1.5 | V1.0 |
| Roadmap-5 | Plugin 阶段 | V1.3 | V0.5（绑 Skill 一起做） |
| Roadmap-6 | Skill vs Plugin | 拆分（Skill 无代码 V1.2，Plugin 有代码 V1.3） | 绑同一阶段 |
| Roadmap-7 | Memory 类型 | 混合记忆（local + 外部 backend 按 visibility 路由） | 仅外部 backend / 仅 local |
| Roadmap-8 | Topology/Dependency 视图阶段 | V1.1 末尾或 V1.2 | V1.1 必做 |
| Roadmap-9 | Mobile 方向 | 响应式 Web + PWA（V1.4） | Native iOS / Android |
| Roadmap-10 | 团队协作云端 | 永不做（D32 红线） | V2 团队云端 |

## Risks / Trade-offs

- **R1（范围蔓延）**：Spec 完整度高 → 容易顺手做 V1。Mitigation：tasks.md 每条强制引用 MVP spec 的具体 requirement，未引用的不开工。
- **R2（Effect 学习曲线）**：团队若不熟 Effect，Bus / Permission 容易写错。Mitigation：限定 Effect 只在内核（D4），domain 用 plain TS；Week 1 先建 EventBus + Permission 的 Effect 基础设施 + golden path 测试。
- **R3（Adapter 真实能力差异）**：Claude Code 提供的事件 ≠ OpenCode ≠ Codex。Mitigation：MockAdapter 先打通；MVP = ClaudeCode；V0.5 = OpenCode；Codex 推到 V1.x 视需求引入，引入时明确降级 UI。Adapter manifest 的 `reliability.level` / `eventSource` / `crashRecovery` 由 UI 显式呈现，避免用户误以为所有 adapter 行为一致。
- **R4（多 tab 同步）**：原稿明确"必须测试同一用户多 tab 场景"。Mitigation：SSE 天然 broadcast；client-side projector 用 cursor 重连，避免漏事件。
- **R5（SQLite 并发写）**：写多读少时 WAL 仍有阻塞。Mitigation：所有 durable 事件顺序写；读路径全异步；并发上限内单机够用。**路线红线（D32）**：永不切 Postgres——AgentHub 是单机本地产品，并发上限通过队列设计 + 锁矩阵控制，而非靠数据库横向扩展。
- **R6（Prompt Injection）**：外部文件可能含"ignore previous instructions"。Mitigation：① Agent 读取的文件内容包在 `<external_content>` 块里 ② Permission Engine 不为 Agent 自动提升权限 ③ 任何 tool 调用必经审批。
- **R7（Bun 兼容性）**：node-pty / isomorphic-git 在 Bun 仍有边角问题。Mitigation：D5 写死的纪律，CI 同时跑 Bun + Node 22。
- **R8（Codex 介入体验差）**：next_turn / next_session 注入会让用户觉得"敲门没用"。Mitigation：UI 必须显示能力级别提示；建议 Codex 用户用 Assisted Mode 而非 War Room。
- **R9（用户审批疲劳）**：每文件每次弹 → 用户烦。Mitigation：D11 的"项目内 / 项目外 / 敏感"三档 + "本项目总是允许"。
- **R10（DLQ 阻塞活锁）**：handler 失败把 cursor 卡住会阻塞同 handler 后续所有事件。Mitigation：bus-runtime 设置 5 次重试上限 + DLQ + Debug Panel `Skip` 操作；同时 `handler.stalled` durable 事件触发 UI 提示，用户能在感知到阻塞时主动处置。
- **R11（CommandBus / EventBus 分离学习成本）**：开发者容易在 HTTP handler 里直接 publish event。Mitigation：ESLint 自定义规则 `no-direct-event-publish-from-http` + code review checklist + Week 1 内核搭好后写一篇内部 cookbook。
- **R12（observe→wake 改造影响调度）**：把 observer 从"事件触发"改成"显式 WakeAgent Command"会重写 Orchestrator rule 引擎；如果实现时仍混入旧路径，会出现"agent 偶尔自己醒"的不确定行为。Mitigation：rule 注册阶段强校验 action.type='wake'；CI 跑一组对照用例（observer 在 100 条 message 流过后调用 LLM = 0 次）；MockAdapter 用 spy 计数。
- **R13（ArtifactFS shadow 与 git worktree 同步）**：Run 内 ACP fs.readTextFile 必须读到 shadow 写后的最新内容，否则 Agent 会看到自己刚写的文件还是旧的、产生不可调试的"幻觉编辑"。Mitigation：worktree 模式下 read 直接读盘（rename 后 fs 一致）；shadow_buffer 模式下 ArtifactFS.read 必须先查内存 Map 再回落真实 workspace；MockAgentScript 增 `verify_read_after_write` 测试 step。
- **R14（双投影一致性）**：同一 durable event 的 visibility 标记若与 SSE view 过滤不一致，会出现"主流缺信息"或"详情漏掉重要 card"。Mitigation：visibility 由 event schema 定义不在 publish 时手填；spec 中给完整事件→visibility 矩阵；CI 对每个 event 类型都要求显式标 visibility（否则编译失败）。
- **R15（PendingTurn 滚雪球）**：用户在 agent 长任务里堆 20 条排队，最终触发 IM 体验崩盘。Mitigation：UI 早在 15 条时 banner 警告；20 条 429 + 强制取消；rate limit per workspace 也要并行限制。
- **R16（双调度入口）**：旧设计里 `message.created → StartRun` 与 `WakeAgent → StartRun` 两条路径并存，会让 token 计费、mailbox claim、activeWakes 分叉。Mitigation：D30 终局收紧 — 直接把 `StartRun` 从 Command union 移除，CommandBus 类型系统层就不存在；`WakeAgent` handler 在 IMMEDIATE 事务内调 `RunLifecycleService.create` 是 `agent.run.queued` 的唯一来源；CI `command:check` 同时校验"无任何模块 dispatch 类型为 StartRun 的 Command"。
- **R17（CI 校验缺位）**：`openspec validate --strict` 只查 spec 格式，不查 schema 一致性；实现时引用未登记的 event / Command / handler / state transition / visibility 不会被察觉。Mitigation：D31 引入 5 条 custom CI（events / visibility / subscriptions / command / run-state-machine），M0 阶段就跑通，每次 PR 必跑。
- **R18（preview iframe 同源风险）**：`allow-same-origin` 让 agent 生成的 HTML 可借同源策略读 daemon API。Mitigation：D17 收紧为独立 origin + sandbox `allow-scripts only` + CSP 严格 + token 一次性。

## Migration Plan

本 change 是空仓库起步，没有 migration。但需明确：

- **数据迁移**：events 表、context_items 表的 schema 变更走 Drizzle migrations，文件名 `<timestamp>__<purpose>.sql`。
- **事件 schema 演进**：见 D6（只增不删 + EventMigrator）。
- **回滚**：MVP 阶段 = 删除 `~/.agenthub/` 目录 + `<workspace>/.agenthub/`。

## Open Questions

按 `[DECISION-NEEDED-N]` 索引汇总，等用户 review 时一并裁决。下方"推荐"列即本文给出的默认值，spec 已按推荐落实；如用户改主意，对应位置与 spec 同步修订。

| ID | 主题 | 本文推荐 | 备选 |
|---|---|---|---|
| 1 | SQLite `mmap_size` / `page_size` | 256 MB / 4 KB | 视实测调，可降到 64 MB |
| 2 | 多 Agent 改同文件冲突策略 | 文件级互斥锁 + 排队 | 自动 merge（V1.5） |
| 3 | Token 预算分配 | 15/20/15/25/15/10% | 按场景自适应（V1.2，向量召回上线后） |
| 4 | 远程 token 协议 | 32 字节随机 + Bearer，30 天 | OAuth / 刷新 token（V1.4 评估，本地产品大概率不做） |
| 5 | Preview iframe 沙箱 | `sandbox="allow-scripts"` 独立 origin + 临时 token URL | 完整 CSP / postMessage 通道（V1.0） |
| 6 | 消息操作集合 | 复制 / 引用 / 重生成 / 应用 Diff / Pin / 删除 | 加：Pin to context / Star / Bookmark（V1.1，task-board 一并做） |
| 7 | Prompt 系统语言 | 英文 + 模板化 | 中文 + 双语切换（V1.4 前端美化阶段） |
| 8 | 向量召回 top-k | 8（V1.2 才生效） | 自适应 budget-bounded |
| 9 | MockAgentAdapter DSL | 7 个 step 类型 | 加：fork / parallel / signal（V1.0 复杂调度时扩） |

也包含一些**结构性 / 战略性 Open Questions**：

- **Q-A**：Adapter 第二顺位选 Codex 还是 OpenCode？OpenCode 走 server/SDK 较结构化；Codex 受众广但事件弱。**已决（2026-05-23）**：V0.5 选 **OpenCode**；Codex 推到 V1.x（具体子阶段视实际需求）。
- **Q-B**：是否在 MVP 内引入 Bun 测试 runner（`bun test`）还是统一 vitest？本文推荐 vitest（生态成熟、Bun/Node 双跑），spec 已按 vitest 落实。
- **Q-C**：Workspace 目录结构是单 `~/.agenthub/`（用户级）还是 `<project>/.agenthub/`（项目级）？本文推荐**双层**：用户级存全局配置 + 房间历史；项目级存项目相关 workspace + isolated copy；Cross-link 用 workspaceId。
- **Q-D**：是否在 MVP 提供 CLI（`apps/cli`）？本文推荐**最小 CLI**：`agenthub start` / `agenthub stop` / `agenthub status` / `agenthub doctor`（健康检查），不做完整 REPL。

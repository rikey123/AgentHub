# v1-roadmap Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: V1.0 Deployment(static / zip) 占位（deployment-static-zip）

The system SHALL define Artifact `type=deployment` with subkind enum and route through Permission Engine (`shell.*` resource), but MVP MUST NOT implement any concrete protocol; V1.0 SHALL implement two subkinds:

- `deployment.static-site`：daemon 内置 HTTP 静态服务，临时 URL 30 分钟过期
- `deployment.zip`：打包源码 zip 供下载

`deployment.docker` 推迟到 V1.4（多端适配阶段一并做容器化）。

#### Scenario: MVP 静态部署

- **WHEN** `POST /artifacts { type: "deployment", subkind: "static-site", ... }`
- **THEN** MVP 返回 501 + `{ error: "deployment-static-zip is V1.0" }`

### Requirement: V1.1 Task Board 占位（task-board）

The V1.1 task-board capability SHALL be considered fulfilled. The Side Panel Tasks tab SHALL keep a clear default task list and expose the Kanban board from an "Open Kanban" control/modal. The system SHALL NOT return 404 for board-related operations.

**What V1.1 delivers:**
- Clear default task list plus Kanban board modal
- Drag-to-move columns with `task.column.moved` event
- Priority badge UI (priority changes use existing `task.activity.added { kind: "priority_change" }` — no new `task.priority.changed` event)
- Dependency arrows (visualization only; auto-dispatch is V1.2)
- File-change badge from `run_file_changes` via `run.file_changes.recorded` event
- Worktree apply/discard UI in task detail drawer
- "Execution Plan" card from `task_plans`

**What remains deferred:**
- `task.assigned.changed` event (V1.2)
- Topology / Dependency DAG views (V1.2)
- Full collaboration timeline (V1.2)

#### Scenario: V1.1 Kanban board is accessible

- **WHEN** the user opens the Side Panel Tasks tab in V1.1
- **THEN** the task list is displayed with an "Open Kanban" control; opening the board no longer returns the V1.0 placeholder 404

#### Scenario: V1.1 drag-to-move works

- **WHEN** the user drags a card to a different column
- **THEN** `task.column.moved` is published; all connected clients update without refresh

### Requirement: V1.1 多 Agent 协作可视化占位（collab-visualization）

V1.1 SHALL deliver the task-board foundation and dependency arrows. The system SHALL render dependency arrows between Kanban cards. The full collaboration timeline and topology views SHALL remain deferred to V1.2 and SHALL return 404 when accessed.

**What V1.1 delivers:**
- Dependency arrows between Kanban cards (visualization only)
- "Execution Plan" card in the side panel
- File-change badge per task

**What remains deferred to V1.2:**
- Timeline view (Jaeger-style agent wake/run/complete visualization)
- Topology view (who-waked-whom causation graph)
- Dependency DAG view (Task → SubTask → Run tree)

#### Scenario: V1.1 dependency arrows visible

- **WHEN** Task B depends on Task A and both are in the Kanban board
- **THEN** a dependency arrow is rendered from A to B; no 404 is returned for the board view

#### Scenario: Timeline view still returns 404 in V1.1

- **WHEN** the user navigates to `/timeline`
- **THEN** 404 is returned; the timeline view is V1.2

### Requirement: V1.2 Skill System 占位（skill-system）

The skill system placeholder SHALL be considered fulfilled in V1.1 (moved forward from V1.2). The system SHALL load skills from the `skills` table and SHALL NOT emit the V1.2 rejection warning. The V1.2 placeholder rejection (`"Skill <id> not loaded: skill system is V1.2"`) SHALL be removed.

**What V1.1 delivers:**
- Standard SKILL.md package format (compatible with Claude Code, OpenCode, AionUi, Multica)
- Builtin / workspace / imported skill origins
- Room-level skill pool and per-agent overrides
- Runtime-native materialization into `.claude/skills/`, `.opencode/skills/`, etc.
- Prompt-injection fallback for runtimes without native skill discovery
- Settings UI for skill management

**What remains deferred:**
- Skills marketplace / skills.sh integration (V1.3)
- Skill version management and update notifications (V1.3)
- Skill trust review workflow (V1.3)

#### Scenario: V1.1 skill system is active

- **WHEN** the user opens Settings → Skills in V1.1
- **THEN** the Skills tab is shown with builtin skills pre-loaded; the V1.2 placeholder rejection is no longer active

#### Scenario: Skill loader no longer rejects in V1.1

- **WHEN** the daemon starts with skills in `~/.agenthub/skills/`
- **THEN** skills are loaded normally; the V1.2 warning `"Skill <id> not loaded: skill system is V1.2"` is no longer emitted

### Requirement: V1.2 BM25 召回占位（bm25-recall）

The system SHALL ensure `context_items` table is FTS5-indexable (text columns: `content`, `title`, `tags`) so V1.2 can add BM25 keyword recall as the second path of Context Assembly (规则 → BM25 → Vector 三段). MVP MUST NOT enable FTS5 virtual table by default to avoid index overhead before recall is needed.

#### Scenario: MVP 用规则路径

- **WHEN** Context Assembly 装配 prompt
- **THEN** MVP 仅走规则路径（pinned > task-scope > recent confirmed > recent draft）；BM25 / Vector 都是 noop

### Requirement: V1.2 向量检索占位（vector-search）

The system SHALL define `VectorIndex` interface and provide `NoopVectorIndex` in MVP; V1.2 SHALL plug in `SqliteVecIndex` (sqlite-vec) without changing Context Assembly contract. V1.2 推荐默认 top-k = 8（D20）。

```ts
interface VectorIndex {
  search(query: string, k: number, filter?: ContextFilter): Effect.Effect<ContextHit[], never>
  upsert(item: ContextItem): Effect.Effect<void, never>
  remove(id: string): Effect.Effect<void, never>
}
```

#### Scenario: MVP 用 NoopVectorIndex

- **WHEN** Context Assembly 需要向量召回
- **THEN** NoopVectorIndex 返回 `[]`；assembly 走规则路径，不报错

### Requirement: V1.2 Memory Gateway 占位（memory-gateway）

The system SHALL define `MemoryAdapter` interface so V1.2 can plug in **混合记忆**（hybrid memory：local + external backend 同时启用，按 visibility 路由）。MVP 提供 `NoopMemoryAdapter`。

```ts
type MemoryEntry = {
  id: string
  workspaceId?: string
  agentId?: string
  type: "user_preference" | "project_fact" | "decision" | "agent_experience" | "tool_experience"
  content: string
  status: "candidate" | "confirmed" | "deprecated" | "forgotten"
  visibility: "private" | "workspace" | "agent" | "global"
  createdAt: number
  updatedAt: number
}

interface MemoryAdapter {
  id: string
  upsert(entry: MemoryEntry): Effect.Effect<void, MemoryError>
  search(query: string, filter?: MemoryFilter): Effect.Effect<MemoryEntry[], MemoryError>
  list(filter: MemoryFilter): Effect.Effect<MemoryEntry[], MemoryError>
  remove(id: string): Effect.Effect<void, MemoryError>
}

interface HybridMemoryRouter {
  route(entry: MemoryEntry): MemoryAdapter[]    // 决定哪些 adapter 写入
  merge(results: MemoryEntry[][]): MemoryEntry[] // 多 adapter 召回结果合并去重
}
```

V1.2 默认混合策略：`visibility=private/workspace` 走 LocalSqliteMemoryAdapter；`visibility=agent/global` 同时写 LocalSqliteMemoryAdapter + 外部 backend（Mem0 或 ReMe，**[DECISION-NEEDED-V1.2-A]**）。

#### Scenario: MVP 调 memory.search 返回空

- **WHEN** Agent 通过 V1.2 才有的 `room.search_memory` MCP tool 查询
- **THEN** MVP 阶段 tool 不暴露；调用返回 `tool_not_found`

### Requirement: V1.3 Plugin System 占位（plugin-system）

The system SHALL define a plugin manifest schema and loader interface so V1.3 can add third-party plugins; in MVP / V0.5 / V1.0 / V1.1 / V1.2 plugin loader SHALL refuse to load any plugin (to enforce safety until isolation is implemented).

```ts
type PluginManifest = {
  id: string
  name: string
  version: string
  entry: string                           // 相对路径
  permissions: PluginPermission[]
  isolation: "in_process" | "worker" | "subprocess"
  capabilities: ("mcp_tool" | "agent_adapter" | "ui_panel" | "event_subscriber")[]
}
```

V1.3 强制 `isolation in ("worker", "subprocess")`；`in_process` 永不允许。

V1.3 同时提供 `EventBus` 公开 API 给 plugin 订阅 durable 事件（按 visibility 过滤），这是 `bus-runtime` 的 EventBus 接口与 in-process PubSub 解耦的真正消费者。

#### Scenario: MVP 加载插件

- **WHEN** 启动时 `~/.agenthub/plugins/` 含一个 plugin
- **THEN** stderr 警告 `Plugin <id> not loaded: plugin system is V1.3`，不阻断 daemon 启动

### Requirement: V1.3 LangGraph Adapter 占位（langgraph-adapter）

The system SHALL ensure `AgentRuntimeAdapter` interface supports out-of-process adapters (subprocess via stdio or gRPC) so V1.3 can add `LangGraphAdapter` as a Python AI worker. LangGraph adapter is the first real consumer of plugin-system isolation infrastructure.

[DECISION-NEEDED-V1.3-A]：subprocess 通信选 stdio JSON-RPC（简单）vs gRPC（结构化但重）。

#### Scenario: MVP 创建 langgraph agent

- **WHEN** 用户创建 `provider="langgraph"` 的 Agent
- **THEN** MVP 返回 `adapter_not_found`；V1.3 起经 PluginManifest + subprocess 启动 Python worker

### Requirement: V1.3 A2A Server + Client 双向占位（a2a-server / a2a-client）

The system SHALL define both `A2AServer` and `A2AClient` interfaces. V1.3 SHALL implement both:

- **A2AServer**：把本地 AgentProfile 暴露为 `agent-card.json`，通过 daemon HTTP 暴露给同 LAN 或反向代理外的消费者
- **A2AClient**：把外部 A2A agent-card.json 注册成本地 Adapter，外部 agent 在 Room 内表现为远程 Adapter

```ts
interface A2AServer {
  publish(profile: AgentProfile): Effect.Effect<AgentCardUrl, A2AError>
  unpublish(profileId: string): Effect.Effect<void, A2AError>
}

interface A2AClient {
  importAgent(cardUrl: string): Effect.Effect<AgentProfile, A2AError>
  // 内部生成 RemoteA2AAdapter 实例，统一走 AgentRuntimeAdapter 接口
}

type AgentCardUrl = string                  // 完整 URL
```

#### Scenario: MVP 调 a2a server publish 返回 501

- **WHEN** 用户 `POST /a2a/publish/:agentId`
- **THEN** 返回 501 + `{ error: "a2a is V1.3", capability: "v1-roadmap" }`

#### Scenario: MVP 调 a2a client import 返回 501

- **WHEN** 用户 `POST /a2a/import { cardUrl: "..." }`
- **THEN** 返回 501 + `{ error: "a2a is V1.3", capability: "v1-roadmap" }`

### Requirement: V1.4 桌面壳占位（desktop-shell-tauri）

The system SHALL design Web UI so it can be hosted by Tauri in V1.4 with no fork; daemon SHALL be embeddable as child process. （Electron 不在路线内——只做 Tauri，更轻、Rust 栈与未来插件 isolation 一致。）

技术承诺：

- daemon CLI 支持 `--ipc-fd <fd>` 用于桌面 host 的 IPC 通信（V1.4 才用，MVP 不实现 fd 模式但保留 flag 占位）。
- Web UI 不依赖 `window.location.origin` 假设特定 host（已用相对 URL）。
- 文件选择 / 系统通知通过 abstract `SystemBridge` 接口；MVP 提供 `BrowserSystemBridge`，V1.4 加 `TauriSystemBridge`。

#### Scenario: Web UI 在 file:// 协议下也能跑

- **WHEN** 通过 Tauri 加载 `file://path/to/index.html` 配 daemon
- **THEN** （V1.4）UI 通过配置的 daemon URL 工作；MVP 不强制此能力但不阻塞

### Requirement: V1.4 响应式 Web 占位（responsive-web）

The system SHALL ensure all daemon APIs are reachable over HTTPS with `auth.token`, and SSE works through standard EventSource without custom headers (use query param token fallback). 路线红线：**不做 Mobile Native Client**；移动端审批 / 触屏体验通过响应式 Web + PWA 离线壳满足。

```
GET /event?token=<token>          # 移动端 EventSource fallback（无 Authorization header）
```

MVP 实现 query token fallback；响应式 UI 与 PWA manifest 在 V1.4 落地。

#### Scenario: SSE 通过 query token

- **WHEN** 客户端 `EventSource('/event?token=...')`
- **THEN** middleware 接受 query token，校验同 Bearer

#### Scenario: MVP 触屏体验残缺

- **WHEN** 用户在手机浏览器打开 daemon URL
- **THEN** MVP 体验残缺（三栏桌面布局）；V1.4 起响应式适配 + PWA 离线壳

### Requirement: V1.4 Docker Deploy 占位（deployment-docker）

The system SHALL keep Artifact `type=deployment` schema so V1.4 can add `subkind="docker"` (调用 docker CLI 经 Permission Engine `shell.docker = ask`)。Static / zip 子能力在 V1.0 就已落地，docker 单独推到 V1.4 是因为它依赖容器化的多端打包讨论。

#### Scenario: V1.4 docker 部署

- **WHEN** （V1.4）用户 `POST /artifacts { type: "deployment", subkind: "docker", ... }`
- **THEN** （V1.4）daemon 调 docker CLI（经 Permission Engine `shell.docker = ask`）

### Requirement: V1.5 War Room 模式占位（war-room-mode）

The system SHALL accept `mode = "war_room"` at the Room creation API level but reject with 501 until V1.5. War Room 是最复杂的多 agent 模式（自由协作 + Leader 仲裁 + 多 agent 同时持锁 + 终止条件：共识 / 超时 / 用户中止），依赖 V1.0 Squad/Team 引擎 + V1.3 Plugin 隔离 + V1.1 协作可视化做底子。

#### Scenario: 创建 war_room

- **WHEN** `POST /rooms { mode: "war_room", ... }`
- **THEN** MVP / V0.5 / V1.0 / V1.1 / V1.2 / V1.3 / V1.4 返回 501 + `{ error: "war_room mode is V1.5", capability: "v1-roadmap" }`

### Requirement: V1.5 Permission DSL 扩展占位（permission-dsl）

The system SHALL keep `PermissionRule` schema extensible. MVP 仅支持枚举 `ask / allow / deny`；V1.5 SHALL add expression-based rules so plugin / skill ecosystem can express finer-grained policies (`if mime ∈ image && size < 1MB then allow`)。MVP 的 PermissionRule 行为不变，DSL 引擎在新字段 `rule.expr` 启用时才介入。

```ts
type PermissionRule =
  | { decision: "ask" | "allow" | "deny" }                    // MVP
  | { decision: "expr"; expr: string }                        // V1.5
```

#### Scenario: MVP 配置 expr 规则

- **WHEN** 用户在配置文件用 `decision: "expr"`
- **THEN** MVP 启动时拒绝加载该规则 + stderr 警告 `Permission DSL is V1.5, falling back to ask`

### Requirement: 后续阶段接入清单（验收）

The MVP implementation SHALL verify that adding any V0.5+ capability does NOT require:

- 修改 `event-system` capability 的 envelope schema（traceId / causationId / correlationId / visibility 字段已稳定）
- 修改 `adapter-framework` 的 `AgentRuntimeAdapter` 接口
- 修改 `context-ledger` 的 ContextItem 模型
- 修改 `permissions` 的 `PermissionResource` enum 主结构
- 重写 `local-daemon` 的启动 / 关闭流程
- 修改 `bus-runtime` 的 CommandBus / EventBus 接口（plugin-system 是其首批外部消费者）

#### Scenario: V1.2 vector-search 接入不破内核

- **WHEN** （V1.2）实现 sqlite-vec adapter 替换 NoopVectorIndex
- **THEN** Context Assembly 代码 0 行变更；只需在 daemon 启动时绑定 Layer

#### Scenario: V1.3 a2a server 不改事件协议

- **WHEN** （V1.3）实现 A2A Server publish AgentProfile
- **THEN** 不需要新增任何事件类型（外部 A2A 调用复用现有 `agent.run.*` 事件流）

#### Scenario: V1.3 plugin 订阅 EventBus

- **WHEN** （V1.3）插件声明 `capabilities: ["event_subscriber"]` 并订阅 `agent.run.*`
- **THEN** EventBus 公开 API 接受订阅；内核 0 行变更


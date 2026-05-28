# v1-roadmap Specification

## Purpose
TBD - created by archiving change add-agenthub-mvp. Update Purpose after archive.
## Requirements
### Requirement: V1.0 Squad / Team 模式占位

The system SHALL accept `mode in ("squad", "team")` at the Room creation API level (data model already supports it per `rooms` capability) but reject with 501 in MVP and V0.5; V1.0 SHALL implement Squad（长期 Leader 路由）+ Team（任务拆解派发）共享同一 Orchestrator dispatch 引擎。

`war_room` mode is reserved for V1.5（见 `war-room-mode`）。

#### Scenario: 创建 squad room

- **WHEN** `POST /rooms { mode: "squad", ... }`
- **THEN** MVP / V0.5 返回 501 + `{ error: "squad mode is V1.0", capability: "v1-roadmap" }`

#### Scenario: 创建 team room

- **WHEN** `POST /rooms { mode: "team", ... }`
- **THEN** MVP / V0.5 返回 501 + `{ error: "team mode is V1.0", capability: "v1-roadmap" }`

### Requirement: V1.0 Deployment(static / zip) 占位（deployment-static-zip）

The system SHALL define Artifact `type=deployment` with subkind enum and route through Permission Engine (`shell.*` resource), but MVP MUST NOT implement any concrete protocol; V1.0 SHALL implement two subkinds:

- `deployment.static-site`：daemon 内置 HTTP 静态服务，临时 URL 30 分钟过期
- `deployment.zip`：打包源码 zip 供下载

`deployment.docker` 推迟到 V1.4（多端适配阶段一并做容器化）。

#### Scenario: MVP 静态部署

- **WHEN** `POST /artifacts { type: "deployment", subkind: "static-site", ... }`
- **THEN** MVP 返回 501 + `{ error: "deployment-static-zip is V1.0" }`

### Requirement: V1.1 Task Board 占位（task-board）

The system SHALL expose `tasks` table (per `orchestrator/最小 Task 数据模型` Requirement) and task lifecycle events (`task.created`, `task.assigned`, `task.status.changed` 已在 MVP 注册，其中 `task.status.changed { nextStatus: "completed" }` 是任务完成的唯一权威信号) so V1.1 can build a Trello/Linear-style Kanban board purely as a view-layer capability. The `task-board` capability is **a new capability** independent from `messaging` to avoid polluting card protocol.

V1.1 SHALL add new durable events:

- `task.column.moved`：列变更（Backlog / In Progress / Waiting / Review / Done）；`board_column` 是 view-layer 字段，与 `Task.status` **派生映射**（默认 `pending→Backlog`, `in_progress→In Progress`, `blocked→Waiting`, `review→Review`, `completed→Done`），用户可在 Board 拖卡覆盖默认映射，被覆盖的 column 持久化在新增字段 `tasks.board_column`（**V1.1 新加列**，MVP 不存在），但不修改底层 `Task.status`
- `task.priority.changed`：优先级变更（`priority` 列已由 MVP 预留，默认 0；**V1.1 只启用此事件和 UI 操作**，不新加列）
- `task.assigned.changed`：assignee 变更（区别于 MVP 的 `task.assigned` 创建/初次分配事件）

These events SHALL NOT introduce new internal state machines on top of MVP `Task.status`；它们是 projection 层的 metadata event，consumer 乐观应用，不参与 orchestrator 调度。

#### Scenario: MVP 没有 Kanban

- **WHEN** 用户访问 `/board`
- **THEN** MVP 返回 404；V1.1 起返回 Kanban view

#### Scenario: V1.1 列变更事件

- **WHEN** （V1.1）用户在 Kanban 拖卡到 In Progress
- **THEN** （V1.1）daemon 发 `task.column.moved` durable event，所有客户端通过 SSE 同步

### Requirement: V1.1 多 Agent 协作可视化占位（collab-visualization）

The system SHALL preserve `traceId / causationId / correlationId` in event envelope (per event-system capability) and `agent.run.*` lineage so V1.1 can build collaboration views without new internal events. V1.1 SHALL ship two views first（Topology / Dependency 顺延到 V1.2）:

- **Timeline**：按时间轴展示各 agent 的 wake/run/complete（类 Jaeger trace 视图），traceId 串联
- **Kanban**：见 `task-board`

V1.2 SHALL add:

- **Topology**：当前活跃 agent 之间的 wake 因果图（who-waked-whom，箭头标 wakeReason）
- **Dependency**：Task → SubTask → Run 树形依赖

#### Scenario: MVP 无可视化

- **WHEN** 用户访问 `/timeline`
- **THEN** MVP 返回 404；V1.1 起渲染 timeline

#### Scenario: V1.1 traceId 串联

- **WHEN** （V1.1）用户在 timeline 选中某 trace
- **THEN** （V1.1）展示该 traceId 下所有 `agent.run.*` 事件，时间轴 + 因果箭头

### Requirement: V1.2 Skill System 占位（skill-system）

The system SHALL define `Skill` schema (declarative, no code execution) and a loader interface so V1.2 can plug skills under `~/.agenthub/skills/` for hot-loading.

```ts
type Skill = {
  id: string                              // kebab-case
  name: string
  version: string
  description: string
  prompt: string                          // 注入 agent system prompt 的片段
  tools: string[]                         // 工具白名单（MCP tool id）
  triggers: SkillTrigger[]                // 触发条件（@mention / pattern / explicit）
  visibility: "global" | "workspace" | "agent"
}

type SkillTrigger =
  | { kind: "mention"; pattern: string }
  | { kind: "context"; match: string }
  | { kind: "explicit" }                  // 仅显式调用
```

Skill 与 Plugin 区别：Skill **无代码执行**，纯声明 + prompt + tool 白名单；Plugin（V1.3）含代码执行 + 进程隔离。

MVP / V0.5 / V1.0 / V1.1 阶段 skill loader 全部拒绝；V1.2 起加载。

#### Scenario: MVP 加载 skill

- **WHEN** 启动时 `~/.agenthub/skills/` 含一个 skill 文件
- **THEN** stderr 警告 `Skill <id> not loaded: skill system is V1.2`，不阻断 daemon 启动

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


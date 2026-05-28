# add-v10-orchestration

> **状态**：初稿 · 待评审
> **目标周期**：12–16 周（V1.0；范围比早期估算更大，原因见下文）
> **基线**：`openspec/specs/`（V0 + V0.5 已合并的 17 个 capability）
> **路线引用**：`openspec/changes/archive/2026-05-24-add-agenthub-mvp/design.md` "Roadmap Beyond MVP" V1.0 章节（**本 change 的范围比该章节更大**：在 Squad/Team 之外加入 Role/Runtime 解耦、Native Runtime、Settings UI、Task Workflow Core）
> **形态**：Web-only（桌面 / A2A / 响应式 / Docker / Deployment 全部下放 V1.x）

> **重要范围说明**：早期路线把 V1.0 定义为"Squad + Team + Deployment(static/zip)"。V0.5 真实落地后用户反馈表明：单做 Squad/Team 不能解决"装完没法用"和"角色绑死后端"两个产品阻塞，会再次掉进多 agent 互相寒暄循环的坑。V1.0 因此扩展为"产品基座 + 协作语义"双主线；**Deployment(static/zip) 推迟到 V1.4** 与 Tauri / 响应式 / Docker 一起做（部署类聚合）。

## Why

V0.5 把 AgentHub 打磨成了"愿意每天用的本地多 agent 聊天工作台"，但与对标产品（AionUi Cowork / multica 任务系统）相比仍存在三个**结构性差距**，靠继续打磨聊天 UI 解决不了：

**1. 角色与 Runtime 绑死**：当前 `AgentProfile` 把 Persona（名字 / prompt / capabilities）+ Runtime（claude-code / opencode / mock）+ Model（model id / api key 路径）压在一起。同一个"代码审查员"角色必须复制三份才能跑在三个 runtime 上。V1.0 之后任何 Team / Skill / Memory 都会基于这个错模型展开，迁移成本只会越来越大。

**2. 装完没法用**：V0.5 仍要求用户先装 Claude Code 或 OpenCode CLI、自己理解 daemon / agent profile / provider 概念才能用。AionUi 的 built-in agent 让用户填一个 API key 就能跑，AgentHub 在这条体验线上落后明显。Settings UI 缺位也让"换模型 / 换 provider / 配额检查"无法在产品内完成。

**3. 多 agent 协作没有非聊天载体**：MVP 已落最小 Task 模型，但 V0.5 没把它产品化为操作面。如果 V1.0 只做 Squad/Team 的聊天版本，多 agent 互相 @、互相 mailbox，仍是聊天驱动协作 —— 我们已经在 V0.5 测试中见过这个循环模式。multica / AionUi Team Mode 的关键不是"多个 agent 在聊天",而是 "Task 是工作单元 + Agent 是 assignee + Run 是执行历史"的 task-first 心智。

V1.0 解决这三件事：

- **拆 Role / Runtime / ModelConfig / AgentBinding 四个概念**（结构性地基）
- **建 Native Agent Runtime**（对齐 AionUi built-in 能力线，不对齐 Claude Code 内部代码智能）
- **建完整 Settings UI**（Agents / Runtimes / Models / Permissions / Workspace / MCP 六大页）
- **实现 Team Mode / Squad Mode 协作语义**（Leader 派发 + teammate 执行 + mailbox 通知）
- **引入 Task Workflow Core**（Task-first 心智，含 activity timeline + 最小 board view）
- **AI 生成角色草稿**（设置页内）

## What Changes

> 全部基于 `openspec/specs/` 基线增量；**9 个新独立 capability** + 多个 MODIFIED capability（含 `event-system` 必须修订以注册 V1.0 新事件）。

**Role / Runtime / Model / Binding 四概念解耦（最大结构变更）**

- `role-system`（**NEW**）：定义 `Role`（Persona）独立实体——id / name / avatar / description / prompt / capabilities / default permission profile / tags。Role 不绑定 runtime / model。从 markdown 加载（`~/.agenthub/roles/*.md`），与现有 agent profile 兼容并行（旧 agent_profiles 行迁移成 role + binding 对）。
- `runtime-settings`（**NEW**）：定义 `Runtime`（执行后端）独立实体——id / kind（claude-code / opencode / native / custom-acp）/ command / args / env / detected status / supported capabilities。可在 Settings UI 检测 / 配置 / 测试连接。
- `model-provider-settings`（**NEW**）：定义 `ModelConfig`（模型配置）独立实体——provider（openai / anthropic / google / openai-compatible / ollama）/ model id / baseURL / api key ref / temperature / max tokens。API key 走 OS Keychain（V0 KeychainBridge 已就位），SQLite 仅存 ref。
- `agents`（MODIFIED）：`AgentProfile` 重命名为 `AgentBinding`——`role_id + runtime_id + model_config_id?`，把 Role 与 Runtime 在 Room 创建时绑定。旧 AgentProfile 通过 migration 拆成 role + binding。
- `rooms`（MODIFIED）：Room 创建时不再选 agent profile id，而是选 role + runtime（model_config 可选，仅 native runtime 必需）。

**Native Agent Runtime（V0.5 之后的内置引擎）**

- `native-agent-runtime`（**NEW**）：实现 AgentHub 自带的 agent runtime，对齐 AionUi built-in agent 的能力线（**明确不**对齐 Claude Code 内部代码智能）：
  - 模型层用 Vercel AI SDK（`ai` + `@ai-sdk/openai` / `@ai-sdk/anthropic` / `@ai-sdk/google` / `@ai-sdk/openai-compatible`），不自研 provider 协议；
  - 支持 streaming / tool calling / cost reporting / cancel；
  - 工具集复用 AgentHub Room MCP tools + Task tools + 文件读写（经 Permission Engine）+ shell（经 Permission Engine）；
  - 实现 `AgentRuntimeAdapter` 接口（不绕过 adapter-framework），自然兼容 RunLifecycle / Run Detail / Cost Panel / mailbox / activeWakes。
- `adapter-framework`（MODIFIED）：注册 NativeAgentAdapter 为第三种真实 adapter（前两个 ClaudeCode / OpenCode）；manifest 声明 `runtimeKind: "native"`。

**Settings UI（产品化关键）**

- `settings-ui`（**NEW**）：六个一级页面：
  - **Agents / Roles**：角色列表 + 新建 / 编辑 / 删除 + AI 生成角色草稿入口；
  - **Runtimes**：Claude Code / OpenCode / Native / Custom ACP 检测状态 + command/args/env 配置 + test connection；
  - **Models**：provider 配置 + API key 输入（写 keychain）+ baseURL + 模型列表 + test model call；
  - **Permissions**：内置三档 profile（builder-strict / builder-loose / read-only）+ 自定义；
  - **Workspace**：workspace root / worktree mode / artifact storage / attachment limits / cleanup；
  - **MCP / Tools**（V1.0 仅只读 + 占位入口，V1.x 加完整管理）：已启用 Room tools 列表 + 外部 MCP server placeholder。
- `web-ui`（MODIFIED）：FeatureRail / TopBar 加 Settings 入口；命令面板加 "Open Settings" 命令；删除 V0.5 内联的零散设置入口。

**AI 生成角色草稿**

- `role-generator`（**NEW**）：用户在 Settings UI Agents 页输入自然语言（"帮我生成一个擅长前端重构的 reviewer"）+ 选择生成用的模型，产出 `name / description / prompt / capabilities / suggested permission profile`；用户 review 草稿后再保存（**不**自动静默创建）。生成 API（REST job polling）：`POST /roles/generate { description, targetWork?, preferredTone?, capabilities?, modelConfigId } → 202 { jobId }`；UI 轮询 `GET /roles/generate/jobs/:jobId → { status, draftJson?, error? }`；取消用 `DELETE /roles/generate/jobs/:jobId`；用户确认后 `POST /roles` 才 emit `role.created`。

**Team Mode + Squad Mode（协作语义）**

- `team-mode`（**NEW**）：任务拆解派发。Room.mode='team' 时 Leader 接收用户消息后用 `room.delegate` MCP tool（V1.0 新增）拆 Task，每个 Task 带 `assignee_role_id`（**Role 而非具体 AgentBinding**）。dispatch 时由 Room 的 binding 表把 role 解析成具体 runtime；Task 完成后 Leader 在 review 阶段 approve / 重做。
- `squad-mode`（**NEW**）：长期 Leader 路由（轻量场景）。Leader 接收用户消息后调 `room.delegate { expectsReview: false }` 派给 teammate；该调用**仍然创建 Task** 但走"轻量 Task" 路径——`status` 走 `pending → in_progress → completed`（**跳过** `review`），`expectsReview=false` 时 teammate Run 终结自动转 completed，Leader 通过 mailbox + `task.delegation.completed` 事件 wake。**不创建 Task** 是 V0.5 多 agent 循环坑的复发风险，V1.0 修正后 Squad 与 Team 共享同一 Task 状态机，仅在 review 流上有区别。
- `orchestrator`（MODIFIED）：`Room MCP Tools` 加 `room.delegate`；`最小 Task 数据模型` 升级（启用 assignee_role 调度 + status 转移触发 Leader wake）；新增 `Squad 模式调度` / `Team 模式调度` Requirement；`V1.0 / V1.1 / V1.2 占位（Team / Squad / Board / DAG）` 移除 squad / team 项。
- `bus-runtime`（MODIFIED）：`RunQueue 是 bus 的一条命名队列` MODIFIED，明确多 Agent 并行调度的锁矩阵语义（含 squad/team 场景下的 file/workspace 互斥示例）。
- `rooms`（MODIFIED，含 V1.0 squad/team 配置）：Room 数据模型加 `leader_role_id`（替代早期方案 `leader_agent_id`，因为 V1.0 Role 已独立）；`Post-MVP Mode 占位` 中 squad / team 升级为正式 mode。

**Task Workflow Core（task-first 心智）**

- `task-workflow-core`（**NEW**）：把 MVP `最小 Task 数据模型` 从"占位"提升到产品主线：
  - Task 用 **三层 assignee 结构**（修正 V1.0 早期方案的"只 assignee_role_id"）：① `assignee_role_id`（逻辑归属，Role 维度，UI 主要展示）② `assignee_binding_id`（本次派发实际执行者，Run 创建时由 Room 内 role→binding resolve 后写入；同一 Role 在不同 room 可绑不同 runtime/model 时这个字段保证审计 / 重试 / cost 归属确定）③ `assignee_agent_id`（V0.5 兼容期字段，由迁移脚本回填，3 个月后 V1.4 删除）；启用 `priority` + `delegation_chain JSON`（记录派发链 leader → teammate → subteammate）；
  - 新增 `task_activities` 表：comment / run_started / run_completed / artifact / blocker / status_change 等条目，构成 Task detail 的 activity timeline；
  - 新增 `room.update_task` 扩展能力（add_comment / set_blocker / link_artifact）；
  - **最小 Board View**（Backlog / In Progress / Blocked / Review / Done）作为 Side Panel 一个 tab；不做拖拽（V1.1）；
  - Task 超时机制（30 分钟无更新 → emit `task.status.changed { nextStatus: "blocked", reason: "timeout" }`）；
  - parentTaskId 嵌套深度上限 5。
- `messaging`（MODIFIED）：`Card 类型清单` 中 `TaskCard` 升级为可显示 Task 树（child tasks + 状态 + activity 摘要）；新增 `TaskStatusCard`（visibility=main，Leader 派发 / Task review 通知）。
- `web-ui`（MODIFIED）：Side Panel 新增 "Tasks" tab（V0.5 已占位，V1.0 真实现）；Run Detail Tools tab 加多 Agent 协作视图（sibling Run + Task 树）；主流 brief 在 squad/team mode 下展示 dispatch 摘要。

**明确不做**（V1.0 红线）

- 不做 Deployment（**推迟 V1.4** 与 Tauri / 响应式 / Docker 同阶段做）；
- 不做 War Room（V1.5）/ A2A 双向（V1.3）/ Plugin（V1.3）/ LangGraph（V1.3）/ Tauri 桌面壳（V1.4）/ 响应式 Web（V1.4）/ Docker Deploy（V1.4）/ Memory / 向量检索 / BM25 / Skill（V1.2）/ 完整 Kanban 拖拽 / Topology 可视化（V1.1）；
- 不做完整 MCP server 管理（V1.0 仅 placeholder）；
- 不复刻 Claude Code 内部代码智能（Native Runtime 对齐 AionUi built-in 能力线即停）；
- 永不做云端 / 多用户 / SaaS / Mobile Native / Marketplace（D32 红线）。

## Capabilities

### New Capabilities

- `role-system`：Role 作为独立实体（Persona only），不绑定 runtime / model。
- `runtime-settings`：Runtime 检测 + 配置（claude-code / opencode / native / custom-acp）+ test connection。
- `model-provider-settings`：模型 provider + API key + baseURL + 模型列表 + keychain 存储 + test model。
- `native-agent-runtime`：内置 AI 引擎，Vercel AI SDK 实现，对齐 AionUi built-in 能力线（**不**对齐 Claude Code）。
- `role-generator`：AI 生成角色草稿，用户确认后保存。
- `settings-ui`：六个一级设置页面（Agents / Runtimes / Models / Permissions / Workspace / MCP）。
- `team-mode`：Team Mode 任务拆解派发协作。
- `squad-mode`：Squad Mode 长期 Leader 路由协作。
- `task-workflow-core`：Task 作为产品主线工作单元；activity timeline；最小 Board View。

### Modified Capabilities

- `agents`：`AgentProfile` 重命名为 `AgentBinding`（role_id + runtime_id + model_config_id?）；旧 AgentProfile 拆成 role + binding 对。
- `rooms`：Room 数据模型加 `leader_role_id`；Post-MVP Mode 占位升级 squad/team；房间创建 API 改为选 role + runtime。
- `orchestrator`：`Room MCP Tools` 加 `room.delegate`；`最小 Task 数据模型` 启用 assignee_role 调度；新增 `Squad 模式调度` / `Team 模式调度` Requirement。
- `adapter-framework`：注册 NativeAgentAdapter 为第三种真实 adapter；manifest runtimeKind 加 "native"。
- `bus-runtime`：`RunQueue` MODIFIED，明确多 Agent 并行场景的锁矩阵语义。
- `messaging`：`TaskCard` 升级为 Task 树视图；新增 `TaskStatusCard`。
- `web-ui`：FeatureRail 加 Settings 入口；Side Panel "Tasks" tab 真实现；Run Detail Tools 多 Agent 视图；主流 brief 加 dispatch 摘要。
- `permissions`：`内置 PermissionProfile 模板` 加"native runtime 默认 profile"；`审批粒度` 加 model API call 维度（防止 prompt injection 让 Native Runtime 自动调用未授权的高 cost 模型）；新增 model API call 的 **per-Run 缓存** 语义（一个 Run 同 model_config_id 仅做一次 permission decision，结果缓存到 run context；deny 必须在创建 model stream 之前失败，不能开始扣费后再 fail）。
- `event-system`：注册 V1.0 新事件类型到 canonical registry；详见 design.md V10-D-EVT。**所有 V1.0 capability 引用的事件类型必须先在此 capability 注册，再被 specs 引用**（V0.5 archive 已踩过此坑）。
- `v1-roadmap`：REMOVED `V1.0 Squad / Team 模式占位`；REMOVED `V1.0 Deployment(static / zip) 占位`（推到 V1.4，**重新 ADDED 占位** `V1.4 Deployment(static / zip / docker) 占位` 由本 change 同时变更）。

### Capabilities Untouched

`context-ledger` / `interventions` / `local-daemon` / `security` / `observability` / `cost-panel-local` / `artifacts` — V1.0 不动这些 capability 的 Requirement，仅消费。

## Impact

- **新增包**：`packages/role-system`、`packages/native-agent-runtime`（含 Vercel AI SDK adapter 实现）、`packages/team-mode`、`packages/squad-mode`、`packages/task-workflow-core`。**无**新 deployment 包（推迟 V1.4）。
- **修改代码区**：`packages/agents/`（AgentBinding 重构）、`packages/orchestrator/`（room.delegate + Task 调度扩展）、`packages/rooms/`（leader_role_id + 创建 API）、`packages/adapter-framework/`（NativeAgentAdapter 注册）、`packages/permissions/`（model API 资源 family）、`packages/messages/`（TaskCard 升级）、`packages/daemon/`（Settings API 路由）、`apps/web/`（Settings UI + Side Panel Tasks tab + 房间创建表单）。
- **新增依赖**：`ai`（Vercel AI SDK Core）、`@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/google`、`@ai-sdk/openai-compatible`（覆盖 OpenRouter / NewAPI / Ollama / LM Studio / LiteLLM 等 baseURL 兜底）。
- **Migration**：`0014_v10.sql` — 拆 `agent_profiles` 为 `roles` + `agent_bindings` + `runtimes` + `model_configs` 四表（含旧数据迁移脚本，保留 3 个月 V0.5 形态兼容层：V1.0 daemon 能迁移并读取旧数据，并接受旧 `agent_profile_id` 入参后 resolve 到 `binding_id`；**不承诺** V0.5 daemon 在升级后的数据库上继续写入；回滚通过恢复升级前 SQLite 备份）；`tasks` 表加 `assignee_role_id` / `delegation_chain` / `priority` 启用；新增 `task_activities` 表；`rooms` 加 `leader_role_id`。
- **API 变更**：
  - 新增 `GET/POST/PATCH/DELETE /roles`、`/runtimes`、`/model-configs`、`/agent-bindings`；
  - 新增 `POST /roles/generate`（AI 生成角色草稿）；
  - 新增 `POST /runtimes/:id/test`（检测 runtime binary 是否可用）+ `POST /model-configs/:id/test`（检测 provider/baseURL/API key/model 是否可用）；**V1.0 不做** `/agent-bindings/:id/test`（端到端 binding 测试推 V1.x）；
  - 新增 `GET /tasks/:id/activities` + `POST /tasks/:id/activities`；
  - `POST /rooms` 入参改为 `{ mode, leaderRoleId?, participants: [{ roleId, runtimeId, modelConfigId? }] }`（旧形态兼容）。
- **CI**：`events:check` 自动覆盖 task_activities / role lifecycle 新事件；`subscriptions:check` 校验新 capability 订阅图谱；`run-state-machine:check` 不动；新增 `roles:check`（CI 校验内置 Role 模板版本一致性）。
- **路线红线（D32 不变）**：Web-only；单机本地；不引入云端 / 多用户 / Postgres / Redis / Mobile Native / Marketplace。

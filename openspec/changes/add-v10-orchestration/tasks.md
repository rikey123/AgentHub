# tasks: add-v10-orchestration

> V1.0 复杂调度 + 产品基座实施清单。每条 task 引用具体 spec capability + requirement，便于验收。
> **格式**：`- [ ] N.M Task — refs: <capability>/<Requirement 名>`
> **里程碑**：M1 数据地基 → M2 Native Runtime → M3 Settings UI → M4 Team/Squad/Task Workflow → M5 收尾验收

## 0. 基础设施（Migration + Event Registry + CI）

- [ ] 0.1 写 migration `0014_v10.sql`：① `roles` / `runtimes` / `model_configs`（`api_key_ref TEXT` 允许 NULL，Ollama 无 key）/ `agent_bindings` 四表；② `rooms.leader_role_id`；③ `tasks` ADD COLUMN：`assignee_role_id` / `assignee_binding_id` / `delegation_chain` / `expects_review`（`priority` 使用基线列，不重复 ADD；`assignee_agent_id` 已在基线表中，确认保留作兼容字段）；④ `task_activities` 表 — refs: design/Migration Plan
- [ ] 0.2 写 `0014_data.ts` 数据迁移脚本：把 `agent_profiles` 拆成 role + runtime + model_config + binding 四表行；`room_participants.agent_binding_id` 回填；`tasks.assignee_role_id` 回填 — refs: agents/AgentProfile 数据模型（MODIFIED）
- [ ] 0.3 在 `packages/protocol/src/events/registry.ts` 注册 18 个 V1.0 新事件（含 visibility）— refs: event-system/事件分级（durable / ephemeral）
- [ ] 0.4 新增 `ai-sdk-provider:check` CI script：扫 `packages/native-agent-runtime/**` 禁止字符串 model ID — refs: native-agent-runtime/NativeAgentAdapter 实现
- [ ] 0.5 更新 `pnpm events:check` + `pnpm visibility:check` 通过（18 个新事件已注册）— refs: event-system/events:check 与 visibility:check CI 校验
- [ ] 0.6 HTTP middleware：收到旧 `agent_profile_id` 入参时 resolve 到 `agent_binding_id`（3 个月兼容层）— refs: agents/AgentProfile 数据模型（MODIFIED）

## 1. 数据地基（Role / Runtime / ModelConfig / AgentBinding）

- [ ] 1.1 实现 `roles` 表 CRUD + `GET/POST/PATCH/DELETE /roles` API — refs: role-system/Role 数据模型
- [ ] 1.2 实现内置 Role 模板首启写入（5 个模板：project-manager / builder / reviewer / archivist / generalist）+ version 检测 + stderr 警告 — refs: role-system/内置 Role 模板首启写入
- [ ] 1.3 实现 `runtimes` 表 CRUD + `GET/POST/PATCH/DELETE /runtimes` API + daemon 启动时自动 detect + UPSERT — refs: runtime-settings/Runtime 数据模型
- [ ] 1.4 实现 `POST /runtimes/:id/detect`（重新检测 binary）+ `POST /runtimes/:id/test`（同步或 job polling）— refs: runtime-settings/Runtime CRUD + Test API
- [ ] 1.5 实现 `model_configs` 表 CRUD + `GET/POST/PATCH/DELETE /model-configs` API + API key 写 OS Keychain（KeychainBridge）+ fingerprint 生成 — refs: model-provider-settings/ModelConfig 数据模型
- [ ] 1.6 实现 `POST /model-configs/:id/test`（同步或 job polling）+ `GET /settings/jobs/:jobId` — refs: model-provider-settings/ModelConfig CRUD + Test API
- [ ] 1.7 实现 `agent_bindings` 表 CRUD + `GET/POST/PATCH/DELETE /agent-bindings` API + GET 展开 role/runtime/model_config 信息 — refs: agents/AgentBinding CRUD API
- [ ] 1.8 单元测试：Role CRUD / 有 bindings 时删除被拒 / 内置模板首启 / Runtime detect / ModelConfig API key keychain / AgentBinding 三层 assignee

## 2. Native Agent Runtime

- [ ] 2.1 实现 `packages/native-agent-runtime/src/provider-registry.ts`：显式 provider 实例化（createOpenAI / createAnthropic / createGoogleGenerativeAI / createOpenAICompatible）；禁止字符串 model ID — refs: native-agent-runtime/NativeAgentAdapter 实现
- [ ] 2.2 实现 `NativeAgentAdapter extends AgentRuntimeAdapter`：manifest 声明 runtimeKind="native" / crashRecovery="restartable"；streamText + tool calling + cost 上报 + AbortController cancel — refs: native-agent-runtime/NativeAgentAdapter 实现
- [ ] 2.3 实现 MCP tool → AI SDK tool 转换（thin adapter，不改 MCP 协议）— refs: native-agent-runtime/NativeAgentAdapter 实现
- [ ] 2.4 实现 `model.api_call.<provider>` permission check（per-Run 缓存 + deny-before-stream）+ `permission.run_summary` event — refs: native-agent-runtime/model.api_call 权限检查, permissions/审批粒度
- [ ] 2.5 注册 NativeAgentAdapter 到 AdapterRegistry；daemon 启动时自动注册 native-default runtime — refs: adapter-framework/Post-MVP Adapter Stub（MODIFIED）
- [ ] 2.6 集成测试：NativeAgentAdapter Solo Run（含 tool calling / permission ask / cancel）— refs: native-agent-runtime/NativeAgentAdapter 实现

## 3. Settings UI + Role Generator

- [ ] 3.1 实现 Settings modal 六页一级架构（Roles / Runtimes / Models / Permissions / Workspace / MCP）+ FeatureRail Settings 入口 + Cmd+K "Open Settings" — refs: settings-ui/Settings Modal 六页一级架构
- [ ] 3.2 实现 Roles tab：角色列表 + 新建 / 编辑 / 删除 + 内置 Role 保护 + "AI 生成"入口 — refs: settings-ui/Roles tab
- [ ] 3.3 实现 Runtimes tab：Runtime 卡片 + 检测状态 + InlineEditor（command/args/env）+ test connection — refs: settings-ui/Runtimes tab
- [ ] 3.4 实现 Models tab：provider 分组 + API key 输入（mask + fingerprint）+ baseURL + test model call — refs: settings-ui/Models tab
- [ ] 3.5 实现 Settings URL deep link（`?settings=<tab>`）— refs: settings-ui/Settings URL deep link
- [ ] 3.6 实现 `role_drafts` 临时表 + GC（7 天 TTL + 启动清过期 + 每小时清）— refs: role-generator/AI 生成角色草稿
- [ ] 3.7 实现 `POST /roles/generate → 202 { jobId }` + `GET /roles/generate/jobs/:jobId` + `DELETE /roles/generate/jobs/:jobId` — refs: role-generator/AI 生成角色草稿
- [ ] 3.8 实现 Settings UI role generation 流程：输入需求 → polling 进度 → preview → 保存 / 取消 — refs: role-generator/AI 生成角色草稿
- [ ] 3.9 单元测试：Settings REST-only（不订阅 SSE）/ role generation polling / 草稿 7 天过期 / API key fingerprint

## 4. Squad Mode + Team Mode + Task Workflow Core

- [ ] 4.1 实现 `room.delegate` MCP tool（仅 leader 可调；创建 Task + dispatch WakeAgent 原子操作）— refs: squad-mode/room.delegate MCP tool
- [ ] 4.2 实现 Squad 模式调度：Leader 派发 → 轻量 Task（expectsReview=false）→ teammate 完成 → Task 自动 completed → mailbox 给 Leader → wake Leader — refs: squad-mode/Squad 模式调度
- [ ] 4.3 实现 Team 模式调度：Leader 派发 → review Task（expectsReview=true）→ sibling Task 全进 review → wake Leader → Leader approve / 重做 — refs: team-mode/Team 模式调度
- [ ] 4.4 实现 sibling Task 完成判定（参考 multica `issue_child_done.go`）：Orchestrator terminal hook 检查所有 sibling Tasks 状态 — refs: team-mode/Team 模式调度
- [ ] 4.5 实现 Task 防循环规则：嵌套深度上限 5 / 5 分钟重复 title 拒绝 / 30 分钟超时 → blocked — refs: squad-mode/Squad 模式调度, task-workflow-core/最小 Task 数据模型
- [ ] 4.6 实现 `task_activities` 表 + `task.activity.added` 事件 + `room.update_task` 扩展（addComment / setBlocker / linkArtifact / priority）— refs: task-workflow-core/最小 Task 数据模型
- [ ] 4.7 实现 Task 三层 assignee（assignee_role_id + assignee_binding_id + assignee_agent_id 兼容）+ role→binding resolve — refs: task-workflow-core/最小 Task 数据模型
- [ ] 4.8 实现 `rooms.leader_role_id` + squad/team room 创建校验（leaderRoleId 必填）— refs: rooms/Room 数据模型（MODIFIED）
- [ ] 4.9 实现 Side Panel Tasks tab（列表 view + status 分组 + Task detail slide-over + activity timeline）— refs: task-workflow-core/Task Workflow UI, web-ui/Side Panel 视图（MODIFIED）
- [ ] 4.10 实现 Run Detail Tools tab 多 Agent 协作视图（sibling Run 链路 + Task 树）— refs: web-ui/Main Timeline 与 Agent Run Detail 双视图（MODIFIED）
- [ ] 4.11 实现 TaskStatusCard（主流 brief 在 squad/team mode 下展示 dispatch 摘要）— refs: messaging/Card 类型清单（MODIFIED）
- [ ] 4.12 集成测试：Squad 3 teammate 并行 / Team 子 Task 全进 review 后 wake Leader / 防循环嵌套深度 / Task 超时 blocked / task.updated 被 events:check 拒绝

## 5. MODIFIED Capabilities 收尾

- [ ] 5.1 更新 `useProjector.ts`：新增 `task.activity.added` / `task.delegation.created` / `task.delegation.completed` / `team.dispatch.started` / `team.dispatch.completed` handler（visibility=both 事件必须有 projector handler）— refs: event-system/事件分级（durable / ephemeral）
- [ ] 5.2 更新 `adapter-framework`：NativeAgentAdapter 注册为第三种真实 adapter；CodexAdapter stub 仍返回 501 — refs: adapter-framework/Post-MVP Adapter Stub（MODIFIED）
- [ ] 5.3 更新 `v1-roadmap`：移除 Squad/Team 占位 Requirement — refs: v1-roadmap/V1.0 Squad / Team 模式占位（REMOVED）

## 6. 收尾验收

- [ ] 6.1 跑 `pnpm test`（全部通过）+ `pnpm typecheck` + `pnpm lint` — refs: design/Goals G2
- [ ] 6.2 跑 `pnpm check:all`（5 道 CI + ai-sdk-provider:check 全绿）— refs: event-system/events:check 与 visibility:check CI 校验
- [ ] 6.3 跑 `openspec validate add-v10-orchestration --strict` 通过 — refs: design/Goals G3
- [ ] 6.4 跑 Playwright E2E（含 V1.0 新增用例：Settings modal / Squad Run / Team Task review）— refs: settings-ui/Settings Modal, squad-mode/Squad 模式调度
- [ ] 6.5 更新 tasks.md 勾选状态（所有已完成项 `[x]`）— refs: design/Goals G3
- [ ] 6.6 准备 V1.1 plan：task-board Kanban + 协作可视化（Timeline + Topology）— refs: design/Roadmap Beyond MVP V1.1 章节

## M-阶段交付建议（不属于 spec，仅作实施计划参考）

> 这些是工程实施 milestone，不是 spec 要求。tasks 0–6 描述的是"做什么"；M 阶段描述"按什么顺序做"。

- M1 数据地基（§0 + §1）：migration / event registry / CI / Role / Runtime / ModelConfig / AgentBinding CRUD
- M2 Native Runtime（§2）：NativeAgentAdapter + Vercel AI SDK + tool calling + permission + cancel
- M3 Settings UI（§3）：六页 Settings modal + role-generator polling
- M4 Team/Squad/Task Workflow（§4 + §5）：room.delegate + Squad/Team 调度 + Task Workflow + projector handlers
- M5 收尾验收（§6）：全套测试 + strict + E2E + tasks 勾选 + V1.1 plan

> 关键纪律：M2 之前 Native Runtime 只在 Solo / Assisted 验证（不接 Team/Squad）；M4 之前 Task 调度只支持单层（不支持嵌套）；所有 Settings 写路径必须 emit detail events（audit），但 Settings UI 不消费这些事件。

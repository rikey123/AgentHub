# agents (V1.0 delta)

> **参考来源**：
> - **AionUi**（Apache-2.0，可代码级复刻）：
>   - `src/renderer/pages/settings/AgentSettings/{AgentCard,InlineAgentEditor}.tsx`：Agent（binding）卡片展示 + 内联编辑（command/args/env/test connection）。
>   - `src/renderer/hooks/agent/useHubAgents.ts`：Agent 列表展示，含 role + runtime 组合信息。
> - **multica**（仅借模式）：
>   - `server/internal/handler/issue.go`：assignee 与具体 agent_id 解耦——Task 的 `assignee_role_id` 是逻辑归属，`assignee_binding_id` 是实际执行者，与 multica Issue 的 assignee 模式一致。
> - **总线契约**：
>   - 写路径：`POST/PATCH/DELETE /agent-bindings` → UPDATE agent_bindings 表 → emit `agent_binding.created/updated/removed`（durable, visibility=detail）
>   - 读路径：**REST-only**；Settings UI 通过 `GET /agent-bindings` 初始化；不订阅 SSE
>   - 失败路径：HTTP 4xx/5xx 返回，不 emit EventBus 事件

## MODIFIED Requirements

### Requirement: AgentProfile 数据模型

The system SHALL migrate `AgentProfile` to `AgentBinding` in V1.0. An `AgentBinding` binds a Role to a Runtime (and optionally a ModelConfig), replacing the monolithic `AgentProfile` that combined Persona + Runtime + Model in a single entity.

**V1.0 新数据模型**：

```ts
type AgentBinding = {
  id: string                          // ULID
  workspaceId?: string
  roleId: string                      // → roles.id
  runtimeId: string                   // → runtimes.id
  modelConfigId?: string              // → model_configs.id（仅 runtime.kind="native" 必需）
  overridePermissionProfileId?: string // 覆盖 role 的默认 permission profile
  createdAt: number
  updatedAt: number
}
```

```sql
CREATE TABLE agent_bindings (
  id                        TEXT PRIMARY KEY,
  workspace_id              TEXT,
  role_id                   TEXT NOT NULL REFERENCES roles(id),
  runtime_id                TEXT NOT NULL REFERENCES runtimes(id),
  model_config_id           TEXT REFERENCES model_configs(id),
  override_permission_profile_id TEXT,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL
);
CREATE INDEX idx_agent_bindings_role ON agent_bindings (role_id);
CREATE INDEX idx_agent_bindings_runtime ON agent_bindings (runtime_id);
```

**V0.5 兼容层（3 个月）**：

- `agent_profiles` 表保留（标 deprecated，不再写入）；
- V1.0 daemon 启动时运行 `0014_data.ts` 把每行 `agent_profiles` 拆成对应的 `roles` + `runtimes` + `model_configs` + `agent_bindings` 四表行；
- HTTP middleware：收到旧 `agent_profile_id` 入参时自动 resolve 到对应 `agent_binding_id`；
- 3 个月后 V1.4 删除兼容层 + `agent_profiles` 表。

**Task 三层 assignee**（与 task-workflow-core 联动）：

- `tasks.assignee_role_id`：逻辑归属（Role 维度，UI 主要展示）
- `tasks.assignee_binding_id`：本次派发实际执行者（Run 创建时由 Room 内 role→binding resolve 后写入）
- `tasks.assignee_agent_id`：V0.5 兼容字段，迁移脚本回填，3 个月后 V1.4 删除

#### Scenario: 创建 AgentBinding

- **WHEN** 用户在 Room 创建时选择 role=builder + runtime=claude-code-default
- **THEN** daemon INSERT agent_bindings 行 + emit `agent_binding.created`（durable, visibility=detail）
- **AND** Settings UI 用 POST response 更新本地列表

#### Scenario: native runtime binding 必须有 model_config

- **WHEN** 用户创建 binding：role=builder + runtime=native-default，但未选 model_config
- **THEN** 返回 400 + `{ error: "native_runtime_requires_model_config" }`

#### Scenario: V0.5 旧 agent_profile_id 入参被兼容

- **WHEN** V0.5 客户端发送 `POST /rooms { agentProfileId: "ap_123" }`
- **THEN** daemon middleware 查 `agent_profiles` 表找到对应 `agent_binding_id`，继续处理
- **AND** 响应中返回新的 `agentBindingId` 字段（同时保留旧字段 3 个月）

## ADDED Requirements

### Requirement: AgentBinding CRUD API

The system SHALL expose REST endpoints for AgentBinding management.

| Method | Path | 描述 |
|---|---|---|
| `GET` | `/agent-bindings?workspaceId=<id>` | 列出 bindings（含 role + runtime + model_config 展开信息）|
| `POST` | `/agent-bindings` | 创建 binding |
| `PATCH` | `/agent-bindings/:id` | 更新 binding（如切换 runtime 或 model_config）|
| `DELETE` | `/agent-bindings/:id` | 删除 binding（有 room_participants 引用时拒绝）|

#### Scenario: GET /agent-bindings 展开关联信息

- **WHEN** Settings UI 调 `GET /agent-bindings?workspaceId=w_1`
- **THEN** 返回列表，每行含 `role: { id, name, avatar }` + `runtime: { id, kind, name, detectedVersion }` + `modelConfig?: { id, name, provider, model, apiKeyFingerprint }`
- **AND** 不含 API key 明文

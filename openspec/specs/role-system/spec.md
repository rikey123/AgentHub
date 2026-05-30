# role-system Specification

## Purpose
TBD - created by archiving change add-v10-orchestration. Update Purpose after archive.
## Requirements
### Requirement: Role 数据模型（Persona only）

The system SHALL persist `Role` as an independent entity in the `roles` table. A Role represents a **Persona only**—name, avatar, description, prompt, capabilities, default permission profile, tags—and SHALL NOT be bound to any specific runtime or model configuration.

```ts
type Role = {
  id: string                          // ULID
  workspaceId?: string                // NULL = 用户级（~/.agenthub/roles/）；非 NULL = workspace 级
  name: string
  avatar?: string                     // emoji 或 URL
  description?: string
  version?: string                    // 用于内置 Role 模板更新检测
  prompt: string                      // system prompt（markdown body）
  capabilities: RoleCapability[]      // 与 V0 AgentCapability 相同枚举
  defaultPermissionProfileId?: string
  tags?: string[]
  sourcePath?: string                 // 来源 markdown 路径（如从 ~/.agenthub/roles/*.md 加载）
  isBuiltin: boolean                  // 内置模板标记
  createdAt: number
  updatedAt: number
}
```

```sql
CREATE TABLE roles (
  id                       TEXT PRIMARY KEY,
  workspace_id             TEXT,
  name                     TEXT NOT NULL,
  avatar                   TEXT,
  description              TEXT,
  version                  TEXT,
  prompt                   TEXT NOT NULL,
  capabilities             TEXT NOT NULL DEFAULT '[]',  -- JSON array
  default_permission_profile_id TEXT,
  tags                     TEXT,                        -- JSON array
  source_path              TEXT,
  is_builtin               INTEGER NOT NULL DEFAULT 0,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
CREATE INDEX idx_roles_workspace ON roles (workspace_id, name);
```

#### Scenario: 创建自定义 Role

- **WHEN** 用户在 Settings UI 填写 name / prompt / capabilities 后点 Save
- **THEN** daemon INSERT roles 行 + emit `role.created`（durable, visibility=detail）
- **AND** Settings UI 用 POST response 更新本地列表（不订阅 SSE）

#### Scenario: 编辑 Role prompt

- **WHEN** 用户修改 Role 的 system prompt 后保存
- **THEN** daemon UPDATE roles 行 + emit `role.updated`（durable, visibility=detail）
- **AND** 正在跑的 Run **不受影响**（继续使用启动时的 snapshot prompt）
- **AND** 下一次 wake 该 Role 时使用新 prompt

#### Scenario: 删除 Role

- **WHEN** 用户删除一个 Role
- **THEN** 若该 Role 有关联的 `agent_bindings` 行 → 拒绝删除，返回 409 + `{ error: "role_has_bindings", bindingCount: N }`
- **AND** 若无关联 bindings → DELETE roles 行 + emit `role.deleted`（durable, visibility=detail）

### Requirement: 内置 Role 模板首启写入（V1.0 扩展）

The system SHALL ship with the following preconfigured Role templates, written into `~/.agenthub/roles/` on first launch if the directory is empty. V1.0 extends the V0.5 builtin agent templates by separating Role from Runtime.

| Role | 描述 | 默认 capabilities |
|---|---|---|
| `project-manager` | 项目经理，负责任务拆解和 Leader 路由 | chat, task.delegate, context.read, context.write |
| `builder` | 通用代码构建者 | chat, code.edit, file.read, file.write, terminal.run, context.read, context.write |
| `reviewer` | 代码审阅者，敲门介入 | chat, code.review, context.read, context.write, intervention.knock |
| `archivist` | 上下文归档者，生成 confirmed summary | chat, context.read, context.write |
| `generalist` | 通用助手，无特定专长 | chat, context.read |

每份模板 markdown 头含 `version: 1.0.0`；首启检查目标路径已存在但 version 较旧时仅 stderr 提示，**不**自动覆盖用户已编辑的文件。

#### Scenario: 首次启动写入 5 个 Role 模板

- **WHEN** daemon 第一次启动，`~/.agenthub/roles/` 不存在或为空
- **THEN** 创建该目录，写入上述 5 个 `.md` 模板；同名文件存在时跳过
- **AND** 每个模板写入后 emit `role.created { isBuiltin: true }`（durable, visibility=detail）

#### Scenario: 内置模板有更新但用户已改

- **WHEN** daemon 启动发现 `~/.agenthub/roles/builder.md` 存在但 `version` 字段早于内置版本
- **THEN** stderr 警告 `Builtin role 'builder' has an update; run \`agenthub roles reset --id=builder\` to overwrite`
- **AND** **不**覆盖用户文件；不阻断 daemon 启动

### Requirement: Role CRUD API

The system SHALL expose REST endpoints for Role management. Settings UI consumes these endpoints directly (REST-only, no SSE subscription).

| Method | Path | 描述 |
|---|---|---|
| `GET` | `/roles?workspaceId=<id>` | 列出 roles（含内置）|
| `POST` | `/roles` | 创建 role |
| `GET` | `/roles/:id` | 获取单个 role |
| `PATCH` | `/roles/:id` | 更新 role |
| `DELETE` | `/roles/:id` | 删除 role（有 bindings 时拒绝）|
| `POST` | `/roles/generate` | 启动 AI 生成 job → 202 `{ jobId }` |
| `GET` | `/roles/generate/jobs/:jobId` | 轮询生成进度 → `{ status, draftJson?, error? }` |
| `DELETE` | `/roles/generate/jobs/:jobId` | 取消生成 + 清除草稿 |

#### Scenario: GET /roles 返回列表

- **WHEN** Settings UI 打开 Roles 页，调 `GET /roles?workspaceId=w_1`
- **THEN** 返回该 workspace 下所有 roles（含内置）+ 用户级 roles（workspaceId=NULL）
- **AND** 按 `is_builtin DESC, name ASC` 排序

#### Scenario: 有 bindings 时删除被拒

- **WHEN** 用户尝试删除 role_id=r_1，但 agent_bindings 表有 2 行引用 r_1
- **THEN** 返回 409 + `{ error: "role_has_bindings", bindingCount: 2 }`
- **AND** roles 表不变，不 emit 事件


# role-generator Specification

## Purpose
TBD - created by archiving change add-v10-orchestration. Update Purpose after archive.
## Requirements
### Requirement: AI 生成角色草稿（REST job polling）

The system SHALL provide an AI-assisted role generation flow using REST job polling. The generated draft SHALL NOT be auto-saved; users MUST review and confirm before the role is persisted.

**生成流程**：

```
Settings UI Roles 页 → "+ New Role → Generate with AI"
  ↓
弹"输入需求"对话框：
  - description: "帮我生成一个擅长前端重构的 reviewer"
  - targetWork?: "code-review" | "coding" | "planning" | "archiving"
  - preferredTone?: "concise" | "detailed" | "encouraging"
  - capabilities?: RoleCapability[]（多选）
  - modelConfigId: <选已配置的 model_config>
  ↓
POST /roles/generate → 202 { jobId }
  daemon 在后台用选中的 ModelConfig 跑 Native Runtime 生成 RoleDraft
  daemon 把进度写入 role_drafts 临时表（status: streaming → completed / failed）
  ↓
UI 每 500ms polling: GET /roles/generate/jobs/:jobId
  → { status: "streaming", draftJson: { name, description, prompt, capabilities, suggestedPermissionProfileId } }
  → { status: "completed", draftJson: { ... } }
  → { status: "failed", error: "..." }
  ↓
UI 渲染 RoleDraft preview（diff-style 展示 prompt / capabilities / suggested permission profile）
用户可改 → 保存（POST /roles 创建真 role 行）→ emit role.created（durable, visibility=detail）
或 取消 → DELETE /roles/generate/jobs/:jobId → daemon 清掉 role_drafts 行
```

**草稿不进 durable event log**：

- role 生成走 REST polling，**不发** `role.generation.*` 事件；
- 完整 draft 仅存 `role_drafts` 临时表（TTL 7 天 + 保存/取消时立即删）；
- 用户保存时才发 durable `role.created { roleId, source: "ai_generated", generationJobId? }`，事件 payload **不含**原始 prompt 或生成时输入的描述；
- 这避免"用户输入的 prompt 永久留在 events 表"的隐私风险。

**`role_drafts` 临时表**：

```sql
CREATE TABLE role_drafts (
  job_id           TEXT PRIMARY KEY,
  description      TEXT NOT NULL,
  target_work      TEXT,
  preferred_tone   TEXT,
  capabilities     TEXT,             -- JSON
  model_config_id  TEXT NOT NULL,
  draft_json       TEXT,             -- 完整 RoleDraft（生成中是部分内容）
  status           TEXT NOT NULL CHECK (status IN ('pending','streaming','completed','failed','cancelled')),
  failure_reason   TEXT,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL  -- created_at + 7 天
);
CREATE INDEX idx_role_drafts_expires ON role_drafts (expires_at);
```

GC：daemon 启动时清过期行；后台每小时清一次；保存或取消时立即清对应行。

**预设 prompt 模板**（4 种 + 空白自定义）：

| preset | 描述 |
|---|---|
| `project-manager` | 项目经理，负责任务拆解和 Leader 路由 |
| `reviewer` | 代码审阅者，敲门介入 |
| `builder` | 通用代码构建者 |
| `archivist` | 上下文归档者 |
| `custom` | 空白自定义（用户手写描述）|

#### Scenario: 生成角色草稿

- **WHEN** 用户输入 description="帮我生成一个擅长前端重构的 reviewer"，选 modelConfigId=mc_1，点"Generate"
- **THEN** `POST /roles/generate` → 202 `{ jobId: "job_abc" }`
- **AND** UI 开始 polling `GET /roles/generate/jobs/job_abc` 每 500ms
- **AND** 生成中：UI 显示进度（已生成的 prompt 片段 + token count）
- **AND** 完成：UI 渲染 RoleDraft preview（name / description / prompt / capabilities / suggested permission profile）

#### Scenario: 用户修改草稿后保存

- **WHEN** 用户在 preview 里修改 prompt，点"Save"
- **THEN** `POST /roles { name, prompt, capabilities, ... }` → 201 + 新 role 数据
- **AND** emit `role.created { roleId, source: "ai_generated", generationJobId: "job_abc" }`（durable, visibility=detail）
- **AND** `DELETE /roles/generate/jobs/job_abc`（daemon 清 role_drafts 行）
- **AND** Settings UI 把新 role 插入本地列表

#### Scenario: 用户取消生成

- **WHEN** 用户点"Cancel"或关闭 modal
- **THEN** `DELETE /roles/generate/jobs/job_abc` → daemon 清 role_drafts 行
- **AND** 不 emit 任何事件；不写 roles 表

#### Scenario: 生成失败

- **WHEN** Native Runtime 调用模型失败（如 API key 无效）
- **THEN** `GET /roles/generate/jobs/job_abc` 返回 `{ status: "failed", error: "invalid_api_key" }`
- **AND** UI 显示错误 + "Try again" 按钮 + "Write manually" 入口
- **AND** daemon 清 role_drafts 行；不 emit EventBus 事件

#### Scenario: 草稿 7 天后自动过期

- **WHEN** 用户生成了草稿但 7 天内未保存也未取消
- **THEN** daemon GC 任务清除 role_drafts 行
- **AND** 用户再次 polling `GET /roles/generate/jobs/:jobId` 返回 404
- **AND** UI 显示"草稿已过期，请重新生成"


# artifacts Specification

## Purpose

V1.2 扩展：新增 artifact kind 体系、版本历史系统、统一预览合同、部署产物从 501 占位升级为独立 deployments 实体。

## MODIFIED Requirements

### Requirement: Artifact 数据模型（V1.2 扩展）

The system SHALL add a `kind` discriminator column to the `artifacts` table. The `kind` column classifies the semantic content type of an artifact and drives Card rendering and available actions.

`artifacts.kind` 枚举（新增，NULL 表示遗留产物）：

```
web_page | web_app | document | presentation | presentation_pptx | source_code | generic_file
```

`deployment` 不再是 `artifact.kind`，而是独立的 `deployments` 表（`0019_v12.sql`）。`workflow` 不在 V1.2 中。

**内容存储模型：**
- 文本产物（web_page / web_app / document / presentation / source_code）：内容存储在 `artifact_files.new_content`（TEXT），`is_binary = 0`。
- 二进制产物（presentation_pptx / generic_file with binary）：文件复制到 `{workspace}/.agenthub/artifacts/<artifactId>/v<version>/<filename>`，`artifact_files.content_path` 指向该路径，`artifact_files.new_content = NULL`，`is_binary = 1`，记录 `mime_type` / `size_bytes` / `sha256`。
- `artifacts` 表不新增 `content` 列。

**`artifact_files` V1.2 新增列：** `mime_type TEXT`、`size_bytes INTEGER`、`sha256 TEXT`、`is_binary INTEGER NOT NULL DEFAULT 0`。
**`artifact_versions` V1.2 新增列：** `storage_path TEXT`（binary artifact 的受控文件路径）、`content_encoding TEXT`（'text' | 'binary'）。

#### Scenario: kind 字段驱动 Card 渲染

- **WHEN** Agent 调用 `room.publish_artifact({ kind: "web_page", content: "<html>..." })`
- **THEN** daemon 写 `artifacts.kind = 'web_page'`，projector 渲染 `PreviewCard`（sandbox iframe）

#### Scenario: 遗留产物 kind 为 NULL

- **WHEN** 读取 V1.1 或更早创建的 artifact
- **THEN** `artifacts.kind IS NULL`，前端按 `artifacts.type` 选择渲染方式（兼容路径）

---

### Requirement: Artifact 版本历史

The system SHALL record a new `artifact_versions` snapshot each time an artifact's content changes, and SHALL allow restoring any prior version by creating a new forward version.

`artifact_versions` 表（`0019_v12.sql`）：

```sql
artifact_versions (
  id          TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,    -- snapshot of artifact_files.new_content at save time
  metadata    TEXT,             -- JSON snapshot of artifact metadata
  created_at  INTEGER NOT NULL,
  created_by  TEXT,             -- 'user' | 'system' | agentId
  message     TEXT,
  UNIQUE(artifact_id, version)
)
```

版本创建触发点：
1. 用户在 Editor tab 点击 Save
2. Agent 对已存在的 artifact 再次调用 `room.publish_artifact`
3. 执行 `POST /artifacts/:id/versions/:version/restore`

版本创建流程（同一 SQLite 事务）：
1. 更新 `artifact_files.new_content`
2. 写 `artifact_versions` 行（version 递增）
3. 发 `artifact.version.created`（durable, both）

回滚语义：始终向前，不支持 in-place 覆盖——恢复即创建新版本。

**API：**
```
GET    /artifacts/:id/versions
GET    /artifacts/:id/versions/:version
POST   /artifacts/:id/versions/:version/restore
GET    /artifacts/:id/versions/:from/diff/:to   → 两版本间 unified diff
PATCH  /artifacts/:id { content, message? }      → 触发版本创建
GET    /artifacts/:id/download                   → Content-Disposition attachment
```

#### Scenario: Save 创建新版本

- **WHEN** 用户在 Editor tab 修改 HTML 后点击 Save，输入 message "改按钮颜色"
- **THEN** `artifact_versions` 新增一行（version = 旧版本 + 1）；`artifact_files.new_content` 更新；发 `artifact.version.created`

#### Scenario: 版本间 diff

- **WHEN** 用户在 History tab 点击"与当前版本比较"
- **THEN** `GET /artifacts/:id/versions/2/diff/5` 返回 unified diff；UI 渲染只读 DiffModal

#### Scenario: Restore 创建新版本

- **WHEN** 用户在 History tab 选择版本 2，点击 Restore（当前是版本 5）
- **THEN** 创建版本 6（内容 = 版本 2 快照），`artifact_files.new_content` 更新；历史始终向前

---

### Requirement: 统一 Artifact 预览合同

The system SHALL provide a unified preview contract that derives preview behavior from `artifact.kind` and `artifact.type`, handling loading, error, too-large, and unsupported states.

预览种类矩阵：

| kind / type | 渲染方式 | 边界状态 |
|-------------|---------|---------|
| `web_page`, `web_app` | sandbox iframe（`allow-scripts`，无 same-origin）| too-large（> 500KB）→ download fallback |
| `presentation` | HTML slides viewer，方向键/触控翻页 | 同上 |
| `document` | sanitized Markdown renderer | 同上 |
| `source_code` | Monaco syntax highlight（只读）| 同上 |
| `generic_file`, type=`file` | raw text 或 download | unsupported → download only |
| type=`diff`, `worktree_diff` | DiffReviewViewer（现有）| 同上 |
| type=`terminal` | TerminalCard（现有）| 同上 |
| image（由文件扩展名检测）| `<img>` | broken → icon fallback |
| PDF（由文件扩展名检测）| `<iframe>` PDF viewer | too-large → download |
| audio/video | `<audio>`/`<video>` | unsupported → download |
| unsupported | download fallback + "不支持预览" | — |

**参考（Multica `preview.ts`）：** 统一 kind 分发器，支持 image/pdf/video/audio/markdown/html/text；`PreviewTooLargeError`、`PreviewUnsupportedError` 边界状态。

#### Scenario: 超大文件降级

- **WHEN** 用户打开一个 800KB 的 web_page artifact
- **THEN** PreviewCard 显示"文件较大，无法内联预览"+ Download 按钮，不崩溃也不卡死

#### Scenario: 不支持类型降级

- **WHEN** 用户打开一个 `.xlsx` 文件 artifact
- **THEN** ArtifactCard 显示"不支持预览此格式"+ Download 按钮

---

### Requirement: Deployment 501 占位移除

The system SHALL remove the `type=deployment` 501 placeholder. Deployments are now handled by the independent `deployments` table and `deployment-publish` capability.

`POST /artifacts { type: "deployment", ... }` 不再返回 501。

Agent 调用 `room.deploy_artifact(...)` 创建 `deployments` 行，而不是 `artifacts` 行。

#### Scenario: deployment 501 不再返回

- **WHEN** Agent 调用 `room.deploy_artifact({ artifactId, kind: "preview-url" })`
- **THEN** 返回成功，创建 `deployments` 行；不返回 501

## REMOVED Requirements

### Requirement: Deployment 占位

The `type=deployment` 501 placeholder requirement is superseded by the `deployment-publish` capability in V1.2. The 501 behavior SHALL be removed. Agent deployments now go through `room.deploy_artifact` MCP tool and the `deployments` table.

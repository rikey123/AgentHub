## Context

V1.1 交付了多 Agent 协作基础设施。V1.2 的单一目标是全面实现初始课题需求中所有明确描述的用户功能：IM 聊天核心体验、Agent 联系人与自建 Agent、群聊 Orchestrator 可见协调、对话式产物 Studio（网页/文档/演示/代码/Diff）、Artifact 预览/编辑/版本历史/选区引用、部署发布系统（本地预览/静态站点/zip/容器/自托管 PaaS）。Workflow 产物推 V1.3。可靠性机制（WakeAgent outbox、restart recovery）作为内部实现保留，不作为独立产品 capability。

## Goals / Non-Goals

**Goals:**
- 全面实现初始课题需求里所有明确描述的用户功能。
- 维护 Event Bus 合约：所有状态变更与 EventBus.publish 在同一 SQLite 事务中。
- 所有聊天内联卡片必须通过 `message.part.added` 或完整 `message.created` payload 进入 timeline；artifact/deployment 事件不能单独驱动聊天卡片。
- 不破坏现有接口：不改 SSE envelope schema、`AgentRuntimeAdapter` 接口、现有事件类型。

**Non-Goals:**
- Workflow artifact / DAG 执行 / WorkflowCard（V1.3）。
- 云端 SaaS 部署 provider（Vercel / Cloudflare / Fly.io）（V1.3）。
- Workflow 拖拽可视化编辑器（V1.3）。
- cron / scheduler / recurring tasks（V1.3）。
- 消息撤回（不在初始需求里，V1.3+）。
- PPTX 可视化编辑 / 导出增强（V1.3）；V1.2 支持真实 `.ppt/.pptx/.odp` 只读预览（officecli watch）和 HTML slides 生成，两个 presentation 分支并存。
- BM25 召回 / 向量检索 / 混合记忆（占位不变）。
- Plugin / A2A / LAN discovery（V1.3+）。
- Codex adapter 完整实现（V1.3，V1.2 只标 experimental）。
- 多用户认证 / 云端同步 / SaaS（D32 红线不变）。

---

## Decisions

### D1 — 单迁移文件 `0019_v12.sql`

当前最新迁移号是 `0018_artifact_lifecycle.sql`，V1.2 使用 `0019_v12.sql`。所有新表和新列在契约周一次性提交，分支中途如需修 schema 追加到 `0019_v12_patch.sql`。

**不重复添加的已存在列：**
- `rooms.archived_at` — 已在 `0001_init.sql`
- `messages.pinned_at` — 已在 `0013_messages_pinned.sql`
- `artifacts.archived_at` — 已在 `0018_artifact_lifecycle.sql`

**新表：**

```sql
artifact_versions (
  id               TEXT    PRIMARY KEY,
  artifact_id      TEXT    NOT NULL REFERENCES artifacts(id),
  version          INTEGER NOT NULL,
  content          TEXT,                   -- text artifacts only; NULL for binary
  storage_path     TEXT,                   -- binary artifacts only; NULL for text
  content_encoding TEXT    NOT NULL DEFAULT 'text',  -- 'text' | 'binary'
  metadata         TEXT,                   -- JSON snapshot of artifact metadata at save time
  created_at       INTEGER NOT NULL,
  created_by       TEXT,                   -- 'user' | 'system' | agentId
  message          TEXT,                   -- optional commit-like label
  UNIQUE(artifact_id, version),
  CHECK (
    (content_encoding = 'text'   AND content IS NOT NULL AND storage_path IS NULL) OR
    (content_encoding = 'binary' AND content IS NULL     AND storage_path IS NOT NULL)
  )
)

deployments (
  id                   TEXT PRIMARY KEY,
  artifact_id          TEXT NOT NULL REFERENCES artifacts(id),
  room_id              TEXT,
  workspace_id         TEXT NOT NULL,
  kind                 TEXT NOT NULL,
    -- 'preview-url' | 'static-site' | 'source-zip'
    -- | 'container-export' | 'container-build' | 'self-hosted'
  provider             TEXT NOT NULL DEFAULT 'agenthub-local',
    -- 'agenthub-local' | 'caprover'
  status               TEXT NOT NULL DEFAULT 'queued',
    -- 'queued' | 'in_progress' | 'ready' | 'failed'
    -- | 'cancelled' | 'expired' | 'unpublished'
  url                  TEXT,
  download_url         TEXT,
  image_tag            TEXT,
  provider_resource_id TEXT,          -- external app/deployment id
  provider_config_id   TEXT REFERENCES deployment_providers(id),
  source_path          TEXT,
  zip_path             TEXT,
  dockerfile_path      TEXT,
  log_path             TEXT,          -- local file path for log tail
  error                TEXT,
  pid                  TEXT,          -- build process PID (container-build / self-hosted)
  artifact_version     INTEGER,       -- artifact version at deploy time
  last_error           TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  started_at           INTEGER,
  finished_at          INTEGER,
  cancelled_at         INTEGER,
  expires_at           INTEGER,
  published_at         INTEGER,
  unpublished_at       INTEGER
)

deployment_providers (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  kind           TEXT NOT NULL,       -- 'caprover' | 'dokploy' (V1.3) | 'coolify' (V1.3)
  name           TEXT NOT NULL,
  base_url       TEXT NOT NULL,
  credential_ref TEXT NOT NULL,       -- Keychain ref; MUST NOT store plaintext token
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
)

wake_outbox (
  id             TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  reason         TEXT NOT NULL,
  payload        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
    -- 'pending' | 'dispatching' | 'dispatched' | 'failed'
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  last_error     TEXT,
  created_at     INTEGER NOT NULL,
  dispatch_after INTEGER,             -- NULL = dispatch immediately
  dispatched_at  INTEGER
)
```

**新列：**

```sql
ALTER TABLE rooms ADD COLUMN pinned_at        INTEGER;
ALTER TABLE rooms ADD COLUMN last_activity_at INTEGER;
ALTER TABLE artifacts ADD COLUMN kind         TEXT;
  -- 'web_page' | 'web_app' | 'document' | 'presentation' | 'presentation_pptx'
  -- | 'source_code' | 'generic_file'
  -- NULL means legacy artifact (type-only, no kind)
ALTER TABLE tasks ADD COLUMN last_unblocked_at INTEGER;
ALTER TABLE agent_bindings ADD COLUMN avatar_url          TEXT;
ALTER TABLE agent_bindings ADD COLUMN contact_name        TEXT;
ALTER TABLE agent_bindings ADD COLUMN contact_description TEXT;
```

### D2 — Artifact type / kind 分离

现有 `artifacts.type` 字段表示产物的技术类别（`file` / `document` / `preview` / `diff` / `worktree_diff` / `terminal` / `deployment`），不改。

新增 `artifacts.kind` 字段表示内容语义类型，仅对 `type IN ('file', 'document', 'preview')` 的产物有意义：

| kind | 渲染方式 | 聊天卡片 |
|------|---------|---------|
| `web_page` | sandbox iframe | PreviewCard |
| `web_app` | sandbox iframe | PreviewCard |
| `document` | Markdown renderer | DocumentCard |
| `presentation` | HTML slides viewer | PresentationCard |
| `presentation_pptx` | officecli watch iframe（`/api/ppt-proxy`）| PresentationCard（PptViewer）|
| `source_code` | Monaco / syntax highlight | ArtifactCard |
| `generic_file` | raw / download | ArtifactCard |

`deployment` 不再是 `artifact.kind`，而是独立的 `deployments` 表。`diff` / `worktree_diff` / `terminal` 继续靠 `artifact.type` 区分，不需要 `kind`。`workflow` 从 V1.2 产物体系中完全移除。

**Card 选择逻辑：**

```typescript
function resolveCardType(artifact: Artifact): CardType {
  if (artifact.type === 'diff' || artifact.type === 'worktree_diff') return 'DiffCard'
  if (artifact.type === 'terminal') return 'TerminalCard'
  switch (artifact.kind) {
    case 'web_page': case 'web_app': return 'PreviewCard'
    case 'document': return 'DocumentCard'
    case 'presentation': return 'PresentationCard'          // HTML slides
    case 'presentation_pptx': return 'PresentationCard'    // PptViewer (officecli)
    default: return 'ArtifactCard'
  }
}
```

### D3 — 所有聊天内联卡片必须通过 message.part.added

这是 Event Bus 合约的延伸。任何在聊天 timeline 中出现的卡片，其插入必须由 `message.part.added` 或完整 `message.created` payload 驱动，而不是由 artifact/deployment 专属事件单独驱动。

```
Agent 调用 room.publish_artifact(...)
  └─ 同一 SQLite 事务：
       1. 写 artifacts 行
       2. 写 artifact_files 行（new_content = artifact 内容，path = 'index.html' 等）
       3. 写 artifact_versions 行（第一版，content = 快照）
       4. 发 artifact.version.created（durable, both）
       5. 写 messages 行（type='artifact', partRef=artifactId）
       6. 发 message.part.added（durable, both）  ← projector 凭此插卡片；visibility=both 是已注册值，不改

用户点击 ArtifactCard 的 Deploy 按钮 / Agent 调用 room.deploy_artifact(...)
  └─ 同一 SQLite 事务：
       1. 写 deployments 行
       2. 发 deployment.created（durable, main）
       3. 写 messages 行 或 更新现有消息的 parts（type='deployment', partRef=deploymentId）
       4. 发 message.part.added（durable, both）  ← projector 插 DeploymentCard
```

**为什么必须这样做？** 断线重连时 SSE replay 靠 durable 事件重建聊天 timeline。如果 DiffCard/PreviewCard/DeploymentCard 只靠 `artifact.created` 等事件插入，projector 就必须对所有 artifact 事件都执行"查有没有对应消息 part"的副作用判断——这会让 projector 变成一个有数据库副作用的组件，违反现有设计。`message.part.added` 是 projector 唯一的卡片插入信号。

### D4 — Web/Document/Presentation 产物流水线：builtin SKILL.md 约束输出

产物流水线通过 SKILL.md package 硬约束模型输出格式，不依赖自由提示词。V1.2 新增六个 builtin skill：

| Skill | kind | 约束 |
|-------|------|------|
| `web-page-builder` | `web_page` | 单文件 self-contained HTML，无外部 CDN，responsive，无障碍 ARIA |
| `web-app-builder` | `web_app` | 单文件 HTML + 内联 JS，localStorage 持久化，无网络依赖 |
| `one-pager-builder` | `web_page` | 商业简报 one-pager，固定布局，可打印 |
| `html-slides-builder` | `presentation` | HTML 幻灯片，内联 CSS/JS，键盘/触控翻页 |
| `document-builder` | `document` | Markdown 文档，带 frontmatter（title/date/author/tags）|
| `officecli-pptx` | `presentation_pptx` | 使用 `officecli` CLI 生成/编辑真实 `.pptx` 文件；输出通过 `room.publish_artifact({ kind: "presentation_pptx", filePath })` 提交；参考 AionUi `officecli-pptx/SKILL.md` |

每个 SKILL.md 的 frontmatter 包含 `artifact_kind` 字段，daemon 在处理 `room.publish_artifact` 时依此设置 `artifacts.kind`。

**参考（Multica）：** `agenttmpl/templates/frontend-builder.json` 约束 `"output_format": "single_file_html"` + `"no_external_resources": true`。AgentHub 用 SKILL.md frontmatter 实现等价约束，不引入新的 agent template 抽象。

**参考（AionUi `officecli-pptx/SKILL.md`）：** 完整 officecli 使用规范，覆盖创建、编辑、分析、验证 `.pptx`。有效命令包括：
- `officecli view "$FILE" outline` — 获取幻灯片大纲
- `officecli view "$FILE" text --start N --end N` — 提取指定页文本
- `officecli get "$FILE" "/slide[N]"` — 获取第 N 张 slide XML
- `officecli view "$FILE" svg --start N --end N` — 渲染为 SVG
- `officecli validate "$FILE"` — 验证文件有效性

### D5 — Artifact 版本系统：追加写，回滚创建新版本

```
artifacts 表          → 当前活跃内容（热路径 0 JOIN 读取）
artifact_versions 表  → 不可变历史快照（追加写）
```

版本号递增边界：
1. 用户在 Editor tab 点击 Save（可选 commit message）
2. Agent 对已存在的 artifact 再次调用 `room.publish_artifact`
3. 执行 `POST /artifacts/:id/versions/:version/restore`（恢复即创建新版本，历史始终向前）

**内容存储模型（对齐现有 schema）：** `artifacts` 表无 `content` 列（见 `0008_artifacts.sql`）；单文件产物（web_page / web_app / document / presentation）的内容存储在 `artifact_files.new_content`（`path = 'index.html'` / `'content.md'` 等）。`artifact_versions` 表快照的是 `artifact_files` 的内容，不是 `artifacts` 表的列。

版本创建流程（同一 SQLite 事务）：
1. 写 / 更新 `artifact_files` 行（`new_content = 新内容`）
2. 写 `artifact_versions` 行（`content = 新内容快照`）
3. 发 `artifact.version.created`（durable, both）
4. 写 message part + 发 `message.part.added`（durable, **both**，复用已有注册）

`0019_v12.sql` **不**新增 `artifacts.content` 列。`artifact_versions.content` 是独立快照列，不依赖 `artifacts` 表。

### D5b — 二进制 Artifact 存储契约（presentation_pptx / file）

文本产物（web_page / web_app / document / presentation）内容存在 `artifact_files.new_content`（TEXT）。
二进制产物（presentation_pptx / generic_file with binary content）不能存入 TEXT 列，必须存为文件：

**`room.publish_artifact` 二进制路径：**

```typescript
// Agent 调用方式（filePath 指向 workspace 内的文件）
room.publish_artifact({
  kind: "presentation_pptx",
  filePath: "output/deck.pptx",   // 相对于 workspace root
  filename: "deck.pptx",
  mimeType?: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
})
```

**Daemon 处理流程：**
1. 将文件从 `{workspace}/{filePath}` 复制到受控 artifact storage：`{workspace}/.agenthub/artifacts/<artifactId>/v1/<filename>`。
2. `artifact_files` 行写法：`path = filename`，`new_content = NULL`，`content_path = 受控 storage 路径`（复用已有列），`binary = 1`（复用 `0018_artifact_lifecycle.sql` 已有列），`new_sha256 = sha256 of file`（复用已有列），`mime_type = mimeType`，`size_bytes = file size`。
3. `artifact_versions` 行：`content = NULL`，`storage_path = 受控路径`，`content_encoding = 'binary'`（均为本次新增列，见上方 CREATE TABLE）。
4. Download / officecli watch / 部署打包 均从 `artifact_files.content_path` 读取文件路径。

**`0019_v12.sql` 对 `artifact_files` 只需新增两列（其余已存在）：**

```sql
-- 已存在（不重复添加）：content_path, binary, old_sha256, new_sha256
ALTER TABLE artifact_files ADD COLUMN mime_type   TEXT;
ALTER TABLE artifact_files ADD COLUMN size_bytes  INTEGER;
```

**`artifact_versions` 列已在上方 CREATE TABLE 中定义**（含 `storage_path`、`content_encoding`），无需单独 ALTER。

**Editor tab 对二进制 artifact 行为：** `presentation_pptx` / `binary=1` 的产物隐藏 Editor tab（不可文本编辑）；History tab 显示版本列表（filename / size / new_sha256 / created_at）+ Download / Restore。Restore 二进制版本：从 `artifact_versions.storage_path` 复制文件到新路径，写新 `artifact_versions` 行（`content_encoding='binary'`），更新 `artifact_files.content_path`。

**参考（AionUi `pptPreviewBridge.ts`）：** `officecli watch <filePath>` 接受磁盘文件路径，不接受内存 buffer；因此 `content_path` 是 PPTX 预览的必要入口，不能用 TEXT 列替代。

`ArtifactPreviewModal` 在原有 Preview / Raw 基础上新增：

- **Editor tab**：Monaco 编辑器，语言由文件扩展名自动检测（`.html` → html，`.md` → markdown，`.json` → json 等）；`Ctrl+S` 或 Save 按钮执行版本写入；选中代码后"Reference in Chat"插入 `@artifact:<id>#L12-L30` pill。Editor tab 对 `diff` / `worktree_diff` / `terminal` 类型**隐藏**（这些是只读补丁）。
- **History tab**：版本列表（version number / created_at / created_by / message）；点击某版本加载只读预览；Restore 按钮调 `POST /artifacts/:id/versions/:version/restore`。

**参考（AionUi）：** `open_file_preview(path)` tool-driven 右侧 panel 模型是 Editor tab UX 参考。**参考（OpenCode）：** per-file diff review 是 History tab 的参考。

### D7 — 选区引用入聊天：@artifact / @workspace pill 语法

InputBox 支持两种引用 token，渲染为 pill（显示文件名 + 行范围，可删除）：

```
@artifact:<artifactId>#L12-L30     → 指向 artifacts 表中产物的行范围
@artifact:<artifactId>             → 整个产物（注入摘要头，超过 2KB 则截断并提示用户缩小范围）
@workspace:<relativePath>#L5-L20  → 指向 workspace 目录中文件的行范围
```

发送消息时 daemon 解析 token，提取内容并注入 `<context-ref>` XML 块到 context assembly（在 MissionBrief 之后、正文上下文之前）。

**参考（OpenCode VSCode extension `extension.ts`）：** 用户选中代码 → extension 插入 `@relative/path#L12-L30` 到提示框。AgentHub 适配为 artifact 引用和 workspace 文件引用两种。

### D8 — IM 会话列表排序、置顶、搜索

**排序：**

```sql
SELECT * FROM rooms
WHERE archived_at IS NULL        -- 归档房间排除（archived_at 已存在于 0001_init.sql）
ORDER BY
  (pinned_at IS NOT NULL) DESC,
  pinned_at DESC,
  last_activity_at DESC NULLS LAST
```

`last_activity_at` 随下列操作在同一事务中更新：添加消息、run 开始/完成、任务状态变更、参与者加入。

**归档：** 继续使用 `room.closed` / `room.opened` 事件（已注册），不新增 `room.archived` / `room.unarchived`。`archived_at` 列已存在，V1.2 只需确保 `POST /rooms/:id/close` 设置 `archived_at = now()`，`POST /rooms/:id/open` 清除 `archived_at`。

**置顶：**

```
POST   /rooms/:id/pin   → rooms.pinned_at = now()，发 room.pinned（durable, both）
DELETE /rooms/:id/pin   → rooms.pinned_at = NULL，发 room.unpinned（durable, both）
```

**搜索：** `GET /rooms?q=<keyword>` 在 `rooms.name`、`agent_bindings.contact_name`（关联参与者）、最近 5 条 `messages.content` 中 LIKE 模糊匹配，`LIMIT 20`，按 `last_activity_at DESC` 排序。

### D9 — Pin 关键消息为长期上下文

复用 `messages.pinned_at`（已存在于 `0013_messages_pinned.sql`）。Pin 操作：`POST /rooms/:id/messages/:msgId/pin` → `messages.pinned_at = now()`，`DELETE` 取消。

Context Assembly 优先级更新：

1. Workspace-scoped pinned ContextItems（现有）
2. **Room pinned messages**（V1.2 新增优先级）：`SELECT * FROM messages WHERE room_id = ? AND pinned_at IS NOT NULL ORDER BY pinned_at DESC`
3. Task-scoped confirmed items（现有）
4. Recent confirmed items（现有）
5. Recent messages（按窗口裁剪）

Pinned artifact 引用以 `@artifact:<id>` compact ref 注入，不展开全文，避免 token 爆炸。

**UI：** 消息操作区增加 pin 图标；顶部 Pinned Context 抽屉（默认折叠）显示当前 pinned 消息列表。

### D10 — Agent Contact Directory + InlineAgentEditor

**联系人数据：** `GET /agents/contacts`：

```typescript
type AgentContact = {
  agentBindingId: string
  displayName: string         // contact_name || role.name
  avatarUrl?: string
  roleId: string
  runtimeKind: string         // 'claude-code' | 'opencode' | 'codex' | ...
  capabilities: string[]
  status: "available" | "busy" | "offline"
  description?: string
  lastUsedAt?: number
}
```

`status` 由 active runs 推导；`"offline"` 由 runtime health-check 推导（`GET /runtimes/:id/health`）。

**新建对话流程：** 点"New Chat" → 展示 Contact Directory 面板（覆盖式）→ 选 Agent → 选模式 → 创建 room。

**InlineAgentEditor（对话式创建）：** 联系人面板右上角"+ New Agent" 或 `/create-agent` 触发覆盖式向导。字段：name / avatarUrl / systemPrompt / runtimeId / modelConfigId / skillIds / capabilities / description。"Test Connection" → `POST /runtimes/:id/health` → 绿色/红色 badge。保存 → 创建 `roles` + `agent_bindings` 行（含 `contact_name` / `avatar_url`）→ 新 Agent 入联系人。

**参考（AionUi `custom-agent.md`）：** `InlineAgentEditor` 支持 name / avatar / command / args / env / test connection。

### D11 — 群聊 Orchestrator 可见协调

**分派公告消息：** `team-dispatch.ts` 在写 `task.delegation` 的同一事务中，也写一条 `type='system'` 消息（`sender='orchestrator'`）到聊天流。内容由模板生成："已将任务「{taskTitle}」分配给 {agentName}"。这条消息通过 `message.created` 事件进入 projector，不需要新的事件类型。

**成员短消息 + Artifact Card 分离：** 通过 prompt 强化执行（不增加新后端机制）。Orchestrator prompt 和 teammate prompt 均要求：完成任务后先发简短会话消息，长内容走 `room.publish_artifact` 或 `room.send_file_message`。这与 V1.1 D17 `file-message contract` 一致。

**Orchestrator 最终汇总：** 最后一个 `task.delegation.completed` 事件触发时，`team-dispatch.ts` 写一个 `wake_outbox` 行（reason: `"aggregate"`，payload 含 artifact IDs 列表）唤醒 leader。Leader 发汇总消息（可包含 `@artifact:<id>` 引用）。

**失败降级可见：** teammate 失败时 `team-dispatch.ts` 在同一事务中写一条 `type='system'` 消息到聊天流（失败原因 + 降级策略：跳过 / 重试 / 请用户介入）。

### D12 — 部署发布系统

**参考：** bolt.diy（DeployAlert 两阶段状态，build → deploy），Dokploy（deployment record schema，WebSocket tail log），CapRover（captain-definition + tarball + `isDetachedBuild=true`），Nixpacks（自动检测构建），Caddy（file-server 静态站点）。

**六种 deployment kind：**

**`preview-url`**（本地预览 URL）

1. `POST /deployments { artifactId, kind: "preview-url" }` 或 Agent 调用 `room.deploy_artifact`。
2. 同一事务：写 `deployments` 行（`status='queued'`）+ 发 `deployment.created`（durable, main）+ 写 message part + 发 `message.part.added`（durable, both）。
3. `DeploymentService` 异步：颁发 30 分钟 token，更新 `status='ready'`，`url` 设置，发 `deployment.ready`（durable, main）。
4. `DeploymentCard` 显示 "Open Preview" + 倒计时 + "Redeploy"。
5. `DeploymentExpirySweeper`（内部维护循环，不是用户可见 scheduler/cron）更新 `status='expired'`，发 `deployment.expired`（durable, main）。

**`static-site`**（持久静态站点）

1. artifact 内容写入 `{workspace}/.agenthub/sites/<deploymentId>/index.html`。
2. daemon 内置 Node HTTP static server（`express.static` 或 `serve-static`）持久挂载该目录。
3. URL 格式：`http://127.0.0.1:<sitePort>/sites/<deploymentId>/`。
4. `DeploymentCard` 显示 "Open" + 稳定 URL + "Stop" / "Unpublish"。
5. Stop → 删除目录 + 更新 `status='unpublished'` + 发 `deployment.unpublished`。
6. 参考：Caddy `caddy file-server --root /path/to/dir` 模型。

**`source-zip`**（源码打包下载）

1. `archiver` npm 包将 artifact content 打包到 `{workspace}/.agenthub/exports/{artifactId}-v{version}.zip`。
2. `DeploymentCard` 显示 "Download ZIP" → `GET /deployments/:id/download`。

**`container-export`**（容器导出）

1. 根据 artifact kind 生成 `Dockerfile`（web_page/web_app → nginx 静态托管；source_code → Node/Python/其他）。
2. 生成 build context zip（包含 artifact content + Dockerfile）。
3. `DeploymentCard` 显示 "Download Dockerfile" + "Download Build Context"。
4. 不要求本机有 Docker。

**`container-build`**（容器构建）

1. 检测本机环境：优先 `nixpacks`（`which nixpacks`），次之 `docker`（`which docker`），均无则降级为 `container-export`，在 `DeploymentCard` 提示"本机未检测到 Docker/Nixpacks，已生成 build context 供手动构建"。
2. 有 nixpacks：`nixpacks build {sourcePath} --name {imageTag}` — 自动检测语言/框架，生成 OCI 镜像。
3. 有 docker 无 nixpacks：`docker build -t {imageTag} {contextDir}`。
4. 构建命令通过 Permission Engine `shell.build = ask`（首次确认，之后 remember）。
5. stdout/stderr 实时通过 `deployment.log.appended`（ephemeral, main）推送；`DeploymentCard` 日志面板追加行，参考 Dokploy `listen-deployment.ts` WebSocket tail 模式。
6. build 完成：`status='ready'`，`image_tag` 设置，发 `deployment.ready`；`DeploymentCard` 显示 image tag + "Copy Docker Run Command"。
7. build 失败：`status='failed'`，发 `deployment.failed`；`DeploymentCard` 显示失败原因 + "Retry" + "Download Build Context"（始终可用）。
8. 参考：bolt.diy DeployAlert 两阶段状态（build → deploy）；Nixpacks `src/main.rs` CLI。

**`self-hosted`**（自托管 PaaS，V1.2 固定实现 CapRover）

1. 用户在 Settings → Deploy Providers 配置 CapRover 实例（base_url + credential，credential 写 Keychain，`deployment_providers.credential_ref` 存 Keychain key）。
2. `DeploymentService.deployToCapRover(deploymentId)` 执行：
   a. 自动生成 `captain-definition.json`（静态站点用 `nginx:alpine` + COPY html；应用用 Dockerfile）。
   b. 打包 artifact content + `captain-definition.json` 为 `.tar.gz` tarball。
   c. 上传：`POST {base_url}/api/v2/user/apps/appData/{appName}?detached=1`
      - 认证头：`x-captain-auth: {token}`（**不是** Bearer，参考 `CaptainConstants.ts` headerAuth 字段）
      - Content-Type：`multipart/form-data`，field 名为 `sourceFile`（参考 `AppDataRouter.ts:74`）
      - query param：`detached=1`（即 `isDetachedBuild=true`）
   d. 轮询 `GET {base_url}/api/v2/user/apps/appData/{appName}`（同样用 `x-captain-auth`），每 3 秒，超时 5 分钟。
   e. 构建完成 → 从响应中读取 `data.appDefinition.deployedVersion` / `data.appDefinition.customDomain` 取外部 URL，更新 `deployments.url`，发 `deployment.ready`。
3. `DeploymentCard` 显示 build → deploy 两阶段状态（参考 bolt.diy DeployAlert），外部 URL，"Redeploy" / "Open"。
4. 参考：CapRover `AppDataRouter.ts`（multipart `sourceFile` field），`CaptainConstants.ts`（`x-captain-auth` header），bolt.diy `DeployButton.tsx`（两阶段 UI）。
5. 提供 CapRover mock 测试，验证认证头和 multipart 格式，避免实现时 403。

**Credential 安全：** `deployment_providers.credential_ref` 存 Keychain key（与 API key 存储机制一致），`DeploymentService` 通过 `KeychainBridge.get(credential_ref)` 读取明文 token，不写入 SQLite。

**DeploymentCard 操作区：** Open Preview / Download ZIP / View Logs / Redeploy / Stop / Unpublish / Copy URL / Copy Docker Command（根据 kind 显示不同子集）。

### D13 — WakeAgent Outbox（内部机制）

不作为产品 capability，作为所有 WakeAgent dispatch 的内部交付保证。

所有写 `WakeAgent` 的路径（team-dispatch、dependency unblock、Orchestrator 汇总 wake、restart recovery）统一先写 `wake_outbox` 行（与状态变更在同一事务），由 `WakeOutboxDispatcher`（100ms 轮询，指数退避，最多 3 次）统一执行。

**Daemon 启动恢复（内部）：** 扫描 `runs WHERE status IN ('running', 'queued')`，对应 adapter 进程已死的写 `wake_outbox`（reason: `"restart_recovery"`）；新 run 通过现有 `agent.run.started` 事件让用户知道任务在继续，不额外插聊天消息。

### D14 — 并行开发契约

契约周单 PR 合并到 `main`：
1. `packages/db/migrations/0019_v12.sql`
2. `packages/protocol/src/events/registry.ts` 新增全部 V1.2 事件（含 `"deployment"` EventCategory）
3. Stub 服务文件：`wake-outbox-dispatcher.ts` / `deployment-service.ts` / `ppt-preview-bridge.ts`
4. 新路由类型 stub（含 `ppt-proxy.ts`）

**Dev A 负责：** `wake-outbox-dispatcher.ts`，`run-lifecycle-service.ts`（restart recovery），`task-service.ts`（dependency unblock），`team-dispatch.ts`（分派公告 + 汇总 wake + 失败降级消息），`deployment-service.ts`（container-build + CapRover adapter + WebSocket log）。

**Dev B 负责：** `packages/skills`（六个 builtin skill，含 `officecli-pptx`），`mcp/room-mcp-server.ts`（`room.deploy_artifact` 更新），artifact versioning service，`@artifact`/`@workspace` context-ref resolver，InlineAgentEditor 后端路由，context assembly pinned messages 优先级，`ppt-preview-bridge.ts`，`ppt-proxy` route。

**Dev C 负责：** `apps/web/` — `PreviewCard` / `DocumentCard` / `PresentationCard` / `DeploymentCard`；`ArtifactPreviewModal` + Editor tab + History tab；Agent Contact Directory / InlineAgentEditor 前端；InputBox pill syntax；消息操作完善；Pinned Context drawer；room list 搜索 + 置顶排序；Settings → Deploy Providers。

---

## Risks / Trade-offs

**[Risk] container-build 检测不到 Docker/Nixpacks** → 优雅降级为 `container-export`，DeploymentCard 显示 "本机未检测到构建工具，已生成 Dockerfile 供手动构建" + 下载按钮；用户始终能拿到 Dockerfile。

**[Risk] CapRover provider 轮询状态时 API 不稳定** → 轮询超时（5 分钟）后 `status='failed'`，错误消息包含 CapRover 控制台 URL 供用户直接查看。提供 "Retry" 按钮重新触发。

**[Risk] Artifact Editor 覆盖 worktree-managed artifacts** → `diff` / `worktree_diff` / `terminal` 类型 Editor tab 隐藏，只显示 Preview + Raw。`artifact.kind` 是 guard。

**[Risk] message.part.added 合约增加写路径复杂度** → 这是现有合约（V1.1 D17 已建立）。新路径只需在同一事务中追加 message part 行，不增加新的异步或跨进程操作。

**[Risk] DeploymentCard 日志 (ephemeral) 断线后丢失** → `deployment.log.appended` 是 ephemeral，断线重连后 projector 不 replay 日志行，但 UI 可通过 `GET /deployments/:id/logs` REST 端点拉取 `log_path` 文件全文，实现"断线后查看完整日志"。

**[Risk] Three branches diverge on orchestrator** → Dev A 和 Dev B 文件所有权不重叠（D14）。跨文件变更在 PR 描述中 tag 另一方 review。

---

## Migration Plan

1. **契约周**：合并 `0019_v12.sql` + 事件注册 + stub 服务到 `main`；全量测试通过。
2. **功能分支**：Dev A（`feat/v12-A`）/ Dev B（`feat/v12-B`）/ Dev C（`feat/v12-C`）从此提交建立。
3. **每周合并**：每人每周至少一个完整功能 PR；CI 通过 + 1 人 review。
4. **集成周 E2E 验收清单：**
   - 对话生成网页 → PreviewCard → sandbox iframe 预览 → Monaco 编辑 → 保存版本 → History tab 回滚
   - 生成 Markdown 文档 → DocumentCard → Markdown 渲染 → 选段落 @artifact 引用 → Agent 修改生成新版本
   - 生成 HTML slides → PresentationCard → 翻页浏览 → 下载
   - Agent 用 officecli-pptx skill 生成 deck.pptx → PresentationCard（PptViewer）→ officecli 自动安装（如缺失）→ `/api/ppt-proxy` iframe 真实预览 → 关闭 modal 停止进程 → inactive port 请求返回 403
   - worktree diff → DiffCard → apply/discard
   - 部署网页 → DeploymentCard → preview-url（30min token）→ static-site（持久 URL）→ source-zip → container-export（下载 Dockerfile）→ container-build（如有 Docker/Nixpacks）→ CapRover provider
   - daemon 重启后 in_progress deployment 自动标 failed
   - @ 多 Agent → 分派公告 → Artifact Card 分离 → Orchestrator 汇总
   - 会话搜索 / 置顶 / 归档（room.closed）
   - 联系人列表 / 从联系人发起单聊 / InlineAgentEditor 创建自建 Agent
   - Claude Code + OpenCode 各跑一次完整 run，产出 artifact，run 完成后 status 回 available
5. **Rollback**：`0019_v12.sql` 是纯追加迁移，回滚只需回退应用代码。

---

## Open Questions

- **[DECISION-NEEDED-V1.2-A]** container-build 检测降级策略：是否在 DeploymentCard 上显示 "Install Nixpacks" / "Install Docker" 引导链接？**推荐是**，降低用户摩擦。
- **[DECISION-NEEDED-V1.2-B]** CapRover app name 如何生成？用 `artifactId` 的前 8 位 + slug，还是让用户命名？**推荐**：先自动生成 slug（`{kind}-{artifactId[:8]}`），在 DeploymentCard 上可编辑后再部署。
- **[DECISION-NEEDED-V1.2-C]** `@artifact:<id>` 整体引用（无行号）时：是否注入全文（小文件）+ 截断提示（大文件），还是始终只注入摘要？**推荐**：< 2KB 注入全文；≥ 2KB 注入前 50 行 + 提示"文件较大，建议指定行范围 `#Lx-Ly`"。

---

## V1.2 Event Registry Contract

所有 V1.2 新事件必须在 `packages/protocol/src/events/registry.ts` 中注册后才能使用。`"deployment"` 必须加入 `EventCategory` union。所有 `visibility` 包含 `main` 的事件必须在 `apps/web/src/hooks/useProjector.ts` 中有 handler。

| Event | Category | Durability | Visibility | Payload | Projector Consumer |
|-------|----------|-----------|-----------|---------|-------------------|
| `artifact.version.created` | `artifact` | durable | `both` | `{ artifactId, version, createdBy, message? }` | 更新 artifact card 版本 badge；History tab 追加行 |
| `deployment.created` | `deployment` | durable | `main` | `{ deploymentId, artifactId, kind, provider, status }` | 聊天流插入 DeploymentCard（配合 message.part.added）|
| `deployment.status.changed` | `deployment` | durable | `main` | `{ deploymentId, status, url?, downloadUrl?, imageTag? }` | 更新 DeploymentCard 状态 |
| `deployment.log.appended` | `deployment` | ephemeral | `main` | `{ deploymentId, line }` | DeploymentCard 日志面板追加行（断线后 REST 补全）|
| `deployment.ready` | `deployment` | durable | `main` | `{ deploymentId, url?, downloadUrl?, imageTag? }` | DeploymentCard 显示 ready 状态 + URL/操作区 |
| `deployment.failed` | `deployment` | durable | `main` | `{ deploymentId, error }` | DeploymentCard 显示失败 + error + Retry |
| `deployment.cancelled` | `deployment` | durable | `main` | `{ deploymentId }` | DeploymentCard 更新为 cancelled |
| `deployment.expired` | `deployment` | durable | `main` | `{ deploymentId }` | DeploymentCard 更新为 "已过期 — 重新部署" |
| `deployment.unpublished` | `deployment` | durable | `main` | `{ deploymentId }` | DeploymentCard 更新为 unpublished |
| `room.pinned` | `room` | durable | `both` | `{ roomId, pinnedAt }` | 侧边栏房间列表重排 |
| `room.unpinned` | `room` | durable | `both` | `{ roomId }` | 侧边栏房间列表重排 |
| `task.unblocked` | `task` | durable | `both` | `{ taskId, roomId, unlockedBy }` | Kanban card 清除 blocked 指示器 |
| `wake_outbox.dispatched` | `orchestrator` | durable | `detail` | `{ outboxId, runId }` | 仅 audit/debug |

**说明：**
- `deployment.log.appended` 是 `ephemeral`：日志行量大且无需 replay；断线后通过 `GET /deployments/:id/logs` REST 补全。
- `room.pinned` / `room.unpinned` 是 `visibility: both`：侧边栏（detail stream）和主流（main stream）均需消费，确保置顶后列表实时刷新；归档继续使用已有的 `room.closed` / `room.opened`（`visibility: both`）。
- Workflow 相关事件（`workflow.*`）不在 V1.2 注册，推 V1.3。

**复用事件（不变更注册）：**

| Event | 现有 Visibility | V1.2 用途 |
|-------|----------------|----------|
| `message.part.added` | `both`（已注册） | 聊天流插入 PreviewCard / DocumentCard / PresentationCard / DeploymentCard |
| `message.created` | `main` | Orchestrator 分派公告 / 失败降级 system 消息 |
| `artifact.file.created` | `both` | 产物首次写入 |
| `task.status.changed` | `both` | dependency unblock 后依赖任务变更 |
| `task.activity.added` | `both` | restart recovery wake 记录 activity |
| `agent.run.cancelled` | `both` | restart recovery 取消 stale run |
| `room.closed` | `both` | 归档房间（已有，继续使用）|
| `room.opened` | `both` | 取消归档（已有，继续使用）|

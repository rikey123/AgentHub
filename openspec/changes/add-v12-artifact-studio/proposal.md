## Why

V1.1 完成了多 Agent 协作基础设施（worktree 隔离、completion protocol、MissionBrief、skill system、Kanban、team expansion），但与初始课题需求对照，仍存在产品层面的缺口：用户目前无法通过对话生成网页/文档/演示文稿等产物，无法在聊天流中内联预览、编辑、迭代修改、发布部署这些产物。IM 会话体验缺少搜索、置顶、自建 Agent 对话式创建。群聊 Orchestrator 的协调过程对用户不透明。V1.2 的目标是**全面实现初始课题需求**中所有明确描述的用户功能。

Workflow 产物（`WorkflowDefinition` / DAG 执行 / WorkflowCard）推迟到 V1.3——初始需求提到"Workflow 等产物"，但在整体产品闭环（聊天 → 产物 → 预览 → 编辑 → 发布）尚未打通的情况下，Workflow 的优先级低于网页/文档/演示/代码/Diff 产物和部署发布系统。部署发布（包括容器化部署）不能推迟，原始需求明确列出了该能力。

**成熟开源参考：**
- **bolt.diy**：AI 对话 → 代码产物（`<boltArtifact>` 流式解析）→ DeployAlert 两阶段状态（build → deploy）→ provider deploy；更重要的是 artifact/workbench 卡片、产物与聊天分离模式。
- **Multica**：`frontend-builder` / `one-pager` / `html-slides` agent template，self-contained HTML 约束，附件预览 modal（sandbox iframe，type-routed，too-large/unsupported 状态处理）。
- **OpenCode**：`@relative/path#L12-L30` 选区引用语法（VSCode extension），per-file diff review，`GET /session/:id/diff`，`POST /vcs/patch`。
- **AionUi**：`open_file_preview(path)` tool-driven panel，Office/PPT viewer，`InlineAgentEditor`（name/avatar/command/args/test connection），右侧 preview panel 模型。
- **Golutra**：`ConversationDto`（`pinned` / `lastMessageAt` / `unreadCount`），`ensureDirectConversation`，room list 排序。
- **Dokploy**：BullMQ 队列驱动部署，日志流与 deployment record schema（status / logPath / pid / finishedAt）。
- **CapRover**：`captain-definition` + tarball 上传，`isDetachedBuild` 异步部署模型，底层 Docker/nginx/Let's Encrypt。
- **Nixpacks**：`nixpacks build {path} --name {tag}` 从源码自动检测并生成 OCI 镜像。
- **Caddy**：`caddy file-server --root /path` 静态文件服务模型（持久静态站点参考）。

**前端实现原则：**
- V1.2 Web UI MUST reuse the existing HeroUI component system (`@heroui/react`) and existing AgentHub shell styling.
- V1.2 MUST NOT introduce a separate UI library.
- 新增 UI 优先使用 HeroUI compound pattern：Modal / Tabs / Card / ListBox / Select / Checkbox / RadioGroup / Chip / Badge / Button。
- 上述参考项目用于交互和信息架构参考，不复制视觉皮肤。

## What Changes

### IM 核心完善

- **会话搜索**：`GET /rooms?q=` 在房间名、Agent 显示名、最近消息内容中模糊匹配；左侧列表顶部常驻搜索框，实时 debounce 过滤。
- **新建对话选择 Agent**：新建 room 默认走联系人优先流程：先选联系人，再选模式；单人默认 `Solo` 或 `Assisted`，多人默认 `Assisted` 或 `Team`。旧的 role/runtime/model/skills 精细配置不删除，而是保留在 `Advanced Configuration` 抽屉里；联系人本质上仍然是 `agent_binding` 的展示外壳。`squad` 不删除协议支持，但在 V1.2 UI 中只作为 Advanced 的 lightweight Team preset。
- **置顶与最近活跃排序**：新增 `rooms.pinned_at` / `rooms.last_activity_at`；列表按置顶优先、再按最近活跃排序；`room.closed`/`room.opened` 继续用于归档/取消归档（已有，不改）；新增 `room.pinned`/`room.unpinned` 事件。
- **多会话并行**：房间切换不取消其他房间的 run；后台 run 状态持续通过 SSE 同步到房间列表活跃指示器。
- **消息操作完整性**：Reply（引用回复）、Quote（引用插入输入框）、Regenerate（重新生成最后一条 Agent 消息）、Copy Code（代码块一键复制按钮）、Apply Diff（DiffCard 一键应用）、Expand Preview（展开产物全屏）全部实现；DiffCard / ArtifactCard / DeploymentCard 各自有统一操作区。
- **Pin 关键消息为长期上下文**：复用已有 `messages.pinned_at`（`0013_messages_pinned.sql`）；pinned messages 在 context assembly 中优先于普通消息，不受窗口裁剪；UI 新增 Pinned Context 抽屉（折叠，点击展开），显示当前 pinned 条目，支持取消 pin。

### Agent 联系人与自建 Agent

- **Agent Contact Directory**：左侧新增 Contacts 面板；`GET /agents/contacts` 返回所有 `agent_bindings` 的联系人视图（avatar / displayName / roleName / runtimeName / capabilities / status: available/busy/offline）；点击联系人发起 `Start Chat` 或打开详情/编辑。
- **联系人是 AgentBinding 的 IM 名片**：联系人不是新的执行实体，不与 Role 平级。`contact_name` / `avatar_url` / `contact_description` 只影响展示与 `@` 自动补全，不改变 `role.name`、capabilities、任务分派逻辑。
- **对话式创建自建 Agent**：联系人面板或 InputBox `/create-agent` 触发覆盖式向导（不跳转页面）；支持自然语言预填草稿；填写/确认 name / avatar / system prompt / runtime / model config / skills；"Test Connection" 调 `POST /runtimes/:id/health`；保存后 Agent 进入联系人列表；参考：AionUi `InlineAgentEditor`。

### 群聊 Orchestrator 可见协调

- **主推模式**：V1.2 UI 主推 `Solo` / `Assisted` / `Team`。`Squad` MAY 保留为协议兼容模式，并 MAY 只在 Advanced 中作为 lightweight Team preset 展示；现有 `squad` 协议和迁移兼容 MUST 保留。
- **Assisted 与 Team 的职责区分**：`Assisted` 是群聊讨论/selector 模式；`Team` 是严格工作流模式（leader 拆任务、成员执行、review/汇总），但前端呈现仍需保持群聊感。
- **@ 触发与可见分派公告**：Orchestrator 在调用 `room.delegate` 前，在聊天流中发一条简短分派公告消息（"已将任务分配给 Builder / Reviewer…"）。
- **成员短消息 + Artifact Card 分离**：每个参与 Agent 完成任务后先发 1–2 句简短会话消息，长内容（代码/文档/HTML）必须走 `room.publish_artifact` 或 `room.send_file_message`，不塞入普通气泡；参考：bolt.diy `workbenchStore.addArtifact` 模式。
- **Orchestrator 最终汇总**：所有子任务 `completed` 后，leader 被 `team-dispatch.ts` 唤醒（reason: `"aggregate"`）发送汇总消息，指向各 Agent 产出的 Artifact。
- **失败降级可见**：teammate 失败时 `team-dispatch.ts` 在聊天流中插入一条 system 消息，说明失败原因和降级策略；不只在 Run Detail 里可见。

### 对话式产物 Studio

- **Web 产物流水线（P0）**：四个 builtin skill（`web-page-builder` / `web-app-builder` / `one-pager-builder` / `html-slides-builder`）以 SKILL.md 格式约束模型输出 self-contained HTML；Agent 调用 `room.publish_artifact({ kind: "web_page" | "web_app" | "presentation", content, filename })`；聊天流通过 `message.part.added` 插入 `PreviewCard`；参考：Multica `frontend-builder`，bolt.diy artifact card。
- **文档产物（P0）**：新增 `document-builder` builtin skill（Markdown 文档，带 frontmatter）；聊天流插入 `DocumentCard`；支持 Markdown 渲染预览与下载。
- **演示文稿产物（P0）**：`html-slides-builder` 生成 HTML slides（`kind="presentation"`）；新增真实 PPT/PPTX/ODP 只读预览（`kind="presentation_pptx"`）通过 `officecli watch` 进程 + `/api/ppt-proxy/:port/*` 代理（防 SSRF）+ iframe 嵌入；Agent 生成 `.pptx` 后自动出现 PresentationCard；缺少 officecli 时自动安装；参考：AionUi `pptPreviewBridge.ts`、`OfficeWatchViewer.tsx`。
- **Artifact Editor Workbench（P0）**：`ArtifactPreviewModal` 新增 Editor tab（Monaco，语言自动检测）+ History tab（版本列表，支持 Restore）；`Ctrl+S`/Save 写 `artifact_versions`，发 `artifact.version.created`；参考：OpenCode per-file diff view，AionUi `open_file_preview`。
- **选区引用入聊天（P0）**：`@artifact:<id>#L12-L30` 和 `@workspace:<relativePath>#L5-L20` 在 InputBox 渲染为 pill；发送时 daemon 注入 `<context-ref>` 块到 prompt context assembly；参考：OpenCode VSCode extension `extension.ts`。

### 部署发布系统（Deployment Publish System）

对齐原始需求的全部发布类型，必须在 V1.2 交付：

- **聊天部署指令**：用户在聊天里说"部署这个网页" / Agent 调用 `room.deploy_artifact({ artifactId, kind, providerId? })`；同事务写 `deployments` 行 + 发 `deployment.created` + 发 `message.part.added` 将 DeploymentCard 插入聊天流。
- **本地预览 URL**（`kind="preview-url"`）：30 分钟 token，`DeploymentCard` 显示 "Open Preview" + 倒计时 + "Redeploy"。
- **持久静态站点发布**（`kind="static-site"`）：artifact 内容写入 `{workspace}/.agenthub/sites/<deploymentId>/`，daemon 内置 Node HTTP static server 持久提供服务；参考：Caddy `file-server` 模型。
- **源码 zip 下载**（`kind="source-zip"`）：Node.js `archiver` 打包，`GET /deployments/:id/download`。
- **容器导出**（`kind="container-export"`）：生成 `Dockerfile` + build context zip，不要求本机有 Docker。
- **容器构建**（`kind="container-build"`）：检测本机 `nixpacks` 或 `docker` CLI；优先 Nixpacks；无则降级为 container-export；实时日志通过 `deployment.log.appended` ephemeral event 推送，断线后通过 `GET /deployments/:id/logs` REST 补全；参考：Dokploy `listen-deployment.ts`，bolt.diy DeployAlert 两阶段状态。
- **自托管 PaaS provider**（`kind="self-hosted"`）：V1.2 固定实现 **CapRover** adapter；上传 tarball + 自动生成 `captain-definition.json` → POST 到 CapRover API（`isDetachedBuild=true`）；`DeploymentCard` 显示 build → deploy 两阶段状态 + 外部 URL；credential 通过 `deployment_providers.credential_ref` 引用 Keychain，不存明文 token；参考：CapRover `AppDataHandler`，bolt.diy DeployAlert。

`DeploymentCard` 统一操作区：Open Preview / Download ZIP / View Logs / Redeploy / Stop / Unpublish / Copy URL / Copy Docker Command。

云端 SaaS provider（Vercel / Cloudflare / Fly.io）推 V1.3；Dokploy / Coolify provider adapter 推 V1.3。

### 文档卫生

- README 更新为 V1.2；`package.json` / `apps/web/package.json` / `packages/daemon/package.json` 从 `0.0.0` 升为 `1.2.0`。
- Codex 在运行时目录 UI 中明确标注 `"experimental"`；Claude Code + OpenCode 为 V1.2 认证的两个主力运行时。

## Capabilities

### New Capabilities

- `im-chat-core-completion`：会话搜索、联系人优先的新建对话、置顶/最近活跃排序、多会话并行、消息操作六项、Pin 关键消息为长期上下文。
- `agent-contact-custom`：Agent Contact Directory（available/busy/offline 状态）、AgentBinding 联系人身份模型、对话式向导创建自建 Agent（InlineAgentEditor + Test Connection）。
- `group-chat-orchestration`：@ 触发可见分派公告、成员短消息 + Artifact Card 分离、Orchestrator 最终汇总、失败降级可见。
- `artifact-message-cards`：PreviewCard / DocumentCard / PresentationCard / DiffCard / DeploymentCard 的协议 payload、`message.part.added` 合约、UnknownCard fallback、live projector 更新。 
- `artifact-preview-editing`：网页 sandbox iframe 预览、Markdown 渲染、HTML slides 浏览、真实 PPTX/ODP 只读预览（officecli watch + ppt-proxy）、Monaco 代码编辑器、Raw 视图、下载；统一预览矩阵（image/PDF/audio/video/unsupported/too-large fallback）。
- `artifact-version-history`：`artifact_versions` 表、Save 创建版本、Restore 创建新版本、History tab 版本列表。
- `artifact-reference-context`：`@artifact:<id>#Lx-Ly` / `@workspace:<path>#Lx-Ly` pill 语法、daemon context-ref 注入。
- `deployment-publish`：六种 deployment kind（preview-url / static-site / source-zip / container-export / container-build / self-hosted）、CapRover provider adapter、DeploymentCard、`deployment_providers` 表、`"deployment"` EventCategory。

### Modified Capabilities

- `artifacts`：新增 `artifact_versions` 表和版本历史 API；重写 `artifacts.kind`（见 D3）；`type=deployment` 501 占位完全移除，deployment 升为独立 `deployments` 表。
- `rooms`：新增 `pinned_at` / `last_activity_at` 列；新增 pin 路由和搜索路由；`archived_at` 已存在，不重复添加；归档继续用 `room.closed`/`room.opened`。
- `messaging`：消息操作（Reply / Quote / Regenerate）后端支持；pinned message context assembly 优先级更新（复用 `messages.pinned_at`）；`mentions` / `refs` 结构化 payload 契约定稿。
- `agents`：联系人仍然是 `agent_binding` 的展示层；新增 `agent_bindings.disabled_at` 支撑联系人 disable/archive 生命周期；Contacts API/mention/assignee 全部稳定指向 `agent_binding_id`。
- `web-ui`：FeatureRail 实视图、HeroUI 组件约束、CardSchema / RoomViewModel / Projector 契约前移到契约周锁定。
- `orchestrator`：`wake_outbox` 作为所有 WakeAgent dispatch 的内部交付层；dependency auto-dispatch 作为 workflow engine 内部机制；Orchestrator 群聊公告消息和汇总 wake。
- `skill-system`：新增六个 builtin skill（`web-page-builder` / `web-app-builder` / `one-pager-builder` / `html-slides-builder` / `document-builder` / `officecli-pptx`）。
- `task-workflow-core`：dependency auto-dispatch（内部）；`tasks.last_unblocked_at`。
- `v1-roadmap`：`deployment-static-zip` 升级为完整 `deployment-publish`；collab-visualization 部分实现（Agent 联系人、群聊可见协调）；Workflow artifact 推 V1.3；`bm25-recall` / `vector-search` 占位不变。

## Impact

- **无新增 workspace package**；允许新增必要 npm 依赖（`@monaco-editor/react`、`archiver`、`serve-static`、`form-data` for CapRover multipart；PPTX 预览通过系统 `officecli` CLI，不需要 npm 包）。
- **Schema 迁移** `0019_v12.sql`：新表 `artifact_versions`（含 `content_encoding`/`storage_path`，支持 binary）/ `deployments` / `deployment_providers` / `wake_outbox`；新列 `rooms.pinned_at` / `rooms.last_activity_at` / `artifacts.kind`（含 `presentation_pptx`）/ `tasks.last_unblocked_at` / `agent_bindings.avatar_url` / `agent_bindings.contact_name` / `agent_bindings.contact_description` / `agent_bindings.disabled_at`；`deployments` 表含 `pid` / `started_at` / `finished_at` / `cancelled_at` / `artifact_version` / `last_error`；`artifact_files` 新增 `mime_type` / `size_bytes`（复用已有 `content_path` / `binary` / `new_sha256`，不重复添加）。（`rooms.archived_at` 已存在于 `0001_init.sql`；`messages.pinned_at` 已存在于 `0013_messages_pinned.sql`，均不重复添加。）
- **Protocol**：新增 EventCategory `"deployment"`；注册 V1.2 全部新事件（含 `agent.contact.updated`，见下方 Event Registry Contract）。
- **Orchestrator**：`wake-outbox-dispatcher.ts`（新）、`task-service.ts`（dependency unblock）、`run-lifecycle-service.ts`（restart recovery 内部）、`team-dispatch.ts`（汇总 wake）、`mcp/room-mcp-server.ts`（`room.deploy_artifact` / `room.publish_artifact` 更新）。
- **Daemon**：新路由：`/deployments`（含 redeploy/retry/cancel/unpublish/logs）、`/deployment-providers`（含 test）、`/artifacts/:id/versions`（含 diff）、`/rooms?q=`、`/rooms/:id/pin`、`/agents/contacts`、`/agents/custom`、`/api/ppt-proxy/:port/*`（PPTX preview proxy，SSRF guard）。
- **Web**：`PreviewCard` / `DocumentCard` / `PresentationCard` / `DeploymentCard`（新）；`ArtifactPreviewModal` + Editor tab + History tab（扩展）；Agent Contact Directory / InlineAgentEditor（新）；InputBox pill syntax（新）；消息操作完善；Pinned Context drawer；room list 搜索 + 置顶排序。
- **前端壳层**：FeatureRail 的 `chat` / `contacts` / `runs` / `tasks` / `artifacts` / `settings` 在 V1.2 都必须有真实 panel 或主区域 view，不再允许占位点击无变化。
- **无破坏性变更**：不改 SSE envelope schema、`AgentRuntimeAdapter` 接口、现有事件类型。

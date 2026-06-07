# V1.2 Tasks

## Phase 1 — 契约周（所有人，合并到 main 后再分支）

- [ ] **1.1** 写迁移文件 `0019_v12.sql`
  - 新表：`artifact_versions` / `deployments` / `deployment_providers` / `wake_outbox`
  - `deployments` 含 `id` / `artifact_id` / `artifact_version` / `kind` / `provider_id` / `provider` / `status` / `url` / `download_url` / `image_tag` / `pid` / `log_path` / `started_at` / `finished_at` / `cancelled_at` / `expires_at` / `published_at` / `unpublished_at` / `last_error` / `created_at` / `updated_at`
  - `artifact_versions` 含 `storage_path` / `content_encoding`
  - 新列：`rooms.pinned_at` / `rooms.last_activity_at` / `artifacts.kind`（含 `presentation_pptx`）/ `tasks.last_unblocked_at` / `agent_bindings.avatar_url` / `agent_bindings.contact_name` / `agent_bindings.contact_description` / `agent_bindings.disabled_at`
  - `artifact_files` 新增列：`mime_type` / `size_bytes`（复用已有：`content_path` / `binary` / `new_sha256`，不重复添加）
  - 不重复添加：`rooms.archived_at`（`0001_init.sql`）、`messages.pinned_at`（`0013_messages_pinned.sql`）

- [ ] **1.2** 注册 V1.2 新事件类型
  - 新增 `EventCategory` 值 `"deployment"`
  - 注册：`artifact.version.created`、`deployment.created`、`deployment.status.changed`、`deployment.log.appended`（ephemeral）、`deployment.ready`、`deployment.failed`、`deployment.cancelled`、`deployment.expired`、`deployment.unpublished`、`room.pinned`（both）、`room.unpinned`（both）、`message.pinned`（both）、`message.unpinned`（both）、`task.unblocked`、`agent.contact.updated`（both）、`wake_outbox.dispatched`
  - 为以下新增事件定义 payload schema：`agent.contact.updated`、`message.pinned`、`message.unpinned`、`artifact.version.created`、`task.unblocked`、`wake_outbox.dispatched`
  - `agent.contact.updated` payload：`{ agentBindingId, displayName, avatarUrl?, description?, disabledAt? }`
  - `message.pinned` payload：`{ roomId, messageId, pinnedAt }`
  - `message.unpinned` payload：`{ roomId, messageId }`

- [ ] **1.3** 锁定共享协议 / 前端状态契约
  - 在 `packages/protocol` 中补齐 typed card payload：`ArtifactCardPayload` / `DeploymentCardPayload`
  - 定义 `MessageCreatePayload` 中的 `mentions` / `refs` 结构
  - group-chat mention 消费端读取 `mentions[].agentBindingId`，不再使用 `agentBindingId[]` 裸数组
  - 锁定 `AgentContact` response type
  - 锁定 `RoomViewModel` 字段：`pinnedAt` / `lastActivityAt` / `participantContactNames` / `deploymentsById` / `deploymentLogsById` / `artifactVersionsById`
  - 契约测试：UnknownCard fallback、typed `message.part.added` payload、`deployment.ready` 先于 `message.part.added` 时的 projector merge

- [ ] **1.4** 新增 stub 服务文件（空实现 + 类型定义）
  - `packages/orchestrator/src/wake-outbox-dispatcher.ts`
  - `packages/daemon/src/services/deployment-service.ts`
  - `packages/daemon/src/services/ppt-preview-bridge.ts`
  - `packages/artifacts/src/artifact-versioning-service.ts`

- [ ] **1.5** 新增 REST 路由类型 stub
  - `packages/daemon/src/routes/deployments.ts`
  - `packages/daemon/src/routes/deployment-providers.ts`
  - `packages/daemon/src/routes/artifact-versions.ts`
  - `packages/daemon/src/routes/agents-contacts.ts`
  - `GET /agents/contacts`
  - `POST /agents/custom`
  - `PATCH /agents/contacts/:agentBindingId`（编辑 contact / binding config）
  - `DELETE /agents/contacts/:agentBindingId`（hard delete 或 disable）
  - `packages/daemon/src/routes/ppt-proxy.ts`

- [ ] **1.6** 跑共享契约基线验证后再作为 backend/web 的 merge base
  - QA：`pnpm.cmd --filter @agenthub/db test` 验证 `0019_v12.sql` 迁移；`pnpm.cmd --filter @agenthub/protocol test` 与 `pnpm.cmd --filter @agenthub/protocol schema:check` 验证 typed payload / UnknownCard fallback / projector 乱序契约；`pnpm.cmd --filter @agenthub/daemon test` 与 `pnpm.cmd --filter @agenthub/orchestrator test` 验证 stub/共享导入链；根目录运行 `pnpm.cmd typecheck`，必要时再跑 `pnpm.cmd check:all`；`lsp_diagnostics` 覆盖所有 Phase 1 改动文件
  - 预期：迁移不重复加列、协议测试全绿、无新的 LSP diagnostics、共享导入链无 unresolved imports；如 `pnpm.cmd check:all` 失败，必须记录精确失败命令与原因，不得含糊写成“typecheck failed”

---

## Phase 2 — Dev A Track（feat/v12-A）：基础设施 + 部署服务

**负责文件：** `wake-outbox-dispatcher.ts`、`run-lifecycle-service.ts`、`task-service.ts`、`team-dispatch.ts`、`deployment-service.ts`、`packages/daemon/src/routes/deployments.ts`、`packages/daemon/src/routes/deployment-providers.ts`

- [ ] **2.1** WakeAgent Outbox Dispatcher
  - 100ms 轮询 `wake_outbox WHERE status='pending' AND (dispatch_after IS NULL OR dispatch_after <= now())`
  - atomic `UPDATE SET status='dispatching' WHERE status='pending'`
  - 成功：`status='dispatched'`；失败：指数退避，最多 3 次后 `status='failed'`
  - Daemon 启动时扫描 `status IN ('pending', 'dispatching')` 并重置为 `pending`

- [ ] **2.2** Daemon 启动恢复（内部）
  - 扫描 `runs WHERE status IN ('running', 'queued')`
  - adapter 进程已死的 run → 写 `wake_outbox`（reason: `"restart_recovery"`）
  - 幂等检查：不重复创建已有 pending run

- [ ] **2.3** Dependency Auto-dispatch
  - `room.complete_task` 处理路径：查询依赖已完成的 task → `tasks.last_unblocked_at = now()` + 发 `task.unblocked` + 写 `wake_outbox`
  - 全部在同一 SQLite 事务中

- [ ] **2.4** Orchestrator 可见协调消息（team-dispatch.ts）
  - 分派时同事务写 system 消息（"已将任务…分配给…"）
  - 任务 failed 时写 failure system 消息（原因 + 降级决策）
  - 最后一个 task 终态时写 `wake_outbox`（reason: `"aggregate"`）

- [ ] **2.5** DeploymentService — preview-url + static-site
  - `createDeployment(artifactId, kind, options)` — 同事务写 deployments + 发 deployment.created + 写 message part + 发 message.part.added
  - `deployPreviewUrl` — 30 分钟 token，复用现有 preview server
  - `deployStaticSite` — 写文件到 `.agenthub/sites/<deploymentId>/`，Node.js static server 挂载
  - `DeploymentExpirySweeper`（内部维护循环，不是用户可见 scheduler/cron）— 处理 preview-url 过期
  - daemon 重启时扫描 `deployments WHERE status='in_progress'` → 标 `failed`（`last_error = "daemon_restarted"`）

- [ ] **2.6** DeploymentService — source-zip + container-export
  - `deploySourceZip` — `archiver` 打包 `artifact_files.new_content` 或 `content_path`（binary 用文件路径）
  - `deployContainerExport` — 根据 artifact kind 生成 Dockerfile 模板 + build context zip

- [ ] **2.7** DeploymentService — container-build
  - 检测：优先执行 `nixpacks --version` / `docker --version`；Windows 用 `where.exe nixpacks` / `where.exe docker`；macOS/Linux 用 `command -v nixpacks` / `command -v docker`；不用 `which`
  - 优先 Nixpacks：`nixpacks build {buildDir} --name {imageTag}`
  - 回退 Docker：`docker build -t {imageTag} {contextDir}`
  - 通过 Permission Engine `shell.build = ask`
  - 实时 stdout/stderr → `deployment.log.appended`（ephemeral）+ 写 `log_path` 文件
  - `deployments.pid` 记录进程 PID，支持 cancel
  - `POST /deployments/:id/cancel` → kill 进程 + `status='cancelled'`

- [ ] **2.8** DeploymentService — CapRover self-hosted
  - `deployment_providers` CRUD 路由，credential 写 Keychain
  - Test Connection：`GET {baseUrl}/api/v2/user/info`，认证头 `x-captain-auth: {token}`（不是 Bearer）
  - 部署：multipart POST，field 名 `sourceFile`，认证头 `x-captain-auth`，`?detached=1`
  - 3 秒轮询，超时 5 分钟，获取外部 URL
  - 提供 CapRover mock 测试，验证认证头和 multipart 格式

- [ ] **2.9** 完整 Deployment REST API
  - `POST /deployments/:id/redeploy`、`POST /deployments/:id/retry`、`POST /deployments/:id/cancel`、`POST /deployments/:id/unpublish`
  - `GET /deployments?artifactId=`（历史列表）
  - `GET /deployments/:id/logs`（全文日志，plain text）
  - `POST /deployment-providers/:id/test`
  - `DELETE /deployment-providers/:id`（同时删除 Keychain credential）

- [ ] **2.10** RoomList backend retrofit
  - `GET /rooms?q=<keyword>`：搜索 `rooms.name` / participants `contact_name` / 最近 5 条 `messages.content`，排除 `archived_at IS NOT NULL`，`LIMIT 20`
  - `POST /rooms/:id/pin`：同事务更新 `rooms.pinned_at` 并 publish `room.pinned`
  - `DELETE /rooms/:id/pin`：同事务清空 `rooms.pinned_at` 并 publish `room.unpinned`
  - list/search rooms 返回 `pinnedAt` / `lastActivityAt` / `participantContactNames`
  - 在 send message、run start/complete、task status change、participant join 的同一事务中维护 `rooms.last_activity_at`
  - 测试覆盖搜索、置顶排序、归档过滤、`last_activity_at` 更新

- [ ] **2.11** Phase 2 测试
  - WakeAgent outbox：crash recovery 后 pending 行重新 dispatch
  - DeploymentService：preview-url 30 分钟过期、static-site stop、container-build cancel by pid
  - CapRover mock：x-captain-auth header、multipart sourceFile field
  - daemon 重启后 in_progress deployment 标 failed
  - QA 执行：至少运行 `pnpm.cmd --filter @agenthub/daemon test`、`pnpm.cmd --filter @agenthub/orchestrator test`、`pnpm.cmd --filter @agenthub/db test`、根目录 `pnpm.cmd typecheck`；若新增更窄的 `vitest run <file>` 命令，可额外补跑并记录；对 `packages/daemon/src`, `packages/orchestrator/src`, `packages/db/src` 所有改动文件跑 `lsp_diagnostics`
  - 预期：事件必须在同一事务内发布；`message.part.added` 插入 DeploymentCard；房间搜索/置顶行为与 spec 一致；改动文件 diagnostics clean

---

## Phase 3 — Dev B Track（feat/v12-B）：产物系统 + 技能 + PPT Bridge

**负责文件：** `packages/skills/`、`packages/artifacts/src/artifact-versioning-service.ts`、`mcp/room-mcp-server.ts`、`context-assembly.ts`（pin 优先级）、context-ref resolver、`packages/daemon/src/routes/agents-contacts.ts`、`packages/daemon/src/routes/artifact-versions.ts`、`packages/daemon/src/services/ppt-preview-bridge.ts`、`packages/daemon/src/routes/ppt-proxy.ts`

- [ ] **3.1** 六个 Builtin Skill（SKILL.md packages）
  - `web-page-builder`（kind: web_page）
  - `web-app-builder`（kind: web_app）
  - `one-pager-builder`（kind: web_page）
  - `html-slides-builder`（kind: presentation）
  - `document-builder`（kind: document）
  - `officecli-pptx`（kind: presentation_pptx）：参考 AionUi `officecli-pptx/SKILL.md`；有效命令使用 `officecli view "$FILE" text/outline/svg` 和 `officecli get "$FILE" "/slide[N]"`；不使用 `extract-slide`（该命令无 reference 支撑）

- [ ] **3.2** Artifact Versioning Service（文本 + binary）
  - `createVersion(artifactId, content, options)` — 同事务：写 `artifact_files.new_content` + 写 `artifact_versions`（`content_encoding='text'`，version++）+ 发 `artifact.version.created`
  - `createBinaryVersion(artifactId, filePath, options)` — 复制文件到 `.agenthub/artifacts/<id>/v<n>/`；写 `artifact_files`（`content_path`、`binary=1`、`mime_type`、`size_bytes`、`new_sha256`）；写 `artifact_versions`（`storage_path`、`content_encoding='binary'`、`content=NULL`）
  - `GET /artifacts/:id/versions/:from/diff/:to` — 文本返回 unified diff；binary 返回 metadata diff（filename/size/hash）
  - `POST /artifacts/:id/versions/:version/restore` — 文本恢复 `artifact_files.new_content`；binary 恢复复制 `storage_path` 到新版本路径并更新 `artifact_files.content_path`
  - `GET /artifacts/:id/download`（Content-Disposition attachment；binary 从 `content_path` 读文件）

- [ ] **3.3** room.publish_artifact 更新（binary 支持）
  - 接受 `filePath` 参数（二进制产物路径，相对于 workspace root）
  - 路径穿越防护（`path.resolve` 后验证在 workspace 内）
  - 同事务：写 artifacts + `createBinaryVersion` 或 `createVersion` + 写 message part + 发 `message.part.added`

- [ ] **3.4** Artifact library/list API
  - 确认或扩展 `GET /artifacts` 支持 `roomId?` / `kind?` / `q?` / `includeDeleted?` / `limit?`
  - 返回 `kind` / `title` / `filename` / `latestVersion` / `updatedAt` / `roomId` / `createdBy` / `mimeType` / `sizeBytes`
  - 支持 Recent Artifacts 默认排序，满足 FeatureRail `artifacts` 全局入口

- [ ] **3.5** PPT Preview Bridge（ppt-preview-bridge.ts）
  - 参考 AionUi `pptPreviewBridge.ts`
  - 检测 officecli：Windows 用 `where.exe officecli` 或 `officecli --version`；`ENOENT` 时触发自动安装
  - 自动安装：Windows PowerShell irm script；macOS/Linux curl/sh；安装后 retry once
  - `installFailed` flag：同一 daemon session 安装失败后不重复尝试安装
  - 为每个文件分配独立空闲端口；spawn `officecli watch <filePath> --port <port>`
  - 等待 stdout 出现 `Watch:` 或 HTTP 200
  - active sessions map：`Map<port, { filePath, pid, status }>` 用于 SSRF guard
  - `isActivePreviewPort(port)` — 验证端口属于活跃 session
  - 组件卸载时 stop；daemon 退出时 stop all

- [ ] **3.6** PPT Proxy Route（/api/ppt-proxy/:port/*）
  - 参考 AionUi `apiRoutes.ts`（`registerOfficecliWatchProxy`）
  - 每次请求验证 port 属于 `pptPreviewBridge.isActivePreviewPort(port)`；否则返回 403
  - 代理到 `http://localhost:<port>/<path>`
  - 重写 Location header，注入导航守卫 script（防 iframe 跳出 proxy base path）
  - 不能作为通用 localhost 代理

- [ ] **3.7** @artifact / @workspace Context-Ref Resolver
  - 解析 `@artifact:<id>#Lx-Ly`、`@artifact:<id>#slide=N`、`@workspace:<path>#Lx-Ly`
  - 文本产物从 `artifact_files.new_content` 提取行范围
  - binary/pptx 产物 `#slide=N`：使用 `officecli view "$FILE" text --start N --end N` 提取文本
  - 注入 `<context-ref>` XML 块到 context assembly

- [ ] **3.8** Pinned Messages Context Assembly 优先级
  - 查询 `messages WHERE room_id = ? AND pinned_at IS NOT NULL`
  - 注入为第二优先级（workspace items 之后）
  - binary artifact pin 以 `@artifact:<id>` compact ref 注入，不展开

- [ ] **3.9** Message Pin/Unpin backend retrofit
  - 兼容现有 `POST /messages/:id/pin`，或新增 `POST /rooms/:id/messages/:msgId/pin` 并保留旧路由转发
  - 增加 `DELETE` unpin 路径
  - 在同一 SQLite transaction 中更新 `messages.pinned_at` 并 publish `message.pinned` / `message.unpinned`
  - 更新测试，断言事件发出且 Pinned Context drawer 无刷新更新

- [ ] **3.10** Message actions backend verification
  - Reply：`SendMessage` 接收 `quotedMessageId`，`message.created` / replay payload 保留该字段
  - Regenerate：确认 `POST /messages/:id/regenerate` 保持可用，失败路径可映射到 toast/error
  - Apply Diff / Reject / View Details：确认 `DiffCard` 复用现有 artifact accept/reject/detail 路由；缺路由则补 stub
  - Pin/Unpin：复用 **3.9**
  - 后端/组件测试覆盖每个 action 至少一条 happy path

- [ ] **3.11** Agent Contacts 后端
  - `GET /agents/contacts`（status 推导）
  - `POST /agents/custom`（name 重复校验，创建 roles + agent_bindings）
  - `PATCH /agents/contacts/:agentBindingId`（编辑 contact fields / binding config）
  - `DELETE /agents/contacts/:agentBindingId`（无历史引用可 hard delete；有引用则写 `disabled_at`）
  - 同一 SQLite 事务中更新 `agent_bindings` 并 publish `agent.contact.updated`
  - 确认或补齐 `POST /runtimes/:id/health`；Contacts status 推导复用同一 health 检测逻辑；Claude Code/OpenCode 返回 version/ok/error
  - `/create-agent` 自然语言解析：从 slash command 参数提取 name/runtime/skills hint 预填向导

- [ ] **3.12** Orchestrator Prompt 模板更新
  - 成员短消息 + publish_artifact 分离指令
  - reason="aggregate" 汇总 prompt（150 词）
  - reason="restart_recovery" wake prompt
  - `officecli-pptx` skill 加入 PPTX 生成 Agent 的默认 skill 推荐列表

- [ ] **3.13** Phase 3 测试
  - artifact-versioning：文本 save/restore；binary createBinaryVersion、new_sha256 校验、download、metadata diff
  - ppt-preview-bridge：spawn officecli watch、active port 验证、installFailed guard、stop on unmount
  - ppt-proxy：非活跃 port 返回 403；Location header 重写
  - context-ref resolver：`#slide=N` 调用 officecli view text；`#Lx-Ly` 行范围提取
  - contacts API：status 推导、name 重复校验
  - QA 执行：至少运行 `pnpm.cmd --filter @agenthub/artifacts test`、`pnpm.cmd --filter @agenthub/daemon test`、根目录 `pnpm.cmd typecheck`；若有覆盖 context assembly / room MCP / ppt proxy 的更窄 `vitest run <file>` 命令，可额外补跑并记录；对服务/路由/上下文组装改动文件跑 `lsp_diagnostics`
  - 预期：文本与 binary 分支都创建前进版本；离线 runtime/重复名称返回 spec 约定错误；非活跃代理端口严格 403；diagnostics clean

---

## Phase 4 — Dev C Track（feat/v12-C）：Web 前端

**负责文件：** `apps/web/src/`

- [ ] **4.1** FeatureRail real navigation + HeroUI shell
  - FeatureRail：`chat` / `contacts` / `runs` / `tasks` / `artifacts` / `settings` 每个都有真实 panel/view
  - `artifacts` rail 调用 `GET /artifacts` 展示 Recent Artifacts / Artifact Library，支持 `kind` filter / search / open `ArtifactPreviewModal`
  - 使用 HeroUI 组件体系（Modal/Tabs/Card/ListBox/Select/Chip/Badge/Button），不引入新 UI 库
  - 底部版本标签显示真实 package version（V1.2）

- [ ] **4.2** Contacts rail / panel + Agent Contact Directory
  - Contacts 面板：avatar / displayName（主）/ role·runtime（副）/ status badge / capability tags
  - 联系人详情：Start Chat / Edit / Configure
  - 联系人编辑使用 HeroUI Modal（InlineAgentEditor）
  - Test Connection 调 `POST /runtimes/:id/health`，展示 green/red/experimental runtime 状态与错误信息

- [ ] **4.3** Contact-first NewRoomDialog + Advanced participant config
  - 默认流程：先选联系人，再选模式
  - 主模式：Solo / Assisted / Team
  - Squad 仅在 Advanced 中作为兼容/轻量 preset
  - Advanced 保留 role/runtime/model/skills controls
  - 支持逐联系人配置 role/runtime/model/skills/presence

- [ ] **4.4** PreviewCard / DocumentCard / PresentationCard UI anatomy
  - HeroUI Card anatomy：Header / Body / Footer actions
  - `PreviewCard`：sandbox iframe + Edit/Deploy/Download/Expand
  - `DocumentCard`：Markdown 摘要 + Edit/Reference/Download/Expand
  - `PresentationCard`：HTML slides + PptViewer 双分支；Prev/Next/Reference Slide/Download/Expand
  - `presentation_pptx` states：loading / installing / ready / startFailed / installFailed + Download fallback

- [ ] **4.5** ArtifactPreviewModal 升级为 Artifact Studio
  - Tabs：Preview / Editor / History / Raw（HeroUI Tabs）
  - Editor：Monaco，Ctrl/Cmd+S Save
  - History：文本 Compare/Restore；binary metadata diff + Download/Restore
  - Raw：文本原始内容或 binary metadata + Download
  - Editor 隐藏条件：diff / worktree_diff / terminal / binary=1（presentation_pptx）

- [ ] **4.6** DeploymentCard（完整状态机 + 日志 UI）
  - 状态：queued / in_progress / ready / failed / cancelled / expired / unpublished
  - Body：kind-specific subtitle、Build→Deploy 进度、URL/imageTag/downloadUrl、collapsible logs、failure reason
  - Footer：Open / View Logs / Redeploy / Stop or Cancel / Unpublish / Download / Copy URL / Copy Docker Command
  - `deployment.log.appended` live append；`GET /deployments/:id/logs` REST 补全；去重策略
  - 防重复点击：cancel/retry/redeploy/unpublish 按钮在请求中 disabled

- [ ] **4.7** Input Composer token/pill model
  - 支持 `@AgentName` / `@artifact:<id>#Lx-Ly` / `@artifact:<id>#slide=N` / `@workspace:<path>#Lx-Ly`
  - `@` autocomplete 搜索 participants + contacts
  - `Reference in Chat` 注入 structured pill，不只是字符串
  - 发送时序列化 token string + structured refs（或 deterministic parser）

- [ ] **4.8** RoomList + Pinned Context drawer + message actions
  - RoomList：搜索（debounce 200ms）、置顶排序、归档区折叠、participantContactNames
  - 消息操作：Reply / Quote / Regenerate / Copy Code / Apply Diff / Expand Preview / Pin
  - 顶部 Pinned Context drawer：badge count、展开列表、unpin、大 artifact compact ref warning

- [ ] **4.9** Settings → Deploy Providers
  - 新增 `deploy-providers` tab
  - list/create/edit/delete/test provider
  - credential mask 显示，不回显 token
  - Test Connection 使用 `x-captain-auth`
  - 空状态：提示添加 CapRover provider；V1.2 不显示 Vercel / Cloudflare / Dokploy / Coolify
  - 删除 provider 同时删除 Keychain credential

- [ ] **4.10** Projector normalized state + handlers
  - `RoomViewModel`：`pinnedAt` / `lastActivityAt` / `participantContactNames` / `deploymentsById` / `deploymentLogsById` / `artifactVersionsById`
  - all deployment.* handlers
  - `artifact.version.created` handler
  - `room.pinned/unpinned` handler
  - `message.pinned/unpinned` handler（更新 Pinned Context drawer）
  - `agent.contact.updated` handler（刷新 Contact Directory、room participant display、@ autocomplete 源）
  - `task.unblocked` handler
  - 事件乱序 / replay tests

- [ ] **4.11** Phase 4 测试
  - FeatureRail 每个按钮都有真实结果
  - Contact-first New Chat + Advanced config
  - PresentationCard PptViewer：loading/installing/startFailed/ready
  - DeploymentCard 完整状态机 + log append + REST fallback
  - ArtifactPreviewModal Preview/Editor/History/Raw tabs
  - InputBox pills：@agent / @artifact / @slide / @workspace
  - 消息操作六项 + Pinned Context drawer E2E
  - QA 执行：至少运行 `pnpm.cmd --filter @agenthub/web test`、`pnpm.cmd --filter @agenthub/web build`、根目录 `pnpm.cmd typecheck`；若有覆盖 `useProjector` replay/out-of-order、FeatureRail 导航、Contacts rail、Artifact Studio、DeploymentCard、Input composer pills、Pinned Context drawer 的更窄 `vitest run <file>` 命令，可额外补跑并记录；对改动的 `apps/web/src` 文件跑 `lsp_diagnostics`
  - 预期：所有新卡片和 rail 入口都有可见结果；`deployment.ready` 先于 `message.part.added` 也能渲染 ready 卡；pin/agent.contact/deployment/artifact.version 事件都能无刷新更新 UI

---

## Phase 5 — 集成周（所有人）

- [ ] **5.1** 全套 CI 通过
  - `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm check:all`

- [ ] **5.2** E2E：产物生成与预览
  - 生成网页 → PreviewCard sandbox iframe → Monaco 编辑 → Ctrl+S → History tab Restore
  - 生成 Markdown 文档 → DocumentCard → 选段落 @artifact 引用 → Agent 修改
  - 生成 HTML slides → PresentationCard → 全屏翻页 → "引用此页" pill
  - Agent 用 officecli-pptx skill 生成 deck.pptx → PresentationCard PptViewer → iframe 真实预览
  - officecli 缺失时自动安装流程（如环境允许）
  - 关闭 PPT modal → inactive port 请求返回 403

- [ ] **5.3** E2E：Artifact 编辑与版本历史
  - 编辑 HTML → Save → History tab 新版本 → Restore → 内容恢复
  - binary (pptx) → History tab 显示 size/hash → Restore → content_path 更新
  - 版本间 diff（文本产物）
  - Agent 更新产物 → 自动创建新版本

- [ ] **5.4** E2E：部署发布
  - preview-url → 30 分钟倒计时 → 过期显示
  - static-site → 稳定 URL → daemon 重启 → URL 仍可访问 → Stop → 404
  - source-zip → 下载解压验证
  - container-export → 下载 Dockerfile，内容含正确基础镜像
  - container-build（如有 Docker/Nixpacks）→ 实时日志 → image tag
  - CapRover provider（如配置）→ x-captain-auth → 两阶段状态 → 外部 URL
  - daemon 重启后 in_progress deployment 标 failed
  - DeploymentCard Cancel → 进程停止 → status cancelled

- [ ] **5.5** E2E：群聊 Orchestrator
  - @ 两个 Agent → 分派公告 → Artifact Card 分离 → Orchestrator 汇总
  - Agent 失败 → 聊天流降级消息可见

- [ ] **5.6** E2E：IM 体验 + 前端入口
  - FeatureRail 每个按钮都有真实结果
  - New Chat 默认联系人选择，不直接落到 role/runtime 表单
  - Advanced 展开后仍可配置 role/runtime/model/skills
  - Contact card 展示 avatar/runtime/status/capabilities
  - RoomList 搜索 / 置顶 / 归档都无需刷新
  - Pin 消息 → 顶部 Pinned Context drawer 更新 → Agent 引用 pinned 内容
  - 消息操作六项全部可用
  - 从联系人发起单聊 / 创建自建 Agent

- [ ] **5.7** E2E：Runtime 验收
  - Claude Code：Test Connection → green badge → 单聊 run → web_page artifact → PreviewCard → status available
  - OpenCode：同上，document artifact → DocumentCard
  - Codex：显示 experimental badge，不计入主流 runtime 验收

- [ ] **5.8** 事件注册表与 Projector 完整性验证
  - 所有 V1.2 新事件在 `registry.ts` 中注册
  - 所有 `visibility` 含 `main` 的事件在 `useProjector.ts` 有 handler
  - `message.part.added` 是唯一卡片插入信号
  - `deployment.created` 不单独插卡，只 patch `deploymentsById`
  - `room.pinned/unpinned`、`message.pinned/unpinned`、`agent.contact.updated`、`deployment.*`、`artifact.version.created` 均验证 UI 无刷新更新
  - replay 与乱序事件都能重建 / 更新卡片
  - 无孤立事件

- [ ] **5.9** 文档卫生
  - README 更新为 V1.2
  - `package.json` / `apps/web` / `packages/daemon` 版本升 `1.2.0`
  - Codex 在运行时目录 UI 中标注 `"experimental"`

- [ ] **5.10** OpenSpec 收尾归档
  - `openspec validate add-v12-artifact-studio --strict` 通过
  - 按本项目 OpenSpec archive workflow 归档并更新 `openspec/specs/`（如 CLI 命令为 `openspec archive add-v12-artifact-studio`，以实际命令为准）
  - QA 执行：依次跑 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm check:all`、`openspec validate add-v12-artifact-studio --strict`；对最终补丁覆盖的关键文件组跑 `lsp_diagnostics`
  - 手动集成验收：至少逐项走通 artifact 发布/编辑/历史恢复、deployment 创建到 ready/failed/cancelled、contacts 新建会话、group chat orchestration summary/failure、Pinned Context 无刷新更新，并记录每项的入口、预期结果、实际结果
  - 预期：所有命令 exit code 0；手动流转与本 change 的 acceptance scenarios 一致；若存在遗留失败，必须在 archive 前列为 blocker 而不是带病关闭

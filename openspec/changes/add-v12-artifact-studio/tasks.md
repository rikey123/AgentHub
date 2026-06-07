# V1.2 Tasks

## Phase 1 — 契约周（所有人，合并到 main 后再分支）

- [x] **1.1** 写迁移文件 `0019_v12.sql`
  - 新表：`artifact_versions` / `deployments` / `deployment_providers` / `wake_outbox`
  - `deployments` 含 `pid` / `started_at` / `finished_at` / `cancelled_at` / `artifact_version` / `last_error`
  - `artifact_versions` 含 `storage_path` / `content_encoding`
  - 新列：`rooms.pinned_at` / `rooms.last_activity_at` / `artifacts.kind`（含 `presentation_pptx`）/ `tasks.last_unblocked_at` / `agent_bindings.avatar_url` / `agent_bindings.contact_name` / `agent_bindings.contact_description`
  - `artifact_files` 新增列：`mime_type` / `size_bytes`（复用已有：`content_path` / `binary` / `new_sha256`，不重复添加）
  - 不重复添加：`rooms.archived_at`（`0001_init.sql`）、`messages.pinned_at`（`0013_messages_pinned.sql`）

- [x] **1.2** 注册 V1.2 新事件类型
  - 新增 `EventCategory` 值 `"deployment"`
  - 注册：`artifact.version.created`、`deployment.created`、`deployment.status.changed`、`deployment.log.appended`（ephemeral）、`deployment.ready`、`deployment.failed`、`deployment.cancelled`、`deployment.expired`、`deployment.unpublished`、`room.pinned`（both）、`room.unpinned`（both）、`task.unblocked`、`wake_outbox.dispatched`

- [x] **1.3** 新增 stub 服务文件（空实现 + 类型定义）
  - `packages/orchestrator/src/wake-outbox-dispatcher.ts`
  - `packages/daemon/src/services/deployment-service.ts`
  - `packages/daemon/src/services/ppt-preview-bridge.ts`
  - `packages/artifacts/src/artifact-versioning-service.ts`

- [x] **1.4** 新增 REST 路由类型 stub
  - `packages/daemon/src/routes/deployments.ts`
  - `packages/daemon/src/routes/deployment-providers.ts`
  - `packages/daemon/src/routes/artifact-versions.ts`
  - `packages/daemon/src/routes/agents-contacts.ts`
  - `packages/daemon/src/routes/ppt-proxy.ts`

- [x] **1.5** 跑 `pnpm check:all` 全绿后合并到 main，三人各自建立功能分支

---

## Phase 2 — Dev A Track（feat/v12-A）：基础设施 + 部署服务

**负责文件：** `wake-outbox-dispatcher.ts`、`run-lifecycle-service.ts`、`task-service.ts`、`team-dispatch.ts`、`deployment-service.ts`、`packages/daemon/src/routes/deployments.ts`、`packages/daemon/src/routes/deployment-providers.ts`

- [x] **2.1** WakeAgent Outbox Dispatcher
  - 100ms 轮询 `wake_outbox WHERE status='pending' AND (dispatch_after IS NULL OR dispatch_after <= now())`
  - atomic `UPDATE SET status='dispatching' WHERE status='pending'`
  - 成功：`status='dispatched'`；失败：指数退避，最多 3 次后 `status='failed'`
  - Daemon 启动时扫描 `status IN ('pending', 'dispatching')` 并重置为 `pending`

- [x] **2.2** Daemon 启动恢复（内部）
  - 扫描 `runs WHERE status IN ('running', 'queued')`
  - adapter 进程已死的 run → 写 `wake_outbox`（reason: `"restart_recovery"`）
  - 幂等检查：不重复创建已有 pending run

- [x] **2.3** Dependency Auto-dispatch
  - `room.complete_task` 处理路径：查询依赖已完成的 task → `tasks.last_unblocked_at = now()` + 发 `task.unblocked` + 写 `wake_outbox`
  - 全部在同一 SQLite 事务中

- [x] **2.4** Orchestrator 可见协调消息（team-dispatch.ts）
  - 分派时同事务写 system 消息（"已将任务…分配给…"）
  - 任务 failed 时写 failure system 消息（原因 + 降级决策）
  - 最后一个 task 终态时写 `wake_outbox`（reason: `"aggregate"`）

- [x] **2.5** DeploymentService — preview-url + static-site
  - `createDeployment(artifactId, kind, options)` — 同事务写 deployments + 发 deployment.created + 写 message part + 发 message.part.added
  - `deployPreviewUrl` — 30 分钟 token，复用现有 preview server
  - `deployStaticSite` — 写文件到 `.agenthub/sites/<deploymentId>/`，Node.js static server 挂载
  - `CleanupScheduler`（DeploymentExpirySweeper）— 内部维护循环，处理 preview-url 过期，不对外暴露
  - daemon 重启时扫描 `deployments WHERE status='in_progress'` → 标 `failed`（`last_error = "daemon_restarted"`）

- [x] **2.6** DeploymentService — source-zip + container-export
  - `deploySourceZip` — `archiver` 打包 `artifact_files.new_content` 或 `content_path`（binary 用文件路径）
  - `deployContainerExport` — 根据 artifact kind 生成 Dockerfile 模板 + build context zip

- [x] **2.7** DeploymentService — container-build
  - 检测：Windows 用 `where.exe officecli` 或直接 `officecli --version`（不用 `which`）；同理 docker/nixpacks
  - 优先 Nixpacks：`nixpacks build {buildDir} --name {imageTag}`
  - 回退 Docker：`docker build -t {imageTag} {contextDir}`
  - 通过 Permission Engine `shell.build = ask`
  - 实时 stdout/stderr → `deployment.log.appended`（ephemeral）+ 写 `log_path` 文件
  - `deployments.pid` 记录进程 PID，支持 cancel
  - `POST /deployments/:id/cancel` → kill 进程 + `status='cancelled'`

- [x] **2.8** DeploymentService — CapRover self-hosted
  - `deployment_providers` CRUD 路由，credential 写 Keychain
  - Test Connection：`GET {baseUrl}/api/v2/user/info`，认证头 `x-captain-auth: {token}`（不是 Bearer）
  - 部署：multipart POST，field 名 `sourceFile`，认证头 `x-captain-auth`，`?detached=1`
  - 3 秒轮询，超时 5 分钟，获取外部 URL
  - 提供 CapRover mock 测试，验证认证头和 multipart 格式

- [x] **2.9** 完整 Deployment REST API
  - `POST /deployments/:id/redeploy`、`POST /deployments/:id/retry`、`POST /deployments/:id/cancel`、`POST /deployments/:id/unpublish`
  - `GET /deployments?artifactId=`（历史列表）
  - `GET /deployments/:id/logs`（全文日志，plain text）
  - `POST /deployment-providers/:id/test`
  - `DELETE /deployment-providers/:id`（同时删除 Keychain credential）

- [x] **2.10** Phase 2 测试
  - WakeAgent outbox：crash recovery 后 pending 行重新 dispatch
  - DeploymentService：preview-url 30 分钟过期、static-site stop、container-build cancel by pid
  - CapRover mock：x-captain-auth header、multipart sourceFile field
  - daemon 重启后 in_progress deployment 标 failed

---

## Phase 3 — Dev B Track（feat/v12-B）：产物系统 + 技能 + PPT Bridge

**负责文件：** `packages/skills/`、`packages/artifacts/src/artifact-versioning-service.ts`、`mcp/room-mcp-server.ts`、`context-assembly.ts`（pin 优先级）、context-ref resolver、`packages/daemon/src/routes/agents-contacts.ts`、`packages/daemon/src/routes/artifact-versions.ts`、`packages/daemon/src/services/ppt-preview-bridge.ts`、`packages/daemon/src/routes/ppt-proxy.ts`

- [x] **3.1** 六个 Builtin Skill（SKILL.md packages）
  - `web-page-builder`（kind: web_page）
  - `web-app-builder`（kind: web_app）
  - `one-pager-builder`（kind: web_page）
  - `html-slides-builder`（kind: presentation）
  - `document-builder`（kind: document）
  - `officecli-pptx`（kind: presentation_pptx）：参考 AionUi `officecli-pptx/SKILL.md`；有效命令使用 `officecli view "$FILE" text/outline/svg` 和 `officecli get "$FILE" "/slide[N]"`；不使用 `extract-slide`（该命令无 reference 支撑）

- [x] **3.2** Artifact Versioning Service（文本产物）
  - `createVersion(artifactId, content, options)` — 同事务：写 `artifact_files.new_content` + 写 `artifact_versions`（version++）+ 发 `artifact.version.created`
  - `createBinaryVersion(artifactId, filePath, options)` — 复制文件到 `.agenthub/artifacts/<id>/v<n>/`；写 `artifact_files`（`content_path`、`is_binary=1`、`mime_type`、`size_bytes`、`sha256`）；写 `artifact_versions`（`storage_path`、`content_encoding='binary'`）
  - `GET /artifacts/:id/versions/:from/diff/:to` — unified diff（文本产物）；binary 产物返回 size/hash 比较
  - `POST /artifacts/:id/versions/:version/restore`
  - `GET /artifacts/:id/download`（Content-Disposition attachment；binary 从 `content_path` 读文件）

- [x] **3.3** room.publish_artifact 更新（binary 支持）
  - 接受 `filePath` 参数（二进制产物路径，相对于 workspace root）
  - 路径穿越防护（`path.resolve` 后验证在 workspace 内）
  - 同事务：写 artifacts + `createBinaryVersion` 或 `createVersion` + 写 message part + 发 `message.part.added`

- [x] **3.4** PPT Preview Bridge（ppt-preview-bridge.ts）
  - 参考 AionUi `pptPreviewBridge.ts`
  - 检测 officecli：Windows 用 `where.exe officecli` 或 `officecli --version`；`ENOENT` 时触发自动安装
  - 自动安装：Windows PowerShell irm script；macOS/Linux curl/sh；安装后 retry once
  - `installFailed` flag：同一 daemon session 安装失败后不重复尝试安装
  - 为每个文件分配独立空闲端口；spawn `officecli watch <filePath> --port <port>`
  - 等待 stdout 出现 `Watch:` 或 HTTP 200
  - active sessions map：`Map<port, { filePath, pid, status }>` 用于 SSRF guard
  - `isActivePreviewPort(port)` — 验证端口属于活跃 session
  - 组件卸载时 stop；daemon 退出时 stop all

- [x] **3.5** PPT Proxy Route（/api/ppt-proxy/:port/*）
  - 参考 AionUi `apiRoutes.ts`（`registerOfficecliWatchProxy`）
  - 每次请求验证 port 属于 `pptPreviewBridge.isActivePreviewPort(port)`；否则返回 403
  - 代理到 `http://localhost:<port>/<path>`
  - 重写 Location header，注入导航守卫 script（防 iframe 跳出 proxy base path）
  - 不能作为通用 localhost 代理

- [x] **3.6** @artifact / @workspace Context-Ref Resolver
  - 解析 `@artifact:<id>#Lx-Ly`、`@artifact:<id>#slide=N`、`@workspace:<path>#Lx-Ly`
  - 文本产物从 `artifact_files.new_content` 提取行范围
  - binary/pptx 产物 `#slide=N`：使用 `officecli view "$FILE" text --start N --end N` 提取文本
  - 注入 `<context-ref>` XML 块到 context assembly

- [x] **3.7** Pinned Messages Context Assembly 优先级
  - 查询 `messages WHERE room_id = ? AND pinned_at IS NOT NULL`
  - 注入为第二优先级（workspace items 之后）
  - binary artifact pin 以 `@artifact:<id>` compact ref 注入，不展开

- [x] **3.8** Agent Contacts 后端
  - `GET /agents/contacts`（status 推导）
  - `POST /agents/custom`（name 重复校验，创建 roles + agent_bindings）
  - `PATCH /agents/custom/:id`
  - `/create-agent` 自然语言解析：从 slash command 参数提取 name/runtime/skills hint 预填向导

- [x] **3.9** Orchestrator Prompt 模板更新
  - 成员短消息 + publish_artifact 分离指令
  - reason="aggregate" 汇总 prompt（150 词）
  - reason="restart_recovery" wake prompt
  - `officecli-pptx` skill 加入 PPTX 生成 Agent 的默认 skill 推荐列表

- [x] **3.10** Phase 3 测试
  - artifact-versioning：文本 save/restore；binary createBinaryVersion、sha256 校验、download
  - ppt-preview-bridge：spawn officecli watch、active port 验证、installFailed guard、stop on unmount
  - ppt-proxy：非活跃 port 返回 403；Location header 重写
  - context-ref resolver：`#slide=N` 调用 officecli view text；`#Lx-Ly` 行范围提取
  - contacts API：status 推导、name 重复校验

---

## Phase 4 — Dev C Track（feat/v12-C）：Web 前端

**负责文件：** `apps/web/src/`

- [ ] **4.1** PreviewCard / DocumentCard
  - `PreviewCard`：sandbox iframe（`sandbox="allow-scripts"`），操作区（Edit/Deploy/Download/Expand）
  - `DocumentCard`：sanitized Markdown renderer，操作区

- [ ] **4.2** PresentationCard（HTML slides + PptViewer 双分支）
  - `kind='presentation'`（HTML slides）：内嵌 viewer，方向键/触控翻页，全屏模式，"引用此页"→ `#slide=N` pill
  - `kind='presentation_pptx'`（PptViewer）：
    - 检查 officecli 状态（通过 `GET /api/ppt-proxy` 或 bridge API）
    - 状态：loading / installing / startFailed / ready
    - 安装中显示"正在安装 officecli…"；安装完成后刷新
    - 安装失败显示错误 + Download 按钮
    - ready：`<iframe src="/api/ppt-proxy/<port>/" />`
    - 关闭 modal → 调 bridge stop（IPC / REST）

- [ ] **4.3** ArtifactPreviewModal 扩展（Editor + History tab）
  - Editor tab：Monaco，语言自动检测，Ctrl+S 触发 Save
  - Editor tab 隐藏条件：`diff` / `worktree_diff` / `terminal` / `is_binary=1`（presentation_pptx）
  - History tab：版本列表；文本产物有"与当前比较" → 只读 DiffModal；binary 显示 size/hash/Download/Restore
  - "Reference in Chat"悬浮工具栏（文本选区 → `#Lx-Ly` pill；Slide 选区 → `#slide=N` pill）

- [ ] **4.4** DeploymentCard（完整状态机）
  - 状态：queued → in_progress → ready / failed / cancelled / expired / unpublished
  - container-build 和 self-hosted 显示 Build → Deploy 两阶段进度条（参考 bolt.diy DeployAlert）
  - 日志面板：实时追加 `deployment.log.appended`；断线后调 `GET /deployments/:id/logs` 补全
  - 操作区按 kind 显示不同子集
  - projector handlers：所有 deployment.* 事件

- [ ] **4.5** InputBox Pill Syntax（@artifact / @workspace / @slide）
  - Editor tab 选中代码 → "Reference in Chat" → `@artifact:<id>#Lx-Ly` pill
  - Presentation slide 全屏"引用此页" → `@artifact:<id>#slide=N` pill
  - Document 段落选择 → 映射到 `#Lx-Ly` pill
  - `@workspace:<path>#Lx-Ly` 手动输入支持
  - 发送时序列化为 token 字符串

- [ ] **4.6** 消息操作完善
  - Reply（引用回复气泡）、Quote（插入 `>` 引用）、Regenerate（最后一条 Agent 消息）
  - Copy Code（代码块 Copy 按钮）、Apply Diff（DiffCard 操作区）、Expand Preview
  - Pin 消息图标 + Pinned Context 抽屉（顶部折叠，badge 计数）

- [ ] **4.7** Agent Contact Directory + InlineAgentEditor
  - Contacts 面板：avatar/名称/runtime chip/capability tags/status badge
  - 联系人详情：capabilities 全列表 + "Start Chat" + "Edit"
  - InlineAgentEditor：向导表单（name/avatar/systemPrompt/runtime/skills/capabilities）+ Test Connection
  - `/create-agent` slash command → 解析参数 → 预填向导

- [ ] **4.8** 新建对话选 Agent + Room List
  - New Chat → Contact Directory 面板 → 单选 assisted / 多选 squad/team
  - Room list：搜索框（debounce 200ms）、置顶排序、归档区折叠
  - 房间右键/三点菜单：Pin/Unpin、Archive/Unarchive

- [ ] **4.9** Settings → Deploy Providers
  - 列出 providers（name/kind/base_url）
  - 新增/编辑/删除；credential mask 显示
  - "Test Connection"（x-captain-auth）

- [ ] **4.10** Projector 更新（useProjector.ts）
  - 所有 deployment.* 事件 handler
  - `artifact.version.created`（版本 badge 更新）
  - `room.pinned` / `room.unpinned`（侧边栏重排，both stream）
  - `task.unblocked`（Kanban blocked 指示器清除）

- [ ] **4.11** Phase 4 测试
  - PresentationCard PptViewer：loading/installing/startFailed/ready 状态
  - ppt-proxy 403（inactive port）
  - DeploymentCard 完整状态机
  - Editor tab binary artifact 隐藏
  - History tab binary：size/hash/Restore
  - InputBox pill：#Lx-Ly、#slide=N 序列化/反序列化
  - 消息操作六项 E2E

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

- [ ] **5.6** E2E：IM 体验
  - 会话搜索 → 过滤匹配
  - 置顶 → 列表最前，跨重启保持
  - Pin 消息 → Agent 引用 pinned 内容
  - 消息操作六项全部可用
  - 从联系人发起单聊 / 创建自建 Agent

- [ ] **5.7** E2E：Runtime 验收
  - Claude Code：Test Connection → green badge → 单聊 run → web_page artifact → PreviewCard → status available
  - OpenCode：同上，document artifact → DocumentCard
  - Codex：显示 experimental badge，不计入主流 runtime 验收

- [ ] **5.8** 事件注册表完整性验证
  - 所有 V1.2 新事件在 `registry.ts` 中注册
  - 所有 `visibility` 含 `main` 的事件在 `useProjector.ts` 有 handler
  - 无孤立事件

- [ ] **5.9** 文档卫生
  - README 更新为 V1.2
  - `package.json` / `apps/web` / `packages/daemon` 版本升 `1.2.0`
  - Codex 在运行时目录 UI 中标注 `"experimental"`

- [ ] **5.10** openspec validate + apply
  - `openspec validate add-v12-artifact-studio --strict` 通过
  - `openspec apply add-v12-artifact-studio` 归档并更新 `openspec/specs/`

# deployment-publish Specification

## Purpose

实现初始课题需求中的完整部署发布能力：聊天部署指令、DeploymentCard、本地预览 URL、持久静态站点、源码 zip、容器导出/构建、自托管 PaaS provider（CapRover）。

## ADDED Requirements

### Requirement: Deployment 数据模型

The system SHALL store deployments as independent entities in the `deployments` table, separate from `artifacts`.

关系：一个 artifact 可以有多个 deployments（历史记录）；当前活跃 deployment 是 `status IN ('ready', 'in_progress')` 且 `kind` 对应的最新行。

`deployment_providers` 表存储用户配置的自托管 PaaS 实例：

```typescript
type DeploymentProvider = {
  id: string
  workspaceId: string
  kind: "caprover"           // V1.2 only; 'dokploy' | 'coolify' in V1.3
  name: string               // user-facing label
  baseUrl: string
  credentialRef: string      // Keychain key; MUST NOT be plaintext token
}
```

`credential_ref` 必须是 Keychain key，daemon 通过 `KeychainBridge.get(credentialRef)` 读取明文 token。绝不将明文 token 写入 SQLite。

#### Scenario: credential 不能存明文

- **WHEN** `POST /deployment-providers { ..., credential: "raw-api-token" }`
- **THEN** daemon 调用 `KeychainBridge.set(key, "raw-api-token")`，SQLite 只存 `credential_ref = key`

---

### Requirement: 聊天部署指令与 DeploymentCard

The system SHALL insert a DeploymentCard into the chat timeline when a deployment is created, driven by `message.part.added`.

**触发方式：**
1. Agent 调用 `room.deploy_artifact({ artifactId, kind, providerId? })` MCP tool
2. 用户点击 ArtifactCard 操作区的"Deploy"按钮（调用同一 REST 端点）

**原子写路径（同一 SQLite 事务）：**
1. 写 `deployments` 行（`status='queued'`）
2. 发 `deployment.created`（durable, main）
3. 写 message part（`type='deployment'`, `partRef=deploymentId`）或更新现有消息
4. 发 `message.part.added`（durable, both）— projector 凭此插入 DeploymentCard

`artifact.created` / `deployment.created` 单独不能驱动聊天 timeline 插卡片，`message.part.added` 是唯一信号。

**DeploymentCard 字段：**
- kind badge（preview-url / static-site / source-zip / container-export / container-build / self-hosted）
- status（queued / in_progress / ready / failed / cancelled / expired / unpublished）
- build → deploy 两阶段进度条（container-build 和 self-hosted 显示）
- URL / download link（ready 后显示）
- 操作区（根据 kind 显示不同子集）

**操作区按钮：**

| kind | 操作 |
|------|------|
| preview-url | Open Preview · Redeploy · 倒计时 |
| static-site | Open · Stop · Unpublish · Redeploy |
| source-zip | Download ZIP |
| container-export | Download Dockerfile · Download Build Context |
| container-build | Open（如有 URL）· Copy Docker Run · View Logs · Retry（失败时）|
| self-hosted | Open · View Logs · Redeploy · Retry（失败时）|

#### Scenario: Agent 部署指令触发 DeploymentCard

- **WHEN** Agent 调用 `room.deploy_artifact({ artifactId: "abc", kind: "preview-url" })`
- **THEN** 聊天流出现 DeploymentCard，`status=queued`；30 秒内更新为 `ready` 并显示预览 URL
- **AND** 不需要刷新页面即可看到卡片和状态更新

#### Scenario: 用户点击 ArtifactCard 上的 Deploy 按钮

- **WHEN** 用户点击 PreviewCard 的"Deploy"按钮，选择"Static Site"
- **THEN** 同一聊天流中插入 DeploymentCard（static-site），`status` 从 queued → in_progress → ready

---

### Requirement: 本地预览 URL（preview-url）

The system SHALL serve artifact content at a short-lived local URL using the existing preview server infrastructure.

1. `POST /deployments { artifactId, kind: "preview-url" }` 触发。
2. 复用现有 preview server（独立端口，token 机制）：颁发 30 分钟 token，URL 格式 `http://127.0.0.1:<previewPort>/preview/<token>`。
3. `deployments.status='ready'`，`url` 设置，`expires_at = now + 30min`，发 `deployment.ready`。
4. CleanupScheduler 在 token 到期时更新 `status='expired'`，发 `deployment.expired`。
5. DeploymentCard 倒计时显示剩余有效时间；到期后显示"已过期 — 重新部署"。

#### Scenario: 预览 URL 30 分钟后过期

- **WHEN** preview-url deployment 创建后 30 分钟
- **THEN** `deployments.status='expired'`，DeploymentCard 更新为过期状态，"Open Preview"按钮变为"重新部署"

---

### Requirement: 持久静态站点发布（static-site）

The system SHALL serve artifact content at a persistent local URL using a daemon-embedded static file server.

1. artifact content 写入 `{workspace}/.agenthub/sites/<deploymentId>/index.html`（或完整目录结构，如 artifact 包含多文件）。
2. daemon 内置 Node.js HTTP static server（`serve-static` / `express.static`）在专用端口（`sitePort`，默认 6678）挂载该目录。
3. URL：`http://127.0.0.1:<sitePort>/sites/<deploymentId>/`。
4. `deployments.status='ready'`，`url` 设置，`published_at = now()`，发 `deployment.ready`。
5. Stop → 删除目录 + `status='unpublished'`，`unpublished_at = now()`，发 `deployment.unpublished`。
6. Redeploy → 用最新 artifact content 覆写目录，`updated_at` 更新，发 `deployment.status.changed { status: "ready" }`。

#### Scenario: 静态站点发布后稳定可访问

- **WHEN** static-site deployment ready 后，用户 30 分钟内多次访问
- **THEN** URL 始终可用，不会过期；daemon 重启后 static server 重新挂载 sites 目录，URL 依然有效

#### Scenario: Stop 取消发布

- **WHEN** 用户点击"Stop"
- **THEN** 站点目录删除，URL 返回 404，DeploymentCard 显示 unpublished

---

### Requirement: 源码 zip 下载（source-zip）

The system SHALL package artifact content as a downloadable zip file.

使用 `archiver` npm 包。单文件 artifact → zip 包含单文件；多文件 artifact（如 web_app 生成了多个资源）→ zip 包含所有文件，保持目录结构。

输出路径：`{workspace}/.agenthub/exports/{artifactId}-v{version}.zip`。

`GET /deployments/:id/download` 以 `Content-Disposition: attachment` 提供下载。

#### Scenario: 下载 zip

- **WHEN** 用户点击 DeploymentCard 上的"Download ZIP"
- **THEN** 浏览器下载一个包含 artifact 内容的 zip 文件，文件名为 `{artifactName}-v{version}.zip`

---

### Requirement: 容器导出（container-export）

The system SHALL generate a Dockerfile and build context zip without requiring Docker to be installed.

根据 artifact kind 自动选择基础镜像模板：

| artifact kind | Dockerfile 模板 |
|--------------|----------------|
| `web_page`, `web_app`, `presentation` | `nginx:alpine` 静态托管 |
| `document` | `nginx:alpine`（Markdown → HTML 转换后托管）|
| `source_code` | 根据文件扩展名检测：`.js`/`.ts` → `node:20-alpine`；`.py` → `python:3.11-slim`；其他 → `ubuntu:22.04` |
| `generic_file` | `ubuntu:22.04` |

输出两个文件：
- `{workspace}/.agenthub/exports/{artifactId}-Dockerfile`
- `{workspace}/.agenthub/exports/{artifactId}-build-context.zip`（包含 artifact content + Dockerfile）

`DeploymentCard` 显示"Download Dockerfile" + "Download Build Context"两个按钮。

#### Scenario: web_page artifact 生成 nginx Dockerfile

- **WHEN** container-export deployment 对一个 `kind='web_page'` artifact
- **THEN** 生成的 Dockerfile 基于 `nginx:alpine`，COPY artifact HTML 到 nginx html 目录，EXPOSE 80

---

### Requirement: 容器构建（container-build）

The system SHALL attempt to build a container image using Nixpacks or Docker CLI, with graceful fallback to container-export if neither is available.

**检测流程：**
1. `which nixpacks` — 优先使用 Nixpacks（自动框架检测）
2. `which docker` — 次之
3. 均无 → 降级为 `container-export`，DeploymentCard 显示"本机未检测到 Docker/Nixpacks，已生成构建包供手动构建"+ Install Nixpacks 链接

**构建流程（有 Nixpacks 时）：**
1. 将 artifact content 写入临时目录 `{workspace}/.agenthub/builds/<deploymentId}/`。
2. 调用 `nixpacks build {buildDir} --name {imageTag}` — imageTag 格式 `agenthub-{artifactId[:8]}:v{version}`。
3. stdout/stderr 实时推送 `deployment.log.appended`（ephemeral, main）→ DeploymentCard 日志面板追加。
4. 构建成功：`status='ready'`，`image_tag` 设置，发 `deployment.ready`；DeploymentCard 显示 image tag + "Copy Docker Run Command"。
5. 构建失败：`status='failed'`，发 `deployment.failed`；DeploymentCard 显示失败原因 + "Retry" + "Download Build Context"（始终可用）。

**构建命令需要 Permission Engine 授权：** `shell.build = ask`（首次弹权限确认，勾选 remember 后不再问）。

**日志断线补全：** `deployment.log.appended` 是 ephemeral，断线重连后通过 `GET /deployments/:id/logs` REST 端点拉取 `log_path` 文件全文。

#### Scenario: 无 Docker/Nixpacks 时降级

- **WHEN** 用户触发 container-build，本机无 Docker 也无 Nixpacks
- **THEN** deployment kind 自动改为 container-export；DeploymentCard 显示降级说明 + Install Nixpacks 链接；用户仍能下载 Dockerfile 和 build context

#### Scenario: Nixpacks 构建实时日志

- **WHEN** Nixpacks 开始构建
- **THEN** DeploymentCard 日志面板实时显示 nixpacks stdout 行（如 "Detecting providers..." / "Installing Node.js 20..." 等）

#### Scenario: 构建失败

- **WHEN** Nixpacks 构建失败（非零退出码）
- **THEN** `deployment.status='failed'`，DeploymentCard 显示最后几行错误日志 + "Retry" 按钮 + "Download Build Context" 按钮

---

### Requirement: 自托管 PaaS Provider（V1.2 固定实现 CapRover）

The system SHALL support deploying artifacts to a user-configured CapRover instance.

**Provider 配置（Settings → Deploy Providers）：**
- 用户填写 CapRover base URL + API token
- token 存入 Keychain，`deployment_providers.credential_ref` 存 Keychain key
- "Test Connection" → `GET {baseUrl}/api/v2/user/info` with `x-captain-auth: {token}`（**不是** Bearer）→ 成功/失败 badge

**部署流程：**
1. 自动生成 `captain-definition.json`：
   ```json
   {
     "schemaVersion": 2,
     "dockerfilePath": "./Dockerfile"
   }
   ```
2. 打包 artifact content + Dockerfile + captain-definition 为 tarball（`.tar.gz`）。
3. 上传：`POST {baseUrl}/api/v2/user/apps/appData/{appName}?detached=1`
   - 认证头：`x-captain-auth: {token}`（**不是** Bearer；参考 CapRover `CaptainConstants.ts` headerAuth）
   - Content-Type：`multipart/form-data`，field 名为 `sourceFile`（参考 `AppDataRouter.ts:74`）
   - `detached=1` 即 `isDetachedBuild=true`，立即返回，构建在 CapRover 后台执行
4. App name 规则：`{kind}-{artifactId[:8]}`（例 `web-page-a1b2c3d4`）；DeploymentCard 上显示且可在部署前编辑。
5. 轮询 `GET {baseUrl}/api/v2/user/apps/appData/{appName}` 每 3 秒，超时 5 分钟。
6. 构建完成 → 获取外部 URL（`apps[0].customDomain[0].publicDomain` 或默认 CapRover 域名）→ `deployments.url = url`，`status='ready'`，发 `deployment.ready`。
7. 构建失败 → `status='failed'`，发 `deployment.failed`；DeploymentCard 显示 CapRover 控制台链接供用户直接查看日志。

**DeploymentCard 两阶段状态（参考 bolt.diy DeployAlert）：**
```
Build phase:  [spinner] Building on CapRover...  →  [✓] Build complete
Deploy phase: [spinner] Deploying...             →  [✓] Live at https://...
```

#### Scenario: CapRover 部署成功

- **WHEN** 用户对 web_page artifact 选择 CapRover provider 部署
- **THEN** DeploymentCard 显示两阶段进度；部署完成后显示外部 URL（CapRover 提供的域名）；"Open"按钮打开外部 URL

#### Scenario: CapRover 轮询超时

- **WHEN** CapRover 构建超过 5 分钟未完成
- **THEN** `deployment.status='failed'`，DeploymentCard 显示"构建超时" + CapRover 控制台链接

#### Scenario: credential 更新

- **WHEN** 用户在 Settings 更新 CapRover API token
- **THEN** 新 token 写入 Keychain，旧 token 从 Keychain 删除；SQLite 中 `credential_ref` 不变（同一 key）

---

### Requirement: 部署日志 REST 补全

The system SHALL provide a REST endpoint to retrieve full deployment logs for a given deployment, to cover the case where the client missed ephemeral `deployment.log.appended` events.

```
GET /deployments/:id/logs
```

返回 `log_path` 文件的完整内容（plain text），`Content-Type: text/plain`。  
`log_path` 在 deployment 创建时设置（对 container-build 和 self-hosted kinds），对无日志的 kind 返回空字符串。

#### Scenario: 断线后查看完整日志

- **WHEN** 用户在 container-build 过程中网络中断，重连后打开 View Logs 面板
- **THEN** UI 调用 `GET /deployments/:id/logs`，显示完整构建日志（包括断线期间的内容）

---

### Requirement: 完整 Deployment REST API

The system SHALL expose all deployment lifecycle operations as REST endpoints. Every mutating endpoint SHALL publish its matching durable event inside the same SQLite transaction.

```
POST   /deployments                          → 创建 deployment（触发 DeploymentCard 插入聊天流）
GET    /deployments/:id                      → 获取单个 deployment 详情
GET    /deployments?artifactId=<id>          → 获取某 artifact 的所有 deployments（历史记录）
POST   /deployments/:id/redeploy             → 重新部署（创建新 deployment 行复用同一 artifact）
POST   /deployments/:id/retry               → 重试失败的 deployment（in-place，不创建新行）
POST   /deployments/:id/cancel              → 取消 in_progress deployment（停止进程，status='cancelled'）
POST   /deployments/:id/unpublish           → 停止 static-site / self-hosted（status='unpublished'）
GET    /deployments/:id/logs                → 完整日志文本（plain text）
GET    /deployment-providers               → 列出所有 provider 配置
POST   /deployment-providers               → 新增 provider（credential 写 Keychain）
PATCH  /deployment-providers/:id           → 更新 provider 配置
DELETE /deployment-providers/:id           → 删除 provider（同时删除 Keychain credential）
POST   /deployment-providers/:id/test      → 测试连接（x-captain-auth，返回 {ok, version?}）
```

**取消行为（cancel）：** 对 `container-build` kind，停止构建进程（kill by `deployments.pid`）；对 `self-hosted` kind，停止 CapRover 轮询；`status='cancelled'`，发 `deployment.cancelled`（durable, main）。

**deployments 表补充字段（`0019_v12.sql` 需包含）：**

```sql
ALTER TABLE deployments ADD COLUMN pid              TEXT;   -- 构建进程 PID
ALTER TABLE deployments ADD COLUMN started_at       INTEGER;
ALTER TABLE deployments ADD COLUMN finished_at      INTEGER;
ALTER TABLE deployments ADD COLUMN cancelled_at     INTEGER;
ALTER TABLE deployments ADD COLUMN artifact_version INTEGER; -- 部署时的 artifact 版本号
ALTER TABLE deployments ADD COLUMN last_error       TEXT;
```

#### Scenario: 取消 container-build

- **WHEN** 用户点击 DeploymentCard 的 Cancel 按钮，deployment 处于 in_progress 状态
- **THEN** 系统停止构建进程（kill by pid），`status='cancelled'`，发 `deployment.cancelled`；DeploymentCard 更新为 cancelled 状态

#### Scenario: 查看 artifact 的部署历史

- **WHEN** 用户在 ArtifactCard 上点击"Deployment History"
- **THEN** `GET /deployments?artifactId=<id>` 返回该 artifact 所有历史 deployments（按 created_at DESC）；UI 显示历史列表（kind/status/created_at/url）

#### Scenario: daemon 重启后 in_progress deployment 标 failed

- **WHEN** daemon 重启，发现 `deployments WHERE status='in_progress'`
- **THEN** 这些 deployment 的 `status` 更新为 `failed`，`last_error = "daemon_restarted"`，发 `deployment.failed`；不残留悬空的 in_progress 状态


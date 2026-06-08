# v1-roadmap Specification

## Purpose

V1.2 路线图更新：标记 deployment-static-zip 为已实现（升级为完整 deployment-publish）；更新协作可视化交付状态；修正 Docker Deploy 占位与 V1.2 container 能力的关系；新增 Workflow artifact 和 cron V1.3 占位。

## MODIFIED Requirements

### Requirement: V1.0 Deployment(static / zip) 占位（deployment-static-zip）

The system SHALL consider the V1.0 `deployment-static-zip` placeholder fulfilled and superseded by the V1.2 `deployment-publish` capability. Both original roadmap subkinds (`static-site` and `source-zip`) are now implemented, along with four additional deployment kinds.

**V1.2 交付（完整 deployment-publish capability）：**
- `preview-url`：本地预览 URL（30 分钟 token）
- `static-site`：持久本地静态站点发布（daemon 内置 static server）
- `source-zip`：源码 zip 打包下载
- `container-export`：Dockerfile + build context zip（无需本机 Docker）
- `container-build`：本机 Docker/Nixpacks 构建（无则降级为 container-export）
- `self-hosted`：CapRover provider adapter（V1.2 首个自托管 provider）
- `DeploymentCard`：聊天流部署状态卡片，含两阶段进度、实时日志、操作区
- `deployment_providers` 表：自托管 provider 配置（credential via Keychain）

`POST /artifacts { type: "deployment" }` MUST NOT create an artifact row. The route SHALL either be removed or return `400/410 { error: "deployment moved to /deployments" }`. Agent 通过 `room.deploy_artifact` MCP tool 或 `POST /deployments` 触发部署，写入独立 `deployments` 表。

#### Scenario: V1.2 deployment 完整可用

- **WHEN** Agent 调用 `room.deploy_artifact({ artifactId, kind: "static-site" })`
- **THEN** 系统创建 `deployments` 行，DeploymentCard 出现在聊天流，`status` 从 queued → in_progress → ready；不触发旧 501 占位逻辑

#### Scenario: 旧 artifacts deployment 路径不再创建 artifact

- **WHEN** `POST /artifacts { type: "deployment", ... }`
- **THEN** 系统返回 `400` 或 `410`，提示改用 `room.deploy_artifact` 或 `POST /deployments`
- **AND** 不创建 `artifacts` 行

---

### Requirement: V1.1 多 Agent 协作可视化占位（collab-visualization）

The system SHALL deliver the IM and Agent contact layer of collaboration visibility in V1.2. Timeline and topology views remain deferred to V1.3.

**V1.2 新增交付：**
- Agent Contact Directory（联系人面板，available/busy/offline 状态）
- 群聊 Orchestrator 可见协调（分派公告、成员短消息 + Artifact Card 分离、汇总、失败降级）
- @ 多 Agent 触发与显式分派

**仍推迟到 V1.3：**
- Timeline view（Jaeger 风格 agent wake/run/complete 可视化）
- Topology view（who-waked-whom causation graph）
- Dependency DAG view（Task → SubTask → Run tree）
- Workflow artifact（DAG 执行图、WorkflowCard、WorkflowDefinition schema）

#### Scenario: V1.2 联系人可见协调可用

- **WHEN** 用户在 squad room 中 @ 两个 Agent 发送任务
- **THEN** 聊天流出现分派公告；Agent 完成后发短消息 + Artifact Card；Orchestrator 发汇总消息

#### Scenario: V1.3 timeline 仍返回 404

- **WHEN** 用户导航到 `/timeline`
- **THEN** 404 返回；timeline view 是 V1.3

---

### Requirement: V1.4 Docker Deploy 占位（deployment-docker）

The system SHALL consider V1.2 as having delivered local container export and build capabilities. The V1.4 `deployment-docker` placeholder is narrowed to cover only advanced multi-platform, cloud, and desktop-shell container scenarios.

**V1.2 已实现（不再属于 V1.4 占位范围）：**
- `container-export`：生成 Dockerfile + build context zip，无需本机 Docker
- `container-build`：本机 Docker/Nixpacks 构建（无则降级为 container-export）

**V1.4 仍保留（更高级容器场景）：**
- `deployment.docker` subkind 通过云端容器注册表推送和远程部署
- 多平台镜像构建（`docker buildx`）
- Tauri 桌面壳的容器化打包策略

The system SHALL NOT block V1.2 container-export/container-build behind the V1.4 Docker placeholder. Both capabilities are available in V1.2.

#### Scenario: V1.2 container-export 可用

- **WHEN** 用户触发 `container-export` deployment
- **THEN** 系统生成 Dockerfile + build context zip 并提供下载；不返回"V1.4"错误

#### Scenario: V1.4 远程 Docker 推送仍未实现

- **WHEN** 用户尝试推送镜像到远程 Docker Registry
- **THEN** 功能不存在；属于 V1.4 范围

---

## ADDED Requirements

### Requirement: V1.3 Workflow Artifact 占位（workflow-artifact）

The system SHALL reject `room.publish_workflow` MCP tool calls with 501 until V1.3. Workflow artifact (DAG-based execution, WorkflowCard, WorkflowDefinition schema, WorkflowGraphView) is deferred to V1.3.

```typescript
// V1.2: room.publish_workflow returns 501
{ error: "workflow-artifact is V1.3", capability: "v1-roadmap" }
```

#### Scenario: V1.2 调用 room.publish_workflow 返回 501

- **WHEN** Agent 调用 `room.publish_workflow({ nodes: [...], edges: [...] })`
- **THEN** 返回 501 + `{ error: "workflow-artifact is V1.3" }`

---

### Requirement: V1.3 Cron / Recurring Tasks 占位（cron-scheduler）

The system SHALL NOT expose user-facing cron jobs, recurring tasks, or scheduled wakes in V1.2. `wake_outbox.dispatch_after` MAY be used internally for retry/backoff/recovery dispatch, but MUST NOT be exposed as a cron or scheduler product feature until V1.3.

#### Scenario: V1.2 无用户可见的 cron 功能

- **WHEN** 用户访问任何 cron/scheduler UI 或 API endpoint
- **THEN** 功能不存在；dispatch_after 仅作为内部字段

---

### Requirement: V1.3 Cloud Provider Deployment 占位（deployment-cloud）

The system SHALL defer public cloud deployment providers (Vercel, Cloudflare, Fly.io) and additional self-hosted providers (Dokploy, Coolify) to V1.3. V1.2 only implements local and CapRover self-hosted providers.

#### Scenario: V1.2 无 Vercel 部署

- **WHEN** 用户在 Settings → Deploy Providers 查看可用 provider 列表
- **THEN** 列表只显示 CapRover；Vercel/Cloudflare/Dokploy/Coolify 不在 V1.2 列表中

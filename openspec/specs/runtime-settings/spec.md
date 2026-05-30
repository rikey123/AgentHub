# runtime-settings Specification

## Purpose
TBD - created by archiving change add-v10-orchestration. Update Purpose after archive.
## Requirements
### Requirement: Runtime 数据模型

The system SHALL persist `Runtime` as an independent entity in the `runtimes` table. A Runtime represents an execution backend—the "how to run"—independent of any Role or model configuration.

```ts
type RuntimeKind = "claude-code" | "opencode" | "native" | "custom-acp"

type Runtime = {
  id: string                          // ULID 或 well-known id（如 "claude-code-default"）
  workspaceId?: string                // NULL = 用户级
  kind: RuntimeKind
  name: string
  command?: string                    // CLI binary path（claude-code / opencode / custom-acp）
  args?: string[]                     // 额外 CLI args
  env?: Record<string, string>        // 额外环境变量（不含 API key，API key 在 model_config）
  detectedAt?: number                 // 最近一次 detect 成功时间
  detectedPath?: string               // 检测到的 binary 路径
  detectedVersion?: string            // 检测到的版本号
  supportedCapabilities: string[]     // 该 runtime 支持的 AgentCapability 子集
  manifestJson: string                // 完整 AdapterManifest JSON（序列化）
  createdAt: number
  updatedAt: number
}
```

```sql
CREATE TABLE runtimes (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT,
  kind              TEXT NOT NULL CHECK (kind IN ('claude-code','opencode','native','custom-acp')),
  name              TEXT NOT NULL,
  command           TEXT,
  args              TEXT,             -- JSON array
  env               TEXT,             -- JSON object
  detected_at       INTEGER,
  detected_path     TEXT,
  detected_version  TEXT,
  supported_caps    TEXT NOT NULL DEFAULT '[]',  -- JSON array
  manifest_json     TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_runtimes_workspace_kind ON runtimes (workspace_id, kind);
```

`native` runtime 始终存在（daemon 启动时自动注册，不需要用户配置）；`claude-code` / `opencode` 通过 detect 自动发现；`custom-acp` 由用户手动填写 command/args/env。

#### Scenario: daemon 启动时自动注册 native runtime

- **WHEN** daemon 启动
- **THEN** UPSERT runtimes 行 `{ id: "native-default", kind: "native", name: "AgentHub Native" }`
- **AND** emit `runtime.detected`（durable, visibility=detail）

#### Scenario: detect 发现 Claude Code

- **WHEN** daemon 启动时扫描 PATH 找到 `claude` binary
- **THEN** UPSERT runtimes 行 `{ id: "claude-code-default", kind: "claude-code", detectedPath, detectedVersion }`
- **AND** emit `runtime.detected`（durable, visibility=detail）

#### Scenario: detect 未找到 OpenCode

- **WHEN** daemon 启动时未找到 `opencode` binary
- **THEN** runtimes 表无 opencode 行（或保留旧行但 `detectedAt=NULL`）
- **AND** Settings UI Runtimes 页显示 OpenCode 状态为"未安装"

### Requirement: Runtime CRUD + Test API

The system SHALL expose REST endpoints for Runtime management. Test connection result is returned via REST response or job polling—**not** via EventBus.

| Method | Path | 描述 |
|---|---|---|
| `GET` | `/runtimes?workspaceId=<id>` | 列出 runtimes |
| `POST` | `/runtimes` | 创建自定义 runtime（custom-acp）|
| `PATCH` | `/runtimes/:id` | 更新 runtime（command/args/env）|
| `DELETE` | `/runtimes/:id` | 删除 runtime（有 bindings 时拒绝）|
| `POST` | `/runtimes/:id/detect` | 重新检测 binary 路径和版本 |
| `POST` | `/runtimes/:id/test` | 测试 runtime 是否可用 → 同步 200/4xx 或 `{ jobId }` |
| `GET` | `/settings/jobs/:jobId` | 轮询 test job 状态 |

#### Scenario: test connection 同步返回

- **WHEN** 用户点 Claude Code runtime 的"Test connection"
- **THEN** `POST /runtimes/claude-code-default/test` 在 < 5s 内同步返回 `{ ok: true, version: "1.x.x" }` 或 `{ ok: false, error: "binary not found" }`
- **AND** Settings UI 显示测试结果；**不**发 EventBus 事件

#### Scenario: test connection 超时走 job polling

- **WHEN** custom-acp runtime 的 test 需要启动子进程 + 握手，耗时 > 5s
- **THEN** `POST /runtimes/:id/test` 返回 202 `{ jobId }`
- **AND** UI polling `GET /settings/jobs/:jobId` 每 500ms 拉一次，直到 `status: "completed" | "failed"`


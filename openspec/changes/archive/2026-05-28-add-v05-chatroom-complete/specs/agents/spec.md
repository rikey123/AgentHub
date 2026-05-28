# agents (V0.5 delta)

## MODIFIED Requirements

### Requirement: 内置 Agent（MVP 必带）

The system SHALL ship with the following preconfigured AgentProfile templates, written into `~/.agenthub/agents/` on first launch but only if the file does not exist. **V0.5 新增 `builder-opencode` / `reviewer` / `archivist`**，把内置模板从 4 个 mock+claude pair 升级为开箱即用的 4 个真实角色。

| Agent | provider | 能力 | 默认 presence |
|---|---|---|---|
| `mock-builder` | native | chat, code.edit, file.read, file.write | active |
| `mock-reviewer` | native | chat, code.review, context.read, context.write, intervention.knock | observing |
| `claude-code-builder` | claude-code | chat, code.edit, file.read, file.write, terminal.run, context.read, context.write | active |
| `claude-code-reviewer` | claude-code | chat, code.review, context.read, context.write, intervention.knock | observing |
| `builder-opencode`（**V0.5 新增**） | opencode | chat, code.edit, file.read, file.write, terminal.run, context.read, context.write | active |
| `reviewer`（**V0.5 新增**） | claude-code（默认；可改） | chat, code.review, context.read, context.write, intervention.knock | observing |
| `archivist`（**V0.5 新增**） | claude-code（默认；可改） | chat, context.read, context.write | observing |

每份模板 markdown 头加 `version: <semver>` 字段；首启检查目标路径已存在但 version 较旧时仅 stderr 提示"内置模板有更新可用，运行 `agenthub agents reset --id=<id>` 覆盖"，**不**自动覆盖用户已编辑的文件。

`reviewer` 与 `archivist` 的默认 `provider` 保持 `claude-code`；用户可在 settings 切换 OpenCode（V0.5 新支持）或 V1.x 后续 adapter。`archivist` 默认 prompt 引导生成 `confirmed context summary`，与 PreCompact / Run 终结路径协作。

`builder-opencode` 默认 model = OpenCode CLI 默认（详见 design.md V05-5 开工前调研定）；用户可改。

#### Scenario: 首次启动写入 7 个模板

- **WHEN** daemon 第一次启动，`~/.agenthub/agents/` 不存在或为空
- **THEN** 创建该目录，写入上述 7 个 `.md` 模板；user override 优先（同名文件存在时跳过）

#### Scenario: 内置模板有更新但用户已改

- **WHEN** daemon 启动发现 `~/.agenthub/agents/builder-opencode.md` 存在但 `version` 字段早于内置版本
- **THEN** stderr 警告 `Builtin agent 'builder-opencode' has an update; run \`agenthub agents reset --id=builder-opencode\` to overwrite`
- **AND** **不**覆盖用户文件
- **AND** 不阻断 daemon 启动

#### Scenario: builder-opencode 默认模板含 OpenCode provider

- **WHEN** 用户首启后查 `~/.agenthub/agents/builder-opencode.md`
- **THEN** 模板 frontmatter `provider: opencode`、`adapterId: opencode-default`、`capabilities` 含 `terminal.run`
- **AND** Web UI agent 选择列表显示 builder-opencode

### Requirement: AgentProfile 数据模型

The system SHALL persist AgentProfile loaded from markdown files at `<workspace>/.agenthub/agents/*.md` and `<userhome>/.agenthub/agents/*.md`. **V0.5 落实 chokidar 文件系统监听**（MVP §5.5 之前是 `notImplemented` stub）。

```ts
type AgentProfile = {
  id: string                          // 文件名去 .md 后的 kebab-case
  name: string                        // 展示名
  description?: string
  avatar?: string                     // emoji 或 url
  version?: string                    // V0.5 新增；用于内置模板更新检测
  provider:
    | "native"                        // AgentHub 自建（Mock）
    | "claude-code"
    | "opencode"                      // V0.5 起为真实现
    | "codex"                         // V1.x stub
    | "langgraph"                     // V1.3
    | "a2a"                           // V1.3
  adapterId: string                   // 实际 adapter 实例 id
  model?: string                      // 如 "claude-sonnet-4-6"
  prompt: string                      // system prompt（markdown body）
  defaultPresence: "offline" | "observing" | "active"
  capabilities: AgentCapability[]
  permissionProfileId?: string
  hidden?: boolean
}

type AgentCapability =
  | "chat"
  | "code.edit"
  | "code.review"
  | "terminal.run"
  | "file.read"
  | "file.write"
  | "web.search"
  | "web.fetch"
  | "context.read"
  | "context.write"
  | "intervention.knock"
  | "task.delegate"
```

markdown 配置文件示例：

```markdown
---
id: security-reviewer
name: Security Reviewer
avatar: 🛡️
version: 1.0.0
provider: claude-code
adapterId: claude-code-default
model: claude-sonnet-4-6
defaultPresence: observing
capabilities: [chat, code.review, context.read, context.write, intervention.knock]
permissionProfileId: read-only
hidden: false
---

You are a senior security reviewer focused on auth, secret handling, and SQL injection. ...
```

```sql
-- V0.5 不重建 agent_profiles 表，不改现有列名，仅 ALTER TABLE ADD COLUMN 5 列。
-- 现有列映射（不变）：
--   id          ← frontmatter id
--   workspace_id ← NULL（用户级）或 workspace id
--   name        ← frontmatter name
--   adapter_id  ← frontmatter adapterId
--   model       ← frontmatter model
--   role_prompt ← markdown body（system prompt）
--   capabilities ← frontmatter capabilities（JSON array）
--   permission_profile_id ← frontmatter permissionProfileId
--   hidden      ← frontmatter hidden（0/1）
--   source_path ← 来源 markdown 路径
--   created_at / updated_at ← 自动
--
-- V0.5 新增字段（migration 0012_v05.sql）：
--   description TEXT NULL
--   avatar      TEXT NULL
--   version     TEXT NULL   -- 用于内置模板更新检测
--   provider    TEXT NULL   -- "native"|"claude-code"|"opencode"|...
--   default_presence TEXT NULL  -- "offline"|"observing"|"active"
--
-- 注：provider / default_presence / description / avatar 在 MVP 已通过 markdown frontmatter
-- 解析存入内存，V0.5 把它们持久化到 DB 列，便于 API 查询和 UI 展示。
-- 不改现有列名（role_prompt 保留，不改为 prompt）。
ALTER TABLE agent_profiles ADD COLUMN description TEXT;
ALTER TABLE agent_profiles ADD COLUMN avatar TEXT;
ALTER TABLE agent_profiles ADD COLUMN version TEXT;
ALTER TABLE agent_profiles ADD COLUMN provider TEXT;
ALTER TABLE agent_profiles ADD COLUMN default_presence TEXT;
```

V0.5 chokidar 监听规则：

- daemon 启动时启用 chokidar 监听 `~/.agenthub/agents/` 与所有已知 workspace 的 `<workspace>/.agenthub/agents/`
- `add` / `change` 事件 → 解析 markdown → upsert `agent_profiles` → emit `agent.profile.updated` durable event（visibility=detail）
- `unlink` 事件 → 删除 `agent_profiles` 行（如存在 active Run 引用，标 `hidden=1` 而不删）→ emit `agent.profile.removed`
- 解析失败（gray-matter 异常 / 缺字段）→ stderr 警告 + `agent.profile.error` ephemeral event；不删旧行
- chokidar 配置：`ignoreInitial: false`（首启扫描）、`awaitWriteFinish: { stabilityThreshold: 200ms }`（避免编辑器半保存）

#### Scenario: 加载用户级 Agent 配置

- **WHEN** daemon 启动时扫描 `~/.agenthub/agents/`
- **THEN** 解析每个 `.md`（gray-matter）→ 写 `agent_profiles` 表 `workspace_id=NULL`，发 `agent.profile.loaded` durable 事件

#### Scenario: workspace 级覆盖用户级

- **WHEN** `~/.agenthub/agents/builder.md` 与 `<workspace>/.agenthub/agents/builder.md` 同时存在
- **THEN** workspace 级优先生效，用户级被覆盖；`GET /agents?workspaceId=<wid>` 返回 workspace 版

#### Scenario: 配置文件热更新

- **WHEN** 用户编辑保存 `<workspace>/.agenthub/agents/security.md`（chokidar 监听）
- **THEN** daemon 重新解析并 upsert agent_profiles 表，发 `agent.profile.updated` 事件
- **AND** 正在跑的 Run **不受影响**（继续使用启动时的 snapshot prompt）
- **AND** 下一次 wake 该 agent 时使用新 prompt

#### Scenario: 配置文件解析失败

- **WHEN** 用户保存的 markdown 缺少 frontmatter `id` 字段
- **THEN** stderr 警告 `agent profile parse failed at <path>: missing id`
- **AND** 旧 `agent_profiles` 行保留（不删）
- **AND** 发 ephemeral event `agent.profile.error { path, reason }` 用于 Debug Panel

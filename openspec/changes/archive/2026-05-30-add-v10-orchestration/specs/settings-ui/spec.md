# settings-ui (V1.0 delta)

> **参考来源**：
> - **AionUi**（Apache-2.0，可代码级复刻）：
>   - `src/renderer/components/settings/SettingsModal/index.tsx`：Modal-style 设置弹窗结构（tab 导航 + 内容区）。
>   - `src/renderer/pages/settings/AgentSettings/{LocalAgents,InlineAgentEditor,AgentCard}.tsx`：Runtimes tab 的 Local Agents 检测 / 自定义 Agent 命令 / test connection 交互，**可代码级移植**。
>   - `src/renderer/pages/settings/AssistantSettings/{AssistantListPanel,AssistantEditDrawer}.tsx`：Roles tab 的角色列表 + 编辑抽屉，**可代码级移植**。
>   - `src/renderer/components/settings/SettingsModal/contents/{GeminiModalContent,ModelModalContent}.tsx`：Models tab 的 provider 配置 + API key 输入 + test call。
> - **总线契约**：
>   - 写路径：Settings UI 通过 REST POST/PATCH/DELETE 写入；daemon 写 SQLite + emit detail events（audit）；Settings UI **不消费**这些事件
>   - 读路径：**REST-only**；打开 modal 时 GET 全量；写后用 response 刷新；不订阅 SSE，不做 projector handler
>   - 失败路径：HTTP error 直接展示；test job 失败通过 polling 返回

## ADDED Requirements

### Requirement: Settings Modal 六页一级架构

The Web UI SHALL provide a Settings modal (not a separate route) with six top-level tabs. The modal SHALL be opened via FeatureRail Settings icon or Cmd+K → "Open Settings". Closing the modal releases local view state and aborts in-flight REST requests; **no SSE subscription is maintained**.

**六个一级 tab**：

| Tab | 数据源 | 主要交互 |
|---|---|---|
| **Roles** | `GET /roles` | 角色列表 / 新建 / 编辑 / 删除 / AI 生成草稿入口 |
| **Runtimes** | `GET /runtimes` | Runtime 检测状态 / command/args/env 配置 / test connection |
| **Models** | `GET /model-configs` | provider 配置 / API key 输入（写 keychain）/ baseURL / test model call |
| **Permissions** | `GET /permission-profiles` | 内置三档 profile / 自定义 profile / 文件 / shell / tool 规则 |
| **Workspace** | `GET /workspaces/:id` | workspace root / worktree mode / artifact storage / attachment limits / GC |
| **MCP / Tools** | `GET /mcp-servers`（V1.0 只读占位）| 已启用 Room tools 列表 + "外部 MCP server 管理（V1.1）"占位入口 |

**Settings UI 数据流**（REST-only，无 SSE）：

```
打开 Settings modal
  → GET /roles + GET /runtimes + GET /model-configs + GET /agent-bindings（并行）
  → 渲染各 tab

写操作（POST/PATCH/DELETE）
  → daemon 写 SQLite + emit detail event（audit only）
  → HTTP response 返回新数据
  → Settings UI 用 response 更新本地 view state（不重新 GET）

关闭 Settings modal
  → 释放本地 view state
  → abort in-flight REST requests
  → 下次打开重新 GET
```

**多 tab 不实时同步**（V1.0 已知限制）：

- 用户在 tab A 改了 model config，tab B 不会自动刷新；
- 用户关闭并重开 Settings modal 可看到最新数据；
- V1.x 视需求再做实时同步（届时把相关事件 visibility 改 `both` + 新增 main projector）。

#### Scenario: 打开 Settings modal

- **WHEN** 用户点 FeatureRail Settings 图标或按 Cmd+K → "Open Settings"
- **THEN** modal 弹出，并行发 `GET /roles` / `GET /runtimes` / `GET /model-configs` / `GET /agent-bindings`
- **AND** 各 tab 显示 loading skeleton，数据返回后渲染列表
- **AND** **不**建立 SSE 连接

#### Scenario: 关闭 Settings modal

- **WHEN** 用户按 Esc 或点 modal 外部关闭
- **THEN** 本地 view state 释放；in-flight REST request 被 abort
- **AND** 下次打开 modal 重新 GET 全量数据

### Requirement: Roles tab

The Roles tab SHALL display all roles (builtin + user-created) and provide create/edit/delete/generate actions.

**布局**（参考 AionUi `AssistantListPanel.tsx`）：

- 左侧：角色列表（avatar + name + description 摘要 + builtin badge）；
- 右侧：选中角色的编辑面板（参考 `AssistantEditDrawer.tsx`）：name / avatar / description / prompt 编辑器 / capabilities 多选 / default permission profile 下拉；
- 顶部操作栏：搜索框 + "New Role" 按钮（含"手写"和"AI 生成"两个入口）。

**内置 Role 保护**：`is_builtin=true` 的 Role 不允许删除；编辑时显示"内置模板，修改后不再自动更新"提示。

#### Scenario: 新建 Role

- **WHEN** 用户点"New Role → 手写"，填写 name/prompt/capabilities 后点 Save
- **THEN** `POST /roles` → 201 + 新 role 数据 → Settings UI 把新 role 插入本地列表顶部
- **AND** 不订阅 SSE；不等 `role.created` 事件

#### Scenario: 编辑内置 Role

- **WHEN** 用户编辑 `is_builtin=true` 的 Role
- **THEN** 显示 banner "内置模板，修改后不再自动更新；运行 `agenthub roles reset --id=<id>` 可恢复"
- **AND** 允许编辑并保存（PATCH /roles/:id）

### Requirement: Runtimes tab

The Runtimes tab SHALL display all runtimes with detection status and allow configuration of custom-acp runtimes.

**布局**（参考 AionUi `LocalAgents.tsx` + `InlineAgentEditor.tsx`）：

- 每个 runtime 一张卡片（参考 `AgentCard.tsx`）：kind badge + name + detected status（✅ 已检测 / ⚠️ 未安装 / ❌ 检测失败）+ version；
- 点击卡片展开 InlineEditor：command / args / env（JSON 编辑）/ test connection 按钮；
- native runtime 卡片只读（始终可用，无需配置）；
- "Add Custom ACP" 按钮新增 custom-acp runtime。

#### Scenario: test connection 显示结果

- **WHEN** 用户点 Claude Code runtime 的"Test connection"
- **THEN** UI 显示 loading spinner → `POST /runtimes/claude-code-default/test` → 返回 `{ ok: true, version: "1.x.x" }` → 卡片显示"✅ Connected (v1.x.x)"
- **AND** 失败时显示"❌ <error message>"

### Requirement: Models tab

The Models tab SHALL display all model configs grouped by provider and allow create/edit/delete/test.

**布局**（参考 AionUi `ModelModalContent.tsx`）：

- provider 分组（OpenAI / Anthropic / Google / OpenAI-compatible / Ollama）；
- 每个 model config 一行：name + model id + fingerprint + test call 按钮；
- "Add Model" 按钮：选 provider → 填 model id + API key + baseURL（openai-compatible/ollama）；
- API key 输入框：输入时 mask；保存后只显示 fingerprint；"重置"按钮清除旧 key 并输入新 key。

#### Scenario: API key 输入后只显示 fingerprint

- **WHEN** 用户填写 API key `sk-abc...xyz` 并保存
- **THEN** Settings UI 显示 `sk-a...xyz`（fingerprint）；不显示完整 key
- **AND** 用户无法从 Settings UI 读回完整 key

### Requirement: Settings URL deep link（V1.0 最小实现）

The Settings modal SHALL support URL hash state so users can deep-link to a specific tab.

- 打开 Settings modal 时 URL 加 `?settings=roles`（或 `models` / `runtimes` / `permissions` / `workspace` / `mcp`）；
- 关闭时移除 `?settings=*`；
- 直接访问含 `?settings=models` 的 URL 时自动打开 Settings modal 并切到 Models tab。

#### Scenario: URL deep link 打开 Models tab

- **WHEN** 用户访问 `http://127.0.0.1:6677/?settings=models`
- **THEN** 页面加载后自动打开 Settings modal 并切到 Models tab

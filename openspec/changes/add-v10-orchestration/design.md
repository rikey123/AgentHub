# Design: add-v10-orchestration

> 配套 `proposal.md` 阅读。聚焦"如何实现"——架构决策、技术选型、关键权衡、参考实现交叉对照、事件总线契约。**不**重复 proposal 的需求叙述。

## Context

### V0.5 真实状态

V0.5 archived（commit `f28613a`）后主 specs 17 capability：35 测试文件 / 264 passed + 1 skipped；OpenCode adapter 已验证 `AgentRuntimeAdapter` 抽象的鲁棒性；Run Detail 7 tab、Cost 面板、@mention、PendingTurn UI、主题/密度/键盘流齐全；config.toml + SIGINT + CLI 子命令到位。

但 V0.5 留下三个产品级阻塞，已在 proposal 列出：角色与 Runtime 绑死 / 装完没法用 / 多 agent 协作没有非聊天载体。

### 参考实现（必须贯穿全 design + spec）

V1.0 是 AgentHub 第一次跨越"内核稳定 → 产品可用"的版本。每条决策都参考 AionUi（Cowork 桌面产品）+ multica（任务工作流系统）的实战实现，避免重新发明轮子。

**AionUi 关键路径**（reference: `C:/project/refrence/AionUi/`，Apache-2.0，可代码级复刻）：

| 主题 | 路径 | 借鉴 |
|---|---|---|
| Built-in Agent 后端 | `src/process/agent/aionrs/` | 内置 agent runtime 的产品形态：装完即用 + 任意 API key + 文件读写 + tool calling。**不**借代码（aionrs 是 Rust 子项目），借产品边界。 |
| Agent Settings UI | `src/renderer/pages/settings/AgentSettings/{LocalAgents,InlineAgentEditor,AgentCard}.tsx` | Local Agents 检测 / 自定义 Agent 命令 / args / env / test connection / JSON 高级编辑。**可代码级移植**。 |
| Assistant（Role）UI | `src/renderer/pages/settings/AssistantSettings/{AssistantListPanel,AssistantEditDrawer,AssistantAvatar}.tsx` | Role 与 Agent 已经分开（Assistant = 我们的 Role）。这一拆分是 V1.0 数据模型解耦的直接产品验证。 |
| Channels（多端通信）| `src/process/channels/` + `src/renderer/components/settings/SettingsModal/contents/channels/` | 不在 V1.0 范围（D32 红线，AgentHub 永不做 Telegram / Lark / DingTalk 等聊天平台集成）。仅参考其 ChannelHeader / ChannelItem 视觉风格做 Settings 列表。 |
| MCP Agent Status | `src/renderer/hooks/mcp/useMcpAgentStatus.ts` | 工具状态在 UI 实时反馈。 |
| 多 Agent 检测 | `src/renderer/hooks/agent/{useDetectedAgents,useMultiAgentDetection,useAgentReadinessCheck}.ts` | Runtime 就绪检测 + 用户提示装哪个 CLI。 |
| Hub Agents | `src/renderer/hooks/agent/useHubAgents.ts` | Agent 列表展示。 |

**multica 关键路径**（reference: `C:/project/refrence/multica/`，license：modified Apache，**仅借模式不复制代码**）：

| 主题 | 路径 | 借鉴 |
|---|---|---|
| Issue（Task）数据模型 + 状态机 | `server/internal/handler/issue.go` + `server/cmd/multica/cmd_issue.go` | Issue 作为一等实体的字段集合 / 列表查询 / 子 issue / 标签 / metadata。我们的 Task = multica 的 Issue。 |
| Issue 缓存与 WS 同步 | `packages/core/issues/{ws-updaters,cache-helpers,queries,mutations}.ts` | 任务驱动协作的关键：所有 issue 变化通过 WS 实时推送 + 客户端 query cache 增量更新。**这是 V1.0 task-workflow-core 总线契约的直接对照**。 |
| Issue 视图 / 操作 | `packages/views/issues/{actions,components,hooks,utils}/` | Issue list / detail / activity timeline / assignee filter / parent-child hierarchy。 |
| Task Transcript（执行历史）| `packages/views/common/task-transcript/` | Run 与 Task 的关联视图。我们已有 Run Detail 7 tab，task transcript 在 V1.1 单独 board view 时再做。 |
| 子任务完成事件 | `server/internal/handler/issue_child_done.go` | Leader 等待所有子 Task 完成的判定逻辑。 |
| Agent Runtime 后端 | `server/pkg/agent/{claude.go, ...}` | NDJSON stdout 解析 + cancel + cost 上报。我们已有 ACP 基类不需重写，但其 cost 字段映射可参考。 |
| Issue Guard | `server/internal/issueguard/` | 防止重复创建 / parent depth 限制等保护规则。**必须**借鉴，避免我们 V1.0 同样踩坑。 |

> **强制纪律**：每个 V1.0 capability spec 在 Goals/NG 之前 SHALL 列出"参考来源"段，把 AionUi/multica 的对应路径 + 借鉴的边界 / 数据流 / 运行模型显式写出来。这不是装饰，是 spec agent / coding agent 的必读上下文。

### 总线契约（必须贯穿全 V1.0）

V1.0 是 AgentHub 第一次同时引入大量新写路径（role / runtime / model / binding CRUD + role-generator + Native Runtime + Team/Squad 调度 + Task workflow + activity timeline）。这些新路径 SHALL 严格遵守 V0 CLAUDE.md 中的事件总线契约（已落实在主 specs 17 capability 中）：

```
HTTP request / Command  ─►  service mutates SQLite  ─►  EventBus.publish(event)
                                                               │
                                                ┌──────────────┴──────────────┐
                                                ▼                             ▼
                                       outbox + events table          live SSE subscribers
                                       (durable replay)               (browser projector)
```

**V1.0 强制规则**（vs V0 已有的）：

1. **每条新写路径必须发事件**（CRUD / 调度 / Task 状态变化），状态变更和事件发布在同一个 SQLite 事务内（V0 D22 / D31）；新增事件类型必须先注册到 `packages/protocol/src/events/registry.ts` + 加 visibility（main / detail / both）。
2. **visibility=main 或 both 的新事件必须有前端 projector handler**——`apps/web/src/hooks/useProjector.ts` 是唯一前端消费点；visibility=detail 的 audit/debug 事件（如 Settings CRUD 事件）**不要求** projector handler，Settings UI 通过 REST 消费，不订阅 SSE。
3. **不允许前端读 SQLite**——V0 已禁止，V1.0 引入 Settings UI / Task Workflow UI 后这条规则 **再次强调**：所有数据通过事件流 + REST API 两条路径，没有第三条。
4. **不允许前端发事件**——事件是 daemon 单向推送给前端的。前端如需触发"刷新"行为应该通过 Command（POST /commands 或通过 REST 写路径）让 daemon 重新发事件。
5. **新事件枚举（V1.0 候选清单）**：`role.created / .updated / .deleted` / `runtime.detected / .updated / .removed` / `model_config.created / .updated / .deleted` / `agent_binding.created / .updated / .removed` / `task.activity.added` / `task.delegation.created` / `task.delegation.completed` / `team.dispatch.started / .completed`。具体清单和 visibility 由各 capability spec 明确。注：`task.updated` / `task.deleted` 不引入——状态变化走 `task.status.changed`，评论/artifact/run 记录走 `task.activity.added`，删除走 `cancelled` 状态。

> **V0 vs V1.0 的负面案例**：V0.5 archive 时发现 `mailbox.delivery.failed` 没有 dedupe 状态检查，是因为某条 mailbox 写路径漏发事件，UI 静默丢失提示。这种"写状态没发事件"的 bug 在 V1.0 多个新增写路径下风险倍增，所以 spec 层就要每条 mutation 显式列出对应事件。

## Goals / Non-Goals

**Goals**

- **G1**：12–16 周交付 V1.0；用户可以 ① 在 Settings UI 配置 Runtime + Model（API key 填一次即可用）；② 通过 AI 生成或手写创建 Role；③ 用 Native Runtime 跑 agent，而不必装 Claude Code 或 OpenCode CLI；④ 同一个 Role 自由切换 ClaudeCode / OpenCode / Native runtime；⑤ 创建 Team / Squad room 让 Leader 派发；⑥ 在 Side Panel Tasks tab 看到 Task board + 在 Task detail 看到 activity timeline。
- **G2**：通过引入 Native Runtime + Team/Task Workflow 真正压力测试 V0 内核——RunQueue 锁矩阵、activeWakes guard、mailbox carry、Run Detail 双投影、`AgentRuntimeAdapter` 接口——确认无需修改这些核心契约即可支撑 V1.0 增量。
- **G3**：所有 V1.0 新写路径**严格遵守 V0 总线契约**，事件先注册再发布、前端只通过 projector 消费。
- **G4**：每个 capability spec 明确**参考来源**（AionUi/multica 路径 + 借鉴边界），coding agent 实现时把参考代码作为对照而非凭空设计。
- **G5**：旧 AgentProfile **平滑迁移**为新四概念模型（role + runtime + model_config + binding），保留 3 个月双读窗口，V0.5 形态的房间不破坏。

**Non-Goals**

- **NG1**：不做 Deployment（推迟 V1.4 与 Tauri / Docker 一起）。早期范围里有，本 change 显式移除。
- **NG2**：不做 War Room（V1.5）/ A2A 双向（V1.3）/ Plugin（V1.3）/ LangGraph（V1.3）/ Tauri 桌面壳（V1.4）/ 响应式 Web（V1.4）/ Docker（V1.4）。
- **NG3**：不做 Memory / Vector / BM25 / Skill（V1.2）。Native Runtime 不做长期记忆，只做 Run 内 transcript + tool calling。
- **NG4**：不做完整 Kanban 拖拽 / Topology 可视化（V1.1）。V1.0 Side Panel Tasks tab 只做最小列表 + 列分组，不做拖拽。
- **NG5**：不做完整外部 MCP server 管理 UI（V1.0 仅占位入口；V1.1 完整管理）。
- **NG6**：Native Runtime **不**复刻 Claude Code 内部代码智能：不做 repo indexer / patch planner / web search / image generation / 完整 browser automation / 长期 memory。
- **NG7**：Native Runtime **不**自研 provider 协议层。模型调用一律走 Vercel AI SDK；遇 provider bug 走 SDK upgrade，不在 AgentHub 内打补丁。
- **NG8**：永不做云端 / 多用户 / SaaS / Mobile Native / Marketplace（D32 红线）。

## Decisions

### V10-D1：拆 Role / Runtime / ModelConfig / AgentBinding 四概念（结构性地基）

**决定**：把 V0.5 的 `AgentProfile` 拆成四个独立概念，分别落表：

```
roles                     runtimes                   model_configs               agent_bindings
─ id                      ─ id                       ─ id                        ─ id
─ name                    ─ kind                     ─ provider                  ─ workspace_id
─ avatar                  ─ command                  ─ model                     ─ role_id
─ description             ─ args                     ─ base_url?                 ─ runtime_id
─ prompt                  ─ env                      ─ api_key_ref               ─ model_config_id?
─ capabilities            ─ detected                 ─ temperature               ─ override_permission_profile?
─ default_perm_profile    ─ supported_caps           ─ max_tokens                ─ created_at / updated_at
─ tags                    ─ workspace_id?
─ version                 ─ ...
```

- `roles` 是 Persona only：name / avatar / description / prompt / capabilities / default permission profile / tags。**不绑定** runtime 或 model。
- `runtimes` 是执行后端：claude-code / opencode / native / custom-acp。包含 command / args / env / detected status / supported capabilities。
- `model_configs` 是模型配置：provider / model / baseURL / API key ref / 参数。仅 `runtime.kind = "native"` 时 binding 必需 model_config（其他 runtime 自带 model 配置）。
- `agent_bindings` 把三者绑在一起：role_id + runtime_id + (model_config_id?)；可选 override permission profile。

**理由**：

- AionUi 已经在产品形态上验证了 Assistant（Role）与 Agent（Runtime）拆分（参考 `src/renderer/pages/settings/{AssistantSettings,AgentSettings}/`）；
- multica issue 模型也是 assignee 与具体 agent_id 解耦（参考 `server/internal/handler/issue.go`），AgentHub Task 的 assignee_role_id 走同样思路；
- 不拆，V1.1+ 任何"换 model 不换 prompt"/"同 role 在不同 room 用不同 runtime"都要改数据模型。

**备选**：V1.0 不拆，V1.1 再拆 — 否决（每条新写路径都基于错模型多写一遍，迁移成本越来越大）。

**总线契约**：4 张表的 CRUD 全部产生 durable event（visibility=detail，详见各 capability spec）；**Settings UI V1.0 不通过 projector 消费这些事件**，仅通过 REST 初始化与写后刷新；事件用于 Debug Panel / audit；实时多 tab 同步留 V1.x。

### V10-D2：Native Agent Runtime 用 Vercel AI SDK，**显式 provider 实例化**，禁止 implicit global

**决定**：

- **AI SDK 版本锁定**：Vercel AI SDK **5.x**（`ai@^5`、各 provider package 同 major）。开工前 spike 验证 `streamText` / tool calling / cost 字段 / AbortController cancel 在 5.x 的稳定性；如发现 breaking issue 再降 4.x，但**不允许混用**。
- **provider 实例化模式**（参考 OpenCode 三处核心文件）：
  - `packages/opencode/src/provider/provider.ts`：`BUNDLED_PROVIDERS` 静态注册 + 动态 `import("@ai-sdk/openai")` factory + `sdk.languageModel(modelId)` 显式拿模型实例（line 88 / 91 / 99-108 / 146）；
  - `packages/opencode/src/session/llm.ts`：`streamText` 接收已解析的 `language` model 实例（line 5 / 325），**不**接受字符串 modelId；
  - `packages/llm/src/providers/openai-compatible-profile.ts`：DeepSeek / OpenRouter / Groq / Cerebras / DeepInfra 等 baseURL profile（line 10）。

```ts
// packages/native-agent-runtime/src/provider-registry.ts

import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
// 显式 import gateway 仅在用户主动启用时使用：
// import { createGateway } from "@ai-sdk/gateway"
// import { createVercel } from "@ai-sdk/vercel"

export function resolveProvider(modelConfig: ModelConfig, apiKey: string) {
  switch (modelConfig.provider) {
    case "openai":
      return createOpenAI({ apiKey, baseURL: modelConfig.base_url })
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: modelConfig.base_url })
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL: modelConfig.base_url })
    case "openai-compatible":
      // baseURL 必填；DeepSeek / OpenRouter / Groq / DeepInfra / Cerebras / Ollama
      // 等都走这条（参考 OpenCode openai-compatible-profile.ts:10 的 profile 列表）
      return createOpenAICompatible({ name: modelConfig.name, apiKey, baseURL: modelConfig.base_url! })
    case "vercel-gateway":
      // 仅在 V1.x 显式启用；V1.0 开关默认关闭，开启时 UI 提示"会经过 Vercel 网关"
      throw new Error("vercel-gateway provider is V1.x explicit opt-in")
    default:
      throw new Error(`provider ${modelConfig.provider} not supported`)
  }
}

// 每次 streamText 调用都从 provider().chatModel(modelId) 显式构造：
const provider = resolveProvider(modelConfig, apiKey)
const result = await streamText({ model: provider.chatModel(modelConfig.model), prompt, tools, abortSignal })
```

- **绝对禁止的写法**（CI 强制）：
  - **禁止** `streamText({ model: "openai/gpt-4o", ... })` 字符串模型 ID（AI SDK 5 默认会走 implicit global provider 即 Vercel AI Gateway，绕过 AgentHub ModelConfig / keychain / Permission / audit 路径，违反 D32 + D9 红线）；
  - **禁止** 调用 `import { generateText } from "ai"` 不指定 provider（即裸用 default model registry）；
  - **必须** 通过 `provider(modelConfig).chatModel(modelConfig.model)` 显式拿模型实例后再调 `streamText`；
  - **可选** Vercel AI Gateway 作为 V1.x 显式 provider 选项（用户主动启用，不是默认）；V1.0 不实现 vercel-gateway provider。
- **CI 检查**：新增 `ai-sdk-provider:check` script，扫 `packages/native-agent-runtime/**` + 任何 import `streamText` / `generateText` / `streamObject` 的位置，检测：① 不允许字符串 model ID；② 必须有显式 `createOpenAI` / `createAnthropic` 等 factory 调用；③ 任何 `import "@ai-sdk/gateway"` 必须在用户配置 `vercel-gateway` 启用时才加载（动态 import）。
- **能力边界**：对齐 AionUi built-in agent 的产品形态（参考 `src/process/agent/aionrs/`）：
  - ✅ streaming chat（`streamText`）
  - ✅ tool calling（接 AgentHub Room MCP tools + Task tools + 文件读写 + shell；MCP tool definition 转 AI SDK tool）
  - ✅ cost / token usage 上报到 RunLifecycle（用 AI SDK `usage` 字段 + adapter cost 映射）
  - ✅ cancel（AbortController + AbortSignal 给 streamText；走 RunLifecycle.cancelFinalized 标准路径）
  - ❌ 不做 repo indexer
  - ❌ 不做 patch planner
  - ❌ 不做 web search（V1.x 视需求加 tool）
  - ❌ 不做 image generation
  - ❌ 不做 browser automation
  - ❌ 不做长期 memory（V1.2 由 memory-gateway 注入）
- **接口实现**：实现 `AgentRuntimeAdapter`（不绕过 adapter-framework）。NativeAgentAdapter 是第三种真实 adapter，注册到 AdapterRegistry；manifest 声明 `runtimeKind: "native"`、`reliability.level: "structured"`、`crashRecovery: "restartable"`（无 daemon 子进程，不需 attach）。
- **工具协议**：复用 AgentHub 现有 Room MCP 工具集（V0 + V0.5 已实现），通过 Vercel AI SDK 的 `tools` 参数把 MCP tool definition 转 AI SDK tool（thin adapter，不改 MCP 协议）。

**理由**：

- AionUi 自己写了 aionrs（Rust 子项目）做 built-in agent 这条路在 TypeScript 单一栈下不必要重走；
- Vercel AI SDK 已经把 OpenAI / Anthropic / Google / OpenAI-compatible 全部统一了 streaming + tool calling 协议；
- 但 **AI SDK 5 的 implicit global provider 默认指向 Vercel AI Gateway**（参考 [Vercel AI SDK 5 release blog](https://vercel.com/blog/ai-sdk-5)），这条路径会让用户密钥 / 模型选择脱离 AgentHub ModelConfig / Permission / keychain / audit 边界，违反 D32 红线；
- OpenCode 的处理方式（`packages/opencode/src/provider/provider.ts`：`BUNDLED_PROVIDERS` + `sdk.languageModel(modelId)` 动态加载；`packages/opencode/src/session/llm.ts`：`streamText` 收已解析 language；`packages/llm/src/providers/openai-compatible-profile.ts:10`：baseURL profile）就是显式 provider registry：每个 provider 是一个具体的 factory + baseURL，DeepSeek / OpenRouter / Groq / Cerebras / DeepInfra 等都通过 OpenAI-compatible profile 规范化处理。AgentHub V1.0 沿用这个模式。

**Native Runtime SHALL follow the OpenCode-style explicit provider registry pattern**（spec 强制语句）：

> ModelConfig.provider / model / baseURL / apiKeyRef resolves to a concrete AI SDK provider instance before `streamText` is called. Native Runtime MUST NOT pass plain string model IDs to `streamText` / `generateText`. Native Runtime MAY support `@ai-sdk/gateway` and `@ai-sdk/vercel` as **explicit gateway providers**（V1.x opt-in），但 V1.0 不实现，且任何 gateway 启用必须在 Settings UI 显式开关 + audit log。

**备选**：

- LangChain.js — 拒绝（包大、抽象太多）；
- 直接调 OpenAI/Anthropic SDK 自己拼 provider 切换 — 拒绝（重写 Vercel AI SDK 已经做的事）；
- Vercel AI SDK + 显式 provider registry（OpenCode 模式）是当前 TS 生态的最佳实践。

**总线契约**：NativeAgentAdapter 通过 AdapterBridge 发 `tool.call.requested` / `tool.call.completed` / `message.part.delta` / `agent.run.*`（与 ClaudeCodeAdapter / OpenCodeACPAdapter 一致）。前端 Run Detail Tools tab 不需为 Native 写新代码——通过 visibility 路由自动收到。

### V10-D3：Settings UI 复刻 AionUi 模式（六页一级架构）

**决定**：Settings 入口在 TopBar 右上角 + Cmd+K 命令面板"Open Settings"；Modal-style 弹窗（不切路由，避免破坏当前 Room 的 SSE 订阅）。六个一级 tab：

| Tab | AionUi 对照路径 | V1.0 实现 |
|---|---|---|
| **Roles**（角色） | `pages/settings/AssistantSettings/{AssistantListPanel,AssistantEditDrawer,SkillConfirmModals}.tsx` | 角色列表 / 新建 / 编辑提示词 / 头像 / 描述 / 标签 / 默认能力 / 默认权限 profile / **AI 生成草稿入口** / 删除（需确认） |
| **Runtimes**（运行时） | `pages/settings/AgentSettings/{LocalAgents,InlineAgentEditor,AgentCard}.tsx` | Claude Code 检测 / OpenCode 检测 / Native AgentHub Engine（始终可用）/ Custom ACP（高级用户）；每行显示 detect status + command/args/env 编辑 + test connection 按钮 |
| **Models**（模型配置） | `pages/settings/components/AddModelModal.tsx` + `SettingsModal/contents/{GeminiModalContent,ModelModalContent}.tsx` | provider 列表（OpenAI / Anthropic / Google / OpenAI-compatible / Ollama / LM Studio）；有 API key 的 provider 配 key（写 keychain）+ baseURL（仅 OpenAI-compatible / Ollama）+ 可用模型列表 + test model call 按钮；**Ollama 等本地 provider 无 API key，UI 隐藏 key 输入框，`api_key_ref=NULL`** |
| **Permissions**（权限） | （V0.5 已有 PermissionProfile spec） | 内置三档（builder-strict / builder-loose / read-only）+ 用户自定义 profile + 文件 / shell / tool 规则 |
| **Workspace**（工作区） | （AgentHub 自有） | workspace root / worktree mode / artifact storage / attachment limits / GC 配置 |
| **MCP / Tools** | `pages/settings/components/AddMcpServerModal.tsx`（仅参考交互） | V1.0 仅展示已启用 Room tools（只读）+ "外部 MCP server 管理（V1.1）"占位入口 |

**关键交互**：

- Settings UI **REST-only**（详见 V10-D-VIEW）：打开 modal 时 `GET /roles` / `/runtimes` / `/model-configs` / `/agent-bindings` 一次性拉全量；写操作（POST/PATCH/DELETE）成功后用 response body 或重新 `GET` 刷新本地 view model；**V1.0 不做** SSE 增量同步 / 跨 tab 实时同步；用户在 tab A 改了 model config，tab B 必须手动刷新 modal 才能看到；
- Modal 关闭时释放本地 view state / abort in-flight REST request；**不维护 SSE subscription**（Settings 不订阅 SSE）；
- Test connection / Test model call 走 `POST /runtimes/:id/test` / `POST /model-configs/:id/test`；结果通过 **REST response 或 job polling** 返回（不依赖事件流）：耗时 < 5s 的 test 同步返回 200/4xx；耗时较长（如 LLM test call）返回 `{ jobId }` + UI polling `GET /settings/jobs/:jobId`；**test 操作结果不进入 EventBus**（不发 `runtime.test.result` / `model_config.test.result` 事件）；Debug 需要看 test 结果时查看 job record 或 daemon 日志；
- API key 输入框：UI 不展示已存 key 值（keychain 拿不到展示），仅展示 fingerprint（前 4 + 后 4）+ "重置"按钮。

**总线契约**：Settings 写操作仍 emit durable events（visibility=detail，用于 Debug Panel / audit / 后台追踪（Run Detail 不通过 Settings CRUD SSE 实时同步；如需展示某次 Run 使用的 role/model/runtime，应展示 Run 创建时 snapshot 或通过 REST 查询引用对象））；**Settings UI 不订阅这些事件，不做 projector handler，不承诺 multi-tab 实时同步**；V1.0 不存在 settings 私有 view；Test 操作结果通过 REST response / job polling 返回，不靠事件流。

### V10-D4：AI 生成角色草稿，强制用户审查（草稿不入 durable event log）

**决定**：

```
Settings UI Roles 页 → "+ New Role" → 选择 "Generate with AI"
  ↓
弹"输入需求"对话框：
  - description: "帮我生成一个擅长前端重构的 reviewer"
  - target_work?: "code-review"
  - preferred_tone?: "concise" | "detailed" | "encouraging"
  - capabilities? (multi-select)
  - using model: <选已配置的 model_config>
  ↓
POST /roles/generate
  daemon 同步返回 { jobId }（202 Accepted）
  daemon 在后台用选中的 ModelConfig 跑 Native Runtime 生成 RoleDraft
  daemon 把进度写入 role_drafts 临时表（status='streaming' → 'completed' / 'failed'，draft_json 增量更新）
  ↓
UI 收到 jobId 后 polling: GET /roles/generate/jobs/:jobId 每 500ms 拉一次 → 取 status + draft_json
  生成中：UI 显示进度（如 token count / 已生成的 prompt 片段）
  完成：UI 渲染 RoleDraft preview（diff-style 展示 prompt / capabilities / suggested permission profile）
  失败：UI 显示错误 + 引导用户手写
  ↓
用户可改 → 保存（POST /roles 创建真 role 行）→ 发 durable `role.created { roleId, source: "ai_generated", generationJobId }`
或 取消 → 调 DELETE /roles/generate/jobs/:jobId 让 daemon 清掉 role_drafts 行；不留任何痕迹
```

- **必须用户确认**：生成后的 RoleDraft **不直接** insert roles 表，UI 必须展示 preview，用户改完点 "Save" 才落库。**绝对禁止** auto-save。
- **草稿不进 durable event log**（关键修订，回应 review P1）：
  - role 生成走 **REST polling**（不发 SSE 事件），UI 每 500ms 调 `GET /roles/generate/jobs/:jobId` 拿 status + 增量 draft；
  - 完整 draft 仅存 daemon 内存 + `role_drafts` 临时表（V1.0 TTL 7 天 + 保存/取消时立即删）；**不进 events 表，不进 outbox**；
  - 用户保存时才发 durable `role.created`，事件 payload 仅含 `roleId / source / generationJobId?`，**不**含原始 prompt 或生成时输入的描述；
  - 这避免"用户输入的 prompt 永久留在 events 表"的隐私风险（review P1 指出的真实问题）。
- **生成失败容错**：模型调用失败 → daemon 把 role_drafts 行 `status='failed' + failure_reason='...'`，下一次 polling 时 UI 拿到 failed → 显示错误 + 引导用户手写；role_drafts 行立即删除。
- **预设 prompt 模板**：V1.0 提供 4 种 preset："项目经理（Project Manager）" / "Reviewer" / "Builder" / "Archivist"，外加"空白自定义（Generalist）"入口。preset 是配置数据（`role_presets.json`），不是 4 套代码路径。

**`role_drafts` 临时表结构**：

```sql
CREATE TABLE role_drafts (
  job_id           TEXT PRIMARY KEY,
  description      TEXT NOT NULL,             -- 用户原始输入
  target_work      TEXT,
  preferred_tone   TEXT,
  capabilities     TEXT,                       -- JSON
  using_model_id   TEXT NOT NULL,
  draft_json       TEXT,                       -- 完整 RoleDraft（生成中是部分内容）
  status           TEXT NOT NULL CHECK (status IN ('pending', 'streaming', 'completed', 'failed', 'cancelled')),
  failure_reason   TEXT,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL              -- created_at + 7 天
);
CREATE INDEX idx_role_drafts_expires ON role_drafts (expires_at);
```

GC：daemon 启动时清过期；后台每小时清一次；用户保存或取消时立即清对应行。

**理由**：

- multica 的 issue 创建也强制用户确认（参考 `cmd_issue.go`），AI 自动写入会污染产品语义；
- 角色 prompt 影响所有后续 Run，必须可审查（这是 V0 D32 红线"诚实大于一致"的延伸）；
- AionUi 的 InlineAgentEditor.tsx 提供 "JSON 高级编辑" 路径，这种 "generate then edit" 模式是好范本；
- **草稿不进 durable event log** 是 review P1 直接命中：用户输入的 prompt 是潜在敏感数据（可能含项目信息、商业机密、个人偏好），不该留在事件审计流中；用临时表 + TTL + 手动删除的"可恢复但可清除"模式是产品标准做法。

**总线契约**：role 生成**不走** SSE / EventBus；走 REST job polling 模型（`POST /roles/generate` → `jobId`，UI 每 500ms `GET /roles/generate/jobs/:jobId` 拿状态 + 增量 draft，`DELETE /roles/generate/jobs/:jobId` 取消并清除草稿）。仅在用户保存时才发 durable `role.created { roleId, source, generationJobId? }`（事件不含原始 prompt）。**`role.generation.*` 事件类型在 V1.0 不存在**——避免给 events 表 / outbox / SSE 增加无消费者的事件类型。

### V10-D5：Team Mode = Squad Mode + Task 状态机驱动（Squad **也创建轻量 Task**）

**决定**（修订自原方案，回应 review P0：Squad 必须有非聊天载体）：

- **Squad 与 Team 都创建 Task**，Task 是协作的非聊天权威载体（**修正原方案"Squad 不创建 Task"**）。两者差异只在"是否需要 review 流"：
  - **Squad Mode**：Leader 调 `room.delegate { expectsReview: false }` → 创建 Task `status='pending'`；teammate 完成时 Task 直接 `pending → in_progress → completed`（**跳过** `review`）；Leader 通过 mailbox + `task.delegation.completed` durable 事件 wake；适合"轻量路由"场景，不需要 Leader 二次审阅。
  - **Team Mode**：Leader 调 `room.delegate { expectsReview: true }`（V1.0 新增字段，默认值由 room.mode 决定）→ 创建 Task `status='pending'`；teammate 完成 → `task.status.changed { nextStatus: "review" }`；Orchestrator terminal hook 在所有 sibling Task 都进 review 时 wake Leader（reason='task_review'）→ Leader approve 后 `review → completed`；适合"任务化派发"场景，Leader 必须二次审阅。

**两 mode 共享机制**：

- 同一 dispatch 引擎（在 `squad-mode` capability 包出底，`team-mode` capability 仅在 `expectsReview` 处理上加差异层）；
- 同一 Task 表 + activity timeline + delegation_chain；
- 同一 RunQueue 锁矩阵 + activeWakes guard + mailbox carry；
- 同一防循环规则（嵌套深度 5、5 分钟重复 title 拒绝、30 分钟超时 → blocked）。

**Squad Mode Leader 时间线**：

```
t=0   user 消息进 squad room
t=1   Leader Run 1 启动（reason='primary_turn'）
t=2   Leader 在 Run 1 内调 room.delegate × 2（expectsReview: false） → 创建 2 个 Task pending + dispatch 2 个 teammate Run
t=3   Leader Run 1 终结（complete）— Leader 不再活跃
t=4-5 2 个 teammate Run 并行
t=6   teammate1 Run 完成 → Task 直接 pending → in_progress → completed（无 review 流）→ emit task.delegation.completed { taskId } → mailbox 给 Leader
t=7   Leader 收到 mailbox.message.created → wake Leader Run 2（reason='mailbox_received'）
t=8   Leader Run 2 收到所有 teammate 完成的 mailbox 摘要 → 汇总回复用户
```

**Team Mode Leader 时间线**（参考 multica `issue_child_done.go` 的子任务完成判定）：

```
t=0   user 消息进 team room
t=1   Leader Run 1 启动（reason='primary_turn'）
t=2   Leader 在 Run 1 内调 room.delegate × 3（expectsReview: true） → 创建 3 个 Task（assignee_role_id=teammate-role）
t=3   Leader Run 1 终结（complete）— Leader 不再活跃
t=4-6 3 个 teammate Run 并行 / 串行（受 RunQueue 锁矩阵 + role→binding resolve 后的 agent 锁约束）
t=7   teammate1 Run 完成 → emit agent.run.completed → emit task.status.changed { nextStatus: "review" }
t=8   Orchestrator terminal hook：检查该 parent task 的 sibling task 状态——只有部分进 review，**不** wake Leader
t=9   3 个 task 都进 review → wake Leader Run 2（reason='task_review', taskIds=[...]）
t=10  Leader 在 Run 2 内审阅 → approve（task.status='completed'）或 dispatch 重做
t=11  所有 child task completed → wake Leader Run 3（reason='task_review_done'）回复用户
```

**理由**：

- review P0 命中：Squad 不创建 Task = V0.5 多 agent 循环坑复发风险（无非聊天载体，Leader wake / 去重 / 超时 / 深度限制都没状态可依）；
- 让 Squad 也创建 Task **不增加复杂度**：Task 表早已实现（V0 §最小 Task 数据模型）；Squad 只是用它的"轻量"路径（`expectsReview=false` 跳过 review）；
- D23（observe 是被动状态 + WakeAgent 是模型调用唯一入口）保持不变——Leader 不能 polling，必须由 hook 触发新 Run；
- multica `issue_child_done.go` 已经验证"子任务完成判定 + 父级回顾"的实现路径。

**RunQueue 锁矩阵语义**（V0 已实现，V1.0 仅 spec 加多 Agent 案例）：

- 不同 agent + 同 room：可并行（agent 锁不冲突）；
- 同 file（不同 agent 都声明 targetFiles 含同文件）：后到者 markWaiting reason='locked_by_<other_run>'；
- 任一 agent 不声明 targetFiles：取 workspace 整体写锁；
- Leader system prompt 应提示"派发 Task 时让 teammate 声明 targetFiles 减少锁竞争"——产品手册级建议，不是内核强制。

**总线契约**：

- 写路径事件（durable，visibility=both）：`task.delegation.created { taskId, byRoleId, atRunId, expectsReview }` / `task.delegation.completed { taskId, byTeammateRunId }` / `task.status.changed { taskId, prevStatus, nextStatus, reason }` / `team.dispatch.started { leaderRunId, targetTaskIds }` / `team.dispatch.completed { leaderRunId, taskIds, summary }`；
- 读路径：前端 projector 增量更新 Task view model；Side Panel Tasks tab + Run Detail Tools tab 双视图同步消费。

### V10-D6：Task Workflow Core = multica Issue 模型本地化

**决定**：把 MVP `最小 Task 数据模型` 提升为 V1.0 主线工作单元。结构参考 multica `server/internal/handler/issue.go`：

```ts
type Task = {
  id: string                          // ULID
  workspace_id: string
  room_id: string                     // 必须属于 room（不允许跨 room task）
  parent_task_id?: string             // null = 顶层；嵌套深度上限 5
  delegation_chain?: string            // JSON: [{by_role_id, at_run_id, at_ts}, ...]
  title: string
  description?: string                 // markdown
  priority: number                     // 0..3 (low/normal/high/urgent)
  status: 'pending' | 'in_progress' | 'blocked' | 'review' | 'completed' | 'cancelled'
  assignee_role_id?: string            // V1.0 关键：逻辑归属（Role 维度，UI 主要展示，"派给谁"产品语义）
  assignee_binding_id?: string         // V1.0 关键：本次派发实际执行者（binding_id 由 Room 内 role→binding resolve 后写入）；同一 Role 在不同 room 可绑不同 runtime/model 时这个字段保证审计 / 重试 / cost 归属确定
  assignee_agent_id?: string           // V0.5 兼容字段，迁移脚本回填；3 个月后 V1.4 删除
  source_run_id?: string               // 创建时的 Run id
  due_at?: number                      // V1.0 不强制使用，预留
  created_by_role_id: string           // 'user' 或 leader role id
  created_at: number
  updated_at: number
}

type TaskActivity = {
  id: string
  task_id: string
  kind: 'comment' | 'run_started' | 'run_completed' | 'run_failed' | 'artifact_linked' | 'blocker_set' | 'status_change' | 'assignee_change' | 'priority_change'
  by: string                           // user_id 或 role_id
  payload: string                      // JSON
  created_at: number
}
```

**Activity timeline**：每个 Task 有完整的活动流（comment / run start/complete / artifact / blocker / status change），消费 multica `packages/views/issues/components/` 的视觉模板（不复制代码，对照交互）。

**Side Panel Tasks tab（V1.0 范围）**：

- 列表 view，按 status 分组（Backlog / In Progress / Blocked / Review / Done）；
- 不做拖拽（V1.1 加）；
- 不做 search / filter / agent grouping / dependency graph（V1.1 加）；
- 单击 Task 打开 detail slide-over（与 Run Detail 同布局）显示：title / description / assignee / parent + children tree / activity timeline。

**防循环规则**（borrowed from multica `internal/issueguard/`）：

1. parent_task_id 嵌套深度上限 5；超出 → `room.delegate` 返回 `{ error: "delegation_too_deep" }` + audit log；
2. 同 room 同 leader 在 5 分钟内重复创建相同 title + description 的 Task → 拒绝（防 prompt loop）；
3. Task 在 `pending` / `in_progress` 状态下 30 分钟无更新 → emit `task.status.changed { nextStatus: "blocked", reason: "timeout" }`；Leader 收到 wake（reason='task_blocked'）决定重新 dispatch 或取消。

**Run 与 Task 绑定**：

- runs 表 V0 已有 `task_id` 字段（V0 §19.4.1 的 schema）；
- V1.0 启用：所有 wakeReason='delegated_task' 的 Run **必须**带 task_id；
- Run 终结时 emit `task.activity.added { kind: 'run_completed', payload: { runId, cost, brief } }`，活动流自动同步。

**总线契约**：

- 写路径（V1.0 Task 事件契约，**不引入** `task.updated` / `task.deleted`）：
  - Task 创建：沿用既有 `task.created`（visibility=both）
  - Task 状态变化 / 取消 / 阻塞 / 完成：沿用既有 `task.status.changed`（visibility=both）
  - 非状态型活动（comment / run_started / run_completed / artifact / blocker / priority_change）：emit `task.activity.added`（visibility=both）
  - 派发链路：emit `task.delegation.created` / `task.delegation.completed`（visibility=both）
  - Task "删除"走 `task.status.changed { nextStatus: "cancelled" }`，不引入独立 `task.deleted` 事件
  - 事务内同步；
- 读路径：前端订阅 SSE projector 增量更新 view model（参考 multica `packages/core/issues/ws-updaters.ts` 的 query cache 增量更新模式）；
- 每个 capability spec **必须**列出该 capability 的"事件订阅图谱"——即哪些 daemon 写路径产生哪些事件，前端哪个 projector 处理。

### V10-D7：迁移策略——保留 3 个月双读窗口

**决定**：

```
0014_v10.sql 完成后:
  ┌─ 旧表保留 ─────────────────────────────────────┐
  │  agent_profiles (V0.5 形态)                    │
  │  ─ 保留 3 个月，不读不写（标 deprecated）    │
  └────────────────────────────────────────────────┘

  新表（V1.0 起所有读写都走这些）:
    roles
    runtimes
    model_configs
    agent_bindings
    rooms (加 leader_role_id 列)
    tasks (启用 assignee_role_id, priority, delegation_chain)
    task_activities (新表)
```

**migration 脚本**（`packages/db/migrations/0014_v10.sql` + 配套 TS 数据迁移 `0014_data.ts`）：

```ts
// 0014_data.ts
// 把每行 agent_profiles 拆成对应的 4 表行：
//   1. INSERT INTO roles (id=ap.id, name, avatar, prompt=ap.role_prompt, capabilities, default_perm_profile=ap.permission_profile_id)
//   2. INSERT INTO runtimes (id=`${ap.adapter_id}-default`, kind=ap.provider, ...) // 去重
//   3. INSERT INTO model_configs (id=`${ap.adapter_id}-${ap.model}`, provider, model=ap.model, ...) // 去重
//   4. INSERT INTO agent_bindings (id=ap.id+'-binding', role_id=ap.id, runtime_id, model_config_id?)
// 保持 agent_profiles 行不动（标 deprecated 注释）
// rooms 中存 agent_profile_id 的字段（room_participants）改 agent_binding_id
```

**双读容错**：daemon 启动时检查 schema version 字段（`schema_meta.version`），V1.0 起读 `agent_bindings`；如读到 V0.5 旧客户端发的 `agent_profile_id` API 请求 → middleware 自动 resolve 成 binding_id；3 个月后 V1.4 删除兼容层。

**理由**：

- AionUi 多次 schema 升级都用类似策略（参考 git history 中的 migration 模式）；
- 3 个月窗口给所有 V0.5 用户充裕的升级时间；
- 不做硬升级避免破坏正在跑的 daemon。

### V10-D8：Permissions 加 model API call 维度（per-Run 缓存 + deny-before-stream）

**决定**：MVP `PermissionResource` enum 增加 `model.api_call.<provider>` 资源 family。Native Runtime 调用模型前必须经过 Permission Engine 检查；默认所有已配置 model_config 是 `allow`，但用户可在 Permission Profile 加规则（如"frontend-builder 角色仅允许 gpt-4o-mini，不允许 claude-opus"）防止 prompt injection 让 agent 切到高 cost 模型。

**关键规则**（修订自原方案，回应 review P1）：

- **per-Run 缓存**：每个 `(runId, modelConfigId)` 元组在 Run 期间最多做**一次** permission decision；结果（allow/deny/ask 后用户答复）缓存到 Run context（in-memory）+ 同事务写 `permission.resolved` event 关联 runId；后续同 Run 的所有 streamText / generateText 调用直接读缓存，不再发 `permission.requested`；
- **deny-before-stream**：deny 决定**必须**在创建 `streamText` provider instance 之前作出；一旦 streamText 开始 token 流就算 cost 已扣，不允许"开始扣费后再 fail"；实现：NativeAgentAdapter `startRun` 内的 first-call permission check 走同步 effect（如需 ask，等待 user 答复后才开 stream）；
- **per-tool-call 不重发**：tool calling loop 中每次模型再调用（multi-step），不重发 `permission.requested.model.api_call.*`（已缓存）；只有 modelConfigId **变更**时才重发（理论上 V1.0 不允许 Run 中途切 model_config）；
- **Run 跨边界失效**：缓存仅在 Run 内有效；新 Run（包括 retry / resume）必须重新走 permission 检查；
- **Run 级 audit**：Run 终结时 emit `permission.run_summary { runId, decisions: [{resource, decision, modelConfigId}] }`（durable, visibility=detail），便于 Run Detail Permissions tab 一次性展示该 Run 的所有 model 调用授权决策。

**理由**：

- review P1 直接命中：原方案"每次模型调用前 emit permission.requested"会在 streaming + tool calling 多 step 场景下刷屏（一个 Run 可能 50+ 次模型调用），且无法保证 deny 时机在 token 流前；
- per-Run 缓存 + deny-before-stream 是 V0 Permission per-session 队列模式的延伸（V0 §19.5 已有同 sessionId 串行化），V1.0 把"session-level"扩到"run-level"语义；
- AionUi 也有类似 model 切换权限（参考其 LocalAgents.tsx 的 model 字段限制）；
- 防止 prompt injection 是 V0 红线，V1.0 引入 Native Runtime 后这条威胁面扩大（agent prompt 可能含"请用 claude-opus 重新回答"）；
- 用 PermissionResource 统一处理而非新增枚举，与 V0 D11 一致。

**总线契约**：

- 写路径事件（durable，visibility=both）：首次 `permission.requested { resource: "model.api_call.openai", details: { model: "gpt-4o", roleId, runId, modelConfigId } }`；user 答复 → `permission.resolved { decision, runId }`；
- Run 终结：`permission.run_summary { runId, decisions[] }`（durable, visibility=detail）；
- deny → Run failureClass='permission_denied'，按 V0 RunLifecycle.fail 路径走（不开 stream，不扣费，UI 显示 deny 原因 + 引导用户改 Permission Profile）。

### V10-D9：单机本地不引入 OAuth / 远程 API key 服务

**决定**：API key 全部由用户在 Settings UI 手填，写本地 OS Keychain（V0 KeychainBridge）。**不**支持 OAuth flow / 远程 API key 服务（如 OpenRouter SSO 登录）。用户用 OAuth 流程的 provider 必须先在 provider 自己的网站拿 API key 再填进来。

**理由**：

- D32 红线："永不做云端 / 多用户认证"，OAuth 涉及 redirect URL / 后端 token store，离开单机本地形态；
- 简化产品（少一个出错点）；
- 如果用户必须用 OAuth provider，可走 OpenAI-compatible baseURL 兜底（如 OpenRouter / LiteLLM 都提供 OpenAI-compatible 接口）。

### V10-D-EVT：event-system V1.0 canonical event registry delta（强制 Modified）

**决定**（回应 review P0：event-system 不能 Untouched）：

V1.0 新增的所有事件类型 SHALL 先注册到 `event-system` capability 的 canonical registry（主 spec `openspec/specs/event-system/spec.md` 的 `事件分级` Requirement），再被其他 V1.0 capability 引用。完整候选清单：

| 事件类型 | category | durability | visibility | 来源 capability |
|---|---|---|---|---|
| `role.created` | role | durable | detail | role-system |
| `role.updated` | role | durable | detail | role-system |
| `role.deleted` | role | durable | detail | role-system |
| `runtime.detected` | runtime | durable | detail | runtime-settings |
| `runtime.updated` | runtime | durable | detail | runtime-settings |
| `runtime.removed` | runtime | durable | detail | runtime-settings |
| `model_config.created` | model | durable | detail | model-provider-settings |
| `model_config.updated` | model | durable | detail | model-provider-settings |
| `model_config.deleted` | model | durable | detail | model-provider-settings |
| `agent_binding.created` | binding | durable | detail | agents（MODIFIED） |
| `agent_binding.updated` | binding | durable | detail | agents |
| `agent_binding.removed` | binding | durable | detail | agents |
| `task.activity.added` | task | durable | both | task-workflow-core |
| `task.delegation.created` | task | durable | both | team-mode + squad-mode |
| `task.delegation.completed` | task | durable | both | squad-mode（无 review）+ team-mode（review approved 后）|
| `team.dispatch.started` | team | durable | both | team-mode + squad-mode |
| `team.dispatch.completed` | team | durable | both | team-mode + squad-mode |
| `permission.run_summary` | permission | durable | detail | permissions（V1.0 D8）|

**强制流程**：

1. `event-system/spec.md` 在 V1.0 spec 起步前**先**写完 delta（在 9 个 capability spec 之前）；
2. `packages/protocol/src/events/registry.ts` **同步** 注册（含 schema + visibility）；
3. 其他 capability spec 引用事件类型时 CI `events:check` 校验已注册；未注册的引用 → spec apply 阶段直接 fail；

**理由**：V0.5 archive 时已暴露此问题（mailbox.delivery.failed 漏注册），V1.0 引入 18 个新事件类型（role generation 走 REST polling 不发事件；task.updated/task.deleted 不引入，状态变化走 task.status.changed，评论/artifact/run 记录走 task.activity.added），必须前置统一注册。

### V10-D-VIEW：Settings UI **REST-only**，V1.0 不做 SSE 增量同步

**决定**（修订自原方案，回应 review P0 Settings SSE 自相矛盾）：

- Settings UI **不**新增 SSE view 类型；保留现有 `main / detail / raw` 三档；
- Settings UI **不订阅** SSE；**仅**通过 REST API 工作：
  - 打开 modal → `GET /roles` / `GET /runtimes` / `GET /model-configs` / `GET /agent-bindings` 一次性拉全量；
  - 写操作（POST/PATCH/DELETE）成功后 → 用 HTTP response body 或重新 `GET` 刷新本地 view model；
  - 关闭 modal → 释放 view state，下次重新拉。
- Settings 事件（`role.* / runtime.* / model_config.* / agent_binding.*`）仍 emit 到 events 表（visibility=detail，便于 Debug Panel / audit / 后台追踪（Run Detail 不通过 Settings CRUD SSE 实时同步；如需展示某次 Run 使用的 role/model/runtime，应展示 Run 创建时 snapshot 或通过 REST 查询引用对象）），但 **Settings UI 不消费** 这些事件；
- **V1.0 明确不做**多 tab 实时同步：用户在 tab A 改了 model config，tab B 必须手动刷新 modal 才能看到（或关闭重开 modal）。

**多 tab 不一致的可接受性**：

- Settings 是低频操作（用户每天改 config 次数 << 聊天次数）；
- 不一致期最多到 modal 关闭 / 刷新前；
- 不存在跨 tab 协作场景（单机本地，单用户）；
- 多 tab 实时同步是 V1.x 视需要再上的能力（届时把相关事件 visibility 改 `both` + 新增 settings projector）。

**实施细节**：

```
[Tab A]                       [Daemon]                       [Tab B]
打开 Settings modal
  → GET /roles                 → 返回列表
显示
                                                              打开 Settings modal
                                                                → GET /roles
                                                                → 返回列表（同 A）
编辑 Role X 的 prompt
  → PATCH /roles/X             → 更新 SQLite + emit role.updated（detail）
  → 收到 200 + 新 role          (events 表 + outbox + Debug Panel 可见)
更新本地 view model
                                                              UI 仍显示旧 prompt（Tab B 不订阅）
                                                              （用户刷新或重开 modal 才看到）
```

**理由**：

- 原方案"detail fallback main / 复用 main 流"的描述自相矛盾（main projector 不收 detail 事件），spec agent 实施时会卡住；
- REST-only 是最简单且 V1.0 范围内确定可工作的方案；
- 如果未来用户反馈强烈需要多 tab 实时同步，V1.x 把相关事件 visibility 改 `both` + 新增 main projector 处理（届时单独 change，不在 V1.0 范围）；
- review P0 直接命中：把"复用 main 流增量"这条删除，回避方向性歧义。

**总线契约**：

- Settings 事件仍发（durable, visibility=detail），用于 Debug Panel / audit / 后台追踪；
- Settings UI **不订阅** events，**不**有 projector handler；
- 写路径仍同事务 emit 事件（保持 V0 D22 总线契约不变）。

## Risks / Trade-offs

- **R1（数据模型迁移破坏 V0.5 用户房间）** → migration 脚本 + 3 个月双读窗口（V10-D7）；CI 集成测试覆盖"V0.5 daemon 数据 → 启动 V1.0 → 老房间能正常读写"。
- **R2（Native Runtime 通过 Vercel AI SDK 接 5 个 provider，bug surface 扩大）** → V1.0 仅声明支持的 provider list（OpenAI / Anthropic / Google / OpenAI-compatible / Ollama）；其他 provider stub 返回 `provider_not_supported`；CI 加 provider matrix 集成测试（用 mock server 模拟每个 provider）。
- **R3（Settings UI 与 Room SSE 流冲突）** → V1.0 Settings REST-only，不订阅 SSE，不新增 view 类型；缺点是多 tab 不实时同步，可接受（低频操作面板，单机单用户）。
- **R4（AI 生成角色草稿被 prompt injection 操纵）** → 用户必须确认才保存（V10-D4）；生成 prompt 走"系统 prompt 限制 + 用户输入隔离 in `<external_content>`"（V0.5 §16.5 已有 wrapExternalContent helper）。
- **R5（Team Mode 子 Task 永不完成 → Leader 永不被 wake）** → 30 分钟超时机制（V10-D6 防循环规则 #3）。
- **R6（room.delegate 被滥用形成派发链路深嵌套）** → parent_task_id 嵌套深度上限 5（V10-D6 防循环规则 #1）。
- **R7（多 Agent 锁等待死锁）** → V0 RunQueue 已有 lock_timeout（5 分钟）+ 字典序申请避免传统死锁；CI 加 Squad/Team 多 Agent 锁矩阵集成测试。
- **R8（Migration 3 个月双读窗口给开发负担）** → 兼容层只在 daemon middleware 一处（API request → resolve binding_id），代码量 < 100 行；3 个月后 V1.4 删除。
- **R9（AionUi 代码移植引入 license 风险）** → AionUi 是 Apache-2.0，复刻代码时保留 license notice；multica 是 modified Apache，**仅借模式不复制代码**（V10 design 已明确）。
- **R10（V1.0 范围太大 12-16 周做不完）** → M1 spike：先把 V10-D1 数据模型 + V10-D7 migration 跑通（前 2 周），M2 接 Native Runtime（4 周），M3 Settings UI（3 周），M4 Team/Squad/Task Workflow（5 周），M5 收尾验收（2 周）。每条 task 在 `tasks.md` 中明确归属 milestone 与 spec ref。

## Migration Plan

V1.0 是 V0.5 archived 之上的增量。schema 变更集中在 `0014_v10.sql`：

```sql
-- 0014_v10.sql

-- 1. 新表
CREATE TABLE roles (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT,                         -- NULL = 用户级
  name            TEXT NOT NULL,
  description     TEXT,
  avatar          TEXT,
  version         TEXT,
  prompt          TEXT NOT NULL,
  capabilities    TEXT NOT NULL,                -- JSON
  default_perm_profile TEXT,
  tags            TEXT,                         -- JSON
  source_path     TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE runtimes (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('claude-code','opencode','native','custom-acp')),
  name            TEXT NOT NULL,
  command         TEXT,
  args            TEXT,                          -- JSON
  env             TEXT,                          -- JSON
  detected_at     INTEGER,
  detected_path   TEXT,
  detected_version TEXT,
  supported_caps  TEXT NOT NULL,                  -- JSON
  manifest_json   TEXT NOT NULL,                  -- 完整 AdapterManifest
  workspace_id    TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE model_configs (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT,
  name            TEXT NOT NULL,
  provider        TEXT NOT NULL CHECK (provider IN ('openai','anthropic','google','openai-compatible','ollama')),
  model           TEXT NOT NULL,
  base_url        TEXT,
  api_key_ref     TEXT,                           -- keychain ref，不存明文；NULL = 本地 provider（如 Ollama）无 API key
  api_key_fingerprint TEXT,                       -- 前 4 + 后 4 显示用；NULL = 本地 provider
  temperature     REAL,
  max_tokens      INTEGER,
  reasoning       TEXT,                            -- JSON for o1/o3 series
  extra           TEXT,                            -- JSON
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE agent_bindings (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT,
  role_id         TEXT NOT NULL REFERENCES roles(id),
  runtime_id      TEXT NOT NULL REFERENCES runtimes(id),
  model_config_id TEXT REFERENCES model_configs(id),    -- 仅 runtime.kind='native' 必需
  override_perm_profile TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_agent_bindings_role ON agent_bindings (role_id);
CREATE INDEX idx_agent_bindings_runtime ON agent_bindings (runtime_id);

-- 2. tasks 新增字段（V1.0 全部 ADD COLUMN；基线 tasks 表没有这些列）
-- workspaceId 选方案 B：不加列，通过 room_id → rooms.workspace_id 派生（view 字段）
ALTER TABLE tasks ADD COLUMN assignee_role_id TEXT REFERENCES roles(id);
ALTER TABLE tasks ADD COLUMN assignee_binding_id TEXT REFERENCES agent_bindings(id);
ALTER TABLE tasks ADD COLUMN assignee_agent_id TEXT;     -- V0.5 兼容字段，3 个月后 V1.4 删除
ALTER TABLE tasks ADD COLUMN delegation_chain TEXT NOT NULL DEFAULT '[]';  -- JSON
ALTER TABLE tasks ADD COLUMN expects_review INTEGER NOT NULL DEFAULT 0;    -- 0=Squad, 1=Team
-- 数据迁移层把 assignee_agent_id 反查 binding → role_id / binding_id 写入

-- 3. task_activities 新表
CREATE TABLE task_activities (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  kind            TEXT NOT NULL,
  by_kind         TEXT NOT NULL CHECK (by_kind IN ('user','role','system')),
  by              TEXT NOT NULL,
  payload         TEXT,                                  -- JSON
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_task_activities_task_created ON task_activities (task_id, created_at DESC);

-- 4. rooms 加 leader_role_id
ALTER TABLE rooms ADD COLUMN leader_role_id TEXT;       -- 仅 mode IN ('squad','team') 时必填（应用层校验）

-- 5. room_participants 改 agent_binding_id
ALTER TABLE room_participants ADD COLUMN agent_binding_id TEXT;
-- 数据迁移层把现有 agent_id 通过 agent_profiles → binding 反查写入
-- 旧字段保留 3 个月作为读取兼容
```

```ts
// 0014_data.ts (post-schema migration)
// 1. 扫描 agent_profiles 全表
// 2. 对每行：
//    a. INSERT INTO roles (id=ap.id, name, prompt=ap.role_prompt, ...)
//    b. UPSERT INTO runtimes (id=ap.adapter_id, kind=ap.provider, ...)
//    c. UPSERT INTO model_configs (id=`${ap.adapter_id}-${ap.model}`, ...)
//    d. INSERT INTO agent_bindings (role_id, runtime_id, model_config_id?)
// 3. 扫描 room_participants：把 agent_id（指向 ap.id）改成对应 agent_binding_id
// 4. 扫描 tasks：把 assignee_agent_id 反查 → assignee_role_id
// 5. 标记 schema_meta.version = '1.0'
```

**回滚策略**（修订自原方案，回应 review P1）：

- **V1.0 升级前自动备份 SQLite**：`agenthub upgrade --to=1.0` 命令在 migration 前 copy 整个 `~/.agenthub/agenthub.db` → `~/.agenthub/backup-pre-v1.0-<timestamp>.db`（含 WAL + SHM 文件）；备份失败 → 拒绝升级；
- **紧急回滚通过恢复备份**：用户跑 `agenthub rollback --to=0.5` → 校验当前 daemon stopped → 恢复备份文件 → daemon 重启进 V0.5；
- **运行期兼容层**只承诺 daemon middleware 一处（API request `agent_profile_id` → resolve 成 `agent_binding_id`），代码量 < 100 行；3 个月后 V1.4 删除；
- **不再承诺**"删除 V1.0 新表 + revert schema_meta.version 即可继续在 V0.5 daemon 写"——V0.5 daemon 不理解新数据结构（如 `room_participants.agent_binding_id` / `tasks.assignee_role_id` / `task_activities` 表），强行运行会破坏新数据；
- **运维守则**：升级公告强调"V1.0 升级是单向操作，回滚必须经备份恢复，会丢失升级后产生的新数据"。

## Open Questions

| ID | 主题 | 推荐 | 备选 |
|---|---|---|---|
| V10-1 | Vercel AI SDK 版本 | **锁定 5.x**（V10-D2 已采纳；spec 写完后做 1 周 spike 验证 streamText/tools/cancel/cost 字段；如发现 5.x breaking issue 再降 4.x） | 4.x（更稳但功能受限） |
| V10-2 | OpenAI-compatible 默认 baseURL | 不预设，用户填 | 预设 OpenRouter / NewAPI 几个常用 |
| V10-3 | Native Runtime cancel 实现 | 走 AbortController 给 streamText | 用 AI SDK middleware |
| V10-4 | role-generator 默认 prompt 模板 | 提供"项目经理 / Reviewer / Builder / Archivist" 4 种 | 仅 1 种 / 用户自写 |
| V10-5 | Settings UI 是 Modal 还是单独路由 | **已采纳 Modal**（不破坏当前 Room SSE；V1.x 可补 URL deep link `?settings=models`） | 单独路由（书签友好，推 V1.x） |
| V10-6 | Task 嵌套深度上限 | 5 | 10 / 不限 |
| V10-7 | Task 超时阈值 | 30 分钟 | 60 分钟 / 用户配置 |
| V10-8 | Migration 双读窗口 | 3 个月（回应 review P1 收紧） | 6 个月 / 12 个月（已否决：兼容层维护成本不值） |
| V10-9 | AI 角色草稿保存方式 | **已采纳 `role_drafts` 7 天 TTL + REST polling**（D4 已落实；纯内存 / 事件流已否决） | 纯内存（无持久化）/ 事件流推送（已否决：隐私风险）|
| V10-10 | Role / AgentBinding 是否 workspace 级隔离 | 是（roles.workspace_id NULL=全局，否则隔离） | 全部全局 |
| V10-11 | Native Runtime 工具集是否含 web search | V1.0 不做（V1.x 加） | V1.0 加 brave/serper 工具 |
| V10-12 | parent_task_id 不存在时的 task 是否允许 | 允许（顶层 task） | 必须有 parent |

**V10-1 已采纳**：AI SDK 5.x。**V10-5 已采纳**：Modal。**V10-9 已采纳**：role_drafts 7 天 TTL + REST polling。V10-2 / V10-3 / V10-4 是 capability spec 起步前必须做的 1 周 spike 调研项（不是实现期再决）。V10-6 – V10-8 / V10-10 – V10-12 可在实现期定。

## Reference Implementation Pointers（spec 写细节时必读）

每个 V1.0 capability spec 都 SHALL 在 Goals 之前列出"参考来源"段，至少包含：

```markdown
> **参考来源**：
> - **AionUi**（Apache-2.0，可代码级复刻）：
>   - 路径 1：<具体路径>，借鉴的是 <边界 / 数据流 / 运行模型>
>   - 路径 2：...
> - **multica**（modified Apache，仅借模式不复制代码）：
>   - 路径 1：<具体路径>，借鉴的是 <模式>
>   - 路径 2：...
> - **总线契约**：
>   - 写路径：<HTTP/Command> → <SQL 写表> → emit <事件类型 list>（visibility=...）
>   - 读路径（三选一，按 capability 实际模式填写）：
>     - **SSE/projector 路径**（visibility=main/both 事件）：前端 projector 订阅 <事件类型 list>，更新 <view model 字段>
>     - **REST-only 路径**（Settings CRUD / 低频配置类）：UI 通过 `GET <endpoint>` 初始化/刷新，不订阅 SSE，不要求 projector handler；事件仅用于 audit/debug
>     - **polling 路径**（role generation / test connection 等异步 job）：UI 通过 `GET <job endpoint>` 轮询状态，不进入 EventBus，不 emit 事件
>   - 失败路径：
>     - 事件型失败：emit <错误事件 list>（visibility=...）+ UI fallback
>     - REST/polling 型失败：HTTP error / job error 返回，不 emit EventBus 事件
```

这一格式在每个 V1.0 capability spec 顶部强制出现；coding agent 实现时把"参考来源"中的代码当成对照而不是想象。

## Capability 之间的依赖图

```
              ┌─────────────────────────────────────────────┐
              │          V0.5 主 specs (17 caps)            │
              │   bus-runtime / event-system / orchestrator │
              │   adapter-framework / messaging / web-ui    │
              │   permissions / cost-panel-local / ...      │
              └────────────────┬────────────────────────────┘
                               │
                  ┌────────────┴────────────┐
                  │                         │
       ┌──────────▼──────────┐    ┌─────────▼─────────────┐
       │   role-system        │    │  runtime-settings    │
       │   (Persona only)     │    │  (Backend only)      │
       └──────────┬───────────┘    └─────────┬────────────┘
                  │                          │
                  │     ┌─────────────────┐  │
                  └─────► agent-bindings ◄──┘
                        │  (绑 R+RT+MC)  │
                        └────────┬───────┘
                                 │
       ┌─────────────────────────┼──────────────────────┐
       │                         │                      │
┌──────▼─────┐         ┌─────────▼────────┐    ┌────────▼──────┐
│ model-     │         │ native-agent-    │    │ team-mode +   │
│ provider-  │         │ runtime          │    │ squad-mode +  │
│ settings   │         │ (Vercel AI SDK)  │    │ task-workflow │
└──────┬─────┘         └─────────┬────────┘    │ -core         │
       │                         │             └────────┬──────┘
       └────────┐                │                      │
                ▼                ▼                      ▼
           ┌─────────────────────────────┐    ┌─────────────────┐
           │      role-generator         │    │   settings-ui   │
           │      (consumes Native)      │    │  (consumes all) │
           └─────────────────────────────┘    └─────────────────┘
```

实施顺序：role-system / runtime-settings / model-provider-settings → agent-bindings → native-agent-runtime → role-generator → team-mode / squad-mode / task-workflow-core → settings-ui（前端贯穿后期）。

## M-阶段交付建议（不属于 spec，仅作实施计划参考）

- **M1 数据地基**（前 2 周）：role-system + runtime-settings + model-provider-settings 数据模型 + migration + 老 agent_profile 兼容层。
- **M2 Native Runtime**（4 周）：NativeAgentAdapter + Vercel AI SDK 集成 + tool calling + cost / cancel + agent-bindings 解析。
- **M3 Settings UI**（3 周）：六页一级 Settings + role-generator + test connection / test model。
- **M4 Team / Squad / Task Workflow**（5 周）：room.delegate + Task 调度 + activity timeline + Side Panel Tasks tab + 防循环规则。
- **M5 收尾验收**（2 周）：全套测试 + strict + E2E + Migration 兼容性测试 + tasks 勾选 + V1.1 plan 准备。

> 关键纪律：M1 之前所有 V0.5 兼容代码必须保留双读路径；M2 之前 Native Runtime 不接入 Team/Squad（先在 Solo / Assisted 验证）；M4 之前 Task 调度只支持单层（不支持嵌套）。

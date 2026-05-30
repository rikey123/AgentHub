# native-agent-runtime Specification

## Purpose
TBD - created by archiving change add-v10-orchestration. Update Purpose after archive.
## Requirements
### Requirement: NativeAgentAdapter 实现

The system SHALL implement `NativeAgentAdapter` as a third real adapter (alongside ClaudeCodeAdapter and OpenCodeACPAdapter), using Vercel AI SDK with **explicit provider instantiation**. NativeAgentAdapter SHALL implement `AgentRuntimeAdapter` interface without bypassing adapter-framework.

**能力边界**（对齐 AionUi built-in agent，不对齐 Claude Code）：

- ✅ streaming chat（`streamText`）
- ✅ tool calling（接 AgentHub Room MCP tools + Task tools + 文件读写 + shell，全部经 Permission Engine）
- ✅ cost / token usage 上报到 RunLifecycle（用 AI SDK `usage` 字段）
- ✅ cancel（AbortController + AbortSignal 给 streamText；走 RunLifecycle.cancelFinalized 标准路径）
- ❌ 不做 repo indexer / patch planner / web search / image generation / browser automation / 长期 memory

**manifest**：

```ts
const nativeAgentManifest: AgentAdapterManifest = {
  id: "native",
  runtimeKind: "native",
  capabilities: {
    canStreamTokens: true,
    canEmitToolEvents: true,
    canEmitPermissionEvents: true,
    canEmitSubagentEvents: false,      // V1.0 不做 subagent
    canInjectAtStart: true,
    canInjectNextTurn: true,
    canInjectRuntime: true,
    canCancel: true,
    supportsMcp: true,
    supportsHooks: false,              // 无 CLI hooks
    supportsWorkspaceIsolation: true
  },
  reliability: {
    level: "structured",
    eventSource: "native_event_stream",
    crashRecovery: "restartable",      // 无子进程，不需 attach
    parseFailure: "skip_event"
  },
  context: {
    startupInjection: true,
    runtimeInjection: true,
    injectionMode: "immediate"
  },
  workspace: { mode: "shadow_buffer" }
}
```

**显式 provider 实例化**（禁止字符串 model ID）：

```ts
// packages/native-agent-runtime/src/provider-registry.ts
// 参考 OpenCode packages/opencode/src/provider/provider.ts:91

import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

export function resolveProvider(modelConfig: ModelConfig, apiKey: string | undefined) {
  switch (modelConfig.provider) {
    case "openai":
      return createOpenAI({ apiKey, baseURL: modelConfig.baseUrl })
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: modelConfig.baseUrl })
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL: modelConfig.baseUrl })
    case "openai-compatible":
      // DeepSeek / OpenRouter / Groq / Cerebras / DeepInfra 等（不含 Ollama，Ollama 有独立 case）
      return createOpenAICompatible({ name: modelConfig.name, apiKey, baseURL: modelConfig.baseUrl! })
    case "ollama":
      // 本地 Ollama，无 API key；baseUrl 默认 http://localhost:11434/v1
      return createOpenAICompatible({
        name: "ollama",
        apiKey: "ollama",                  // Ollama 接受任意非空字符串
        baseURL: modelConfig.baseUrl ?? "http://localhost:11434/v1"
      })
    default:
      throw new Error(`provider ${modelConfig.provider} not supported in V1.0`)
  }
}

// 每次 streamText 调用都显式构造 provider + model 实例：
// 参考 OpenCode packages/opencode/src/session/llm.ts:325
const provider = resolveProvider(modelConfig, apiKey)
const result = await streamText({
  model: provider.chatModel(modelConfig.model),  // 显式 model 实例，不传字符串
  messages,
  tools,
  abortSignal
})
```

**CI 强制检查**（新增 `ai-sdk-provider:check` script）：

- 扫 `packages/native-agent-runtime/**` 中所有 `streamText` / `generateText` / `streamObject` 调用；
- 禁止字符串 model ID（如 `streamText({ model: "openai/gpt-4o" })`）；
- 必须有显式 `createOpenAI` / `createAnthropic` 等 factory 调用；
- 任何 `import "@ai-sdk/gateway"` 必须在用户配置 `vercel-gateway` 启用时才加载（动态 import）。

#### Scenario: NativeAgentAdapter 跑一个 Solo Run

- **WHEN** 用户在 Solo Room 发消息，primary agent 绑定 native runtime + gpt-4o model config
- **THEN** NativeAgentAdapter 从 ModelConfig 解析 provider + apiKey（从 keychain 取）+ model
- **AND** 调 `streamText({ model: provider.chatModel("gpt-4o"), messages, tools, abortSignal })`
- **AND** streaming tokens 通过 AdapterBridge emit `message.part.delta`（ephemeral, visibility=detail）
- **AND** Run 终结时 emit `agent.run.completed { cost: { inputTokens, outputTokens, costUsd } }`（durable, visibility=both）

#### Scenario: 禁止字符串 model ID

- **WHEN** 开发者写 `streamText({ model: "openai/gpt-4o", ... })`
- **THEN** `pnpm ai-sdk-provider:check` 失败，报 `plain string model ID detected; use resolveProvider(modelConfig).chatModel(model) instead`

#### Scenario: tool calling 经 Permission Engine

- **WHEN** Native Runtime 调用 `file.write` tool 写 `src/foo.ts`
- **THEN** Permission Engine 检查 `file.write` 资源 → ask → 用户 allow
- **AND** 写入通过 ArtifactFS（shadow_buffer 模式）
- **AND** Run 终结时 buildRunArtifact 生成 DiffArtifact

#### Scenario: cancel 走标准路径

- **WHEN** 用户在 Run 跑期间触发 CancelRun
- **THEN** AbortController.abort() 取消 streamText
- **AND** RunLifecycle.cancelFinalized(null, runId, briefText) 发 `agent.run.cancelled`（durable, visibility=both）

### Requirement: model.api_call 权限检查（per-Run 缓存）

The system SHALL check `model.api_call.<provider>` permission before creating the first `streamText` call in a Run. The decision SHALL be cached for the Run duration to avoid repeated prompts.

- **per-Run 缓存**：每个 `(runId, modelConfigId)` 最多做一次 permission decision；结果缓存到 Run context（in-memory）；
- **deny-before-stream**：deny 决定必须在 `streamText` 创建之前作出；不允许"开始扣费后再 fail"；
- **Run 终结时**：emit `permission.run_summary { runId, decisions: [{resource, decision, modelConfigId}] }`（durable, visibility=detail）。

#### Scenario: 首次调用检查权限

- **WHEN** NativeAgentAdapter 在 Run 内第一次调用 streamText
- **THEN** Permission Engine 检查 `model.api_call.openai`（resource）
- **AND** 默认 allow（已配置的 model_config 默认 allow）→ 缓存结果 → 开始 stream
- **AND** 同 Run 后续调用直接读缓存，不再发 `permission.requested`

#### Scenario: deny 在 stream 前生效

- **WHEN** Permission Profile 配置 `model.api_call.anthropic = deny`，Native Runtime 尝试调用 claude-sonnet
- **THEN** Permission Engine 在 `streamText` 创建前返回 deny
- **AND** RunLifecycle.fail(null, runId, "model_api_call_denied", "permission_denied")
- **AND** **不**开始 stream，**不**扣费


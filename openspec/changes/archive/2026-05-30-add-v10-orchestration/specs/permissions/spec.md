# permissions (V1.0 delta)

## MODIFIED Requirements

### Requirement: 审批粒度（项目内 / 项目外 / 敏感）

The system SHALL add `model.api_call.<provider>` resource family for V1.0 Native Runtime permission control.

新增资源 family（V1.0）：

| 资源 | 默认决策 | 描述 |
|---|---|---|
| `model.api_call.openai` | allow | Native Runtime 调用 OpenAI provider |
| `model.api_call.anthropic` | allow | Native Runtime 调用 Anthropic provider |
| `model.api_call.google` | allow | Native Runtime 调用 Google provider |
| `model.api_call.openai-compatible` | allow | Native Runtime 调用 OpenAI-compatible provider |
| `model.api_call.ollama` | allow | Native Runtime 调用 Ollama（本地，无 API key；permission check 仍走 allow 路径，不读 keychain）|

**per-Run 缓存语义**：

- 每个 `(runId, modelConfigId)` 最多做一次 permission decision；结果缓存到 Run context（in-memory）；
- deny 决定必须在 `streamText` 创建之前作出（deny-before-stream）；
- Run 终结时 emit `permission.run_summary { runId, decisions: [{resource, decision, modelConfigId}] }`（durable, visibility=detail）。

#### Scenario: 默认 allow 不弹卡

- **WHEN** Native Runtime 首次调用 OpenAI provider，Permission Profile 无 `model.api_call.openai` 规则
- **THEN** 默认 allow；缓存结果；不发 `permission.requested`；直接开始 stream

#### Scenario: deny 在 stream 前生效

- **WHEN** Permission Profile 配置 `model.api_call.anthropic = deny`，Native Runtime 尝试调用 claude-sonnet
- **THEN** Permission Engine 在 `streamText` 创建前返回 deny
- **AND** RunLifecycle.fail(null, runId, "model_api_call_denied", "permission_denied")
- **AND** **不**开始 stream，**不**扣费

#### Scenario: 同 Run 同 model_config 不重复检查

- **WHEN** Native Runtime 在同一 Run 内第二次调用同一 model_config（如 multi-step tool calling）
- **THEN** 直接读缓存（allow），不再发 `permission.requested`

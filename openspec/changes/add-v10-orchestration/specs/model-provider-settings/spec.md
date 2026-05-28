# model-provider-settings (V1.0 delta)

> **参考来源**：
> - **AionUi**（Apache-2.0，可代码级复刻）：
>   - `src/renderer/components/settings/SettingsModal/contents/{GeminiModalContent,ModelModalContent}.tsx`：provider 配置 + API key 输入 + model 列表 + test call 的 UI 模式。
>   - `src/renderer/pages/settings/components/AddModelModal.tsx`：新增 model 的弹窗交互。
> - **OpenCode**（参考模式）：
>   - `packages/opencode/src/provider/provider.ts:91`：`BUNDLED_PROVIDERS` 静态注册 + 动态 factory；`sdk.languageModel(modelId)` 显式拿模型实例。
>   - `packages/llm/src/providers/openai-compatible-profile.ts:10`：DeepSeek / OpenRouter / Groq / Cerebras / DeepInfra 等 baseURL profile 列表。
> - **总线契约**：
>   - 写路径：`POST/PATCH/DELETE /model-configs` → UPDATE model_configs 表 → emit `model_config.created/updated/deleted`（durable, visibility=detail）
>   - 读路径：**REST-only**；Settings UI 通过 `GET /model-configs` 初始化；test model call 通过 `POST /model-configs/:id/test` 同步或 job polling 返回；不订阅 SSE
>   - 失败路径：HTTP 4xx/5xx 返回，不 emit EventBus 事件

## ADDED Requirements

### Requirement: ModelConfig 数据模型

The system SHALL persist `ModelConfig` as an independent entity in the `model_configs` table. A ModelConfig represents a model provider configuration—provider, model id, baseURL, API key reference, and inference parameters.

```ts
type ModelProvider = "openai" | "anthropic" | "google" | "openai-compatible" | "ollama"

type ModelConfig = {
  id: string                          // ULID
  workspaceId?: string                // NULL = 用户级
  name: string                        // 用户自定义显示名（如 "GPT-4o via OpenRouter"）
  provider: ModelProvider
  model: string                       // model id（如 "gpt-4o"、"claude-sonnet-4-6"）
  baseUrl?: string                    // 仅 openai-compatible / ollama 必填
  apiKeyRef: string                   // OS Keychain 中的 key reference（不存明文）
  apiKeyFingerprint?: string          // 前 4 + 后 4 字符，用于 UI 展示
  temperature?: number
  maxTokens?: number
  reasoning?: object                  // o1/o3 系列 reasoning 参数（JSON）
  extra?: object                      // 其他 provider-specific 参数（JSON）
  createdAt: number
  updatedAt: number
}
```

```sql
CREATE TABLE model_configs (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT,
  name              TEXT NOT NULL,
  provider          TEXT NOT NULL CHECK (provider IN ('openai','anthropic','google','openai-compatible','ollama')),
  model             TEXT NOT NULL,
  base_url          TEXT,
  api_key_ref       TEXT NOT NULL,
  api_key_fingerprint TEXT,
  temperature       REAL,
  max_tokens        INTEGER,
  reasoning         TEXT,             -- JSON
  extra             TEXT,             -- JSON
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_model_configs_workspace ON model_configs (workspace_id, provider);
```

**API key 安全规则**：

- API key 通过 `POST /model-configs` 时由 daemon 写入 OS Keychain（V0 KeychainBridge）；SQLite 只存 `api_key_ref`（keychain 条目名）和 `api_key_fingerprint`（前 4 + 后 4）；
- `GET /model-configs` 返回的 payload **不含** API key 明文，只含 fingerprint；
- 用户"重置 API key"时 PATCH 传新 key，daemon 更新 keychain 条目。

**OpenAI-compatible provider 预设 profile**（参考 OpenCode `openai-compatible-profile.ts:10`）：

| profile | baseURL |
|---|---|
| deepseek | `https://api.deepseek.com/v1` |
| openrouter | `https://openrouter.ai/api/v1` |
| groq | `https://api.groq.com/openai/v1` |
| cerebras | `https://api.cerebras.ai/v1` |
| deepinfra | `https://api.deepinfra.com/v1/openai` |
| ollama（本地）| `http://localhost:11434/v1` |

用户选 profile 时自动填 baseURL；也可手填自定义 baseURL（如 LiteLLM / NewAPI / 企业网关）。

#### Scenario: 创建 OpenAI model config

- **WHEN** 用户在 Settings UI 填写 provider=openai / model=gpt-4o / API key
- **THEN** daemon 把 API key 写 OS Keychain，INSERT model_configs 行（api_key_ref + fingerprint），emit `model_config.created`（durable, visibility=detail）
- **AND** Settings UI 用 POST response 更新本地列表；UI 显示 fingerprint 而非明文 key

#### Scenario: API key 不在 GET response 里

- **WHEN** Settings UI 调 `GET /model-configs`
- **THEN** 返回列表中每行含 `api_key_fingerprint`（如 `"sk-a...z9"`），**不含** api_key 明文
- **AND** 用户无法从 Settings UI 读回 API key

### Requirement: ModelConfig CRUD + Test API

The system SHALL expose REST endpoints for ModelConfig management. Test model call result is returned via REST response or job polling—**not** via EventBus.

| Method | Path | 描述 |
|---|---|---|
| `GET` | `/model-configs?workspaceId=<id>` | 列出 model configs |
| `POST` | `/model-configs` | 创建 model config（含 API key 写 keychain）|
| `PATCH` | `/model-configs/:id` | 更新（含 API key 更新）|
| `DELETE` | `/model-configs/:id` | 删除（有 bindings 时拒绝）|
| `POST` | `/model-configs/:id/test` | 测试 provider/baseURL/API key/model → 同步 200/4xx 或 `{ jobId }` |
| `GET` | `/settings/jobs/:jobId` | 轮询 test job 状态 |

#### Scenario: test model call 成功

- **WHEN** 用户点 model config 的"Test model call"
- **THEN** daemon 用该 model config 发一个最小 prompt（如 `"Say 'ok'"` 1 token）
- **AND** 成功 → 同步返回 `{ ok: true, model, latencyMs, inputTokens, outputTokens }`
- **AND** 失败 → 返回 `{ ok: false, error: "invalid_api_key" | "model_not_found" | "rate_limited" | ... }`
- **AND** **不**发 EventBus 事件；Settings UI 直接展示结果

#### Scenario: 删除有 bindings 的 model config 被拒

- **WHEN** 用户尝试删除 model_config_id=mc_1，但 agent_bindings 表有 3 行引用 mc_1
- **THEN** 返回 409 + `{ error: "model_config_has_bindings", bindingCount: 3 }`

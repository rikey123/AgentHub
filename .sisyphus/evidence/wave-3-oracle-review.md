# Wave 3 Oracle Gate Review — add-v10-orchestration

VERDICT: REJECT

Wave 3 cannot proceed to Wave 4 yet. The required verification commands pass, and several explicit gate checks pass, but static review found blocking requirement gaps in native permission wiring, model permission cache identity, and MCP tool error behavior.

## Verification commands

| Check | Result |
|---|---|
| `pnpm.cmd test -- packages/native-agent-runtime packages/orchestrator packages/daemon` | PASS — 39 files, 305 passed, 1 skipped |
| `pnpm.cmd ai-sdk-provider:check` | PASS — 119 files scanned |
| `pnpm.cmd check:all` | PASS — provider/events/visibility/subscriptions/command/run-state checks passed |

## Specific gate checks

1. `resolveProvider` uses explicit provider instances — PASS. `packages/native-agent-runtime/src/provider-registry.ts:14-27` returns `createX(...).chatModel(modelConfig.model)` for openai, anthropic, google, openai-compatible, and ollama; no string model ID is passed to `streamText`.
2. `runManaged` checks permission before `resolveProvider` / `streamText` — PARTIAL. Direct `NativeAgentAdapter.runManaged` does this in `native-agent-adapter.ts:105-123`, but the daemon-created native adapter in `packages/daemon/src/adapters/registry.ts:196-204` does not pass `permissionEngine`, so real registry-dispatched native runs fall back to default allow.
3. `permission.run_summary` is detail-only — PASS. Registry entry is durable/detail at `packages/protocol/src/events/registry.ts:134`, and the web projector/Permissions tab consume it through detail state.
4. `cancelManagedRun` aborts stream — PASS. `native-agent-adapter.ts:152-157` aborts the active `AbortController`; unit and integration tests cover the cancelled run path.
5. Codex remains stubbed — PASS. `packages/adapters/codex/src/index.ts:21-27` still returns ACP not-implemented effects/streams, whose error carries `{ status: 501 }` via `AdapterNotImplementedError`.
6. `ai-sdk-provider:check` passes — PASS.
7. Forbidden events are absent from runtime/model-config event implementation — PASS. They are not registered or emitted; textual mentions remain only in plans/evidence/tests asserting absence.

## Blocking issues

### 1. Native registry path does not enforce `model.api_call` permissions

`AdapterRegistry.native()` constructs `NativeAgentAdapter` without `permissions: this.options.permissionEngine` (`packages/daemon/src/adapters/registry.ts:196-204`). Because `NativeAgentAdapter.checkModelPermission()` defaults to allow when `options.permissions` is absent (`packages/native-agent-runtime/src/native-agent-adapter.ts:168-175`), the tested deny-before-stream behavior is not enforced for real daemon-dispatched native runs.

Required fix: pass `permissionEngine` into `NativeAgentAdapter` from `AdapterRegistry.native()` and add an integration test that dispatches a native run through `AdapterRegistry` with a deny rule and asserts `resolveProvider` / `streamText` are not called.

### 2. Permission caching is not keyed by `(runId, modelConfigId)`

The cache key is `${run.id}:${this.options.modelConfig.provider}` (`native-agent-adapter.ts:159-180`), and the summary field named `modelConfigId` is populated with `this.options.modelConfig.model`, not the model config id. `ModelConfigRow` currently lacks an `id`, and `nativeModelConfig()` does not select one.

Required fix: include `id` in `ModelConfigRow`, select `mc.id` in `AdapterRegistry.nativeModelConfig()`, cache on `${run.id}:${modelConfig.id}`, and emit the actual model config id in `permission.run_summary`.

### 3. MCP non-fatal tool errors currently throw and double-emit completion

`convertMcpToolsToAiSdkTools()` emits `tool.call.completed` with `ok: false`, then throws; the catch block emits a second failed completion and throws again (`packages/native-agent-runtime/src/mcp-tool-converter.ts:34-43`). This contradicts the Wave 3 requirement that non-fatal tool errors return an error result without crashing the run.

Required fix: return the normalized error object as the tool result for non-fatal MCP failures, emit exactly one `tool.call.completed`, and update the unit test so failed tool execution resolves to an error result instead of rejecting.

## Non-blocking watch-outs

- The daemon registry also does not pass an API key resolved from `api_key_ref` into `NativeAgentAdapter`; this may break non-Ollama native runs unless provider SDKs fall back to environment variables. Confirm whether keychain resolution belongs in Wave 3 or the next backend wave.
- The direct native adapter tests cover deny-before-stream, but the registry test injects a stub native adapter and therefore does not exercise real permission/keychain wiring.

## Final decision

REJECT. Fix the three blocking issues above, rerun the three verification commands, and repeat this gate before starting Wave 4.

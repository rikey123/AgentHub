# Task 2.6 — Native Solo tool call integration

## Coverage
- Added `packages/native-agent-runtime/test/native-agent-adapter.integration.test.ts`.
- Scenario `completes a Solo Run with streaming, tool events, and cost` uses a real SQLite database, `EventBus`, `RunLifecycleService`, and `PermissionEngine` around mocked AI SDK/provider resolution.
- The mocked AI SDK stream emits text, executes the converted MCP `file.write` tool, then emits more text.
- Assertions verify:
  - `streamText` receives a resolved provider model object and `AbortSignal`, not a string model id.
  - live/coalesced `message.part.delta` delivery occurs after `EventBus.flushDeltas()`.
  - durable `tool.call.requested` and `tool.call.completed` events persist.
  - `agent.run.completed` persists cost `{ inputTokens: 120, outputTokens: 45, cachedTokens: 12, costUsd: 0.001035, modelId: "gpt-4o" }` and the same cost fields land on `runs`.
- Scenario `allows model.api_call permission and emits a terminal run summary` seeds an allow rule for `model.api_call.openai`, confirms the stream proceeds, and verifies `permission.run_summary` is emitted on terminal.
- Scenario `denies model.api_call permission before creating the stream` seeds a deny rule for `model.api_call.anthropic`, confirms provider resolution and `streamText` are not called, and verifies failed run + terminal permission summary.

## Verification
- `lsp_diagnostics` on `packages/native-agent-runtime/test/native-agent-adapter.integration.test.ts`: no diagnostics.
- `lsp_diagnostics` on `packages/native-agent-runtime/scripts/run-tests.mjs`: no diagnostics.
- `pnpm.cmd test -- packages/native-agent-runtime`: exit 0, 39 files passed, 305 tests passed, 1 skipped.
- `pnpm.cmd test -- packages/native-agent-runtime packages/orchestrator packages/daemon`: exit 0, 39 files passed, 305 tests passed, 1 skipped.
- `pnpm.cmd ai-sdk-provider:check`: exit 0, 119 files scanned.

## Notes
- GitNexus impact analysis was attempted for `NativeAgentAdapter` before edits, but the MCP returned `Not connected`; no production symbol behavior was changed.

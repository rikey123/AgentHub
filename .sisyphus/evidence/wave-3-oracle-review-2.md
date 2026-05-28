# Wave 3 Oracle Gate Re-Review 2 — add-v10-orchestration

VERDICT: APPROVE

## Scope reviewed
- `packages/daemon/src/adapters/registry.ts`
- `packages/native-agent-runtime/src/provider-registry.ts`
- `packages/native-agent-runtime/src/native-agent-adapter.ts`
- `packages/native-agent-runtime/src/mcp-tool-converter.ts`
- `packages/daemon/test/daemon.test.ts`
- Relevant native runtime tests and event/permission contracts

## Findings
1. Permission wiring is fixed: `createDaemon()` constructs `AdapterRegistry` with `permissionEngine`, and `AdapterRegistry.native()` forwards it as `permissions` into `NativeAgentAdapter`. The daemon test now verifies a registry-dispatched native run denies before provider resolution/stream creation.
2. Model config identity is fixed for the implemented native path: `ModelConfigRow` includes `id`, `nativeModelConfig()` selects `mc.id`, `checkModelPermission()` caches on `${run.id}:${modelConfig.id}`, and `permission.run_summary` emits `modelConfigId` from the selected config.
3. MCP tool error handling is fixed: `convertMcpToolsToAiSdkTools()` emits one `tool.call.requested`, one `tool.call.completed`, and returns structured error output for both `{ ok: false }` executor results and thrown executor errors instead of throwing through the run.

## Verification
- `pnpm.cmd test -- packages/native-agent-runtime packages/orchestrator packages/daemon` — PASS: 39 test files passed; 306 passed, 1 skipped.
- `pnpm.cmd ai-sdk-provider:check` — PASS: 119 files scanned.
- `pnpm.cmd check:all` — PASS: ai-sdk-provider, events, visibility, subscriptions, command, and run-state-machine checks passed.

## Decision
The three previously blocking issues are resolved and the requested verification is green. Wave 4 (Settings UI + Role Generator) can proceed.

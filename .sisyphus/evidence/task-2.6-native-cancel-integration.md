# Task 2.6 — Native cancel integration

## Coverage
- Added `CancelRun aborts the active native stream and finalizes cancellation` in `packages/native-agent-runtime/test/native-agent-adapter.integration.test.ts`.
- The test starts a real `NativeAgentAdapter.runManaged()` against a real SQLite database, `EventBus`, `RunLifecycleService`, and `PermissionEngine`.
- `streamText` is mocked with a long-running async stream that captures the adapter-provided `AbortSignal` and waits for abort.
- A real `CommandBus` dispatches `CancelRun` through `createCancelRunHandler`, wired to the adapter's `cancelManagedRun()`.
- Assertions verify:
  - `CancelRun` returns `{ runId, status: "cancelling" }`.
  - the AI SDK `AbortSignal` is aborted.
  - lifecycle final state is `cancelled`.
  - durable `agent.run.cancelled` is emitted.
  - a follow-up `cancelManagedRun()` call is a no-op after the active run is cleaned up, covering no leaked active run behavior.

## Verification
- `lsp_diagnostics` on `packages/native-agent-runtime/test/native-agent-adapter.integration.test.ts`: no diagnostics.
- `lsp_diagnostics` on `packages/native-agent-runtime/scripts/run-tests.mjs`: no diagnostics.
- `pnpm.cmd test -- packages/native-agent-runtime`: exit 0, 39 files passed, 305 tests passed, 1 skipped.
- `pnpm.cmd test -- packages/native-agent-runtime packages/orchestrator packages/daemon`: exit 0, 39 files passed, 305 tests passed, 1 skipped.
- `pnpm.cmd ai-sdk-provider:check`: exit 0, 119 files scanned.

## Notes
- GitNexus impact analysis was attempted before edits, but the MCP returned `Not connected`; edits were constrained to tests and native runtime test-runner inclusion.

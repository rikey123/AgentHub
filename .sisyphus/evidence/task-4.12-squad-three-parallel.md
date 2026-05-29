# Task 4.12 — Squad three-way parallel dispatch evidence

## Coverage
- Added `squad mode queues three teammate delegates without active wake conflicts` in `packages/orchestrator/test/orchestrator.test.ts`.
- The test seeds one squad leader plus three teammate roles/bindings, calls `room.delegate` for all three teammates with `Promise.all`, and verifies three distinct queued delegated runs.
- It also asserts the delegated runs are queued for three different agents, no active-wake duplicate path appended `run_next_turns`, and three `task.delegation.created` events were persisted.
- Existing tests in the same file already cover the Team review gate: `team mode wakes leader only after every sibling task is in review`, blocked sibling wake, approval completion, duplicate guard, and depth guard.
- Added `delegation lock timeout uses fake clock and fails stale waiting run after 30 minutes` to cover timeout with Vitest fake timers.

## Verification
- `lsp_diagnostics` on `packages/orchestrator/test/orchestrator.test.ts`: no diagnostics.
- `lsp_diagnostics` on `scripts/checks/events-check.mjs`: no diagnostics.
- `pnpm.cmd test -- packages/orchestrator`: 49 files passed, 365 tests passed, 1 skipped.
- `pnpm.cmd test -- packages/orchestrator packages/daemon apps/web`: 49 files passed, 365 tests passed, 1 skipped.
- `pnpm.cmd events:check`: passed, 115 registered event types and 97 referenced in source.

## Notes
- Baseline before changes was already green for the requested scope: 49 files passed, 362 tests passed, 1 skipped.
- Repo-wide `pnpm.cmd typecheck` remains blocked by pre-existing Wave 3/5 TypeScript errors in daemon/native/orchestrator production files; local modified files are diagnostic-clean and the requested package test scope exits 0.

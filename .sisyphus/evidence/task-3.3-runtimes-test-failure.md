# Task 3.3 Runtimes test failure evidence

## Implementation

- Added failure-result handling in `testRuntimeConnection()` for synchronous REST responses such as `{ ok: false, error: "binary not found" }`.
- Added terminal failed-job handling in `pollRuntimeTestJob()` for `status: "failed"`, returning `{ ok: false, error }` without any SSE/EventBus dependency.
- Delete conflicts from `DELETE /runtimes/:id` status `409` surface as `Runtime is still used by agent bindings`.

## Test coverage

- `apps/web/src/components/settings/RuntimesTab.test.ts` covers:
  - custom ACP create/update REST persistence;
  - runtime test `200` success;
  - runtime test `202` job polling success;
  - custom runtime failure result `{ ok: false, error: "binary not found" }`;
  - delete conflict `409` handling;
  - no `EventSource` usage for runtime tests.

## Verification

- `pnpm.cmd test -- apps/web`: passed, 43 files, 320 tests passed, 1 skipped.
- `lsp_diagnostics` on modified settings files: no diagnostics.

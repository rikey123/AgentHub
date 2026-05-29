# Task 3.3 Runtimes test success evidence

## Implementation

- Added `apps/web/src/components/settings/RuntimesTab.tsx`.
- Runtime cards normalize REST rows from `/runtimes`, including `kind`, `name`, status chip state, version, and `detected_path`.
- Native runtimes render as read-only expanded cards.
- Custom ACP runtimes can be created with `POST /runtimes` and updated with `PATCH /runtimes/:id`; local modal state is updated from the REST response.
- Test Connection uses REST only: `POST /runtimes/:id/test`, synchronous `200` result handling, and `202 { jobId }` polling through `GET /settings/jobs/:jobId`.

## Verification

- `lsp_diagnostics` on `RuntimesTab.tsx`, `RuntimesTab.test.ts`, and `SettingsModal.tsx`: no diagnostics.
- `pnpm.cmd test -- apps/web`: passed, 43 files, 320 tests passed, 1 skipped.
- Literal scan for `runtime\.test\.result` in `apps/web/src/components/settings`: no matches.

## Notes

- `pnpm.cmd typecheck` and `pnpm.cmd --filter @agenthub/web build` are still blocked by unrelated native-runtime/daemon TypeScript errors already outside the settings UI path, including `NativeManagedAdapter.disposeAllRuns` and AI SDK provider typing errors.

# Task 3.8 Role Generator Save Evidence

## Scenario
Generate with AI -> poll draft job every 500ms -> edit preview payload -> save as a real role -> delete draft job.

## Files covered
- `apps/web/src/components/settings/RoleGeneratorModal.tsx`
- `apps/web/src/components/settings/RoleGeneratorModal.test.ts`
- `apps/web/src/components/settings/RolesTab.tsx`
- `apps/web/src/components/settings/SettingsModal.tsx`

## Assertions
- `POST /roles/generate` sends trimmed `{ description, modelConfigId }` and receives `jobId`.
- `GET /roles/generate/jobs/:jobId` is polled with a 500ms interval until `completed`.
- Completed draft preview normalizes `name`, `description`, `prompt`, `capabilities`, and suggested permission profile.
- Save sends `POST /roles` with edited draft data plus `generationJobId`.
- Save calls `DELETE /roles/generate/jobs/:jobId` after role creation so the draft row is removed.
- No `EventSource` / SSE subscription is used.

## Verification
- `lsp_diagnostics` on modified settings files: no diagnostics.
- `pnpm.cmd test -- apps/web`: 45 test files passed; 330 tests passed; 1 skipped.
- `pnpm.cmd --filter @agenthub/web build`: settings-local TypeScript errors fixed; build remains blocked by pre-existing non-settings daemon/native-runtime errors (`NativeManagedAdapter.disposeAllRuns`, native runtime permission/provider typings).

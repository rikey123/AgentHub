# Task 3.8 Role Generator Cancel Evidence

## Scenario
Generate with AI -> receive draft job id -> cancel/close modal -> delete draft job without creating a role.

## Files covered
- `apps/web/src/components/settings/RoleGeneratorModal.tsx`
- `apps/web/src/components/settings/RoleGeneratorModal.test.ts`
- `apps/web/src/components/settings/RolesTab.tsx`

## Assertions
- Cancel path calls `DELETE /roles/generate/jobs/:jobId`.
- Cancel path never calls `POST /roles`, so no real role is created.
- Modal close uses the same cleanup path as Cancel.
- Polling is aborted before cleanup on close/cancel.
- Failure/expired normalization supports the UI's `Try Again` and `Write Manually` actions.

## Verification
- `lsp_diagnostics` on modified settings files: no diagnostics.
- `pnpm.cmd test -- apps/web`: 45 test files passed; 330 tests passed; 1 skipped.
- GitNexus impact analysis was attempted for `RolesTab` and `SettingsModal`, but the MCP returned `Not connected`; scope was kept to settings UI wiring and helper tests.

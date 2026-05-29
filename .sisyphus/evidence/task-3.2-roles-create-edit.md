# Task 3.2 Roles create/edit evidence

## Implementation
- Added `apps/web/src/components/settings/RolesTab.tsx`.
- Wired `SettingsModal.tsx` so the Roles tab renders `RolesTab` after `/roles` bootstrap data loads.
- Role create uses `POST /roles` and updates modal-local state from the returned role object.
- Role edit uses `PATCH /roles/:id`, updates modal-local state from the response, and displays the builtin warning for `is_builtin=true` roles.
- Role list normalizes daemon snake_case responses, parses capabilities, and sorts roles by name.

## Test evidence
- Added `apps/web/src/components/settings/RolesTab.test.ts`.
- Covered create role mocked `POST /roles` payload and returned local-state upsert.
- Covered edit prompt mocked `PATCH /roles/:id` and builtin warning text.

## Verification
- `lsp_diagnostics` on `RolesTab.tsx`, `RolesTab.test.ts`, and `SettingsModal.tsx`: no diagnostics.
- `pnpm.cmd test -- apps/web`: passed, 44 test files, 323 passed, 1 skipped.
- `pnpm.cmd --filter @agenthub/web build`: RolesTab type issue fixed; command remains blocked by pre-existing daemon/native-runtime TypeScript errors outside settings UI.

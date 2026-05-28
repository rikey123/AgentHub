# Task 3.2 Roles delete-bound evidence

## Implementation
- Delete action opens a HeroUI confirmation modal before calling `DELETE /roles/:id`.
- Builtin roles render the builtin chip and have delete disabled in the UI.
- `deleteRole()` maps daemon conflict responses `409 { error: "role_has_bindings", bindingCount }` to a user-facing message and does not remove the role locally.
- Successful delete removes the role from modal-local state from the REST result path only; no SSE subscription is used.

## Test evidence
- `RolesTab.test.ts` covers a bound role delete returning `409 role_has_bindings` with `bindingCount: 2`.
- The test asserts the user-facing 409 message and keeps the original local role list intact.

## Verification
- `lsp_diagnostics` on modified files: no diagnostics.
- `pnpm.cmd test -- apps/web`: passed, 44 test files, 323 passed, 1 skipped.
- No changes made to `apps/web/src/hooks/useProjector.ts`.

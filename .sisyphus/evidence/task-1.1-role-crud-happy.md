# Task 1.1 — Role CRUD happy path

- Command: `pnpm.cmd --filter @agenthub/daemon test`
- Result: `Test Files  1 passed (1)` / `Tests  38 passed (38)`

Verified:
- `GET /roles` returns workspace-scoped role rows.
- `POST /roles` creates a role and emits `role.created` in the same transaction.
- `GET /roles/:id` returns the created role.
- `PATCH /roles/:id` updates the role and emits `role.updated` in the same transaction.
- `DELETE /roles/:id` removes the role and emits `role.deleted` in the same transaction.

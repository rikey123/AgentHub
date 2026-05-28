# task-0.1-v10-migration-empty

`pnpm.cmd test -- packages/db` passed after adding `packages/db/migrations/0014_v10.sql` and updating the DB schema/test contract.

Key verification:
- 35 test files passed
- 264 tests passed, 1 skipped
- The migration list now includes `0014_v10.sql`
- New V1.0 tables exist after applying migrations on an empty DB: `roles`, `runtimes`, `model_configs`, `agent_bindings`, `role_drafts`, `task_activities`
- `role_drafts.expires_at` index exists (`idx_role_drafts_expires_at`)
- `model_configs.api_key_ref` is nullable
- `roles.is_builtin` is present as `INTEGER NOT NULL DEFAULT 0`

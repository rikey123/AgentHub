# task-0.1-v10-migration-priority

`tasks.priority` was verified to already exist in `packages/db/migrations/0004_runs_tasks.sql` (line 13), so `0014_v10.sql` does not add it again.

Verification run:
- `pnpm.cmd test -- packages/db` passed
- The migration helper applied 14 migrations total, including `0014_v10.sql`
- The test suite asserts `tasks.priority` appears exactly once after migration

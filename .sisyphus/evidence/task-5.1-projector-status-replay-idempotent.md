# Task 5.1 Evidence — task.status.changed replay idempotency

- Updated `task.status.changed` handling to upsert by `taskId`.
- Replay of the same status event leaves one task record with the latest status.
- Covered by `apps/web/src/hooks/useProjector.test.ts`.
- Verification: `pnpm.cmd test -- apps/web` passed.

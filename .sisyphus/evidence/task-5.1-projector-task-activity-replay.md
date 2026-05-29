# Task 5.1 Evidence — task.activity replay and dedupe

- Added `task.activity.added` handling in `apps/web/src/hooks/useProjector.ts`.
- Activities append to `task.activities` and dedupe by activity id on replay.
- Covered by `apps/web/src/hooks/useProjector.test.ts`.
- Verification: `pnpm.cmd test -- apps/web` passed.

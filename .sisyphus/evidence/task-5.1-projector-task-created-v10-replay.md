# Task 5.1 Evidence — task.created V1.0 replay

- Updated `apps/web/src/hooks/useProjector.ts` so `task.created` maps V1.0 task fields directly.
- Verified `status` no longer falls back to legacy `todo`; default is `pending` when absent.
- Added coverage in `apps/web/src/hooks/useProjector.test.ts`.
- Verification: `pnpm.cmd test -- apps/web` passed.

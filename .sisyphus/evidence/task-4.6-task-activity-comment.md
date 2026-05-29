# Task 4.6 Evidence — task activity comment

- `room.update_task({ addComment })` inserts into `task_activities` and returns `task.activity.added` through `TaskService.addTaskActivity()`.
- Verified by `packages/orchestrator/test/orchestrator.test.ts` and `packages/daemon/test/daemon.test.ts`.
- Verification: `pnpm.cmd test -- packages/orchestrator packages/daemon` ✅

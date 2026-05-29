# F2 Code Quality Review - final re-run after fixes

VERDICT: APPROVE

## Scope reviewed
- `packages/orchestrator/src/task-service.ts`
  - `TaskService.complete()` now only validates the current status and delegates completion to `updateStatus({ status: "completed" })`.
  - The duplicate direct `onTaskCompleted` invocation is no longer present in `complete()`; `onTaskCompleted` is invoked once through `updateStatus()` after a successful completed transition.
- `packages/orchestrator/src/pending-turn.ts`
  - `PendingTurnService.finishConsume()` rollback path for failed `WakeAgent` now wraps the `pending_turns` update and `pending_turn.cancelled` publish in the same SQLite transaction.
  - Successful consume path also keeps the status update and `pending_turn.consumed` event in one transaction.
- Event registry check
  - `pending_turn.cancelled`, `pending_turn.scheduled`, and `pending_turn.consumed` are registered as durable main-visible events.

## Transaction boundary review
- Task status mutations in `updateStatus()`, `completeDelegatedRun()`, `transitionDelegatedTask()`, `addTaskActivity()`, and `checkTaskTimeouts()` publish their matching events inside SQLite transactions.
- Pending-turn cancel/schedule/consume/failure-rollback paths publish matching events inside SQLite transactions.
- No blocking transaction-boundary issue found in the reviewed paths.

## Verification
- `pnpm.cmd test`: PASS
  - 49 test files passed
  - 368 tests passed, 1 skipped
- `pnpm.cmd lint`: PASS
  - `eslint . --max-warnings=0` completed successfully

## Notes
- Minor non-blocking style note: `TaskService.completeDelegatedRun()` has an indentation inconsistency around the second `eventBus.publish`, but lint passes and both publishes are inside the transaction.

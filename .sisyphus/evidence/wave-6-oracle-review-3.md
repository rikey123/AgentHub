# Wave 6 Oracle Gate Re-Review 3 — add-v10-orchestration

VERDICT: APPROVE

Reviewed fixes:
- `apps/web/src/hooks/useProjector.ts` now merges existing run view models across `agent.run.*` lifecycle events, preserving `taskId` and `parentRunId` when later completion/failure/cancel payloads omit them.
- Team dispatch projection now uses `payload.leaderRunId` for `team.dispatch.started` and `team.dispatch.completed`, with fallback to `dispatchId` only when absent.
- `apps/web/src/hooks/useProjector.test.ts` now reflects actual `TaskService.createInTransaction()` task-created payload fields and covers run-field preservation plus leader-run projection.
- `packages/orchestrator/src/task-service.ts` and `packages/orchestrator/src/team-dispatch.ts` no longer show orchestrator-scoped TypeScript blockers in the reported validation.

Verification performed during re-review:
- `pnpm.cmd test -- apps/web/src/hooks/useProjector.test.ts packages/orchestrator/test/orchestrator.test.ts`: PASS — 367 passed, 1 skipped.
- `pnpm.cmd check:all`: PASS — 6 custom checks.

No Wave 6 blocking regressions found in the reviewed files. The remaining full-repo typecheck failures are accepted as pre-existing out-of-scope daemon/native-runtime debt per gate instructions.

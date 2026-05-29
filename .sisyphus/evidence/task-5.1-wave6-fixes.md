# Task 5.1 ¡ª Wave 6 Oracle fixes

Commands:
- pnpm.cmd test -- packages/orchestrator packages/daemon apps/web`r
- pnpm.cmd check:all`r

Results:
- Targeted tests passed: 49 files, 366 passed, 1 skipped.
- check:all passed (6 custom checks).
- Diagnostics passed on all modified files with no errors.

Changes:
- Added ctivityId to 	ask.activity.added.
- Added delegationId to 	ask.delegation.created and 	ask.delegation.completed.
- Added unId to 	ask.delegation.created.
- Added dispatchId to 	eam.dispatch.started and 	eam.dispatch.completed.
- Added 	askId and parentRunId to gent.run.started.
- Updated the web projector and tests to consume the new payload shapes.


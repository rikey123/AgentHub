# Wave 6 Oracle Gate Re-Review 2 — add-v10-orchestration

VERDICT: REJECT

The payload ID fixes are partially present, but the current implementation still has blocking correctness and verification gaps.

## Blocking findings

1. Run collaboration fields are not preserved across lifecycle updates.
   - `RunLifecycleService.markStarting()` emits `taskId` and `parentRunId`, but `agent.run.queued`, `agent.run.waiting_permission`, `agent.run.completed`, `agent.run.failed`, and `agent.run.cancelled` do not.
   - `useProjector.ts` replaces the entire `RunViewModel` on every `agent.run.*` event instead of merging with the existing run, so a later completion/failure/cancel event drops `taskId` and `parentRunId` from the view model.
   - The test only checks `agent.run.started`, so this regression is not covered.

2. Team dispatch projector/tests still do not consume the real emitted payload shape.
   - `team-dispatch.ts` emits `leaderRunId` in payload and sets the envelope `runId`; it does not emit `payload.runId`.
   - `useProjector.ts` reads `payload.runId` and falls back to `dispatchId`, so real `team.dispatch.started/completed` events will not project the leader run id correctly.
   - `useProjector.test.ts` uses `payload.runId`, which is not the real producer shape.

3. The updated tests are not consistently using real emitted task payload shapes.
   - `TaskService.createInTransaction()` emits `task.created` with `taskId`, `roomId`, `title`, assignment/review/source fields, and `createdBy`; it does not emit `status`, `description`, `priority`, or `delegationChain`.
   - `useProjector.test.ts` includes those extra fields in the `task.created` replay test, so it does not validate the actual producer/consumer contract.

4. TypeScript typecheck fails in reviewed files.
   - `pnpm.cmd typecheck` reports errors in `packages/orchestrator/src/task-service.ts`, `packages/orchestrator/src/mcp/room-mcp-server.ts`, and `packages/orchestrator/src/team-dispatch.ts`.
   - Examples include `taskEvent()` not accepting `task.delegation.completed`, custom error codes not assignable to `CommandErrorCode`, nullable `room_id` passed where `string` is required, and `wakeResult.data` being `unknown`.

## Verification performed

- Reviewed the specified producer, projector, and test files.
- Confirmed the new IDs are present for `task.activity.added`, `task.delegation.created`, `task.delegation.completed`, and `team.dispatch.*` producer payloads.
- Ran LSP diagnostics on the specified files: no LSP diagnostics surfaced.
- Ran `pnpm.cmd typecheck`: failed, including errors in reviewed files.
- GitNexus impact analysis could not be used because the GitNexus MCP reported `Not connected`.

## Required before approval

- Preserve or emit `taskId` and `parentRunId` for all run lifecycle updates, and add tests covering completion/failure after start.
- Update team dispatch projector logic to use `event.runId` or `payload.leaderRunId`, and update tests to use the actual emitted payload shape.
- Align projector tests with real `task.created` payloads or update the producer to emit the fields the UI must reconstruct live.
- Fix the TypeScript errors in the reviewed orchestrator files.

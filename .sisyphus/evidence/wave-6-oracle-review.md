# Wave 6 Oracle Gate Review — add-v10-orchestration

VERDICT: REJECT

## Summary

The required verification commands pass, but Wave 6 should not be approved because the frontend projector handlers for the new V1.0 events do not match the events actually emitted by the daemon/orchestrator. As a result, live replay will drop task activity, delegation, and team dispatch events, so the Tasks panel activity timeline, main timeline TaskStatusCard, and Run Detail collaboration view will not reliably populate from real SSE replay.

## Verification run

- `pnpm.cmd test -- packages/orchestrator packages/daemon apps/web` — PASS (49 files, 365 passed, 1 skipped)
- `pnpm.cmd check:all` — PASS, including `events:check`

## Requested checks

1. `task.created` handler uses V1.0 status directly and has no `todo` fallback — PASS in `apps/web/src/hooks/useProjector.ts`.
2. `task.status.changed` is idempotent by `taskId` on replay — PASS via `upsertTask` and covered by `useProjector.test.ts`.
3. All 5 new V1.0 events have projector cases — PARTIAL. Cases exist, but most require payload fields that producers do not emit.
4. `TasksPanel` groups V1.0 statuses — PASS (`pending`, `in_progress`, `blocked`, `review`, `completed`, `cancelled`).
5. `TaskStatusCard` appears for dispatch events — REJECT in real flow; unit fixtures pass, but actual `task.delegation.created` payload is ignored by the projector.
6. Run Detail Tools tab shows sibling runs for team rooms — REJECT in real flow; helper works with synthetic run metadata, but projector/runtime events do not populate the required `taskId` / `parentRunId` / delegation `runId` relationships.
7. `check:all` passes including `events:check` — PASS.

## Blocking issues

### 1. Projector handlers do not match producer payloads

- `task.activity.added`: projector requires `activityId`; `TaskService.addTaskActivity` emits `{ taskId, kind, byKind, by, payload }` without `activityId`, so live activity events are dropped.
- `task.delegation.created`: projector requires `delegationId`; `RoomMcpServer.handleDelegate` emits `{ taskId, byRoleId, atRunId, expectsReview }` without `delegationId` or delegated `runId`, so delegation cards are never created from real events.
- `task.delegation.completed`: projector requires `delegationId`; `TaskService.completeDelegatedRun` emits `{ taskId, byTeammateRunId }`, so completion updates are dropped.
- `team.dispatch.started` / `team.dispatch.completed`: projector requires `dispatchId`; `team-dispatch.ts` emits `leaderRunId`, task ids, and `sourceRunId`, but no `dispatchId`, so dispatch briefs/review cards are dropped.

### 2. Run Detail collaboration view lacks real relationship data

`ToolsTab.getRunTaskCollaborationView` expects `RunViewModel.taskId`, `parentRunId`, `parentTaskId`, and task delegation `runId` links. The run projector currently creates `RunViewModel` entries from `agent.run.*` events without those fields, and the delegate flow does not include delegated run ids in `task.delegation.created`, so the Tools tab sibling-run view only works with test fixtures, not real replayed state.

### 3. Tests miss the integration gap

The new unit tests construct idealized `RoomViewModel` fixtures or synthetic event payloads that include fields not emitted by backend producers. Add at least one projector-level test using actual emitted payload shapes for `task.activity.added`, `task.delegation.created`, `task.delegation.completed`, and `team.dispatch.started` before re-running the gate.

## Required fix before approval

Choose one contract and make producers/projector/tests agree. The smallest path is to update the emitted V1.0 payloads to include the ids the projector needs (`activityId`, stable `delegationId`, delegated `runId`, stable `dispatchId`, and run/task relationship metadata), then add replay tests that use those real payloads.

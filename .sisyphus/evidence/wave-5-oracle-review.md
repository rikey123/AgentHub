# Wave 5 Oracle Gate Review — add-v10-orchestration

VERDICT: REJECT

Wave 5 cannot be approved for Wave 6 because required verification is failing and the implementation has event-bus contract violations in delegated task paths.

## Verification run

- `pnpm.cmd test -- packages/orchestrator packages/daemon`: PASS — 45 test files passed, 351 tests passed, 1 skipped.
- `pnpm.cmd check:all`: FAIL — `events:check` reports `room.delegate` references as missing from the canonical event registry. Since `room.delegate` is an MCP tool name, the check likely needs to ignore it or narrow event literal detection, but the required gate currently fails.

## Specific checks

1. `room.delegate` leader-only: PASS. `RoomMcpServer.handleDelegate` checks `rooms.leader_role_id` against the caller binding role and non-leader tests cover no writes/events.
2. Squad completion with `expectsReview=false`: PASS for status behavior, but FAIL on atomicity because `task.delegation.completed` is published after the status transaction.
3. Team completion with `expectsReview=true`: PASS. Terminal hook moves tasks to `review` rather than `completed`.
4. Sibling gate: PASS for covered sequential behavior. It waits for all siblings to be review-ready/terminal and de-dupes via `team.dispatch.started` events.
5. Depth guard: PASS. Sixth-level delegation is rejected before task creation.
6. `task.activity.added` transactionality: FAIL. Explicit task activities insert + publish in one transaction, but delegated status transitions publish `task.activity.added` without inserting a `task_activities` row.
7. Squad/team room creation requires `leaderRoleId`: PASS. HTTP and command paths reject squad/team rooms without it.
8. Forbidden `task.updated` / `task.deleted`: PASS in source usage; only negative tests reference them.

## Blocking issues

1. Required `check:all` fails. Fix `events:check` so MCP tool literal `room.delegate` is not treated as an event type, then rerun the gate.
2. `RoomMcpServer.handleDelegate` deletes durable task events for the entire room on any delegate failure: `DELETE FROM events WHERE room_id = ? AND type IN (...)`. A duplicate/depth/wake failure after a prior successful delegation will erase replay history for unrelated tasks; remove this manual delete and rely on the SQLite transaction rollback.
3. `TaskService.completeDelegatedRun` publishes `task.delegation.completed` outside the transaction that changes task status. Move the completion event into the same atomic mutation/publish transaction.
4. `TaskService.transitionDelegatedTask` emits `task.activity.added` for delegated status changes without a matching `task_activities` insert. Either use only `task.status.changed` for status changes or insert the activity row in the same transaction.
5. Timeout guard does not actually wake the leader from the daemon timer. `checkTaskTimeouts` returns wake instructions, but `createDaemon` ignores them; dispatch `WakeAgent` for returned timeout wakes or otherwise prove the leader is woken.

## Recommendation

Fix the blocking issues above and rerun:

```powershell
pnpm.cmd test -- packages/orchestrator packages/daemon
pnpm.cmd check:all
```

Only approve Wave 5 after both commands pass and the event/state atomicity issues are corrected.

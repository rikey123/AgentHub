# Wave 5 Oracle Gate Re-Review — add-v10-orchestration

VERDICT: APPROVE

Wave 5 is approved for Wave 6. The five blocking issues from the previous review have been addressed in the reviewed files, and the reported verification commands now pass.

## Verification reviewed

- `pnpm.cmd test -- packages/orchestrator packages/daemon`: PASS — 351 tests reported.
- `pnpm.cmd check:all`: PASS — 6 custom checks reported.

## Fix review

1. `events:check` now excludes room MCP tool literals, including `room.delegate`, so MCP tool names are no longer treated as missing event types.
2. `RoomMcpServer.handleDelegate` no longer manually deletes durable task events on failure; failed delegate attempts rely on the surrounding SQLite transaction rollback.
3. `TaskService.completeDelegatedRun` publishes `task.status.changed` and `task.delegation.completed` inside the same transaction as the task status update.
4. Delegated status transitions now publish only `task.status.changed`; they no longer emit `task.activity.added` without inserting a corresponding `task_activities` row.
5. The daemon timeout sweep now dispatches internal `WakeAgent` commands for each wake returned by `checkTaskTimeouts`, so blocked timeout tasks actively notify the leader.

## Notes

- The event/state atomicity issues called out in the previous REJECT are resolved in the reviewed paths.
- No remaining Wave 5 blocker was found in the specified files.

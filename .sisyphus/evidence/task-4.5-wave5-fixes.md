Wave 5 Oracle rejection fixes

Changed:
- `scripts/checks/events-check.mjs`: ignore MCP tool names like `room.delegate` during event literal scanning.
- `packages/orchestrator/src/mcp/room-mcp-server.ts`: removed manual `DELETE FROM events` rollback cleanup from `handleDelegate`.
- `packages/orchestrator/src/task-service.ts`: moved `task.delegation.completed` into the delegated completion transaction and removed delegated `task.activity.added` emission without a matching activity row.
- `packages/daemon/src/index.ts`: dispatch `WakeAgent` for each timeout wake returned by `checkTaskTimeouts`.

Verification:
- `pnpm.cmd test -- packages/orchestrator packages/daemon` ✅
- `pnpm.cmd check:all` ✅
- LSP diagnostics on all modified files: no diagnostics ✅

Notes:
- Timeout wakes now both persist the blocked status and actively wake the leader agent.
- Delegated task completion now preserves replay history and keeps event publication atomic with the state update.

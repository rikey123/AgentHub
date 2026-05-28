# Task 4.6 Evidence — task cancel/no-delete event

- `room.update_task({ status: "cancelled" })` uses `task.status.changed` only.
- No `task.deleted` event is emitted for cancel/delete semantics.
- Verified by daemon HTTP regression coverage and orchestrator MCP coverage.

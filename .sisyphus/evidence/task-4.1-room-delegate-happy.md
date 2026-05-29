# Task 4.1 — room.delegate happy path

- Verified `room.delegate` exists on `RoomMcpServer`.
- Leader can delegate to a teammate role and receive `{ taskId, runId }`.
- Task is created with `assignee_role_id`, `assignee_binding_id`, `assignee_agent_id`, `expects_review`, and `source_run_id`.
- Delegation emits `task.created`, `task.assigned`, and `task.delegation.created`.

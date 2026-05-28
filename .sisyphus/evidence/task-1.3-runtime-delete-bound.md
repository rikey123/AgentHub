# Task 1.3 Evidence — runtime delete conflict

- Command: `pnpm.cmd test -- packages/daemon`
- Result: `35 passed (35), 272 passed | 1 skipped (273)`
- Verified `DELETE /runtimes/:id` returns `409` when matching `agent_bindings` exist.
- Verified conflict path emits no `runtime.removed` event.

# Task 0.6 Success Evidence

- `POST /rooms` accepts legacy `agentProfileId` when a migrated binding exists.
- Response includes `agentBindingId` and legacy `agentProfileId`.
- Room participant rows store `agent_binding_id`.
- `pnpm.cmd test -- packages/daemon` passed: 35 files, 268 passed, 1 skipped.

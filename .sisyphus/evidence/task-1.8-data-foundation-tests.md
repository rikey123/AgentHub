# Task 1.8 — Data foundation unit tests

## Coverage consolidated

- `packages/daemon/test/daemon.test.ts` covers Role CRUD happy path, role delete rejection with bound `agent_bindings` (`409 role_has_bindings`), runtime startup/CRUD/detect/test basics, model-config keychain/metadata behavior, and agent-binding validation/conflict paths.
- Added durable detail replay assertions for data-foundation CRUD events:
  - `role.created`, `role.updated`, `role.deleted`
  - `runtime.detected`, `runtime.updated`, `runtime.removed`
  - `model_config.created`
  - `agent_binding.created`, `agent_binding.updated`, `agent_binding.removed`
- Existing `packages/agents/test/agents.test.ts` covers builtin template first-launch write, preserving existing user files, and old-version warning behavior.
- Runtime detect/test coverage avoids provider network calls; model-config provider tests use the daemon `modelTestFetch` test seam.

## Verification

```text
pnpm.cmd test -- packages/daemon packages/db packages/orchestrator

Test Files  35 passed (35)
Tests       284 passed | 1 skipped (285)
Duration    59.83s
```

LSP diagnostics for `packages/daemon/test/daemon.test.ts`: no diagnostics found.

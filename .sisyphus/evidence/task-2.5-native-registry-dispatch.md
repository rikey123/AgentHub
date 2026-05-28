## Task 2.5 — Native registry dispatch

- `packages/daemon/src/adapters/registry.ts` now classifies `runtime.kind === "native"` / `adapter_id === "native"` to `NativeAgentAdapter`.
- `native-default` remains auto-seeded on daemon startup.
- Native runs are no longer routed to the mock/501 path.
- `pnpm.cmd test -- packages/daemon` passed: 38 files, 301 tests passed, 1 skipped.

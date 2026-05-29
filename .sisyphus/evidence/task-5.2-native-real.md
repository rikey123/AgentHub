# Task 5.2 Evidence: Native adapter is real

- `packages/daemon/src/adapters/registry.ts` documents NativeAgentAdapter as a real V1.0 runtime adapter and keeps native dispatch wired through `AdapterRegistry`.
- `packages/daemon/test/daemon.test.ts` verifies native runs dispatch through `AdapterRegistry` and that native permission-gated runs still reach the adapter constructor/run path.
- `pnpm.cmd test -- packages/daemon` passes: 49 files, 368 tests passed, 1 skipped.

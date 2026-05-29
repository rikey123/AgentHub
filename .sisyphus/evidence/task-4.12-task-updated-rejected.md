# Task 4.12 — `task.updated` rejection evidence

## Coverage
- Added `events:check task event contract > rejects forbidden task.updated literals from scanned source` in `packages/orchestrator/test/orchestrator.test.ts`.
- The test writes a temporary scanned source fixture under `packages/orchestrator/src`, runs `node scripts/checks/events-check.mjs`, and asserts the checker exits 1 with a forbidden V1.0 contract error for `task.updated`.
- Tightened `scripts/checks/events-check.mjs` with an explicit forbidden event literal set for `task.updated`, `task.deleted`, `role.generation.*`, `runtime.test.result`, and `model_config.test.result` before the existing registry checks.
- Existing runtime coverage in `packages/bus/test/event-bus.test.ts` still proves `EventBus.publish()` rejects dynamically constructed `task.updated` with `InvalidEventEnvelopeError`.

## Verification
- Negative proof is exercised by the orchestrator suite: `pnpm.cmd test -- packages/orchestrator` passes with the checker test included.
- Positive contract check still passes with no forbidden literals in committed source: `pnpm.cmd events:check` exits 0.
- Required combined test scope passes: `pnpm.cmd test -- packages/orchestrator packages/daemon apps/web` exits 0.

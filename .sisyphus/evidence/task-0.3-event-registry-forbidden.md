# Task 0.3 — Forbidden event registry evidence

Forbidden event types excluded from `packages/protocol/src/events/registry.ts`:

- `task.updated`
- `task.deleted`
- `role.generation.delta`
- `role.generation.completed`
- `role.generation.failed`
- `runtime.test.result`
- `model_config.test.result`

Regression proof:
- `packages/bus/test/event-bus.test.ts` now asserts `EventBus.publish({ type: "task.updated", ... })` throws `InvalidEventEnvelopeError`.

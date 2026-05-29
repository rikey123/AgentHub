# F2 Code Quality Review

VERDICT: REJECT

## Findings

1. Required verification failed: `pnpm.cmd test` exits non-zero. Five tests fail in `packages/native-agent-runtime/test/provider-registry.test.ts` because the mocked provider factories return values without the `languageModel()` method now required by `packages/native-agent-runtime/src/provider-registry.ts`:
   - `resolves openai to an explicit model instance`
   - `resolves anthropic to an explicit model instance`
   - `resolves google to an explicit model instance`
   - `resolves openai-compatible to an explicit model instance`
   - `resolves ollama to an explicit model instance`

2. `pnpm.cmd lint` passes with zero warnings.

3. Transaction/event boundary review found no new SQLite mutation in the implementation diff. `RunLifecycleService` status mutations continue to publish durable run events inside `withTransaction(...)`. The new `permission.run_summary` event is durable/detail and published from `NativeAgentAdapter` after lifecycle handling; because it summarizes permission decisions rather than accompanying a SQLite mutation, this is not a state-mutation/event atomicity violation in the reviewed diff.

4. State machine review: adding `permission_expired` to `RunFailureClass` and `isFailureClass()` keeps lifecycle validation consistent, and `NativeAgentAdapter.failWithPermissionDenied()` maps expired permissions deterministically to that class.

5. AI-slop/maintainability review: no `TODO`, `FIXME`, or production `as any` were found in the changed implementation areas. Tests add several `as unknown as EventBus` casts for mocks, which is acceptable for test scaffolding but should not spread into production code.

## Required fix before approval

Update `packages/native-agent-runtime/test/provider-registry.test.ts` mocks/assertions so each provider factory returns an object with `languageModel(modelId)` and the tests assert the returned explicit model instance. Then rerun `pnpm.cmd test` and `pnpm.cmd lint`.

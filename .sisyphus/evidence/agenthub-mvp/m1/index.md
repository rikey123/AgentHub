## 2026-05-23 M1.1 EventBus base

- Implemented isolated `@agenthub/bus` EventBus in `packages/bus/src/index.ts` with durable SQLite `events` persistence, ephemeral in-memory delivery, replay by durable seq cursor, registry validation, trace helpers, subscriber isolation, and 40 ms `message.part.delta` coalescing.
- Added package-local test runner `packages/bus/scripts/run-tests.mjs` and `packages/bus/test/event-bus.test.ts` covering durable publish/replay, ephemeral non-persistence, registry validation failure, trace propagation, delta coalescing, and subscriber error isolation.
- Verification passed:
  - `pnpm.cmd --filter @agenthub/bus test` — 1 file / 6 tests passed.
  - `pnpm.cmd test` — 5 files / 31 tests passed.
  - `pnpm.cmd typecheck` — passed.
  - `pnpm.cmd lint` — passed.
  - `pnpm.cmd check:all` — events, visibility, subscriptions, command, run-state-machine checks passed.
  - `pnpm.cmd schema:check` — passed with 92 event types.
  - `openspec.cmd validate add-agenthub-mvp --strict` — valid.

## 2026-05-23 M1.2 CommandBus / Outbox / Durable Handlers

- Implemented `CommandBus` in `packages/bus/src/index.ts` with canonical command validation, internal-only origin rejection, protected forbidden command rejection, SQLite-backed `command_records` idempotency, duplicate result replay, same-key/different-body rejection, deterministic failure caching, and transient failure retryability by deleting the in-flight record.
- Changed durable `EventBus.publish()` to persist `events` + `outbox` in one SQLite transaction and defer subscriber delivery until `OutboxDispatcher.drainPending()` marks rows dispatched after delivery.
- Added `DurableHandlerRegistry` with persisted `handler_cursors`, global observation cursor semantics, retry metadata, sequential catch-up, cursor progression for non-subscribed events, and `dead_letter_events` writes after five failed attempts without advancing the cursor.
- Extended `scripts/checks/command-check.mjs` with a mutating HTTP route guard for daemon route files: routes must call `commandBus.dispatch()` and must not directly `eventBus.publish()` or write DB/domain state.
- Extended `packages/bus/test/event-bus.test.ts` coverage for idempotent replay, duplicate body mismatch, deterministic/transient failure records, forbidden/unknown/internal HTTP command rejection, outbox dispatch, handler cursor progression, retry-then-success, DLQ after retry exhaustion, and guard positive/negative fixtures.

Verification:
- `pnpm.cmd --filter @agenthub/bus test` passed (1 file, 16 tests).
- `pnpm.cmd test` passed (5 files, 41 tests).
- `pnpm.cmd typecheck` passed.
- `pnpm.cmd lint` passed.
- `pnpm.cmd check:all` passed (5 custom checks; command check reports mutating HTTP guard enabled).
- `pnpm.cmd schema:check` passed (92 event types).
- `openspec.cmd validate add-agenthub-mvp --strict` passed.
- LSP diagnostics reported no diagnostics for `packages/bus/src/index.ts`, `packages/bus/test/event-bus.test.ts`, and `scripts/checks/command-check.mjs`.

Boundaries: did not implement RunLifecycleService, WakeAgent behavior, RunQueue/locks, AdapterBridge, daemon routes, SSE/OpenAPI/CLI/UI, permissions, context, artifacts, or any future M1.3+ behavior.

## 2026-05-23 M1.3 RunLifecycle / WakeAgent / RunQueue / AdapterBridge

Changed files:
- `packages/orchestrator/package.json` and `packages/orchestrator/scripts/run-tests.mjs` added exports, workspace deps, and package-local test runner.
- `packages/orchestrator/src/run-lifecycle-service.ts` implements the single run state writer and canonical `agent.run.*` event publisher.
- `packages/orchestrator/src/active-wakes.ts`, `mailbox-service.ts`, `commands.ts`, `run-queue.ts`, `recovery.ts`, `adapter-bridge.ts`, and `index.ts` implement WakeAgent, CancelRun, lock scheduling, startup recovery, ReclaimStaleClaimedRun, and AdapterBridge exports.
- `packages/orchestrator/test/orchestrator.test.ts` adds temp SQLite integration tests for lifecycle transitions, WakeAgent zero-input/idempotency/active next-turn handling, queued��claimed��starting��running��completed happy path, lock matrix conflicts, startup recovery, cancel, AdapterBridge two-step, and stale claimed/session reclaim.
- `packages/protocol/src/events/registry.ts` adds the adapter-framework-required durable `file.changed` event.
- `scripts/checks/events-check.mjs` recognizes adapter-framework's canonical `file.changed` requirement while retaining registry/spec/source validation.

Behavior evidence:
- RunLifecycleService owns create/waiting/claimed/starting/running/waiting_permission/cancelling/completed/failed/cancelled/resumed transitions. Event-emitting methods write durable events via EventBus, which persists `events` + `outbox` transactionally.
- WakeAgent handler validates internal origin, idempotency/carry source constraints, rejects zero-input wake, claims mailbox and creates queued runs through RunLifecycleService in one SQLite transaction, and appends `run_next_turns` when an active run already exists. No StartRun artifact was introduced.
- CancelRun handler calls `markCancelling` then synchronously drives `adapterManager.cancelRun(runId)`; AdapterBridge later finalizes cancellation with `cancelFinalized`.
- RunQueue owns `run_locks` writes, uses agent/room/file/workspace locks with file?workspace cross-checks, releases locks on terminal events, and fails lock-timeout waits as transient.
- StartupRecovery deletes stale locks, preserves queued/waiting runs, fails stale claimed/starting-without-session runs, finalizes cancelling, and delegates established sessions to ReclaimStaleClaimedRun.
- ReclaimStaleClaimedRun handles claimed timeout, starting-without-session, resumable attach, restartable/fail_run decisions, and starting+sessionId attach �� markRunning.
- AdapterBridge handles `session.opened` as two independent lifecycle calls: first `updateSessionState`, then `markRunning`; terminal adapter events route through lifecycle methods, while non-run adapter events publish through EventBus.

Verification:
- `pnpm.cmd --filter @agenthub/orchestrator test` �� passed (1 file, 12 tests).
- `pnpm.cmd test` �� passed (6 files, 53 tests).
- `pnpm.cmd typecheck` �� passed.
- `pnpm.cmd lint` �� passed.
- `pnpm.cmd check:all` �� passed (events, visibility, subscriptions, command, run-state-machine).
- `pnpm.cmd schema:check` �� passed (93 event types).
- `openspec.cmd validate add-agenthub-mvp --strict` �� valid.
- LSP diagnostics �� no diagnostics for `packages/orchestrator/src`, `packages/orchestrator/test/orchestrator.test.ts`, and `packages/protocol/src/events/registry.ts`.

Boundaries: did not implement daemon HTTP/SSE/OpenAPI/CLI/UI, M1.4 mock golden path, permissions, context ledger, interventions, artifacts, Claude/provider subprocess runtime, or any StartRun command.

## 2026-05-23 M1.4 daemon / SSE / SDK / CLI / MockAdapter

- Implemented local daemon shell in packages/daemon composing SQLite DB, EventBus, CommandBus, DurableHandlerRegistry/OutboxDispatcher, RunLifecycleService, RunQueue, WakeAgent handler, and MockAdapterManager.
- Added rooms/messages/agents/run-detail HTTP APIs. Mutating routes dispatch public CommandBus commands only; WakeAgent remains internal and is invoked from SendMessage handler after message persistence.
- Added /event SSE endpoint with durable replay from cursor/Last-Event-ID, live subscribe, heartbeat, and main/detail visibility filtering using EventBus replay filters.
- Added OpenAPI JSON document, SDK client methods, and CLI 'agenthub mock solo' smoke path.
- Added deterministic MockAdapter golden path: assistant message, message delta, tool events, file.changed, context snapshot, run completion, and observer passive llmCalls=0 assertion.
- Verification passed: pnpm.cmd test (10 files, 59 tests), pnpm.cmd typecheck, pnpm.cmd lint, pnpm.cmd check:all, pnpm.cmd schema:check, openspec.cmd validate add-agenthub-mvp --strict. Package-local tests passed for @agenthub/daemon, @agenthub/sdk, @agenthub/cli, @agenthub/adapter-mock.


## 2026-05-23 M1.4 protected naming retry

- Renamed adapter execution API from startRun to runAgent in RunQueue and MockAdapterManager, preserving WakeAgent as the only model-entry Command.
- Direct M1 source/test scan found no StartRun, startRun, ApplyMailboxClaimRollback, or forbidden Bun API hits in orchestrator, mock adapter, daemon, CLI, or SDK source/test trees.
- Verification passed: package-local orchestrator/daemon/mock-adapter/CLI/SDK tests, pnpm.cmd test, pnpm.cmd typecheck, pnpm.cmd lint, pnpm.cmd check:all, pnpm.cmd schema:check, and openspec.cmd validate add-agenthub-mvp --strict.


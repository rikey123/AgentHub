# PF.1 EventBus Transaction Semantics

VERDICT: PASS

## Exact durable publish code path

1. `RunLifecycleService.complete()` opens/uses a transaction via `withTransaction(tx, ...)` at `packages/orchestrator/src/run-lifecycle-service.ts:245-259`; `fail()` does the same at `:263-277`; `cancelFinalized()` does the same at `:281-287`.
2. If no transaction handle is supplied, `withTransaction()` runs `this.database.sqlite.transaction(() => fn(this.database.sqlite))()` at `packages/orchestrator/src/run-lifecycle-service.ts:325-328`.
3. Terminal methods call `publishRunEvent(...)` inside that callback (`complete`: `:258`, `fail`: `:276`, `cancelFinalized`: `:286`).
4. `publishRunEvent()` calls `this.eventBus.publish({...} satisfies PublishInput)` at `packages/orchestrator/src/run-lifecycle-service.ts:347-368`; the `db` parameter is not used for publish (`void db` at `:369`).
5. `EventBus.publish()` prepares the envelope and, for durable events, immediately calls `this.persistDurable(envelope)` at `packages/bus/src/index.ts:273-279`.
6. `persistDurable()` synchronously executes `this.options.database.sqlite.transaction(() => { ... })()` at `packages/bus/src/index.ts:422-460`.
7. Inside that transaction callback it:
   - reads the next sequence with `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events` at `packages/bus/src/index.ts:423-425`;
   - inserts the event row into `events` at `packages/bus/src/index.ts:426-449`;
   - inserts the matching pending row into `outbox` at `packages/bus/src/index.ts:450-455`.

## Same connection / active transaction determination

`EventBus` does not accept a transaction or `db` parameter on `publish()`. It writes through the `AgentHubDatabase` captured in `EventBusOptions.database` (`packages/bus/src/index.ts:51-57`, constructor storage at `:266-271`) and specifically through `this.options.database.sqlite` in `persistDurable()`.

`AgentHubDatabase.sqlite` is a single `better-sqlite3` `Database.Database` object (`packages/db/src/sqlite.ts:9-12`), created once in `createDatabase()` and returned as `{ sqlite, drizzle: drizzle(sqlite, ...) }` (`packages/db/src/sqlite.ts:29-41`). The repository transaction pattern uses `sqlite.transaction(() => { ... })()` synchronously (`packages/db/src/sqlite.ts:79-82`; `RunLifecycleService.withTransaction()` at `packages/orchestrator/src/run-lifecycle-service.ts:325-328`).

Therefore, when the caller's open `db.transaction()` is on the same `database.sqlite` object captured by the `EventBus`, durable `eventBus.publish()` writes synchronously on that same connection. The inner `EventBus.persistDurable()` transaction is a nested `better-sqlite3` transaction/savepoint on the same connection, so its `events` and `outbox` inserts remain inside the caller's outer transaction and roll back with it.

## Atomicity for §0.4

PASS for the intended `RunLifecycleService.complete/fail/cancelFinalized` path, provided the service's `database` and its `eventBus` were constructed with the same `AgentHubDatabase` instance. Under that condition, adding a second durable `eventBus.publish()` for `message.brief.published` inside the existing terminal `withTransaction()` callback will place both `agent.run.completed`/`agent.run.failed`/`agent.run.cancelled` and `message.brief.published` in one SQLite atomic transaction, including their corresponding `outbox` rows.

Caveat: this is enforced by wiring, not by the type system. `RunLifecycleService` accepts `database` and `eventBus` separately (`packages/orchestrator/src/run-lifecycle-service.ts:122-125`), and `publishRunEvent()` ignores its `db` argument, so a mismatched `EventBus` backed by a different `AgentHubDatabase` would not participate in the caller's transaction. No source change is required for §0.4 if existing construction continues to share the same database instance.

## Task 0.2 event registry note

- pnpm.cmd events:check loads openspec/specs/event-system/spec.md as the canonical table, not only the V0.5 delta spec; new registry entries must be mirrored there or the check reports registry-only event types as missing from the canonical table.
- On Windows PowerShell, use pnpm.cmd rather than pnpm when script execution policy blocks the pnpm.ps1 shim.


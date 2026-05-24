
## 2026-05-23 M0.2 tooling baseline

- Root package scripts are intentionally direct tool invocations (`eslint`, `tsc`, `vitest`) instead of Turbo fan-out because M0.1 packages are empty and have no package-local scripts yet.
- Workspace package `tsconfig.json` files extend `tsconfig.base.json` so later package work can add source without inventing local compiler settings.
- Vitest is configured with `passWithNoTests` because product code/tests do not exist yet; this should be revisited once M0.3+ adds real package code.

## 2026-05-23 M0.3 protocol skeleton

- Protocol package source uses Effect Schema imports from `effect` and TypeScript `.ts` import specifiers so Node 24 can execute no-build schema checks directly while `tsc --noEmit` remains valid via `allowImportingTsExtensions`.
- `pnpm.cmd --filter @agenthub/protocol test` runs through a package-local Node helper because Vitest's root include patterns did not discover package-local tests when invoked from the filtered workspace cwd.
- The M0.3 registry is metadata-only but already covers the event-system canonical list and can be extended by M0.5 `events:check` / `visibility:check` work.

## 2026-05-23 M0.3 protected adapter naming follow-up

- Adapter protocol input for launching provider work must avoid `StartRun*` naming because AgentHub protects `StartRun` as a nonexistent Command boundary. Use adapter-specific terminology such as `AdapterRunInput` and `runAgent` while keeping bus/runtime command concepts out of `packages/protocol` skeletons.

## 2026-05-23 M0.4 DB foundation

- `packages/db` follows the protocol package pattern with a package-local `scripts/run-tests.mjs`, because filtered Vitest invocation is more reliable when explicit test paths are passed from the repo root.
- Event visibility must live in `0003_events.sql` with the canonical event-system schema; later migrations should consume it and must not add duplicate `ALTER TABLE events ADD COLUMN visibility` logic.
- Bus runtime schema foundation is intentionally limited to tables/indexes in `0011_bus_runtime.sql`; EventBus, CommandBus, outbox dispatching, handler behavior, and RunLifecycle services remain follow-up implementation work.
- SQLite WAL pragma verification should use a file-backed temp database; `:memory:` databases report journal mode as `memory` even when the production startup code asks for WAL.
- Raw SQL migration smoke tests are not enough for DB packages that export Drizzle tables; pair them with metadata drift checks (`getTableName` / `getTableColumns` versus SQLite PRAGMA) and Drizzle runtime insert/select/delete against a migrated DB.

## 2026-05-23 M0.5 custom CI guardrails

- Root `check:all` is intentionally limited to the five OpenSpec ��20.4 custom checks; `schema:check`, dependency denylist, and Bun API guard run as adjacent CI prerequisites instead of being counted as one of the five.
- Custom checks should use Node filesystem traversal and targeted parsers because this Windows environment lacks `rg`; avoid Glob/Grep assumptions when building future guard scripts.
- The event registry check treats `event-system/spec.md` as the canonical event table and `packages/protocol/src/events/registry.ts` as the executable registry; shorthand rows such as `adapter.session.created / .session.ended / .crashed` need careful expansion.
- Skeleton-friendly checks can still be strict: validate current specs, registries, DB schema, and future implementation files only when they exist, instead of no-op placeholders.

## 2026-05-23 M1.1 EventBus base

- `packages/bus` follows the established package-local Vitest runner pattern (`scripts/run-tests.mjs`) so `pnpm.cmd --filter @agenthub/bus test` runs explicit root-relative test paths reliably.
- EventBus should derive `durability`, `visibility`, and `schemaVersion` from `@agenthub/protocol` registry metadata and reject producer overrides before either SQLite persistence or subscriber delivery.
- M1.1 intentionally keeps durable publish limited to the existing `events` table and in-process delivery; outbox dispatching, command handling, durable handler cursors, DLQ, and run lifecycle are later M1 slices.

## 2026-05-23 M1.2 bus runtime slice

- M1.2 keeps `packages/bus` as the composition point: durable `EventBus.publish()` now writes `events` and `outbox` transactionally, while `OutboxDispatcher` performs subscriber and durable handler delivery after commit.
- Command idempotency is best represented by a stable SHA-256 of sorted command JSON stored in `command_records`; deterministic failures cache `failed` results, while transient failures delete the record so the same key can retry.
- Durable handler cursors use the spec's global observation semantics: handlers advance over every durable seq, even when the event type is not subscribed, and DLQ failures intentionally leave the cursor stalled.
- `command-check.mjs` remains one of the five M0.5 checks and can enforce the new direct HTTP publish/domain-write guard without adding a sixth `check:all` entry.

## 2026-05-23 M1.3 Orchestrator run lifecycle

- Implemented `@agenthub/orchestrator` as the M1.3 composition package: RunLifecycleService owns every `runs` status mutation and all `agent.run.*` durable event writes, while WakeAgent, RunQueue, AdapterBridge, CancelRun, startup recovery, and reclaim call into that service instead of writing run state directly.
- Nested SQLite transaction risk was avoided by using the existing `better-sqlite3` transaction context as the explicit tx parameter. When WakeAgent already runs inside a transaction it passes `database.sqlite` into RunLifecycleService/MailboxService, so lifecycle create + mailbox claim + event/outbox inserts commit together without opening a nested transaction.
- RunQueue lock rows are written only by RunQueue and use the existing `(lock_type, lock_key)` primary key plus workspace cross-checks for file/workspace mutual exclusion. Agent lock is keyed by agent id, room lock by room id, file lock by `workspaceId:path`, and unknown target files degrade to workspace lock.
- AdapterBridge uses the canonical session.opened two-step: `updateSessionState(null, ...)` first, then `markRunning(null, ...)`; terminal adapter events go through `complete`, `fail`, or `cancelFinalized`.
- `file.changed` is required by adapter-framework/AdapterBridge translation, so the protocol registry and `events:check` now recognize it from the adapter-framework spec in addition to the event-system canonical table.

## 2026-05-23 M1.4 daemon shell and MockAdapter

- M1.4 can compose directly from existing M1.3 services: daemon creates SQLite DB, EventBus, CommandBus, DurableHandlerRegistry/OutboxDispatcher, RunLifecycleService, RunQueue, WakeAgent handler, and MockAdapterManager without adding a second scheduling path.
- Keep HTTP route handlers thin: mutating routes call public CommandBus commands; command handlers own DB writes/events and may internally dispatch WakeAgent with origin='internal' after message persistence.
- EventBus replay already supports view filtering, so the SSE endpoint should pass view/room/run filters for replay and apply the same visibility predicate to live events.
- MockAdapter golden path should drive AdapterBridge for run/session/tool/file/context lifecycle while writing assistant message projections deterministically for API/CLI smoke tests.


## 2026-05-23 M1.4 protected adapter execution naming

- Adapter/model execution entrypoints must avoid protected StartRun* / startRun terminology even when they are not Commands. Use protocol-aligned names such as runAgent with AdapterRunInput so WakeAgent remains the only model-entry Command boundary.


## 2026-05-23 M2.1 Permission Engine

- `packages/permissions` is now the composition point for PermissionEngine behavior; daemon owns HTTP exposure and wires mutating operations through CommandBus while the engine owns SQLite persistence and EventBus audit publication.
- The existing `0006_permissions.sql` already includes `adapter_session_id`, `idempotency_key`, and the unique pending idempotency index required by the later per-session/idempotency spec, so no new migration was needed for M2.1.
- Ask results intentionally return `requestId` + Deferred-like `promise`; the human-readable matching reason is persisted on `permission_requests.reason` and emitted in `permission.requested` payload.
- Shell pipeline evaluation should combine segment decisions by precedence (`deny` beats `ask` beats `allow`) while preserving the longest matching segment reason for diagnostics/audit.

## 2026-05-23 M2.1 Permission queue timeout retry

- In `permission_requests`, `expires_at = NULL` is the queued/unpresented marker for serialized same-session requests. Only presented requests get a normal active prompt timeout, timer, and `permission.requested` event.
- Pending idempotency duplicates should return the exact original in-flight promise, not wrap the resolver, so adapter retries cannot alter Deferred ownership or create extra waiters with different semantics.

## 2026-05-23 M2.2 Context Ledger

- `packages/context` is the ContextLedger composition point, mirroring `packages/permissions`: package-local Vitest runner, temp SQLite tests, EventBus-backed durable audit events, and daemon-owned CommandBus exposure.
- The existing `0005_context.sql` stores `confidence` as REAL, but Drizzle/schema already treated it as a real column; for M2.2 the service persists the spec confidence string in the existing column and reads it back as text without adding a migration.
- Context mutating HTTP routes should stay thin and dispatch context commands; the ledger service owns table writes and canonical `context.item.*` event publication.
- Exact optional TypeScript settings require command-derived optional fields to be normalized before object construction; omit absent fields rather than passing `undefined`.

## 2026-05-23 M2.2 Context injection boundary

- `InjectContext` is intentionally internal-only alongside `WakeAgent`, `RetryRun`, and `ConsumePendingTurn`; public HTTP/SDK surfaces must not dispatch it with `origin='http'`.
- For M2.2, injection classification remains covered through `ContextLedger.classifyInjection()` and the internal `InjectContext` handler, while public `/context/inject` is absent until a separate public-safe API is explicitly required.

## 2026-05-23 M2.3 Intervention Engine

- `packages/interventions` mirrors the accepted permissions/context composition pattern: domain service owns SQLite mutations and durable events, while daemon route handlers stay thin and dispatch CommandBus for every mutating route.
- Intervention creation persists as `requested`, emits `intervention.requested`, then immediately advances the stored row to `pending_user_decision` for MVP UI/API consumption without inventing a non-canonical pending event type.
- Presence should be recalculated from all non-closed interventions for the same room+source agent; pending/requested wins as `knocking`, approved/injected maps to `active`, and snoozed/terminal decisions fall back to `observing`.
- Debug basics do not need a new observability package dependency for M2.3; simple read-only SQL helpers in daemon satisfy `/debug/events` and `/debug/stats` while keeping SSE client count as a documented zero placeholder.

## 2026-05-23 M3.1 Artifact primitives

- @agenthub/artifacts follows the same package pattern as context/permissions/interventions: domain service owns SQLite mutations and canonical events, while daemon mutating routes dispatch CommandBus handlers.
- Artifact apply tests are easiest to keep deterministic by injecting FileOps and PermissionCheck into ArtifactService; the public daemon/API surface does not expose those hooks.
- check:all treats dotted string literals as event references, so non-event reasons should avoid event-like names such as rtifact.diff.apply; use an underscore reason like rtifact_diff_apply.
- Deployment remains a deterministic CommandBus 
ot_implemented result rather than a thrown HTTP route branch, preserving the thin-route rule.


## 2026-05-23 M3.1 artifact apply root retry

- Artifact apply must treat workspace root as server-owned state: resolve rtifact.workspaceId -> workspaces.root_path inside ArtifactService before prevalidation or writes, and ignore any caller-supplied workspaceRoot fields on ApplyDiff commands.
- Public SDK apply helpers should not type or require trusted filesystem roots; idempotency is the only public apply input needed for M3.1.
- Regression coverage dispatches ApplyDiff with an alternate root and verifies only the persisted workspace root is modified.


## 2026-05-23 M3 ArtifactFS run-level diff

- `ArtifactFS` now lives in `@agenthub/artifacts` as the adapter-boundary primitive: adapters can route file writes to `shadow_buffer` for non-terminal runs or isolated roots for terminal-capable runs, then call `buildRunArtifact()` to persist one run-level DiffArtifact through `ArtifactService`.
- Terminal-enabled runs reject `shadow_buffer` at construction, preserving the OpenSpec rule that shell redirection cannot be represented by an in-memory shadow map.
- Sensitive writes are denied before shadow/disk mutation with `ArtifactFSError(code="sensitive_file_blocked")` and a durable `permission.resolved` audit using `reason="sensitive_pattern_match"` and `requested=false`.
- Run-level diff generation compares final content to snapshot/base state, so files reverted during the run are omitted and final content wins. Missing base files are tracked as `undefined` so additions are not mislabeled as modifications.

## 2026-05-23 M3 ArtifactFS adapter-boundary integration

- `AdapterBridge` now accepts an optional `AdapterArtifactFSBoundary`; session open registers the run, `fs.writeTextFile` / `fs.deleteFile` events route to ArtifactFS, and session terminal asks the boundary to build one run-level artifact before lifecycle completion/failure.
- `ArtifactFSRunRegistry` is the artifacts-owned bridge implementation keyed by run id. It resolves workspace roots from DB, chooses `shadow_buffer` for non-terminal runs and isolated modes for terminal runs, and persists DiffArtifacts via `ArtifactService`.
- MockAdapter gained executable `write`/`delete` script steps so tests cover the adapter-boundary route instead of only standalone `ArtifactFS` unit behavior. No-write runs leave the registry empty of artifacts.

## 2026-05-23 M4 Web UI Main Timeline, Run Detail, Cards, PendingTurn

- M4 was previously blocked by repeated delegated-session timeouts with no file changes; this session completed it directly.
- `useProjector.ts` SSE client must register `addEventListener` for every event type in `EVENT_REGISTRY` because the daemon sends named events (`event: room.created`, etc.) rather than generic `message` events.
- Relying solely on SSE replay for room list population was flaky in Playwright headless tests; adding an initial HTTP `fetch('/rooms')` before opening the SSE connection makes room list population deterministic.
- `useProjector.ts` should only call `notify()` when `apply()` returns `changed === true` to avoid redundant React re-renders.
- `test-server.ts` must track active SSE `Response` objects and call `.end()` on them before `server.close()`; otherwise `daemon.close()` hangs on open keep-alive connections.
- Playwright `afterEach` hooks that call `daemon.close()` should use `Promise.race` with a timeout (e.g., 2000ms) to prevent test hangs when SSE connections are not fully closed.
- The `pending_turn` projector requires both `pending_turn.created` and the corresponding `message.created` + `message.completed` events to build a complete pending turn object with content.
- `RunsTab` in `SidePanel.tsx` should show run status badges and wire `onOpenRunDetail` so the Run Detail overlay can be opened from the side panel.
- Run Detail tabs need `data-testid` attributes for deterministic Playwright selectors; text-based selectors are ambiguous when other UI elements share the same labels.
- ESLint ignore patterns must use `**/dist/**`, `**/build/**`, `**/node_modules/**` rather than root-only `dist/**`, `build/**`, `node_modules/**` because generated nested directories like `apps/web/dist/` would otherwise be linted and produce thousands of errors.

## 2026-05-23 M5 ACP / Claude adapter

- ACP shared behavior now lives in packages/adapters/acp-base: NDJSON splitting, JSON-RPC pending table, prompt serialization, prompt-in-flight guard, cancel-vs-dispose separation, raw redaction, liveness/config/capability event helpers, and Windows .cmd CLI probing support.
- Claude Code adapter keeps provider-specific logic thin over ACP: detection/spawn args/event mapping plus managed AdapterBridge integration so structured file writes route to ArtifactFSRunRegistry, tool pre-use can consult PermissionEngine, and ttachSession is consistent with resumable manifests.
- OpenCode/Codex/LangGraph/A2A are package-local interface stubs only; detect() returns [] and run/session operations fail deterministically with not-implemented/501 semantics.


## 2026-05-23 M6 security/recovery/docs

- M6 introduced @agenthub/security as the shared security boundary for browser auth, SecretRedactor, workspace path/URI checks, and managed worktree GC safety; adapter raw logging and daemon JSON/SSE output should consume this shared package rather than local regex helpers.
- Browser auth in the plain Node daemon can reuse the existing sessions table from  010_auth.sql: /auth/session bootstraps the cookie/CSRF pair, browser GET/SSE validates cookie plus Origin/Host, and browser mutating routes add JSON + CSRF checks.
- Internal PubSub channel stats should avoid dotted event-like names (dapter_raw, message_delta) because events:check treats dotted literals as candidate event references.
- V1 memory/vector behavior remains stub-only in @agenthub/context: Noop adapters return empty results and oom.search_memory deterministically throws 	ool_not_found.

## 2026-05-23 M6 Web CSRF integration fix

- React browser clients must bootstrap /auth/session before both read and write browser flows: GET /rooms and EventSource /event need the HttpOnly session cookie just like mutating SDK calls need X-Agenthub-CSRF.
- Keep the CSRF token in module memory in pps/web/src/hooks/useSdk.ts; inject it through a web-only etchImpl so CLI/Node SDK no-Origin behavior remains unchanged.
- Playwright's web proxy must include /auth/session or browser-origin e2e cannot exercise the real daemon cookie/CSRF handshake.
- Browser-driven e2e should inspect request headers for X-Agenthub-CSRF on actual UI mutations (+ New Room, textarea Send) because Node-side seeding bypasses Origin/CSRF behavior.

## 2026-05-23 Final Verification Wave F3

- Final browser-facing QA used current E2E equivalents because `apps/web/e2e/golden-path.spec.ts` does not exist. This is non-blocking: `main-detail-projection.spec.ts` and `pending-turn.spec.ts` cover the requested flows.
- `pnpm.cmd --filter @agenthub/web build` passed, producing the production `apps/web/dist` assets consumed by `apps/web/e2e/test-server.ts`.
- `pnpm.cmd exec playwright test apps/web/e2e/main-detail-projection.spec.ts apps/web/e2e/pending-turn.spec.ts` passed all 4 browser tests.
- Confirmed real browser UI mutation coverage exists for `New Room` and textarea `Send`, with request inspection asserting `X-Agenthub-CSRF` on `/rooms` and `/rooms/{id}/messages` mutating requests.
- Evidence recorded at `.sisyphus/evidence/agenthub-mvp/final/playwright-golden/summary.md`.

## 2026-05-23 F4 raw SSE blocker fix

- Raw iew=raw durable replay intentionally remains empty for ephemeral adapter raw events; the correct F4 fix is daemon live SSE visibility, not persisting/replaying raw stdout/stderr.
- packages/daemon/src/index.ts keeps admin gating in sse() and shared edactAndTruncate(JSON.stringify(event), 64 * 1024) output, while isible(..., view='raw') allows only canonical dapter.raw.stdout / dapter.raw.stderr after room/run filters.
- Node fetch-based SSE tests need an initial comment frame (: connected) and reader-level cancellation to avoid hanging server close after asserting a live event.

## 2026-05-23 P0-2 Task API / MCP minimum chain

- The existing `0004_runs_tasks.sql` migration already creates `tasks`; no new migration was needed. P0-2 implemented against the OpenSpec MVP status enum (`pending`, `in_progress`, `blocked`, `review`, `completed`, `cancelled`) while accepting P0-2 shorthand aliases `open` -> `pending` and `done` -> `completed` at service/MCP boundaries.
- Task HTTP mutating routes follow the thin daemon rule: `POST /rooms/:id/tasks` and `POST /tasks/:id/complete` dispatch `CreateTask` / `CompleteTask` through CommandBus; `TaskService` owns SQLite writes and canonical `task.*` event publication.
- The requested package filter `@agenthub/adapters-acp-base` does not match a workspace project; the actual package is `@agenthub/adapter-acp-base`, whose filtered tests pass.

## 2026-05-23 P0-2 MCP managed startup wiring

- ACP base already persists `CreateSessionInput.mcpServer`, but real provider coverage must assert the managed adapter path too; `ClaudeCodeACPAdapter.runManaged()` is the startup path that must forward the room MCP server into `createSession()`.
- Claude adapter tests can exercise managed startup without spawning an external provider by constructing `ClaudeCodeACPAdapter({ command: "" })`, matching the existing ArtifactFS managed-run test pattern.


## 2026-05-23 P0-3 Claude adapter runtime bridge

- Daemon adapter selection now lives in packages/daemon/src/adapters/registry.ts and resolves runtime adapters from runs.adapter_id first, then agent_profiles.adapter_id; mock remains the default fallback and claude-code uses ClaudeCodeACPAdapter.runManaged().
- ACP stdout provider events should be bridged from ACPAdapter.handleLine via an overridable onProviderEvent hook so subclasses cannot forget to route parsed events; Claude maps that hook through AdapterBridge, preserving RunLifecycleService as the only terminal run-state writer.
- ACP process supervision needs persistent stdout/stderr line splitters plus an async child error handler; spawn ENOENT is emitted after spawn() returns on Windows/Node and must be converted into failed session state/stderr tail rather than an unhandled exception.
- The requested plural pnpm filters (@agenthub/adapters-*) do not match workspace package names; actual verified packages remain @agenthub/adapter-acp-base and @agenthub/adapter-claude-code.

## 2026-05-23 P0-3 ACP crash propagation fix

- ACP process supervision failures must cross the adapter boundary, not only mutate AcpAdapterSession.state. Use a single onSessionFailed hook for child error, child exit, and liveness timeout, and let ClaudeCodeACPAdapter translate that hook into AdapterBridge session.crashed so RunLifecycleService remains the durable terminal run-state writer.
- Daemon Claude-selection tests should assert adapter selection/session creation rather than a durable running status, because a missing or crashing local Claude ACP process now correctly transitions the run to failed through the managed lifecycle path.

## 2026-05-23 P1-2 Run Detail Raw Stream live UI (fetch-based SSE)

- Native `EventSource` cannot send `Authorization` headers, so it cannot prove admin-authorized raw SSE delivery in browser tests. The correct minimal fix is a fetch-based SSE reader in `useRawStream.ts` that uses `fetch()` with `ReadableStream` + a small SSE frame parser (`event:` / `data:` lines), plus an `Authorization: Bearer <token>` header.
- Admin token source is `window.__AGENTHUB_RAW_TOKEN__` (set via `page.evaluate` in tests). No token query param leakage. Production can set this from a secure auth bootstrap.
- The daemon's `authenticateBrowserRequest` treats same-origin requests without an `Origin` header as local/admin when no daemon token is configured. This is existing behavior, not a backend change. The e2e test accepts either placeholder text for the non-admin path because the invariant is "no raw lines exposed," not the exact placeholder wording.
- The admin-authorized e2e test inserts an admin bearer token into the daemon's `auth_tokens` table, sets `window.__AGENTHUB_RAW_TOKEN__`, opens the Raw Stream tab, publishes a live `adapter.raw.stdout` event via `daemon.eventBus.publish()`, and verifies the line renders in the UI.
- UI states: `connecting` -> `connected` (empty shows "No raw output has arrived yet.") -> line rendering; `forbidden` shows "Raw stream content requires admin scope or debug mode."; `error` falls back to the forbidden placeholder.
- Verification: `pnpm.cmd --filter @agenthub/web build`, all 5 Playwright e2e tests pass, `pnpm.cmd typecheck`, `pnpm.cmd lint`, and `pnpm.cmd check:all` pass.

## 2026-05-23 P1-2 Raw Stream tightened test

- The admin-authorized e2e test now observes raw `/event?view=raw...` requests via Playwright `page.on("request", ...)` and asserts:
  1. `authorization: Bearer e2e-admin-token` header is present on the raw SSE request, and
  2. the URL search params do not include `token` (no query-param leakage).
- The test publishes both `adapter.raw.stdout` and `adapter.raw.stderr` live events and asserts both lines render in the Raw Stream tab.
- The non-admin test preserves the invariant that no raw lines are exposed to ordinary browser sessions.
- All 5 Playwright e2e tests pass, plus `typecheck`, `lint`, and `check:all`.

## 2026-05-23 Raw debug auth boundary

- Missing Origin is no longer an admin signal. uthenticateBrowserRequest() keeps no-Origin local daemon/SDK calls at read/write scope only, while /event?view=raw continues to require explicit admin via stored/admin bearer credentials.


Correction: Missing Origin is no longer an admin signal. authenticateBrowserRequest() keeps no-Origin local daemon/SDK calls at read/write scope only, while /event?view=raw continues to require explicit admin via stored/admin bearer credentials.


## 2026-05-23 P1-1 CommandBus idempotency transaction boundary

- CommandBus idempotent dispatch now keeps claim, synchronous handler execution, and final command_records status/result in one better-sqlite3 transaction. A handler savepoint rolls back business side effects for deterministic and transient failed CommandResults; deterministic failures then persist the cached failed result outside the savepoint but still inside the outer transaction, while transient failures delete the record so retries execute cleanly.
- Idempotent handlers that return a Promise are rejected with an internal_error and the command record is removed, because better-sqlite3 cannot hold an async transaction boundary across awaited work without reintroducing the crash window.

## 2026-05-23 Task transition and PendingTurn projection blockers

- Task completion from `pending` is intentionally not an UpdateTask shortcut: callers must move through `in_progress` or `review`, while illegal transitions emit live-only `task.status.changed.rejected` and do not write durable `events` rows.
- Queued user messages must carry `pendingTurnId` and `turnDispatchMode` in `message.created`; the web projector also backfills `pendingTurnId` from `pending_turn.created` so cancel/scheduled/consumed matching works with older or incomplete message payloads.


- F4 scope fidelity check: CommandType excludes StartRun; Codex/LangGraph/A2A adapters are deterministic 501 stubs; daemon routes remain local-first with no cloud/multi-user routes. Background scan's tasks-schema Kanban concern appears to be core V0.5 task support rather than task-board UI scope creep.

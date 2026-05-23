
## 2026-05-23 M2.1 Permission Engine

### Changed files
- `packages/permissions/package.json`, `packages/permissions/src/index.ts`, `packages/permissions/scripts/run-tests.mjs`, `packages/permissions/test/permissions.test.ts`
- `packages/bus/src/index.ts`
- `packages/daemon/package.json`, `packages/daemon/src/index.ts`, `packages/daemon/src/openapi.ts`, `packages/daemon/test/daemon.test.ts`
- `packages/sdk/src/index.ts`, `packages/sdk/test/sdk.test.ts`
- `apps/cli/src/index.ts`, `apps/cli/test/cli.test.ts`

### Evidence
- Built PermissionEngine with built-in `builder-strict`, `builder-loose`, and `read-only` templates seeded into `permission_profiles`.
- Implemented file path canonicalization, sensitive-file deny, external-directory ask, shell glob longest-match with pipeline aggregation, stored-rule fast path, ask request creation, per-session queueing, pending idempotency dedupe, 5s allow retry short-circuit, timeout expiry, remembered allow rules, and `permission.requested` / `permission.resolved` audit events through EventBus.
- Added daemon permission profile/request/rule routes. Mutating routes dispatch CommandBus commands (`CreatePermissionProfile`, `PatchPermissionProfile`, `ResolvePermission`, `DeletePermissionRule`) instead of writing domain state in route handlers.
- Added SDK and CLI permission operations for profile listing, request listing, resolution, and rule/profile operations.

### Verification
- `pnpm.cmd --filter @agenthub/permissions test` passed: 6 tests.
- `pnpm.cmd --filter @agenthub/daemon test` passed: 4 tests.
- `pnpm.cmd --filter @agenthub/sdk test` passed: 2 tests.
- `pnpm.cmd --filter @agenthub/cli test` passed: 2 tests.
- `pnpm.cmd test` passed: 11 files, 68 tests.
- `pnpm.cmd typecheck` passed.
- `pnpm.cmd lint` passed.
- `pnpm.cmd check:all` passed.
- `pnpm.cmd schema:check` passed.
- `openspec.cmd validate add-agenthub-mvp --strict` passed.

## 2026-05-23 M2.1 Permission queue timeout retry

### Changed files
- `packages/permissions/src/index.ts`
- `packages/permissions/test/permissions.test.ts`

### Fix evidence
- Queued same-session permission requests now insert with `expires_at = NULL`, no timer, and no `permission.requested` event until presented.
- Presentation now explicitly updates `expires_at` from the presentation time, arms the timeout timer, and emits `permission.requested`.
- `expireDueRequests(now)` only normal-timeout expires active requests with non-NULL `expires_at`; queued hidden requests are not expired by stale initial deadlines.
- When an active request resolves or expires, the next queued pending request is promoted and gets a fresh active timeout window.
- Pending idempotency duplicates now return the original in-flight promise.

### Verification
- `pnpm.cmd --filter @agenthub/permissions test` passed: 1 file, 9 tests.
- `pnpm.cmd --filter @agenthub/daemon test` passed: 1 file, 4 tests.
- `pnpm.cmd --filter @agenthub/sdk test` passed: 1 file, 2 tests.
- `pnpm.cmd --filter @agenthub/cli test` passed: 1 file, 2 tests.
- `pnpm.cmd test` passed: 11 files, 71 tests.
- `pnpm.cmd typecheck` passed.
- `pnpm.cmd lint` passed.
- `pnpm.cmd check:all` passed.
- `pnpm.cmd schema:check` passed.
- `openspec.cmd validate add-agenthub-mvp --strict` passed.

## 2026-05-23 M2.2 Context Ledger

### Changed files
- `packages/context/package.json`, `packages/context/src/index.ts`, `packages/context/scripts/run-tests.mjs`, `packages/context/test/context.test.ts`
- `packages/bus/src/index.ts`
- `packages/daemon/package.json`, `packages/daemon/src/index.ts`, `packages/daemon/src/openapi.ts`
- `packages/sdk/src/index.ts`
- `apps/cli/src/index.ts`

### Evidence
- Implemented ContextLedger CRUD/status flow on existing `context_items` and `context_versions`, including draft proposals, user confirm, update snapshots, deprecation, optimistic version conflicts, and pin-to-workspace scope upgrade.
- Agent-originated or untrusted confirmed writes are downgraded to draft and emit canonical `context.item.created` + `context.item.proposed`; verified confirmed writes require trusted tool kind allowlist (`git-blame`, `git-log`, `filesystem-watch`, `lsp-definition`, `package-manifest-parse`).
- Visibility filtering supports `visibility.agents` and `visibility.roles`; assembly v0 emits deterministic sections in spec priority order with approximate token budget truncation.
- Injection classification returns `ContextInjectionResult` for `immediate`, `next_turn`, and `next_session` without real provider injection; `VectorIndex` and `NoopVectorIndex` are present with no vector dependencies.
- Daemon context mutating APIs dispatch CommandBus handlers (`ProposeContextItem`, `WriteContextItem`, `UpdateContextItem`, `ConfirmContextItem`, `DeprecateContextItem`, `PinContextItem`, `InjectContext`) rather than writing domain state in HTTP routes.

### Verification
- LSP diagnostics passed for modified TS files: `packages/context/src/index.ts`, `packages/context/test/context.test.ts`, `packages/bus/src/index.ts`, `packages/daemon/src/index.ts`, `packages/daemon/src/openapi.ts`, `packages/sdk/src/index.ts`, `apps/cli/src/index.ts`.
- `pnpm.cmd --filter @agenthub/context test` passed: 1 file, 10 tests.
- `pnpm.cmd --filter @agenthub/daemon test` passed: 1 file, 4 tests.
- `pnpm.cmd --filter @agenthub/sdk test` passed: 1 file, 2 tests.
- `pnpm.cmd --filter @agenthub/cli test` passed: 1 file, 2 tests.
- `pnpm.cmd test` passed: 12 files, 81 tests.
- `pnpm.cmd typecheck` passed.
- `pnpm.cmd lint` passed.
- `pnpm.cmd check:all` passed.
- `pnpm.cmd schema:check` passed.
- `openspec.cmd validate add-agenthub-mvp --strict` passed.

## 2026-05-23 M2.2 Context Ledger injection boundary fix

### Changed files
- `packages/daemon/src/index.ts`, `packages/daemon/src/openapi.ts`, `packages/daemon/test/daemon.test.ts`
- `packages/sdk/src/index.ts`, `packages/sdk/test/sdk.test.ts`
- `packages/context/test/context.test.ts`

### Fix evidence
- Removed the public `/context/inject` route and OpenAPI path because `InjectContext` is an internal-only CommandBus command (`origin='http'` must not dispatch it).
- Removed `AgentHubClient.injectContext()` so the SDK does not advertise a public helper for an internal-only command.
- Kept internal `InjectContext` command handler and `ContextLedger.classifyInjection()` available for future adapter/intervention internal usage.
- Added daemon regression coverage proving `POST /context/inject` returns 404 `not_found` and does not expose `internal_command_via_http` as documented public behavior.
- Added SDK regression coverage proving `injectContext` is not a public client helper, and context package coverage proving internal `InjectContext` still returns `ContextInjectionResult`.

### Verification
- LSP diagnostics passed for modified TS files: `packages/daemon/src/index.ts`, `packages/daemon/src/openapi.ts`, `packages/daemon/test/daemon.test.ts`, `packages/sdk/src/index.ts`, `packages/sdk/test/sdk.test.ts`, `packages/context/test/context.test.ts`.
- `pnpm.cmd --filter @agenthub/context test` passed: 1 file, 11 tests.
- `pnpm.cmd --filter @agenthub/daemon test` passed: 1 file, 5 tests.
- `pnpm.cmd --filter @agenthub/sdk test` passed: 1 file, 3 tests.
- `pnpm.cmd --filter @agenthub/cli test` passed: 1 file, 2 tests.
- `pnpm.cmd test` passed: 12 files, 84 tests.
- `pnpm.cmd typecheck` passed.
- `pnpm.cmd lint` passed.
- `pnpm.cmd check:all` passed.
- `pnpm.cmd schema:check` passed.
- `openspec.cmd validate add-agenthub-mvp --strict` passed.

## 2026-05-23 M2.3 Intervention Engine

- Implemented `@agenthub/interventions` with SQLite-backed intervention requests, reason length validation, V1 `emergency`/`rollback` not_implemented rejection, pending dedupe by source+target run/artifact/context, canonical durable `intervention.*` events, invalid transition audit events, snooze reactivation, and source-agent presence updates via `agent_presence` + `agent.state.changed`.
- Added `RequestIntervention` to canonical CommandBus commands and daemon wiring; mutating HTTP routes dispatch CommandBus for create/approve/ignore/reject/later. Read routes list/read interventions.
- Added debug basics: `GET /debug/events` over durable `events` with traceId/runId/roomId/type/since/until/limit filters, and `GET /debug/stats` with uptime, rooms, active runs, pending permissions/interventions, eventsLast5min, and `sseClientCount: 0` placeholder.
- Added SDK/CLI minimal helpers for interventions/debug and tests for service state machine, daemon routes/debug APIs, SDK URL construction, and CLI commands.

Verification:
- `pnpm.cmd --filter @agenthub/interventions test` -> passed (1 file, 6 tests).
- `pnpm.cmd --filter @agenthub/daemon test` -> passed (1 file, 6 tests).
- `pnpm.cmd --filter @agenthub/sdk test` -> passed (1 file, 4 tests).
- `pnpm.cmd --filter @agenthub/cli test` -> passed (1 file, 3 tests).
- `pnpm.cmd test` -> passed (13 files, 93 tests).
- `pnpm.cmd typecheck` -> passed after making service trace context optional for direct calls.
- `pnpm.cmd lint` -> passed.
- `pnpm.cmd check:all` -> passed (events, visibility, subscriptions, command, run-state-machine).
- `pnpm.cmd schema:check` -> passed (93 event types).
- `pnpm.cmd build` -> passed; Turbo reported no build tasks.
- `openspec.cmd validate add-agenthub-mvp --strict` -> passed.

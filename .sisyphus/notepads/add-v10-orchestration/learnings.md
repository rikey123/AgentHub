# Learnings — add-v10-orchestration

## [2026-05-29T00:34:45Z] Session start
- Working on main branch; no worktree specified.
- Plan committed as 44ea51b (already existed) — plan file was already tracked.
- 50 implementation tasks (0.1–6.6) + 4 final review tasks (F1–F4).
- 8 waves; Wave 0 is preflight/branch setup (no source changes).
- Shared contract files (serialized, one owner at a time):
  packages/db/src/schema.ts, packages/db/migrations/*, packages/protocol/src/events/registry.ts,
  packages/daemon/src/commands.ts, packages/daemon/src/index.ts,
  apps/web/src/hooks/useProjector.ts, packages/orchestrator/src/mcp/room-mcp-server.ts
- No Playwright during development; browser QA is non-blocking user activity.
- Every SQLite mutation must publish matching event in same transaction (except REST/polling-only paths).
- Forbidden events: task.updated, task.deleted, role.generation.*, runtime.test.result, model_config.test.result

## [2026-05-29T00:47:40Z] Task 0.1
- Added `packages/db/migrations/0014_v10.sql` for the V1.0 orchestration contract.
- Confirmed `tasks.priority` already existed in `0004_runs_tasks.sql`, so the new migration intentionally did not add it again.
- Updated `packages/db/src/schema.ts` and `packages/db/test/sqlite.test.ts` to cover the new tables, compatibility columns, and GC/index expectations.
- Verified `pnpm.cmd test -- packages/db` and `pnpm.cmd schema:check` both pass.

## [2026-05-29T00:??:??Z] Task 0.3
- Extended `packages/protocol/src/events/registry.ts` with the 18 V1.0 events from the event-system delta: role/runtime/model_config/agent_binding/task.activity/task.delegation/team.dispatch/permission.run_summary.
- Added the missing canonical categories to `EventCategory`: `role`, `runtime`, `model`, `binding`, and `team`.
- Kept forbidden event types out of the registry; `task.updated` remains rejected by `EventBus` validation.
- Added a regression test in `packages/bus/test/event-bus.test.ts` to prove `task.updated` throws `InvalidEventEnvelopeError`.

## [2026-05-29T00:??:??Z] Task 0.4
- Added `scripts/checks/ai-sdk-provider-check.mjs` as a dependency-free ESM check that scans `packages/` for `streamText`, `generateText`, and `streamObject` calls and flags plain string `model:` values with file + line output.
- Wired the check into `package.json` and `scripts/checks/check-all.mjs`; `check:all` now runs 6 custom checks.
- Added fixture coverage at `scripts/checks/fixtures/ai-sdk-provider-check-fail.ts` and verified the repo passes while the fixture fails as expected.
## [2026-05-29T01:16:53Z] Task 0.2
- Added `packages/daemon/src/migrations/0014_data.ts` as the idempotent V1.0 data backfill helper.
- Wired daemon startup to run the backfill after default agent seeding so built-in profiles are included.
- The helper splits `agent_profiles` into `roles`, deduplicated `runtimes`, deduplicated `model_configs`, and `agent_bindings`, then backfills `room_participants.agent_binding_id` and task assignee compatibility columns.
- Added a regression test that seeds duplicate adapter/model pairs, verifies deduplication/backfill, and checks the helper is idempotent on a second pass.
- The repo has no TS migration runner; runtime backfill is the supported path here.
- Small test-fixture gotcha: the initial SQLite seed transaction must actually be invoked (`()`) or the fixture silently inserts nothing.

## [2026-05-29T01:26:10Z] Task 0.6
- Centralized legacy room-creation compatibility in `packages/daemon/src/compat/agent-profile-compat.ts` so `POST /rooms` resolves legacy `agentProfileId` once at the route boundary.
- The compatibility path maps migrated `agent_bindings.id` directly from the old profile id, returning `404 agent_profile_not_found` before any write when no binding exists.
- `createRoom` now persists `room_participants.agent_binding_id` for the primary and invited agent rows and echoes `agentBindingId` in the created response for legacy callers.
- The browser auth test needed a status update because `POST /rooms` now uses the created response path (`201`).

## [2026-05-29T01:40:00Z] Task 0.5
- Verified `pnpm.cmd check:all` passes and includes `ai-sdk-provider:check` in the custom check chain.
- Verified `pnpm.cmd events:check` still passes with 115 registered event types after task 0.3.
- Verified `pnpm.cmd visibility:check` still passes and confirms registered visibility for durable events.
- Proved the negative path by adding a temporary scanned fixture containing `task.updated`; `events:check` rejected it with a source-location error, then the fixture was removed to keep the repo clean.
- `events:check` only scans `packages/` and `apps/`, so rejection proofs must live in those trees to be detected.

## [2026-05-29T01:48:00Z] Task 0.1 schema drift fix
- Re-aligned `packages/db/migrations/0014_v10.sql` and `packages/db/src/schema.ts` with the V1.0 specs for roles, runtimes, model configs, task activities, and role drafts.
- Added the missing workspace/name indexes for roles, runtimes, and model configs so the migration matches the spec SQL exactly.
- Kept legacy compatibility where requested: `version` and `status` remain on `runtimes`, `profile` remains on `model_configs`, and the legacy `agent_profiles` table is untouched.
- `task_activities` now uses the spec column names (`kind`, `by_kind`, `by`) and the task activity index name matches the spec.
- The daemon data migration had one leftover `agent_bindings.name` seed path; it now uses `override_permission_profile_id`.
- The daemon test fixture for migrated bindings also needed the renamed column and now passes.

## [2026-05-29T03:00:00Z] Task 1.5
- The daemon already had a real `KeychainBridge` in `packages/security/src/keychain.ts`; I reused it instead of inventing a new secret store.
- `createKeychainAccount()` gives a stable account name for model-config secrets; SQLite keeps only `api_key_ref` + `api_key_fingerprint`.
- Model-config responses deliberately omit `api_key_ref`; the API surface only returns fingerprint metadata.
- The delete path checks `agent_bindings.model_config_id` first and returns `409` without publishing `model_config.deleted` when bindings exist.
- Ollama/local configs intentionally persist `NULL` for both key fields.

## [2026-05-29T02:32:02Z] Task 1.1
- Implemented REST role CRUD directly in `packages/daemon/src/index.ts` with same-transaction durable publishes for `role.created`, `role.updated`, and `role.deleted`.
- Added a response normalizer so role API replies decode stored JSON strings for `capabilities` and `tags` before returning them to clients.
- Delete protection checks `agent_bindings` first and returns `409 { error: "role_has_bindings", bindingCount }` without publishing an event.
- Added daemon regression coverage for create/get/update/delete happy path plus the binding conflict path.
- Verified the isolated daemon suite passes: `pnpm.cmd --filter @agenthub/daemon test`.

## 2026-05-29 — Wave 1 Oracle re-review after schema fix

- Re-reviewed `0014_v10.sql`, `schema.ts`, `0014_data.ts`, and DB/daemon tests after the schema drift fix.
- Verdict written to `.sisyphus/evidence/wave-1-oracle-review-2.md`: APPROVE; Wave 2 can proceed.
- Focused verification passed: DB sqlite drift tests, `schema:check`, V10 data migration test, and legacy `agentProfileId` compatibility tests.
- Note: broad `pnpm.cmd test -- packages/db packages/daemon` had one unrelated daemon auth-token test fail with `Error: bad port`; the Wave 1 schema/data-migration paths passed focused checks.

## 2026-05-29 — Task 1.3 runtime CRUD + native-default startup

- Added daemon-side runtime REST handling in `packages/daemon/src/index.ts` for `GET /runtimes`, `POST /runtimes`, `PATCH /runtimes/:id`, and `DELETE /runtimes/:id`.
- Implemented transaction+publish on every runtime write with durable detail events: `runtime.detected`, `runtime.updated`, and `runtime.removed`.
- Added daemon startup UPSERT for `native-default` (`kind = native`, `name = AgentHub Native`, `supported_caps = []`, `manifest_json = {"runtimeKind":"native"}`) before the context/permission engines are built.
- Added daemon tests covering native runtime seeding, CRUD event emission, and the 409 delete path when `agent_bindings` exist.

## [2026-05-29T02:41:30Z] Task 1.7
- Added /agent-bindings CRUD in packages/daemon/src/index.ts with expanded GET rows for role/runtime/modelConfig summaries and no api_key_ref plaintext exposure.
- Enforced native-runtime bindings to require model_config_id on create/update, validated referenced role/runtime/model_config rows, and used same-transaction durable detail events for create/update/remove.
- DELETE now returns 409 when room_participants references exist and emits no event in that branch.
- Added daemon regression tests for native binding creation, native missing model_config rejection, and delete conflict with room participants.
- Verified `pnpm.cmd test -- packages/daemon` passes.

## [2026-05-29T03:12:00Z] Task 1.2
- Added `packages/daemon/src/builtin-roles.ts` with `seedBuiltinRoles(database, rolesDir, eventBus, now)` and five V1.0 builtin templates: project-manager, builder, reviewer, archivist, generalist.
- Startup seeds builtin roles after EventBus creation so role table inserts and `role.created { isBuiltin: true }` publish in one SQLite transaction.
- Filesystem rule: create all five markdown files only when the roles directory is empty; existing files are never overwritten. Older existing versions warn on stderr with the required reset command.
- Existing route/test typing debt surfaced during full typecheck; fixed the async runtime settings job route to use `ctx.settingsJobs`, typed model test fetch mocks, and kept the forbidden `task.updated` bus test as a runtime-negative test via a narrow `never` cast.
- Verified `pnpm.cmd test -- packages/daemon`, `pnpm.cmd typecheck`, and `pnpm.cmd build` pass.

## [2026-05-29T03:00:00Z] Task 1.4
- Added runtime detect/test routes in packages/daemon/src/index.ts without adding runtime.test.result to registry or EventBus output.
- Runtime detection publishes runtime.detected only when persisted detected_path/detected_version/detected_at state changes; unchanged repeated detect calls return changed=false without a new event.
- Runtime test results are REST-only: synchronous native tests return 200 { ok, version, latencyMs }, while async requests return 202 { jobId } and poll GET /settings/jobs/:jobId for flat pending/completed/failed status.
- The daemon already had a model-config settings job endpoint; runtime jobs were integrated into that existing polling route instead of adding a competing route shape.
- Verified pnpm.cmd test -- packages/daemon passes after the runtime route/test changes.

## [2026-05-29T03:00:34Z] Task 1.6
- Model-config test calls now resolve provider behavior explicitly in the daemon stub instead of passing string model IDs through the runtime path.
- `/settings/jobs/:jobId` now serves both runtime async tests and model-config tests from the shared in-memory job store; runtime polling stayed compatible.
- Successful model tests return `{ ok: true, model, latencyMs, inputTokens, outputTokens }`; failures redact provider details down to `invalid_api_key`, `model_not_found`, or `rate_limited`.
- Ollama tests intentionally send no API key header and still use the same shared polling contract.
- Verified `pnpm.cmd test -- packages/daemon` passes after the job-store bridge and route updates.

## [2026-05-29T03:02:00Z] Task 1.8
- Consolidated data-foundation test coverage in packages/daemon/test/daemon.test.ts without duplicating existing CRUD tests.
- Added detail-only durable replay assertions for role/runtime/model_config/agent_binding write events.
- Added expectNoPlaintextSecret guard to scan model-config responses, model_config event payloads, and relevant model_configs DB fields for fake API key plaintext.
- Runtime detect/async job tests now use the deterministic native runtime path to avoid flaky real process probes under package-wide parallel test load.
- Verified pnpm.cmd test -- packages/daemon packages/db packages/orchestrator passes: 35 files, 284 passed, 1 skipped.

- Model-config delete regressions are easiest to verify with a hoisted test-time keychain mock: that lets the daemon use the real delete path while the test asserts `modelConfigSecrets.delete` is never called on 409 conflicts.
- The daemon already uses `null`-aware not-found checks for model-config GET/PATCH/DELETE, so the regression coverage should assert all three methods against the same missing ID for consistency.

## Wave 2 Oracle Gate Re-Review — add-v10-orchestration
- Model-config delete conflict path should keep the database row, emit no delete event, and skip keychain deletion until after conflict is ruled out and the row is deleted.
- Model-config not-found checks should compare `get()` results with `null`, not `undefined`.
- Verification passed: targeted tests, `ai-sdk-provider:check`, and `check:all`.
## task 2.1 provider registry

- `packages/native-agent-runtime` follows the repo’s package convention: private ESM package, `exports` to `src/`, `scripts/run-tests.mjs`, and a `tsconfig.json` that extends from the repo root.
- Vercel AI SDK 5 explicit provider factories work cleanly with `provider.chatModel(modelId)`; the package test should mock the factory module and assert the model instance comes from the provider object, not a string ID.
- The new package needed `../../tsconfig.base.json` from its location; the first attempt used the adapter package path and broke Vitest tsconfig resolution.
- Native runtime adapter code needed source-relative imports for `@agenthub/*` internals during package tests; switching to direct `../../*/src/index.ts` imports kept Vitest resolution stable without changing repo-wide package wiring.
- Task 2.5 wiring note: native dispatch is driven from the daemon registry, classified from `native` runtime/adapter ids, and the registry now lazy-loads the native adapter so unrelated daemon tests don’t eagerly pull AI SDK dependencies.
- `native-default` startup seeding stayed intact; the daemon suite verified it still exists after startup.
- Codex stayed a stub: the codex package’s own test still asserts the deterministic V1.x 501/not-implemented behavior.
## 2026-05-29 — Task 2.3 MCP tool conversion
- Added `packages/native-agent-runtime/src/mcp-tool-converter.ts` to turn MCP tool definitions into AI SDK `tools` entries without introducing a separate Native-only tool system.
- `NativeAgentAdapter.runManaged()` now accepts MCP tools, converts them to AI SDK tools, and feeds them into `streamText()`.
- Tool execution now emits `tool.call.requested` before execution and `tool.call.completed` after execution through `AdapterBridge`.
- Tool failures are reported as failed tool completions and thrown so AI SDK can surface tool-error behavior while the overall run keeps going.
- Learned that AI SDK helper imports can drag in hidden runtime dependencies; the final implementation uses plain tool objects to keep the package dependency-light.
- Added model.api_call.* permission resources with default-allow evaluation.
- Cached model permission decisions per run/model config and emitted permission.run_summary on terminal.
- Extended the run detail permissions tab to render run-level permission summaries.
- Added root zod devDependency so the AI SDK test path resolves cleanly in the workspace.

## [2026-05-29T04:38:00Z] Task 2.6 NativeAgentAdapter integration tests
- Added `packages/native-agent-runtime/test/native-agent-adapter.integration.test.ts` using real SQLite migrations, `EventBus`, `RunLifecycleService`, `PermissionEngine`, and mocked AI SDK/provider resolution.
- Native runtime token deltas are `ephemeral` and coalesced by `EventBus`; integration tests should call `flushDeltas()` and assert live subscriber delivery rather than expecting `message.part.delta` rows in `events`.
- Permission allow/deny can be exercised deterministically by seeding `permission_rules` for `model.api_call.<provider>`; deny-before-stream should assert both `resolveProvider` and `streamText` were not called.
- Cancel integration can use a real `CommandBus` + `createCancelRunHandler` wired to `NativeAgentAdapter.cancelManagedRun()` and a mocked stream that waits on `AbortSignal`.
- Verified `pnpm.cmd test -- packages/native-agent-runtime packages/orchestrator packages/daemon` and `pnpm.cmd ai-sdk-provider:check` pass.

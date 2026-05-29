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

## [2026-05-29T06:55:00Z] Wave 4 Oracle fixes
- The daemon’s role-generation job response shape is `draftJson`; the web modal should not expect `draft`, `roleDraft`, or `result`.
- Failed role-generation cleanup is easiest to regression-test when the cleanup logic is factored into a helper that can be called directly.

## [2026-05-29T09:26:45Z] Task 4.4 sibling completion gate
- Tightened `packages/orchestrator/src/team-dispatch.ts` so the terminal hook waits when any sibling is still `pending`/`in_progress`, wakes the leader only once when the group is ready, and uses `task_blocked` when any sibling is blocked.
- Kept idempotency on the `team.dispatch.started` / `team.dispatch.completed` event checks so duplicate terminal notifications do not double-wake the leader.
- Updated the team-mode regression tests to assert the leader wake count by reason, not by counting the normal delegated-task wake calls from `room.delegate`.
- Verified with `pnpm.cmd test -- packages/orchestrator` after the fix; all orchestrator tests pass.
- Captured task evidence in `.sisyphus/evidence/task-4.4-sibling-partial-no-wake.md` and `.sisyphus/evidence/task-4.4-sibling-idempotent.md`.

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

## [2026-05-29T06:11:30Z] Task 3.6
- Added `packages/daemon/src/role-draft-gc.ts` to keep `role_drafts` ephemeral: startup clears expired rows and an hourly timer repeats cleanup until daemon close.
- Wired GC cleanup into the daemon close path so the interval stops before SQLite shutdown.
- Added daemon integration coverage for startup cleanup, active-draft preservation, timer execution, and cleanup cancellation.
- Confirmed the role draft path remains event-free: no `role.generation.*` EventBus types or rows were introduced.
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

## Wave 3 Oracle Gate Review - 2026-05-29T04:52:38
- Passing direct adapter tests are insufficient for native runtime gates; verify daemon AdapterRegistry construction passes permission/keychain dependencies into real adapters.
- Forbidden event grep should ignore plan/evidence text and focus on protocol registry/source emissions/tests asserting absence.

## [2026-05-29T05:05:00Z] Wave 3 Oracle fixes
- `AdapterRegistry.native()` now passes `permissionEngine` and the daemon keychain bridge into `NativeAgentAdapter`, so native dispatch no longer falls back to implicit allow.
- Native permission summaries now use `modelConfig.id` for both cache keys and emitted `permission.run_summary` payloads; `nativeModelConfig()` now selects `mc.id`.
- MCP tool failures now return an error result and emit exactly one `tool.call.completed` event instead of throwing twice.
- Verification passed: `pnpm.cmd test -- packages/native-agent-runtime packages/orchestrator packages/daemon`, `pnpm.cmd ai-sdk-provider:check`, and `pnpm.cmd check:all`.

## 2026-05-29T05:17:36.8031483+08:00 — Wave 3 Oracle re-review 2
- Registry-dispatched native runs now pass PermissionEngine into NativeAgentAdapter, so deny-before-stream is covered at daemon composition level.
- Native model permission cache and permission.run_summary now use modelConfig.id rather than provider/model strings.
- MCP tool converter should return structured tool error payloads and emit exactly one tool.call.completed on failures, not throw through the AI SDK tool execution path.

## [2026-05-29T05:32:00Z] Task 3.1 Settings modal shell

- AgentHub web currently has no jsdom/Testing Library dependency; settings UI tests should keep component-contract coverage dependency-free unless the test stack is added deliberately.
- HeroUI `Modal.Backdrop` renders no useful server string output, so SSR string assertions are not a reliable way to prove modal contents.
- Settings modal bootstrap is REST-only: `GET /roles`, `/runtimes`, `/model-configs`, and `/agent-bindings` run in parallel with one AbortController per open cycle; closing aborts and clears local state.
- `FeatureRail` Settings should act as an entry point, not a persistent rail tab: call the settings opener and leave the active workbench rail unchanged.
- Repo-wide/web build typecheck is currently blocked by native-runtime/daemon TS issues outside settings UI; targeted web settings tests pass.

## [2026-05-29T05:52:00Z] Task 3.3 Runtimes tab

- Settings runtime rows arrive from `GET /runtimes` as arrays with snake_case DB fields; mutation responses may wrap raw rows in `{ runtime }`, so the web tab needs a normalizer that handles both decoded arrays and stringified `args`/`env`.
- Runtime test results are REST-only: synchronous `200` returns the result directly, while async `202` polling uses `/settings/jobs/:jobId` and may return either flat `{ status, result }` or wrapped `{ job }` shapes from shared settings job infrastructure.
- Locally added custom ACP rows should use a UI-only `draft` status to distinguish unsaved rows from persisted runtimes that are merely `missing`; otherwise empty-command persisted rows can be incorrectly POSTed again.
- GitNexus MCP was unavailable in this session (`Not connected`), so impact/detect-change checks could not run; source-level scope was kept to `SettingsModal.tsx`, new `RuntimesTab.tsx`, tests, evidence, and notepad updates.

## [2026-05-29T05:48:00Z] Task 3.4 Models tab

- `GET /model-configs` currently returns snake_case rows (`base_url`, `api_key_fingerprint`), while create/update requests expect camelCase payload fields (`baseUrl`, `apiKey`); UI helpers should normalize responses defensively but write daemon-native camelCase.

## [2026-05-29T08:04:48Z] Task 4.1 room.delegate

- `room.delegate` now uses the transaction-free `TaskService.createInTransaction()` path inside one outer SQLite transaction so the task insert, WakeAgent dispatch, and `task.delegation.created` publish stay coupled.
- Delegate failure cleanup must include all delegate-owned task events (`task.created`, `task.assigned`, `task.delegation.created`) when the wake step aborts.
- `WakeAgent` had to carry `taskId` so the delegated run can bind back to the task row.

## [2026-05-29T07:14:13Z] Task 4.8 room leader validation
- `POST /rooms` now requires `leaderRoleId` for `team` and `squad` modes; the daemon returns `400` with `validation_failed` / `squad_mode_requires_leader_role_id` when it is missing.
- V1.0 room participants can be passed as `{ roleId, runtimeId, modelConfigId? }` and are resolved to `agent_binding_id` before insert; legacy `agentProfileId` compatibility remains unchanged.
- `rooms.leader_role_id` is persisted alongside `primary_agent_id`, and the room-created event includes `leaderRoleId` for the new modes.
- Verified with `pnpm.cmd test -- packages/daemon` (all passing).
- The web Settings test style remains dependency-free: export pure REST/payload helpers from UI components and test those with mocked `fetch` instead of adding Testing Library/jsdom mid-wave.
- HeroUI Cards in this repo use `Card.Content` rather than `Card.Body`; using the latter passes LSP but fails package `tsc`.
- Ollama should always omit `apiKey` and send `http://localhost:11434/v1` when no custom baseURL is entered.
- `pnpm.cmd --filter @agenthub/web build` no longer reports Settings-local errors after this task, but still fails on existing native-runtime/daemon TypeScript issues from Wave 3.


## [2026-05-29T05:40:00Z] Task 3.5 Settings URL deep link
- Added a small settingsUrl.ts helper so App-level URL state stays testable without coupling the modal to browser history APIs.
- Settings modal is now controlled for tab selection; App owns settingsOpen and settingsTab and syncs them to window.history.replaceState(...).
- Invalid ?settings= values normalize to oles, and closing removes the query param while preserving unrelated room/workbench URL state.
- Existing Settings component-contract tests already covered bootstrap behavior, so I added focused URL contract coverage alongside them instead of introducing a separate browser stack.


## [2026-05-29T06:03:00Z] Task 3.2 Roles tab
- `SettingsModal.tsx` now wires the Roles tab the same way as Runtimes/Models: REST bootstrap data flows into a tab component and tab-local mutations report updated arrays back into modal-local state.
- Daemon role list/create/update responses use snake_case `is_builtin` and parsed `capabilities` arrays; direct GET /roles/:id is raw/stringified, so the UI normalizer accepts both array and JSON-string capabilities plus `isBuiltin` defensively.
- HeroUI v3 `TextArea` does not accept `minRows`; use sizing classes such as `className="min-h-44"` like existing cards.
- Settings UI tests remain dependency-free Vitest contract tests around exported REST helpers instead of jsdom interaction tests.
- Required `pnpm.cmd test -- apps/web` passes; web build is still blocked by unrelated daemon/native-runtime TS errors noted before, not by RolesTab.

## [2026-05-29T07:10:00Z] Task 3.7 role generation jobs
- Added REST job polling for role generation in `packages/daemon/src/index.ts` using `role_drafts` as the persistent store with 7-day expiry.
- Kept generation event-free: there are still no `role.generation.*` EventBus types, and save-path `role.created` now carries `source: "ai_generated"` + `generationJobId` without prompt/description payload data.
- The job handler uses a simple async stub flow (`pending` → `streaming` → `completed`) and GET omits `draftJson` for terminal cancelled/failed states.
- Added daemon coverage for POST/GET/DELETE job polling plus the sanitized generated-role save event.

## [2026-05-29T06:31:00Z] Task 3.8 Role generator settings flow
- Added `RoleGeneratorModal.tsx` as a REST-only settings modal: validates non-empty description/modelConfigId, starts `POST /roles/generate`, polls `GET /roles/generate/jobs/:jobId` every 500ms, previews editable drafts, saves via `POST /roles` with `generationJobId`, and deletes the draft job on save/cancel/close.
- `SettingsModal` now passes already bootstrapped `modelConfigs` into `RolesTab`, so the generator selector does not issue an extra fetch or subscribe to SSE.
- Settings UI tests still follow the dependency-free helper-contract style; `RoleGeneratorModal.test.ts` mocks fetch and fake timers rather than adding jsdom/Testing Library.
- Build gotcha: with `exactOptionalPropertyTypes`, do not pass `signal: undefined` in `RequestInit` and do not assign optional object fields as explicit `undefined`.
- Verification: `pnpm.cmd test -- apps/web` passes (45 files, 330 passed, 1 skipped). `@agenthub/web` build now has no settings-local errors but remains blocked by existing daemon/native-runtime TypeScript issues from Wave 3.
- GitNexus MCP returned `Not connected` for required impact checks; recorded in evidence and kept scope limited to settings UI files.

## [2026-05-29T07:09:12Z] Task 4.7 assignee resolve
- `packages/orchestrator/src/task-service.ts` now carries the V1.0 task fields end-to-end: `assignee_role_id`, `assignee_binding_id`, `delegation_chain`, and `expects_review` are persisted and surfaced in `TaskRow`/`TaskView`.
- Role delegation now resolves through room bindings before insert; unbound roles fail fast with `validation_failed` instead of creating a task without a concrete binding.
- The legacy `assigneeAgentId` compatibility field remains populated from the resolved binding participant when available.
- Verification passed: `pnpm.cmd test -- packages/orchestrator packages/daemon`.

## [2026-05-29T07:23:55Z] Task 4.6 task activities
- `TaskService.addTaskActivity()` now writes `task_activities` and publishes `task.activity.added` inside the same SQLite transaction.
- `room.update_task` uses status-only dispatch for transitions, and non-status updates (`addComment`, `setBlocker`, `linkArtifact`, `priority`) route through task activities instead of `task.updated`.
- `GET /tasks/:id/activities` is exposed from the daemon for timeline fetches.
- Test harness note: daemon POST route regression helpers need an async-iterable request body; `Readable.from(...)` was not enough for `body(ctx)` in this suite.

## [2026-05-29T06:39:00Z] Task 3.9 settings and role generator test consolidation
- Existing settings tests from tasks 3.1-3.8 already covered modal bootstrap, Roles/Runtimes/Models REST helper contracts, role generation save/cancel/failure normalization, deep links, EventSource-free flows, and fake API-key redaction after save.
- Added only the missing daemon regression: generated role drafts get a seven-day expires_at, GC removes them after the boundary, polling returns 404, and no role.generation.* events are persisted.
- Verification passed: pnpm.cmd test -- packages/daemon apps/web (45 files, 331 passed, 1 skipped).

- Role generation jobs now normalize the daemon response from draftJson; the UI should not expect legacy draft/esult shapes.\n- Failed role generation jobs should be deleted after failure handling, not just marked failed, so stale ole_drafts rows do not linger.\n- A deterministic failure regression test is easier when cleanup is factored into a small helper that can be exercised directly.

- `POST /rooms` validation should happen after compatibility normalization so legacy payloads still flow through unchanged.
- The daemon test suite file contains a helper (`invokeHandler`) for in-process route calls; using it avoids flaky `bad port` fetch behavior in package-wide Vitest runs.
- `pnpm.cmd test -- packages/daemon` currently expands to the repo-wide Vitest runner; the daemon test file passes in isolation with `pnpm.cmd exec vitest run packages/daemon/test/daemon.test.ts`.

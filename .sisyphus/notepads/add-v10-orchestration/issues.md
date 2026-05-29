# Issues — add-v10-orchestration

## [2026-05-29T00:34:45Z] Session start
- No issues yet.

## Wave 1 Oracle review — 2026-05-29

- Gate verdict: REJECT. Main blocker is schema/spec drift in `0014_v10.sql` and `schema.ts`, not event registry or migration mechanics.
- Spec-required columns to recheck before Wave 2: `roles.avatar/tags/default_permission_profile_id`, `runtimes.detected_path/detected_version/supported_caps/manifest_json`, `model_configs.name/temperature/max_tokens/reasoning/extra`, `agent_bindings.override_permission_profile_id`, `task_activities.kind/by_kind/by`, and `role_drafts.failure_reason`.
- Passing evidence from review: `check:all`, db sqlite tests, bus event-bus tests, and daemon tests all pass; `task.updated` rejection is covered.

## Wave 2 Oracle review — 2026-05-29

- REJECTED due to ModelConfig delete conflict path deleting Keychain secret before returning 409. Fix by moving secret deletion after conflict handling and covering bound config with non-null api_key_ref.
- ModelConfig not-found handling is inconsistent with `get()` returning null; GET/PATCH/DELETE missing IDs can miss intended 404 behavior. Add not-found CRUD tests.
- Verification commands all passed: scoped tests, ai-sdk-provider:check, check:all.

## Wave 3 Oracle Gate Review - 2026-05-29T04:52:38
- REJECTED Wave 3 despite passing tests/checks: AdapterRegistry.native() does not pass permissionEngine into NativeAgentAdapter, so real daemon-dispatched native runs default allow for model.api_call.
- Permission cache is keyed by runId+provider and emits model name as modelConfigId; requirement is runId+modelConfigId with actual model config id.
- mcp-tool-converter emits failed tool completion twice and throws; non-fatal MCP tool errors should return an error result without crashing the run.

## 2026-05-29 — Wave 4 Oracle review

- Review verdict written to `.sisyphus/evidence/wave-4-oracle-review.md`: REJECT.
- Verification commands passed: `pnpm.cmd test -- packages/daemon apps/web` and `pnpm.cmd check:all`.
- Key blocker: daemon returns completed role generation drafts as `draftJson`, but `RoleGeneratorModal.normalizeRoleGenerationJob` only reads `draft`, `roleDraft`, or `result`, so the real UI treats completed jobs as failure.
- Secondary blocker: role generation failure path updates `role_drafts.status='failed'` and leaves the row, while the spec scenario expects failed jobs to be cleaned without generation events.

## 2026-05-29T09:38:31.6874542+08:00 Wave 5 oracle review
- REJECTED: required check:all fails because events:check treats MCP tool literal room.delegate as an event and reports it missing from the canonical registry.
- Delegate rollback path manually deletes task events by room/type, which can erase unrelated durable replay history after a failed delegation; rely on transaction rollback instead.
- Delegated completion event is published outside the task status transaction, and delegated status activities emit task.activity.added without task_activities inserts.
- Timeout sweep returns leader wake intents but daemon timer ignores them, so stale task blocking does not actually WakeAgent.

## Wave 6 Oracle Gate Re-Review 2 (2026-05-29)

- Rejected after payload-fix review. Key blockers: run collaboration fields are lost because projector replaces `RunViewModel` on later lifecycle events that omit `taskId`/`parentRunId`; team dispatch projector/test reads `payload.runId` but producer emits `payload.leaderRunId` plus envelope `runId`; task.created tests still include fields not emitted by `TaskService.createInTransaction`; `pnpm.cmd typecheck` fails in reviewed orchestrator files.
- GitNexus MCP was unavailable (`Not connected`), so review relied on direct file inspection, LSP diagnostics, and TypeScript typecheck.

## F1 Plan Compliance Audit (2026-05-29)

- REJECTED: `pnpm.cmd typecheck` fails despite `pnpm.cmd test`, `pnpm.cmd check:all`, `pnpm.cmd lint`, and OpenSpec strict passing.
- Blocking areas: daemon/native-runtime type incompatibilities (`NativeManagedAdapter.disposeAllRuns`, missing `TaskService.read`, `DaemonApp.lifecycle`, AI SDK provider `.chatModel`, `createOpenAICompatible` missing `name`, permission resource/failure-class typing, partial EventBus test mocks).
- Evidence written to `.sisyphus/evidence/final-plan-compliance.md`.

## 2026-05-29 - Final plan compliance audit 2

Verdict: REJECT. `pnpm.cmd test` failed in `packages/native-agent-runtime/test/provider-registry.test.ts` because `resolveProvider` calls `p.languageModel(...)` while the provider mocks/accepted task 2.1 contract expect `.chatModel(modelConfig.model)`. Also found missing `task-6.5-*` evidence even though task 6.5 is checked complete. Typecheck, lint, check:all, and OpenSpec strict passed; no blocking non-goal scope was found in registry/settings SSE/string AI SDK model checks.

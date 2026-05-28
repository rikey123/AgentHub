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

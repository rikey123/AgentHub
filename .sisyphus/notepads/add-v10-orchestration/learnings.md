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

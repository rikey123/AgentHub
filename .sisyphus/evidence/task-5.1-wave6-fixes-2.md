# Task 5.1 Wave 6 Fixes — Round 3 Evidence

Date: 2026-05-29

## Fixed
- Preserved run collaboration fields in `apps/web/src/hooks/useProjector.ts` by merging later `agent.run.*` lifecycle events into existing `RunViewModel` rows.
- Switched team dispatch projector handling to `payload.leaderRunId` for `team.dispatch.started/completed`.
- Updated `task.created` projector/test payload expectations to match `TaskService.createInTransaction()` emitted fields.
- Fixed orchestrator TypeScript issues in `packages/orchestrator/src/task-service.ts`, `packages/orchestrator/src/team-dispatch.ts`, and `packages/orchestrator/src/mcp/room-mcp-server.ts`.

## Verification
- `pnpm.cmd test -- packages/orchestrator packages/daemon apps/web` ✅
- `pnpm.cmd check:all` ✅
- `lsp_diagnostics` on modified files ✅ (no diagnostics)
- `pnpm.cmd typecheck` ❌ still fails in unrelated daemon/native-agent-runtime files outside this task scope
- `pnpm.cmd typecheck 2>&1 | Select-String "packages/orchestrator"` ✅ no orchestrator-specific errors

## Notes
- The workspace typecheck still reports pre-existing/unrelated issues in `packages/daemon` and `packages/native-agent-runtime`.

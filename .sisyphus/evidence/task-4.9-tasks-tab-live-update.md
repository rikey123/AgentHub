# Task 4.9 evidence — Tasks tab live projector view

## Scope

- Upgraded `apps/web/src/components/panels/TasksPanel.tsx` to the V1.0 task list view fed entirely by the `tasks` projector prop from `SidePanel`.
- Grouping is fixed to V1.0 statuses: Backlog (`pending`), In Progress (`in_progress`), Blocked (`blocked`), Review (`review`), Done (`completed`, `cancelled`).
- Each task row renders priority chip, title, assignee role/agent label, status badge, and computed updated timestamp from task activities/delegations.
- No drag/drop, search/filter, agent grouping, SQLite access, or `useProjector.ts` changes were introduced.

## Test evidence

- Added `apps/web/src/components/panels/TasksPanel.test.tsx` with projector-shaped fixtures asserting the V1.0 status grouping contract.
- Ran `pnpm.cmd test -- apps/web` twice after implementation.
- Final result: 49 test files passed; 362 tests passed; 1 skipped.

## Diagnostics / impact notes

- `lsp_diagnostics` on `TasksPanel.tsx`: no diagnostics.
- `lsp_diagnostics` on `TasksPanel.test.tsx`: no diagnostics.
- GitNexus impact was attempted for `TasksPanel` but the MCP returned `Not connected`, so no graph blast-radius report was available in this session.
- `pnpm.cmd --filter @agenthub/web build` remains blocked by pre-existing TypeScript errors in unrelated test/runtime/daemon/orchestrator files; the new TasksPanel files have clean LSP diagnostics and pass the required web tests.

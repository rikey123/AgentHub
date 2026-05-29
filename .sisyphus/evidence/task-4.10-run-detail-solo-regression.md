# Task 4.10 — Run Detail solo regression evidence

## Regression scope
- Existing non-squad/team Tools tab behavior is preserved: Tool calls and Subagent runs sections remain rendered exactly as before, with the collaboration section only added when team/squad mode or run/task context exists.
- Solo runs without task context return an empty collaboration model, so no task tree/sibling-run content is introduced.

## Verification
- `apps/web/src/components/run/tabs/ToolsTab.test.ts` includes `leaves solo runs without task context unchanged`.
- `pnpm.cmd test -- apps/web`: passed — 49 files, 362 passed, 1 skipped.
- `lsp_diagnostics` on `ToolsTab.tsx`, `ToolsTab.test.ts`, `RunDetailDrawer.tsx`, `App.tsx`, and `types.ts`: no diagnostics.

## Build note
- `pnpm.cmd --filter @agenthub/web build` still fails on pre-existing TypeScript issues outside this task's modified files, starting with `src/components/chat/TaskStatusCard.test.tsx(77,19)` and `src/hooks/useProjector.test.ts` event typing, plus backend workspace reference errors.

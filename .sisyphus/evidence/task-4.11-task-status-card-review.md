# Task 4.11 evidence — review-ready TaskStatusCard

## What changed

- `team.dispatch.started` projector briefs (`kind: dispatch_started`) now render as `TaskStatusCard` items in the main chat timeline.
- When room tasks contain review-state tasks, the card summary is computed as `N tasks ready for review`.
- The review-ready card uses assignee role `Team`, status `review`, and the same `View Task` action label.
- The review-ready action opens the side panel Tasks tab through `ChatStream` -> `App.openTasksPanel()`.

## Test coverage

- Added `apps/web/src/components/chat/TaskStatusCard.test.tsx` case: `creates a review-ready card from dispatch started brief and links to Tasks tab`.
- The test uses a projector-style `RoomViewModel` fixture with two review tasks and asserts the generated card summary is `2 tasks ready for review`.
- The test invokes the HeroUI button `onPress` prop and asserts the Tasks-tab callback is called exactly once.

## Verification

- `lsp_diagnostics` on modified files: no diagnostics.
- `pnpm.cmd test -- apps/web`: passed — 49 files, 362 passed, 1 skipped.
- `pnpm.cmd typecheck`: blocked by pre-existing out-of-scope daemon/native/orchestrator TypeScript errors, including `packages/native-agent-runtime/src/provider-registry.ts` and `packages/orchestrator/src/team-dispatch.ts`.
- `pnpm.cmd --filter @agenthub/web build`: blocked before Vite by pre-existing TypeScript errors in `apps/web/src/hooks/useProjector.test.ts` and workspace package sources; the new TaskStatusCard files have zero LSP diagnostics and are covered by passing web tests.

## GitNexus note

- Required pre-edit GitNexus impact analysis was attempted for `ChatStream`, `BriefItem`, and `App`, but the tool returned `Not connected` for each request.

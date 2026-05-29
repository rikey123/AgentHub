# Task 4.11 evidence — dispatch TaskStatusCard

## What changed

- Added `apps/web/src/components/chat/TaskStatusCard.tsx` using HeroUI `Card`, `Button`, and `Chip`.
- Updated `apps/web/src/components/chat/ChatStream.tsx` to build main timeline feed items from projector room state.
- `task.delegation.created` projector state is represented via `room.tasks[].delegations`, and each delegation now renders one `TaskStatusCard` with dispatch summary, assignee role, status, and a `View Task` action.
- Raw `task.activities` are intentionally ignored by the main timeline feed builder, so task activity spam does not appear in chat.
- `App.tsx` wires `View Task` to open the side panel Tasks tab without modifying `apps/web/src/hooks/useProjector.ts`.

## Test coverage

- Added `apps/web/src/components/chat/TaskStatusCard.test.tsx` case: `creates a dispatch card from projector task delegation state`.
- Added `apps/web/src/components/chat/TaskStatusCard.test.tsx` case: `does not turn task activity rows into main timeline feed items`.

## Verification

- `lsp_diagnostics` on modified files: no diagnostics.
- `pnpm.cmd test -- apps/web`: passed — 49 files, 362 passed, 1 skipped.
- `pnpm.cmd typecheck`: blocked by pre-existing out-of-scope daemon/native/orchestrator TypeScript errors, including `packages/native-agent-runtime/src/provider-registry.ts` and `packages/orchestrator/src/team-dispatch.ts`.
- `pnpm.cmd --filter @agenthub/web build`: blocked before Vite by pre-existing TypeScript errors in `apps/web/src/hooks/useProjector.test.ts` and workspace package sources; the new TaskStatusCard files have zero LSP diagnostics and are covered by passing web tests.

## GitNexus note

- Required pre-edit GitNexus impact analysis was attempted for `ChatStream`, `BriefItem`, and `App`, but the tool returned `Not connected` for each request.

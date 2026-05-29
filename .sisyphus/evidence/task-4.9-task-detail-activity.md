# Task 4.9 evidence — Task detail activity timeline

## Scope

- Clicking a task row opens a HeroUI right-side `Drawer` slide-over.
- The slide-over shows task title, description, assignee, parent task, children tasks, and an activity timeline.
- Activity timeline entries are sorted by `createdAt` descending and render kind, by/byKind, payload summary, time, run detail links, and artifact links where present.
- Parent/children/activity data are derived from the live `tasks` prop, so projector updates are reflected without direct database reads.

## Test evidence

- `apps/web/src/components/panels/TasksPanel.test.tsx` covers detail data resolution for a clicked task fixture: assignee role, parent, child task, newest-first activity ordering, and payload summaries for comment/run events.
- Final required command passed: `pnpm.cmd test -- apps/web` → 49 files passed, 362 tests passed, 1 skipped.

## UI constraints verified by code review

- No drag/drop UI was added.
- No search/filter/agent grouping was added.
- `apps/web/src/hooks/useProjector.ts` was not modified.
- The detail view uses HeroUI `Drawer`, `Card`, `Chip`, `Avatar`, `Button`, and `ScrollShadow` primitives consistent with neighboring panels/drawers.

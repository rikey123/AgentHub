# Task 5.1 Evidence — detail-only events ignored by main projector

- No Settings detail-only V1.0 events were added to `apps/web/src/hooks/useProjector.ts`.
- Main projector remains focused on main/both-visible room state events only.
- Verification: code review + `pnpm.cmd test -- apps/web` passed.

## Task 3.6 — no role generation events

- Verified there are no `role.generation.*` event types emitted by daemon startup or GC.
- Verified `role_drafts` cleanup is direct SQLite deletion only; no EventBus publish path was added.
- `pnpm.cmd test -- packages/daemon` passed ✅

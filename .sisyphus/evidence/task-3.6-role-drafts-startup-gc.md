## Task 3.6 — role_drafts startup GC

- Added `packages/daemon/src/role-draft-gc.ts` with `cleanExpiredRoleDrafts(database, now)` and hourly GC startup/cleanup wiring.
- Daemon startup now clears expired drafts before boot continues.
- Daemon shutdown stops the hourly GC cleanup.
- Verified with `pnpm.cmd test -- packages/daemon` ✅

# Task 3.9 Evidence — Role draft expiry and generation-event absence

- Added focused daemon regression coverage in `packages/daemon/test/daemon.test.ts`.
- New test creates a role generation job under a fake clock, asserts `expires_at` is exactly seven days after creation, advances past expiry, runs `cleanExpiredRoleDrafts`, and verifies polling `GET /roles/generate/jobs/:jobId` returns `404 role_generation_job_not_found`.
- The same test asserts no `role.generation.*` rows exist in the durable events table after generation/GC.
- Existing daemon generation coverage still verifies create/poll/cancel flows and generated-role save events remain sanitized.

Verification:

```text
lsp_diagnostics packages/daemon/test/daemon.test.ts: No diagnostics found
pnpm.cmd test -- packages/daemon apps/web

Test Files  45 passed (45)
Tests       331 passed | 1 skipped (332)
```

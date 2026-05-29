# Task 3.7 Role Generation Job REST API — Complete

- Implemented `POST /roles/generate` with persistent `role_drafts` job storage and 7-day expiry.
- Implemented `GET /roles/generate/jobs/:jobId` and `DELETE /roles/generate/jobs/:jobId`.
- Extended `POST /roles` to emit `role.created` with `source: "ai_generated"` and `generationJobId` only.
- Verified `pnpm.cmd test -- packages/daemon` passes.

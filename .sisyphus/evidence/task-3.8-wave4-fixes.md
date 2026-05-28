# Wave 4 Oracle Fix Evidence

- Updated RoleGeneratorModal to read daemon job payloads from draftJson instead of draft/oleDraft/esult.
- Updated daemon failed-job cleanup to delete ole_drafts rows after marking failures, via inalizeFailedRoleGenerationJob.
- Updated tests to match real daemon payloads and verify failed draft cleanup.
- Verification: pnpm.cmd test -- packages/daemon apps/web ?

## Clean recap

- RoleGeneratorModal now reads `draftJson` from daemon job responses.
- Failed role generation jobs now delete their `role_drafts` row after marking failure.
- Tests were updated to use the real daemon response shape and to verify failed-row cleanup.
- Verification passed: `pnpm.cmd test -- packages/daemon apps/web`.


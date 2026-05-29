# Task 5.3 Evidence — v1-roadmap cleanup

- Updated `openspec/changes/add-v10-orchestration/specs/v1-roadmap/spec.md` so the V1.0 Squad / Team placeholder is recorded as already implemented.
- Kept V1.1+ Board / Timeline as placeholders; added explicit note that `GET /board` and `GET /timeline` remain `404 / not_found`.
- Added daemon regression coverage in `packages/daemon/test/daemon.test.ts` for `/board` and `/timeline` returning 404 with `{ error: "not_found" }`.
- Verification: `pnpm.cmd test -- packages/daemon` passed (`49` test files, `368` passed, `1` skipped).
- `openspec.cmd validate add-v10-orchestration --strict` could not be run because `openspec.cmd` is not present in this workspace.

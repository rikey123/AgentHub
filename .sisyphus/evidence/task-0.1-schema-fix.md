# Task 0.1 Schema Fix Evidence

## What changed
- Updated `packages/db/migrations/0014_v10.sql` to add the spec-required `roles`, `runtimes`, `model_configs`, `task_activities`, and `role_drafts` columns/indexes.
- Updated `packages/db/src/schema.ts` to match the corrected migration schema.
- Updated `packages/daemon/src/migrations/0014_data.ts` to seed the renamed/new columns safely.
- Updated `packages/daemon/test/daemon.test.ts` and `packages/db/test/sqlite.test.ts` for the renamed columns and required NOT NULL fields.

## Verification
- `pnpm.cmd test -- packages/db packages/daemon` ✅
- `pnpm.cmd schema:check` ✅
- `lsp_diagnostics` on modified TS files ✅
- `gitnexus_detect_changes` risk: low ✅

## Notes
- `roles.permission_profile_id` was replaced with `default_permission_profile_id`.
- `runtimes.manifest` became `manifest_json` and `supported_caps` was added.
- `task_activities` now uses `kind`, `by_kind`, and `by` with the spec CHECK constraints.

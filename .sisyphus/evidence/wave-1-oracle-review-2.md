# Wave 1 Oracle Gate Re-Review — add-v10-orchestration

## VERDICT: APPROVE

## Summary
The schema drift blockers from the first review are resolved. The corrected migration and Drizzle schema now expose the V1.0 foundation fields needed by Wave 2, and the data migration has been updated to write the renamed/new columns.

## Review findings

1. **Corrected tables now match the active capability specs closely enough for Wave 2.**
   - `roles` now has `avatar`, `tags`, `default_permission_profile_id`, `is_builtin`, and `idx_roles_workspace`.
   - `runtimes` now has `detected_path`, `detected_version`, `supported_caps NOT NULL DEFAULT '[]'`, `manifest_json NOT NULL`, and `idx_runtimes_workspace_kind`.
   - `model_configs` now has `name`, inference option fields, nullable key refs, and `idx_model_configs_workspace`.
   - `agent_bindings`, `role_drafts`, and `task_activities` now use the spec names needed by later API/UI work.

2. **Data migration remains correct after the renames.**
   - `migrateAgentProfilesToV10()` inserts into `default_permission_profile_id`, `manifest_json`, `supported_caps`, `name`, and `override_permission_profile_id`.
   - It still preserves `agent_profiles`, dedupes runtime/model config rows, creates one binding per profile, and backfills `room_participants.agent_binding_id` plus task assignee role/binding fields.
   - Focused data migration and legacy compatibility tests pass.

3. **Tests are meaningful for this gate.**
   - The DB test now checks migration application, V1.0 columns/indexes, no duplicate `tasks.priority`, Drizzle-vs-migration column drift, and Drizzle insert/select/delete smoke coverage.
   - It is not a full exact-SQL contract test, but it covers the drift class that caused the first rejection and is sufficient for Wave 1 approval.

## Verification run in this re-review

- `pnpm.cmd --filter @agenthub/db test -- sqlite.test.ts` — PASS, 18 tests.
- `pnpm.cmd schema:check` — PASS.
- `pnpm.cmd --filter @agenthub/daemon test -- daemon.test.ts -t "backfills v1.0 role/runtime/model config bindings"` — PASS.
- `pnpm.cmd --filter @agenthub/daemon test -- daemon.test.ts -t "resolves legacy agentProfileId|rejects unknown legacy agentProfileId"` — PASS.
- `pnpm.cmd test -- packages/db packages/daemon` — one unrelated existing daemon auth-token fetch test failed with `Error: bad port`; the Wave 1 schema/data-migration-focused tests above passed.

## Remaining notes for Wave 2

- `runtimes.status`, `model_configs.profile`, and `role_drafts.updated_at` are extra columns beyond some spec SQL sketches, but they are additive and do not block the data foundation APIs.
- The Drizzle schema cannot express all SQLite CHECK constraints, so migration-level constraints remain the authority for enum/value enforcement.

Wave 2 can proceed.

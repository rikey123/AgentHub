# Issues — add-v10-orchestration

## [2026-05-29T00:34:45Z] Session start
- No issues yet.

## Wave 1 Oracle review — 2026-05-29

- Gate verdict: REJECT. Main blocker is schema/spec drift in `0014_v10.sql` and `schema.ts`, not event registry or migration mechanics.
- Spec-required columns to recheck before Wave 2: `roles.avatar/tags/default_permission_profile_id`, `runtimes.detected_path/detected_version/supported_caps/manifest_json`, `model_configs.name/temperature/max_tokens/reasoning/extra`, `agent_bindings.override_permission_profile_id`, `task_activities.kind/by_kind/by`, and `role_drafts.failure_reason`.
- Passing evidence from review: `check:all`, db sqlite tests, bus event-bus tests, and daemon tests all pass; `task.updated` rejection is covered.

## Wave 2 Oracle review — 2026-05-29

- REJECTED due to ModelConfig delete conflict path deleting Keychain secret before returning 409. Fix by moving secret deletion after conflict handling and covering bound config with non-null api_key_ref.
- ModelConfig not-found handling is inconsistent with `get()` returning null; GET/PATCH/DELETE missing IDs can miss intended 404 behavior. Add not-found CRUD tests.
- Verification commands all passed: scoped tests, ai-sdk-provider:check, check:all.

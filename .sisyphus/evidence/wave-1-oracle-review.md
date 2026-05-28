# Wave 1 Oracle Gate Review — add-v10-orchestration

## VERDICT: REJECT

## Summary
Wave 1 has solid execution on event registration, idempotent profile backfill, the AI SDK string-model guard, and the legacy room-create compatibility path. The blocker is Task 0.1: the new schema only creates simplified tables and does not match the V1.0 capability data-model contracts that later waves depend on.

## Issues

1. **Task 0.1 schema does not align with the Role/Runtime/ModelConfig/AgentBinding specs.**
   - `roles` is missing spec fields such as `avatar`, `tags`, and `default_permission_profile_id` (implemented as `permission_profile_id`), plus the workspace/name index expected by the role-system spec.
   - `runtimes` is missing `detected_path`, `detected_version`, `supported_caps`, and `manifest_json` as required by runtime-settings; it instead has `version/status/manifest` with different semantics.
   - `model_configs` is missing `name`, `temperature`, `max_tokens`, `reasoning`, `extra`, and the workspace/provider index required by model-provider-settings.
   - `agent_bindings` is missing `override_permission_profile_id` from the agents spec.

2. **Task-related schema names do not match the task-workflow and role-generator contracts.**
   - `task_activities` uses `activity_type`, `actor_id`, and `actor_type`, but the V1.0 task-workflow spec requires `kind`, `by_kind`, and `by` with the activity-kind/by-kind checks and task-created index shape.
   - `role_drafts` uses `error`, while the role-generator spec names the failure field `failure_reason`; fixing this now avoids API and polling contract drift in Wave 3.

## Passing evidence / observations

- `0014_v10.sql` does keep `agent_profiles`, keeps `tasks.assignee_agent_id`, does not duplicate `tasks.priority`, adds `rooms.leader_role_id`, adds `room_participants.agent_binding_id`, and makes `model_configs.api_key_ref` nullable.
- `role_drafts.expires_at` and `idx_role_drafts_expires_at` exist; `roles.is_builtin` is an integer with default `0` and a migration-level boolean check.
- `migrateAgentProfilesToV10()` is idempotent by skipping when `roles` already has rows, dedupes runtimes/model configs, keeps migrated `api_key_ref` as NULL, and backfills participants/tasks.
- The registry has the 18 V1.0 events with expected durability/visibility, excludes `task.updated`, `task.deleted`, and `role.generation.*`, and the EventBus rejection test covers `task.updated`.
- The legacy room-create compatibility resolver is centralized in `packages/daemon/src/compat/agent-profile-compat.ts`; unknown legacy IDs are rejected before partial writes.

## Verification run

- `pnpm.cmd check:all` — passed; 6 custom checks, 115 registered event types, 100 durable events.
- `pnpm.cmd --filter @agenthub/db test -- sqlite.test.ts` — passed; 18 tests.
- `pnpm.cmd --filter @agenthub/bus test -- event-bus.test.ts` — passed; 23 tests.
- `pnpm.cmd --filter @agenthub/daemon test -- daemon.test.ts` — passed; 34 tests.

Wave 2 should not proceed until the schema contract is corrected, because CRUD/API work would otherwise either target non-spec columns or require another compatibility migration immediately.

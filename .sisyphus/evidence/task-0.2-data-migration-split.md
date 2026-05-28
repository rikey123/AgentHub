# Task 0.2 data migration split

- Implemented `packages/daemon/src/migrations/0014_data.ts` as an idempotent backfill helper.
- It converts `agent_profiles` into `roles`, deduplicated `runtimes`, deduplicated `model_configs` when provider/model exist, and `agent_bindings`.
- It backfills `room_participants.agent_binding_id` and `tasks.assignee_role_id` / `tasks.assignee_binding_id` without deleting `agent_profiles`.
- Hooked the helper into daemon startup after default agent seeding so built-in profiles are included.
- Added a regression test covering deduplication, backfill, and idempotent rerun behavior.
- Verification: `pnpm.cmd test -- packages/db packages/daemon`

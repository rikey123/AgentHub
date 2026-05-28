# Task 0.2 compatibility evidence

- `agent_profiles` remains intact and readable after migration.
- Room participants are backfilled to `agent_binding_id` using the profile id mapping.
- Tasks are backfilled to both `assignee_role_id` and `assignee_binding_id`.
- Migration is idempotent: rerunning the helper exits early once `roles` already contains rows.
- No API key material is written to SQLite for migrated `model_configs` rows.
- The repo does not have a TS migration runner; the one-time data backfill is performed from daemon startup.

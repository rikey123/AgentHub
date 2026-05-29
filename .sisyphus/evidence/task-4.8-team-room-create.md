# Task 4.8 Evidence ¡ª team room create
- POST /rooms with mode="team", leaderRoleId, and V1.0 participant shape succeeds.
- leader_role_id is persisted on rooms and leader bindings are resolved from agent_bindings.
- room.created event includes leaderRoleId in payload.
- Solo room creation remains compatible without leaderRoleId.

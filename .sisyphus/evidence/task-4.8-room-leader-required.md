# Task 4.8 Evidence ¡ª squad requires leaderRoleId
- POST /rooms with mode="squad" and no leaderRoleId returns 400.
- Response body: { error: "squad_mode_requires_leader_role_id" }.
- No room row is inserted for the rejected request.

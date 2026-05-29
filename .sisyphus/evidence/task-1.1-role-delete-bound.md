# Task 1.1 — Role delete blocked by bindings

- Scenario: delete a role with an existing `agent_bindings` row.
- Result: `DELETE /roles/:id` returns `409 { error: "role_has_bindings", bindingCount: 1 }`.
- Verified no `role.deleted` event was written.

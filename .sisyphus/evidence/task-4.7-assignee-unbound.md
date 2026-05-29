# Task 4.7 Evidence — assignee unbound

- Scenario: create task with `assigneeRoleId` that has no room binding.
- Result: failed with `validation_failed` and did not insert a task row.
- Coverage: `CreateTask rejects unbound assignee role` in `packages/orchestrator/test/orchestrator.test.ts`.

# Task 0.3 — Event registry matrix

Source of truth: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md`

Registered V1.0 events:

| type | category | durability | visibility |
|---|---|---|---|
| role.created | role | durable | detail |
| role.updated | role | durable | detail |
| role.deleted | role | durable | detail |
| runtime.detected | runtime | durable | detail |
| runtime.updated | runtime | durable | detail |
| runtime.removed | runtime | durable | detail |
| model_config.created | model | durable | detail |
| model_config.updated | model | durable | detail |
| model_config.deleted | model | durable | detail |
| agent_binding.created | binding | durable | detail |
| agent_binding.updated | binding | durable | detail |
| agent_binding.removed | binding | durable | detail |
| task.activity.added | task | durable | both |
| task.delegation.created | task | durable | both |
| task.delegation.completed | task | durable | both |
| team.dispatch.started | team | durable | both |
| team.dispatch.completed | team | durable | both |
| permission.run_summary | permission | durable | detail |

Verification target:
- `pnpm.cmd events:check`
- `pnpm.cmd visibility:check`

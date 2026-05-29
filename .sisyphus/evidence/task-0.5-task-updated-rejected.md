# Task 0.5 evidence: task.updated rejection

Command:
`pnpm.cmd events:check`

Temporary fixture used during verification:
- `packages/protocol/src/events/task-updated-rejected.fixture.ts` with `"task.updated"`

Output:
```
> agenthub@0.0.0 events:check C:\project\AgentHub
> node scripts/checks/events-check.mjs

events:check failed
- event 'task.updated' referenced from packages/protocol/src/events/task-updated-rejected.fixture.ts:1 but missing in event-system canonical registry
?ELIFECYCLE? Command failed with exit code 1.
```

Notes:
- The rejection proof passed because the checker scans source literals in `packages/` and `apps/`.
- The temporary fixture was removed after verification so the repository remains in the passing state.

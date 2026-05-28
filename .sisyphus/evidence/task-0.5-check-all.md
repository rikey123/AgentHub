# Task 0.5 evidence: check:all

Command:
`pnpm.cmd check:all`

Output:
```
> agenthub@0.0.0 check:all C:\project\AgentHub
> node scripts/checks/check-all.mjs


== ai-sdk-provider:check ==
ai-sdk-provider:check passed (107 files scanned)

== events:check ==
events:check passed (115 registered event types, 97 referenced in source)

== visibility:check ==
visibility:check passed (100 durable events with registered visibility)

== subscriptions:check ==
subscriptions:check passed (0 subscribes.ts files yet; skeleton-friendly validation active)

== command:check ==
command:check passed (28 canonical commands + mutating HTTP guard)

== run-state-machine:check ==
run-state-machine:check passed (1 lifecycle implementation files)

check:all passed (6 custom checks)
```

Notes:
- Confirms `ai-sdk-provider:check` is included in `check:all`.
- Confirms the custom checks still pass after V1.0 event registration.

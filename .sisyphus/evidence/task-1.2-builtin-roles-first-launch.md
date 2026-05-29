# Task 1.2 Evidence — Builtin roles first launch

## Implementation

- Added `packages/daemon/src/builtin-roles.ts` with `seedBuiltinRoles(database, rolesDir, eventBus, now)`.
- Wired daemon startup in `packages/daemon/src/index.ts` after EventBus creation so `role.created` events are published through the real bus.
- Added daemon tests proving first-launch seeding writes exactly five markdown templates and inserts five `roles` rows with `is_builtin = 1`.

## Test evidence

Command:

```powershell
pnpm.cmd test -- packages/daemon
```

Output:

```text
> agenthub@0.0.0 test C:\project\AgentHub
> vitest run --passWithNoTests "--" "packages/daemon"


 RUN  v4.1.7 C:/project/AgentHub


 Test Files  35 passed (35)
      Tests  284 passed | 1 skipped (285)
   Start at  03:09:01
   Duration  44.84s (transform 1.41s, setup 0ms, import 35.15s, tests 31.21s, environment 3ms)
```

## Covered assertions

- `archivist.md`, `builder.md`, `generalist.md`, `project-manager.md`, and `reviewer.md` are created in an empty roles directory.
- `builder.md` contains `version: 1.0.0` frontmatter.
- `roles` contains five builtin rows.
- `events` contains five `role.created` rows with `payload.isBuiltin = true`.

# Task 1.2 Evidence — Builtin role version warning

## Implementation

- Existing role files are never overwritten.
- Existing same/newer files are preserved silently.
- Existing older files are preserved and emit the required stderr warning:

```text
Builtin role 'builder' has an update; run `agenthub roles reset --id=builder` to overwrite
```

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

- A pre-existing `builder.md` with `version: 2.0.0` remains byte-for-byte unchanged.
- A pre-existing `builder.md` with `version: 0.9.0` remains byte-for-byte unchanged.
- The older-version path calls `process.stderr.write(...)` with the required update warning and does not block seeding.

# Task 6.1 — Typecheck fixed

## Verification
- `pnpm.cmd typecheck` ✅
- `pnpm.cmd lint` ✅
- `pnpm.cmd test` ✅

## Notes
- Fixed provider-registry exact-optional options and provider model invocation shape.
- Repaired daemon/native adapter permission and cleanup typing mismatches.
- Tightened test mocks and projector event helpers to the real SDK/event types.

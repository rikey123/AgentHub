## Task 2.5 — Codex stub contract

- `packages/adapters/codex/src/index.ts` still returns deterministic V1.x `notImplemented` failures.
- The codex package test continues to assert the 501 stub behavior.
- Daemon test coverage now checks the stub remains unchanged while native dispatch is wired.

# Task 5.2 Evidence: Codex still 501

- `packages/adapters/codex/src/index.ts` keeps CodexAdapter on the not-implemented path with the same V1.x stage message and capability contract.
- `packages/adapters/acp-base/test/acp-base.test.ts` now asserts the thrown error carries `status: 501` and `capability: "adapter-framework"` for Codex not-implemented helpers.
- `packages/daemon/test/daemon.test.ts` still asserts CodexAdapter throws the V1.x post-V1.0 message while Native dispatch remains functional.

## Task 2.2 — NativeAgentAdapter streaming

- Implemented `packages/native-agent-runtime/src/native-agent-adapter.ts`.
- Verified `pnpm.cmd test -- packages/native-agent-runtime` passes.
- Adapter streams text deltas, forwards tool call events, and finalizes completed runs with cost usage mapping.

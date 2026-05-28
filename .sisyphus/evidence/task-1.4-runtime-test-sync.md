# Task 1.4 Runtime Test Sync Evidence

- Implemented `POST /runtimes/:id/detect` in `packages/daemon/src/index.ts`.
  - Native runtimes detect as `detected_path = "agenthub-native"`, `detected_version = "native"`.
  - Custom ACP runtimes probe the configured command with `--version`, then configured args as fallback.
  - The route updates `detected_at`, `detected_path`, and `detected_version` and publishes `runtime.detected` only when persisted detection fields change.
- Implemented synchronous `POST /runtimes/:id/test` path.
  - Fast/native tests return `200 { ok, version, latencyMs }`.
  - No `runtime.test.result` event is published.
- Added daemon tests:
  - `detects runtime binaries and emits runtime.detected only for persisted changes`
  - `returns runtime test results synchronously without emitting runtime.test.result`

## Verification

- `lsp_diagnostics` on `packages/daemon/src/index.ts`: no diagnostics.
- `lsp_diagnostics` on `packages/daemon/test/daemon.test.ts`: no diagnostics.
- `pnpm.cmd test -- packages/daemon`: passed.

```text
Test Files  35 passed (35)
Tests       284 passed | 1 skipped (285)
```

## Notes

- `pnpm.cmd --filter @agenthub/daemon build` is not applicable because the selected package has no `build` script.

# Wave 2 Oracle Gate Re-Review — add-v10-orchestration

VERDICT: APPROVE

## Scope reviewed
- `packages/daemon/src/index.ts` model-config `GET /:id`, `PATCH /:id`, and `DELETE /:id` handling around lines 505-580.
- `getModelConfig()` and `testModelConfig()` null checks around lines 1501-1510.
- `packages/daemon/test/daemon.test.ts` regression coverage for bound delete conflict/keychain safety and missing model-config 404s.

## Findings
- `DELETE /model-configs/:id` now checks bindings inside the transaction, returns `409` before deleting the keychain secret, and only deletes `api_key_ref` after the row has actually been deleted. The regression asserts row remains, no `model_config.deleted` event is emitted, and the keychain delete mock is not called.
- Missing model-config reads now use `=== null` for `GET`, `PATCH`, `DELETE`, `getModelConfig()`, and `testModelConfig()`, matching the repository `get()` behavior.
- Regression tests cover nonexistent `GET/PATCH/DELETE` returning `404 model_config_not_found`.

## Verification
- `pnpm.cmd test -- packages/daemon packages/db packages/orchestrator` — passed: 35 test files, 286 passed, 1 skipped.
- `pnpm.cmd ai-sdk-provider:check` — passed: 109 files scanned.
- `pnpm.cmd check:all` — passed: 6 custom checks.

No blocking findings remain for the scoped Wave 2 model-config fixes. Wave 3 can proceed.
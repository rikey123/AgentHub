# Wave 2 Oracle Gate Review — add-v10-orchestration

VERDICT: REJECT

Wave 2 is close and the requested verification commands pass, but I found a blocker in the ModelConfig delete rejection path: deleting a bound model config can still delete its Keychain secret before returning `409`. That leaves the database row intact while its `api_key_ref` points to a missing secret, so Wave 3 should not proceed until fixed.

## Verification run

- `pnpm.cmd test -- packages/daemon packages/db packages/orchestrator` — PASS
  - 35 test files passed
  - 284 tests passed, 1 skipped
- `pnpm.cmd ai-sdk-provider:check` — PASS
  - 109 files scanned
- `pnpm.cmd check:all` — PASS
  - ai-sdk-provider, events, visibility, subscriptions, command, and run-state-machine checks passed

## Required checks

1. Write routes use transaction + publish for DB mutations — mostly PASS. Role/runtime/model-config/agent-binding create/update/delete write paths publish inside `database.sqlite.transaction(...)`; runtime detect does as well. The model-config conflict path has a non-SQL side effect outside the transaction, noted below.
2. `GET /model-configs` omits `api_key_ref` — PASS. `normalizeModelConfigRow` returns `api_key_fingerprint` but not `api_key_ref`.
3. `POST /model-configs` uses `KeychainBridge` instead of storing plaintext — PASS. It calls `ctx.modelConfigSecrets.set(keyRef, keyInput)` and stores only ref/fingerprint.
4. Native binding without `model_config_id` returns 400 — PASS. `createAgentBinding` returns `native_runtime_requires_model_config`.
5. DELETE with bindings/participants returns 409 with no event — PARTIAL/FAIL. Events are not emitted on conflicts, but `DELETE /model-configs/:id` can still delete the associated keychain secret on a 409.
6. `ai-sdk-provider:check` still passes — PASS.
7. Forbidden events `runtime.test.result` and `model_config.test.result` are absent — PASS. They are not registered in the event registry, runtime/model tests use REST/job polling.
8. Builtin templates match spec names — PASS: `project-manager`, `builder`, `reviewer`, `archivist`, `generalist`.

## Blocking findings

### 1. Bound ModelConfig delete removes the Keychain secret before returning 409

Evidence: in `packages/daemon/src/index.ts`, the `DELETE /model-configs/:id` route sets `conflict = true` inside the transaction when bindings exist, but after the transaction it unconditionally runs `ctx.modelConfigSecrets.delete(deletedRef)` before returning the 409 conflict response.

Impact: a rejected delete leaves the `model_configs` row and binding in SQLite, but can remove the OS keychain entry referenced by `api_key_ref`. Future model tests/native runtime use would fail despite the delete being rejected.

Required fix: only delete the keychain ref after confirming `conflict === false` and after the DB row was actually deleted. Add a regression test where a bound model config has a non-null `api_key_ref`, DELETE returns 409, no event is emitted, the row remains, and the keychain secret remains retrievable.

### 2. Missing ModelConfig IDs do not reliably return 404

Evidence: `get()` returns `null` when no row exists, but `getModelConfig()` checks `row === undefined`; similarly PATCH/DELETE model-config routes check `existing === undefined`. For missing IDs, this can flow into property access/normalization on `null` instead of returning the intended 404.

Required fix: standardize model-config not-found checks on `null` (or change `get()` to return `undefined` and update all callers deliberately). Add CRUD not-found tests for GET/PATCH/DELETE `/model-configs/:id`.

## Recommendation

REJECT Wave 2 for now. Fix the two ModelConfig rejection/not-found issues, rerun the three verification commands above, and repeat this gate before starting Wave 3.

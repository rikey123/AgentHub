# Task 1.8 — Secret leakage guard

## Guard added

`packages/daemon/test/daemon.test.ts` now asserts a fake API key is absent from:

- Model-config create/list/get response JSON.
- `model_config.%` event payload rows in SQLite.
- Relevant `model_configs` SQLite text columns returned by the API/data layer (`api_key_ref` and fingerprint metadata only, never plaintext).

The tests use fake keys only (`sk-ant-example-secret-key`, `sk-test-openai`, `sk-bad-secret`) and do not require real provider calls.

## Verification

```text
pnpm.cmd test -- packages/daemon packages/db packages/orchestrator

Test Files  35 passed (35)
Tests       284 passed | 1 skipped (285)
```

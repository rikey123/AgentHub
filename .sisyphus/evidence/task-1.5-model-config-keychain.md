# Task 1.5 Evidence — Model Config Keychain

- Implemented `GET /model-configs`, `POST /model-configs`, `GET /model-configs/:id`, `PATCH /model-configs/:id`, and `DELETE /model-configs/:id` in `packages/daemon/src/index.ts`.
- API responses return `api_key_fingerprint` only; `api_key_ref` is not exposed in responses.
- API keys are stored through `@agenthub/security` `KeychainBridge` using `createKeychain(...)` and `createKeychainAccount(...)`.
- SQLite stores only `api_key_ref` and `api_key_fingerprint` for non-local providers.
- Durable detail events emitted: `model_config.created`, `model_config.updated`, `model_config.deleted`.
- Verified with `pnpm.cmd test -- packages/daemon`.

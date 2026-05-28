# Task 1.5 Evidence — Ollama Model Configs

- Ollama/local provider flow stores `api_key_ref = NULL` and `api_key_fingerprint = NULL`.
- Tested create/list/get behavior for `provider: "ollama"` without API key input.
- Confirmed no plaintext API key is returned by the daemon responses.
- Verified no `model_config.deleted` event is emitted when delete is blocked by existing `agent_bindings`.

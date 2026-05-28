# Task 3.4 — Models Ollama evidence

- Ollama is treated as a local provider with no API key: the add/edit dialog hides the API key input for `provider=ollama` and `providerNeedsApiKey("ollama")` returns false.
- `buildModelConfigPayload()` omits `apiKey` for Ollama even if a stale key string is present in form state.
- Ollama payloads include `baseUrl`; when the user leaves it blank the UI sends the documented default `http://localhost:11434/v1`, and custom baseURL values are preserved.
- Ollama rows display `No API key` in the fingerprint area rather than a secret field.

Verification:

- `apps/web/src/components/settings/ModelsTab.test.ts` covers Ollama no-key/default-baseURL behavior and REST-only model test polling.
- `pnpm.cmd test -- apps/web`: 43 files passed, 320 tests passed, 1 skipped.

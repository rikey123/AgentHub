# Task 3.4 — Models fingerprint evidence

- Implemented `apps/web/src/components/settings/ModelsTab.tsx` and wired it into the existing Models tab slot in `SettingsModal.tsx`.
- Model configs are normalized from daemon REST payloads, grouped by provider, and displayed with name, model id, provider chip, and `api_key_fingerprint` only.
- Saved API keys are never stored in component state after save responses; create/update helpers normalize only the returned `modelConfig` fingerprint fields and tests assert the plaintext key is absent from saved UI data.
- Reset key uses `PATCH /model-configs/:id` with a new `apiKey` payload and does not read back or display the old key.
- Test Model Call uses `POST /model-configs/:id/test` and polls `GET /settings/jobs/:jobId` for `202` responses. No EventSource/EventBus path is used.

Verification:

- `lsp_diagnostics` on `ModelsTab.tsx`, `SettingsModal.tsx`, `ModelsTab.test.ts`, and `SettingsModal.test.ts`: no diagnostics.
- `pnpm.cmd test -- apps/web`: 43 files passed, 320 tests passed, 1 skipped.
- `pnpm.cmd --filter @agenthub/web build`: Settings-local errors fixed; command remains blocked by pre-existing native-runtime/daemon TypeScript errors in `packages/daemon/src/adapters/registry.ts` and `packages/native-agent-runtime/src/*`.

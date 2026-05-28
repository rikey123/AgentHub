# Wave 4 Oracle Gate Review — add-v10-orchestration

VERDICT: REJECT

Wave 5 should not proceed yet. Most Settings REST-only and redaction contracts are in place, and the requested verification commands pass, but the real role-generation UI cannot consume the daemon's completed job shape.

## Verification commands

- `pnpm.cmd test -- packages/daemon apps/web` — PASS: 45 test files, 331 passed, 1 skipped.
- `pnpm.cmd check:all` — PASS: ai-sdk-provider, events, visibility, subscriptions, command, run-state-machine checks.

## Gate findings

### Blocker 1 — Role generator UI does not handle the daemon response shape

The daemon returns completed role generation drafts as `draftJson` from `roleGenerationJobResponse` (`packages/daemon/src/index.ts:1201-1217`). The UI normalizer only reads `draft`, `roleDraft`, or `result` (`apps/web/src/components/settings/RoleGeneratorModal.tsx:360-373`), then the modal only enters preview/save state when `completed.draft` exists (`RoleGeneratorModal.tsx:125-134`). With the real backend response, a completed job is treated as failure instead of showing the editable draft preview, so Task 3.8 is not actually working end-to-end.

The frontend test misses this because it mocks `job.draft`, not the daemon's `draftJson` shape.

### Blocker 2 — Failed generation jobs leave draft rows behind

The role-generator spec says failed generation should return failed and clean the `role_drafts` row without emitting events. The daemon failure path updates the row to `status = 'failed'` (`packages/daemon/src/index.ts:1175-1180`) and leaves it in `role_drafts` until cancel or GC. This violates the Wave 4 failure cleanup scenario.

## Specific checks requested

1. Settings modal does not subscribe to SSE/EventSource — PASS. `SettingsModal` bootstraps only `/roles`, `/runtimes`, `/model-configs`, `/agent-bindings` via `fetchSettingsBootstrap`, and tests spy that `EventSource` is not called.
2. `GET /model-configs` returns fingerprint only — PASS. `normalizeModelConfigRow` omits `api_key_ref` and includes `api_key_fingerprint` only.
3. Role generation does not emit `role.generation.*` events — PASS. Tests assert zero matching events, and the generation route does not call `eventBus.publish`.
4. `DELETE /roles/generate/jobs/:jobId` cleans up the draft row — PASS. It deletes from `role_drafts`; daemon tests assert the row is gone and subsequent GET is 404.
5. `POST /roles` with `generationJobId` emits `role.created` without original description/prompt — PASS. Event payload includes `roleId`, `workspaceId`, `source`, and `generationJobId` only.
6. 7-day expiry GC works — PASS for startup/helper coverage. Startup calls `cleanExpiredRoleDrafts`, hourly helper deletes expired rows, and tests verify expiry after `created_at + 7 days`.
7. Settings tabs are REST-only — PASS for implemented tab actions; however role generation's REST contract is mismatched as noted in Blocker 1.

## Required fixes before approval

1. Update the role generation UI normalizer to consume `draftJson` and `failureReason` from the daemon response, and add an integration/unit test using the real daemon response shape.
2. Align failed role generation cleanup with the spec: either delete the `role_drafts` row after surfacing the failed state deterministically, or adjust the documented contract before proceeding.

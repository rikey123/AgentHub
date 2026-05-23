
## 2026-05-23 M0.2 tooling baseline

- The Glob tool failed because `rg` is not available on PATH in this environment; PowerShell directory inspection was used for read-only workspace manifest discovery.
- JSON LSP diagnostics could not run because the environment config points JSON files at a missing `biome` binary. `pnpm lint`, `pnpm typecheck`, and frozen install still validated the edited JSON/config syntax.

## 2026-05-23 M0.3 protocol skeleton

- The environment still lacks `rg`, so Glob-based discovery fails; targeted reads and PowerShell metadata commands were used instead.
- JSON LSP diagnostics still fail because the configured Biome LSP binary is missing; TypeScript LSP diagnostics, lint, typecheck, schema check, and tests passed.

## 2026-05-23 M0.4 DB foundation

- pnpm 10 ignored the `better-sqlite3` native build script on first install, causing tests to fail with a missing `better_sqlite3.node` binding. The repo now allowlists `better-sqlite3` under `pnpm.onlyBuiltDependencies`; in this environment the binding was created by running `prebuild-install` from the dependency directory before rerunning tests.
- The environment still lacks `rg`, so direct Glob/Grep discovery fails. Use targeted reads or delegated exploration for broad repo/spec discovery until `rg` is available.

## 2026-05-23 M0.5 custom CI guardrails

- Direct Glob still fails because the environment has no `rg`; PowerShell was used only for read-only enumeration during implementation, while committed guard scripts remain cross-platform Node.
- Initial `repoRoot` derivation from `new URL(...).pathname` produced invalid Windows paths (`C:\C:\...`); use `fileURLToPath(import.meta.url)` for portable script roots.
- Broad prose scanning of all specs produces false positives for capability names (`context.read`), file names (`auth.ts`), and future/non-MVP examples. The committed `events:check` keeps strict source-code scanning while comparing the canonical event table directly against the executable registry.

## 2026-05-23 M1.1 EventBus base

- After adding workspace dependencies to `@agenthub/bus`, the first filtered test run could not resolve `@agenthub/db`; running `pnpm.cmd install` at the repo root refreshed workspace links and subsequent tests passed.
- `git status --short` currently reports the repository contents as untracked, so evidence should list touched paths explicitly rather than relying on Git to distinguish M1.1 changes from prior bootstrap files.

## 2026-05-23 M1.2 bus runtime slice

- Direct Glob/Grep remain unavailable because `rg` is missing; targeted reads and Node/PowerShell filesystem checks were used instead.
- Changing durable publish to outbox-deferred delivery required updating earlier EventBus tests that assumed immediate durable subscriber delivery.
- Guard tests must avoid literal forbidden command strings in implementation-scanned files; command-check now skips test files for production dispatch/forbidden-reference enforcement while package tests still verify runtime rejection.

## 2026-05-23 M1.3 Orchestrator run lifecycle

- Direct Grep/Glob still fail because `rg` is unavailable; targeted reads and package verification commands were used instead.
- Adding the new `@agenthub/orchestrator` workspace dependencies initially left filtered tests unable to resolve `@agenthub/bus`; `pnpm.cmd install` refreshed workspace links.
- `events:check` initially rejected `file.changed` because it only compared against event-system/spec.md. The check now adds adapter-framework's required `file.changed` event to the spec-derived expected set without weakening registry/source validation.

## 2026-05-23 M1.4 verification notes

- Package-local tests need explicit workspace dependencies in each package manifest; daemon tests import @agenthub/sdk and mock-adapter tests import @agenthub/bus/@agenthub/db directly.
- The command-check shell-out tests can exceed Vitest's 5s default once daemon/CLI/SDK files exist; the guard remains unchanged but those shell-out tests now use a 15s timeout.
- CLI smoke tests should suppress stdout during full test runs to avoid noisy JSON output while still exercising the in-process Mock Solo golden path.


## 2026-05-23 M2.1 Permission Engine

- Adding a new workspace dependency again required `pnpm.cmd install` to refresh local package links before filtered package tests could resolve `@agenthub/bus` from `@agenthub/permissions`.
- Permission ask timers must be cleared in tests (`PermissionEngine.close()`) before closing SQLite, otherwise pending timeout callbacks can fire against a closed `better-sqlite3` connection.
- With `exactOptionalPropertyTypes`, CLI/SDK call sites must omit absent optional fields rather than passing `{ key: undefined }`.

## 2026-05-23 M2.2 Context Ledger

- Adding `@agenthub/context` dependencies required `pnpm.cmd install` before filtered tests could resolve workspace packages.
- ESLint does not ignore underscore-prefixed unused parameters in this repo, so no-op interface implementations should `void` unused arguments explicitly.

## 2026-05-23 M2.3 Intervention Engine

- Adding the new `@agenthub/interventions` workspace package again required `pnpm.cmd install` before filtered tests could resolve local workspace dependencies from that package.
- Service methods that are useful in direct package tests should accept optional trace context; CommandBus meta always supplies `traceId`, but direct domain calls should not be forced to fabricate one.

## 2026-05-23 M3.1 Artifact primitives

- Adding @agenthub/artifacts workspace dependencies required pnpm.cmd install before filtered tests could resolve local workspace packages.
- Direct Glob remains unusable because g is missing; targeted reads and known-path inspection were used for implementation context.
- The M3 evidence directory did not exist before this task and was created at .sisyphus/evidence/agenthub-mvp/m3/.

## 2026-05-23 M4 Web UI blocker (RESOLVED)

- M4 visual-engineering session `ses_1ae12518fffevJl3ptVtuAoLKA` timed out twice at the 30-minute poll limit and reported no changed files both times. M4 was previously blocked on repeated delegated UI implementation timeout.
- This session resolved M4 directly: fixed `useProjector.ts` unregistered event reference (`agent.run.running`), Vitest config to exclude Playwright specs, SSE event handling, initial room fetch, test-server SSE cleanup, Playwright test timeouts, and pending-turn event seeding.
- All 3 Playwright E2E tests pass (main-detail-projection: 2 tests, pending-turn: 1 test). TypeScript typecheck, Vitest (125 tests), and lint (0 errors) all pass.
- `pnpm.cmd check:all` passes all 5 custom checks.
- eslint.config.js ignore patterns were updated from root-only `dist/**` to `**/dist/**` because `apps/web/dist/` was being linted and producing 1338 errors in generated assets.
- 4 real source lint errors were fixed: `let` -> `const` in `test-server.ts`, removed unused `AdapterNotImplementedError` from `acp-base.test.ts`, removed unused `emitAdapterConfigUpdated` and `CreateSessionInput` from `claude-code/src/index.ts`.

## 2026-05-23 M5 verification notes

- pnpm.cmd check:all still fails outside M5 because pps/web/src/hooks/useProjector.ts references unregistered event gent.run.running; M5 did not change UI/M4 scope, and M4 is already recorded as blocked. isibility:check, subscriptions:check, command:check, and un-state-machine:check passed in that run.
- Windows adapter/runtime smoke should execute discovered .cmd launchers via cmd.exe /c when using shell:false; otherwise spawnSync <path>.cmd reports EINVAL even when where detects the CLI.

## 2026-05-23 M5 verification notes correction

- The earlier M5 note about `pnpm.cmd check:all` failing is stale. After the M4 projector fix removed the unregistered `agent.run.running` reference, broad verification passed: `pnpm.cmd test`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd check:all`, `pnpm.cmd schema:check`, `pnpm.cmd build`, and `openspec.cmd validate add-agenthub-mvp --strict`.


## 2026-05-23 M6 verification notes

- Windows symlink creation can fail with EPERM in package tests unless developer-mode privileges are available; the security test still covers traversal/file/data URI behavior and conditionally asserts symlink escape classification when the platform allows creating the symlink.
- Adding @agenthub/security and new package dependencies required pnpm.cmd install to refresh workspace links before broad verification.
- pnpm.cmd lint flagged unnecessary regex character-class escapes in SecretRedactor patterns; removing the escapes preserved behavior and satisfied ESLint.

## 2026-05-23 F4 scope fidelity verification

- F4 targeted tests passed for orchestrator, artifacts, permissions, bus, security, daemon, V1 adapter stubs, check:all, OpenSpec strict validation, and web main/detail + pending-turn E2E.
- Final F4 verdict is REJECT, not because broad tests failed, but because raw stream scope fidelity is incomplete: EventBus has bounded `adapter_raw` stats/drop isolation, yet `replayDurableSinceSeq(view='raw')` returns `[]` and daemon `visible(..., view='raw')` returns false, so authorized raw SSE/Run Detail raw delivery is absent.
- Existing replay/projection coverage is deterministic and mostly sufficient for main/detail MVP, but no byte-identical seq=1 projection snapshot test exists; this is a secondary gap behind the raw-view blocker.

## 2026-05-23 Final approval gate

- F4 raw-view blocker was fixed and F4 rerun returned APPROVE. F1/F2/F3 had already returned APPROVE.
- The only remaining unchecked top-level items are F1-F4. The plan explicitly says to present consolidated results and wait for explicit user approval before marking them complete, so Atlas must not check them until the user says `okay`.

## 2026-05-23 P0-3 ACP crash race

- A fast ACP child exit can fire before `ClaudeCodeACPAdapter.runManaged()` handles `session.opened`, so the crash must be queued until AdapterBridge has moved the durable run to `running`; otherwise the run may remain running or the prompt path may throw against an already failed ACP session. ACP startup should also avoid overwriting a fast failed session back to ready.
- The real child-exit regression should spawn `process.execPath` rather than a PATH-dependent `node` command on Windows, and ACP base should listen to both `exit` and `close` while avoiding stdin writes after `exitCode` / `signalCode` / stream teardown so a fast process termination cannot be missed or masked.
- The stable real-exit regression should not exit immediately at process startup; waiting until the child reads the managed `session/prompt` JSON-RPC line proves the real child exit path after AdapterBridge has handled `session.opened`, while the separate early-crash test covers before-opened queueing.

## 2026-05-23 P1-3 workspace audit and evidence synchronization

### Dirty workspace report

- `M .sisyphus/notepads/agenthub-mvp/learnings.md` — belongs to completed/in-progress remediation evidence notes for P1-2; append-only history was restored after a temporary overwrite and P1-2 learnings were appended.
- `M .sisyphus/plans/agenthub-mvp-remediation.md` — belongs to remediation status synchronization for completed P0-3/P1-1/P1-2 and this audit lifecycle.
- `M apps/web/e2e/main-detail-projection.spec.ts` — belongs to completed P1-2 raw stream live UI coverage; adds admin-authorized raw SSE header/no-token-leak assertions and stdout/stderr rendering assertions.
- `M apps/web/src/components/RunDetail.tsx` — belongs to completed P1-2 raw stream UI; wires Raw Stream tab to the live raw hook and preserves non-admin/no-output placeholders.
- `M packages/adapters/claude-code/test/claude-code-adapter.test.ts` — belongs to completed P0-3 stabilization; real child-exit regression now parses JSON-RPC `session/prompt` instead of brittle raw substring matching.
- `?? apps/web/src/hooks/useRawStream.ts` — belongs to completed P1-2 raw stream UI; new fetch-based SSE reader that uses an Authorization header and parses live raw stdout/stderr events.

### OpenSpec validation

- `openspec.cmd validate add-agenthub-mvp --strict` passed: `Change 'add-agenthub-mvp' is valid`.

### Evidence inventory

- Existing evidence files under `.sisyphus/evidence/agenthub-mvp/`: `final/invariants.json`, `final/playwright-golden/summary.md`, `m0/index.md`, `m1/index.md`, `m2/index.md`, `m3/apply-rollback.json`, `m3/artifactfs-multi.json`, `m3/index.md`, `m4/main-detail/playwright-results.json`, `m4/pending-turn/playwright-results.json`, `m4/verification-summary.json`, `m5/acp-cancel.json`, `m5/claude-real-smoke.json`, `m6/csrf-origin-host.json`, `m6/index.md`, `m6/worktree-gc.json`.
- Missing remediation-specific evidence files for the new补救 tasks: P0-1 PendingTurn backend, P0-2 Task API/MCP chain, P0-3 Claude adapter runtime, P1-1 CommandBus idempotency evidence-only closeout, P1-2 Raw Stream live UI, and P1-3 workspace audit. Their current evidence is in plan status text, notepad notes, tests, and git diff rather than dedicated `.sisyphus/evidence/agenthub-mvp/remediation/` files.

### Constraints observed

- No dirty files were committed, stashed, discarded, or otherwise cleaned during this audit.
- No OpenSpec task checkboxes were modified.

## 2026-05-23 Claude adapter full-suite crash bridge stabilization

- The real child-exit crash regression can exceed Vitest's 5s default per-test timeout under the root suite even though the filtered package test passes. Keep the regression real, but wait for ACP session state, durable run failure, and agent.run.failed event together with an explicit per-test timeout and cleanup in finally.


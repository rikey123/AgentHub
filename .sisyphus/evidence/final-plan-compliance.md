# Final Plan Compliance Audit — add-v10-orchestration

VERDICT: REJECT

## Summary

The implementation cannot be approved against the OpenSpec task contract because the plan's final acceptance requires `pnpm.cmd typecheck` to pass, and a fresh typecheck fails in V1.0 implementation files. The requested verification commands `pnpm.cmd test`, `pnpm.cmd check:all`, and `pnpm.cmd lint` pass, but passing those commands is insufficient because OpenSpec task 6.1 and the Sisyphus plan Definition of Done explicitly include typecheck.

## Checkbox audit

- `openspec/changes/add-v10-orchestration/tasks.md`: PASS for checkbox state — all 50 numbered tasks are `[x]`.
- `.sisyphus/plans/add-v10-orchestration.md`: PASS for numbered implementation tasks — all 50 numbered tasks `0.1` through `6.6` are `[x]`.
- Final verification tasks `F1` through `F4` remain unchecked in the plan, which matches the plan's final-review workflow and was not modified by this audit.

## Major task group evidence

- 0.x infra/data migration/events/checks: evidence files exist for migration, data split/backfill, event registry, provider guard, check-all, and legacy agent-profile compatibility.
- 1.x role/runtime/model/binding data foundation: evidence files exist for CRUD, builtin roles, runtime detect/test, model keychain/test, binding validation, and data-foundation tests.
- 2.x Native Agent Runtime: evidence files exist for provider registry, adapter streaming/cancel, MCP tool conversion, permission cache/deny/read path, registry dispatch, and native integration tests.
- 3.x Settings UI + role generator: evidence files exist for Settings modal, Roles/Runtimes/Models tabs, deep links, role draft GC/no-events, generation API, UI save/cancel, and REST-only tests.
- 4.x Squad/Team/Task workflow: evidence files exist for delegate atomicity, squad/team flows, sibling gate, loop guards, activities, assignee resolution, leader-role rooms, Tasks tab, Run Detail, TaskStatusCard, and integration tests.
- 5.x modified capabilities: evidence files exist for projector replay/idempotency, Native real/Codex 501, and roadmap cleanup.
- 6.x final acceptance: evidence exists for test, lint, check-all, OpenSpec strict, browser QA handoff, and V1.1 planning. Evidence gaps remain for plan QA scenario artifacts `task-6.5-tasks-checkbox-audit.md`, `task-6.5-openspec-after-checkboxes.md`, and `task-6.6-v11-no-implementation.md`; more importantly, `task-6.1-typecheck-lint.md` does not prove typecheck passed.

## Verification run in this audit

- `pnpm.cmd test`: PASS — 49 test files passed; 368 tests passed, 1 skipped.
- `pnpm.cmd check:all`: PASS — ai-sdk-provider, events, visibility, subscriptions, command, and run-state-machine checks passed.
- `pnpm.cmd lint`: PASS — eslint completed with `--max-warnings=0`.
- `openspec.cmd validate add-v10-orchestration --strict`: PASS — change is valid.
- `pnpm.cmd typecheck`: FAIL — required by plan task 6.1 / Definition of Done.

## Blocking findings

1. `pnpm.cmd typecheck` fails in implementation files, so task 6.1 is not satisfied. Representative errors include:
   - `packages/daemon/src/adapters/registry.ts`: `disposeAllRuns` is referenced on `NativeManagedAdapter` but not present after the `Pick` type.
   - `packages/daemon/src/index.ts`: references `TaskService.read`, but `TaskService` does not expose that method.
   - `packages/daemon/src/index.ts`: returns `lifecycle` on `DaemonApp` even though the type does not declare it.
   - `packages/native-agent-runtime/src/provider-registry.ts`: current AI SDK provider types do not expose `.chatModel(...)`, and `createOpenAICompatible` is called without required `name`.
   - `packages/native-agent-runtime/src/native-agent-adapter.ts`: `model.api_call` permission resource and `permission_expired` failure class are not typed compatibly.
   - Native-runtime tests use partial `EventBus` mocks that are not assignable to `EventBus` under current strict typing.

2. The typecheck failure invalidates task/spec claims for Native Agent Runtime and final validation. Even though runtime tests pass, the code is not build/typecheck clean under the repository's declared acceptance contract.

3. Final acceptance evidence is incomplete for typecheck. `.sisyphus/evidence/task-6.1-typecheck-lint.md` records lint and LSP diagnostics, but not a successful `pnpm.cmd typecheck`; the fresh audit run proves typecheck currently fails.

## Scope / non-goal audit

- Forbidden event registry entries were not found: no registered `task.updated`, `task.deleted`, `role.generation.*`, `runtime.test.result`, or `model_config.test.result` events.
- Settings implementation did not show SSE consumption; EventSource references under Settings are test spies asserting no EventSource use.
- `pnpm.cmd check:all` confirms no string AI SDK model IDs are passed to `streamText` / `generateText` / `streamObject`.
- Deployment/cloud/multi-user/Tauri/Docker matches only pre-existing roadmap/stub documentation or existing artifact-stub behavior, not new V1.0 implementation scope.
- The V1.1 planning evidence mentions future `task.updated`, but no source registration/emission exists in the current V1.0 implementation.

## Required fixes before approval

1. Make `pnpm.cmd typecheck` pass without weakening TypeScript settings or hiding V1.0 files from the build.
2. Update task 6.1 evidence with a real passing typecheck run.
3. Add or update final 6.5 / 6.6 evidence artifacts, especially checkbox audit and no-V1.1-implementation proof.
4. Re-run `pnpm.cmd test`, `pnpm.cmd check:all`, `pnpm.cmd lint`, `pnpm.cmd typecheck`, and OpenSpec strict after fixes.

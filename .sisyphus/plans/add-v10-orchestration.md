# Add V10 Orchestration Implementation Plan

## TL;DR
> **Summary**: Implement OpenSpec change `add-v10-orchestration` exactly as `openspec/changes/add-v10-orchestration/tasks.md` defines it: V1.0 data foundation, native runtime, Settings UI, role generation, Squad/Team/Task workflow, cleanup, and final acceptance. This is contract-first work: freeze migration/API/event/task contracts before feature parallelization.
> **Deliverables**:
> - V1.0 migration + data migration + event registry + CI checks.
> - Role / Runtime / ModelConfig / AgentBinding backend APIs, settings UI, and role generator polling flow.
> - NativeAgentAdapter using Vercel AI SDK 5.x explicit providers with permission enforcement.
> - Squad/Team dispatch through canonical Task workflow, projector updates, Task UI, and run detail collaboration view.
> - OpenSpec strict, backend API tests, frontend integration/static checks, lint/typecheck/build/check-all evidence, staged Oracle gates, and a non-blocking browser QA handoff checklist.
> **Effort**: XL
> **Parallel**: YES - 8 waves, but shared contract files are serialized.
> **Critical Path**: Contract freeze + migration/event registry → data services/API → Native Runtime → Settings/role generator → canonical Task dispatch → UI/projector → final validation.

## Context

### Original Request
- User requested a detailed implementation plan for the current AgentHub iteration.
- The implementation source of truth is `C:\project\AgentHub\openspec\changes\add-v10-orchestration`.
- The plan must completely correspond to the OpenSpec tasks and must account for `C:\project\AgentHub\docs\agenthub-agent-workflow.md`.
- Prometheus only writes planning artifacts; no source implementation happens in this session.

### Interview Summary
- No further preference questions were needed because the active OpenSpec change decides the core tradeoffs.
- Default test strategy: tests-after / test-synchronous, matching the workflow manual's "tests or acceptance before/with implementation" rule.
- User review clarified verification emphasis: do not use Playwright during development because the tool is unstable in this environment; prioritize backend API tests, frontend-to-backend integration tests, component/state tests, and static checks. Browser testing is a later user activity, so implementation must only prepare a non-blocking handoff checklist and must not wait for user validation.
- User review clarified local workflow: true remote PRs are optional in this local repo; each milestone still needs a local PR-equivalent boundary and explicit Oracle review before merge/next milestone.
- User review clarified implementation discipline: uncertain framework/reference behavior must be resolved through docs or `C:\project\refrence` before inventing new approaches; frontend must visibly reflect backend-completed V1.0 features.
- The plan preserves one-to-one traceability to `tasks.md` items `0.1` through `6.6`, while reorganizing execution into dependency-aware waves.

### Research Summary
- Read: `openspec/changes/add-v10-orchestration/tasks.md`, `proposal.md`, `design.md`, selected capability specs, `docs/agenthub-agent-workflow.md`, package scripts, and representative code/test files.
- Existing transaction+publish pattern: `packages/daemon/src/commands.ts:58-107`, `packages/orchestrator/src/task-service.ts:78-107`, `packages/orchestrator/src/task-service.ts:120-123`.
- Event registry source of truth: `packages/protocol/src/events/registry.ts:65-163`; existing task events at `registry.ts:108-111`.
- Projector source of truth: `apps/web/src/hooks/useProjector.ts:189-240` and subsequent event switch handlers.
- Room MCP tools: `packages/orchestrator/src/mcp/room-mcp-server.ts:185-196`; current TaskService path: `packages/orchestrator/src/task-service.ts:66-163`.
- Daemon routing/wiring: `packages/daemon/src/index.ts:340-414`, startup wiring at `packages/daemon/src/index.ts:118-233`, adapter registry at `packages/daemon/src/adapters/registry.ts:34-209`.
- Existing UI surfaces already use HeroUI: `apps/web/src/components/panels/SidePanel.tsx:1-63`, `TasksPanel.tsx:1-62`, `RunDetailDrawer.tsx:1-84`, `TopBar.tsx:1-85`, `FeatureRail.tsx:1-62`.
- Existing verification: `package.json:12-29`, `turbo.json:3-24`, orchestrator tests, bus tests, and web unit/integration test surfaces.

### Metis Review (gaps addressed)
- Added authority order: active OpenSpec tasks/specs > design/proposal > workflow manual > existing conventions.
- Added hard guardrails for no role-draft EventBus events, no `task.updated` / `task.deleted`, no V1.x/deployment scope leakage, and SQLite mutation/event atomicity proof.
- Added single-owner serialization for central contract files: schema/migrations, event registry, daemon command/index wiring, projector, and room MCP server.
- Added executable acceptance criteria and evidence paths for every task.
- External review findings incorporated: upgraded `task.created`/`task.status.changed` projector requirements, clarified `permission.run_summary` read/display path, nailed down `room.delegate` transaction semantics, moved `role_drafts` into the initial schema contract, and adjusted QA/PR workflow emphasis.

### Oracle Review (gates incorporated)
- Contract-first sequencing is mandatory.
- Shared contract files must be edited by one owner at a time.
- Every mutation needs registered event proof inside the same SQLite transaction, except explicitly polling-only/test-only paths that must not emit events.
- Native runtime must prove deny-before-stream and no string model IDs before broader integration.
- Squad and Team must share one canonical Task creation/dispatch service path.

## Work Objectives

### Core Objective
Deliver V1.0 orchestration/product foundation exactly matching `openspec/changes/add-v10-orchestration/tasks.md`, without adding non-spec capabilities or weakening existing AgentHub contracts.

### Deliverables
- OpenSpec task coverage: `0.1` through `6.6`, represented as executable TODOs in this plan.
- Staged implementation branches/PRs, each with task/spec refs, owned files/modules, verification commands, risks, and Oracle gate outcome.
- Agent-executable QA evidence under `.sisyphus/evidence/` for every task and final review wave.

### Definition of Done (verifiable conditions with commands)
- `openspec.cmd validate add-v10-orchestration --strict` exits `0`.
- `pnpm.cmd test` exits `0`.
- `pnpm.cmd typecheck` exits `0`.
- `pnpm.cmd lint` exits `0`.
- `pnpm.cmd build` exits `0`.
- No development-time Playwright/browser E2E command is required; implementers only prepare a non-blocking browser acceptance checklist for later user testing.
- `pnpm.cmd check:all` exits `0` after `ai-sdk-provider:check` is included.
- `pnpm.cmd events:check`, `pnpm.cmd visibility:check`, `pnpm.cmd schema:check`, `pnpm.cmd subscriptions:check`, and `pnpm.cmd run-state-machine:check` exit `0`.
- All OpenSpec `tasks.md` entries for this change are checked `[x]` only after their implementation and verification evidence exists.

### Must Have
- One-to-one task/spec traceability to `openspec/changes/add-v10-orchestration/tasks.md:7-76`.
- Git workflow from `docs/agenthub-agent-workflow.md`: branch/worktree isolation, staged PRs, Oracle gate per major phase, no self-merge, no hidden unresolved risk.
- GitNexus pre-edit impact analysis for modified symbols per `AGENTS.md`, especially shared contracts.
- Every daemon-side state mutation writes SQLite and publishes the matching event inside the same `database.sqlite.transaction(...)` unless the spec explicitly says the path is REST/polling-only with no EventBus event.
- Settings UI is REST-only and does not subscribe to SSE.
- Role generation uses `role_drafts` + REST job polling; no `role.generation.*` events.
- Native Runtime uses explicit AI SDK provider instances; no string model IDs in `streamText` / `generateText` / `streamObject`.
- Squad and Team both create Tasks via one canonical dispatch path.
- Visibility `both` events are handled by `apps/web/src/hooks/useProjector.ts` and reconstruct after SSE replay.
- HeroUI is preferred for Settings modal, tabs, drawers/slide-overs, cards, chips, buttons, and empty/loading states.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- MUST NOT implement Deployment/static/zip/Tauri/responsive/Docker/War Room/A2A/Plugin/LangGraph/Memory/vector/BM25/Skill/full Kanban drag-drop/Topology/full external MCP management/cloud/multi-user/SaaS/mobile/marketplace.
- MUST NOT add `task.updated`, `task.deleted`, `role.generation.*`, `runtime.test.result`, or `model_config.test.result` event types.
- MUST NOT make Settings UI consume SSE/projector events.
- MUST NOT use Playwright or `pnpm.cmd test:e2e` during development unless the user explicitly changes this constraint; browser acceptance is user-run after implementation.
- MUST NOT store API keys in SQLite, event payloads, logs, screenshots, or evidence artifacts.
- MUST NOT copy multica code; only borrow patterns. AionUi code may be ported only where license notice and workflow review approve it.
- MUST NOT let multiple agents edit schema/migrations, event registry, daemon command/index wiring, projector, or room MCP server concurrently.
- MUST NOT bypass `RunLifecycleService`, `PermissionEngine`, `ArtifactFS`, `EventBus`, `CommandBus`, or existing auth/CSRF boundaries.

## Verification Strategy
> Development verification is agent-executed without Playwright; user browser testing is non-blocking and outside the implementation loop.
- Test decision: tests-after / test-synchronous, using Vitest/backend integration tests, frontend integration/component/state tests, OpenSpec strict, and repository checks.
- QA policy: Every task has agent-executed happy and failure/edge scenarios that avoid Playwright/browser automation.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}` for task evidence, plus `.sisyphus/evidence/final-*` for review wave output.
- UI verification evidence during development: frontend REST integration tests, component/state tests, projector tests, static assertions, and reviewer notes; no screenshots/traces are required from automation.
- Manual browser acceptance: implementers prepare a checklist for the user, then stop; do not wait for the user to run it and do not create a task that depends on immediate user testing.
- Command evidence: capture exit code and key output for each command listed in acceptance criteria.
- Security evidence: ensure API keys are redacted/masked and never written to durable events or evidence files.

## Execution Strategy

### Authority Order
1. `openspec/changes/add-v10-orchestration/tasks.md` and capability specs.
2. `openspec/changes/add-v10-orchestration/design.md` and `proposal.md`.
3. `docs/agenthub-agent-workflow.md`.
4. Existing repository conventions and implementation patterns.

### Stage / PR Gate Policy
- Each wave is a natural task package and should produce a branch/PR or local PR boundary.
- In this local repo, a real remote PR is optional; a PR-equivalent local review packet is mandatory and must include task numbers, spec refs, files changed, verification commands, risks/open questions, worktree notes, and reference notes when external projects were used.
- This plan file is itself an execution input. Before running `/start-work`, include `.sisyphus/plans/add-v10-orchestration.md` in the local review packet and, if this repo tracks planning artifacts, stage/commit it on the planning branch so executors do not work from an untracked or stale copy.
- Oracle gate required after every milestone/wave, not just selected waves. Do not proceed to the next core wave if Oracle requests changes.
- Each milestone review must check code logic, spec alignment, user-facing completion, test evidence, workflow hygiene, and whether the frontend exposes backend-completed functionality.
- Before each commit: `git status --short`, `git diff --check`, relevant tests/checks, and `gitnexus_detect_changes(scope="all", repo="AgentHub")`.

### Reference Implementation / Documentation Rule
- For unfamiliar framework behavior or reference-derived product patterns, executors must consult official docs and/or `C:\project\refrence` before implementation.
- If implementation borrows from AionUi, OpenCode, or multica, the local review packet must record exact reference paths and what was borrowed.
- If reference behavior conflicts with AgentHub OpenSpec, OpenSpec wins and the conflict is escalated instead of guessed around.

### Shared File Ownership Rules
- **Serialized single-owner files**: `packages/db/src/schema.ts`, `packages/db/migrations/*`, `packages/protocol/src/events/registry.ts`, `packages/daemon/src/commands.ts`, `packages/daemon/src/index.ts`, `apps/web/src/hooks/useProjector.ts`, `packages/orchestrator/src/mcp/room-mcp-server.ts`.
- **Parallel-safe zones after contract freeze**:
  - Backend data services/API owners: roles/runtimes/model-configs/bindings.
  - Native runtime owner: new `packages/native-agent-runtime/**` and adapter registry wiring after contract slots are prepared.
  - UI owner: `apps/web/src/components/settings/**`, task UI components, frontend integration/component tests after REST/event contracts are frozen.
  - Test/check owner: test files and check scripts after implementation contracts are stable.

### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave is allowed only for final/contract gates where serialization is safer than parallelism.

Wave 0: Preflight contract freeze and branch/worktree setup — applies to all tasks, no source implementation yet.
Wave 1: Infra + data foundation contracts — tasks 0.1-0.6, with 0.1/0.3 serialized first.
Wave 2: Role/Runtime/ModelConfig/AgentBinding backend — tasks 1.1-1.8.
Wave 3: Native Runtime backend — tasks 2.1-2.6.
Wave 4: Settings UI + Role Generator — tasks 3.1-3.9.
Wave 5: Squad/Team/Task backend core — tasks 4.1-4.8.
Wave 6: Task/projector/run-detail UI and workflow tests — tasks 4.9-4.12 and 5.1.
Wave 7: Modified capability cleanup — tasks 5.2-5.3.
Wave 8: Final automated acceptance, non-blocking manual QA checklist, and OpenSpec closure — tasks 6.1-6.6 plus final review wave.

### Dependency Matrix (full, all tasks)
- 0.1 blocks 0.2, 1.1-1.8, 3.6-3.7, 4.6-4.8; `role_drafts` is part of this initial schema contract.
- 0.3 blocks all event-emitting tasks and 5.1.
- 0.4 blocks 2.1-2.6 final acceptance and 6.2.
- 0.5 depends on 0.3 and 0.4.
- 0.6 blocks legacy room/API compatibility in 1.7, 4.8, and final migration acceptance.
- 1.1-1.7 block 1.8, 3.1-3.9, 4.7-4.8, and native runtime binding use.
- 1.5-1.6 block 2.1-2.6 and 3.7-3.8.
- 2.1 blocks 2.2 and 2.6.
- 2.2 blocks 2.3, 2.4, 2.5, 2.6, and role generation model calls.
- 2.4 blocks safe Native Runtime streaming acceptance.
- 3.1 blocks 3.2-3.5 and 3.8 UI integration.
- 3.6 blocks 3.7 and 3.9.
- 3.7 blocks 3.8 and 3.9.
- 4.1 blocks 4.2-4.5 and 4.12.
- 4.6 blocks 4.9, 4.10, 4.11, 4.12, and 5.1.
- 4.7 blocks 4.1-4.4 reliable dispatch and 4.9 UI assignee display.
- 4.8 blocks squad/team room flows and 4.12 integration/user-flow readiness.
- 5.1 depends on 0.3, 4.6, 4.9-4.11 event payload decisions.
- 5.2 depends on 2.5.
- 5.3 depends on 4.2-4.3 and 5.2.
- 6.1-6.4 depend on all implementation tasks.
- 6.5 depends on 6.1-6.4 success.
- 6.6 depends on known V1.0 closure risks from 6.1-6.5.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1: 6 tasks → deep (migration/contracts), quick (checks), unspecified-high (compat middleware).
- Wave 2: 8 tasks → deep (CRUD/event atomicity), quick (template/REST mechanical), unspecified-high (tests).
- Wave 3: 6 tasks → deep (runtime/security), quick (CI check), unspecified-high (integration tests).
- Wave 4: 9 tasks → visual-engineering + `heroui-integration` (UI), deep (role generator backend), unspecified-high (REST/frontend integration tests).
- Wave 5: 8 tasks → deep (state machine/dispatch), unspecified-high (room validation), quick (focused tests).
- Wave 6: 5 tasks → visual-engineering + `heroui-integration`, unspecified-high (projector/frontend integration tests).
- Wave 7: 2 tasks → quick / unspecified-high.
- Wave 8: 6 tasks → unspecified-high / writing / oracle review.

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task preserves OpenSpec task numbering and includes Agent Profile + Parallelization + QA Scenarios.

- [x] 0.1 Write migration `0014_v10.sql` — refs: `design/Migration Plan`

  **What to do**: Add schema migration for `roles`, `runtimes`, `model_configs`, `agent_bindings`, `role_drafts`, `rooms.leader_role_id`, `tasks.assignee_role_id`, `tasks.assignee_binding_id`, `tasks.delegation_chain`, `tasks.expects_review`, `room_participants.agent_binding_id`, and `task_activities`. Update Drizzle schema exports to match. Keep `tasks.priority` as the existing baseline column; keep `tasks.assignee_agent_id` for V0.5 compatibility.
  **Must NOT do**: Do not drop `agent_profiles`; do not add `tasks.workspace_id` if the spec says it is derived; do not add deployment/V1.x schema.

  **Recommended Agent Profile**:
  - Category: `deep` - SQLite migration + schema contract risk.
  - Skills: [] - no external UI/runtime skill needed.
  - Omitted: [`heroui-integration`] - backend-only task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 0.2, 1.1-1.8, 3.6, 4.6-4.8 | Blocked By: Wave 0 contract freeze.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:9` - exact migration fields.
  - Design: `openspec/changes/add-v10-orchestration/design.md:608-708` - canonical SQL sketch.
  - Role generator schema: `openspec/changes/add-v10-orchestration/specs/role-generator/spec.md:52-69` - `role_drafts` table and expiry index.
  - Current schema: `packages/db/src/schema.ts:11-149` - rooms, room_participants, agent_profiles, tasks baseline.
  - Event contract: `AGENTS.md` event-bus section - mutation/event atomicity.

  **Acceptance Criteria**:
  - [ ] `packages/db/migrations/0014_v10.sql` exists and applies to an empty DB.
  - [ ] `packages/db/src/schema.ts` exposes all new tables/columns and keeps deprecated compatibility columns.
  - [ ] Migration test verifies tables, indexes, `role_drafts` expiry index, `model_configs.api_key_ref` nullable, `roles.is_builtin`, and no duplicate `tasks.priority` ADD.
  - [ ] `pnpm.cmd test -- packages/db` exits `0`.
  - [ ] `pnpm.cmd schema:check` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: empty DB migrates to V1.0 schema
    Tool: Bash
    Steps: Create temp DB via createDatabase(applyMigrations=true); query sqlite_master and PRAGMA table_info for every V1.0 table/column including role_drafts.
    Expected: all required tables/columns/indexes exist; no migration error.
    Evidence: .sisyphus/evidence/task-0.1-v10-migration-empty.md

  Scenario: baseline priority column is not added twice
    Tool: Bash
    Steps: Run migration on baseline fixture with existing tasks.priority; query migration output and tasks columns.
    Expected: migration succeeds; exactly one priority column exists.
    Evidence: .sisyphus/evidence/task-0.1-v10-migration-priority.md
  ```

  **Commit**: YES | Message: `feat(db): add v10 schema migration` | Files: `packages/db/migrations/0014_v10.sql`, `packages/db/src/schema.ts`, DB tests.

- [x] 0.2 Write `0014_data.ts` data migration — refs: `agents/AgentProfile 数据模型（MODIFIED）`

  **What to do**: Add post-schema data migration that converts every `agent_profiles` row into one `roles` row, deduplicated `runtimes`, deduplicated `model_configs` where model data exists, and one `agent_bindings` row. Backfill `room_participants.agent_binding_id` and `tasks.assignee_role_id` / `tasks.assignee_binding_id`; mark schema/version metadata as V1.0 if such metadata exists.
  **Must NOT do**: Do not mutate or delete legacy `agent_profiles`; do not promise V0.5 daemon writes after upgrade; do not store API key material in SQLite.

  **Recommended Agent Profile**:
  - Category: `deep` - data migration + compatibility edge cases.
  - Skills: [] - backend migration only.
  - Omitted: [`browser-automation`] - no browser path.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 0.6, 1.7, 4.7, final compatibility tests | Blocked By: 0.1.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:10` - data migration requirement.
  - Design: `openspec/changes/add-v10-orchestration/design.md:710-721` - migration algorithm.
  - Agents spec: `openspec/changes/add-v10-orchestration/specs/agents/spec.md:50-61` - compatibility window and assignee fields.
  - Current schema: `packages/db/src/schema.ts:38-56`, `packages/db/src/schema.ts:132-149` - legacy agent/task fields.

  **Acceptance Criteria**:
  - [ ] `packages/db/migrations/0014_data.ts` or repo-standard equivalent runs after `0014_v10.sql`.
  - [ ] Fixture with multiple agent profiles sharing adapter/model deduplicates runtimes/model configs.
  - [ ] Existing rooms, room participants, tasks, runs, and messages remain readable after migration.
  - [ ] `pnpm.cmd test -- packages/db packages/daemon` exits `0` for migration compatibility tests.

  **QA Scenarios**:
  ```
  Scenario: legacy agent profiles split into four V1.0 concepts
    Tool: Bash
    Steps: Seed pre-V10 fixture with two agent_profiles, room_participants, and tasks; run migrations; query roles/runtimes/model_configs/agent_bindings/backfilled columns.
    Expected: each legacy profile has a role + binding; runtime/model rows dedupe; old rows remain.
    Evidence: .sisyphus/evidence/task-0.2-data-migration-split.md

  Scenario: migration preserves old rooms and task assignment compatibility
    Tool: Bash
    Steps: Query migrated room_participants.agent_binding_id and tasks assignee role/binding fields for old assigned tasks.
    Expected: every old participant/task that referenced an agent profile has compatible binding and role references.
    Evidence: .sisyphus/evidence/task-0.2-data-migration-compat.md
  ```

  **Commit**: YES | Message: `feat(db): migrate agent profiles to bindings` | Files: `packages/db/migrations/0014_data.ts`, migration tests.

- [x] 0.3 Register 18 V1.0 events in the canonical registry — refs: `event-system/事件分级（durable / ephemeral）`

  **What to do**: Update `packages/protocol/src/events/registry.ts` with all 18 V1.0 event types, categories, durability, visibility, and payload schemas where the repo convention requires schemas. Extend `EventCategory` for new categories (`role`, `runtime`, `model`, `binding`, `team`) if needed.
  **Must NOT do**: Do not register `task.updated`, `task.deleted`, `role.generation.*`, `runtime.test.result`, or `model_config.test.result`.

  **Recommended Agent Profile**:
  - Category: `quick` - mechanical registry update, high precision.
  - Skills: [] - no special skill.
  - Omitted: [`heroui-integration`] - no UI implementation.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: all event-emitting tasks, 5.1, 6.2 | Blocked By: Wave 0 contract freeze.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md:5-68` - exact event list and projector requirements.
  - Design: `openspec/changes/add-v10-orchestration/design.md:510-543` - registry delta table.
  - Current registry: `packages/protocol/src/events/registry.ts:4-20`, `packages/protocol/src/events/registry.ts:65-163`.

  **Acceptance Criteria**:
  - [ ] All 18 specified event types are in `EVENT_REGISTRY` with exact durability and visibility.
  - [ ] Forbidden event names are absent from registry and any code/test fixtures.
  - [ ] `pnpm.cmd events:check` exits `0`.
  - [ ] `pnpm.cmd visibility:check` exits `0`.
  - [ ] Unit test proves EventBus rejects `task.updated`.

  **QA Scenarios**:
  ```
  Scenario: registry accepts V1.0 event matrix
    Tool: Bash
    Steps: Run events/visibility checks and a Vitest case publishing each new event with minimal valid payload.
    Expected: every specified event validates with expected durability/visibility.
    Evidence: .sisyphus/evidence/task-0.3-event-registry-matrix.md

  Scenario: forbidden task.updated is rejected
    Tool: Bash
    Steps: Execute Vitest case calling EventBus.publish({ type: "task.updated" }).
    Expected: InvalidEventEnvelopeError or registry-not-found error; no events/outbox rows persist.
    Evidence: .sisyphus/evidence/task-0.3-event-registry-forbidden.md
  ```

  **Commit**: YES | Message: `feat(protocol): register v10 events` | Files: `packages/protocol/src/events/registry.ts`, event/check tests.

- [x] 0.4 Add `ai-sdk-provider:check` CI script — refs: `native-agent-runtime/NativeAgentAdapter 实现`

  **What to do**: Add a repo script that scans `packages/native-agent-runtime/**` and any AI SDK call sites for `streamText`, `generateText`, or `streamObject` usage with plain string model IDs or implicit gateway/default-provider patterns. Wire the script into `package.json`.
  **Must NOT do**: Do not hard-code provider API keys or call real providers in the check; do not block documented explicit providers.

  **Recommended Agent Profile**:
  - Category: `quick` - static check script.
  - Skills: [] - Node script only.
  - Omitted: [`browser-automation`] - no browser path.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 2.1-2.6 acceptance, 6.2 | Blocked By: none after contract freeze.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:12`.
  - Native runtime spec: `openspec/changes/add-v10-orchestration/specs/native-agent-runtime/spec.md:63-127`.
  - Package scripts: `package.json:12-29`.
  - External docs: `/vercel/ai/ai_5_0_0` shows `generateText({ model: createOpenAICompatible(...).chatModel(...) })` and `streamText` accepts a `LanguageModel`, tools, and `abortSignal`.

  **Acceptance Criteria**:
  - [ ] `package.json` has script `ai-sdk-provider:check`.
  - [ ] Script fails on fixture/case containing `streamText({ model: "openai/gpt-4o" })`.
  - [ ] Script passes explicit provider code using `createOpenAI*().chatModel(modelConfig.model)`.
  - [ ] `pnpm.cmd ai-sdk-provider:check` exits `0` on repo code.

  **QA Scenarios**:
  ```
  Scenario: explicit provider code passes
    Tool: Bash
    Steps: Run pnpm.cmd ai-sdk-provider:check after adding explicit provider registry fixtures.
    Expected: exit 0; report scanned files.
    Evidence: .sisyphus/evidence/task-0.4-ai-sdk-check-pass.md

  Scenario: string model ID fails
    Tool: Bash
    Steps: Run the check against a test fixture containing streamText({ model: "openai/gpt-4o" }).
    Expected: nonzero exit and message `plain string model ID detected`.
    Evidence: .sisyphus/evidence/task-0.4-ai-sdk-check-fail.md
  ```

  **Commit**: YES | Message: `chore(checks): add ai sdk provider guard` | Files: `scripts/checks/*`, `package.json`, tests/fixtures.

- [x] 0.5 Update `events:check` / `visibility:check` / `check:all` coverage — refs: `event-system/events:check 与 visibility:check CI 校验`

  **What to do**: Ensure existing event and visibility checks understand all V1.0 events and that `check:all` includes `ai-sdk-provider:check` plus existing checks. Verify 18 new events are accepted and forbidden events are rejected.
  **Must NOT do**: Do not weaken checks or add allowlists that bypass canonical registry.

  **Recommended Agent Profile**:
  - Category: `quick` - CI/check orchestration.
  - Skills: [] - scripts only.
  - Omitted: [`heroui-integration`] - no UI path.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6.2 | Blocked By: 0.3, 0.4.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:13`.
  - Package scripts: `package.json:14-28`.
  - Event spec scenarios: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md:44-68`.

  **Acceptance Criteria**:
  - [ ] `pnpm.cmd events:check` exits `0` with all V1.0 event names.
  - [ ] `pnpm.cmd visibility:check` exits `0` and confirms visibility for `both` task/team events.
  - [ ] `pnpm.cmd check:all` invokes `ai-sdk-provider:check` and exits `0`.
  - [ ] Negative fixture or test proves `task.updated` fails check.

  **QA Scenarios**:
  ```
  Scenario: full check suite includes V1.0 checks
    Tool: Bash
    Steps: Run pnpm.cmd check:all.
    Expected: output includes events, visibility, ai-sdk-provider, schema/subscription/run-state checks; exit 0.
    Evidence: .sisyphus/evidence/task-0.5-check-all.md

  Scenario: forbidden event remains blocked
    Tool: Bash
    Steps: Run events check against controlled fixture referencing task.updated.
    Expected: check fails with canonical registry error.
    Evidence: .sisyphus/evidence/task-0.5-task-updated-rejected.md
  ```

  **Commit**: YES | Message: `chore(checks): cover v10 event visibility` | Files: `scripts/checks/*`, `package.json`, check fixtures.

- [x] 0.6 Add compatibility middleware for legacy `agent_profile_id` inputs — refs: `agents/AgentProfile 数据模型（MODIFIED）`

  **What to do**: Add one HTTP/request normalization layer that resolves old `agent_profile_id` / `agentProfileId` inputs into `agent_binding_id` / `agentBindingId` for 3 months. Apply to room creation and other V0.5-compatible endpoints that still receive legacy profile ids. Include response compatibility where spec requires returning the new binding id while keeping old fields.
  **Must NOT do**: Do not scatter ad hoc profile resolution across handlers; do not write new `agent_profiles` rows; do not remove old `agent_profiles` table.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - request compatibility crosses daemon routes and commands.
  - Skills: [] - backend only.
  - Omitted: [`browser-automation`] - API tests sufficient here.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 1.7, 4.8, legacy acceptance | Blocked By: 0.2.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:14`.
  - Agents spec: `openspec/changes/add-v10-orchestration/specs/agents/spec.md:50-79`.
  - Daemon routes: `packages/daemon/src/index.ts:342-414`.
  - CreateRoom handler: `packages/daemon/src/commands.ts:32-113`.

  **Acceptance Criteria**:
  - [ ] Compatibility is centralized in one middleware/normalizer module or one route boundary.
  - [ ] `POST /rooms` with legacy `agentProfileId` succeeds when matching migrated binding exists.
  - [ ] Unknown legacy profile id returns deterministic 400/404 with no partial writes.
  - [ ] API test verifies response includes `agentBindingId` and legacy-compatible field where specified.

  **QA Scenarios**:
  ```
  Scenario: old room creation payload resolves to binding
    Tool: Bash
    Steps: Seed migrated legacy profile/binding; POST /rooms with agentProfileId; query room_participants.agent_binding_id.
    Expected: room created, participant points to binding, response includes new binding id.
    Evidence: .sisyphus/evidence/task-0.6-agent-profile-compat-success.md

  Scenario: unknown legacy profile is rejected atomically
    Tool: Bash
    Steps: POST /rooms with agentProfileId="missing"; query rooms before/after.
    Expected: 4xx response; no room/participant/event rows created.
    Evidence: .sisyphus/evidence/task-0.6-agent-profile-compat-fail.md
  ```

  **Commit**: YES | Message: `feat(daemon): resolve legacy agent profiles` | Files: `packages/daemon/src/index.ts`, `packages/daemon/src/commands.ts`, compatibility tests.

- [x] 1.1 Implement `roles` CRUD + REST API — refs: `role-system/Role 数据模型`

  **What to do**: Implement Role persistence/API for `GET /roles`, `POST /roles`, `GET /roles/:id`, `PATCH /roles/:id`, `DELETE /roles/:id`. Use REST-only settings data flow. Emit `role.created`, `role.updated`, and `role.deleted` as durable detail events inside the same SQLite transaction as writes. Reject deletion when `agent_bindings` references the role.
  **Must NOT do**: Do not bind roles to runtime/model; do not auto-overwrite builtins; do not add projector handling for detail-only role events.

  **Recommended Agent Profile**:
  - Category: `deep` - CRUD touches daemon write paths and event atomicity.
  - Skills: [] - backend API only.
  - Omitted: [`heroui-integration`] - no UI implementation here.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 1.8, 3.2, 3.8, 4.7 | Blocked By: 0.1, 0.3.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/role-system/spec.md:16-77`, `role-system/spec.md:104-129`.
  - Event spec: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md:13-15`.
  - Daemon route style: `packages/daemon/src/index.ts:342-414`.
  - Transaction pattern: `packages/daemon/src/commands.ts:58-107`.

  **Acceptance Criteria**:
  - [ ] REST endpoints return JSON shapes matching spec and never expose non-role data.
  - [ ] `POST/PATCH/DELETE /roles` write SQLite + publish matching detail event inside one transaction.
  - [ ] `DELETE /roles/:id` with bindings returns 409 `{ error: "role_has_bindings", bindingCount }` and emits no event.
  - [ ] `pnpm.cmd test -- packages/daemon packages/orchestrator` exits `0` for role API tests.

  **QA Scenarios**:
  ```
  Scenario: create and edit custom Role
    Tool: Bash
    Steps: POST /roles with name/prompt/capabilities, PATCH prompt, GET /roles/:id, query events table.
    Expected: role row updated; role.created and role.updated durable detail events exist; Settings client can use HTTP response.
    Evidence: .sisyphus/evidence/task-1.1-role-crud-happy.md

  Scenario: delete Role with existing binding is rejected
    Tool: Bash
    Steps: Seed role + agent_binding; DELETE /roles/:id; query roles and events.
    Expected: HTTP 409 role_has_bindings; role remains; no role.deleted event.
    Evidence: .sisyphus/evidence/task-1.1-role-delete-bound.md
  ```

  **Commit**: YES | Message: `feat(roles): add role crud api` | Files: `packages/daemon/src/index.ts`, role service/module, tests.

- [x] 1.2 Implement builtin Role templates on first launch — refs: `role-system/内置 Role 模板首启写入`

  **What to do**: Ship and bootstrap five builtin templates: `project-manager`, `builder`, `reviewer`, `archivist`, `generalist`. Write them into `~/.agenthub/roles/` on first launch when empty, insert/ensure matching builtin role rows, emit `role.created { isBuiltin: true }` for newly inserted rows, and warn to stderr when an existing template version is older without overwriting user edits.
  **Must NOT do**: Do not overwrite user-edited role files; do not block daemon startup on version warning; do not create more than the five specified templates.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - filesystem bootstrap + daemon startup events.
  - Skills: [] - backend only.
  - Omitted: [`browser-automation`] - no browser path.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 1.8, 3.2 | Blocked By: 1.1.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/role-system/spec.md:78-103`.
  - Daemon startup: `packages/daemon/src/index.ts:118-123`.
  - Current builtin profile concept: `packages/daemon/src/index.ts:6`, `packages/daemon/src/index.ts:122`.

  **Acceptance Criteria**:
  - [ ] First launch with empty roles directory creates exactly five `.md` templates and matching DB rows.
  - [ ] Existing newer/equal files are preserved.
  - [ ] Existing older version emits stderr warning and does not overwrite.
  - [ ] Startup test asserts `role.created` detail events for newly inserted builtin roles.

  **QA Scenarios**:
  ```
  Scenario: first launch writes five builtin roles
    Tool: Bash
    Steps: Start daemon with temp AGENTHUB_HOME; list roles dir; query roles and events.
    Expected: five template files, five builtin role rows, role.created events with isBuiltin true.
    Evidence: .sisyphus/evidence/task-1.2-builtin-roles-first-launch.md

  Scenario: old builtin version warns without overwrite
    Tool: Bash
    Steps: Seed builder.md with older version and custom content; start daemon; capture stderr and file content.
    Expected: warning mentions reset command; custom content unchanged; daemon starts.
    Evidence: .sisyphus/evidence/task-1.2-builtin-role-version-warning.md
  ```

  **Commit**: YES | Message: `feat(roles): seed builtin role templates` | Files: role bootstrap module, templates, daemon startup wiring, tests.

- [x] 1.3 Implement `runtimes` CRUD + detect on daemon startup — refs: `runtime-settings/Runtime 数据模型`

  **What to do**: Implement Runtime persistence/API for `GET/POST/PATCH/DELETE /runtimes`, daemon startup detection/UPSERT for `native-default`, `claude-code-default`, and `opencode-default` as applicable, and durable detail events `runtime.detected`, `runtime.updated`, `runtime.removed` for writes/detection. `native-default` is always present.
  **Must NOT do**: Do not put API keys in runtime env; do not remove old runtime rows just because PATH detection fails unless spec-defined delete occurs.

  **Recommended Agent Profile**:
  - Category: `deep` - startup detection + API + events.
  - Skills: [] - backend only.
  - Omitted: [`heroui-integration`] - no UI.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 1.4, 1.7, 2.5, 3.3 | Blocked By: 0.1, 0.3.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/runtime-settings/spec.md:14-78`.
  - Existing adapter detection patterns: `packages/adapters/claude-code/src/index.ts:63-76`, `packages/adapters/opencode/src/index.ts:65-67`.
  - Daemon startup: `packages/daemon/src/index.ts:118-163`.

  **Acceptance Criteria**:
  - [ ] `GET /runtimes` lists runtime rows sorted predictably.
  - [ ] Startup UPSERT creates `native-default` with manifest JSON and emits/records detection consistently.
  - [ ] DELETE rejects runtimes referenced by bindings.
  - [ ] `runtime.detected/updated/removed` are durable detail events.

  **QA Scenarios**:
  ```
  Scenario: native runtime is always registered
    Tool: Bash
    Steps: Start daemon in temp home; GET /runtimes; query events.
    Expected: native-default exists with kind native and runtime.detected audit event.
    Evidence: .sisyphus/evidence/task-1.3-runtime-native-default.md

  Scenario: deleting bound runtime is rejected
    Tool: Bash
    Steps: Seed runtime + agent_binding; DELETE /runtimes/:id; query rows/events.
    Expected: 409 runtime_has_bindings; runtime remains; no runtime.removed event.
    Evidence: .sisyphus/evidence/task-1.3-runtime-delete-bound.md
  ```

  **Commit**: YES | Message: `feat(runtimes): add runtime settings api` | Files: runtime service/routes/startup wiring/tests.

- [x] 1.4 Implement runtime detect/test APIs — refs: `runtime-settings/Runtime CRUD + Test API`

  **What to do**: Implement `POST /runtimes/:id/detect`, `POST /runtimes/:id/test`, and shared `GET /settings/jobs/:jobId` support for long-running runtime tests. Synchronous tests under 5s return direct result; longer tests return 202 job id and poll status every 500ms from UI.
  **Must NOT do**: Do not emit `runtime.test.result`; do not leave child processes open; do not run unapproved shell outside the runtime detect/test boundary.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - process/test job lifecycle.
  - Skills: [] - backend API only.
  - Omitted: [`heroui-integration`] - no UI.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 3.3, 3.9 | Blocked By: 1.3.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/runtime-settings/spec.md:79-103`.
  - Adapter detection references: `packages/adapters/claude-code/src/index.ts:63-76`, `packages/adapters/opencode/src/index.ts:65-67`.
  - Event non-goal: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md:32-38`.

  **Acceptance Criteria**:
  - [ ] `POST /runtimes/:id/detect` updates detect fields and emits `runtime.detected` only for persisted detection changes.
  - [ ] `POST /runtimes/:id/test` returns 200 result or 202 `{ jobId }` depending on duration.
  - [ ] `GET /settings/jobs/:jobId` returns terminal `completed` / `failed` status.
  - [ ] No `runtime.test.result` event exists in registry, events table, or SSE output.

  **QA Scenarios**:
  ```
  Scenario: synchronous runtime test returns result without event
    Tool: Bash
    Steps: POST /runtimes/native-default/test; query events for runtime.test.result.
    Expected: HTTP 200 ok result; no runtime.test.result event rows.
    Evidence: .sisyphus/evidence/task-1.4-runtime-test-sync.md

  Scenario: long custom runtime test uses job polling
    Tool: Bash
    Steps: Configure custom-acp test fixture with delayed handshake; POST test; poll GET /settings/jobs/:jobId.
    Expected: 202 then completed/failed terminal state; process cleaned up.
    Evidence: .sisyphus/evidence/task-1.4-runtime-test-job.md
  ```

  **Commit**: YES | Message: `feat(runtimes): add detect and test jobs` | Files: runtime routes/job service/tests.

- [x] 1.5 Implement `model_configs` CRUD + KeychainBridge storage — refs: `model-provider-settings/ModelConfig 数据模型`

  **What to do**: Implement ModelConfig persistence/API for `GET/POST/PATCH/DELETE /model-configs`. Write API keys to OS Keychain via existing KeychainBridge or approved local equivalent; store only `api_key_ref` and `api_key_fingerprint` in SQLite. Support `api_key_ref=NULL` for local providers such as Ollama and hide/omit key data in GET responses.
  **Must NOT do**: Do not store plaintext API keys in DB/events/logs/responses/evidence; do not require API key for Ollama; do not emit full prompt/key in events.

  **Recommended Agent Profile**:
  - Category: `deep` - secret handling + CRUD/event atomicity.
  - Skills: [] - backend/security only.
  - Omitted: [`browser-automation`] - browser testing is later/non-blocking; development tests avoid browser automation.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 1.6, 1.7, 2.1-2.6, 3.4, 3.7 | Blocked By: 0.1, 0.3.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/model-provider-settings/spec.md:17-92`.
  - Event spec: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md:19-21`.
  - Security review checklist: `docs/agenthub-agent-workflow.md:417-426`.

  **Acceptance Criteria**:
  - [ ] `GET /model-configs` returns fingerprint only, never API key.
  - [ ] `POST/PATCH` with API key writes keychain ref and fingerprint, emits detail event without key material.
  - [ ] Ollama/local provider accepts null key ref and null fingerprint.
  - [ ] Delete with bindings returns 409 and emits no delete event.

  **QA Scenarios**:
  ```
  Scenario: OpenAI config stores only key ref and fingerprint
    Tool: Bash
    Steps: POST /model-configs with fake key; GET /model-configs; query DB/events.
    Expected: no plaintext key in response, DB, or event payload; fingerprint present.
    Evidence: .sisyphus/evidence/task-1.5-model-config-keychain.md

  Scenario: Ollama config does not require API key
    Tool: Bash
    Steps: POST /model-configs provider=ollama without api key; GET row.
    Expected: 201; api_key_ref and fingerprint null; model_config.created detail event present.
    Evidence: .sisyphus/evidence/task-1.5-model-config-ollama.md
  ```

  **Commit**: YES | Message: `feat(models): add model config storage` | Files: model config service/routes/keychain bridge/tests.

- [x] 1.6 Implement model test API + settings jobs — refs: `model-provider-settings/ModelConfig CRUD + Test API`

  **What to do**: Implement `POST /model-configs/:id/test` and shared `GET /settings/jobs/:jobId` for model test calls. Use explicit provider resolution from model config and keychain, minimum prompt `Say 'ok'`, and direct result or job polling. Ensure test results do not enter EventBus.
  **Must NOT do**: Do not use string model IDs; do not emit `model_config.test.result`; do not call a real provider in unit tests without a mock server.

  **Recommended Agent Profile**:
  - Category: `deep` - provider call safety + secret handling.
  - Skills: [] - backend only.
  - Omitted: [`heroui-integration`] - UI later.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 2.6, 3.4, 3.9 | Blocked By: 1.5, 0.4.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/model-provider-settings/spec.md:93-117`.
  - Native provider spec: `openspec/changes/add-v10-orchestration/specs/native-agent-runtime/spec.md:63-127`.
  - Context7: `/vercel/ai/ai_5_0_0` explicit provider `createOpenAICompatible(...).chatModel(...)` pattern.

  **Acceptance Criteria**:
  - [ ] Model test uses explicit provider instance, never string model ID.
  - [ ] Success returns `{ ok: true, model, latencyMs, inputTokens, outputTokens }`.
  - [ ] Failure maps common errors (`invalid_api_key`, `model_not_found`, `rate_limited`) without leaking secrets.
  - [ ] No `model_config.test.result` events exist.

  **QA Scenarios**:
  ```
  Scenario: model test succeeds against mock provider
    Tool: Bash
    Steps: Start mock OpenAI-compatible server; POST /model-configs/:id/test; inspect response and events.
    Expected: ok true with token counts; no test result event.
    Evidence: .sisyphus/evidence/task-1.6-model-test-success.md

  Scenario: invalid API key failure is redacted
    Tool: Bash
    Steps: Mock provider returns auth failure; POST test; inspect response/log/event rows.
    Expected: ok false invalid_api_key; no plaintext key or authorization header in output/evidence.
    Evidence: .sisyphus/evidence/task-1.6-model-test-invalid-key.md
  ```

  **Commit**: YES | Message: `feat(models): add model test jobs` | Files: model test service/routes/jobs/tests.

- [x] 1.7 Implement `agent_bindings` CRUD + expanded GET — refs: `agents/AgentBinding CRUD API`

  **What to do**: Implement AgentBinding persistence/API for `GET/POST/PATCH/DELETE /agent-bindings`. Validate role/runtime/model_config references, require `model_config_id` for `runtime.kind='native'`, reject deletes referenced by `room_participants`, and expand GET rows with role/runtime/modelConfig summaries without API key plaintext.
  **Must NOT do**: Do not write new `agent_profiles`; do not allow native binding without model config; do not expose API key.

  **Recommended Agent Profile**:
  - Category: `deep` - joins, validation, compatibility.
  - Skills: [] - backend only.
  - Omitted: [`heroui-integration`] - UI later.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 1.8, 2.5, 3.1, 4.7, 4.8 | Blocked By: 1.1, 1.3, 1.5, 0.6.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/agents/spec.md:16-95`.
  - Migration task: `openspec/changes/add-v10-orchestration/tasks.md:24`.
  - Current room participants schema: `packages/db/src/schema.ts:23-36`.

  **Acceptance Criteria**:
  - [ ] `GET /agent-bindings` returns expanded role/runtime/modelConfig summaries.
  - [ ] Native binding without model config returns 400 `native_runtime_requires_model_config`.
  - [ ] CRUD emits `agent_binding.created/updated/removed` durable detail events.
  - [ ] Delete with room participant references returns 409 and emits no removed event.

  **QA Scenarios**:
  ```
  Scenario: create native AgentBinding with model config
    Tool: Bash
    Steps: Seed role/runtime/model_config; POST /agent-bindings; GET /agent-bindings.
    Expected: binding row created; expanded GET contains role/runtime/modelConfig fingerprint only; event emitted.
    Evidence: .sisyphus/evidence/task-1.7-agent-binding-native.md

  Scenario: native AgentBinding missing model config is rejected
    Tool: Bash
    Steps: POST /agent-bindings with runtimeId=native-default and no modelConfigId.
    Expected: HTTP 400 native_runtime_requires_model_config; no binding/event rows.
    Evidence: .sisyphus/evidence/task-1.7-agent-binding-native-reject.md
  ```

  **Commit**: YES | Message: `feat(agents): add agent binding api` | Files: binding service/routes/tests.

- [x] 1.8 Add data foundation unit tests — refs: `Role CRUD / bindings delete rejection / builtin templates / Runtime detect / ModelConfig keychain / AgentBinding three-layer assignee`

  **What to do**: Add/extend Vitest coverage for Role CRUD, bound-role delete rejection, builtin role first launch/version warning, runtime detect/test basics, ModelConfig keychain/fingerprint/no plaintext behavior, AgentBinding validation, and Task assignee role/binding compatibility scaffolding.
  **Must NOT do**: Do not duplicate tests that belong to frontend UI integration tasks; do not require real provider network calls.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - cross-feature test coverage.
  - Skills: [] - test implementation only.
  - Omitted: [`browser-automation`] - unit/integration tests only here.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Stage 1 Oracle gate | Blocked By: 1.1-1.7.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:25`.
  - Test pattern: `packages/orchestrator/test/orchestrator.test.ts:39-66` setup/teardown.
  - EventBus tests: `packages/bus/test/event-bus.test.ts:43-114` persistence/rejection style.

  **Acceptance Criteria**:
  - [ ] Tests cover all required happy and rejection paths listed in task 1.8.
  - [ ] Tests assert matching durable detail events for CRUD writes.
  - [ ] Tests assert no API key plaintext in DB/events/responses.
  - [ ] `pnpm.cmd test -- packages/daemon packages/db packages/orchestrator` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: data foundation unit suite passes
    Tool: Bash
    Steps: Run targeted Vitest packages covering roles/runtimes/model-configs/agent-bindings.
    Expected: all new tests pass; output lists coverage for required scenarios.
    Evidence: .sisyphus/evidence/task-1.8-data-foundation-tests.md

  Scenario: secret leakage guard fails if plaintext key appears
    Tool: Bash
    Steps: Run test that searches model_config response/event payloads for fake key.
    Expected: fake key absent from all persisted/returned payloads.
    Evidence: .sisyphus/evidence/task-1.8-secret-leakage-guard.md
  ```

  **Commit**: YES | Message: `test(settings): cover v10 data foundation` | Files: `packages/*/test/*`, daemon/db/orchestrator tests.

- [x] 2.1 Implement `packages/native-agent-runtime/src/provider-registry.ts` — refs: `native-agent-runtime/NativeAgentAdapter 实现`

  **What to do**: Create native runtime package provider registry using Vercel AI SDK 5.x explicit factories: `createOpenAI`, `createAnthropic`, `createGoogleGenerativeAI`, and `createOpenAICompatible`. Resolve `ModelConfig.provider/model/baseURL/apiKeyRef` into a concrete `LanguageModel` via provider `.chatModel(modelConfig.model)`. Support Ollama with default `http://localhost:11434/v1` and no real API key.
  **Must NOT do**: Do not pass plain string model IDs to AI SDK calls; do not implement Vercel gateway; do not make provider registration user-extensible beyond spec.

  **Recommended Agent Profile**:
  - Category: `deep` - external SDK integration and security guardrails.
  - Skills: [] - Context7 docs already identified.
  - Omitted: [`heroui-integration`] - backend runtime only.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 2.2, 2.6 | Blocked By: 1.5, 0.4.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/native-agent-runtime/spec.md:63-127`.
  - Design: `openspec/changes/add-v10-orchestration/design.md:121-203`.
  - Context7: `/vercel/ai/ai_5_0_0` explicit provider examples.
  - Check script: task 0.4.

  **Acceptance Criteria**:
  - [ ] New package/module exports typed provider resolution for all V1.0 providers.
  - [ ] Unit tests cover openai, anthropic, google, openai-compatible, ollama, and unsupported provider errors.
  - [ ] `pnpm.cmd ai-sdk-provider:check` exits `0`.
  - [ ] No string model IDs are passed to AI SDK calls.

  **QA Scenarios**:
  ```
  Scenario: provider registry returns explicit model instances
    Tool: Bash
    Steps: Run provider-registry unit tests with mocked factory functions for each provider.
    Expected: each provider factory is called with model config and returns provider.chatModel(modelConfig.model).
    Evidence: .sisyphus/evidence/task-2.1-provider-registry-explicit.md

  Scenario: unsupported provider fails closed
    Tool: Bash
    Steps: Call resolveProvider with provider="vercel-gateway" or unknown provider.
    Expected: deterministic unsupported-provider error; no gateway import or network call.
    Evidence: .sisyphus/evidence/task-2.1-provider-registry-unsupported.md
  ```

  **Commit**: YES | Message: `feat(native): add explicit provider registry` | Files: `packages/native-agent-runtime/**`, package manifests, tests.

- [x] 2.2 Implement `NativeAgentAdapter extends AgentRuntimeAdapter` — refs: `native-agent-runtime/NativeAgentAdapter 实现`

  **What to do**: Implement NativeAgentAdapter as the third real adapter with manifest `runtimeKind="native"`, `crashRecovery="restartable"`, streaming via `streamText`, tool calling, cost usage mapping, message deltas, session/open/end semantics through `AdapterBridge`, and AbortController cancellation. It must implement the same managed-run/cancel shape expected by `AdapterRegistry`.
  **Must NOT do**: Do not bypass `AdapterBridge`, `RunLifecycleService`, `PermissionEngine`, or `ArtifactFS`; do not add repo indexer/patch planner/web search/browser automation/memory.

  **Recommended Agent Profile**:
  - Category: `deep` - runtime lifecycle, adapter contracts, cancellation.
  - Skills: [] - backend runtime only.
  - Omitted: [`browser-automation`] - integration tests use backend/frontend harnesses, not browser automation.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 2.3, 2.4, 2.5, 2.6 | Blocked By: 2.1.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/native-agent-runtime/spec.md:17-61`, `native-agent-runtime/spec.md:115-140`.
  - Mock adapter bridge pattern: `packages/adapters/mock/src/index.ts:81-139`.
  - OpenCode managed adapter pattern: `packages/adapters/opencode/src/index.ts:69-104`.
  - Adapter registry managed shape: `packages/daemon/src/adapters/registry.ts:30-58`.

  **Acceptance Criteria**:
  - [ ] NativeAgentAdapter has manifest matching spec capabilities/reliability/context/workspace.
  - [ ] `runManaged(run)` opens session, streams deltas, calls tools, completes/fails/cancels through AdapterBridge/RunLifecycle.
  - [ ] `cancelManagedRun(runId)` aborts active stream and finalizes run as cancelled.
  - [ ] Cost usage maps to `agent.run.completed` cost fields.

  **QA Scenarios**:
  ```
  Scenario: NativeAgentAdapter completes a mock stream
    Tool: Bash
    Steps: Run unit test with mocked streamText yielding text and usage; inspect messages and run events.
    Expected: message.part.delta emitted, assistant message completed, agent.run.completed includes cost.
    Evidence: .sisyphus/evidence/task-2.2-native-adapter-stream.md

  Scenario: cancel aborts stream and finalizes run
    Tool: Bash
    Steps: Start mocked long stream; call cancelManagedRun; inspect AbortController and run status/events.
    Expected: abort called; agent.run.cancelled durable event; no further deltas.
    Evidence: .sisyphus/evidence/task-2.2-native-adapter-cancel.md
  ```

  **Commit**: YES | Message: `feat(native): implement native agent adapter` | Files: `packages/native-agent-runtime/**`, adapter tests.

- [x] 2.3 Implement MCP tool → AI SDK tool conversion — refs: `native-agent-runtime/NativeAgentAdapter 实现`

  **What to do**: Add a thin adapter translating AgentHub Room MCP tool definitions/calls into Vercel AI SDK `tools` entries without changing the MCP protocol. Wire tool execution through existing RoomMcpServer/session context and AdapterBridge tool events.
  **Must NOT do**: Do not alter MCP protocol semantics; do not bypass PermissionEngine for file/shell/tool actions; do not create Native-only tool duplicates.

  **Recommended Agent Profile**:
  - Category: `deep` - tool bridge and permission boundary.
  - Skills: [] - backend integration only.
  - Omitted: [`heroui-integration`] - no UI.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 2.6, role-generator tool use if any | Blocked By: 2.2.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:31`.
  - Room MCP server tools: `packages/orchestrator/src/mcp/room-mcp-server.ts:185-196`.
  - Existing tool bridge events: `packages/adapters/opencode/src/index.ts:120-124`, `packages/adapters/mock/src/index.ts:118-123`.
  - Native spec tool boundary: `openspec/changes/add-v10-orchestration/specs/native-agent-runtime/spec.md:21-27`.

  **Acceptance Criteria**:
  - [ ] AI SDK tool definitions are generated from existing Room MCP tools.
  - [ ] Tool calls emit `tool.call.requested` and `tool.call.completed` through AdapterBridge.
  - [ ] Tool errors surface as tool result errors without crashing the run unless fatal.
  - [ ] File/shell tools still go through existing permission/artifact boundaries.

  **QA Scenarios**:
  ```
  Scenario: room.list_tasks tool call returns data
    Tool: Bash
    Steps: Mock AI SDK tool call to room.list_tasks inside native run; inspect tool events and returned output.
    Expected: requested/completed events emitted; output matches TaskService list.
    Evidence: .sisyphus/evidence/task-2.3-mcp-tool-list-tasks.md

  Scenario: tool failure is reported without protocol mutation
    Tool: Bash
    Steps: Invoke unknown or invalid Room MCP tool through AI SDK adapter.
    Expected: tool result contains error; MCP server still returns standard tool-not-found shape.
    Evidence: .sisyphus/evidence/task-2.3-mcp-tool-error.md
  ```

  **Commit**: YES | Message: `feat(native): bridge mcp tools to ai sdk` | Files: `packages/native-agent-runtime/**`, Room MCP integration tests.

- [x] 2.4 Implement `model.api_call.<provider>` permission checks + run summary — refs: `native-agent-runtime/model.api_call 权限检查`, `permissions/审批粒度`

  **What to do**: Extend `PermissionResource` and evaluation logic for `model.api_call.<provider>` resources. In NativeAgentAdapter, perform permission check before provider/stream creation, cache decision per `(runId, modelConfigId)` for the run, fail deny before stream with `permission_denied`, and emit `permission.run_summary` on run terminal path. Define and implement the V1.0 read path for `permission.run_summary`: Run Detail Permissions tab MUST display the summary using detail SSE/projector state or a REST/audit endpoint feeding that tab. Debug/audit-only visibility is not acceptable under the current spec; if implementers want audit-only behavior, they must first change and validate the OpenSpec capability before coding.
  **Must NOT do**: Do not open `streamText` before permission allow; do not request permission repeatedly for same run/model; do not emit summary as main-visible event.

  **Recommended Agent Profile**:
  - Category: `deep` - security boundary and run lifecycle.
  - Skills: [] - backend/security only.
  - Omitted: [`heroui-integration`] - no UI.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 2.6, safe role generation | Blocked By: 2.2, 0.3.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/native-agent-runtime/spec.md:141-161`.
  - Permission spec: `openspec/changes/add-v10-orchestration/specs/permissions/spec.md:5-40`.
  - Event registry usage note: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md:30` - `permission.run_summary` is detail visibility and intended for Run Detail Permissions/audit.
  - PermissionEngine: `packages/permissions/src/index.ts:7-15`, `packages/permissions/src/index.ts:106-134`, `packages/permissions/src/index.ts:136-147`.
  - Event registry: `packages/protocol/src/events/registry.ts:120-121` existing permission events.

  **Acceptance Criteria**:
  - [ ] `model.api_call.openai|anthropic|google|openai-compatible|ollama` resources evaluate default allow.
  - [ ] Deny prevents provider instance and stream creation.
  - [ ] Same run/model config checks exactly once and reuses cached decision.
  - [ ] Run terminal emits `permission.run_summary` durable detail event with decisions.
  - [ ] Run Detail Permissions tab displays `permission.run_summary` decisions through detail SSE/projector state or a REST/audit endpoint.
  - [ ] Debug/audit-only access is rejected as incomplete unless an OpenSpec update is made and validated first.

  **QA Scenarios**:
  ```
  Scenario: deny-before-stream stops provider call
    Tool: Bash
    Steps: Configure deny rule for model.api_call.anthropic; run NativeAgentAdapter with spy on streamText/provider factory.
    Expected: streamText/provider factory not called; run failed permission_denied; permission.run_summary emitted.
    Evidence: .sisyphus/evidence/task-2.4-model-permission-deny-before-stream.md

  Scenario: same run/model permission is cached
    Tool: Bash
    Steps: Mock multi-step tool loop causing two model calls in same run/modelConfigId.
    Expected: PermissionEngine.check called once; no duplicate permission.requested.
    Evidence: .sisyphus/evidence/task-2.4-model-permission-cache.md

  Scenario: permission.run_summary is visible in Run Detail Permissions
    Tool: Bash
    Steps: Complete a native run with model decision; query the Run Detail Permissions data path via detail SSE/projector state or REST/audit endpoint used by that tab.
    Expected: permission.run_summary decisions are visible in Run Detail Permissions and remain detail-only; Debug/audit-only access without tab display fails acceptance.
    Evidence: .sisyphus/evidence/task-2.4-permission-run-summary-read-path.md
  ```

  **Commit**: YES | Message: `feat(permissions): guard native model calls` | Files: `packages/permissions/**`, `packages/native-agent-runtime/**`, tests.

- [x] 2.5 Register NativeAgentAdapter and auto-register `native-default` runtime — refs: `adapter-framework/Post-MVP Adapter Stub（MODIFIED）`

  **What to do**: Wire NativeAgentAdapter into AdapterRegistry as a real adapter, extend adapter/runtime id typing, daemon startup registration, cancel/dispose behavior, and `native-default` runtime availability. Keep Codex/LangGraph/A2A stubs unchanged and returning 501 where applicable.
  **Must NOT do**: Do not convert Codex/LangGraph/A2A to real implementations; do not make Native Runtime depend on external CLI.

  **Recommended Agent Profile**:
  - Category: `deep` - adapter registry and startup wiring.
  - Skills: [] - backend only.
  - Omitted: [`browser-automation`] - integration tests use backend/frontend harnesses, not browser automation.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 2.6, 5.2 | Blocked By: 1.3, 1.7, 2.2.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/adapter-framework/spec.md:5-25`.
  - Adapter registry: `packages/daemon/src/adapters/registry.ts:9-58`, `registry.ts:179-208`.
  - Daemon startup: `packages/daemon/src/index.ts:163-233`.
  - Runtime spec: `openspec/changes/add-v10-orchestration/specs/runtime-settings/spec.md:59-66`.

  **Acceptance Criteria**:
  - [ ] Native runtime id is classified and dispatched to NativeAgentAdapter.
  - [ ] `native-default` runtime exists after daemon startup.
  - [ ] Native run does not return 501.
  - [ ] CodexAdapter path still returns 501 with V1.x message.

  **QA Scenarios**:
  ```
  Scenario: native binding dispatches to NativeAgentAdapter
    Tool: Bash
    Steps: Create role/runtime/model/binding using native-default; enqueue run; spy AdapterRegistry dispatch.
    Expected: NativeAgentAdapter.runManaged called; no mock/opencode/claude fallback.
    Evidence: .sisyphus/evidence/task-2.5-native-registry-dispatch.md

  Scenario: Codex remains stub
    Tool: Bash
    Steps: Attempt Codex runtime/adapter run through supported stub path.
    Expected: 501 with capability adapter-framework and V1.x message.
    Evidence: .sisyphus/evidence/task-2.5-codex-stub.md
  ```

  **Commit**: YES | Message: `feat(daemon): register native adapter` | Files: `packages/daemon/src/adapters/registry.ts`, daemon startup/runtime wiring, tests.

- [x] 2.6 NativeAgentAdapter integration tests — refs: `native-agent-runtime/NativeAgentAdapter 实现`

  **What to do**: Add integration tests for NativeAgentAdapter Solo Run with streaming, tool calling, permission ask/deny, cancel, cost reporting, and explicit provider check. Use mock AI SDK/provider servers; no live network credentials.
  **Must NOT do**: Do not require real OpenAI/Anthropic/Google keys; do not skip permission/cancel failure cases.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - cross-package integration test suite.
  - Skills: [] - backend integration tests.
  - Omitted: [`heroui-integration`] - no UI.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Wave 3 Oracle gate, 3.7 role generator confidence | Blocked By: 2.1-2.5.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:34`.
  - Orchestrator test style: `packages/orchestrator/test/orchestrator.test.ts:68-180`.
  - Bus event assertions: `packages/bus/test/event-bus.test.ts:43-114`.
  - Native scenarios: `openspec/changes/add-v10-orchestration/specs/native-agent-runtime/spec.md:115-161`.

  **Acceptance Criteria**:
  - [ ] Integration test covers successful Solo Run with tool calling and cost.
  - [ ] Integration test covers permission ask/allow and deny-before-stream.
  - [ ] Integration test covers CancelRun abort path.
  - [ ] `pnpm.cmd test -- packages/native-agent-runtime packages/orchestrator packages/daemon` exits `0`.
  - [ ] `pnpm.cmd ai-sdk-provider:check` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: Native Solo Run with tool calling completes
    Tool: Bash
    Steps: Run integration test using mocked AI SDK stream with tool call to room.list_tasks.
    Expected: run completed; tool events emitted; cost recorded; message brief available.
    Evidence: .sisyphus/evidence/task-2.6-native-solo-tool-call.md

  Scenario: CancelRun aborts Native stream
    Tool: Bash
    Steps: Run integration test with delayed stream; dispatch CancelRun; inspect run/events.
    Expected: AbortController triggered; agent.run.cancelled; no leaked active run.
    Evidence: .sisyphus/evidence/task-2.6-native-cancel-integration.md
  ```

  **Commit**: YES | Message: `test(native): cover native adapter integration` | Files: native/orchestrator/daemon tests.

- [x] 3.1 Implement Settings modal six-tab architecture + entry points — refs: `settings-ui/Settings Modal 六页一级架构`

  **What to do**: Build Settings modal using HeroUI modal/tabs/cards/buttons/loading states with tabs Roles, Runtimes, Models, Permissions, Workspace, MCP. Wire FeatureRail Settings icon, TopBar if needed, and Cmd+K `Open Settings`. On open, parallel fetch `GET /roles`, `/runtimes`, `/model-configs`, `/agent-bindings`; close aborts in-flight requests and clears local view state.
  **Must NOT do**: Do not add a route that replaces the workbench; do not subscribe to SSE; do not change backend contracts for UI convenience.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - cross-surface UI and UX consistency.
  - Skills: [`heroui-integration`] - Settings modal should use shared HeroUI primitives.
  - Omitted: [`gitnexus-refactoring`] - no broad refactor requested.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 3.2-3.5, 3.8, 3.9 | Blocked By: 1.1, 1.3, 1.5, 1.7 contract freeze.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/settings-ui/spec.md:16-67`.
  - HeroUI rule: `.opencode/skills/heroui-integration/SKILL.md` - prefer HeroUI primitives.
  - Existing FeatureRail: `apps/web/src/components/shell/FeatureRail.tsx:3-17`.
  - Existing TopBar/Cmd button patterns: `apps/web/src/components/shell/TopBar.tsx:55-61`.
  - Existing HeroUI Tabs usage: `apps/web/src/components/panels/SidePanel.tsx:21-60`.

  **Acceptance Criteria**:
  - [ ] FeatureRail Settings opens modal defaulting to Roles.
  - [ ] Cmd+K command `Open Settings` opens modal.
  - [ ] Opening modal fetches required REST endpoints exactly once per open and uses loading skeletons.
  - [ ] Closing modal aborts pending requests and clears local state.
  - [ ] No Settings SSE/EventSource subscription is created.

  **QA Scenarios**:
  ```
  Scenario: Settings modal opens through FeatureRail and loads REST data
    Tool: Bash
    Steps: Run frontend component/integration test mounting workbench shell with mocked REST endpoints; trigger FeatureRail Settings action; assert tabs Roles/Runtimes/Models/Permissions/Workspace/MCP and REST request counts.
    Expected: modal state is visible in test DOM; six tabs present; REST requests made; no EventSource construction for Settings.
    Evidence: .sisyphus/evidence/task-3.1-settings-modal-open.md

  Scenario: Closing modal aborts in-flight REST requests
    Tool: Bash
    Steps: Run frontend integration test with delayed settings endpoint mocks; open modal; close via Escape/action; assert AbortController called and delayed responses do not update state.
    Expected: modal closes in component state; no stale state/error toast after delayed responses complete.
    Evidence: .sisyphus/evidence/task-3.1-settings-modal-abort.md
  ```

  **Commit**: YES | Message: `feat(web): add settings modal shell` | Files: `apps/web/src/components/settings/**`, shell/command palette files, frontend component/integration tests.

- [x] 3.2 Implement Roles tab — refs: `settings-ui/Roles tab`

  **What to do**: Add Roles tab showing builtin and user roles, search/list, selected role editor, create/edit/delete actions, builtin badge/protection banner, delete confirmation, and AI Generate entry point stub that opens the generator flow once task 3.8 lands. Use REST responses to update local state.
  **Must NOT do**: Do not wait for SSE `role.*` events; do not hide 409 delete errors; do not auto-save generated drafts.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - interactive settings UI.
  - Skills: [`heroui-integration`] - use HeroUI list/card/drawer/button/chip/modal primitives.
  - Omitted: [] - no backend skill needed.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 3.8, 3.9 | Blocked By: 3.1, 1.1, 1.2.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/settings-ui/spec.md:68-91`.
  - Role API spec: `openspec/changes/add-v10-orchestration/specs/role-system/spec.md:104-129`.
  - Existing HeroUI Cards: `apps/web/src/components/panels/TasksPanel.tsx:32-62`.

  **Acceptance Criteria**:
  - [ ] Roles tab lists roles sorted according to API result and shows builtin badge.
  - [ ] Create/edit/delete use `POST/PATCH/DELETE /roles` and update local state from response.
  - [ ] Builtin edit warning displays for `is_builtin=true`.
  - [ ] Delete with bindings displays 409 message and keeps role in list.

  **QA Scenarios**:
  ```
  Scenario: create and edit Role from Settings
    Tool: Bash
    Steps: Run frontend integration test for Settings > Roles with mocked POST/PATCH /roles; create role, edit prompt, save.
    Expected: role appears/updates without refresh; API calls succeed; no SSE dependency.
    Evidence: .sisyphus/evidence/task-3.2-roles-create-edit.md

  Scenario: bound Role delete shows 409 error
    Tool: Bash
    Steps: Run frontend integration test with DELETE /roles returning 409 binding error; trigger delete confirm.
    Expected: error message says role has bindings; role remains visible.
    Evidence: .sisyphus/evidence/task-3.2-roles-delete-bound.md
  ```

  **Commit**: YES | Message: `feat(web): implement settings roles tab` | Files: Settings Roles components and frontend integration tests.

- [x] 3.3 Implement Runtimes tab — refs: `settings-ui/Runtimes tab`

  **What to do**: Add Runtimes tab with runtime cards, detected status, inline editor for command/args/env, native runtime read-only card, Add Custom ACP action, Detect, and Test Connection. Support synchronous results and job polling.
  **Must NOT do**: Do not store model API keys in runtime env; do not emit or consume runtime test events; do not make native runtime configurable beyond spec.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - settings UI with async states.
  - Skills: [`heroui-integration`] - card/editor/button/spinner patterns.
  - Omitted: [] - backend already exists.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 3.9 | Blocked By: 3.1, 1.3, 1.4.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/settings-ui/spec.md:92-108`.
  - Runtime API spec: `openspec/changes/add-v10-orchestration/specs/runtime-settings/spec.md:79-103`.
  - Existing status chip patterns: `apps/web/src/components/shell/TopBar.tsx:46-53`.

  **Acceptance Criteria**:
  - [ ] Runtime cards show connected/missing/error status and version.
  - [ ] Custom ACP create/edit persists via REST and updates local state.
  - [ ] Test Connection handles 200 result, 202 polling, and failure result.
  - [ ] No `runtime.test.result` SSE/event is expected by UI.

  **QA Scenarios**:
  ```
  Scenario: runtime test success updates card
    Tool: Bash
    Steps: Run frontend integration test for Settings > Runtimes with mocked Test Connection success.
    Expected: loading spinner then Connected status; no SSE event needed.
    Evidence: .sisyphus/evidence/task-3.3-runtimes-test-success.md

  Scenario: custom runtime invalid command shows failure
    Tool: Bash
    Steps: Run frontend integration test adding Custom ACP with invalid command and mocked failure response.
    Expected: clear error message; card remains editable; no crash.
    Evidence: .sisyphus/evidence/task-3.3-runtimes-test-failure.md
  ```

  **Commit**: YES | Message: `feat(web): implement settings runtimes tab` | Files: Settings Runtime components and frontend integration tests.

- [x] 3.4 Implement Models tab — refs: `settings-ui/Models tab`

  **What to do**: Add Models tab grouped by provider, model config rows, Add Model dialog, API key masked input, fingerprint display, baseURL/profile support, reset key action, and Test Model Call with sync/job response handling.
  **Must NOT do**: Do not display full API key after save; do not write key to localStorage/sessionStorage; do not emit/consume model test events.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - sensitive settings UI.
  - Skills: [`heroui-integration`] - modal/cards/input/chip patterns.
  - Omitted: [] - backend already exists.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 3.8, 3.9 | Blocked By: 3.1, 1.5, 1.6.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/settings-ui/spec.md:109-125`.
  - Model API spec: `openspec/changes/add-v10-orchestration/specs/model-provider-settings/spec.md:62-117`.
  - Security workflow: `docs/agenthub-agent-workflow.md:417-426`.

  **Acceptance Criteria**:
  - [ ] Model configs grouped by provider and display fingerprint only.
  - [ ] Add/edit/reset key paths never reveal full key after save.
  - [ ] Ollama hides API key input and uses default/entered baseURL.
  - [ ] Test Model Call handles success/failure/job polling without EventBus.

  **QA Scenarios**:
  ```
  Scenario: API key saves and only fingerprint remains
    Tool: Bash
    Steps: Run frontend integration test adding OpenAI model with fake key; save; inspect rendered output and storage mocks.
    Expected: fingerprint visible; full fake key absent from DOM/storage/network logs after request body.
    Evidence: .sisyphus/evidence/task-3.4-models-fingerprint.md

  Scenario: Ollama model config has no key input
    Tool: Bash
    Steps: Run frontend integration test selecting provider Ollama; inspect fields; save without API key.
    Expected: no API key input required; model row appears with no fingerprint.
    Evidence: .sisyphus/evidence/task-3.4-models-ollama.md
  ```

  **Commit**: YES | Message: `feat(web): implement settings models tab` | Files: Settings Models components and frontend integration tests.

- [x] 3.5 Implement Settings URL deep link — refs: `settings-ui/Settings URL deep link`

  **What to do**: Support `?settings=roles|runtimes|models|permissions|workspace|mcp`. Opening Settings writes query param for current tab, closing removes it, and direct navigation opens modal on the requested tab.
  **Must NOT do**: Do not replace the workbench route; do not break room/event projector cursor behavior.

  **Recommended Agent Profile**:
  - Category: `quick` - focused URL state wiring.
  - Skills: [`heroui-integration`] - keep modal/tab behavior consistent.
  - Omitted: [] - no backend.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 3.9 | Blocked By: 3.1.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/settings-ui/spec.md:126-137`.
  - Projector cursor reset note: `apps/web/src/hooks/useProjector.ts:32-39` - avoid disrupting SSE target state.

  **Acceptance Criteria**:
  - [ ] Navigating to `/?settings=models` opens Settings on Models tab.
  - [ ] Tab changes update query param without page reload.
  - [ ] Closing Settings removes `settings` param and preserves current room/workbench state.
  - [ ] Invalid setting tab falls back to Roles.

  **QA Scenarios**:
  ```
  Scenario: direct deep link opens Models tab
    Tool: Bash
    Steps: Run router/state integration test initialized with `/?settings=models`.
    Expected: Settings modal open, Models tab selected, workbench behind remains mounted.
    Evidence: .sisyphus/evidence/task-3.5-settings-deeplink-models.md

  Scenario: close removes settings query param
    Tool: Bash
    Steps: Run router/state integration test opening Settings > Runtimes; close modal; inspect history/location state.
    Expected: settings param removed; no page reload; active room remains selected.
    Evidence: .sisyphus/evidence/task-3.5-settings-deeplink-close.md
  ```

  **Commit**: YES | Message: `feat(web): add settings deep links` | Files: settings shell/router state integration tests.

- [x] 3.6 Implement `role_drafts` table + 7-day GC — refs: `role-generator/AI 生成角色草稿`

  **What to do**: Implement daemon/runtime behavior for the `role_drafts` table defined in 0.1: startup cleanup of expired drafts, hourly cleanup timer, and immediate cleanup hooks for save/cancel. Store only temporary draft data with `expires_at=created_at+7 days`.
  **Must NOT do**: Do not persist role drafts in events/outbox; do not keep expired drafts after startup/GC; do not include role draft data in durable audit events.

  **Recommended Agent Profile**:
  - Category: `deep` - data lifecycle + privacy constraints.
  - Skills: [] - backend only.
  - Omitted: [`heroui-integration`] - no UI.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 3.7, 3.8, 3.9 | Blocked By: 0.1. Must NOT edit migration/schema unless 0.1 explicitly missed the role_drafts contract and the schema owner is available.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/role-generator/spec.md:45-72`.
  - Design privacy rationale: `openspec/changes/add-v10-orchestration/design.md:263-300`.
  - Daemon startup lifecycle: `packages/daemon/src/index.ts:118-123`, `packages/daemon/src/index.ts:244-260`.

  **Acceptance Criteria**:
  - [ ] `role_drafts` table from 0.1 is used as-is with exact fields and expires index.
  - [ ] Startup removes expired drafts.
  - [ ] Hourly GC removes expired drafts and stops on daemon close.
  - [ ] No `role.generation.*` event types or rows exist.

  **QA Scenarios**:
  ```
  Scenario: startup GC removes expired role drafts
    Tool: Bash
    Steps: Seed expired and active role_drafts; start daemon; query table.
    Expected: expired draft removed; active draft remains.
    Evidence: .sisyphus/evidence/task-3.6-role-drafts-startup-gc.md

  Scenario: role drafts never enter EventBus
    Tool: Bash
    Steps: Create/update draft via backend helper; query events/outbox for role.generation or draft payload.
    Expected: no role generation events and no draft payload persisted to events.
    Evidence: .sisyphus/evidence/task-3.6-role-drafts-no-events.md
  ```

  **Commit**: YES | Message: `feat(roles): add role draft storage` | Files: schema/migration if needed, role draft service/startup tests.

- [x] 3.7 Implement role generation job REST API — refs: `role-generator/AI 生成角色草稿`

  **What to do**: Implement `POST /roles/generate → 202 { jobId }`, `GET /roles/generate/jobs/:jobId`, and `DELETE /roles/generate/jobs/:jobId`. Generate drafts via selected ModelConfig/Native Runtime path, update `role_drafts` status `pending|streaming|completed|failed|cancelled`, and use polling every 500ms from UI. Save occurs through `POST /roles`, not this endpoint.
  **Must NOT do**: Do not auto-save role; do not emit generation events; do not include original prompt/description in `role.created` payload except allowed `generationJobId` on save.

  **Recommended Agent Profile**:
  - Category: `deep` - async job + native runtime + privacy.
  - Skills: [] - backend only.
  - Omitted: [`browser-automation`] - browser testing is later/non-blocking; development tests avoid browser automation.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: 3.8, 3.9 | Blocked By: 1.5, 1.6, 2.4, 3.6.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/role-generator/spec.md:15-117`.
  - Role API: `openspec/changes/add-v10-orchestration/specs/role-system/spec.md:108-117`.
  - No-event rule: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md:36-37`.

  **Acceptance Criteria**:
  - [ ] POST returns 202 and stores draft job with 7-day expiry.
  - [ ] GET returns streaming/completed/failed/cancelled states and draftJson only for active/completed jobs.
  - [ ] DELETE cancels job and clears row.
  - [ ] Save path via `POST /roles` emits `role.created { source: "ai_generated", generationJobId }` without original description/prompt input.
  - [ ] No generation events exist.

  **QA Scenarios**:
  ```
  Scenario: role generation completes through polling
    Tool: Bash
    Steps: POST /roles/generate with mock model config; poll GET job until completed.
    Expected: completed draftJson contains name/description/prompt/capabilities/suggestedPermissionProfileId; no role row yet.
    Evidence: .sisyphus/evidence/task-3.7-role-generation-complete.md

  Scenario: generation failure cleans draft and emits no event
    Tool: Bash
    Steps: Mock invalid API key failure; POST generate; poll failed; query role_drafts/events.
    Expected: failed status returned then row cleaned per spec; no EventBus generation event.
    Evidence: .sisyphus/evidence/task-3.7-role-generation-failure.md
  ```

  **Commit**: YES | Message: `feat(roles): add role generation jobs` | Files: role generation service/routes/tests.

- [x] 3.8 Implement Settings UI role generation flow — refs: `role-generator/AI 生成角色草稿`

  **What to do**: Add Roles tab `Generate with AI` flow: input dialog, model selection, polling progress every 500ms, draft preview with editable fields, Save through `POST /roles`, Cancel through `DELETE /roles/generate/jobs/:jobId`, and failure fallback to manual creation.
  **Must NOT do**: Do not auto-save; do not subscribe to SSE; do not leave cancelled jobs on modal close.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - multi-step UI flow.
  - Skills: [`heroui-integration`] - dialog, progress, preview, buttons.
  - Omitted: [] - backend already exists.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 3.9 | Blocked By: 3.2, 3.4, 3.7.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/role-generator/spec.md:83-117`.
  - Settings roles tab spec: `openspec/changes/add-v10-orchestration/specs/settings-ui/spec.md:68-91`.
  - Model tab dependency: `openspec/changes/add-v10-orchestration/specs/settings-ui/spec.md:109-125`.

  **Acceptance Criteria**:
  - [ ] Generate dialog validates description and modelConfigId.
  - [ ] UI polls job endpoint every 500ms and stops at terminal state.
  - [ ] Save creates real role and removes draft job.
  - [ ] Cancel/close removes draft job and creates no role/event.
  - [ ] Failure state offers Try Again and Write Manually.

  **QA Scenarios**:
  ```
  Scenario: generated draft is previewed and saved
    Tool: Bash
    Steps: Run frontend integration test for Settings > Roles > Generate with AI; mock completed job; edit prompt; Save.
    Expected: new role appears; role.created audit exists; draft job removed; no generation event.
    Evidence: .sisyphus/evidence/task-3.8-role-generator-save.md

  Scenario: cancel generation cleans draft
    Tool: Bash
    Steps: Run frontend integration test starting generation then cancelling/closing modal; inspect DELETE request and roles state.
    Expected: DELETE job called; no new role; no lingering polling.
    Evidence: .sisyphus/evidence/task-3.8-role-generator-cancel.md
  ```

  **Commit**: YES | Message: `feat(web): add role generation flow` | Files: Settings role generation components and frontend integration tests.

- [x] 3.9 Add Settings and role generator tests — refs: `Settings REST-only / role generation polling / 7-day expiry / API key fingerprint`

  **What to do**: Add unit/integration tests proving Settings UI is REST-only, role generation polling/cancel/save/failure works, drafts expire after 7 days, API key fingerprint is shown but plaintext is hidden, and no Settings/role-generation SSE dependency exists.
  **Must NOT do**: Do not use Playwright or browser E2E during development; do not rely only on manual verification for backend/API contracts; do not include real secrets in evidence.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - cross UI/backend test coverage.
  - Skills: [`heroui-integration`] - UI consistency; no Playwright during development.
  - Omitted: [] - no broad refactor.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: Wave 4 Oracle gate | Blocked By: 3.1-3.8.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:46`.
  - Frontend testing pattern: existing web unit/integration tests or add test harness under `apps/web`.

  **Acceptance Criteria**:
  - [ ] Vitest covers role draft 7-day expiry and no generation events.
  - [ ] Frontend integration tests cover Settings modal, Roles/Runtimes/Models tabs, role generation save/cancel/failure, deep links.
  - [ ] Tests assert no full API key in DOM after save.
  - [ ] `pnpm.cmd test -- packages/daemon apps/web` exits `0`; no `pnpm.cmd test:e2e` required.

  **QA Scenarios**:
  ```
  Scenario: Settings UI does not subscribe to SSE
    Tool: Bash
    Steps: Run frontend integration test with EventSource constructor spy; open/close Settings and use tabs/actions.
    Expected: no Settings-specific /event connection; data flows through REST only.
    Evidence: .sisyphus/evidence/task-3.9-settings-rest-only.md

  Scenario: role draft expires after 7 days
    Tool: Bash
    Steps: Use fake clock to create draft, advance beyond expires_at, run GC, GET job.
    Expected: 404 expired; draft row gone; no event emitted.
    Evidence: .sisyphus/evidence/task-3.9-role-draft-expiry.md
  ```

  **Commit**: YES | Message: `test(web): cover settings v10 flows` | Files: daemon/web unit and frontend integration tests.

- [x] 4.1 Implement `room.delegate` MCP tool — refs: `squad-mode/room.delegate MCP tool`

  **What to do**: Add `room.delegate` to RoomMcpServer. Only leader role may call it. It must atomically create a Task, resolve `toRoleId` to a room `agent_binding_id`, enqueue/dispatch `WakeAgent` with reason `delegated_task` and `taskId`, emit `task.created` and `task.delegation.created`, and return `{ taskId, runId }` or deterministic validation error.
  **Transaction boundary decision**: Before coding this task, define and document the exact atomic boundary. Preferred implementation: Task insert, run enqueue/WakeAgent durable state, `task.created`, and `task.delegation.created` all succeed or roll back in one SQLite/CommandBus transaction. If existing CommandBus cannot provide that boundary, implement deterministic rollback/compensation and an explicit failure response; silent half-success (`Task` exists but no delegated run) is forbidden.
  **Must NOT do**: Do not allow non-leaders; do not create Task without dispatch or dispatch without Task; do not leave a committed Task when WakeAgent/run enqueue fails; do not implement separate Squad/Team creation paths.

  **Recommended Agent Profile**:
  - Category: `deep` - MCP + Task + WakeAgent transaction/state boundary.
  - Skills: [] - backend orchestrator only.
  - Omitted: [`heroui-integration`] - no UI.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: 4.2-4.5, 4.12 | Blocked By: 0.3, 1.7, 4.7, 4.8 foundation.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/squad-mode/spec.md:71-97`.
  - Existing MCP dispatch: `packages/orchestrator/src/mcp/room-mcp-server.ts:185-196`.
  - Existing TaskService: `packages/orchestrator/src/task-service.ts:69-111`.
  - WakeAgent command registration: `packages/daemon/src/index.ts:220-225`.

  **Acceptance Criteria**:
  - [ ] `room.delegate` appears in tool surface and validates required fields.
  - [ ] Non-leader returns `delegate_requires_leader_role` with no writes/events.
  - [ ] Happy path writes Task + enqueues delegated run/WakeAgent + emits events atomically under the documented boundary.
  - [ ] Simulated WakeAgent/run enqueue failure rolls back Task/events or emits an explicitly documented compensation/failure state; no silent half-success remains.
  - [ ] Returned `runId` matches created delegated run.

  **QA Scenarios**:
  ```
  Scenario: leader delegates atomically
    Tool: Bash
    Steps: Seed squad room leader+builder binding; call room.delegate; query tasks/runs/events.
    Expected: task created, delegated run queued, task.created and task.delegation.created emitted, response contains taskId/runId.
    Evidence: .sisyphus/evidence/task-4.1-room-delegate-happy.md

  Scenario: non-leader delegate is rejected
    Tool: Bash
    Steps: Call room.delegate from teammate/observer session.
    Expected: delegate_requires_leader_role; no task/run/event rows.
    Evidence: .sisyphus/evidence/task-4.1-room-delegate-non-leader.md

  Scenario: WakeAgent enqueue failure cannot leave half-created Task
    Tool: Bash
    Steps: Inject CommandBus/WakeAgent failure during room.delegate after validation.
    Expected: no committed Task/delegation events without run, or documented compensation state is emitted and surfaced; response is deterministic failure.
    Evidence: .sisyphus/evidence/task-4.1-room-delegate-atomic-failure.md
  ```

  **Commit**: YES | Message: `feat(orchestrator): add room delegate tool` | Files: `packages/orchestrator/src/mcp/room-mcp-server.ts`, Task dispatch service/tests.

- [x] 4.2 Implement Squad mode dispatch — refs: `squad-mode/Squad 模式调度`

  **What to do**: Implement Squad flow: Leader delegates with `expectsReview=false`; Task runs `pending → in_progress → completed`; teammate completion emits `task.delegation.completed`; mailbox notification wakes Leader with summary; projector-facing events remain visibility=both.
  **Must NOT do**: Do not implement mailbox-only dispatch; do not skip Task creation; do not require review for Squad.

  **Recommended Agent Profile**:
  - Category: `deep` - orchestration lifecycle and mailbox wake flow.
  - Skills: [] - backend orchestrator.
  - Omitted: [`browser-automation`] - browser testing is later/non-blocking; development tests avoid browser automation.

  **Parallelization**: Can Parallel: YES | Wave 5 | Blocks: 4.12, 4.11 UI semantics | Blocked By: 4.1, 4.7, 4.8.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/squad-mode/spec.md:16-70`.
  - Design timeline: `openspec/changes/add-v10-orchestration/design.md:317-328`.
  - Mailbox/Runs patterns: `packages/daemon/src/index.ts:138-149`, `packages/orchestrator/test/orchestrator.test.ts:108-136`.

  **Acceptance Criteria**:
  - [ ] Squad delegate creates Task with `expects_review=0` and assignee role/binding.
  - [ ] Teammate run start/completion updates Task status and activity.
  - [ ] Completion emits `task.delegation.completed` and wakes Leader via mailbox.
  - [ ] Failure path sets Task blocked/cancelled and wakes Leader.

  **QA Scenarios**:
  ```
  Scenario: Squad teammate completion wakes Leader
    Tool: Bash
    Steps: Run orchestrator integration with leader delegating to reviewer; complete reviewer run.
    Expected: Task completed, task.delegation.completed emitted, mailbox created, leader wake queued.
    Evidence: .sisyphus/evidence/task-4.2-squad-completion-wake.md

  Scenario: Squad teammate failure blocks Task
    Tool: Bash
    Steps: Simulate delegated teammate run failure.
    Expected: Task status blocked/cancelled per implementation decision, task.status.changed emitted, leader wake reason task_blocked or mailbox failure.
    Evidence: .sisyphus/evidence/task-4.2-squad-failure-blocked.md
  ```

  **Commit**: YES | Message: `feat(orchestrator): implement squad dispatch` | Files: orchestrator dispatch/task/mailbox services/tests.

- [x] 4.3 Implement Team mode dispatch — refs: `team-mode/Team 模式调度`

  **What to do**: Implement Team review flow: Leader delegates with `expectsReview=true`; teammate tasks move to `review` on run completion; when all sibling Tasks are in review/completed/cancelled, wake Leader with reason `task_review` and emit `team.dispatch.started`; Leader approval via `room.update_task` completes tasks; dispatch completion emits `team.dispatch.completed`.
  **Must NOT do**: Do not wake Leader before all siblings are ready; do not bypass Task status machine; do not complete review tasks automatically.

  **Recommended Agent Profile**:
  - Category: `deep` - multi-run state machine.
  - Skills: [] - backend orchestrator.
  - Omitted: [`heroui-integration`] - no UI.

  **Parallelization**: Can Parallel: YES | Wave 5 | Blocks: 4.4, 4.12, 4.10/4.11 UI semantics | Blocked By: 4.1, 4.7, 4.8.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/team-mode/spec.md:14-71`.
  - Design timeline: `openspec/changes/add-v10-orchestration/design.md:330-343`.
  - Run terminal side effects: `packages/daemon/src/index.ts:142-149`.

  **Acceptance Criteria**:
  - [ ] Team delegate creates Tasks with `expects_review=1`.
  - [ ] Teammate completion moves Task to `review`, not `completed`.
  - [ ] Leader wakes only after all sibling tasks are ready for review.
  - [ ] `team.dispatch.started` and `team.dispatch.completed` emit durable both events.

  **QA Scenarios**:
  ```
  Scenario: all siblings in review wakes Leader
    Tool: Bash
    Steps: Leader delegates 3 tasks; complete first two; verify no wake; complete third.
    Expected: only after third completion leader wake queued and team.dispatch.started emitted.
    Evidence: .sisyphus/evidence/task-4.3-team-review-wake.md

  Scenario: Leader approves review task
    Tool: Bash
    Steps: Put task in review; call room.update_task status completed as leader.
    Expected: task.status.changed review→completed and team.dispatch.completed when dispatch complete.
    Evidence: .sisyphus/evidence/task-4.3-team-approve.md
  ```

  **Commit**: YES | Message: `feat(orchestrator): implement team review dispatch` | Files: orchestrator team dispatch/terminal hook/tests.

- [x] 4.4 Implement sibling Task completion判定 — refs: `team-mode/Team 模式调度`

  **What to do**: Add terminal hook/helper based on multica `issue_child_done.go` pattern: each delegated teammate run terminal checks all sibling tasks from the same leader dispatch/parent/delegation group. Only wake Leader when all siblings are terminal/review-ready; blocked tasks wake Leader with task_blocked.
  **Must NOT do**: Do not use polling; observe remains passive and WakeAgent remains model-call entry point.

  **Recommended Agent Profile**:
  - Category: `deep` - terminal hook and idempotency.
  - Skills: [] - backend orchestration.
  - Omitted: [] - no UI skill.

  **Parallelization**: Can Parallel: YES | Wave 5 | Blocks: 4.12 | Blocked By: 4.3.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:53`.
  - Team spec sibling rules: `openspec/changes/add-v10-orchestration/specs/team-mode/spec.md:40-46`.
  - Workflow core contract: `docs/agenthub-agent-workflow.md:480-488` - WakeAgent/RunQueue contracts.

  **Acceptance Criteria**:
  - [ ] Terminal hook is idempotent; duplicate terminal events do not double-wake Leader.
  - [ ] Partial sibling completion does not wake Leader.
  - [ ] All sibling review/completed/cancelled wakes Leader exactly once.
  - [ ] Blocked sibling wakes Leader with reason `task_blocked`.

  **QA Scenarios**:
  ```
  Scenario: partial sibling completion does not wake
    Tool: Bash
    Steps: Complete one of two sibling tasks; inspect run_next_turns/wake queue.
    Expected: no leader task_review wake yet.
    Evidence: .sisyphus/evidence/task-4.4-sibling-partial-no-wake.md

  Scenario: duplicate terminal hook is idempotent
    Tool: Bash
    Steps: Trigger terminal hook twice for final sibling.
    Expected: one leader wake and one team.dispatch.started event only.
    Evidence: .sisyphus/evidence/task-4.4-sibling-idempotent.md
  ```

  **Commit**: YES | Message: `feat(orchestrator): add sibling task review gate` | Files: orchestrator terminal hook/tests.

- [x] 4.5 Implement Task loop guards — refs: `squad-mode/Squad 模式调度`, `task-workflow-core/最小 Task 数据模型`

  **What to do**: Enforce parent depth max 5, duplicate same room+leader title+description within 5 minutes rejection, and timeout of pending/in_progress tasks after 30 minutes to blocked with `task.status.changed { reason: "timeout" }` and Leader wake.
  **Must NOT do**: Do not silently create over-depth/duplicate tasks; do not implement configurable thresholds unless spec is updated.

  **Recommended Agent Profile**:
  - Category: `deep` - state guard correctness.
  - Skills: [] - backend orchestrator.
  - Omitted: [] - no UI.

  **Parallelization**: Can Parallel: YES | Wave 5 | Blocks: 4.12 | Blocked By: 4.1, 4.6.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/squad-mode/spec.md:44-49`, `squad-mode/spec.md:65-70`.
  - Task workflow spec: `openspec/changes/add-v10-orchestration/specs/task-workflow-core/spec.md:21-83`.
  - Design guardrails: `openspec/changes/add-v10-orchestration/design.md:408-413`.

  **Acceptance Criteria**:
  - [ ] Depth 6 delegation returns `delegation_too_deep` and writes no Task/run.
  - [ ] Duplicate title+description within 5 minutes is rejected.
  - [ ] Pending/in_progress task older than 30 minutes is marked blocked and emits event.
  - [ ] Timeout wake is idempotent and does not spam Leader.

  **QA Scenarios**:
  ```
  Scenario: depth guard rejects sixth nested task
    Tool: Bash
    Steps: Seed chain depth 5; call room.delegate with parentTaskId at depth 5.
    Expected: delegation_too_deep; no Task/run/event.
    Evidence: .sisyphus/evidence/task-4.5-depth-guard.md

  Scenario: stale task becomes blocked after 30 minutes
    Tool: Bash
    Steps: Seed in_progress delegated task with old updated_at; run timeout checker.
    Expected: task.status.changed to blocked reason timeout; leader wake queued once.
    Evidence: .sisyphus/evidence/task-4.5-timeout-blocked.md
  ```

  **Commit**: YES | Message: `feat(tasks): enforce delegation loop guards` | Files: task guard service/tests.

- [x] 4.6 Implement `task_activities` + `task.activity.added` + `room.update_task` extensions — refs: `task-workflow-core/最小 Task 数据模型`

  **What to do**: Extend TaskService and Room MCP `room.update_task` for `addComment`, `setBlocker`, `linkArtifact`, `priority`, and status changes. Insert `task_activities` rows and emit `task.activity.added` for non-status activities. Continue using `task.status.changed` for status updates. Add `GET /tasks/:id/activities` and `POST /tasks/:id/activities` if not already exposed through MCP/API.
  **Must NOT do**: Do not emit `task.updated` or `task.deleted`; do not bypass transaction+publish.

  **Recommended Agent Profile**:
  - Category: `deep` - task model/event contract.
  - Skills: [] - backend orchestrator/API.
  - Omitted: [] - no UI.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: 4.5, 4.9, 4.10, 4.11, 5.1 | Blocked By: 0.1, 0.3.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/task-workflow-core/spec.md:57-107`, `task-workflow-core/spec.md:137-163`.
  - Existing TaskService: `packages/orchestrator/src/task-service.ts:66-163`.
  - Room MCP update task path: `packages/orchestrator/src/mcp/room-mcp-server.ts:188-190`.

  **Acceptance Criteria**:
  - [ ] Non-status task activities insert `task_activities` and emit `task.activity.added` in same transaction.
  - [ ] Status changes emit only `task.status.changed`.
  - [ ] Task delete/cancel uses `task.status.changed { nextStatus: "cancelled" }`.
  - [ ] API/MCP tests cover comments, blocker, artifact, priority, and invalid transition.

  **QA Scenarios**:
  ```
  Scenario: add comment creates activity event
    Tool: Bash
    Steps: Call room.update_task addComment; query task_activities/events.
    Expected: comment activity row and task.activity.added event; no task.updated event.
    Evidence: .sisyphus/evidence/task-4.6-task-activity-comment.md

  Scenario: delete task uses cancelled status
    Tool: Bash
    Steps: Invoke cancel/delete path for task; query events.
    Expected: task.status.changed nextStatus cancelled; no task.deleted event.
    Evidence: .sisyphus/evidence/task-4.6-task-cancel-no-delete-event.md
  ```

  **Commit**: YES | Message: `feat(tasks): add activity timeline events` | Files: TaskService, RoomMcpServer, daemon task routes/tests.

- [x] 4.7 Implement Task three-layer assignee and role→binding resolve — refs: `task-workflow-core/最小 Task 数据模型`

  **What to do**: Extend TaskService views/commands for `assignee_role_id`, `assignee_binding_id`, and compatibility `assignee_agent_id`. Resolve role to room binding during dispatch; populate both role and binding ids; maintain old assigneeAgentId for compatibility where required.
  **Must NOT do**: Do not dispatch by role without recording actual binding; do not remove `assignee_agent_id` during compatibility window.

  **Recommended Agent Profile**:
  - Category: `deep` - data consistency across rooms/tasks/runs.
  - Skills: [] - backend only.
  - Omitted: [] - no UI.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: 4.1-4.4, 4.9 | Blocked By: 1.7, 0.2.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/task-workflow-core/spec.md:25-55`.
  - Agents spec: `openspec/changes/add-v10-orchestration/specs/agents/spec.md:57-61`.
  - Current TaskView: `packages/orchestrator/src/task-service.ts:27-44`, `apps/web/src/types.ts:71-76`.

  **Acceptance Criteria**:
  - [ ] Task rows created through delegate include assignee_role_id and assignee_binding_id.
  - [ ] Role→binding resolution fails clearly if role is not bound in room.
  - [ ] Run created for delegated task has task_id and actual binding/agent identity.
  - [ ] Legacy assigneeAgentId remains available to old consumers.

  **QA Scenarios**:
  ```
  Scenario: role resolves to room binding during delegation
    Tool: Bash
    Steps: Seed room with builder role binding; call delegate toRoleId=builder; query task/run.
    Expected: assignee_role_id=builder, assignee_binding_id=room binding, compatibility assignee agent populated as required.
    Evidence: .sisyphus/evidence/task-4.7-assignee-resolve.md

  Scenario: unbound role delegation is rejected
    Tool: Bash
    Steps: Call delegate toRoleId not present in room participants/bindings.
    Expected: validation error; no Task/run/event.
    Evidence: .sisyphus/evidence/task-4.7-assignee-unbound.md
  ```

  **Commit**: YES | Message: `feat(tasks): resolve role binding assignees` | Files: TaskService/dispatch/daemon types/tests.

- [x] 4.8 Implement `rooms.leader_role_id` and squad/team room validation — refs: `rooms/Room 数据模型（MODIFIED）`

  **What to do**: Update room creation command/API to accept `leaderRoleId` and V1.0 participant shape `{ roleId, runtimeId, modelConfigId? }`. Require leaderRoleId for `mode=squad|team`; solo/assisted do not require it. Persist `rooms.leader_role_id`; create/resolve room participants with `agent_binding_id`.
  **Must NOT do**: Do not allow squad/team room without leaderRoleId; do not regress solo/assisted legacy room creation; do not return 501 for squad/team.

  **Recommended Agent Profile**:
  - Category: `deep` - room creation API compatibility.
  - Skills: [] - backend/API.
  - Omitted: [`heroui-integration`] - UI form changes may be separate if needed.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: 4.1-4.4, 4.12, room creation UI | Blocked By: 0.1, 0.6, 1.7.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/rooms/spec.md:5-40`.
  - Proposal API change: `openspec/changes/add-v10-orchestration/proposal.md:131-137`.
  - Current CreateRoom: `packages/daemon/src/commands.ts:32-113`.

  **Acceptance Criteria**:
  - [ ] `POST /rooms { mode: "squad" }` without leaderRoleId returns 400 `squad_mode_requires_leader_role_id`.
  - [ ] `POST /rooms { mode: "team", leaderRoleId, participants }` succeeds and persists leader role/bindings.
  - [ ] `POST /rooms { mode: "solo" }` remains compatible without leaderRoleId.
  - [ ] Old primaryAgentId/participants payload still works through compatibility layer.

  **QA Scenarios**:
  ```
  Scenario: squad/team require leaderRoleId
    Tool: Bash
    Steps: POST /rooms mode=squad without leaderRoleId.
    Expected: HTTP 400 squad_mode_requires_leader_role_id; no room/event.
    Evidence: .sisyphus/evidence/task-4.8-room-leader-required.md

  Scenario: team room with V1.0 participant shape creates bindings
    Tool: Bash
    Steps: POST /rooms mode=team with leaderRoleId and participants role/runtime/model config.
    Expected: room created; rooms.leader_role_id set; room_participants.agent_binding_id set; room.created event includes leaderRoleId-compatible payload.
    Evidence: .sisyphus/evidence/task-4.8-team-room-create.md
  ```

  **Commit**: YES | Message: `feat(rooms): support leader role rooms` | Files: `packages/daemon/src/commands.ts`, route/types/tests.

- [x] 4.9 Implement Side Panel Tasks tab — refs: `task-workflow-core/Task Workflow UI`, `web-ui/Side Panel 视图（MODIFIED）`

  **What to do**: Upgrade Tasks tab from placeholder list to V1.0 Task view: status groups Backlog/In Progress/Blocked/Review/Done, priority chip, title, assignee role avatar/name, status badge, updated timestamp, detail slide-over with title/description/assignee/parent+children/activity timeline, and activity run links. Use HeroUI components and projector state.
  **Must NOT do**: Do not implement drag-and-drop Kanban, search/filter/agent grouping, dependency graph, or direct SQLite reads.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - product UI and interaction.
  - Skills: [`heroui-integration`] - cards/chips/drawer/scroll/tabs.
  - Omitted: [] - no backend changes beyond types/tests.

  **Parallelization**: Can Parallel: YES | Wave 6 | Blocks: 4.12, final UI acceptance | Blocked By: 4.6, 4.7, 5.1 event state model.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/task-workflow-core/spec.md:108-136`.
  - Web UI spec: `openspec/changes/add-v10-orchestration/specs/web-ui/spec.md:5-28`.
  - Current TasksPanel: `apps/web/src/components/panels/TasksPanel.tsx:1-62`.
  - Current SidePanel: `apps/web/src/components/panels/SidePanel.tsx:21-60`.

  **Acceptance Criteria**:
  - [ ] Tasks are grouped by V1.0 statuses and update via projector events.
  - [ ] Clicking a task opens detail slide-over with activity timeline.
  - [ ] Activity timeline shows comments/run events/artifact links/blockers/status changes.
  - [ ] No drag/drop UI is present.

  **QA Scenarios**:
  ```
  Scenario: Tasks tab updates when delegation event arrives
    Tool: Bash
    Steps: Run frontend projector/component integration test for Side Panel Tasks tab; feed task.created/delegation fixture events through projector state.
    Expected: new task appears in Backlog/Pending without refresh and correct assignee/status.
    Evidence: .sisyphus/evidence/task-4.9-tasks-tab-live-update.md

  Scenario: Task detail shows activity timeline
    Tool: Bash
    Steps: Run frontend component test seeding task with comment/run_completed/artifact activities; trigger task row selection.
    Expected: slide-over displays timeline entries and Run Detail link for run_completed.
    Evidence: .sisyphus/evidence/task-4.9-task-detail-activity.md
  ```

  **Commit**: YES | Message: `feat(web): implement task workflow panel` | Files: `apps/web/src/components/panels/TasksPanel.tsx`, task detail components, types/tests.

- [x] 4.10 Implement Run Detail Tools tab multi-agent collaboration view — refs: `web-ui/Main Timeline 与 Agent Run Detail 双视图（MODIFIED）`

  **What to do**: Extend Run Detail Tools tab for squad/team: show parent Leader Run, sibling delegated Runs from same dispatch, associated Task tree, task statuses, and links to sibling Run Detail and Task detail. Use existing Run Detail drawer/tabs and HeroUI chips/cards.
  **Must NOT do**: Do not replace existing Tools tab data; do not expose raw debug internals in main UI; do not create topology visualization (V1.1+).

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - complex run/task UI.
  - Skills: [`heroui-integration`] - dense, consistent drawer layout.
  - Omitted: [] - no backend unless missing read model fields are required.

  **Parallelization**: Can Parallel: YES | Wave 6 | Blocks: 4.12, final UI acceptance | Blocked By: 4.2-4.7, 5.1.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/web-ui/spec.md:29-43`.
  - Current RunDetailDrawer: `apps/web/src/components/run/RunDetailDrawer.tsx:54-75`.
  - Current Tools tab: `apps/web/src/components/run/tabs/ToolsTab.tsx` (read before editing).
  - Type baseline: `apps/web/src/types.ts:78-88`.

  **Acceptance Criteria**:
  - [ ] Run Detail Tools tab shows Task tree for a delegated teammate run.
  - [ ] Sibling runs are linked and open the correct Run Detail.
  - [ ] Task link opens Task detail slide-over.
  - [ ] Existing non-squad/team Tools tab behavior remains intact.

  **QA Scenarios**:
  ```
  Scenario: teammate Run Detail shows sibling task tree
    Tool: Bash
    Steps: Run frontend component/integration test with team room fixture containing two delegated tasks/runs; select one teammate Run Detail > Tools state.
    Expected: parent leader run, sibling run, and task tree visible with status chips.
    Evidence: .sisyphus/evidence/task-4.10-run-detail-task-tree.md

  Scenario: solo run Tools tab remains unchanged
    Tool: Bash
    Steps: Run frontend component regression test with solo run detail tools fixture.
    Expected: existing tools output remains; no squad/team-only empty/error state.
    Evidence: .sisyphus/evidence/task-4.10-run-detail-solo-regression.md
  ```

  **Commit**: YES | Message: `feat(web): show run collaboration graph` | Files: Run Detail Tools tab/components/types/tests.

- [x] 4.11 Implement TaskStatusCard in main timeline — refs: `messaging/Card 类型清单（MODIFIED）`

  **What to do**: Add TaskStatusCard rendering in main timeline/brief surface for `task.delegation.created`, `team.dispatch.started`, and related dispatch/review events. Card shows leader dispatch summary, assignee role, status, and link to Task/Tasks tab.
  **Must NOT do**: Do not flood main chat with internal activity timeline entries; keep full details in Task detail/Run Detail.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - messaging/product UX.
  - Skills: [`heroui-integration`] - card/chip/button consistency.
  - Omitted: [] - no backend.

  **Parallelization**: Can Parallel: YES | Wave 6 | Blocks: 4.12, final UI acceptance | Blocked By: 4.2, 4.3, 4.6, 5.1.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/messaging/spec.md:5-27`.
  - Projector event switch: `apps/web/src/hooks/useProjector.ts:189-240` and later cases.
  - Existing brief type: `apps/web/src/types.ts:29-39`.

  **Acceptance Criteria**:
  - [ ] Leader dispatch creates a main-visible TaskStatusCard.
  - [ ] Team review readiness creates `N tasks ready for review` TaskStatusCard.
  - [ ] Clicking card opens Task detail or Side Panel Tasks tab as specified.
  - [ ] Main timeline does not show raw task activity spam.

  **QA Scenarios**:
  ```
  Scenario: dispatch card appears in main timeline
    Tool: Bash
    Steps: Run frontend projector/component test feeding task.delegation.created or team.dispatch.started into main timeline state.
    Expected: TaskStatusCard text shows dispatched task and assignee role with View Task action.
    Evidence: .sisyphus/evidence/task-4.11-task-status-card-dispatch.md

  Scenario: review-ready card links to Tasks tab
    Tool: Bash
    Steps: Run frontend component test with team.dispatch.started/review-ready fixture; trigger card action.
    Expected: Side Panel Tasks tab opens and relevant tasks are visible in Review group.
    Evidence: .sisyphus/evidence/task-4.11-task-status-card-review.md
  ```

  **Commit**: YES | Message: `feat(messages): add task status cards` | Files: message/timeline components, projector/types/tests.

- [x] 4.12 Add Squad/Team/Task integration tests — refs: `Squad 3 teammate 并行 / Team review / loop guards / timeout / task.updated rejected`

  **What to do**: Add integration tests covering Squad 3 teammate parallel dispatch, Team sibling tasks all in review before Leader wake, delegation depth guard, duplicate guard, 30-minute timeout to blocked, `task.updated` rejected by checks, and frontend/projector state coverage via unit/integration tests.
  **Must NOT do**: Do not use Playwright or browser E2E during development; do not rely on manual QA only for backend/task contracts; do not skip failure paths; do not make tests flaky with real time delays.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - cross orchestration/frontend integration test suite.
  - Skills: [] - no Playwright during development.
  - Omitted: [] - no broad refactor.

  **Parallelization**: Can Parallel: YES | Wave 6 | Blocks: Wave 6 Oracle gate | Blocked By: 4.1-4.11, 5.1 for UI replay cases.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:61`.
  - Orchestrator test patterns: `packages/orchestrator/test/orchestrator.test.ts:39-66`.
  - Frontend integration patterns: projector/component tests added with tasks 4.9-5.1.
  - Event check: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md:50-54`.

  **Acceptance Criteria**:
  - [ ] Vitest covers Squad dispatch parallelism and Team review gate.
  - [ ] Vitest covers loop guards and timeout with fake clock.
  - [ ] Check test proves `task.updated` rejected.
  - [ ] Frontend/projector integration tests cover visible Squad/Team Task UI state flows without browser automation.
  - [ ] `pnpm.cmd test -- packages/orchestrator packages/daemon apps/web` exits `0`; no `pnpm.cmd test:e2e` required.

  **QA Scenarios**:
  ```
  Scenario: Squad three-teammate dispatch runs in parallel where locks allow
    Tool: Bash
    Steps: Run orchestrator integration with three teammates and non-overlapping targetFiles.
    Expected: three delegated runs queue/start without same-agent lock conflicts; tasks complete and leader wakes.
    Evidence: .sisyphus/evidence/task-4.12-squad-three-parallel.md

  Scenario: task.updated is rejected by CI
    Tool: Bash
    Steps: Run events/check fixture referencing task.updated.
    Expected: check fails with event type not found; repository checks pass without fixture.
    Evidence: .sisyphus/evidence/task-4.12-task-updated-rejected.md
  ```

  **Commit**: YES | Message: `test(orchestrator): cover squad team workflows` | Files: orchestrator/daemon/web integration tests.

- [x] 5.1 Update `useProjector.ts` for V1.0 Task replay model — refs: `event-system/事件分级（durable / ephemeral）`

  **What to do**: Upgrade the full Task projector read model, not just the five new V1.0 event types. Existing handlers for `task.created` and `task.status.changed` must support V1.0 payload semantics and replay behavior: statuses `pending`, `in_progress`, `blocked`, `review`, `completed`, `cancelled`; `assigneeRoleId`; `assigneeBindingId`; compatibility `assigneeAgentId`; `expectsReview`; `parentTaskId`; `delegationChain`; `sourceRunId`; `priority`; and activity dedupe keys. Add projector handlers/view-model updates for `task.activity.added`, `task.delegation.created`, `task.delegation.completed`, `team.dispatch.started`, and `team.dispatch.completed`. Extend `RoomViewModel`, `TaskViewModel`, `RunViewModel`, and message/brief/card state as needed so SSE live and replay reconstruct Tasks tab, TaskStatusCard, and Run Detail collaboration state.
  **Must NOT do**: Do not keep old fallback status `todo` for V1.0 task.created payloads; do not handle detail-only Settings events; do not create duplicate tasks/cards/activities on SSE replay; do not require refresh.

  **Recommended Agent Profile**:
  - Category: `deep` - projector replay/dedupe correctness.
  - Skills: [] - frontend state model; HeroUI not central.
  - Omitted: [`heroui-integration`] - visual components are separate.

  **Parallelization**: Can Parallel: NO | Wave 6 | Blocks: 4.9-4.12 reliable UI acceptance | Blocked By: 0.3, 4.6 event payload decisions.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:65`.
  - Event projector requirement: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md:39-68`.
  - Current projector: `apps/web/src/hooks/useProjector.ts:189-240` and following switch cases.
  - Current view model: `apps/web/src/types.ts:71-117`.

  **Acceptance Criteria**:
  - [ ] Existing `task.created` handler maps V1.0 payload fields into TaskViewModel without falling back to legacy `todo` status.
  - [ ] Existing `task.status.changed` handler supports all V1.0 statuses and updates cards/tabs consistently on live events and replay.
  - [ ] All five V1.0 visibility=both events have projector handlers.
  - [ ] Projector dedupes replayed events by task/activity/dispatch id or equivalent.
  - [ ] Settings detail-only events are not handled for Settings UI.
  - [ ] SSE reconnect/replay reconstructs Tasks tab and TaskStatusCard without refresh-only bugs.

  **QA Scenarios**:
  ```
  Scenario: task.created replay preserves V1.0 fields
    Tool: Bash
    Steps: Feed projector a durable replay containing task.created with status=pending, assigneeRoleId, assigneeBindingId, expectsReview, parentTaskId, delegationChain, sourceRunId, and priority.
    Expected: TaskViewModel contains those exact fields; no status=todo fallback; Tasks tab and TaskStatusCard can render from replay state only.
    Evidence: .sisyphus/evidence/task-5.1-projector-task-created-v10-replay.md

  Scenario: task.status.changed live and replay stay idempotent
    Tool: Bash
    Steps: Feed projector task.status.changed transitions pending→in_progress→review→completed, then replay the same events.
    Expected: final status is completed; each transition is represented once; duplicate replay does not duplicate timeline/card state.
    Evidence: .sisyphus/evidence/task-5.1-projector-status-replay-idempotent.md

  Scenario: task activity event updates timeline live and after replay
    Tool: Bash
    Steps: Run projector/component integration test feeding task.activity.added live then replay fixture into Tasks tab state.
    Expected: activity appears once live and once after replay, not duplicated.
    Evidence: .sisyphus/evidence/task-5.1-projector-task-activity-replay.md

  Scenario: detail-only role event is ignored by main projector
    Tool: Bash
    Steps: Publish role.created visibility detail; connect main SSE/projector.
    Expected: no Settings/main state mutation; Debug events can query audit row.
    Evidence: .sisyphus/evidence/task-5.1-projector-detail-event-ignore.md
  ```

  **Commit**: YES | Message: `feat(web): project v10 task events` | Files: `apps/web/src/hooks/useProjector.ts`, `apps/web/src/types.ts`, projector tests.

- [x] 5.2 Update adapter-framework: NativeAgentAdapter real, Codex stub still 501 — refs: `adapter-framework/Post-MVP Adapter Stub（MODIFIED）`

  **What to do**: Update adapter-framework code/docs/spec-facing surfaces so OpenCode and Native are real adapters, while Codex/LangGraph/A2A remain post-V1.0 stubs. Ensure API/UI/runtime errors say Codex is V1.x post V1.0 and Native does not return 501.
  **Must NOT do**: Do not implement Codex/LangGraph/A2A; do not remove stub behavior for unavailable adapters.

  **Recommended Agent Profile**:
  - Category: `quick` - cleanup and assertion update.
  - Skills: [] - backend/docs/tests.
  - Omitted: [`heroui-integration`] - no UI unless a small label update is needed.

  **Parallelization**: Can Parallel: YES | Wave 7 | Blocks: 5.3, final scope checks | Blocked By: 2.5.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/adapter-framework/spec.md:5-25`.
  - Adapter registry: `packages/daemon/src/adapters/registry.ts:9-58`.
  - ACP stub error pattern: `packages/adapters/acp-base/src/index.ts:88-91`.

  **Acceptance Criteria**:
  - [ ] NativeAdapter path is documented/typed as real.
  - [ ] CodexAdapter still returns 501 with `{ capability: "adapter-framework" }` and V1.x message.
  - [ ] Any adapter list/UI no longer labels Native as stub.
  - [ ] Tests cover Native non-501 and Codex 501.

  **QA Scenarios**:
  ```
  Scenario: Native adapter is real
    Tool: Bash
    Steps: Start native-bound run through registry smoke test.
    Expected: no 501; NativeAgentAdapter invoked.
    Evidence: .sisyphus/evidence/task-5.2-native-real.md

  Scenario: Codex remains post-V1.0 stub
    Tool: Bash
    Steps: Invoke Codex adapter stub path.
    Expected: 501 with V1.x/post V1.0 message.
    Evidence: .sisyphus/evidence/task-5.2-codex-501.md
  ```

  **Commit**: YES | Message: `chore(adapters): mark native adapter real` | Files: adapter registry/docs/tests/stub updates.

- [x] 5.3 Update `v1-roadmap`: remove Squad/Team placeholders — refs: `v1-roadmap/V1.0 Squad / Team 模式占位（REMOVED）`

  **What to do**: Apply roadmap/spec cleanup so V1.0 Squad/Team and OpenCode placeholders are removed/marked implemented exactly as the change spec says. Ensure board/timeline endpoints remain not found or V1.1+ as applicable.
  **Must NOT do**: Do not implement V1.1 task board Kanban/topology; do not reintroduce deployment placeholder as V1.0.

  **Recommended Agent Profile**:
  - Category: `quick` - documentation/spec cleanup and route assertion.
  - Skills: [] - focused cleanup.
  - Omitted: [`browser-automation`] - API/check tests enough unless UI text changes.

  **Parallelization**: Can Parallel: YES | Wave 7 | Blocks: 6.3, final scope checks | Blocked By: 4.2, 4.3, 5.2.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/specs/v1-roadmap/spec.md:3-15`.
  - Current route placeholders: `packages/daemon/src/index.ts:413-414` for `/board`/`/timeline`.
  - Proposal non-goals: `openspec/changes/add-v10-orchestration/proposal.md:86-92`.

  **Acceptance Criteria**:
  - [ ] V1 roadmap docs/spec state Squad/Team are implemented in V1.0.
  - [ ] V1.1+ placeholders remain placeholders and are not implemented.
  - [ ] `openspec.cmd validate add-v10-orchestration --strict` passes after cleanup.
  - [ ] Tests/assertions confirm `/board` and `/timeline` remain not found unless separately specified.

  **QA Scenarios**:
  ```
  Scenario: OpenSpec validates after roadmap cleanup
    Tool: Bash
    Steps: Run openspec.cmd validate add-v10-orchestration --strict.
    Expected: exit 0; no stale Squad/Team placeholder errors.
    Evidence: .sisyphus/evidence/task-5.3-roadmap-openspec.md

  Scenario: V1.1 board/topology remain out of scope
    Tool: Bash
    Steps: Request GET /board and /timeline in daemon API smoke test.
    Expected: 404 not_found or V1.1 placeholder response, not real implementation.
    Evidence: .sisyphus/evidence/task-5.3-v11-out-of-scope.md
  ```

  **Commit**: YES | Message: `docs(spec): close v10 roadmap placeholders` | Files: OpenSpec docs/spec route assertions if needed.

- [x] 6.1 Run full unit/type/lint validation — refs: `design/Goals G2`

  **What to do**: Run `pnpm.cmd test`, `pnpm.cmd typecheck`, and `pnpm.cmd lint` after all implementation waves. Fix failures only within the task/spec scope; if failure implies spec conflict or new architecture decision, stop and escalate per workflow manual.
  **Must NOT do**: Do not lower lint/test standards; do not skip failing tests; do not hide flaky failures.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - repo-wide validation and triage.
  - Skills: [] - command/test triage.
  - Omitted: [] - no special skill.

  **Parallelization**: Can Parallel: YES | Wave 8 | Blocks: 6.5, final review | Blocked By: all implementation tasks.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:71`.
  - Package scripts: `package.json:21-27`.
  - Workflow commands: `docs/agenthub-agent-workflow.md:153-167`.

  **Acceptance Criteria**:
  - [ ] `pnpm.cmd test` exits `0`.
  - [ ] `pnpm.cmd typecheck` exits `0`.
  - [ ] `pnpm.cmd lint` exits `0`.
  - [ ] Failures, if any, have fixes and rerun evidence.

  **QA Scenarios**:
  ```
  Scenario: full Vitest suite passes
    Tool: Bash
    Steps: Run pnpm.cmd test.
    Expected: exit 0 with no hidden failures.
    Evidence: .sisyphus/evidence/task-6.1-pnpm-test.md

  Scenario: typecheck and lint pass
    Tool: Bash
    Steps: Run pnpm.cmd typecheck and pnpm.cmd lint.
    Expected: both exit 0.
    Evidence: .sisyphus/evidence/task-6.1-typecheck-lint.md
  ```

  **Commit**: NO | Message: `test: final validation fixes only if needed` | Files: none unless fixes are required.

- [x] 6.2 Run `pnpm check:all` including `ai-sdk-provider:check` — refs: `event-system/events:check 与 visibility:check CI 校验`

  **What to do**: Run `pnpm.cmd check:all` and individual checks if needed. Confirm the check suite includes `ai-sdk-provider:check` and all five CI/check gates referenced by the spec.
  **Must NOT do**: Do not remove checks from `check:all`; do not mark success if `ai-sdk-provider:check` did not run.

  **Recommended Agent Profile**:
  - Category: `quick` - command validation.
  - Skills: [] - no special skill.
  - Omitted: [] - no UI.

  **Parallelization**: Can Parallel: YES | Wave 8 | Blocks: 6.5, final review | Blocked By: 0.4, 0.5, all implementation tasks.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:72`.
  - Package scripts: `package.json:14-28`.
  - Event check scenario: `openspec/changes/add-v10-orchestration/specs/event-system/spec.md:44-54`.

  **Acceptance Criteria**:
  - [ ] `pnpm.cmd check:all` exits `0`.
  - [ ] Output/evidence proves `ai-sdk-provider:check` ran.
  - [ ] `pnpm.cmd events:check` and `pnpm.cmd visibility:check` pass independently if check-all output is insufficient.

  **QA Scenarios**:
  ```
  Scenario: check-all green with provider guard
    Tool: Bash
    Steps: Run pnpm.cmd check:all.
    Expected: exit 0 and includes ai-sdk-provider check in output.
    Evidence: .sisyphus/evidence/task-6.2-check-all.md

  Scenario: event/visibility checks pass standalone
    Tool: Bash
    Steps: Run pnpm.cmd events:check; pnpm.cmd visibility:check.
    Expected: both exit 0.
    Evidence: .sisyphus/evidence/task-6.2-events-visibility.md
  ```

  **Commit**: NO | Message: `chore: final check fixes only if needed` | Files: none unless fixes are required.

- [x] 6.3 Run OpenSpec strict validation — refs: `design/Goals G3`

  **What to do**: Run `openspec.cmd validate add-v10-orchestration --strict` from repo root and fix only spec/code consistency issues that are inside this change. If validation requires changing the accepted design, escalate to upper agent before editing specs.
  **Must NOT do**: Do not skip strict; do not patch specs to hide implementation gaps.

  **Recommended Agent Profile**:
  - Category: `quick` - command validation and focused fix.
  - Skills: [] - OpenSpec CLI available.
  - Omitted: [] - no UI.

  **Parallelization**: Can Parallel: YES | Wave 8 | Blocks: 6.5, final review | Blocked By: 5.3.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:73`.
  - Workflow strict command: `docs/agenthub-agent-workflow.md:122-127`, `docs/agenthub-agent-workflow.md:160-167`.

  **Acceptance Criteria**:
  - [ ] `openspec.cmd validate add-v10-orchestration --strict` exits `0`.
  - [ ] Any validation fix is linked to an OpenSpec requirement and documented in PR summary.

  **QA Scenarios**:
  ```
  Scenario: OpenSpec strict passes
    Tool: Bash
    Steps: Run openspec.cmd validate add-v10-orchestration --strict.
    Expected: exit 0; no errors/warnings requiring action.
    Evidence: .sisyphus/evidence/task-6.3-openspec-strict.md

  Scenario: spec mismatch is escalated, not hidden
    Tool: Bash
    Steps: If strict fails for design conflict, create issue note with Problem/Context/Options/Recommendation.
    Expected: implementation pauses for upper-agent decision before scope-changing fix.
    Evidence: .sisyphus/evidence/task-6.3-openspec-escalation.md
  ```

  **Commit**: NO | Message: `docs(spec): resolve strict validation only if needed` | Files: none unless strict fixes are needed.

- [x] 6.4 Prepare non-blocking browser QA handoff checklist — refs: `settings-ui/Settings Modal`, `squad-mode/Squad 模式调度`

  **What to do**: Do not run Playwright. Prepare a non-blocking browser QA handoff checklist for later user testing of V1.0 Settings modal, Role generation, Squad Run, Team Task review, Tasks tab, TaskStatusCard, and Run Detail collaboration view. Include setup commands, seed/test data, expected UI states, failure cases, and exact observations the user can verify whenever convenient.
  **Must NOT do**: Do not run `pnpm.cmd test:e2e`; do not use Playwright/browser automation; do not wait for the user to run the checklist; do not block final implementation review on manual browser testing; do not hide refresh-only bugs in the checklist.

  **Recommended Agent Profile**:
  - Category: `writing` - precise non-blocking QA checklist and handoff.
  - Skills: [] - no Playwright during development.
  - Omitted: [`browser-automation`] - browser automation explicitly disabled by user due to instability.

  **Parallelization**: Can Parallel: YES | Wave 8 | Blocks: 6.5 documentation completeness only, final review handoff completeness | Blocked By: 3.9, 4.12, 5.1.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:74`.
  - User testing constraint: browser acceptance is a non-blocking user activity after implementation handoff; Playwright is disabled during development.

  **Acceptance Criteria**:
  - [ ] `.sisyphus/evidence/task-6.4-user-manual-acceptance-checklist.md` exists with exact user steps and expected results.
  - [ ] Checklist covers Settings modal, Role generation, Squad Run, Team review, Tasks tab, TaskStatusCard, and Run Detail collaboration view.
  - [ ] Checklist explicitly asks the user to verify live updates without refresh for task/team events.
  - [ ] Completion of task 6.4 requires checklist creation only; it does not require user execution or acceptance of the checklist.

  **QA Scenarios**:
  ```
  Scenario: Settings modal browser QA handoff checklist is complete
    Tool: Bash
    Steps: Inspect generated checklist for Settings open, Roles/Runtimes/Models, role generation, deep link, and expected user observations.
    Expected: checklist is executable by the user without Playwright, includes expected pass/fail states, and states it is non-blocking for implementation completion.
    Evidence: .sisyphus/evidence/task-6.4-user-manual-acceptance-checklist.md

  Scenario: Squad/Team handoff checklist covers no-refresh behavior
    Tool: Bash
    Steps: Inspect generated checklist for squad/team rooms, delegated tasks, review tasks, TaskStatusCard, Tasks tab, and Run Detail observations.
    Expected: checklist requires user to confirm Tasks tab/cards/run detail update through SSE live and replay without refresh.
    Evidence: .sisyphus/evidence/task-6.4-squad-team-manual-checklist.md
  ```

  **Commit**: NO | Message: `docs(qa): prepare v10 manual acceptance checklist` | Files: `.sisyphus/evidence/task-6.4-*.md` only unless fixes are required.

- [x] 6.5 Update OpenSpec `tasks.md` checkboxes — refs: `design/Goals G3`

  **What to do**: After successful implementation and validation evidence for every task, update `openspec/changes/add-v10-orchestration/tasks.md` checkboxes from `[ ]` to `[x]` for completed items. Include evidence references in PR/stage summary.
  **Must NOT do**: Do not check off tasks before corresponding evidence exists; do not mark `6.6` complete before V1.1 plan exists.

  **Recommended Agent Profile**:
  - Category: `quick` - mechanical documentation update.
  - Skills: [] - docs only.
  - Omitted: [] - no code.

  **Parallelization**: Can Parallel: NO | Wave 8 | Blocks: final review | Blocked By: 6.1-6.4 automated evidence and browser QA handoff checklist creation.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:71-76`.
  - Workflow completion definition: `docs/agenthub-agent-workflow.md:496-508`.

  **Acceptance Criteria**:
  - [ ] Every checked task has matching test/QA evidence path.
  - [ ] UI/user-facing tasks can be checked after automated evidence and the non-blocking browser QA checklist exist; do not wait for user manual testing.
  - [ ] `git diff` for `tasks.md` only changes checkbox state and intentional notes if needed.
  - [ ] OpenSpec strict still passes after checkbox update.

  **QA Scenarios**:
  ```
  Scenario: tasks.md checkboxes match evidence
    Tool: Bash
    Steps: Compare checked tasks against .sisyphus/evidence files and PR summary.
    Expected: no checked task lacks evidence.
    Evidence: .sisyphus/evidence/task-6.5-tasks-checkbox-audit.md

  Scenario: OpenSpec still validates after checkbox update
    Tool: Bash
    Steps: Run openspec.cmd validate add-v10-orchestration --strict.
    Expected: exit 0.
    Evidence: .sisyphus/evidence/task-6.5-openspec-after-checkboxes.md
  ```

  **Commit**: YES | Message: `docs(spec): mark v10 tasks complete` | Files: `openspec/changes/add-v10-orchestration/tasks.md`.

- [x] 6.6 Prepare V1.1 plan for task-board Kanban + collaboration visualization — refs: `design/Roadmap Beyond MVP V1.1`

  **What to do**: Prepare a V1.1 planning artifact or issue draft for task-board Kanban and collaboration visualization (Timeline + Topology), using V1.0 outcomes/risks as input. Keep it separate from V1.0 implementation and clearly out of scope for this change.
  **Must NOT do**: Do not implement Kanban drag/drop, topology visualization, or V1.1 code; do not modify V1.0 behavior for speculative V1.1.

  **Recommended Agent Profile**:
  - Category: `writing` - future plan/issue drafting.
  - Skills: [] - planning documentation.
  - Omitted: [`heroui-integration`] - no UI implementation.

  **Parallelization**: Can Parallel: YES | Wave 8 | Blocks: final scope closure | Blocked By: known V1.0 acceptance findings.

  **References**:
  - Spec: `openspec/changes/add-v10-orchestration/tasks.md:76`.
  - Non-goal guardrail: `openspec/changes/add-v10-orchestration/proposal.md:86-92`.
  - Design milestones: `openspec/changes/add-v10-orchestration/design.md:815-823`.

  **Acceptance Criteria**:
  - [ ] V1.1 draft identifies Kanban, Timeline, and Topology as future work, not V1.0.
  - [ ] Draft includes dependencies on V1.0 Task workflow and projector state.
  - [ ] Draft is saved as an issue/planning artifact approved by workflow owner, not merged into V1.0 code.

  **QA Scenarios**:
  ```
  Scenario: V1.1 draft remains planning-only
    Tool: Bash
    Steps: Inspect diff after draft creation.
    Expected: only planning/issue artifact changes; no app/source implementation files for Kanban/topology.
    Evidence: .sisyphus/evidence/task-6.6-v11-draft-scope.md

  Scenario: final scope audit finds no V1.1 implementation
    Tool: Bash
    Steps: Search diff summary for drag/drop topology/timeline implementation files.
    Expected: no V1.1 code added; only V1.1 planning artifact.
    Evidence: .sisyphus/evidence/task-6.6-v11-no-implementation.md
  ```

  **Commit**: YES | Message: `docs(plan): prepare v11 collaboration roadmap` | Files: V1.1 planning artifact or issue note only.

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
  - Evidence: `.sisyphus/evidence/final-plan-compliance.md`
  - Prompt: compare implementation branch against this plan and `openspec/changes/add-v10-orchestration/tasks.md`; verify every task/spec ref is satisfied and no non-goal scope was added.
- [x] F2. Code Quality Review — unspecified-high
  - Evidence: `.sisyphus/evidence/final-code-quality.md`
  - Prompt: inspect diff for maintainability, duplicated paths, transaction boundaries, state machines, error handling, tests, and AI slop.
- [x] F3. Non-blocking Browser QA Handoff Audit — unspecified-high
  - Evidence: `.sisyphus/evidence/final-manual-qa.md`, `.sisyphus/evidence/task-6.4-user-manual-acceptance-checklist.md`
  - Prompt: do not use Playwright and do not wait for the user. Review the browser QA handoff checklist and automated frontend/backend evidence; verify the checklist is complete, non-blocking, and suitable for the user to run later for Settings modal, role/model/runtime config, Squad dispatch, Team review, Tasks tab, Task detail, and Run Detail Tools collaboration without relying on refresh. Mark F3 complete when the handoff quality is approved, not when the user manually tests it.
- [x] F4. Scope Fidelity Check — deep
  - Evidence: `.sisyphus/evidence/final-scope-fidelity.md`
  - Prompt: confirm no Deployment/Tauri/responsive/Docker/cloud/multi-user/V1.x features, no unregistered events, no Settings SSE consumption, no role-draft events, no string AI SDK model IDs.

## Commit Strategy
- Use one integration branch per wave or natural task package: `task/v10-wave-<N>-<short-name>`.
- Use independent worktrees only after contract files are frozen and file ownership is documented.
- Treat `.sisyphus/plans/add-v10-orchestration.md` as the authoritative execution contract; capture it in the initial planning commit or local PR-equivalent packet before implementation branches start.
- Commit format examples: `feat(db): add v10 schema foundation`, `feat(runtime): add native provider registry`, `test(orchestrator): cover delegated task review flow`, `feat(web): add settings modal`.
- Before commit: `git status --short`, `git diff --check`, relevant command evidence, and `gitnexus_detect_changes(scope="all", repo="AgentHub")`.
- No self-merge. Oracle gate approval is required before merging each major wave.

## Success Criteria
- All OpenSpec tasks 0.1-6.6 are implemented, tested, and checked in `tasks.md` only after evidence exists.
- All new mutation paths either emit the specified event in the same SQLite transaction or are explicitly polling/test paths with no EventBus event by spec.
- Settings UI works through REST only and never opens an SSE/projector subscription.
- Native Runtime can run a solo flow with tool calling, permission ask/deny-before-stream, cancel, and cost reporting.
- Squad and Team both create canonical Tasks and update UI through projector replay without refresh.
- Final review wave F1-F4 passes and the user explicitly approves completion.

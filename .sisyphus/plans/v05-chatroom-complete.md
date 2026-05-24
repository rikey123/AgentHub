# V0.5 Chatroom Complete Implementation Plan

## TL;DR
> **Summary**: Implement OpenSpec change `add-v05-chatroom-complete` as one Oracle-gated V0.5 program: preflight unknowns, land contract foundations, then adapters/templates, backend, UI features, UI polish, and final validation. This plan maps every `tasks.md` item `§0.1`–`§9.7` and adds workflow guardrails from `docs/agenthub-agent-workflow.md`.
> **Deliverables**: OpenCode ACP adapter; Claude hook completion; BriefGenerator + terminal brief transaction; agent templates + hot reload; chat backend completeness; cost API/UI; config/CLI/shutdown; secure attachments; web chat features; frontend polish; strict OpenSpec/CI/E2E validation.
> **Effort**: XL
> **Parallel**: YES — gated waves with isolated worktrees; W3/W4 intentionally serialized because `apps/web/src` is high-conflict.
> **Critical Path**: PF.1 EventBus transaction semantics → W0 foundation `§0.*` → W1 contracts/adapters/templates → W2 backend/API/security → W3 UI features → W4 polish → W5/FV validation.

## Source Snapshot
- OpenSpec change: `openspec/changes/add-v05-chatroom-complete`
- Strict validation already passed: `openspec.cmd validate add-v05-chatroom-complete --strict`
- Source files read: `proposal.md`, `design.md`, `tasks.md`, and all 12 capability `spec.md` files.
- `tasks.md` count: 72 executable checklist items from `§0.1` through `§9.7`; M0–M5 delivery suggestions are advisory and not separate spec requirements.
- Workflow manual: `docs/agenthub-agent-workflow.md` is binding for branch/worktree/PR/review/oracle-gate behavior.
- Test infra exists: Vitest, Playwright, CI workflow, `.sisyphus/evidence` conventions, root scripts `test`, `test:e2e`, `lint`, `typecheck`, `check:all`, `events:check`, `visibility:check`, `command:check`, `schema:check`, `subscriptions:check`, `run-state-machine:check`.

## Workflow Compliance Block
- OpenSpec is the highest implementation authority. If code and spec conflict, stop and write an issue under `.sisyphus/notepads/v05-chatroom-complete/issues/<slug>.md` using the workflow manual template.
- Every wave is implemented on a task branch/worktree, submitted as a PR or local PR boundary, reviewed, then Oracle-gated before merge.
- No code agent may self-merge. Merge requires review approval, Oracle approval, passing validation, and complete PR description.
- Parallel execution requires explicit module ownership. Shared files are serialized or split into submodules before parallel work.
- Each PR description must list task IDs, spec refs, files changed, validation commands, risks/open questions, worktree notes, docs checked, and reference notes if external projects were consulted.
- If a test fails for 30+ minutes without root cause, if extra schema is needed beyond this plan, or if a protected contract must change beyond the documented delta, escalate before continuing.

## Pre-Resolved Ambiguities
- **Agent templates count**: follow `tasks.md` and `agents/spec.md`: 7 templates, not the shorter design prose fragment.
- **OpenCode bridge and default model**: not decided in this plan; PF.2/PF.3 research and record decisions before `§1.2`/template implementation.
- **`§1.6` vs `§3.1` template ownership**: `§1.6` owns research of default model; `§3.1` owns writing final templates.
- **Mention insertion**: UI must insert/send canonical kebab-case `agentId`, not display names with spaces; backend parser remains authoritative.
- **Assisted mention semantics**: if a message contains mentions and omits primary, primary is not awakened.
- **`§9.7` scope**: write a V1.0 entry-criteria checklist only; do not design or implement V1.0.
- **Attachments schema**: `packages/db/src/schema.ts` already defines `attachments` with `message_id NOT NULL`, `file_id`, `file_name`, `mime_type`, `byte_size`, `sha256`, `storage_path`. Because V0.5 wants upload-before-send orphan cleanup, `§6.1` must first verify whether the existing schema can represent orphan attachments; any nullability/column change beyond `0012_v05.sql` requires an issue + Oracle decision.
- **M5 `§9.1` wording**: verification/apply existing `0012_v05.sql`; do not create a second migration.

## Protected Contract Changes Inventory
1. `§0.4` — `RunLifecycleService.complete/fail/cancelFinalized` signature extension with optional `briefText` and same-transaction `message.brief.published` side effect.
   - Review: Oracle pre-flight required before code is written.
   - Current protected invariant: RunLifecycleService is the only writer for `runs` and `agent.run.*` durable events.
   - Proposed signatures:
     - `complete(tx, runId, cost, briefText?: string)`
     - `fail(tx, runId, reason, failureClass, error?, briefText?: string)`
     - `cancelFinalized(tx, runId, briefText?: string)`
2. Event registry additions — `agent.profile.removed`, `agent.profile.error`, `mailbox.delivery.failed`, `artifact.diff.detected`; event envelope remains owned by `event-system` and must not be redesigned.
3. Command additions/handlers — `RegenerateMessage`, `PinMessage`, pending-turn edit path; must update command union/checks without adding `StartRun`.
4. Adapter implementation — OpenCode must extend `ACPAdapter` without changing `AgentRuntimeAdapter`, `AdapterManifest`, or `ACPAdapter` base interface.

## Must NOT Have
- No Codex/LangGraph/A2A real adapters.
- No Memory/vector index, Squad/Team Mode, task-board Kanban, War Room, Plugin/Skill System.
- No Storybook, PWA, Tauri, responsive breakpoints, full design system, shadcn/ui.
- No multi-user/per-user cost attribution.
- No `StartRun` command; all model calls go through `WakeAgent`.
- No direct raw `UPDATE runs`; no bypass of RunLifecycleService.
- No bypass of Permission Engine, ArtifactFS, CSRF/Origin, or secure path handling.
- No cloud/SaaS/Postgres/Redis/WebSocket Hub/Mobile Native/Marketplace.

## Verification Strategy
> ZERO HUMAN INTERVENTION for command/test verification; review gates are agent-executed and then presented to the user for approval.
- Test decision: tests-with-implementation using Vitest for unit/integration, Playwright for browser E2E, root checks for contract validation.
- Evidence root: `.sisyphus/evidence/v05-chatroom-complete/`
- Per-task evidence path: `.sisyphus/evidence/v05-chatroom-complete/task-{section}-{slug}/`
- Final commands:
  - `openspec.cmd validate add-v05-chatroom-complete --strict`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm check:all`
  - `pnpm test:e2e`
- A PR may not claim completion if any task-specific evidence path is missing.

## New Dependencies Allowed by Spec
- `smol-toml` for config parsing.
- OpenCode ACP bridge package selected by PF.2.
- `chokidar` and `gray-matter` for AgentProfile hot reload if not already present.
- `@tanstack/react-virtual` for message/log/command virtualization.
- `@floating-ui/react` for mention popover positioning.
- `ansi-to-html` for terminal ANSI rendering.
- axe tooling for AA checks.
- Any other new dependency requires escalation and PR `Docs Checked` entry.

## Worktree & Branch Plan
| Wave | Worktree | Branch | Ownership |
|---|---|---|---|
| W-PRE | current repo | `task/v05-preflight` | read-only research + notepads only |
| W0 | current repo | `task/v05-w0-foundation` | `packages/db/**`, `packages/protocol/**`, `packages/context/**`, `packages/orchestrator/src/run-lifecycle-service.ts`, checks |
| W1A | `..\AgentHub-v05-w1a-opencode` | `task/v05-w1-opencode` | `packages/adapters/opencode/**` |
| W1B | `..\AgentHub-v05-w1b-claude-hooks` | `task/v05-w1-claude-hooks` | `packages/adapters/claude-code/**`, context snapshot consumer |
| W1C | `..\AgentHub-v05-w1c-agent-templates` | `task/v05-w1-agent-templates` | `packages/agents/**`, daemon agent bootstrap/watcher |
| W2A | `..\AgentHub-v05-w2a-orchestrator` | `task/v05-w2-orchestrator` | `packages/orchestrator/**`, message command handlers by agreed ranges |
| W2B | `..\AgentHub-v05-w2b-daemon-cost` | `task/v05-w2-daemon-cost` | `packages/daemon/**`, `apps/cli/**`, config/SIGINT/cost |
| W2C | `..\AgentHub-v05-w2c-attachments` | `task/v05-w2-attachments` | `packages/security/**`, attachment route in daemon |
| W3 | `..\AgentHub-v05-w3-web-features` | `task/v05-w3-web-features` | all `§7` web features, serialized |
| W4 | `..\AgentHub-v05-w4-web-polish` | `task/v05-w4-web-polish` | all `§8` web polish, serialized; `§8.1` first |
| W5 | current repo | `task/v05-w5-final` | validation, docs checkbox update, V1 entry checklist |

## Agent Dispatch Summary
- `quick`: mechanical checks, simple tests, CLI small subcommands, validation-only tasks.
- `unspecified-high`: cross-package backend/API/state-machine work.
- `visual-engineering` + `frontend-ui-ux`: web UI features/polish.
- `oracle`: protected contracts and phase gates.
- `playwright` skill: E2E flows and performance traces.
- `git-master` skill: every commit/PR step.

## Execution Waves
- W-PRE: unblock unknowns; no production code changes.
- W0: foundation; must finish before event emitters/UI.
- W1: adapters and agent profiles; W1A/W1B/W1C may run after W0, with separate worktrees.
- W2: backend/API/security; W2A/W2B/W2C may run after W1 with daemon shared-file ownership coordination.
- W3: UI features; starts only after backend contracts for each feature are merged.
- W4: UI polish; starts only after W3 is merged.
- W5/FV: validation/review only.

## Dependency Matrix
- `§0.1` blocks `§3.3`, `§4.5`, `§4.6`, `§5.1`, `§6.*` if attachment schema is added.
- `§0.2` blocks `§2.3`, `§3.3`, `§4.5`, `§7.6`, Run Detail event projections.
- `§0.3` + `§0.4` block real brief generation in `§2`, `§4`, `§7.8`.
- PF.2/PF.3 block `§1.2`, `§1.6`, `§3.1` builder-opencode final content.
- `§4.1` blocks `§4.2` and `§7.1` final E2E.
- `§4.5` blocks `§7.6`.
- `§4.7`/`§4.8`/`§4.9` block `§7.4`/`§7.5`.
- `§5.1` blocks `§7.9` and Run Detail Cost comparison in `§7.8`.
- `§6.1` blocks `§7.2`.
- `§7.*` blocks `§8.*`; especially `§8.1` must be first in W4.

## Preflight Wave — No Production Code Changes

- [x] PF.1 Verify EventBus transaction semantics
  - **Maps to**: prerequisite for `§0.4`
  - **What to do**: Read `packages/bus/src/index.ts`, `packages/orchestrator/src/run-lifecycle-service.ts`, and DB transaction pattern. Prove whether event publishing writes synchronously through the caller's active `better-sqlite3` transaction/connection.
  - **Must NOT do**: Do not patch RunLifecycleService until this is proven.
  - **Agent Profile**: `oracle` — protected transaction invariant.
  - **Parallelization**: Can Parallel: YES with PF.2–PF.8 | Wave PF | Blocks: `§0.4` | Blocked By: none.
  - **References**: `packages/bus/src/index.ts`; `packages/orchestrator/src/run-lifecycle-service.ts`; `openspec/.../specs/bus-runtime/spec.md`.
  - **Acceptance Criteria**: write `.sisyphus/notepads/v05-chatroom-complete/eventbus-tx-semantics.md` with PASS/FAIL and exact code references; if FAIL, create issue and stop W0.
  - **QA Scenarios**: Happy: document same-connection synchronous event insert; Failure: document async/separate-connection path and required Oracle decision.
  - **Commit**: NO.

- [x] PF.2 Research OpenCode ACP bridge package
  - **Maps to**: `§1.1`
  - **What to do**: Identify official/current OpenCode ACP bridge package, version, CLI invocation, install docs, and compatibility with `ACPAdapter` base.
  - **Must NOT do**: Do not scrape stdout; do not select unmaintained package without documenting fallback.
  - **Agent Profile**: `librarian` or `unspecified-high` — external package/API research.
  - **Parallelization**: YES | Blocks: `§1.2`, `§1.5`, `§1.7`.
  - **References**: `design.md` V05-D1 and Open Questions V05-1; `packages/adapters/acp-base/src/index.ts`.
  - **Acceptance Criteria**: write `.sisyphus/notepads/v05-chatroom-complete/opencode-bridge-decision.md` with package, version, spawn command, docs URL, and fallback.
  - **QA Scenarios**: Happy: selected package supports ACP structured events; Failure: no package found → issue with fallback recommendation.
  - **Commit**: NO.

- [x] PF.3 Research builder-opencode default model
  - **Maps to**: `§1.6`
  - **What to do**: Determine OpenCode CLI default model/provider behavior and the exact default to encode in template.
  - **Must NOT do**: Do not invent a model name.
  - **Agent Profile**: `librarian` or `quick` after PF.2 docs found.
  - **Parallelization**: YES after/during PF.2 | Blocks: `§3.1`.
  - **References**: `agents/spec.md` builder-opencode; `design.md` V05-5.
  - **Acceptance Criteria**: append decision to `opencode-bridge-decision.md`.
  - **QA Scenarios**: Happy: default follows OpenCode CLI docs; Failure: docs unclear → template omits model or uses documented CLI default with Oracle approval.
  - **Commit**: NO.

- [x] PF.4 Confirm `/auth/tokens` API surface
  - **Maps to**: prerequisite for `§5.5`
  - **What to do**: Read `packages/daemon/src/index.ts` and `packages/daemon/src/openapi.ts` to verify POST/GET/DELETE token routes exist.
  - **Must NOT do**: Do not add auth routes during preflight.
  - **Agent Profile**: `quick`.
  - **Parallelization**: YES | Blocks: `§5.5`.
  - **References**: `local-daemon/spec.md`; `packages/daemon/src/index.ts`.
  - **Acceptance Criteria**: write route availability to `.sisyphus/notepads/v05-chatroom-complete/auth-token-routes.md`; if missing, expand `§5.5` or escalate.
  - **QA Scenarios**: Happy: routes exist and CLI can wrap; Failure: missing route requires backend task/issue.
  - **Commit**: NO.

- [x] PF.5 Confirm terminal artifact PTY persistence
  - **Maps to**: prerequisite for `§7.7`
  - **What to do**: Read `packages/artifacts/src`, artifact schema/types, adapter terminal tool paths, and verify stdout/stderr/exit code are stored for terminal artifacts.
  - **Must NOT do**: Do not implement terminal capture in preflight.
  - **Agent Profile**: `unspecified-high`.
  - **Parallelization**: YES | Blocks: `§7.7`.
  - **References**: `web-ui/spec.md` TerminalCard; `packages/artifacts/src`.
  - **Acceptance Criteria**: write `.sisyphus/notepads/v05-chatroom-complete/terminal-artifact-persistence.md` with fields and sample source path; if missing, expand backend scope before W3.
  - **QA Scenarios**: Happy: terminal artifact has persisted output; Failure: only raw stream exists → issue before UI task.
  - **Commit**: NO.

- [x] PF.6 Locate mailbox attempt_count increment site
  - **Maps to**: prerequisite for `§4.5`
  - **What to do**: Read `packages/orchestrator/src/mailbox-service.ts` and command handlers to identify exact claim/retry path for incrementing `mailbox_messages.attempt_count`.
  - **Must NOT do**: Do not add new mailbox state machine.
  - **Agent Profile**: `unspecified-high`.
  - **Parallelization**: YES | Blocks: `§4.5`.
  - **References**: `messaging/spec.md` mailbox failure; `packages/orchestrator/src/mailbox-service.ts`.
  - **Acceptance Criteria**: write `.sisyphus/notepads/v05-chatroom-complete/mailbox-attempt-site.md` with the exact function to edit.
  - **QA Scenarios**: Happy: retry path located; Failure: no retry path exists → `§4.5` must define one and Oracle reviews.
  - **Commit**: NO.

- [x] PF.7 Map current CLI surface
  - **Maps to**: prerequisite for `§3.4`, `§5.5`
  - **What to do**: Read `apps/cli/src/index.ts` and existing CLI tests; decide whether to split subcommands into modules before adding `agents reset` and daemon/auth commands.
  - **Must NOT do**: Do not add subcommands in preflight.
  - **Agent Profile**: `quick`.
  - **Parallelization**: YES | Blocks: `§3.4`, `§5.5`.
  - **References**: `local-daemon/spec.md` CLI table; `apps/cli/src/index.ts`.
  - **Acceptance Criteria**: write `.sisyphus/notepads/v05-chatroom-complete/cli-surface.md` with current commands and collision plan.
  - **QA Scenarios**: Happy: modularization path clear; Failure: monolith too large → split modules as first CLI task.
  - **Commit**: NO.

- [x] PF.8 Confirm audit log target for observer discipline
  - **Maps to**: prerequisite for `§4.3`
  - **What to do**: Find audit log implementation/schema and confirm it can record `observer_speaking_after_knock`.
  - **Must NOT do**: Do not create audit schema beyond spec without issue.
  - **Agent Profile**: `unspecified-high`.
  - **Parallelization**: YES | Blocks: `§4.3`.
  - **References**: `orchestrator/spec.md`; security/observability audit implementation.
  - **Acceptance Criteria**: write `.sisyphus/notepads/v05-chatroom-complete/audit-log-target.md` with exact file/table; if no target, issue.
  - **QA Scenarios**: Happy: audit write target exists; Failure: no audit path → Oracle decides whether to add or adjust spec.
  - **Commit**: NO.

## TODOs
> Implementation + tests are one task unless the original `tasks.md` item is itself a validation-only task. Each task below is Ctrl+F-searchable by `§N.M` and maps directly to `tasks.md`.

### Wave W0 — Foundation (`§0.1`–`§0.6`)

- [x] §0.1 Write migration `0012_v05.sql`
  - **Spec refs**: `design/Migration Plan`; `agents/AgentProfile 数据模型`; `messaging/消息列表分页`; `cost-panel-local/Cost 字段 Schema 不变`.
  - **What to do**: Add migration with exactly: `messages.brief_published_at`, `mailbox_messages.delivery_failure_reason`, `mailbox_messages.attempt_count DEFAULT 0`, 5 nullable `agent_profiles` columns, `idx_messages_room_created_desc`, `idx_runs_workspace_ended`. Verify existing `attachments` schema can support `§6`; if not, write issue before adding schema.
  - **Must NOT do**: Do not add `runs.completed_at`; do not create cost materialized tables; do not make ALTERs idempotent by inventing custom column checks unless existing migration runner requires it.
  - **Owning files/modules**: `packages/db/**`, migration directory discovered from `packages/db/src/sqlite.ts`.
  - **Recommended Agent Profile**: Category `unspecified-high` — migration affects multiple capabilities. Skills: `[]`. Omitted: `frontend-ui-ux` — backend-only.
  - **Parallelization**: Can Parallel: NO | Wave W0 | Blocks: `§3.3`, `§4.5`, `§4.6`, `§5.1`, `§6.*` | Blocked By: PF.1 if transaction assumptions affect migration tests.
  - **References**: `packages/db/src/schema.ts:66-105,317-349`; `packages/db/src/sqlite.ts`; `openspec/.../design.md:298-335`.
  - **Acceptance Criteria**: `pnpm --filter @agenthub/db build` exit 0; `pnpm --filter @agenthub/db test` exit 0; fresh in-memory migration script asserts new columns/indexes; evidence `.sisyphus/evidence/v05-chatroom-complete/task-0-1-migration/schema-check.json`.
  - **QA Scenarios**:
    ```
    Scenario: Fresh DB applies 0012
      Tool: Bash
      Steps: create :memory: DB with all migrations, PRAGMA table_info/index_list for messages/mailbox_messages/agent_profiles/runs.
      Expected: all V0.5 columns and indexes exist; no completed_at column.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-1-migration/fresh-db.json

    Scenario: Migration runner prevents reapply
      Tool: Bash
      Steps: run migrations twice using existing migration runner.
      Expected: second run no-ops through migration ledger, no duplicate-column crash.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-1-migration/reapply.json
    ```
  - **Commit**: YES | Message: `feat(db): add v05 migration foundation` | Files: DB migration/schema tests only.

- [x] §0.2 Register four V0.5 event types
  - **Spec refs**: `event-system/事件分级（durable / ephemeral）`.
  - **What to do**: Add `agent.profile.removed` durable/detail, `agent.profile.error` ephemeral/detail, `mailbox.delivery.failed` durable/both, `artifact.diff.detected` ephemeral/detail to canonical registry and payload schemas/checks.
  - **Must NOT do**: Do not change event envelope or visibility semantics; do not make `artifact.diff.detected` durable or main-only.
  - **Owning files/modules**: `packages/protocol/src/events/**`, event check scripts if required.
  - **Recommended Agent Profile**: Category `unspecified-high` — protected event registry. Skills: `[]`. Omitted: `frontend-ui-ux`.
  - **Parallelization**: Can Parallel: NO with `§0.4` | Wave W0 | Blocks: `§2.3`, `§3.3`, `§4.5`, `§7.6` | Blocked By: `§0.1` not required.
  - **Protected contract checkpoint**: event-system registry; Oracle review required in W0 PR.
  - **References**: `packages/protocol/src/events/registry.ts`; `packages/protocol/src/events/checks.ts`; `openspec/.../specs/event-system/spec.md`.
  - **Acceptance Criteria**: `pnpm events:check` exit 0; `pnpm visibility:check` exit 0; node registry smoke test confirms all 4 event types registered; evidence `task-0-2-events/registry.json`.
  - **QA Scenarios**:
    ```
    Scenario: Registered events pass checks
      Tool: Bash
      Steps: run events:check and visibility:check.
      Expected: exit 0, no unknown type/visibility errors.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-2-events/checks.log

    Scenario: artifact.diff.detected stays detail-only
      Tool: Bash
      Steps: inspect registry entry via node smoke test.
      Expected: durability=ephemeral, visibility=detail, category=artifact.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-2-events/diff-detected.json
    ```
  - **Commit**: YES | Message: `feat(events): register v05 event types` | Files: protocol event registry/check fixtures.

- [x] §0.3 Implement `BriefGenerator` interface and `HeuristicBriefGenerator`
  - **Spec refs**: `context-ledger/BriefGenerator 接口（V0.5 启发式 / V1.2 LLM）`.
  - **What to do**: Define interface/input types and deterministic heuristic implementation in `packages/context`; cover first sentence, 120-char truncation, code-block skip, failure/cancel templates, parse fallback, artifact suffix.
  - **Must NOT do**: Do not call LLM in V0.5; do not make generator query DB; do not couple RunLifecycleService to context package.
  - **Owning files/modules**: `packages/context/src/index.ts`, `packages/context/test/**`.
  - **Recommended Agent Profile**: Category `unspecified-high` — shared interface with future V1.2 seam. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES with `§0.1/§0.2` after API shape agreed | Wave W0 | Blocks: `§0.4` caller wiring | Blocked By: none.
  - **References**: `packages/context/src/index.ts`; `openspec/.../specs/context-ledger/spec.md:5-89`.
  - **Acceptance Criteria**: `pnpm --filter @agenthub/context test --run brief-generator` exit 0; at least 7 named test cases pass; evidence `task-0-3-brief-generator/vitest.json`.
  - **QA Scenarios**:
    ```
    Scenario: Successful heuristic brief
      Tool: Bash
      Steps: run test case with Chinese final text and artifact counts diff=1/tool=3.
      Expected: first sentence plus artifacts suffix exactly matches spec.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-3-brief-generator/success.json

    Scenario: Parse failure fallback
      Tool: Bash
      Steps: run test case with abnormal/no-punctuation 200-char input.
      Expected: no throw; output is 120-char truncation plus ellipsis.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-3-brief-generator/fallback.json
    ```
  - **Commit**: YES | Message: `feat(context): add heuristic brief generator` | Files: context src/test only.

- [x] §0.4 Extend RunLifecycleService terminal brief transaction
  - **Spec refs**: `bus-runtime/RunLifecycleService 是 runs 表的唯一写入口`; `messaging/主流摘要 / Agent Run Detail 双投影`.
  - **What to do**: After PF.1 and Oracle pre-review pass, update `complete/fail/cancelFinalized` signatures to accept optional `briefText`; in the same terminal transaction insert `message.brief.published`, update `messages.brief_published_at`, and outbox both durable events in seq order.
  - **Must NOT do**: Do not raw-update `runs` outside RunLifecycleService; do not call BriefGenerator inside the transaction; do not introduce new run states.
  - **Owning files/modules**: `packages/orchestrator/src/run-lifecycle-service.ts`, related tests, protocol payload types if needed.
  - **Recommended Agent Profile**: Category `unspecified-high` + Oracle gate — protected transaction contract. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO | Wave W0 | Blocks: terminal callers in W1/W2 | Blocked By: PF.1, `§0.2`, Oracle pre-review.
  - **Protected contract checkpoint**: RunLifecycleService and durable `agent.run.*`; Oracle review mandatory before and after implementation.
  - **References**: `packages/orchestrator/src/run-lifecycle-service.ts`; `packages/orchestrator/test/**`; `openspec/.../specs/bus-runtime/spec.md:5-79`.
  - **Acceptance Criteria**: new `packages/orchestrator/test/run-lifecycle-brief.test.ts` proves within same DB transaction both `agent.run.completed` and `message.brief.published` rows are visible and rollback removes both; `pnpm --filter @agenthub/orchestrator test --run run-lifecycle-brief` exit 0; `pnpm run-state-machine:check` exit 0.
  - **QA Scenarios**:
    ```
    Scenario: Complete publishes brief atomically
      Tool: Bash
      Steps: test complete(tx, runId, cost, "test brief") with assistant message linked by run_id.
      Expected: run completed, brief event after run event, messages.brief_published_at set, outbox has both.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-4-run-lifecycle-brief/complete.json

    Scenario: Rollback prevents partial publish
      Tool: Bash
      Steps: force error after first insert in transaction using test double.
      Expected: no terminal event, no brief event, run status unchanged.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-4-run-lifecycle-brief/rollback.json
    ```
  - **Commit**: YES | Message: `feat(orchestrator): publish run briefs atomically` | Files: orchestrator lifecycle/tests and protocol payloads if needed.

- [x] §0.5 Update checks so `events:check` and `visibility:check` pass
  - **Spec refs**: `event-system/events:check 与 visibility:check CI 校验`.
  - **What to do**: Run/fix generated registries/check fixtures/subscription metadata needed by new events. Also run `schema:check`, `subscriptions:check`, and `command:check` to catch collateral registry changes.
  - **Must NOT do**: Do not weaken checks or skip CI scripts.
  - **Owning files/modules**: `scripts/checks/**`, `packages/protocol/scripts/**`, generated fixtures if any.
  - **Recommended Agent Profile**: Category `quick` — mechanical CI alignment. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO | Wave W0 | Blocks: W0 PR merge | Blocked By: `§0.2`, `§0.4`.
  - **References**: `package.json:14-28`; `scripts/checks/**`.
  - **Acceptance Criteria**: `pnpm events:check`, `pnpm visibility:check`, `pnpm schema:check`, `pnpm subscriptions:check`, `pnpm command:check` exit 0; evidence `task-0-5-ci-checks/checks.log`.
  - **QA Scenarios**:
    ```
    Scenario: New event checks pass
      Tool: Bash
      Steps: run events:check and visibility:check.
      Expected: exit 0.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-5-ci-checks/events-visibility.log

    Scenario: No unrelated registry breakage
      Tool: Bash
      Steps: run schema/subscriptions/command checks.
      Expected: exit 0; no missing subscriber for durable v05 events.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-5-ci-checks/other-checks.log
    ```
  - **Commit**: YES | Message: `test(checks): align v05 event validation` | Files: check fixtures/scripts only if needed.

- [x] §0.6 Unit tests for `HeuristicBriefGenerator`
  - **Spec refs**: `context-ledger/BriefGenerator 接口（V0.5 启发式 / V1.2 LLM）`.
  - **What to do**: Ensure named tests cover first-sentence truncation, Chinese/English punctuation, code-block skipping, failure template, cancel template, parse fallback, artifact suffix only when nonzero.
  - **Must NOT do**: Do not duplicate tests already covered unless naming/evidence is missing.
  - **Owning files/modules**: `packages/context/test/**`.
  - **Recommended Agent Profile**: Category `quick` — focused test completion. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES after `§0.3` | Wave W0 | Blocks: W0 PR merge | Blocked By: `§0.3`.
  - **References**: `packages/context/test/**`; `openspec/.../specs/context-ledger/spec.md`.
  - **Acceptance Criteria**: `pnpm --filter @agenthub/context test --run brief-generator` exit 0; coverage names listed in evidence `task-0-6-brief-tests/test-list.md`.
  - **QA Scenarios**:
    ```
    Scenario: All required cases named
      Tool: Bash
      Steps: run vitest reporter and inspect test names.
      Expected: seven required behavior names appear and pass.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-6-brief-tests/names.json

    Scenario: Artifact suffix omitted when zero
      Tool: Bash
      Steps: run zero-count test.
      Expected: no artifacts suffix in output.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-0-6-brief-tests/zero-artifacts.json
    ```
  - **Commit**: YES | Message: `test(context): cover heuristic brief generator` | Files: context tests.

### Wave W1 — OpenCode, Claude Hooks, Agent Templates (`§1.*`, `§2.*`, `§3.*`)

- [x] §1.1 Research OpenCode ACP bridge package and record decision
  - **Spec refs**: `design/V05-D1`.
  - **What to do**: Consume PF.2 result, update `openspec/changes/add-v05-chatroom-complete/design.md` V05-1 with selected package/version/spawn mode and docs link.
  - **Must NOT do**: Do not start adapter implementation if PF.2 is unresolved.
  - **Owning files/modules**: `design.md`; `.sisyphus/notepads/v05-chatroom-complete/opencode-bridge-decision.md`.
  - **Recommended Agent Profile**: Category `quick` — records already researched decision. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO | Wave W1A | Blocks: `§1.2`, `§1.5`, `§1.7` | Blocked By: PF.2.
  - **References**: `packages/adapters/acp-base/src/index.ts`; `packages/adapters/opencode/src/index.ts`; `design.md:65-80,337-348`.
  - **Acceptance Criteria**: decision notepad exists; `design.md` V05-1 status changed from unresolved to selected package with source URL; `openspec.cmd validate add-v05-chatroom-complete --strict` exits 0.
  - **QA Scenarios**:
    ```
    Scenario: Package decision recorded
      Tool: Bash
      Steps: grep V05-1 section and run openspec strict.
      Expected: selected package/version visible; strict validation passes.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-1-opencode-research/decision.md

    Scenario: Research unresolved
      Tool: Bash
      Steps: inspect notepad for unresolved marker.
      Expected: implementation tasks remain blocked and issue file exists.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-1-opencode-research/blocker.md
    ```
  - **Commit**: YES | Message: `docs(spec): record opencode acp bridge decision` | Files: `design.md`, notepad if committed.

- [x] §1.2 Implement `OpenCodeACPAdapter extends ACPAdapter`
  - **Spec refs**: `adapter-framework/OpenCodeACPAdapter 真实现`.
  - **What to do**: Replace stub with `OpenCodeACPAdapter` that overrides only `spawnArgs()`, `detect()`, `mapProviderEvent()`, `mapProviderError()` and inherits state machine, pending table, line splitter, supervision, liveness, cancel/dispose, and `wrapExternalContent` integration.
  - **Must NOT do**: Do not copy `ACPAdapter` base internals; do not change `AgentRuntimeAdapter`/`AdapterManifest`/`ACPAdapter` interfaces.
  - **Owning files/modules**: `packages/adapters/opencode/src/index.ts`, opencode tests.
  - **Recommended Agent Profile**: Category `unspecified-high` — adapter runtime integration. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES with W1B/W1C | Wave W1A | Blocks: `§1.5`, `§1.7` | Blocked By: `§1.1`.
  - **Protected contract checkpoint**: AdapterManifest/ACPAdapter base; Oracle review in W1 PR.
  - **References**: `packages/adapters/acp-base/src/index.ts`; `packages/adapters/claude-code/src/index.ts`; `adapter-framework/spec.md:5-80`.
  - **Acceptance Criteria**: `pnpm --filter @agenthub/adapters-opencode test` exit 0; manifest declares exact spec capabilities/reliability/context/workspace fields; typecheck passes.
  - **QA Scenarios**:
    ```
    Scenario: startRun uses base class
      Tool: Bash
      Steps: unit test spies on inherited ACPAdapter.startRun path with OpenCode spawnArgs.
      Expected: base path invoked; only override methods differ.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-2-opencode-adapter/start-run.json

    Scenario: Interface drift rejected
      Tool: Bash
      Steps: run typecheck and adapter manifest consistency test.
      Expected: no changes required to ACPAdapter or AgentRuntimeAdapter types.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-2-opencode-adapter/contracts.log
    ```
  - **Commit**: YES | Message: `feat(adapter): implement opencode acp adapter` | Files: `packages/adapters/opencode/**` only unless manifest registry requires update.

- [x] §1.3 Implement `OpenCodeACPAdapter.detect()`
  - **Spec refs**: `adapter-framework/OpenCodeACPAdapter 真实现`.
  - **What to do**: Detect `opencode` via Windows `where opencode` and macOS/Linux `bash -lc 'command -v opencode'`; return binary/version list or `[]` without blocking daemon.
  - **Must NOT do**: Do not throw when binary is missing; do not require OpenCode for daemon startup.
  - **Owning files/modules**: `packages/adapters/opencode/src/index.ts`, tests.
  - **Recommended Agent Profile**: Category `quick` — isolated detection logic. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES after `§1.2` skeleton | Wave W1A | Blocks: `§1.7` | Blocked By: `§1.2`.
  - **References**: `adapter-framework/spec.md:45-57`.
  - **Acceptance Criteria**: tests mock PATH present/missing on win32/linux; missing returns `[]`; present returns `{id,binary,version}`; `pnpm --filter @agenthub/adapters-opencode test --run detect` exits 0.
  - **QA Scenarios**:
    ```
    Scenario: Binary present
      Tool: Bash
      Steps: run detect test with mocked command output.
      Expected: adapter returns one detection with id=opencode and version.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-3-opencode-detect/present.json

    Scenario: Binary absent
      Tool: Bash
      Steps: run detect test with command failure.
      Expected: [] and no thrown error.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-3-opencode-detect/absent.json
    ```
  - **Commit**: YES | Message: `feat(adapter): detect opencode cli` | Files: opencode adapter/tests.

- [x] §1.4 Implement `attachSession(input)` for resumable OpenCode
  - **Spec refs**: `adapter-framework/OpenCodeACPAdapter 真实现`.
  - **What to do**: Implement resumable attach path consistent with `crashRecovery: "resumable"` so ReclaimStaleClaimedRun can restore session by `adapterSessionId`.
  - **Must NOT do**: Do not restart OpenCode subprocess when attach is possible; do not mark crashRecovery resumable without implementation.
  - **Owning files/modules**: `packages/adapters/opencode/src/index.ts`, recovery/adapter tests.
  - **Recommended Agent Profile**: Category `unspecified-high` + `oracle` review — crash recovery contract. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO within W1A | Blocks: `§1.7` | Blocked By: `§1.2`.
  - **Protected contract checkpoint**: Adapter crashRecovery/manifest consistency; Oracle review mandatory.
  - **References**: `adapter-framework/spec.md:66-73`; `packages/orchestrator/src/recovery.ts`.
  - **Acceptance Criteria**: manifest consistency check passes; recovery test simulates pid mismatch + sessionId and asserts `attachSession` path invoked; no new adapter base API.
  - **QA Scenarios**:
    ```
    Scenario: Reclaim stale run attaches session
      Tool: Bash
      Steps: unit/integration test stuck running run with adapterSessionId.
      Expected: attachSession called and run resumes markRunning/updateSessionState path.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-4-attach-session/reclaim.json

    Scenario: Missing session fails honestly
      Tool: Bash
      Steps: attach with nonexistent session.
      Expected: typed adapter error; recovery does not falsely mark resumed.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-4-attach-session/missing.json
    ```
  - **Commit**: YES | Message: `feat(adapter): attach opencode sessions` | Files: opencode adapter/recovery tests.

- [x] §1.5 Map OpenCode native events to `AcpProviderEvent`
  - **Spec refs**: `adapter-framework/OpenCodeACPAdapter 真实现`.
  - **What to do**: Implement provider event/error mapping using PF.2 docs and Claude adapter mapping as pattern; include prompt/tool/permission/subagent/context snapshot/cancel/error paths supported by OpenCode.
  - **Must NOT do**: Do not fabricate capabilities OpenCode does not expose; manifest must be honest.
  - **Owning files/modules**: `packages/adapters/opencode/src/index.ts`, tests.
  - **Recommended Agent Profile**: Category `unspecified-high` — event normalization. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO within W1A | Blocks: `§1.7` | Blocked By: `§1.1`, `§1.2`.
  - **References**: `packages/adapters/claude-code/src/index.ts`; `adapter-framework/spec.md:58-65`; `context-ledger/spec.md:113-117`.
  - **Acceptance Criteria**: table-driven tests for every mapped native event; unsupported/parse-failure events are skipped/logged per `parseFailure: "skip_event"`; `pnpm --filter @agenthub/adapters-opencode test --run map` exits 0.
  - **QA Scenarios**:
    ```
    Scenario: Subagent event maps
      Tool: Bash
      Steps: feed sample native subagent start/stop events.
      Expected: AcpProviderEvent subagent.started/completed with cost/duration where present.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-5-opencode-mapping/subagent.json

    Scenario: Unknown event skipped
      Tool: Bash
      Steps: feed unsupported native event.
      Expected: no crash; skip_event behavior asserted.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-5-opencode-mapping/unknown.json
    ```
  - **Commit**: YES | Message: `feat(adapter): map opencode acp events` | Files: opencode adapter/tests.

- [x] §1.6 Confirm builder-opencode default model and feed template content
  - **Spec refs**: `agents/内置 Agent（MVP 必带）`; `design/V05-5`.
  - **What to do**: Consume PF.3 model decision and provide exact frontmatter values to `§3.1`; if model is CLI-default implicit, document whether `model` is omitted or set.
  - **Must NOT do**: Do not write template in adapter package; `§3.1` owns final template files.
  - **Owning files/modules**: model decision notepad; `design.md` if updated.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES with `§1.2` after PF.3 | Blocks: `§3.1` | Blocked By: PF.3.
  - **References**: `agents/spec.md:15-24`; `design.md:347`.
  - **Acceptance Criteria**: decision recorded with exact template frontmatter snippet; `openspec strict` passes if design changed.
  - **QA Scenarios**:
    ```
    Scenario: Default model documented
      Tool: Bash
      Steps: inspect opencode decision notepad.
      Expected: frontmatter snippet includes provider=opencode, adapterId=opencode-default, model decision.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-6-opencode-model/snippet.md

    Scenario: Unknown model handled
      Tool: Bash
      Steps: inspect issue or decision note.
      Expected: no invented model; escalation or documented omit-model strategy.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-6-opencode-model/unknown.md
    ```
  - **Commit**: YES if design/notepad tracked | Message: `docs(spec): record opencode default model` | Files: `design.md`/notepad.

- [x] §1.7 Integration tests for OpenCodeACPAdapter detect/startRun/cancel
  - **Spec refs**: `adapter-framework/OpenCodeACPAdapter 真实现`.
  - **What to do**: Add integration tests that run with `OPENCODE_BIN` or detected binary and skip cleanly otherwise; cover detect, startRun, cooperative cancel.
  - **Must NOT do**: Do not fail CI on machines without OpenCode binary; do not hide failures when `OPENCODE_BIN` is set.
  - **Owning files/modules**: `packages/adapters/opencode/test/**`.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO | Wave W1A | Blocks: W1A PR | Blocked By: `§1.2`–`§1.5`.
  - **References**: `adapter-framework/spec.md:74-80`.
  - **Acceptance Criteria**: `pnpm --filter @agenthub/adapters-opencode test` passes; when `OPENCODE_BIN` absent test output includes `[skipped: opencode binary not found]`; when present start/cancel path passes.
  - **QA Scenarios**:
    ```
    Scenario: No binary skip
      Tool: Bash
      Steps: run tests without OPENCODE_BIN.
      Expected: integration test skipped with explicit reason; unit tests pass.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-7-opencode-integration/skip.log

    Scenario: Real binary cancel
      Tool: Bash
      Steps: run with OPENCODE_BIN set, start a run then cancel.
      Expected: AdapterError user_cancelled and RunLifecycle cancel path observed.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-1-7-opencode-integration/cancel.log
    ```
  - **Commit**: YES | Message: `test(adapter): cover opencode integration smoke` | Files: opencode tests.

- [x] §2.1 Emit `context.snapshot` for Claude `pre_compact`
  - **Spec refs**: `adapter-framework/ClaudeCodeAdapter 事件映射`; `context-ledger/长会话压缩 → ContextItem.summary`.
  - **What to do**: Map Claude `pre_compact` provider event to adapter event `context.snapshot` with `{kind:"claude_compact", text}` and `idempotencyKey="claude_compact:<runId>"`.
  - **Must NOT do**: Do not confirm context automatically; generated ContextItem remains draft.
  - **Owning files/modules**: `packages/adapters/claude-code/src/index.ts`, tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES in W1B with `§1.*` | Blocks: `§2.4`, `§7.8` | Blocked By: `§0.2`.
  - **References**: `packages/adapters/claude-code/src/index.ts`; `adapter-framework/spec.md:139-145`.
  - **Acceptance Criteria**: unit test maps sample pre_compact to exact event payload/idempotencyKey; `pnpm --filter @agenthub/adapters-claude-code test --run pre_compact` exits 0.
  - **QA Scenarios**:
    ```
    Scenario: PreCompact maps snapshot
      Tool: Bash
      Steps: feed sample pre_compact provider event.
      Expected: context.snapshot event with claude_compact and idempotencyKey.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-2-1-claude-precompact/map.json

    Scenario: Empty compact text rejected gracefully
      Tool: Bash
      Steps: feed malformed/empty event.
      Expected: no crash; mapped error/skip per adapter convention.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-2-1-claude-precompact/malformed.json
    ```
  - **Commit**: YES | Message: `feat(adapter): map claude precompact snapshots` | Files: claude adapter/tests.

- [x] §2.2 Emit `subagent.started` / `subagent.completed` for Claude
  - **Spec refs**: `adapter-framework/ClaudeCodeAdapter 事件映射`.
  - **What to do**: Map `subagent_start` and `subagent_stop` provider events to durable detail events including runId/subagentId/role and cost/duration on completion.
  - **Must NOT do**: Do not expose subagent events to main timeline.
  - **Owning files/modules**: `packages/adapters/claude-code/src/index.ts`, protocol event payloads if missing, tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES after `§0.2` | Wave W1B | Blocks: `§7.8`.
  - **References**: `adapter-framework/spec.md:147-153`; `packages/protocol/src/events/registry.ts`.
  - **Acceptance Criteria**: mapping tests for start/stop; `visibility:check` confirms detail; parent run cost accumulation test if adapter bridge owns aggregation.
  - **QA Scenarios**:
    ```
    Scenario: Subagent start visible in detail
      Tool: Bash
      Steps: map start event and inspect registry visibility.
      Expected: subagent.started durable/detail.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-2-2-claude-subagent/start.json

    Scenario: Subagent completion includes cost
      Tool: Bash
      Steps: map stop event with cost/duration.
      Expected: payload contains cost and duration; parent aggregation path covered or issue logged.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-2-2-claude-subagent/stop.json
    ```
  - **Commit**: YES | Message: `feat(adapter): emit claude subagent events` | Files: claude adapter/tests.

- [x] §2.3 Emit `artifact.diff.detected` marker for Claude post tool use
  - **Spec refs**: `adapter-framework/ClaudeCodeAdapter 事件映射`; `event-system/事件分级`.
  - **What to do**: On file-writing `tool/post_use`, emit `artifact.diff.detected {runId,path}` in addition to existing `tool.call.completed`/`file.changed`.
  - **Must NOT do**: Do not create artifact rows; do not emit `artifact.diff.created`; do not show marker in main timeline.
  - **Owning files/modules**: `packages/adapters/claude-code/src/index.ts`, adapter bridge/projector tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES with `§2.1/§2.2` if same file ownership is serialized in W1B | Blocks: `§7.8` | Blocked By: `§0.2`.
  - **Protected contract checkpoint**: artifact event semantics; Oracle review required.
  - **References**: `adapter-framework/spec.md:131-138`; `event-system/spec.md:41-45`.
  - **Acceptance Criteria**: unit test asserts write path emits marker; event visibility test proves main SSE excludes and detail SSE includes; no artifact row created until final diff builder.
  - **QA Scenarios**:
    ```
    Scenario: Write emits marker only
      Tool: Bash
      Steps: simulate Write tool post_use for src/foo.ts.
      Expected: file.changed + artifact.diff.detected; no artifact.diff.created.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-2-3-diff-detected/write.json

    Scenario: Main timeline excluded
      Tool: Bash
      Steps: run visibility projection test for main/detail views.
      Expected: main excludes marker; detail receives marker.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-2-3-diff-detected/visibility.json
    ```
  - **Commit**: YES | Message: `feat(adapter): emit diff detected markers` | Files: claude adapter/tests.

- [x] §2.4 ContextLedger proposes draft summary from `context.snapshot`
  - **Spec refs**: `context-ledger/长会话压缩 → ContextItem.summary`.
  - **What to do**: Add consumer/handler so `context.snapshot` creates idempotent draft `ContextItem.summary` with `source.kind="tool"` and adapter-specific source id.
  - **Must NOT do**: Do not mark item confirmed; do not duplicate drafts for same idempotencyKey.
  - **Owning files/modules**: `packages/context/**`, orchestrator/event handler registration if existing pattern requires.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO with `§2.1` consumer final wiring | Wave W1B | Blocks: `§7.8` | Blocked By: `§2.1`, `§0.2`.
  - **References**: `packages/context/src/index.ts`; `context-ledger/spec.md:92-117`.
  - **Acceptance Criteria**: integration test publishes duplicate `context.snapshot` twice and asserts one draft summary; Context view event/projection unchanged for confirmed flow.
  - **QA Scenarios**:
    ```
    Scenario: Snapshot creates draft summary
      Tool: Bash
      Steps: publish context.snapshot with idempotencyKey.
      Expected: one ContextItem type=summary status=draft confidence=inferred.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-2-4-context-snapshot/draft.json

    Scenario: Duplicate idempotency suppressed
      Tool: Bash
      Steps: publish same snapshot twice.
      Expected: only one draft row/propose call.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-2-4-context-snapshot/idempotent.json
    ```
  - **Commit**: YES | Message: `feat(context): propose compact summaries` | Files: context/event handler tests.

- [x] §2.5 Real Claude integration tests for tool/ask/diff/cancel
  - **Spec refs**: `adapter-framework/ClaudeCodeAdapter 事件映射`.
  - **What to do**: Add `@integration:claude-code` tests that skip when `claude` binary is unavailable; cover single run with Read/Write/Bash, ask allow, diff apply, cancel interrupt.
  - **Must NOT do**: Do not require real Claude binary in normal CI; do not skip when env explicitly opts in.
  - **Owning files/modules**: `packages/adapters/claude-code/test/**`, integration fixtures.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO | Wave W1B | Blocks: W1B PR | Blocked By: `§2.1`–`§2.4`.
  - **References**: `adapter-framework/spec.md:155-159`.
  - **Acceptance Criteria**: `pnpm --filter @agenthub/adapters-claude-code test` passes with skip when binary absent; opt-in run records permission, allow, diff apply, cancel evidence.
  - **QA Scenarios**:
    ```
    Scenario: Binary absent skip
      Tool: Bash
      Steps: run integration tests without claude binary.
      Expected: explicit skip; package tests pass.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-2-5-claude-integration/skip.log

    Scenario: Opt-in real run closes loop
      Tool: Bash
      Steps: run with CLAUDE_BIN set and fixture workspace.
      Expected: permission requested/resolved, diff applied, cancel finalized.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-2-5-claude-integration/real-run.log
    ```
  - **Commit**: YES | Message: `test(adapter): cover claude integration hooks` | Files: claude integration tests.

- [x] §3.1 Write seven built-in agent markdown templates
  - **Spec refs**: `agents/内置 Agent（MVP 必带）`.
  - **What to do**: Create source templates for `mock-builder`, `mock-reviewer`, `claude-code-builder`, `claude-code-reviewer`, `builder-opencode`, `reviewer`, `archivist`, all with `version: 1.0.0` frontmatter and spec capabilities/defaultPresence.
  - **Must NOT do**: Do not overwrite user files during template definition; do not create only 4 templates.
  - **Owning files/modules**: `packages/agents/**` or daemon-owned template module decided by W1C; tests.
  - **Recommended Agent Profile**: Category `quick` — template content. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES in W1C after PF.3 | Blocks: `§3.2`, `§3.4` | Blocked By: `§1.6` for opencode model.
  - **References**: `agents/spec.md:5-42`; `packages/agents/package.json`.
  - **Acceptance Criteria**: snapshot test parses all 7 templates and validates ids/provider/capabilities/defaultPresence/version; `pnpm --filter @agenthub/agents test` or package-equivalent exits 0.
  - **QA Scenarios**:
    ```
    Scenario: Seven templates parse
      Tool: Bash
      Steps: run template parser test.
      Expected: exactly 7 valid templates with version 1.0.0.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-3-1-agent-templates/parse.json

    Scenario: builder-opencode provider correct
      Tool: Bash
      Steps: inspect parsed builder-opencode frontmatter.
      Expected: provider=opencode, adapterId=opencode-default, terminal.run capability.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-3-1-agent-templates/opencode.json
    ```
  - **Commit**: YES | Message: `feat(agents): add builtin agent templates` | Files: agents package/template tests.

- [x] §3.2 Implement first-launch template write/update-warning logic
  - **Spec refs**: `agents/内置 Agent（MVP 必带）`.
  - **What to do**: On daemon startup, ensure `~/.agenthub/agents/`; per-template if file missing write it; if existing version older, stderr warning only; never overwrite user-edited files.
  - **Must NOT do**: Do not use a global first-launch flag; behavior is per-file existence/version.
  - **Owning files/modules**: daemon startup/bootstrap module, `packages/agents/**`, tests.
  - **Recommended Agent Profile**: Category `unspecified-high` — startup filesystem behavior. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO within W1C | Blocks: `§3.3`, `§3.4` | Blocked By: `§3.1`.
  - **References**: `agents/spec.md:25-35`; `packages/daemon/src/index.ts` startup pattern.
  - **Acceptance Criteria**: tests cover missing dir, empty dir, same-name skip, older version warning, daemon non-blocking; no user file overwrite.
  - **QA Scenarios**:
    ```
    Scenario: Empty agents dir gets templates
      Tool: Bash
      Steps: run startup bootstrap test with temp home.
      Expected: seven .md files written.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-3-2-first-launch/write.json

    Scenario: Older user file warned not overwritten
      Tool: Bash
      Steps: seed builder-opencode.md with old version and custom body.
      Expected: stderr warning; body unchanged.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-3-2-first-launch/version-warning.json
    ```
  - **Commit**: YES | Message: `feat(agents): seed builtin templates on startup` | Files: agents/daemon bootstrap tests.

- [x] §3.3 Implement AgentProfile chokidar hot reload
  - **Spec refs**: `agents/AgentProfile 数据模型`; `event-system/事件分级`.
  - **What to do**: Upgrade stub to watch user/workspace agents dirs; parse markdown with gray-matter; upsert V0.5 DB columns; emit `agent.profile.updated`, `agent.profile.removed`, `agent.profile.error`; preserve running Run snapshots.
  - **Must NOT do**: Do not delete old DB row on parse failure; do not affect in-flight Runs.
  - **Owning files/modules**: `packages/agents/**`, daemon watcher registration, `packages/db/src/schema.ts` if type mapping needs update.
  - **Recommended Agent Profile**: Category `unspecified-high` — file watcher + DB/event integration. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO within W1C | Blocks: agents API/UI visibility | Blocked By: `§0.1`, `§0.2`, `§3.2`.
  - **Protected contract checkpoint**: event registry usage; no new unregistered event types.
  - **References**: `agents/spec.md:43-167`; `packages/db/src/schema.ts:38-51`.
  - **Acceptance Criteria**: tests cover add/change/unlink/parse error, workspace override, runtime workspace watcher addition; `pnpm subscriptions:check` passes if new durable event subscriber needed.
  - **QA Scenarios**:
    ```
    Scenario: Change upserts profile
      Tool: Bash
      Steps: write temp markdown, wait for chokidar awaitWriteFinish.
      Expected: agent_profiles row updated with provider/default_presence/avatar/description/version.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-3-3-chokidar/change.json

    Scenario: Parse failure preserves old row
      Tool: Bash
      Steps: save invalid frontmatter over existing profile.
      Expected: old row remains; agent.profile.error emitted; stderr warning.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-3-3-chokidar/error.json
    ```
  - **Commit**: YES | Message: `feat(agents): hot reload agent profiles` | Files: agents/daemon/db tests.

- [x] §3.4 Implement `agenthub agents reset --id=<agentId>`
  - **Spec refs**: `local-daemon/daemon CLI 子命令`; `agents/内置 Agent（MVP 必带）`.
  - **What to do**: Add CLI reset subcommand that overwrites one built-in template from source templates to `~/.agenthub/agents/<id>.md`, with validation for unknown id.
  - **Must NOT do**: Do not reset all agents unless explicitly requested by future spec; do not touch daemon auth commands in this task except shared CLI module setup from PF.7.
  - **Owning files/modules**: `apps/cli/src/index.ts` or `apps/cli/src/commands/agents.ts`, agents template export.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO with `§5.5` edits to CLI | Blocks: `§5.5` collision plan | Blocked By: PF.7, `§3.1`.
  - **References**: `local-daemon/spec.md:18`; `apps/cli/src/index.ts`.
  - **Acceptance Criteria**: CLI test `agenthub agents reset --id=builder-opencode` writes template and exits 0; unknown id exits nonzero with clear error.
  - **QA Scenarios**:
    ```
    Scenario: Reset known builtin
      Tool: Bash
      Steps: run CLI against temp HOME with --id=builder-opencode.
      Expected: file overwritten with built-in template and version 1.0.0.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-3-4-agents-reset/reset.json

    Scenario: Unknown id rejected
      Tool: Bash
      Steps: run CLI --id=not-real.
      Expected: exit 1 and list valid ids.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-3-4-agents-reset/unknown.log
    ```
  - **Commit**: YES | Message: `feat(cli): reset builtin agent templates` | Files: CLI/agents template export tests.

- [x] §3.5 Unit tests for templates and hot reload
  - **Spec refs**: `agents/内置 Agent（MVP 必带）`; `agents/AgentProfile 数据模型`.
  - **What to do**: Ensure focused tests exist for first-launch write, same-name skip, version warning, chokidar add/change/unlink, parse failure preserving old row.
  - **Must NOT do**: Do not rely only on manual filesystem testing.
  - **Owning files/modules**: `packages/agents/test/**`, daemon/CLI tests as appropriate.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES after `§3.2/§3.3` | Blocks: W1C PR | Blocked By: `§3.2`, `§3.3`.
  - **References**: `agents/spec.md:25-167`.
  - **Acceptance Criteria**: `pnpm --filter @agenthub/agents test` and relevant daemon/CLI test filters exit 0; evidence lists each required test name.
  - **QA Scenarios**:
    ```
    Scenario: Required hot-reload tests pass
      Tool: Bash
      Steps: run test filter agent-profile.
      Expected: add/change/unlink/parse-failure tests pass.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-3-5-agent-tests/hot-reload.json

    Scenario: Template bootstrap tests pass
      Tool: Bash
      Steps: run bootstrap test filter.
      Expected: first-launch/same-name/version-warning tests pass.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-3-5-agent-tests/bootstrap.json
    ```
  - **Commit**: YES | Message: `test(agents): cover templates and hot reload` | Files: tests only.

### Wave W2 — Backend, Cost/CLI, Attachments (`§4.*`, `§5.*`, `§6.*`)

- [x] §4.1 Implement `parseMentions(text, members)`
  - **Spec refs**: `orchestrator/Mention 解析`.
  - **What to do**: Add `packages/orchestrator/src/mention-parser.ts` with regex `/(^|\s)@([a-z0-9][a-z0-9-]*)\b/g`, membership validation, dedupe preserving first order/offset.
  - **Must NOT do**: Do not trust frontend mentions; backend remains authoritative.
  - **Owning files/modules**: `packages/orchestrator/src/mention-parser.ts`, orchestrator tests.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES in W2A | Blocks: `§4.2`, `§7.1` | Blocked By: W1 merge.
  - **References**: `orchestrator/spec.md:87-114`; `packages/orchestrator/src/commands.ts`.
  - **Acceptance Criteria**: tests for email non-match, nonexistent ignored/warnable, multi-mention dedupe/order, frontend-forged id rejected; `pnpm --filter @agenthub/orchestrator test --run mention-parser` exit 0.
  - **QA Scenarios**:
    ```
    Scenario: Email not mention
      Tool: Bash
      Steps: parse "reviewer@example.com".
      Expected: []
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-1-mention-parser/email.json

    Scenario: Duplicate mentions dedupe
      Tool: Bash
      Steps: parse "@reviewer x @security y @reviewer" with both members.
      Expected: reviewer then security only.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-1-mention-parser/dedupe.json
    ```
  - **Commit**: YES | Message: `feat(orchestrator): parse agent mentions` | Files: orchestrator parser/tests.

- [x] §4.2 Wire mention parsing into `SendMessage` dispatch
  - **Spec refs**: `orchestrator/Assisted 模式调度`.
  - **What to do**: In SendMessage handler, for Assisted rooms parse mentions; no mentions → wake primary; mentions with primary → wake primary + mentioned observers; mentions without primary → wake only mentioned agents in textual order; idempotency key `wake:<messageId>:<agentId>`.
  - **Must NOT do**: Do not dispatch adapter directly; do not wake primary when mentions omit primary.
  - **Owning files/modules**: `packages/daemon/src/commands.ts` or orchestrator command handler per existing ownership, `packages/orchestrator/src/commands.ts`, tests.
  - **Recommended Agent Profile**: Category `unspecified-high` — WakeAgent dispatch semantics. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO with other edits to command handler | Blocks: `§7.1` E2E | Blocked By: `§4.1`.
  - **Protected contract checkpoint**: WakeAgent only model-call entry; no `StartRun`.
  - **References**: `orchestrator/spec.md:46-86`; `packages/orchestrator/src/commands.ts`; `packages/daemon/src/commands.ts`.
  - **Acceptance Criteria**: integration test sends `@reviewer` in Assisted room and asserts WakeAgent reviewer reason=`user_mention`, builder primary not dispatched; no-mention message wakes primary only; `pnpm command:check` exit 0 if command metadata changed.
  - **QA Scenarios**:
    ```
    Scenario: Mention without primary skips primary
      Tool: Bash
      Steps: SendMessage("@reviewer 检查这个") in room primary=builder.
      Expected: WakeAgent reviewer only, no builder wake.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-2-assisted-mentions/no-primary.json

    Scenario: No mention wakes primary
      Tool: Bash
      Steps: SendMessage("please continue") in Assisted room.
      Expected: WakeAgent builder reason=primary_turn only.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-2-assisted-mentions/default-primary.json
    ```
  - **Commit**: YES | Message: `feat(orchestrator): dispatch mentioned agents` | Files: command/orchestrator tests.

- [x] §4.3 Implement `RoomMcpServer.handleSendMessage` group discipline
  - **Spec refs**: `orchestrator/群聊纪律执行器（Observer 发言降级）`.
  - **What to do**: Enforce observer `presence != active` downgrade to mailbox; allow active observer after knock with audit log; primary in active wake sends main message.
  - **Must NOT do**: Do not simply reject observer messages; do not let observing agents write main timeline.
  - **Owning files/modules**: `packages/orchestrator/src/mcp/**`, mailbox service, audit log target from PF.8, tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES with `§4.4` if different files | Blocks: chat discipline UI evidence | Blocked By: PF.8.
  - **Protected contract checkpoint**: mailbox/message event semantics; audit log security path.
  - **References**: `orchestrator/spec.md:5-43`; `packages/orchestrator/src/mcp/`.
  - **Acceptance Criteria**: tests for observing downgrade, active observer allowed + audit, primary allowed; main timeline event absent on downgrade.
  - **QA Scenarios**:
    ```
    Scenario: Observing observer downgraded
      Tool: Bash
      Steps: call room.send_message as reviewer presence=observing.
      Expected: mailbox.message.created, no message.created, response degraded=true.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-3-group-discipline/downgrade.json

    Scenario: Approved observer speaks
      Tool: Bash
      Steps: set reviewer presence=active after intervention, call send_message.
      Expected: message.created plus audit log observer_speaking_after_knock.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-3-group-discipline/active.json
    ```
  - **Commit**: YES | Message: `feat(orchestrator): enforce observer chat discipline` | Files: orchestrator MCP/mailbox/audit tests.

- [x] §4.4 Implement status line throttling
  - **Spec refs**: `orchestrator/状态行节流`.
  - **What to do**: Add daemon-side BoundedPubSub `status_line` coalesce/flush per `(agentId,roomId)` every 30s with boundary forced flush; coordinate client Projector throttle with `§8.7` owner to avoid conflict.
  - **Must NOT do**: Do not throttle durable run boundary events; do not hide working→idle transitions.
  - **Owning files/modules**: daemon/orchestrator PubSub channel; `apps/web/src/hooks/useProjector.ts` client throttle either here or deferred to `§8.7` with explicit handoff.
  - **Recommended Agent Profile**: Category `unspecified-high` + Oracle review — dual-layer real-time behavior. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO with `§8.7` client file edits | Blocks: W2 PR | Blocked By: W1.
  - **Protected contract checkpoint**: event visibility and passive observe invariant.
  - **References**: `orchestrator/spec.md:115-140`; `apps/web/src/hooks/useProjector.ts`.
  - **Acceptance Criteria**: tests emit 20 updates over simulated 60s and assert two visible SSE flushes plus immediate boundary flush; evidence includes fake timer logs.
  - **QA Scenarios**:
    ```
    Scenario: 30s coalesce
      Tool: Bash
      Steps: fake-timer emit status every 3s for 60s.
      Expected: t=0 and t=30 visible updates with latest payload.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-4-status-throttle/coalesce.json

    Scenario: Boundary forced flush
      Tool: Bash
      Steps: emit status then agent.run.completed at t=10.
      Expected: immediate flush at completion.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-4-status-throttle/boundary.json
    ```
  - **Commit**: YES | Message: `feat(orchestrator): throttle status lines` | Files: PubSub/projector tests per ownership note.

- [x] §4.5 Emit `mailbox.delivery.failed`
  - **Spec refs**: `messaging/mailbox.delivery.failed 失败可见性事件`.
  - **What to do**: Implement claim_conflict, target_unavailable, max_retries detection; increment `attempt_count` at PF.6 site; write `delivery_failure_reason`; add in-memory 5-minute LRU 256 dedupe with metric counter.
  - **Must NOT do**: Do not change mailbox read state contract; do not persist LRU dedupe unless spec changes.
  - **Owning files/modules**: `packages/orchestrator/src/mailbox-service.ts`, terminal hook, event payloads/tests.
  - **Recommended Agent Profile**: Category `unspecified-high` + Oracle review. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO with mailbox edits | Blocks: `§7.6` | Blocked By: `§0.1`, `§0.2`, PF.6.
  - **Protected contract checkpoint**: durable event and mailbox atomicity.
  - **References**: `messaging/spec.md:5-55`; `packages/orchestrator/src/mailbox-service.ts`; `packages/db/src/schema.ts:317-333`.
  - **Acceptance Criteria**: integration test forces concurrent claim conflict, max retries, target unavailable, dedupe; `pnpm subscriptions:check` exits 0.
  - **QA Scenarios**:
    ```
    Scenario: Claim conflict emits once
      Tool: Bash
      Steps: two concurrent room.read_mailbox attempts on same row.
      Expected: second emits one mailbox.delivery.failed reason=claim_conflict; Run continues.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-5-mailbox-failure/claim-conflict.json

    Scenario: Dedupe suppresses storm
      Tool: Bash
      Steps: retry same mailbox/reason 10 times within 60s then after 5min.
      Expected: first and post-window emit; 9 suppressed; attempt_count increments.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-5-mailbox-failure/dedupe.json
    ```
  - **Commit**: YES | Message: `feat(messaging): emit mailbox delivery failures` | Files: orchestrator/mailbox tests/protocol if needed.

- [x] §4.6 Implement cursor-based message pagination
  - **Spec refs**: `messaging/消息列表分页`.
  - **What to do**: Implement `GET /messages?roomId=&before=&after=&limit=&includeDeleted=` keyset pagination with base64 `{createdAt,id}` cursor and `(created_at,id)` ordering.
  - **Must NOT do**: Do not use OFFSET; do not assume UUID id ordering equals time.
  - **Owning files/modules**: `packages/daemon/src/index.ts`, message query service/routes, SDK types/tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES with non-daemon-conflicting W2 tasks | Blocks: web pagination/virtualization | Blocked By: `§0.1`.
  - **References**: `messaging/spec.md:58-106`; `packages/daemon/src/index.ts`; `packages/db/src/schema.ts:66-93`.
  - **Acceptance Criteria**: API tests for latest page, before cursor, after cursor, limit cap 200, includeDeleted; index used where testable.
  - **QA Scenarios**:
    ```
    Scenario: Latest page returns before cursor
      Tool: Bash
      Steps: seed 75 messages, GET limit=50.
      Expected: 50 DESC messages, hasMore=true, before cursor oldest returned.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-6-message-pagination/latest.json

    Scenario: includeDeleted opt-in
      Tool: Bash
      Steps: seed deleted message and query with/without includeDeleted.
      Expected: deleted excluded by default, included with flag.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-6-message-pagination/deleted.json
    ```
  - **Commit**: YES | Message: `feat(messages): add cursor pagination` | Files: daemon/message tests.

- [x] §4.7 Implement `POST /messages/:id/regenerate`
  - **Spec refs**: `messaging/消息操作（固定 6 个）`.
  - **What to do**: Implement `RegenerateMessage` CommandBus handler: assistant-only, cancel old assistant message, trigger new run through WakeAgent with prior context excluding old assistant output.
  - **Must NOT do**: Do not regenerate user messages; do not start adapter directly.
  - **Owning files/modules**: command union/handlers, daemon route, orchestrator WakeAgent path, tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO with `§4.8/§4.9` command union edits unless serialized | Blocks: `§7.4` | Blocked By: W1.
  - **Protected contract checkpoint**: Command union and WakeAgent only entry; run lifecycle.
  - **References**: `messaging/spec.md:107-139`; `packages/daemon/src/commands.ts`; `packages/orchestrator/src/commands.ts`.
  - **Acceptance Criteria**: route/handler tests for assistant success, user 400, idempotency, new WakeAgent dispatch; `pnpm command:check` exits 0.
  - **QA Scenarios**:
    ```
    Scenario: Assistant regenerate
      Tool: Bash
      Steps: POST /messages/m_assistant/regenerate.
      Expected: old message cancelled, message.cancelled event, WakeAgent dispatched for same agent.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-7-regenerate/assistant.json

    Scenario: User regenerate rejected
      Tool: Bash
      Steps: POST /messages/m_user/regenerate.
      Expected: 400 {error:"regenerate is only for assistant messages"}.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-7-regenerate/user-rejected.json
    ```
  - **Commit**: YES | Message: `feat(messages): regenerate assistant messages` | Files: command/daemon tests.

- [x] §4.8 Implement `POST /messages/:id/pin`
  - **Spec refs**: `messaging/消息操作（固定 6 个）`.
  - **What to do**: Implement `PinMessage` CommandBus handler for messages containing ContextItem; promote ContextItem scope to workspace and emit appropriate context/message event.
  - **Must NOT do**: Do not pin arbitrary messages without ContextItem; do not bypass ContextLedger semantics.
  - **Owning files/modules**: command union/handlers, context service integration, daemon route/tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Serialized with `§4.7/§4.9` command union edits | Blocks: `§7.4` | Blocked By: W1.
  - **Protected contract checkpoint**: Command union and ContextLedger scope rules.
  - **References**: `messaging/spec.md:111-129`; `packages/context/src/index.ts`; `packages/daemon/src/commands.ts`.
  - **Acceptance Criteria**: tests for valid ContextItem pin, non-context rejection, idempotency; `pnpm command:check` exits 0.
  - **QA Scenarios**:
    ```
    Scenario: Pin context message
      Tool: Bash
      Steps: POST /messages/m_context/pin.
      Expected: ContextItem scope=workspace and event emitted.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-8-pin/context.json

    Scenario: Non-context pin rejected
      Tool: Bash
      Steps: POST /messages/m_plain/pin.
      Expected: 400 with clear error; no context mutation.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-8-pin/rejected.json
    ```
  - **Commit**: YES | Message: `feat(messages): pin context messages` | Files: command/context tests.

- [x] §4.9 Implement `PATCH /messages/:id` for queued PendingTurn edit
  - **Spec refs**: `messaging/用户 Turn 排队（primary busy 时不阻止发送）`.
  - **What to do**: Add `EditMessage` command path restricted to user message with queued PendingTurn; update message content, cancel old PendingTurn, create new PendingTurn with new enqueuedAt, emit `message.updated`, `pending_turn.cancelled`, `pending_turn.created`.
  - **Must NOT do**: Do not preserve old enqueuedAt; do not allow scheduled/consumed/cancelled edit.
  - **Owning files/modules**: pending turn service, command handler, daemon route, tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Serialized with command union edits | Blocks: `§7.5` | Blocked By: W1.
  - **Protected contract checkpoint**: Command union and PendingTurn atomicity.
  - **References**: `messaging/spec.md:156-230`; `packages/orchestrator/src/pending-turn.ts`; `packages/daemon/src/commands.ts`.
  - **Acceptance Criteria**: tests for queued edit success, scheduled 409, quota retained, event sequence; `pnpm command:check` exits 0.
  - **QA Scenarios**:
    ```
    Scenario: Queued edit requeues
      Tool: Bash
      Steps: PATCH queued message m_3.
      Expected: old pending cancelled, new pending created with later enqueuedAt, message.updated emitted.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-9-pending-edit/queued.json

    Scenario: Scheduled edit rejected
      Tool: Bash
      Steps: PATCH message whose pending turn status=scheduled.
      Expected: 409 {error:"pending_turn_already_scheduled"}; draft can be retained by UI.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-9-pending-edit/scheduled.json
    ```
  - **Commit**: YES | Message: `feat(messages): edit queued pending turns` | Files: pending-turn/command/daemon tests.

- [x] §4.10 Integration tests for chat backend features
  - **Spec refs**: `orchestrator/*`; `messaging/*`.
  - **What to do**: Add/confirm integration tests covering @mention dispatch, group discipline, status throttling, mailbox failure, pagination, regenerate, pin, pending edit. Treat each scenario as a named test even if in one file.
  - **Must NOT do**: Do not leave this as one coarse smoke test.
  - **Owning files/modules**: `packages/orchestrator/test/v05-chat-backend.test.ts` or split per service.
  - **Recommended Agent Profile**: Category `quick` after implementations. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES after corresponding features | Blocks: W2A PR | Blocked By: `§4.1`–`§4.9`.
  - **References**: `packages/orchestrator/test/orchestrator.test.ts`; `packages/daemon/test/**` if present.
  - **Acceptance Criteria**: `pnpm --filter @agenthub/orchestrator test --run v05-chat-backend` and relevant daemon tests exit 0; evidence lists all eight scenario names.
  - **QA Scenarios**:
    ```
    Scenario: All backend feature tests named
      Tool: Bash
      Steps: run test reporter for v05 chat backend file.
      Expected: eight named scenario groups pass.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-10-chat-backend-tests/report.json

    Scenario: Command checks remain green
      Tool: Bash
      Steps: run pnpm command:check and subscriptions:check.
      Expected: exit 0.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-4-10-chat-backend-tests/checks.log
    ```
  - **Commit**: YES | Message: `test(orchestrator): cover v05 chat backend` | Files: tests only unless small fixes needed.

- [x] §5.1 Implement `GET /workspaces/:id/cost-summary`
  - **Spec refs**: `cost-panel-local/单机 Cost 聚合接口`; `cost-panel-local/不区分用户归因`.
  - **What to do**: Add API with read-scope auth, workspace existence 404, groupBy agent/model/day, default 7-day window, local-time day grouping, totals, SLA-friendly SQL using `ended_at` and index.
  - **Must NOT do**: Do not add user attribution, budget fields, materialized views, or new run columns.
  - **Owning files/modules**: `packages/daemon/src/index.ts`, `packages/daemon/src/openapi.ts`, SDK types/tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES in W2B, but coordinate daemon route edits with W2C | Blocks: `§7.9`, `§7.8` Cost tab | Blocked By: `§0.1`.
  - **References**: `cost-panel-local/spec.md:5-128`; `packages/db/src/schema.ts:144-176`.
  - **Acceptance Criteria**: API tests for default agent 7d, model, day, workspace 404, empty data, no userId; curl smoke returns correct shape; query test for 5000 runs <100ms where stable.
  - **QA Scenarios**:
    ```
    Scenario: Default cost summary
      Tool: Bash
      Steps: seed runs and GET /workspaces/w_test/cost-summary with read token.
      Expected: 200 groupBy=agent, 7-day window, groups+total shape.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-1-cost-summary/default.json

    Scenario: Missing workspace
      Tool: Bash
      Steps: GET /workspaces/nonexistent/cost-summary.
      Expected: 404 {error:"workspace_not_found"}.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-1-cost-summary/404.json
    ```
  - **Commit**: YES | Message: `feat(cost): add local cost summary api` | Files: daemon/openapi/sdk tests.

- [x] §5.2 Implement `POST /workspaces/:id/cost-budget` as 501
  - **Spec refs**: `cost-panel-local/不实现预算告警 / 降级`.
  - **What to do**: Add explicit 501 response `{ error: "budget alerts are V1.5 (permission-dsl)" }` for cost-budget route.
  - **Must NOT do**: Do not implement budget thresholds, alerts, or auto-downgrade.
  - **Owning files/modules**: daemon route/openapi/tests.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES after route module ownership clear | Blocks: W2B PR | Blocked By: `§5.1` route grouping.
  - **References**: `cost-panel-local/spec.md:102-115`.
  - **Acceptance Criteria**: API test returns 501 and schema excludes budget fields from cost-summary.
  - **QA Scenarios**:
    ```
    Scenario: Budget endpoint deferred
      Tool: Bash
      Steps: POST /workspaces/w_test/cost-budget.
      Expected: 501 exact error string.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-2-cost-budget/deferred.json

    Scenario: Summary has no budget fields
      Tool: Bash
      Steps: GET cost-summary and inspect keys.
      Expected: no budgetThreshold or overBudget.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-2-cost-budget/no-budget-fields.json
    ```
  - **Commit**: YES | Message: `feat(cost): reject budget alerts for v05` | Files: daemon/openapi tests.

- [x] §5.3 Implement `config.toml` loading
  - **Spec refs**: `local-daemon/Daemon 启动与端口绑定`; `design/V05-D10`.
  - **What to do**: Use `smol-toml`; load CLI > env > `~/.agenthub/config.toml` > defaults; support `[server] bind/port/preview_port`, `[auth]`, `[server.remote]`, `[debug]`, `[adapters.*]`, `[bus.pubsub]`; redact secrets in effective config output.
  - **Must NOT do**: Do not rename fields to host/security; do not allow `0.0.0.0` without token and remote.enabled=true.
  - **Owning files/modules**: `packages/config/**` if exists, daemon startup, tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES in W2B | Blocks: `§5.5 doctor/start` | Blocked By: dependency install approval.
  - **Protected contract checkpoint**: security bind/auth boundary.
  - **References**: `local-daemon/spec.md:57-149`; `packages/config/`.
  - **Acceptance Criteria**: tests for default, config port, parse failure fallback, CLI override, remote bind rejection cases, secret redaction.
  - **QA Scenarios**:
    ```
    Scenario: CLI overrides config
      Tool: Bash
      Steps: config port=8000, start --port=9000 in test harness.
      Expected: effective port 9000.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-3-config/precedence.json

    Scenario: Remote bind guarded
      Tool: Bash
      Steps: config bind=0.0.0.0 without token or remote.enabled.
      Expected: daemon refuses with exact spec error.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-3-config/remote-guard.json
    ```
  - **Commit**: YES | Message: `feat(daemon): load config toml` | Files: config/daemon tests.

- [x] §5.4 Implement SIGINT/SIGTERM graceful stop
  - **Spec refs**: `local-daemon/优雅停止`.
  - **What to do**: Add shutdownRequested state, 503 for non-health routes, healthz shutting_down, SSE `server.shutting_down`, wait in-flight runs up to 30s, force cancel remaining via RunLifecycleService, reverse shutdown phases, close DB, delete PID.
  - **Must NOT do**: Do not raw-update runs; do not leave SSE hanging; do not skip RunLifecycleService cancel path.
  - **Owning files/modules**: daemon lifecycle/startup, RunLifecycleService caller tests.
  - **Recommended Agent Profile**: Category `unspecified-high` + Oracle review. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO with daemon lifecycle edits | Blocks: `§5.5 stop/status` | Blocked By: `§0.4`.
  - **Protected contract checkpoint**: RunLifecycleService terminal cancel and process shutdown state machine; Oracle mandatory.
  - **References**: `local-daemon/spec.md:150-194`; `packages/daemon/src/index.ts`.
  - **Acceptance Criteria**: harness tests no-run <1s exit 0, run finishes within 30s exit 0, timeout emits `agent.run.cancelled {reason:"daemon_shutdown"}` exit 1, SSE notified, force skip documented.
  - **QA Scenarios**:
    ```
    Scenario: In-flight run finishes before timeout
      Tool: Bash
      Steps: spawn daemon with fake long run finishing at 20s then SIGTERM.
      Expected: exit 0 around 20s, PID removed, no forced cancel.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-4-graceful-stop/finish.json

    Scenario: Timeout cancels run
      Tool: Bash
      Steps: spawn run exceeding 30s then SIGTERM.
      Expected: markCancelling + cancelFinalized reason daemon_shutdown; exit 1.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-4-graceful-stop/timeout.json
    ```
  - **Commit**: YES | Message: `feat(daemon): stop gracefully on signals` | Files: daemon lifecycle tests.

- [x] §5.5 Implement `agenthub start/stop/status/doctor/auth*/agents reset` CLI
  - **Spec refs**: `local-daemon/daemon CLI 子命令`.
  - **What to do**: Add CLI subcommands from spec table, using PF.4/PF.7 findings; start foreground daemon, stop PID SIGTERM/SIGKILL, status healthz, doctor five checks, auth issue/list/revoke wrapping token APIs, agents reset from `§3.4`.
  - **Must NOT do**: Do not print token except issue once; do not force kill by default; do not merge all logic into untestable monolith if PF.7 recommends modules.
  - **Owning files/modules**: `apps/cli/**`, daemon PID/health/token APIs as needed.
  - **Recommended Agent Profile**: Category `unspecified-high` for full CLI, `quick` substeps. Skills: `[]`.
  - **Parallelization**: Can Parallel: NO with `§3.4` and daemon lifecycle edits | Blocks: W2B PR | Blocked By: PF.4, PF.7, `§5.3`, `§5.4`.
  - **References**: `local-daemon/spec.md:5-54`; `apps/cli/src/index.ts`.
  - **Acceptance Criteria**: CLI tests for help/version/start/status/stop timeout/doctor/auth issue/list/revoke/agents reset; token value appears only on issue; doctor returns nonzero on failed check.
  - **QA Scenarios**:
    ```
    Scenario: Status ready
      Tool: Bash
      Steps: run fake daemon healthz ready then agenthub status.
      Expected: stdout daemon: ready (http://127.0.0.1:6677), exit 0.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-5-cli/status.json

    Scenario: Auth token one-time display
      Tool: Bash
      Steps: agenthub auth issue then auth list.
      Expected: issue prints token; list prints fingerprint only, not token value.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-5-cli/auth.json
    ```
  - **Commit**: YES | Message: `feat(cli): add daemon and auth commands` | Files: CLI/daemon token tests.

- [x] §5.6 Adjust Vitest timeout to 10s
  - **Spec refs**: `design/V05-D12`.
  - **What to do**: Add/adjust `testTimeout: 10_000` in `vitest.config.ts`.
  - **Must NOT do**: Do not hide failing tests by skipping or lowering assertions.
  - **Owning files/modules**: `vitest.config.ts`.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES after W0 | Blocks: CI stability | Blocked By: none.
  - **References**: `vitest.config.ts`; `design.md:212-216`.
  - **Acceptance Criteria**: `pnpm test` uses 10s timeout; config test/snapshot if present; note in PR risks that this is flake mitigation only.
  - **QA Scenarios**:
    ```
    Scenario: Timeout config present
      Tool: Bash
      Steps: inspect vitest resolved config or run a config smoke test.
      Expected: testTimeout 10000.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-6-vitest-timeout/config.json

    Scenario: Full tests still pass
      Tool: Bash
      Steps: run pnpm test.
      Expected: exit 0, no skipped failures introduced.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-6-vitest-timeout/test.log
    ```
  - **Commit**: YES | Message: `test: raise vitest timeout to 10s` | Files: `vitest.config.ts`.

- [x] §5.7 Unit tests for cost/config/SIGINT/CLI doctor
  - **Spec refs**: `cost-panel-local/*`; `local-daemon/*`.
  - **What to do**: Add named tests for cost groupBy agent/model/day, 404, empty data; config precedence; SIGINT 30s wait; CLI doctor five checks.
  - **Must NOT do**: Do not treat as one smoke test.
  - **Owning files/modules**: daemon/config/CLI tests.
  - **Recommended Agent Profile**: Category `quick` after feature tasks. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES after `§5.1`–`§5.5` | Blocks: W2B PR | Blocked By: `§5.1`–`§5.5`.
  - **References**: `packages/orchestrator/test/orchestrator.test.ts` for integration style; `apps/cli` tests.
  - **Acceptance Criteria**: targeted test filters exit 0 and evidence lists all scenario names.
  - **QA Scenarios**:
    ```
    Scenario: Cost API matrix
      Tool: Bash
      Steps: run cost-summary test filter.
      Expected: agent/model/day/404/empty all pass.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-7-daemon-tests/cost.json

    Scenario: Doctor five checks
      Tool: Bash
      Steps: run CLI doctor test with one failing check.
      Expected: five lines output, nonzero on failure.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-5-7-daemon-tests/doctor.json
    ```
  - **Commit**: YES | Message: `test(daemon): cover v05 cost config cli` | Files: tests.

- [x] §6.1 Implement secure `POST /attachments` multipart upload
  - **Spec refs**: `security/文件附件上传安全（multipart）`.
  - **What to do**: Add mutating upload route with CSRF + Origin, MIME allowlist + magic bytes, 50MB request/file limit, UUID fileId path under `<workspace>/.agenthub/attachments/yyyy/mm/fileId`, canonical path check, SVG sanitize, DB row/write semantics compatible with existing attachment schema.
  - **Must NOT do**: Do not allow native form post without CSRF; do not use user filename in path; do not store raw unsafe SVG; do not alter schema beyond plan without issue.
  - **Owning files/modules**: `packages/security/**`, `packages/daemon/src/index.ts` attachment route, storage helpers/tests.
  - **Recommended Agent Profile**: Category `unspecified-high` — security boundary. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES in W2C but coordinate daemon route ownership with W2B | Blocks: `§7.2` | Blocked By: `§0.1` schema check.
  - **Protected contract checkpoint**: CSRF/Origin/path security and sanitizeSvg.
  - **References**: `security/spec.md:5-74`; `packages/security/src/index.ts`; `packages/security/src/external-content.ts`; `packages/db/src/schema.ts:95-105`.
  - **Acceptance Criteria**: cURL/API tests valid PDF 200, executable 415, SVG sanitized, 60MB 413, path canonical under workspace, missing CSRF 403.
  - **QA Scenarios**:
    ```
    Scenario: Valid PDF upload
      Tool: Bash
      Steps: POST multipart PDF with session cookie + X-Agenthub-CSRF.
      Expected: 200 {fileId,originalName,sizeBytes,sha256}; file stored under workspace attachments path.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-6-1-attachments-upload/pdf.json

    Scenario: Executable rejected
      Tool: Bash
      Steps: POST malware.sh Content-Type application/x-sh.
      Expected: 415 {error:"attachment_mime_not_allowed"}; no file written.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-6-1-attachments-upload/reject.json
    ```
  - **Commit**: YES | Message: `feat(security): add secure attachment uploads` | Files: security/daemon tests.

- [x] §6.2 Implement attachment GC
  - **Spec refs**: `security/文件附件上传安全（multipart）`.
  - **What to do**: Extend existing GC/background task to remove orphan uploads after 24h and message-associated soft-deleted attachments after 30 days.
  - **Must NOT do**: Do not delete attachments immediately on message soft delete.
  - **Owning files/modules**: GC/background task module, attachment storage helpers/tests.
  - **Recommended Agent Profile**: Category `unspecified-high`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES after `§6.1` | Blocks: W2C PR | Blocked By: `§6.1`.
  - **References**: `security/spec.md:40-44`; existing worktree GC code found by executor.
  - **Acceptance Criteria**: fake-time tests for orphan 24h cleanup, soft-delete 30d cleanup, not deleting fresh/associated files.
  - **QA Scenarios**:
    ```
    Scenario: Orphan cleanup after 24h
      Tool: Bash
      Steps: create unattached upload at t0, advance clock 24h+1m, run GC.
      Expected: file and DB row removed.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-6-2-attachments-gc/orphan.json

    Scenario: Soft-deleted retained before 30d
      Tool: Bash
      Steps: associate attachment to deleted message, advance 29d, run GC.
      Expected: file remains.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-6-2-attachments-gc/retained.json
    ```
  - **Commit**: YES | Message: `feat(security): garbage collect attachments` | Files: GC/security tests.

- [x] §6.3 Unit tests for attachment security
  - **Spec refs**: `security/文件附件上传安全（multipart）`.
  - **What to do**: Ensure named tests cover legal PDF, executable rejection, SVG sanitize, oversized 413, path traversal prevention/workspace containment.
  - **Must NOT do**: Do not rely only on UI drag-drop E2E.
  - **Owning files/modules**: security/daemon tests.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES after `§6.1` | Blocks: W2C PR | Blocked By: `§6.1`.
  - **References**: `security/spec.md:46-74`.
  - **Acceptance Criteria**: `pnpm --filter @agenthub/security test --run attachments` and daemon route test filter exit 0; evidence lists all five test names.
  - **QA Scenarios**:
    ```
    Scenario: Security matrix passes
      Tool: Bash
      Steps: run attachments security tests.
      Expected: PDF, executable, SVG, oversized, path tests all pass.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-6-3-attachments-tests/matrix.json

    Scenario: CSRF enforced
      Tool: Bash
      Steps: POST attachment without X-Agenthub-CSRF.
      Expected: 403 and no file write.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-6-3-attachments-tests/csrf.json
    ```
  - **Commit**: YES | Message: `test(security): cover attachment upload controls` | Files: tests.

### Wave W3 — Web UI Chatroom Features (`§7.1`–`§7.10`)

- [x] §7.1 Implement `@` autocomplete (`RoomMembersPopover`)
  - **Spec refs**: `web-ui/输入框`; `orchestrator/Mention 解析`.
  - **What to do**: Add popover on `@`, source candidates from `RoomViewModel.members`, match display name/agentId/role, keyboard Tab/Enter, multi-mention ordering, virtualize >20 candidates, send canonical `agentId` mentions.
  - **Must NOT do**: Do not send display names with spaces as mention ids; do not trust frontend as sole validation.
  - **Owning files/modules**: `apps/web/src/components/InputBox.tsx`, new `RoomMembersPopover`, `apps/web/src/types.ts`, tests.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`. Omitted: backend agents.
  - **Parallelization**: Can Parallel: NO within W3 | Blocks: `§7.10` @ E2E | Blocked By: `§4.1`, `§4.2`.
  - **References**: `apps/web/src/components/InputBox.tsx`; `apps/web/src/hooks/useProjector.ts`; `web-ui/spec.md:312-352`.
  - **Acceptance Criteria**: component tests for trigger/filter/select/multi-order; Playwright scenario with selectors `[data-testid="mention-popover"]`, `[data-testid="mention-option-security-reviewer"]`; request body contains `mentions:["security-reviewer"]`.
  - **QA Scenarios**:
    ```
    Scenario: Select mention
      Tool: Playwright
      Steps: navigate assisted room, type @sec, press Enter on security-reviewer.
      Expected: input contains @security-reviewer and outgoing POST mentions array has security-reviewer.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-1-mention-popover/select.png

    Scenario: Candidate list virtualized
      Tool: Playwright
      Steps: seed 25 room members, type @.
      Expected: popover renders virtual list and keyboard Tab changes active option.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-1-mention-popover/virtualized.png
    ```
  - **Commit**: YES | Message: `feat(web): add mention autocomplete` | Files: web input/popover/tests.

- [x] §7.2 Implement drag-drop attachments in input
  - **Spec refs**: `web-ui/输入框`; `security/文件附件上传安全（multipart）`.
  - **What to do**: Add drag/drop and file picker using `fetch(FormData)` through CSRF SDK wrapper; show AttachmentPart preview icon/name/size; enforce max 50 UI-side while daemon enforces hard limits.
  - **Must NOT do**: Do not use native form post without CSRF header; do not trust UI MIME/size checks as security.
  - **Owning files/modules**: `InputBox.tsx`, SDK upload helper, attachment preview component, tests.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W3 | Blocks: `§7.10` drag/drop E2E | Blocked By: `§6.1`.
  - **References**: `apps/web/src/hooks/useSdk.ts`; `web-ui/spec.md:318-320,353-357`.
  - **Acceptance Criteria**: component/E2E intercepts `POST /attachments` with CSRF header; preview renders returned fileId/originalName/size; 413/415 errors show banner.
  - **QA Scenarios**:
    ```
    Scenario: PDF drag-drop preview
      Tool: Playwright
      Steps: drag report.pdf into [data-testid="message-input-dropzone"].
      Expected: POST /attachments includes X-Agenthub-CSRF; preview shows report.pdf and size.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-2-drag-drop/pdf-preview.png

    Scenario: Upload rejected shows error
      Tool: Playwright
      Steps: mock 415 response for malware.sh.
      Expected: banner shows attachment_mime_not_allowed and no preview.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-2-drag-drop/reject.png
    ```
  - **Commit**: YES | Message: `feat(web): upload attachments from composer` | Files: web input/sdk/tests.

- [x] §7.3 Implement message quote
  - **Spec refs**: `web-ui/输入框`; `messaging/消息操作（固定 6 个）`.
  - **What to do**: Add quote action via `q` and menu; insert quoted block above input, store hidden `quotedMessageId`, POST it on send; allow removing quote block.
  - **Must NOT do**: Do not copy entire long message into payload beyond UI preview; `quotedMessageId` is canonical.
  - **Owning files/modules**: `ChatStream.tsx`, `InputBox.tsx`, message action state/tests.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W3 | Blocks: `§7.4` menu integration | Blocked By: W2 message API existing.
  - **References**: `apps/web/src/components/ChatStream.tsx`; `apps/web/src/components/InputBox.tsx`; `web-ui/spec.md:358-362`.
  - **Acceptance Criteria**: quote via selected message keyboard `q`, menu quote, send includes `quotedMessageId`, preview truncates to 100 chars.
  - **QA Scenarios**:
    ```
    Scenario: Keyboard quote
      Tool: Playwright
      Steps: select message m_42 with j/k, press q.
      Expected: quote block appears with sender and truncated text; focus moves input.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-3-quote/keyboard.png

    Scenario: Send quoted message
      Tool: Playwright
      Steps: type reply and Cmd+Enter.
      Expected: POST body includes quotedMessageId=m_42.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-3-quote/post.json
    ```
  - **Commit**: YES | Message: `feat(web): quote messages from timeline` | Files: web chat/input tests.

- [x] §7.4 Implement message operation menu
  - **Spec refs**: `web-ui/Main Timeline 与 Agent Run Detail 双视图`; `messaging/消息操作（固定 6 个）`.
  - **What to do**: Add hover kebab/action menu with quote/regenerate/pin/delete as applicable; keyboard `r/q/p/d`; disable mutating actions offline.
  - **Must NOT do**: Do not show regenerate on user messages or pin on non-context messages.
  - **Owning files/modules**: `ChatStream.tsx`, card components, SDK message operations, tests.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W3 | Blocks: `§7.10` menu E2E | Blocked By: `§4.7`, `§4.8`, delete existing API.
  - **References**: `web-ui/spec.md:426-462`; `messaging/spec.md:107-155`.
  - **Acceptance Criteria**: menu applies correct action availability; keyboard shortcuts issue correct API calls; offline disables and shows tooltip.
  - **QA Scenarios**:
    ```
    Scenario: Assistant regenerate action
      Tool: Playwright
      Steps: hover assistant message, click [data-testid="message-action-regenerate"].
      Expected: POST /messages/:id/regenerate called.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-4-message-menu/regenerate.png

    Scenario: User regenerate hidden
      Tool: Playwright
      Steps: hover user message.
      Expected: regenerate action absent/disabled.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-4-message-menu/user-hidden.png
    ```
  - **Commit**: YES | Message: `feat(web): add message operation menu` | Files: web message components/tests.

- [x] §7.5 Implement PendingTurnList component
  - **Spec refs**: `web-ui/PendingTurn 操作面板`; `messaging/用户 Turn 排队`.
  - **What to do**: Render queued pending turns above input; cancel/edit actions; queue warning at ≥15; edit drafts in sessionStorage; PATCH queued messages; handle 409 preserving draft.
  - **Must NOT do**: Do not allow edit for scheduled/consumed turns; do not lose drafts on failed PATCH.
  - **Owning files/modules**: new `PendingTurnList`, `InputBox.tsx`, `useProjector.ts` pending state, SDK methods/tests.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W3 | Blocks: `§7.10` PendingTurn E2E | Blocked By: `§4.9`, existing DELETE pending-turn API.
  - **References**: `web-ui/spec.md:230-269`; `apps/web/src/components/ChatStream.tsx` pending controls.
  - **Acceptance Criteria**: component tests and Playwright with 3 queued turns; cancel calls DELETE; edit calls PATCH; 409 shows banner and keeps draft.
  - **QA Scenarios**:
    ```
    Scenario: Three pending turns display
      Tool: Playwright
      Steps: seed primary busy and send 3 messages.
      Expected: [data-testid="pending-turn-list"] has 3 rows with cancel/edit.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-5-pending-turn-list/three.png

    Scenario: Scheduled edit 409
      Tool: Playwright
      Steps: edit pending message while server returns 409 pending_turn_already_scheduled.
      Expected: error banner and draft retained.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-5-pending-turn-list/409.png
    ```
  - **Commit**: YES | Message: `feat(web): manage pending turns` | Files: web pending/input tests.

- [x] §7.6 Implement MailboxFailureCard
  - **Spec refs**: `messaging/mailbox.delivery.failed 失败可见性事件`; `web-ui/Main Timeline`.
  - **What to do**: Project `mailbox.delivery.failed` to main timeline system card with reason/target/time, retry button for claim_conflict/target_unavailable, disabled retry for max_retries, debug link.
  - **Must NOT do**: Do not show internal trace/debug data to non-admin beyond card summary; do not retry max_retries.
  - **Owning files/modules**: `useProjector.ts`, `ChatStream.tsx`, new card component, SDK retry endpoint if existing or issue if missing.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W3 | Blocks: E2E | Blocked By: `§4.5`.
  - **References**: `messaging/spec.md:30-35`; `apps/web/src/components/cards/`.
  - **Acceptance Criteria**: projector test maps event to card; UI renders reason; retry visibility rules; debug link includes mailboxMessageId/trace filter.
  - **QA Scenarios**:
    ```
    Scenario: Claim conflict card retryable
      Tool: Playwright
      Steps: inject mailbox.delivery.failed reason=claim_conflict.
      Expected: MailboxFailureCard shows retry and details link.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-6-mailbox-card/claim-conflict.png

    Scenario: Max retries disabled
      Tool: Playwright
      Steps: inject reason=max_retries.
      Expected: retry disabled, delete/details available.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-6-mailbox-card/max-retries.png
    ```
  - **Commit**: YES | Message: `feat(web): show mailbox delivery failures` | Files: projector/card tests.

- [x] §7.7 Implement TerminalCard PTY renderer
  - **Spec refs**: `web-ui/终端 Artifact 渲染（PTY 输出）`.
  - **What to do**: Render terminal artifacts with first 10 lines collapsed, ANSI colors via `ansi-to-html`, expand modal/slide-over with virtualized log viewer, search, copy, auto-scroll.
  - **Must NOT do**: Do not expose raw admin-only stream in main timeline; do not render huge logs without virtualization.
  - **Owning files/modules**: card components, Run Detail Tools tab, artifact types/tests.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W3 | Blocks: `§7.10` TerminalCard E2E | Blocked By: PF.5.
  - **References**: `web-ui/spec.md:270-309`; `apps/web/src/components/cards/`; `apps/web/src/components/RunDetail.tsx`.
  - **Acceptance Criteria**: component tests for 10-line collapsed, ANSI red, expand virtual list, search/copy; no >100 DOM log nodes for 1000 lines.
  - **QA Scenarios**:
    ```
    Scenario: Collapsed terminal card
      Tool: Playwright
      Steps: seed terminal artifact 200 lines.
      Expected: first 10 lines and text=展开剩余 190 行.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-7-terminal-card/collapsed.png

    Scenario: ANSI color rendered
      Tool: Playwright
      Steps: seed output with \x1b[31mError\x1b[0m.
      Expected: Error appears red in card/modal.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-7-terminal-card/ansi.png
    ```
  - **Commit**: YES | Message: `feat(web): render terminal artifacts` | Files: card/run-detail tests.

- [x] §7.8 Implement Run Detail 7-tab real information
  - **Spec refs**: `web-ui/Main Timeline 与 Agent Run Detail 双视图`.
  - **What to do**: Add PreCompact summary highlight in Transcript/Context, subagent nodes in Tools, TerminalCard in Artifacts, Cost tab comparison using cost-summary API.
  - **Must NOT do**: Do not move raw/tool/token details into main timeline; do not create extra tabs beyond the 7 specified.
  - **Owning files/modules**: `RunDetail.tsx`, `SidePanel.tsx` if tab links, projector raw/detail subscriptions, tests.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W3 | Blocks: E2E | Blocked By: `§2.1`–`§2.4`, `§5.1`, `§7.7`.
  - **References**: `web-ui/spec.md:426-462`; `apps/web/src/components/RunDetail.tsx`; `apps/web/src/hooks/useRawStream.ts`.
  - **Acceptance Criteria**: component/E2E tests show all 7 tabs, summary banner, subagent timeline, terminal artifact, cost comparison line.
  - **QA Scenarios**:
    ```
    Scenario: PreCompact summary visible
      Tool: Playwright
      Steps: open Run Detail for run with context.summary draft.
      Expected: Transcript banner "会话已压缩，可在 Context tab 确认".
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-8-run-detail/precompact.png

    Scenario: Cost comparison
      Tool: Playwright
      Steps: open Run Detail Cost tab with mocked cost-summary.
      Expected: current run cost and same-agent average line shown.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-8-run-detail/cost.png
    ```
  - **Commit**: YES | Message: `feat(web): complete run detail tabs` | Files: RunDetail/projector tests.

- [x] §7.9 Implement Cost panel UI
  - **Spec refs**: `web-ui/Cost 面板视图`; `web-ui/Side Panel 视图`; `cost-panel-local/单机 Cost 聚合接口`.
  - **What to do**: Add Side Panel fifth tab Cost with default 7-day agent grouping, time window selector, group buttons, stacked bar/list, total, empty state, debug link, 300ms debounce.
  - **Must NOT do**: Do not display user/token id columns; do not implement budget alerts.
  - **Owning files/modules**: `SidePanel.tsx`, new `CostPanel.tsx`, SDK cost API, tests.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W3 | Blocks: `§7.10` cost E2E | Blocked By: `§5.1`.
  - **References**: `web-ui/spec.md:186-229`; `apps/web/src/components/SidePanel.tsx`.
  - **Acceptance Criteria**: default request `groupBy=agent` with from/to 7d; model/day switch debounced; empty state; row debug link; no user fields.
  - **QA Scenarios**:
    ```
    Scenario: Default Cost tab
      Tool: Playwright
      Steps: click [data-testid="side-tab-cost"].
      Expected: API called with groupBy=agent and 7-day from/to; chart/list render.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-9-cost-panel/default.png

    Scenario: Empty state
      Tool: Playwright
      Steps: mock groups=[] total zeros.
      Expected: "暂无 cost 数据" empty state and no user columns.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-9-cost-panel/empty.png
    ```
  - **Commit**: YES | Message: `feat(web): add local cost panel` | Files: web side panel/cost tests.

- [x] §7.10 Playwright E2E for W3 chatroom features
  - **Spec refs**: `web-ui/测试基础设施` plus `§7.1`, `§7.5`, `§7.7`, `§7.9`.
  - **What to do**: Add split E2E specs for @ completion, PendingTurn operations, TerminalCard expand, Cost tab loading; use concrete `data-testid` selectors and saved traces/screenshots.
  - **Must NOT do**: Do not write one broad brittle test; do not rely on text-only selectors where testid is required by plan.
  - **Owning files/modules**: `apps/web/e2e/v05-chatroom.spec.ts` or split files, test fixtures.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `playwright`.
  - **Parallelization**: NO within W3 | Blocks: W3 PR | Blocked By: `§7.1`–`§7.9`.
  - **References**: `apps/web/e2e/pending-turn.spec.ts`; `apps/web/e2e/main-detail-projection.spec.ts`; `playwright.config.ts`.
  - **Acceptance Criteria**: `pnpm test:e2e -- --grep "v05"` exits 0; evidence includes screenshots/traces for four flows.
  - **QA Scenarios**:
    ```
    Scenario: V0.5 feature E2E suite
      Tool: Playwright
      Steps: run v05 grep suite.
      Expected: @ completion, PendingTurn, TerminalCard, Cost tab tests pass.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-10-e2e/report.json

    Scenario: Selectors are stable
      Tool: Bash
      Steps: inspect E2E tests for required data-testid selectors.
      Expected: no vague "button nth" selectors for critical actions.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-7-10-e2e/selectors.md
    ```
  - **Commit**: YES | Message: `test(web): cover v05 chatroom flows` | Files: Playwright tests/fixtures.

### Wave W4 — Frontend Polish (`§8.1`–`§8.12`)

- [x] §8.1 Tokenize CSS variables with `--ah-*`
  - **Spec refs**: `web-ui/主题与密度系统`.
  - **What to do**: First W4 task. Introduce `--ah-*` tokens for color/spacing/radius/font-size/line-height and convert existing CSS hard-coded values in `apps/web` to tokens.
  - **Must NOT do**: Do not introduce Tailwind/shadcn/styled-components or full design system.
  - **Owning files/modules**: `apps/web/src/**/*.css` or existing style files, component class updates.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: Can Parallel: NO | Wave W4 first | Blocks: all other `§8.*` | Blocked By: W3 merge.
  - **References**: `web-ui/spec.md:5-43`; existing web styles found by executor.
  - **Acceptance Criteria**: visual smoke in light default; grep audit shows no major hard-coded palette/spacing in core components except documented exceptions; `pnpm --filter @agenthub/web test` exits 0.
  - **QA Scenarios**:
    ```
    Scenario: Tokens applied to chat layout
      Tool: Playwright
      Steps: open Room view after tokenization.
      Expected: layout visually matches baseline; CSS computed values resolve from --ah-* tokens.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-1-css-tokens/room.png

    Scenario: No design-system dependency
      Tool: Bash
      Steps: inspect apps/web/package.json.
      Expected: no tailwind/shadcn/styled-components added.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-1-css-tokens/deps.json
    ```
  - **Commit**: YES | Message: `feat(web): tokenize ui styles` | Files: web styles/components.

- [x] §8.2 Implement light/dark/auto theme
  - **Spec refs**: `web-ui/主题与密度系统`.
  - **What to do**: Add root `data-theme`, localStorage `agenthub.theme`, auto follows `prefers-color-scheme`, Settings + command palette entry.
  - **Must NOT do**: Do not store resolved light/dark when user chose auto.
  - **Owning files/modules**: theme hook/provider, Settings, command palette once present.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W4 | Blocks: `§8.4`, `§8.10` | Blocked By: `§8.1`.
  - **References**: `web-ui/spec.md:9-38`.
  - **Acceptance Criteria**: tests for dark switch, auto media listener, localStorage persistence, no flash on mount where testable.
  - **QA Scenarios**:
    ```
    Scenario: Dark theme persists
      Tool: Playwright
      Steps: choose dark in settings.
      Expected: html data-theme=dark and localStorage agenthub.theme=dark.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-2-theme/dark.png

    Scenario: Auto follows system
      Tool: Playwright
      Steps: emulate color scheme change while theme=auto.
      Expected: UI updates; localStorage remains auto.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-2-theme/auto.json
    ```
  - **Commit**: YES | Message: `feat(web): add theme switching` | Files: web theme/settings tests.

- [x] §8.3 Implement cozy/compact density
  - **Spec refs**: `web-ui/主题与密度系统`.
  - **What to do**: Add `data-density`, localStorage `agenthub.density`, cozy default, compact spacing ~0.75x, Settings + command palette entry.
  - **Must NOT do**: Do not change information architecture or font sizes beyond spec.
  - **Owning files/modules**: density hook/provider, CSS token overrides, Settings.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W4 | Blocks: `§8.4` | Blocked By: `§8.1`.
  - **References**: `web-ui/spec.md:17-25,39-43`.
  - **Acceptance Criteria**: tests assert `html[data-density]`, localStorage, compact spacing token values, chat/list/card affected.
  - **QA Scenarios**:
    ```
    Scenario: Compact density applies
      Tool: Playwright
      Steps: switch density to compact.
      Expected: html data-density=compact and message spacing reduced.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-3-density/compact.png

    Scenario: Preference persists
      Tool: Playwright
      Steps: reload after compact.
      Expected: compact retained from localStorage.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-3-density/persist.json
    ```
  - **Commit**: YES | Message: `feat(web): add density switching` | Files: web density/settings tests.

- [x] §8.4 Implement command palette (Cmd/Ctrl+K)
  - **Spec refs**: `web-ui/键盘流第一轮收口`.
  - **What to do**: Build pure React command palette for Room search, agent switch, recent Run jump, theme/density toggles, reload agents/cancel current run; virtualize ≥20 candidates.
  - **Must NOT do**: Do not add cmdk library; do not expose admin-only Debug actions without admin scope.
  - **Owning files/modules**: new `CommandPalette`, hotkeys hook usage, room/run data selectors.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W4 | Blocks: keyboard E2E | Blocked By: `§8.2`, `§8.3`.
  - **References**: `web-ui/spec.md:44-79`; `apps/web/src/App.tsx`.
  - **Acceptance Criteria**: Playwright opens with Cmd/Ctrl+K, filters room title, Enter switches room; theme/density commands work; ≥20 virtual list.
  - **QA Scenarios**:
    ```
    Scenario: Search room
      Tool: Playwright
      Steps: press Ctrl+K, type auth, Enter first room.
      Expected: selected room changes to title containing auth.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-4-command-palette/search.png

    Scenario: Theme command
      Tool: Playwright
      Steps: Ctrl+K, choose Switch theme dark.
      Expected: data-theme=dark.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-4-command-palette/theme.png
    ```
  - **Commit**: YES | Message: `feat(web): add command palette` | Files: web command palette tests.

- [x] §8.5 Implement message keyboard navigation and keymap
  - **Spec refs**: `web-ui/键盘流第一轮收口`.
  - **What to do**: Add `j/k`, `r`, `Enter`, `Esc`, `?`, `g r`, `g d` shortcuts with focus management and input-focus exclusions.
  - **Must NOT do**: Do not capture keys while typing except specified input shortcuts.
  - **Owning files/modules**: `ChatStream.tsx`, `RunDetail.tsx`, keymap modal.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W4 | Blocks: keyboard E2E | Blocked By: `§8.4` if shared hotkey infrastructure.
  - **References**: `web-ui/spec.md:55-94`.
  - **Acceptance Criteria**: Playwright tests `j/k` selection scroll, Enter opens brief Run Detail, Esc closes and restores focus, `?` modal.
  - **QA Scenarios**:
    ```
    Scenario: j/k navigation
      Tool: Playwright
      Steps: press j three times in message stream.
      Expected: selected highlight moves 3 messages and remains visible.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-5-keyboard/jk.png

    Scenario: Esc restores focus
      Tool: Playwright
      Steps: open Run Detail then press Esc.
      Expected: slide-over closes and focus returns to selected message.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-5-keyboard/esc.png
    ```
  - **Commit**: YES | Message: `feat(web): add chat keyboard flow` | Files: web keyboard tests.

- [x] §8.6 Implement message stream virtualization
  - **Spec refs**: `web-ui/性能基线（虚拟化 + 60fps batch + 骨架屏）`.
  - **What to do**: Use `@tanstack/react-virtual` when room has ≥50 messages, estimated heights with measurement fallback, 2x viewport overscan.
  - **Must NOT do**: Do not break scroll-to-bottom or selected message navigation.
  - **Owning files/modules**: `ChatStream.tsx`, virtualization helpers/tests.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W4 | Blocks: `§8.12` | Blocked By: W3 stable timeline.
  - **References**: `web-ui/spec.md:138-185`; `ChatStream.tsx`.
  - **Acceptance Criteria**: with 10k messages DOM nodes ≤100; scroll smooth in Playwright/perf trace; selected message auto-scroll works.
  - **QA Scenarios**:
    ```
    Scenario: 10k messages virtualized
      Tool: Playwright
      Steps: seed 10k messages, open room.
      Expected: rendered message DOM nodes <=100.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-6-virtualization/dom-count.json

    Scenario: Selection with virtual list
      Tool: Playwright
      Steps: press j/k beyond viewport.
      Expected: selected message scrolls into view.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-6-virtualization/selection.png
    ```
  - **Commit**: YES | Message: `feat(web): virtualize message stream` | Files: chat stream/tests.

- [x] §8.7 Implement delta 60fps batch
  - **Spec refs**: `web-ui/性能基线（虚拟化 + 60fps batch + 骨架屏）`.
  - **What to do**: In `useProjector`, coalesce `message.part.delta` per messageId inside one `requestAnimationFrame`, concat content without loss, single state update per frame; coordinate with `§4.4` status throttle.
  - **Must NOT do**: Do not drop token deltas; do not batch durable non-delta events incorrectly.
  - **Owning files/modules**: `apps/web/src/hooks/useProjector.ts`, projector tests.
  - **Recommended Agent Profile**: Category `unspecified-high` for state correctness + frontend review. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO; same file collision with `§4.4` | Blocks: `§8.12` | Blocked By: `§4.4` handoff.
  - **References**: `web-ui/spec.md:148-153`; `apps/web/src/hooks/useProjector.ts`.
  - **Acceptance Criteria**: fake RAF tests 100 deltas/s produce correct concatenated text and ≤1 setState/frame; no regression in other event projection tests.
  - **QA Scenarios**:
    ```
    Scenario: Delta coalescing preserves text
      Tool: Bash
      Steps: feed 100 deltas in one second with fake RAF.
      Expected: final message text equals concat of all deltas.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-7-delta-batch/concat.json

    Scenario: Non-delta events not delayed incorrectly
      Tool: Bash
      Steps: feed message.completed and permission event during delta stream.
      Expected: durable state remains ordered per projector rules.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-7-delta-batch/non-delta.json
    ```
  - **Commit**: YES | Message: `feat(web): batch token deltas per frame` | Files: projector/tests.

- [x] §8.8 Implement skeleton screens and lazy images
  - **Spec refs**: `web-ui/性能基线（虚拟化 + 60fps batch + 骨架屏）`.
  - **What to do**: Add skeletons for Room switch, initial load, Run Detail load, Cost panel load; timeout banner after 5s; image attachments `loading="lazy"`, `decoding="async"`, IntersectionObserver thumbnail predecode.
  - **Must NOT do**: Do not show blank panes during loading.
  - **Owning files/modules**: Layout/ChatStream/RunDetail/CostPanel image components.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W4 | Blocks: `§8.12` | Blocked By: W3 components.
  - **References**: `web-ui/spec.md:154-164`.
  - **Acceptance Criteria**: tests for skeleton presence before data, timeout banner after fake 5s, images have lazy/async attributes.
  - **QA Scenarios**:
    ```
    Scenario: Room skeleton
      Tool: Playwright
      Steps: delay messages API and switch room.
      Expected: 5-10 skeleton rows immediately, replaced by messages.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-8-skeletons/room.png

    Scenario: Lazy image attributes
      Tool: Playwright
      Steps: render image attachment.
      Expected: img loading=lazy decoding=async.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-8-skeletons/image.json
    ```
  - **Commit**: YES | Message: `feat(web): add loading skeletons` | Files: web components/tests.

- [x] §8.9 Implement motion polish and reduced-motion fallback
  - **Spec refs**: `web-ui/主题与密度系统`; `web-ui/a11y AA 基线`.
  - **What to do**: Add message fade-in, Run Detail slide-over easing, PendingTurn no-flash transitions; `prefers-reduced-motion: reduce` disables/shortens animations per spec.
  - **Must NOT do**: Do not animate when reduced motion is enabled.
  - **Owning files/modules**: CSS/style files, RunDetail, ChatStream, PendingTurnList.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W4 | Blocks: `§8.10` | Blocked By: `§8.1`, W3 components.
  - **References**: `web-ui/spec.md:116-119,133-137`.
  - **Acceptance Criteria**: visual/E2E check normal motion classes, reduced-motion emulation shows instant slide/no fade.
  - **QA Scenarios**:
    ```
    Scenario: Normal slide-over motion
      Tool: Playwright
      Steps: open Run Detail under normal motion.
      Expected: slide-over transition class applied and completes.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-9-motion/normal.png

    Scenario: Reduced motion disables transitions
      Tool: Playwright
      Steps: emulate prefers-reduced-motion=reduce and open Run Detail.
      Expected: no 250ms animation; immediate visible.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-9-motion/reduced.json
    ```
  - **Commit**: YES | Message: `feat(web): polish motion with reduced-motion` | Files: styles/components tests.

- [x] §8.10 Implement a11y AA baseline and axe CI
  - **Spec refs**: `web-ui/a11y AA 基线`.
  - **What to do**: Add focus rings, aria labels, aria-live, focus traps, contrast token checks, reduced-motion validation; centralize UI strings in `apps/web/src/i18n/en.ts` if absent; add axe script/CI check for Room, Run Detail, Settings in light/dark.
  - **Must NOT do**: Do not claim AAA or manual screen-reader certification.
  - **Owning files/modules**: web components, i18n file, axe script/config, tests.
  - **Recommended Agent Profile**: Category `unspecified-high` for CI + `visual-engineering` review. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W4 | Blocks: final W4 PR | Blocked By: `§8.2`, `§8.9`.
  - **References**: `web-ui/spec.md:95-137`; `package.json` scripts if adding check.
  - **Acceptance Criteria**: `pnpm exec axe scripts/a11y-check.mjs` or repo-equivalent returns 0 violations for Room/Run Detail/Settings in light/dark; keyboard tab path test passes.
  - **QA Scenarios**:
    ```
    Scenario: Axe light/dark pass
      Tool: Bash
      Steps: run a11y script for Room, Run Detail, Settings in both themes.
      Expected: 0 violations.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-10-a11y/axe.json

    Scenario: Keyboard tab path
      Tool: Playwright
      Steps: Tab from input to send to first message.
      Expected: visual focus visible at each stop.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-10-a11y/tab-path.png
    ```
  - **Commit**: YES | Message: `feat(web): meet a11y aa baseline` | Files: web components/a11y scripts/tests.

- [x] §8.11 Implement reconnect/offline banner polish
  - **Spec refs**: `web-ui/错误与重连`.
  - **What to do**: Replace bare reconnect text with banner states connecting/connected/reconnecting/offline, icon/progress, exponential backoff display, offline read-only disabling mutating controls, restored success flash.
  - **Must NOT do**: Do not disable read-only browsing; do not allow mutating actions offline.
  - **Owning files/modules**: connection state hook/banner, InputBox, mutating buttons.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `frontend-ui-ux`.
  - **Parallelization**: NO within W4 | Blocks: W4 E2E | Blocked By: W3 mutating buttons.
  - **References**: `web-ui/spec.md:387-425`; `useProjector.ts` SSE state.
  - **Acceptance Criteria**: tests for short reconnect, 3-failure offline, input disabled, regenerate/pin/cancel/apply disabled with tooltip.
  - **QA Scenarios**:
    ```
    Scenario: Short reconnect recovers
      Tool: Playwright
      Steps: force SSE disconnect for 1s then reconnect.
      Expected: Reconnecting banner then restored green flash then hidden.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-11-reconnect/recover.png

    Scenario: Offline disables mutations
      Tool: Playwright
      Steps: force 3 failed reconnects.
      Expected: red offline banner, input disabled, mutating buttons disabled with tooltip.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-11-reconnect/offline.png
    ```
  - **Commit**: YES | Message: `feat(web): polish reconnect states` | Files: web connection/components tests.

- [x] §8.12 Performance verification
  - **Spec refs**: `web-ui/性能基线（虚拟化 + 60fps batch + 骨架屏）`.
  - **What to do**: Add repeatable Playwright/perf harness for 10k messages first paint ≤500ms, 100 delta/s p95 frame ≤16ms, room switch ≤200ms; save trace JSON.
  - **Must NOT do**: Do not mark perf complete without machine/context note; do not weaken budgets without Oracle issue.
  - **Owning files/modules**: Playwright perf tests/scripts, evidence.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `playwright`.
  - **Parallelization**: NO within W4 | Blocks: W4 PR | Blocked By: `§8.6`, `§8.7`, `§8.8`.
  - **References**: `web-ui/spec.md:165-185`; `playwright.config.ts`.
  - **Acceptance Criteria**: perf trace captures p95 frame timing ≤16ms for 100 token/s; 10k first screen ≤500ms on documented machine; room switch ≤200ms or issue filed with measurement.
  - **QA Scenarios**:
    ```
    Scenario: 100 delta/s frame budget
      Tool: Playwright
      Steps: run synthetic delta stream and capture frame timing.
      Expected: p95 <=16ms.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-12-perf/perf-trace.json

    Scenario: 10k initial render
      Tool: Playwright
      Steps: seed 10k messages and measure first contentful chat render.
      Expected: <=500ms with DOM nodes <=100.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-8-12-perf/10k.json
    ```
  - **Commit**: YES | Message: `test(web): verify v05 performance budgets` | Files: perf tests/scripts.

### Wave W5 — Spec Validation and Closeout (`§9.1`–`§9.7`)

- [ ] §9.1 Apply/verify migration `0012_v05.sql` and schema consistency
  - **Spec refs**: `design/Migration Plan`.
  - **What to do**: Run DB migration on fresh and existing test DB; verify schema matches spec. This is validation of `§0.1`, not creation of a second migration.
  - **Must NOT do**: Do not add late schema changes unless issue/Oracle decision exists.
  - **Owning files/modules**: DB validation scripts/evidence only unless bugfix.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES in W5 with other validation after all waves merged | Blocks: FV | Blocked By: W4 merge.
  - **References**: `openspec/.../tasks.md:101`; `packages/db/src/sqlite.ts`.
  - **Acceptance Criteria**: `pnpm db:migrate` or repo-equivalent migration command exits 0; schema diff evidence confirms V0.5 columns/indexes and no extra cost/user columns.
  - **QA Scenarios**:
    ```
    Scenario: Fresh DB migration
      Tool: Bash
      Steps: run migration command against fresh DB.
      Expected: exits 0 and schema matches migration plan.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-1-migration-verify/fresh.json

    Scenario: Existing DB migration
      Tool: Bash
      Steps: apply migration to MVP baseline DB fixture.
      Expected: exits 0 with data preserved.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-1-migration-verify/existing.json
    ```
  - **Commit**: YES only for validation script/evidence metadata if tracked | Message: `test(db): verify v05 migration`.

- [ ] §9.2 Run full `pnpm test`, `pnpm typecheck`, `pnpm lint`
  - **Spec refs**: `design/V05-D12`.
  - **What to do**: Run root test/typecheck/lint and fix in-scope failures only.
  - **Must NOT do**: Do not skip tests or relax lint/type rules to pass.
  - **Owning files/modules**: validation evidence; bugfix ownership follows failing task owner.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: Can Parallel: YES with `§9.3/§9.4` if independent | Blocks: FV | Blocked By: all implementation waves.
  - **References**: `package.json:20-27`.
  - **Acceptance Criteria**: `pnpm test`, `pnpm typecheck`, `pnpm lint` exit 0 with logs saved.
  - **QA Scenarios**:
    ```
    Scenario: Root validation trio
      Tool: Bash
      Steps: run pnpm test; pnpm typecheck; pnpm lint.
      Expected: all exit 0.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-2-root-validation/logs.txt

    Scenario: Failure routed to owner
      Tool: Bash
      Steps: if failure occurs, record failing file/task owner.
      Expected: issue or fix commit scoped to owning wave.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-2-root-validation/failures.md
    ```
  - **Commit**: NO unless fixing in-scope validation failures.

- [ ] §9.3 Run `pnpm check:all`
  - **Spec refs**: `event-system/events:check 与 visibility:check CI 校验`.
  - **What to do**: Run all custom checks including events, visibility, subscriptions, command, schema, run-state-machine, deps/Bun API.
  - **Must NOT do**: Do not bypass check scripts.
  - **Owning files/modules**: validation evidence.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: YES after all waves | Blocks: FV | Blocked By: all implementation waves.
  - **References**: `package.json:14-28`.
  - **Acceptance Criteria**: `pnpm check:all` exit 0; if failed, run individual check to isolate and fix only owning area.
  - **QA Scenarios**:
    ```
    Scenario: Custom checks all green
      Tool: Bash
      Steps: run pnpm check:all.
      Expected: exit 0.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-3-check-all/check-all.log

    Scenario: Event/command registries included
      Tool: Bash
      Steps: inspect check-all output.
      Expected: events, visibility, subscriptions, command, schema checks run.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-3-check-all/included.md
    ```
  - **Commit**: NO unless fixing check failures.

- [ ] §9.4 Run OpenSpec strict validation
  - **Spec refs**: `design/Goals G3`.
  - **What to do**: Run `openspec.cmd validate add-v05-chatroom-complete --strict` after implementation and task checkbox updates are staged appropriately.
  - **Must NOT do**: Do not edit spec to hide implementation gaps without review.
  - **Owning files/modules**: OpenSpec files only if task completion status update is intended.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: YES in W5 | Blocks: FV | Blocked By: all implementation waves.
  - **References**: `openspec/changes/add-v05-chatroom-complete/**`.
  - **Acceptance Criteria**: command exits 0; log saved.
  - **QA Scenarios**:
    ```
    Scenario: Strict validation passes
      Tool: Bash
      Steps: openspec.cmd validate add-v05-chatroom-complete --strict.
      Expected: Change is valid.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-4-openspec-strict/strict.log

    Scenario: Validation failure escalated
      Tool: Bash
      Steps: if command fails, capture errors.
      Expected: issue filed; no self-issued waiver.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-4-openspec-strict/failure.md
    ```
  - **Commit**: NO unless updating task checkboxes/spec status after implementation.

- [ ] §9.5 Run Playwright E2E including V0.5 scenarios
  - **Spec refs**: `web-ui/测试基础设施`.
  - **What to do**: Run full Playwright suite with daemon/web bootstrap per `playwright.config.ts`; include V0.5 E2E from `§7.10`, keyboard/theme/perf critical paths where configured.
  - **Must NOT do**: Do not mark as passed with only unit tests.
  - **Owning files/modules**: E2E evidence; bugfix ownership follows failing component.
  - **Recommended Agent Profile**: Category `visual-engineering`. Skills: `playwright`.
  - **Parallelization**: YES after W4 | Blocks: FV | Blocked By: W4.
  - **References**: `playwright.config.ts`; `apps/web/e2e/**`.
  - **Acceptance Criteria**: `pnpm test:e2e` exit 0; `test-results/.last-run.json` shows passed; traces/screenshots saved as configured.
  - **QA Scenarios**:
    ```
    Scenario: Full E2E suite
      Tool: Playwright
      Steps: run pnpm test:e2e.
      Expected: exit 0 and V0.5 specs pass.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-5-e2e/full-report.json

    Scenario: Bootstrap documented
      Tool: Bash
      Steps: inspect Playwright output for daemon/web startup.
      Expected: server bootstrap succeeds or explicit commands documented.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-5-e2e/bootstrap.log
    ```
  - **Commit**: NO unless fixing E2E failures.

- [ ] §9.6 Update `tasks.md` checkboxes
  - **Spec refs**: `design/Goals G3`.
  - **What to do**: After all validation passes, update `openspec/changes/add-v05-chatroom-complete/tasks.md` `[ ]` to `[x]` for completed items only.
  - **Must NOT do**: Do not check off failed/untested tasks; do not update before final validation evidence exists.
  - **Owning files/modules**: `openspec/changes/add-v05-chatroom-complete/tasks.md`.
  - **Recommended Agent Profile**: Category `quick`. Skills: `[]`.
  - **Parallelization**: NO | Blocks: `§9.4` final rerun, FV | Blocked By: `§9.1`–`§9.5` passing.
  - **References**: `openspec/.../tasks.md`.
  - **Acceptance Criteria**: all completed implementation and validation items checked; rerun `openspec strict` after edit.
  - **QA Scenarios**:
    ```
    Scenario: Only completed tasks checked
      Tool: Bash
      Steps: compare evidence inventory to tasks.md checkboxes.
      Expected: no checked task lacks evidence.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-6-tasks-update/evidence-map.md

    Scenario: Strict still passes
      Tool: Bash
      Steps: run openspec strict after tasks.md edit.
      Expected: exit 0.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-6-tasks-update/strict.log
    ```
  - **Commit**: YES | Message: `docs(spec): mark v05 tasks complete` | Files: `tasks.md` only.

- [ ] §9.7 Prepare V1.0 entry-criteria checklist
  - **Spec refs**: `design/Roadmap Beyond MVP V1.0`.
  - **What to do**: Write `.sisyphus/notepads/v05-chatroom-complete/v1-entry-criteria.md` with checklist of whether V0.5 outcomes satisfy Squad Mode + Team Mode + deployment entry criteria.
  - **Must NOT do**: Do not create V1.0 plan/design; do not implement Squad/Team/Deployment.
  - **Owning files/modules**: `.sisyphus/notepads/v05-chatroom-complete/v1-entry-criteria.md`.
  - **Recommended Agent Profile**: Category `writing`. Skills: `[]`.
  - **Parallelization**: YES after validations | Blocks: FV.8 | Blocked By: `§9.1`–`§9.5` evidence.
  - **References**: `design.md` roadmap; workflow no-scope-creep rules.
  - **Acceptance Criteria**: one-page checklist only; every item is ✅/❌/⚠️ with evidence link; no implementation tasks.
  - **QA Scenarios**:
    ```
    Scenario: Checklist-only artifact
      Tool: Bash
      Steps: inspect notepad headings.
      Expected: Entry criteria list with statuses, no design sections or implementation TODOs.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-7-v1-entry/checklist.md

    Scenario: Scope creep absent
      Tool: Bash
      Steps: grep checklist for implementation commands/feature plans.
      Expected: none found.
      Evidence: .sisyphus/evidence/v05-chatroom-complete/task-9-7-v1-entry/scope.md
    ```
  - **Commit**: YES if notepad tracked | Message: `docs(plan): record v1 entry criteria` | Files: notepad only.


## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
  - Verify every spec task `§0.1`–`§9.7` is implemented or explicitly validation-only with evidence.
- [ ] F2. Code Quality Review — unspecified-high
  - Review transactions, state machines, error paths, resource cleanup, and dependency boundaries.
- [ ] F3. Real Manual QA — unspecified-high + `playwright`
  - Run browser flows for @mention, PendingTurn edit/cancel, TerminalCard, Cost panel, theme/density, keyboard flow, reconnect/offline.
- [ ] F4. Scope Fidelity Check — deep
  - Confirm no V1.x/cloud/multi-user/responsive/plugin/Storybook scope creep and no protected-contract drift.

## FV Command Gate
- [ ] FV.1 `openspec.cmd validate add-v05-chatroom-complete --strict` exits 0.
- [ ] FV.2 `pnpm test` exits 0.
- [ ] FV.3 `pnpm typecheck` exits 0.
- [ ] FV.4 `pnpm lint` exits 0.
- [ ] FV.5 `pnpm check:all` exits 0.
- [ ] FV.6 `pnpm test:e2e` exits 0.
- [ ] FV.7 Oracle manually reviews `docs/agenthub-agent-workflow.md §9` checklist against final PR(s).
- [ ] FV.8 `.sisyphus/notepads/v05-chatroom-complete/v1-entry-criteria.md` exists and is checklist-only.
- [ ] FV.9 `openspec/changes/add-v05-chatroom-complete/tasks.md` checkboxes updated after validation succeeds.
- [ ] FV.10 Final Oracle architectural sign-off recorded in PR/local PR summary.

## Commit Strategy
- Preflight tasks do not commit production code.
- Each wave gets a PR/local PR boundary; commits inside a wave are logical units (`feat(scope): ...`, `test(scope): ...`, `fix(scope): ...`).
- No PR may mix unrelated waves or touch files outside assigned ownership without an explicit PR note and reviewer approval.
- Commit examples:
  - `feat(db): add v05 migration foundation`
  - `feat(events): register v05 event types`
  - `feat(orchestrator): publish terminal run briefs`
  - `feat(adapter): implement opencode acp adapter`
  - `feat(web): add pending turn panel`
  - `test(web): cover v05 chatroom flows`

## Escalation Protocol
When blocked, write `.sisyphus/notepads/v05-chatroom-complete/issues/<short-slug>.md`:
```markdown
## Problem
## Context
- Task:
- Spec refs:
- Files involved:
## What I Tried
## Observed Behavior
## Expected Behavior
## Options
## Recommendation
## Needs Decision
- [ ] 是否修改 spec
- [ ] 是否修改实现方案
- [ ] 是否延后到后续阶段
```
Escalate immediately for spec/code conflict, schema needs beyond plan, protected contract changes, security findings, unresolved framework behavior, unapproved dependency, or failing tests without root cause after 30 minutes.

## Success Criteria
- All 72 `tasks.md` items have matching completed evidence.
- All root validation commands pass.
- Phase PRs include task/spec mapping, docs checked, reference notes, worktree notes, and risks.
- Oracle approves every major phase and final gate.
- User explicitly approves final verification results before work is marked complete.

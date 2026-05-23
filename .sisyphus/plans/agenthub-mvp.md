# AgentHub MVP Implementation Plan

## TL;DR
> **Summary**: Execute `openspec/changes/add-agenthub-mvp` as the sole implementation authority, using M0–M6 milestones from `tasks.md §21` plus a mandatory final verification wave. This plan is a runner over OpenSpec: implementers must read referenced specs before each branch and must not treat this document as a replacement for OpenSpec.
> **Deliverables**: local-first AgentHub daemon, protocol/db/bus runtime, Solo/Assisted collaboration, MockAdapter golden path, permissions/interventions/context/artifacts, Web UI main/detail projection, ACP/Claude Code adapter, security/observability, V1 stubs only.
> **Effort**: XL
> **Parallel**: YES - 7 milestone waves + final review wave
> **Critical Path**: M0 bootstrap/registries/checks → M1 RunLifecycle/RunQueue/Mock golden path → M3 ArtifactFS → M5 ACP/Claude → M6 hardening → Final verification

## Context

### Original Request
User requested a work plan for implementing the MVP of a multi-agent collaboration workbench from `C:\project\AgentHub\openspec`, while strictly obeying `C:\project\AgentHub\docs\agenthub-agent-workflow.md`.

### Source Snapshot
- OpenSpec change: `add-agenthub-mvp`
- Strict validation: `openspec.cmd validate add-agenthub-mvp --strict` passed
- `tasks.md` snapshot: SHA256 `552542F3FD89B6C412EAAD041C44C6260C00F08C103222C0E091087C34F752E5`, Read-tool total `468` lines
- Active OpenSpec state: `0/322` tasks complete
- Product code state: no root `package.json` / app source found; implementation starts at bootstrap

If `openspec/changes/add-agenthub-mvp/tasks.md` changes, pause execution and request senior-agent approval to refresh this plan.

### Interview Summary
- User provided authoritative specs and workflow doc rather than asking for new product design.
- No implementation is authorized in Prometheus mode.
- Default planning decisions applied: preserve per-task branch/PR/review discipline; collapse known overlapping §19/§20 corrections into canonical execution order; define MockAdapter internal beta and Claude-backed MVP done.

### Metis Review (gaps addressed)
- Added workflow compliance block and protected-contract guardrails.
- Added patch reconciliation policy for §19/§20 overlaps.
- Added pre-resolved ambiguity list for branch granularity, §16.9 duplicate numbering, §19/§20 overlap, and Claude adapter gating.
- Added hard sequencing constraints to prevent `StartRun`, direct HTTP event publish, per-write file interception, duplicate migrations, and V1 scope creep.
- Added concrete verification commands and invariant tests.

## Workflow Compliance Block

### Mandatory Development Flow
Every implementation leaf task follows `docs/agenthub-agent-workflow.md`:
1. Read referenced `tasks.md` item, capability `spec.md`, and relevant `design.md` decision.
2. Confirm one-sentence scope: deliver exactly this task; explicitly state non-deliverables.
3. Create a task branch: `task/<task-id>-<short-name>`.
4. Write tests first or test-synchronously.
5. Implement minimal functionality only.
6. Run verification: `git diff --check`, `openspec.cmd validate add-agenthub-mvp --strict`, relevant tests, `bun run check:all` once M0 installs it.
7. Commit one logical unit.
8. Open PR or local PR boundary.
9. Review agent checks diff.
10. Senior agent approves merge.
11. Only after merge may the next dependent task proceed.

### Protected Contracts — Must Not Be Bypassed
- `WakeAgent` is the only model-call / run-creation entry.
- No `StartRun` Command exists.
- `RunLifecycleService` is the only writer for `runs` and `agent.run.*` durable events.
- Command and Event are separate.
- Durable events are replayable.
- Event envelope and `visibility` are owned by `event-system`.
- EventBus / CommandBus interfaces cannot drift silently.
- RunQueue schedules through lock matrix.
- `observe` is passive and never calls model APIs.
- Heavy coding agents default to run-level diff, not per-file write interception.
- ArtifactFS is the file-write gate.
- Permission Engine is the permission gate.
- Context Ledger `confirmed` needs trusted source or user decision.
- Main chat stream shows brief/actionable cards; full context goes to Run Detail.
- Product is local-first only: no SaaS, cloud, multi-user auth, Postgres, Redis, WebSocket Hub, Mobile Native, Marketplace.

### PR Template Required for Every Leaf Task
```markdown
## Task
- Task: `tasks.md §<id>`
- Spec refs:
  - `<capability>/<Requirement>`

## Changes
- ...

## Verification
- [ ] `git diff --check`
- [ ] `openspec.cmd validate add-agenthub-mvp --strict`
- [ ] `<task-specific test command>`
- [ ] `bun run check:all` once available

## Reference Notes
- Looked at: `<path or N/A>`
- Borrowed idea: `<specific idea only>`
- Differences from AgentHub: `<why spec remains source of truth>`

## Docs Checked
- `<official docs if framework behavior was unclear>`

## Risks / Open Questions
- ...
```

## Pre-Resolved Ambiguities / Defaults Applied
- **Branch/PR granularity**: default is hybrid. Protected-contract tasks are strict one leaf/sub-leaf per PR. Bootstrap/schema-only leaf tasks may group only when the plan task explicitly allows it, but commits must remain atomic and PR must list each OpenSpec task.
- **§19/§20 overlap**: §20 is canonical where it supersedes §19. Do not apply duplicate schema changes. Use the reconciliation table below.
- **MVP done**: MockAdapter golden path is “internal beta”; production MVP done requires M5/M6 completion and Claude Code adapter verification, unless senior agent records environment blocker.
- **Duplicate `tasks.md §16.9`**: refer to `§16.9-CSRF` for the middleware item and `§16.9-security-tests` for the security test item. Do not edit OpenSpec numbering without senior-agent approval.
- **Bun/Node matrix**: Bun primary. Node 22 compatibility mandatory for `packages/{daemon,adapters/*,artifacts}` and CI matrix jobs from §0.4.
- **Reference projects**: use `C:\project\refrence` only if present. If absent, PR `Reference Notes` says `N/A - reference directory unavailable`.
- **Reviewer identity**: review-agent = `oracle` for protected contracts/security; otherwise `unspecified-high`. senior-agent approval = explicit user/senior-agent approval before merge.

## Patch Reconciliation Table

| Patch Area | Canonical Handling | Do Not Do |
|---|---|---|
| §19.6.1 `events.visibility` | Superseded by §20.3.1; implement once under event-system ownership | Do not add visibility in messaging then ALTER again |
| §19.4.x Run claimed/session/failure | Merge with §20.2.x; §20.2 method signatures and `failureClass` are canonical | Do not land old `fail(reason)` signature |
| §19.3 WakeAgent | Merge into §20.1; §20.1 is canonical for no `StartRun` and `ConsumePendingTurn` | Do not create internal `StartRun` placeholder |
| §19.2 ArtifactFS | Standalone, but must land before §12 Claude adapter | Do not implement per-write permission cards |
| §19.12 mailbox/next_turn | Standalone with §20.1 terminal hook ordering | Do not implement mailbox read with broad `read=0` query |
| §20.4 five CI checks | Move into M0 immediately after protocol registry skeleton | Do not wait until final hardening |
| §20.5 preview/attach/trusted tool | Merge into M6 security/hardening | Do not allow `allow-same-origin` iframe |

## Work Objectives

### Core Objective
Deliver AgentHub MVP exactly as specified by `openspec/changes/add-agenthub-mvp`, with strict workflow/review boundaries and evidence-backed verification.

### Deliverables
- Monorepo/tooling and CI gates.
- SQLite/Drizzle schema and protocol registry.
- EventBus, CommandBus, Outbox, durable handlers, RunQueue, RunLifecycleService.
- Daemon + CLI + SDK shell.
- Rooms/messages/agents basics.
- MockAdapter golden path.
- Permission, intervention, context ledger, artifacts, observability, security.
- Web UI main timeline + Run Detail projection + PendingTurn UI.
- ACP base + Claude Code adapter.
- V1 placeholders returning 501 / not implemented only.

### Definition of Done
- `openspec.cmd validate add-agenthub-mvp --strict` passes.
- `bun run check:all` passes with `events:check`, `visibility:check`, `subscriptions:check`, `command:check`, `run-state-machine:check`.
- `bun run lint`, `bun run typecheck`, `bun test`, and Playwright golden path pass.
- All 322 OpenSpec tasks are completed or explicitly senior-approved as environment-blocked.
- Final verification wave F1–F4 approves and user/senior agent explicitly approves completion.

### Must Have
- Task branches and PR/review boundaries.
- Tests/evidence for each task.
- Strict escalation on spec conflict, protected-contract changes, new dependency, unclear framework behavior, failing tests >30 min, or need to reduce verification.

### Must NOT Have
- No source changes directly on main.
- No self-merge.
- No unapproved dependencies.
- No direct writes bypassing ArtifactFS.
- No direct permission bypass.
- No direct `runs` / `agent.run.*` writes outside RunLifecycleService.
- No post-MVP real functionality beyond stubs.
- No cloud/SaaS/Postgres/Redis/Next.js/mobile-native drift.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-synchronous for all tasks; TDD required for state machines, bus, security, permissions, artifacts, orchestrator, and adapter logic.
- Framework: Vitest under Bun; Playwright for web E2E; OpenSpec strict for spec validity; custom check scripts from §20.4.
- Evidence root: `.sisyphus/evidence/agenthub-mvp/` plus package-local `test-results/` where test runners require it.
- Every PR must attach evidence paths in the PR body.

## Execution Strategy

### Parallel Execution Waves
Wave M0: repo/tooling + protocol skeleton + five CI checks + DB/schema foundation.
Wave M1: bus runtime, RunLifecycle, lock matrix, daemon read-only surfaces, rooms/messages/agents, MockAdapter golden path.
Wave M2: permissions, interventions, context ledger, observability/debug basics.
Wave M3: artifacts, ArtifactFS, run-level diff, apply/revert.
Wave M4: Web UI main timeline, Run Detail, cards, PendingTurn UI, Playwright golden path.
Wave M5: ACPAdapter base, Claude Code adapter, adapter liveness/config/capability updates.
Wave M6: security closure, raw/debug auth, worktree GC, recovery, V1 stubs, docs/demo.
Wave FV: final verification and four-agent review.

### Dependency Matrix
- M0 blocks all code tasks.
- M1 depends on M0; M1 protected-contract work must complete before M2/M3 rely on bus/run events.
- M2 depends on EventBus/CommandBus and schema tasks from M1.
- M3 depends on Permission Engine basics and RunLifecycle/RunQueue.
- M4 depends on SDK/OpenAPI, SSE, event visibility, card schemas, and artifacts APIs.
- M5 depends on ArtifactFS, AdapterBridge, ReclaimStaleClaimedRun, permissions, context injection, and observability raw logs.
- M6 depends on all runtime surfaces.
- FV depends on M0–M6 complete.

### Agent Dispatch Summary
- Protected contracts/security/state machines: `oracle` review + `unspecified-high` implementation.
- UI/E2E: `visual-engineering` implementation + Playwright verification.
- Docs: `writing` implementation.
- Small stubs/bootstrap: `quick` or `unspecified-low`.

## Full MVP Delivery Contract

This plan is upgraded from a milestone guide to a **complete MVP delivery contract**. `/start-work` must not stop at “first runnable slice”; it must continue until every current `tasks.md` leaf item from `§0` through `§20.6` is either completed and reviewed or explicitly recorded as senior-agent-approved environment-blocked.

### Completion Rule
- Required completion target: `openspec list --json` reports `completedTasks == totalTasks` for `add-agenthub-mvp` OR a senior-agent-signed exception file exists at `.sisyphus/evidence/agenthub-mvp/final/task-exceptions.md`.
- Every checked OpenSpec task must have: branch/PR boundary, spec refs, verification command output, review result, merge approval, and evidence path.
- M0–M6 are scheduling waves only; they do not reduce scope. All leaf tasks in their covered OpenSpec sections remain mandatory.
- “Internal beta” is not completion. Full MVP requires M5 Claude path or a recorded local-environment blocker plus all MockAdapter and adapter-abstraction tests green.

### OMO Execution Model
- Wave coordinator: one `deep` agent per wave owns dependency tracking, PR queue, evidence index, and final wave summary.
- Parallel implementers: use `quick` for bounded scaffold/stub/doc/test-harness tasks, `unspecified-high` for normal package implementation, `deep` for protected contracts/concurrency/security, `visual-engineering` for UI, `writing` for docs.
- Post-task review: every PR gets one review agent; protected contracts get `oracle`; UI gets `unspecified-high + playwright`; docs get `writing` self-check plus `unspecified-high` review.
- Merge gate: no task is marked done until review agent passes and senior-agent approval is recorded.
- Evidence index: each wave maintains `.sisyphus/evidence/agenthub-mvp/<wave>/index.md` mapping OpenSpec task IDs to PR branch, test logs, review result, and merge approval.

### OMO Dispatch Matrix — Complete Current Spec Coverage

| OpenSpec Tasks | Wave | Dispatch Agent(s) | Parallelism | Reviewer | Merge Gate | Completion Evidence |
|---|---|---|---|---|---|---|
| §0.1–§0.7 Repo/tooling bootstrap | M0 | `quick` for README/LICENSE/docs placeholders; `unspecified-high` for workspace/turborepo/TS/test tooling/CI | §0.1→§0.2 blocks package tasks; §0.3/§0.4 can parallel after §0.1 | `unspecified-high` | M0 coordinator + senior approval | `m0/index.md`, CI bootstrap logs |
| §1.1–§1.13 DB and migrations | M0 | `unspecified-high`; split migrations across multiple `quick` only after schema conventions are established | Migrations may parallel by table group after §1.1–§1.2; final §1.13 waits all | `oracle` for schema consistency | M0 coordinator + senior approval | migration test logs per migration |
| §2.1–§2.7 Protocol/schema | M0 | `deep` for EventEnvelope/registry; `unspecified-high` for domain/adapter/OpenAPI/migrator | §2.1 blocks §20.4; §2.2/§2.3 parallel after §2.1 | `oracle` | M0 coordinator + senior approval | schema round-trip and schema:check logs |
| §20.4.1–§20.4.6 Five CI checks | M0 | `deep` | Sequential: events/visibility → subscriptions → command → run-state-machine → aggregate | `oracle` | Must pass before M1 protected contracts merge | `m0/check-all.log` |
| §3.1–§3.7 EventBus basics | M1 | `deep` | EventBus publish/replay/delta can parallel after schema | `oracle` | M1 coordinator | event bus integration logs |
| §3.8–§3.19 Bus runtime mega-section | M1 | `deep` only for §3.9–§3.14/§3.17–§3.19; `unspecified-high` for dispatcher/registry pieces | Use PR splits `P-3.9` through `P-3.14e`; no broad parallel on state machine | `oracle` mandatory | Senior approval per protected PR | bus/runtime invariant logs |
| §20.1–§20.3 Consistency closure for WakeAgent/RunLifecycle/event-system | M1 | `deep` | Interleave with §3 canonical implementation, not after as patch | `oracle` | Blocks any run-producing feature | no-StartRun, run-state, visibility logs |
| §19.3, §19.4, §19.12 Run/passive/mailbox closures | M1 | `deep` | Land with §3.14 siblings; mailbox subtests can parallel after schema | `oracle` | Senior approval | observe/mailbox/reclaim logs |
| §4.1–§4.10 Daemon/CLI/SDK shell | M1 | `unspecified-high`; `quick` for CLI subcommands after daemon patterns exist | Read-only routes can parallel; mutating routes wait §3.10 | `unspecified-high`, `oracle` for security-sensitive bind/auth | M1 coordinator | daemon smoke/SSE logs |
| §5.1–§5.12 Rooms/messages/agents basics | M1 | `unspecified-high`; `quick` for 501 placeholders and CRUD slices | Room CRUD, agent profile loader, message CRUD can parallel after DB/protocol | `unspecified-high` | M1 coordinator | CRUD integration logs |
| §6.1–§6.6 MockAdapter | M1 | `unspecified-high` | DSL and manager can parallel after adapter schema | `oracle` for adapter manager, `unspecified-high` for DSL | M1 coordinator | mock golden path logs |
| §7.1–§7.10 Permission Engine | M2 | `deep` for decision/deferred/queue; `unspecified-high` for APIs/templates | Templates/API can parallel; decision engine blocks tests | `oracle` | Senior approval due Permission Engine contract | permission matrix logs |
| §19.5 Permission per-session queue | M2 | `deep` | Sequential with §7.3, before real adapters | `oracle` | Blocks M5 | permission queue logs |
| §8.1–§8.10 Context Ledger | M2 | `deep` for confirmed/trusted/versioning; `unspecified-high` for CRUD/NoopVectorIndex | CRUD/pin/visibility can parallel after model; assembly waits CRUD | `oracle` for confirmed/trusted behavior | M2 coordinator | context ledger logs |
| §20.5.5 trusted_system_tool | M2 | `deep` | Must merge before context marked done | `oracle` | Senior approval | trusted tool audit logs |
| §10.1–§10.8 Intervention Engine | M2 | `unspecified-high` | CRUD/API/snooze/presence can parallel after model | `unspecified-high` | M2 coordinator | intervention state machine logs |
| §15.1–§15.5, §15.8 Observability basics | M2 | `unspecified-high`; `quick` for endpoint shells | Logger/trace/raw API can parallel; Debug UI waits M4 if needed | `unspecified-high` | M2 coordinator | trace/debug logs |
| §11.1–§11.10 Artifacts | M3 | `deep` for apply/revert/preview safety; `unspecified-high` for CRUD/file/terminal | CRUD/file terminal can parallel; apply flow sequential | `oracle` for file safety | Senior approval | artifact apply/revert logs |
| §19.2.1–§19.2.9 ArtifactFS | M3 | `deep` | isolated_worktree and shadow_buffer can parallel after interface; ACP/MCP routing waits base interface | `oracle` | Blocks M5 real adapter | artifactfs multi-file logs |
| §20.5.1–§20.5.3 ArtifactFS/preview closure | M3 | `deep` | Merge with §19.2/§11.7 | `oracle` | Senior approval | preview isolation logs |
| §14.1–§14.17 Web UI | M4 | `visual-engineering`; `quick` for Storybook fixtures/cards after patterns | Layout/SSE/projector/card families can parallel after SDK; golden path waits all | `unspecified-high + playwright` | M4 coordinator | Playwright + Storybook logs |
| §19.6.10–§19.6.12 Main Timeline/Run Detail/PendingTurn UI | M4 | `visual-engineering` | Run Detail tabs can parallel by tab after projector | `unspecified-high + playwright` | M4 coordinator | main/detail/pending-turn e2e logs |
| §12.1–§12.11 ClaudeCodeAdapter | M5 | `deep` | Manifest/detect can start early; createSession/startRun/hook/inject/cancel sequential | `oracle` | Senior approval; environment blocker if no claude | claude real-smoke or blocker evidence |
| §13.1–§13.5 Post-MVP adapter stubs | M5 | `quick` | OpenCode/Codex/LangGraph/A2A stubs parallel | `unspecified-high` | M5 coordinator | 501 stub tests |
| §19.1 ACPAdapter base | M5 | `deep` | State machine before cancel/dispose/prompt; subclasses after base | `oracle` | Blocks Claude adapter | ACP pending/cancel logs |
| §19.8–§19.10 Adapter liveness/raw/spawn | M5 | `deep` for liveness/spawn; `unspecified-high` for dedupe/throttle | Can parallel after ACP base | `oracle` | M5 coordinator | liveness/raw/spawn logs |
| §19.14 adapter.config/capabilities events | M5 | `unspecified-high` | Parallel after event registry | `oracle` for registry visibility | M5 coordinator | event registry/check logs |
| §20.5.4 attachSession consistency | M5 | `deep` | Must merge before Claude resumable verification | `oracle` | Senior approval | attachSession CI logs |
| §16.1–§16.10 + duplicate §16.9 tests | M6 | `deep` for CSRF/redactor/path/keychain; `unspecified-high` for token APIs; `quick` for POSIX warning | Token/keychain/path/redactor can parallel; CSRF waits daemon auth shape | `oracle` | Senior approval | security matrix logs |
| §17.1–§17.5 V1 interfaces/stubs | M6 | `quick` for stubs; `unspecified-high` for interface shape | Parallel; all must stay stub-only | `unspecified-high` | M6 coordinator | 501/no-real-impl logs |
| §18.1–§18.10 Docs/demo/performance/V0.5 plan | M6 | `writing` for docs; `visual-engineering` for demo; `unspecified-high` for perf tests | Docs parallel after implementation stabilizes; perf waits final build | `unspecified-high` | M6 coordinator + senior approval | docs/perf/demo evidence |
| §19.7, §19.11, §19.13 Hardening closures | M6 | `deep` | PubSub/worktree/safe URI can parallel after runtime/security base | `oracle` | Senior approval | raw flood/gc/safe-uri logs |
| §19.15, §20.6 Acceptance | FV | `deep` coordinator + review agents | Runs after all waves | F1–F4 | Explicit user/senior OK | final evidence bundle |

### Per-Task Dispatch Record Template
Every OpenSpec leaf task executed by OMO must create/update this record in the wave evidence index:

```markdown
### tasks.md §<id> <title>
- Branch: `task/<id>-<slug>`
- Implementer: `<quick|unspecified-high|deep|visual-engineering|writing>`
- Reviewer: `<oracle|unspecified-high|playwright|writing>`
- Protected contracts touched: `<list|none>`
- Can run in parallel with: `<task ids>`
- Must wait for: `<task ids>`
- Verification:
  - `<exact command>` -> `<evidence path>`
- PR / local PR summary: `<path or URL>`
- Review result: `<approved|changes requested>`
- Senior approval: `<who/time>`
```

### Parallel Dispatch Rules
- Use multiple `quick` agents only for tasks with no protected contracts and no shared mutable source files: docs, stubs, package scaffolds, simple CRUD endpoints after patterns exist, Storybook fixtures, 501 placeholders.
- Use `deep` exclusively for: EventBus/CommandBus, RunLifecycleService, WakeAgent, RunQueue locks, ArtifactFS, Permission Engine, Context confirmed/trusted path, security middleware/redaction/path safety, adapter process lifecycle.
- Use `visual-engineering` for UI work only after protocol/card schemas are merged; do not let UI agents invent backend fields.
- Use `oracle` review for every task touching protected contracts, security, concurrency, migrations that alter events/runs/permissions/context, or adapter process control.
- Wave coordinator must stop parallel dispatch if two tasks touch the same protected file family or if a check script starts failing in main.

### Full MVP Non-Negotiable Acceptance Gates
1. OpenSpec: `openspec.cmd validate add-agenthub-mvp --strict` passes and active change reports all tasks complete or approved exceptions.
2. Runtime checks: `bun run check:all`, `bun run check:deps`, `bun run lint`, `bun run typecheck`, `bun test --coverage` pass.
3. E2E: Playwright golden path passes for Solo + Assisted + DiffCard apply + PendingTurn + Run Detail.
4. Adapter: MockAdapter full loop passes; Claude adapter real smoke passes or has senior-approved local-environment blocker with ACP abstraction tests green.
5. Security: CSRF/Origin/Host, SecretRedactor, path/symlink, sensitive file deny, debug/raw authorization, preview iframe isolation all pass.
6. Durability: event replay, handler retry/DLQ, crash reclaim, mailbox atomic claim, run_next_turn carry, lock matrix, raw flood isolation all pass.
7. Review: F1–F4 final review agents all approve; user/senior agent explicitly says OK.

## TODOs

> Implementation + Test = ONE task. Leaf implementers must expand each listed OpenSpec section into branch/PR units according to the listed PR boundary. For mega tasks, use the named subtask IDs below exactly.

- [x] 1. M0 Repo, Protocol Skeleton, CI Gates, DB Foundation

  Progress note: M0.1 bootstrap slice (`tasks.md §0.1`, `§0.5`, `§0.6`) verified on 2026-05-23; top-level M0 remains open until M0.2-M0.5 complete.

  **What to do**: Implement `tasks.md §0`, `§1`, `§2.1`, `§2.2`, `§2.5`, `§2.6`, and `§20.4` in this order: repo bootstrap → protocol registry skeleton → five custom CI scripts (allow empty registry) → DB migrations/schema tests → schema/migrator checks. Also add dependency deny-list check and Bun-only API check.
  **Must NOT do**: Do not build daemon routes before CommandBus guardrails. Do not introduce banned deps. Do not use Bun-only APIs in daemon/adapter packages.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - repo bootstrap plus CI/schema has protected long-term impact.
  - Skills: []
  - Omitted: `frontend-ui-ux` - no UI implementation yet.

  **Parallelization**: Can Parallel: PARTIAL | Wave M0 | Blocks: all later tasks | Blocked By: none. §0.1–§0.7 can run first; §20.4 waits for §2.1 skeleton; §1 migrations wait for package bootstrap.

  **References**:
  - OpenSpec: `openspec/changes/add-agenthub-mvp/tasks.md §0, §1, §2.1, §2.2, §2.5, §2.6, §20.4`
  - Design: `openspec/changes/add-agenthub-mvp/design.md D1-D6, D31, D32`
  - Specs: `specs/event-system/spec.md`, `specs/local-daemon/spec.md`, `specs/bus-runtime/spec.md`
  - Workflow: `docs/agenthub-agent-workflow.md §3, §4, §8, §10`

  **Acceptance Criteria**:
  - [ ] `openspec.cmd validate add-agenthub-mvp --strict` exits 0.
  - [ ] `bun run check:all` exists and runs five checks; empty registry mode passes only until events/commands are registered.
  - [ ] `bun run check:deps` rejects `pg`, `postgres`, `redis`, `ioredis`, `nats`, `kafkajs`, `pgvector`, `react-native`, `expo`, `next`.
  - [ ] `Select-String -Path 'packages/**/*.ts' -Pattern 'Bun\.(serve|file|spawn|write|password)'` returns no daemon/adapter violations.
  - [ ] DB migration tests cover every table listed in `tasks.md §1`.

  **QA Scenarios**:
  ```
  Scenario: Bootstrap and checks pass
    Tool: Bash
    Steps: Run `bun install`, `bun run lint`, `bun run typecheck`, `bun run check:all`, `openspec.cmd validate add-agenthub-mvp --strict`.
    Expected: All commands exit 0; check output names all five custom checks.
    Evidence: .sisyphus/evidence/agenthub-mvp/m0/check-all.log

  Scenario: Banned dependency fails CI
    Tool: Bash
    Steps: In a temporary test fixture package.json include `redis`; run `bun run check:deps -- --fixture tmp/banned-dep/package.json`.
    Expected: Non-zero exit and message `banned dependency: redis`.
    Evidence: .sisyphus/evidence/agenthub-mvp/m0/check-deps-negative.log
  ```

  **Commit**: YES | Message: `chore(repo): bootstrap agenthub workspace and checks` | Files: repo bootstrap, package manifests, CI scripts, DB/protocol packages.

- [x] 2. M1 Bus Runtime, RunLifecycle, Lock Matrix, Mock Golden Path

  Progress note: M1.1 EventBus durable/ephemeral publishing, replay, trace helpers, delta coalescing, and tests verified on 2026-05-23; top-level M1 remains open until M1.2-M1.4 complete.

  Progress note: M1.2 CommandBus idempotency, outbox dispatcher, DurableHandlerRegistry, DLQ, and mutating HTTP command guard verified on 2026-05-23; top-level M1 remains open until M1.3-M1.4 complete.

  Progress note: M1.3 RunLifecycleService, WakeAgent, RunQueue lock matrix, startup recovery, AdapterBridge, and ReclaimStaleClaimedRun verified on 2026-05-23; top-level M1 remains open until M1.4 complete.

  **What to do**: Implement `tasks.md §3`, `§4` read-only routes, `§5`, `§6`, `§9.1-§9.8`, `§19.3`, `§19.4`, `§19.12`, `§20.1`, `§20.2`, `§20.3`. Split mega work into these PR boundaries:
  - `P-3.9-commandbus`: CommandBus idempotency and no `StartRun`.
  - `P-3.10-http-command-guard`: no direct publish/domain writes from mutating HTTP routes.
  - `P-3.12-handler-registry`: durable handler cursor/retry/DLQ basics.
  - `P-3.14a-runlifecycle`: RunLifecycleService methods and state machine.
  - `P-3.14b-wakeagent`: WakeAgent handler and zero-input guard.
  - `P-3.14c-runqueue-locks`: RunQueue worker plus §9.8 file/workspace lock matrix.
  - `P-3.14d-cancel-recovery`: CancelRun, startup recovery hooks, lock timeout.
  - `P-3.14e-adapterbridge`: AdapterBridge canonical session.opened two-step.
  - `P-19.4.5-reclaim`: ReclaimStaleClaimedRun lands immediately with AdapterBridge.
  - `P-19.12-mailbox`: mailbox atomic claim, run_next_turns, read_mailbox dual-source consume.
  - `P-6-mock-golden`: MockAgentAdapter full say/diff/permission/intervention script.
  **Must NOT do**: Do not introduce `StartRun`. Do not let HTTP handlers publish events directly. Do not implement Claude adapter yet. Do not defer lock matrix to later orchestrator work.

  **Recommended Agent Profile**:
  - Category: `deep` - protected state machines and concurrency.
  - Skills: []
  - Omitted: `frontend-ui-ux` - no UI except route smoke tests.

  **Parallelization**: Can Parallel: PARTIAL | Wave M1 | Blocks: M2/M3/M4/M5 | Blocked By: Task 1. Rooms/messages/agents CRUD may proceed after schema, while RunLifecycle waits for CommandBus/EventBus.

  **References**:
  - OpenSpec: `tasks.md §3, §4, §5, §6, §9.1-§9.8, §19.3, §19.4, §19.12, §20.1-§20.3`
  - Design: D22, D23, D26, D28, D30, D31
  - Specs: `bus-runtime`, `event-system`, `orchestrator`, `agents`, `rooms`, `messaging`, `adapter-framework`

  **Acceptance Criteria**:
  - [ ] `bun run check:command` proves no `StartRun` or `ApplyMailboxClaimRollback` dispatch exists.
  - [ ] `bun run check:run-state-machine` proves all RunLifecycle transitions implemented.
  - [ ] Mock Solo room golden path creates message → WakeAgent → run queued/claimed/started/running/completed → assistant reply.
  - [ ] Observer passive test proves observer LLM calls = 0 without explicit wake.
  - [ ] Mailbox atomic claim and next_turn carry tests pass.

  **QA Scenarios**:
  ```
  Scenario: No double scheduling
    Tool: Bash
    Steps: Run `bun run check:command` and `bun test packages/bus/test/no-double-schedule.test.ts --run`.
    Expected: No `StartRun`; primary busy with 5 messages produces 5 WakeAgent-caused runs and no alternate causation chain.
    Evidence: .sisyphus/evidence/agenthub-mvp/m1/no-double-schedule.log

  Scenario: Mailbox atomicity under contention
    Tool: Bash
    Steps: Run `bun test packages/orchestrator/test/mailbox-atomic-claim.test.ts --run`.
    Expected: Concurrent `read_mailbox` calls produce one owner or idempotent same-batch replay; no ghost delivery.
    Evidence: .sisyphus/evidence/agenthub-mvp/m1/mailbox-atomic.json
  ```

  **Commit**: YES | Message: `feat(runtime): establish bus and mock run lifecycle` | Files: bus, daemon route skeleton, rooms/messages/agents, mock adapter, orchestrator.

- [x] 3. M2 Permission, Intervention, Context Ledger, Debug Basics

  **What to do**: Implement `tasks.md §7`, `§8`, `§10`, `§15.1-§15.5`, `§15.8`, `§19.5`, and context trusted tool closure from `§20.5.5`. Permission per-session queue and timeout pause are required before real adapter work.
  **Must NOT do**: Do not allow agents to write confirmed context except via trusted system tool or user confirmation. Do not let PermissionCard concurrency bypass per-session queue.

  **Recommended Agent Profile**:
  - Category: `deep` - permissions/context/intervention are core safety contracts.
  - Skills: []
  - Omitted: `frontend-ui-ux` - UI card rendering occurs in M4.

  **Parallelization**: Can Parallel: YES | Wave M2 | Blocks: M3/M5 | Blocked By: Task 2 event/run foundations.

  **References**:
  - OpenSpec: `tasks.md §7, §8, §10, §15.1-§15.5, §15.8, §19.5, §20.5.5`
  - Design: D9, D11, D12, D14, D27
  - Specs: `permissions`, `context-ledger`, `interventions`, `observability`

  **Acceptance Criteria**:
  - [ ] Permission ask/allow/deny/timeout/stored rule tests pass.
  - [ ] Per-session queue serializes concurrent permission requests and pauses adapter prompt timeout.
  - [ ] Context agent-confirmed bypass is downgraded/rejected per spec.
  - [ ] Intervention approve/later/ignore/reject state machine passes.
  - [ ] Debug event API filters by traceId/runId/type.

  **QA Scenarios**:
  ```
  Scenario: Permission queue serializes same session
    Tool: Bash
    Steps: Run `bun test packages/permissions/test/per-session-queue.test.ts --run`.
    Expected: Three same-session permission requests are presented/resolved in FIFO order; duplicate toolCallId returns existing request.
    Evidence: .sisyphus/evidence/agenthub-mvp/m2/permission-queue.json

  Scenario: Agent cannot confirm context directly
    Tool: Bash
    Steps: Run `bun test packages/context/test/trusted-confirmed-write.test.ts --run`.
    Expected: Untrusted agent tool attempting `status=confirmed` is downgraded to draft or rejected; audit event emitted.
    Evidence: .sisyphus/evidence/agenthub-mvp/m2/context-trusted-tool.json
  ```

  **Commit**: YES | Message: `feat(safety): add permissions interventions and context ledger` | Files: permissions, interventions, context, observability.

- [x] 4. M3 Artifacts and ArtifactFS Run-Level Diff

  Progress note: M3.1 artifact primitives and apply-root boundary fix verified on 2026-05-23; top-level M3 remains open until ArtifactFS run-level diff is complete.

  **What to do**: Implement `tasks.md §11`, `§19.2`, and `§20.5.1-§20.5.3` before any real coding adapter. ArtifactFS must route ACP/MCP file writes to isolated worktree or shadow buffer and generate run-level DiffArtifact at run terminal state.
  **Must NOT do**: Do not implement per-file write approval cards. Do not allow terminal-enabled agents to use `shadow_buffer`. Do not set iframe `allow-same-origin`.

  **Recommended Agent Profile**:
  - Category: `deep` - file safety and diff application are protected contracts.
  - Skills: []
  - Omitted: `frontend-ui-ux` - UI DiffCard integration is M4.

  **Parallelization**: Can Parallel: PARTIAL | Wave M3 | Blocks: M5 Claude adapter and M4 DiffCard apply flow | Blocked By: Tasks 2 and 3.

  **References**:
  - OpenSpec: `tasks.md §11, §19.2, §20.5.1-§20.5.3`
  - Design: D7, D13, D17, D24
  - Specs: `artifacts`, `permissions`, `security`, `adapter-framework`

  **Acceptance Criteria**:
  - [ ] Multi-file run produces one correct DiffArtifact.
  - [ ] Sensitive file write is denied inside ArtifactFS without writing shadow or disk.
  - [ ] Apply flow prevalidates `oldSha256`, writes temp siblings, rolls back partial failure, emits recovery-required when rollback fails.
  - [ ] Preview token is one-time and expires; iframe sandbox is strict.

  **QA Scenarios**:
  ```
  Scenario: Run-level multi-file diff
    Tool: Bash
    Steps: Run `bun test packages/artifacts/test/artifact-fs-multi.test.ts --run`.
    Expected: Edits to a.ts/b.ts/d.ts produce one diff; c.ts reverted mid-run is absent; final d.ts content wins.
    Evidence: .sisyphus/evidence/agenthub-mvp/m3/artifactfs-multi.json

  Scenario: Partial apply rollback
    Tool: Bash
    Steps: Run `bun test packages/artifacts/test/apply-partial-rollback.test.ts --run`.
    Expected: Simulated disk failure rolls back renamed files or emits `artifact.failed { reason: recovery_required }` with affected files.
    Evidence: .sisyphus/evidence/agenthub-mvp/m3/apply-rollback.json
  ```

  **Commit**: YES | Message: `feat(artifacts): add run-level diff artifact fs` | Files: artifacts, security preview, adapter file capabilities.

- [x] 5. M4 Web UI Main Timeline, Run Detail, Cards, PendingTurn

  **What to do**: Implement `tasks.md §14`, `§19.6.10-§19.6.12`, relevant card UI from permissions/interventions/context/artifacts, and Playwright golden path. UI subscribes main view by default; Run Detail opens detail/raw views with authorization.
  **Must NOT do**: Do not show raw stdout in main timeline. Do not build post-MVP Kanban/visualization. Do not require manual UI verification.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - frontend, cards, UX, Playwright.
  - Skills: [`playwright`] - browser E2E verification.
  - Omitted: []

  **Parallelization**: Can Parallel: YES | Wave M4 | Blocks: final golden path | Blocked By: Tasks 2-4 API/event/card schemas.

  **References**:
  - OpenSpec: `tasks.md §14, §19.6.10-§19.6.12`
  - Design: D2, D18, D28
  - Specs: `web-ui`, `messaging`, `event-system`, `permissions`, `interventions`, `artifacts`

  **Acceptance Criteria**:
  - [ ] Three-column layout, room list, message virtualization, input box, cards, side panels implemented.
  - [ ] Main timeline hides token/tool/raw details; Run Detail shows 7 tabs.
  - [ ] PendingTurn queued/cancel/edit UI works while primary busy.
  - [ ] Playwright golden path passes in CI.

  **QA Scenarios**:
  ```
  Scenario: Main timeline brief and Run Detail split
    Tool: Playwright
    Steps: Run `pnpm playwright test apps/web/e2e/main-detail-projection.spec.ts --reporter=json --output=apps/web/test-results/main-detail`.
    Expected: Main timeline contains brief/actionable cards only; clicking brief opens Run Detail with Transcript/Tools/Context/Permissions/Artifacts/Raw Stream/Cost tabs.
    Evidence: .sisyphus/evidence/agenthub-mvp/m4/main-detail/

  Scenario: PendingTurn UI while busy
    Tool: Playwright
    Steps: Run `pnpm playwright test apps/web/e2e/pending-turn.spec.ts --reporter=json --output=apps/web/test-results/pending-turn`.
    Expected: User can send while primary busy, sees queued position, can cancel/edit, and 21st queued turn shows limit banner.
    Evidence: .sisyphus/evidence/agenthub-mvp/m4/pending-turn/
  ```

  **Commit**: YES | Message: `feat(web): add agenthub main timeline and run detail` | Files: apps/web, UI packages, Playwright tests.

- [x] 6. M5 ACPAdapter Base and Claude Code Adapter

  **What to do**: Implement `tasks.md §12`, `§13`, `§19.1`, `§19.8`, `§19.9`, `§19.10`, `§19.14`, `§20.5.4`, with ACP base class first, provider-specific subclasses second, Claude real adapter third, and stubs returning 501/not implemented. Real adapter must use ArtifactFS, Permission Engine, AdapterBridge, liveness, raw redaction, and attachSession consistency.
  **Must NOT do**: Do not connect Claude before ArtifactFS and ReclaimStaleClaimedRun are in place. Do not scrape stdout when ACP structured path exists. Do not implement OpenCode/Codex/LangGraph/A2A real behavior in MVP.

  **Recommended Agent Profile**:
  - Category: `deep` - external process/protocol/recovery complexity.
  - Skills: []
  - Omitted: `frontend-ui-ux` - UI capability banners only if already supported by M4.

  **Parallelization**: Can Parallel: PARTIAL | Wave M5 | Blocks: MVP done | Blocked By: Tasks 2-4 and Task 3 permission/context. Liveness items (`§19.8`) are implemented inside this M5 wave before Claude real-adapter verification.

  **References**:
  - OpenSpec: `tasks.md §12, §13, §19.1, §19.8-§19.10, §19.14, §20.5.4`
  - Design: D8, D19, D21, D25, D26, D27, D29
  - Specs: `adapter-framework`, `artifacts`, `permissions`, `context-ledger`, `observability`, `security`

  **Acceptance Criteria**:
  - [ ] ACP state machine, pending request table, cancel/dispose separation, line splitter, prompt serialization pass tests.
  - [ ] Claude detection/spawn/map/inject/cancel/dispose tests pass when `claude` is available; environment absence is reported as `auth_required` or `not_found`, not hidden.
  - [ ] OpenCode/Codex/LangGraph/A2A stubs are interface-only and return 501/not implemented.
  - [ ] Adapter liveness and config/capability events are durable and visible according to registry.

  **QA Scenarios**:
  ```
  Scenario: ACP cancel does not clear non-prompt pending requests
    Tool: Bash
    Steps: Run `bun test packages/adapters/acp-base/test/cancel-pending.test.ts --run`.
    Expected: `session/cancel` rejects only inflight prompt; fs/permission pending entries remain until resolved or dispose.
    Evidence: .sisyphus/evidence/agenthub-mvp/m5/acp-cancel.json

  Scenario: Claude adapter real smoke or explicit environment skip
    Tool: Bash
    Steps: Run `bun test packages/adapters/claude-code/test/real-smoke.test.ts --run`.
    Expected: If `claude` is configured, run tool/permission/diff/cancel flow passes; if absent, test exits with documented environment skip artifact and senior-agent blocker record.
    Evidence: .sisyphus/evidence/agenthub-mvp/m5/claude-real-smoke.json
  ```

  **Commit**: YES | Message: `feat(adapter): add acp base and claude code runtime` | Files: adapters, adapter framework, liveness, capability events.

- [x] 7. M6 Security, Recovery, V1 Stubs, Docs, Demo

  **What to do**: Implement `tasks.md §16`, `§17`, `§18`, `§19.7`, `§19.11`, `§19.13`, remaining `§20.5`, and all docs/demo/performance tasks. Security must include token/keychain, CSRF/Origin/Host, path canonicalization, SecretRedactor, debug/raw authorization, safe URI handling, worktree GC, and V1 placeholder enforcement.
  **Must NOT do**: Do not enable remote debug by default. Do not implement real V1 capabilities. Do not expose absolute paths in event/API payloads except authorized Run Detail admin retrieval.

  **Recommended Agent Profile**:
  - Category: `deep` for security/recovery; `writing` for docs sub-PRs.
  - Skills: []
  - Omitted: `frontend-ui-ux` except for final docs/demo screenshots if needed.

  **Parallelization**: Can Parallel: YES | Wave M6 | Blocks: Final Verification | Blocked By: Tasks 1-6.

  **References**:
  - OpenSpec: `tasks.md §16, §17, §18, §19.7, §19.11, §19.13, §20.5, §20.6`
  - Design: D16, D17, D29, D32, Risks R1-R18
  - Specs: `security`, `local-daemon`, `observability`, `v1-roadmap`, `web-ui`
  - Workflow: `docs/agenthub-agent-workflow.md §5-§13`

  **Acceptance Criteria**:
  - [ ] CSRF/Origin/Host matrix passes, including EventSource limitations.
  - [ ] SecretRedactor redacts known literal secrets and regex classes fail-closed.
  - [ ] Worktree GC never deletes outside `<userhome>/.agenthub/` and uses `git worktree remove` for worktrees.
  - [ ] V1 stubs are ≤30 LOC each where practical and throw/return 501 without real behavior.
  - [ ] README/ARCHITECTURE/SECURITY/AGENT_PROFILES/PERMISSION_PROFILES docs exist.

  **QA Scenarios**:
  ```
  Scenario: CSRF and SSE auth matrix
    Tool: Bash
    Steps: Run `bun test packages/daemon/test/security/csrf-origin-host.test.ts --run`.
    Expected: Cross-site POST rejected; same-origin POST with cookie+CSRF accepted; EventSource GET requires cookie+Origin but no custom CSRF header; Bearer does not bypass Origin.
    Evidence: .sisyphus/evidence/agenthub-mvp/m6/csrf-origin-host.json

  Scenario: Worktree GC path safety
    Tool: Bash
    Steps: Run `bun test packages/daemon/test/worktree-gc-safety.test.ts --run`.
    Expected: Symlink escape is skipped with `worktree.gc.skipped`; real workspace and `.git` internals untouched; terminal run with in-flight artifact not removed.
    Evidence: .sisyphus/evidence/agenthub-mvp/m6/worktree-gc.json
  ```

  **Commit**: YES | Message: `feat(security): harden local daemon and finalize mvp` | Files: security, daemon, local GC, v1 stubs, docs.

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [x] F1. Plan Compliance Audit — oracle
  - Verify every merged PR maps to `tasks.md` refs and workflow PR template.
  - Verify no self-merge and senior-agent approval exists.
  - Evidence: `.sisyphus/evidence/agenthub-mvp/final/plan-compliance.md`

- [x] F2. Code Quality Review — unspecified-high
  - Run `bun run lint`, `bun run typecheck`, `bun test --coverage`, `bun run check:all`.
  - Verify no banned deps and no Bun-only API leaks.
  - Evidence: `.sisyphus/evidence/agenthub-mvp/final/code-quality.log`

- [x] F3. Real Manual QA — unspecified-high (+ playwright)
  - Run `pnpm playwright test apps/web/e2e/golden-path.spec.ts --reporter=json --output=apps/web/test-results/golden-final`.
  - Verify Solo Room create → send → Mock reply → DiffCard → Apply; Assisted Observer knock flow; PendingTurn queue; Run Detail tabs.
  - Evidence: `.sisyphus/evidence/agenthub-mvp/final/playwright-golden/`

- [x] F4. Scope Fidelity Check — deep
  - Run invariant suite:
    - observe-passive: observer LLM calls = 0 for 100 messages.
    - run-level diff: four-file run creates one correct DiffArtifact.
    - raw flood: raw drops do not starve main delta.
    - claimed reclaim: kill -9 + restart recovers within 60s.
    - permission queue: same-session requests serialize.
    - waiting_permission resume emits `agent.run.resumed`.
    - preview iframe cannot access daemon API.
    - workspace/file lock cross-block passes.
    - replay from seq=1 produces byte-identical projections.
  - Evidence: `.sisyphus/evidence/agenthub-mvp/final/invariants.json`

## Commit Strategy
- Each leaf/sub-leaf task creates branch `task/<task-id>-<short-name>`.
- Commit messages follow workflow examples: `feat(bus): ...`, `test(bus): ...`, `fix(run): ...`, `docs(spec): ...`.
- Protected-contract tasks require oracle review before senior-agent merge approval.
- Do not squash across unrelated OpenSpec task refs.
- No push/merge automation unless user explicitly authorizes.

## Success Criteria
- All OpenSpec MVP tasks are complete or explicitly senior-approved as blocked by local environment.
- All tests/checks/final invariants pass with evidence.
- User/senior-agent explicitly approves final verification report.
- Plan remains aligned to `tasks.md` snapshot or is deliberately refreshed after spec changes.

# AgentHub MVP Remediation Plan

> **Status**: ACTIVE — do not declare MVP complete until all P0 and P1 tasks are done, each has an independent severe review APPROVE on record, and the Orchestrator has explicitly confirmed completion.
>
> **Strict rule**: every implementation task below runs on its own Git branch, gets its own commit(s), must pass an independent severe review, and must receive explicit Orchestrator merge approval before the branch is merged and the next task begins. No batching. No self-merge. No parallel tasks.

---

## Background

A strict post-implementation review of the reconstructed MVP branch found the following compliance gaps:

1. **PendingTurn backend incomplete** — queue/cancel/edit/consume chain not wired end-to-end.
2. **Task API / MCP minimum chain missing** — Task data model, HTTP routes (`POST /rooms/:id/tasks`, `POST /tasks/:id/complete`), and the three agent-facing MCP tools (`room.create_task`, `room.update_task`, `room.list_tasks`) are absent or stub-only; the MCP server is not injected at session start.
3. **Claude adapter not selected by daemon** — AdapterManager does not register/select the ClaudeCodeAdapter; ACP stdout events are not automatically bridged to AdapterBridge/RunLifecycle.
4. **CommandBus idempotency side effects outside idempotency transaction** — deterministic failures cache `failed` but the surrounding business transaction is not always rolled back atomically; transient failures may leave orphaned `command_records` rows.
5. **Run Detail Raw tab static** — `view=raw` SSE delivers no live events; the Raw Stream tab shows nothing.
6. **Workspace dirty / OpenSpec tasks unchecked** — git workspace has uncommitted changes; OpenSpec task checkboxes are not synchronized with evidence.

This plan addresses gaps 1-3 as P0 (blocking correctness) and gaps 4-6 as P1 (blocking completeness/quality).

---

## Reference Implementations

The following reference files must be consulted during implementation. They are read-only guides; AgentHub spec takes precedence over any pattern found in them.

| Reference | Path | Lesson |
|-----------|------|--------|
| Adapter registry/selector | `C:/project/refrence/opencode/.../control-plane/adapters/index.ts` | How to register adapters by id, select the right one at runtime, and expose a typed registry to the rest of the daemon. |
| Runtime wrapper | `C:/project/refrence/opencode/.../workspace-adapter-runtime.ts` | How to wrap a raw adapter session in a lifecycle-aware runtime object that owns the AdapterBridge boundary. |
| Backend factory | `C:/project/refrence/multica/server/pkg/agent/agent.go` | Factory pattern for constructing agent backends; how to keep construction separate from execution. |
| stdout JSON parsing / stderr tail / cancel | `C:/project/refrence/multica/server/pkg/agent/claude.go` | Line-by-line NDJSON parsing from stdout, bounded stderr tail for diagnostics, cooperative cancel via signal. |
| Process ACP / JSON-RPC lifecycle / stderr capture | `C:/project/refrence/AionUi/src/process/acp/infra/ProcessAcpClient.ts` | How to manage a child-process ACP client: spawn, NDJSON framing, pending request table, stderr capture, graceful shutdown. |

---

## Git Workflow (mandatory for every task)

Every task below follows this exact sequence. No exceptions.

### Starting a task

```powershell
# Confirm clean workspace
git status --short --branch

# Validate OpenSpec before touching code
openspec.cmd validate add-agenthub-mvp --strict

# Create task branch from current integration branch
git switch -c task/<task-id>-<short-name>
# Example: git switch -c task/r-p0-1-pending-turn-backend
```

### During development

Commit each logical unit separately. Format:

```
feat(orchestrator): wire ConsumePendingTurn command handler
test(orchestrator): cover pending turn queue/cancel/consume chain
fix(bus): roll back command_records on transient failure
```

Before every commit:

```powershell
git status --short
git diff --check
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd check:all
openspec.cmd validate add-agenthub-mvp --strict
```

### PR boundary (local, no remote required)

After completing a task, generate a diff summary and request an independent severe review of the branch. Do not proceed to the next task until the review returns APPROVE.

Use this PR description template for every task:

```markdown
## Task

- Task: `agenthub-mvp-remediation.md §<task-id>`
- Spec refs:
  - `<capability>/<Requirement name>`

## Changes

- <file or module>: <what changed and why>

## Verification

- [ ] `openspec.cmd validate add-agenthub-mvp --strict`
- [ ] `pnpm.cmd test`
- [ ] `pnpm.cmd typecheck`
- [ ] `pnpm.cmd lint`
- [ ] `pnpm.cmd check:all`
- [ ] <any task-specific integration test command>

## Reference Notes

- Looked at: `C:/project/refrence/<project>/<path>`
- Borrowed idea: <pattern name>
- Differences from AgentHub: <how AgentHub spec diverges>

## Risks / Open Questions

- <any unresolved issue or spec ambiguity>
```

### Merge rules

The implementing agent must not merge its own PR. Merge only after ALL of the following are satisfied:

- Independent severe review agent returns APPROVE with no blocking issues.
- Upper-agent / Orchestrator explicitly approves the merge in writing.
- All verification commands pass (exit code 0).
- PR description is complete.
- No undocumented spec deviations.

After merge: delete the task branch, update task status in this plan (via the Orchestrator), and proceed to the next task. Do not start the next task until the Orchestrator confirms the merge is recorded.

---

## P0 — Blocking Correctness (must complete before P1)

### P0-1: PendingTurn backend real queue/cancel/edit/consume chain

**Scope**: Implement the full server-side PendingTurn lifecycle as specified in tasks.md §19.6.6-19.6.9 and §20.1.3-20.1.5. This includes the `pending_turns` table, the HTTP endpoints, the ConsumePendingTurn command handler, and the Orchestrator terminal hook that sequences run_next_turns before PendingTurn consumption.

Does NOT include: UI changes beyond what is already in place, or any changes to the RunLifecycleService state machine beyond what is needed to wire ConsumePendingTurn.

**OpenSpec refs**:
- `messaging/用户 Turn 排队`
- `orchestrator/run_next_turns 表`
- `bus-runtime/订阅图谱（单一真相）`
- tasks.md §19.6.6, §19.6.7, §19.6.8, §19.6.9, §20.1.3, §20.1.4, §20.1.5

**Expected files**:
- `packages/db/migrations/` — verify `0009_mailbox.sql` has `run_next_turns` and `pending_turns` tables with all required columns and indexes; add a new migration if any column is missing.
- `packages/orchestrator/src/pending-turn.ts` (or equivalent) — PendingTurnService with queue/cancel/edit/consume logic.
- `packages/orchestrator/src/commands/consume-pending-turn.ts` — ConsumePendingTurn command handler.
- `packages/orchestrator/src/hooks/run-terminal.ts` (or equivalent) — Orchestrator terminal hook implementing the three-step sequence: presence update, run_next_turns carry check, PendingTurn consume.
- `packages/daemon/src/routes/pending-turns.ts` — DELETE `/pending-turns/:id` and PATCH `/messages/:id` (edit = cancel + new POST).
- `packages/daemon/src/routes/rooms.ts` — POST `/rooms/:id/messages` must create PendingTurn when primary is busy, return 201, emit `pending_turn.created`.

**Tests**:
- Unit: ConsumePendingTurn handler transitions `queued → scheduled → consumed` atomically.
- Unit: DELETE `/pending-turns/:id` cancels a queued turn; returns 409 if already consumed.
- Unit: PATCH `/messages/:id` is equivalent to cancel + new POST.
- Unit: queued count per room capped at 20; 21st returns 429.
- Integration: busy primary receives 5 user messages; all 5 become PendingTurns with status `queued`; after run_1 completes, turns are consumed in order; LLM is called exactly 5 times, all via WakeAgent.
- Integration: run_next_turns carry takes priority over PendingTurn consumption when both are present after a run completes.

**Verification commands**:
```powershell
pnpm.cmd --filter @agenthub/orchestrator test
pnpm.cmd --filter @agenthub/daemon test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd check:all
openspec.cmd validate add-agenthub-mvp --strict
```

**PR boundary**: one PR covering the full PendingTurn chain (DB, service, command handler, Orchestrator hook, HTTP routes).

**Independent review gate**: severe review must verify the three-step terminal hook ordering, the 20-turn cap, the atomic status transitions, and that ConsumePendingTurn is internal-only (not dispatchable via `origin='http'`).

**Done criteria**:
- All tests pass.
- `openspec.cmd validate add-agenthub-mvp --strict` passes.
- `pnpm.cmd check:all` passes.
- PR description complete with spec refs and verification evidence.
- Independent severe review returns APPROVE.

---

### P0-2: Task API / MCP minimum chain

**Scope**: Implement the Task data model, HTTP CRUD routes, and the three MCP tools that agents need to create and track tasks during a run: `room.create_task`, `room.update_task`, and `room.list_tasks`. Wire the MCP server skeleton into `createSession` so adapters receive it at session start. This is the minimum chain the strict review found missing; the remaining 12 Room MCP tools are follow-up work outside this remediation scope.

Does NOT include: `room.read_mailbox` (that is part of the Mailbox/run_next_turns chain already covered by P0-1 and the broader §19.12 work), any of the other 12 Room MCP tools, or any UI changes.

**OpenSpec refs**:
- `orchestrator/Room MCP Tools` (task-related subset)
- tasks.md §9.9 (MCP server skeleton + task tools), §9.10 (createSession injection)

**Expected files**:
- `packages/db/migrations/` — verify a `tasks` table exists with at minimum: `id`, `room_id`, `run_id`, `title`, `status` (`open`/`in_progress`/`done`/`cancelled`), `created_at`, `updated_at`; add a migration if missing.
- `packages/orchestrator/src/task-service.ts` (or equivalent) — TaskService: create, update status, list by room/run; all mutations dispatch through CommandBus, no direct domain writes from HTTP handlers.
- `packages/orchestrator/src/commands/create-task.ts` — CreateTask command handler.
- `packages/orchestrator/src/commands/complete-task.ts` — CompleteTask command handler (transitions `in_progress → done`).
- `packages/daemon/src/routes/tasks.ts` — `POST /rooms/:id/tasks` (create) and `POST /tasks/:id/complete` (complete); both dispatch CommandBus; return 201/200 with task payload.
- `packages/orchestrator/src/mcp/room-mcp-server.ts` — MCP server skeleton with `room.create_task`, `room.update_task`, `room.list_tasks` tools; remaining tools return `tool_not_found` stubs.
- `packages/adapters/acp-base/src/index.ts` or equivalent — `createSession` injects the MCP server instance so adapters can call task tools during a run.

**Tests**:
- Unit: `POST /rooms/:id/tasks` dispatches CreateTask via CommandBus; does not write the `tasks` table directly from the route handler.
- Unit: `POST /tasks/:id/complete` dispatches CompleteTask; returns 409 if task is already `done` or `cancelled`.
- Unit: `room.create_task` MCP tool creates a task and returns the task id.
- Unit: `room.update_task` MCP tool updates task status; rejects invalid transitions.
- Unit: `room.list_tasks` MCP tool returns tasks scoped to the current run's room.
- Unit: adapter session receives the MCP server at `createSession`; a tool call to `room.create_task` reaches the Room MCP Server.
- Integration: agent run calls `room.create_task` via MCP, then `room.update_task` to mark it done; `GET /rooms/:id/tasks` returns the task with status `done`.

**Verification commands**:
```powershell
pnpm.cmd --filter @agenthub/orchestrator test
pnpm.cmd --filter @agenthub/daemon test
pnpm.cmd --filter @agenthub/adapters-acp-base test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd check:all
openspec.cmd validate add-agenthub-mvp --strict
```

**PR boundary**: one PR covering the Task DB migration, TaskService, CreateTask/CompleteTask command handlers, HTTP routes, the three MCP task tools, and the createSession injection.

**Independent review gate**: severe review must verify that HTTP routes dispatch CommandBus and do not write domain state directly, that task status transitions are enforced, that the MCP server is correctly injected at session start, and that `room.read_mailbox` and the remaining 12 tools are explicitly out of scope (stubbed as `tool_not_found`).

**Done criteria**: same as P0-1.

---

### P0-3: Claude adapter registry/selector + ACP process supervisor + automatic stdout/provider-event bridge to AdapterBridge/RunLifecycle

**Scope**: Wire the ClaudeCodeAdapter into AdapterManager so the daemon selects it at runtime. Implement the ACP process supervisor (spawn, NDJSON line-splitter, JSON-RPC pending table, stderr tail, liveness ping). Implement the automatic bridge from ACP stdout provider events to AdapterBridge, which in turn calls RunLifecycleService.

This task covers tasks.md §12.1-12.10, §19.1.1-19.1.5, §19.10.1-19.10.5, and the AdapterManager registration gap.

Does NOT include: OpenCodeAdapter, CodexAdapter, or any other post-MVP adapter beyond the stubs already in place.

**OpenSpec refs**:
- `adapter-framework/AgentRuntimeAdapter 接口`
- `adapter-framework/AgentAdapterManifest（能力声明）`
- `adapter-framework/Adapter 注册到 Manager`
- `adapter-framework/ACPAdapter 会话状态机与 JSON-RPC pending 表`
- `adapter-framework/ClaudeCodeAdapter 事件映射`
- `adapter-framework/跨平台 CLI 探测与 Provider-specific Spawn`
- `adapter-framework/Adapter Liveness 状态与心跳分离`
- tasks.md §12.1-12.10, §19.1.1-19.1.5, §19.8.1-19.8.3, §19.10.1-19.10.5

**Reference implementation lessons**:
- `C:/project/refrence/opencode/.../control-plane/adapters/index.ts`: registry pattern — how adapters are keyed by id and selected by the daemon.
- `C:/project/refrence/opencode/.../workspace-adapter-runtime.ts`: runtime wrapper — how a session is wrapped in a lifecycle object that owns the AdapterBridge boundary.
- `C:/project/refrence/multica/server/pkg/agent/claude.go`: stdout NDJSON parsing line-by-line, bounded stderr tail (last N lines for diagnostics), cooperative cancel via signal.
- `C:/project/refrence/AionUi/src/process/acp/infra/ProcessAcpClient.ts`: process ACP client — spawn, NDJSON framing, pending request table keyed by requestId, stderr capture, graceful shutdown sequence (session/end → 5s → SIGTERM → SIGKILL).

**Expected files**:
- `packages/adapters/acp-base/src/index.ts` — ACPAdapter base class: state machine (disconnected/connecting/initializing/ready/prompting/cancelling/failed/disposed), NDJSON line-splitter buffer, `pendingRequests: Map<requestId, AcpPendingRequest>`, `inflightPromptRequestId`, clientCapabilities declaration, `session/cancel` cooperative cancel, `dispose` graceful shutdown, prompt serialization guard.
- `packages/adapters/claude-code/src/index.ts` — ClaudeCodeACPAdapter extending ACPAdapter: `spawnArgs()`, `detect()` (Windows: `where claude`; Unix: `bash -lc 'command -v claude'`), `mapProviderEvent()`, `mapProviderError()`.
- `packages/adapters/acp-base/src/bridge.ts` (or equivalent) — automatic bridge from ACP stdout provider events to AdapterBridge: non-run-state events published directly; terminal events routed through RunLifecycleService.
- `packages/daemon/src/adapters/registry.ts` (or equivalent) — adapter registry that registers ClaudeCodeACPAdapter and MockAdapter; AdapterManager selects by adapter id from AgentProfile.
- `packages/adapters/acp-base/src/liveness.ts` (or equivalent) — 3s ping loop, 5 consecutive miss → crashed, emit `adapter.liveness.changed`.

**Tests**:
- Unit: ACPAdapter state machine transitions (disconnected → connecting → ready → prompting → cancelling → disposed).
- Unit: NDJSON line-splitter correctly buffers partial lines and emits complete JSON objects.
- Unit: `session/cancel` rejects only the inflight prompt pending entry; fs.* and permission pending entries survive.
- Unit: `dispose` sends `session/end`, waits 5s, sends SIGTERM, then SIGKILL; all pending entries are rejected with `session_disposed`.
- Unit: prompt-in-flight guard returns `AdapterError(code="prompt_in_flight")` on second concurrent prompt.
- Unit: `detect()` on Windows uses `where claude`; falls back to `Get-Command`; returns `AdapterDiscoveryErrorCode.not_found` when absent.
- Unit: AdapterManager selects ClaudeCodeACPAdapter when AgentProfile specifies `adapter: 'claude-code'`.
- Integration: MockAdapter golden path still passes after registry refactor.
- Integration: ClaudeCodeACPAdapter spawns process, receives NDJSON events, bridges them to AdapterBridge, which calls RunLifecycleService.markRunning and RunLifecycleService.complete.

**Verification commands**:
```powershell
pnpm.cmd --filter @agenthub/adapters-acp-base test
pnpm.cmd --filter @agenthub/adapters-claude-code test
pnpm.cmd --filter @agenthub/daemon test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd check:all
openspec.cmd validate add-agenthub-mvp --strict
```

**PR boundary**: one PR covering ACPAdapter base, ClaudeCodeACPAdapter, the automatic bridge, and the daemon adapter registry.

**Independent review gate**: severe review must verify the AdapterBridge single-boundary rule (adapters do not publish durable events directly), the canonical two-step session.opened sequence (updateSessionState tx1, markRunning tx2), the terminal event routing through RunLifecycleService, and the Windows/Unix detect paths.

**Done criteria**: same as P0-1.

---

## P1 — Blocking Completeness (begin only after all P0 tasks are merged and reviewed)

### P1-1: CommandBus idempotency transaction-boundary remediation or explicit spec reconciliation decision

**Scope**: Audit the current CommandBus.dispatch() implementation against tasks.md §3.9. Specifically verify:

1. Deterministic failures (validation_failed / not_found / conflict / permission_denied / duplicate / not_implemented) write `status='failed'` to `command_records` and roll back the business transaction in the same atomic operation.
2. Transient failures (internal_error / transaction_rollback / crash / rate_limited / lock_timeout) roll back the entire transaction including the `command_records` row, so the same idempotency key can retry.
3. The reaper marks `in_flight → expired` after 60s.

If the current implementation already satisfies all three points, produce a short evidence document and close this task. If it does not, implement the fix.

Does NOT include: changes to CommandBus public interface, changes to any command handler, or changes to the HTTP layer.

**OpenSpec refs**:
- `bus-runtime/Command 幂等表（command_records）`
- `bus-runtime/Command 与 Event 显式区分`
- tasks.md §3.9, §20.1.1

**Expected files** (if fix is needed):
- `packages/bus/src/command-bus.ts` — corrected transaction boundary logic.
- `packages/bus/src/command-bus.test.ts` — tests covering all three failure classification paths.

**Tests**:
- Unit: deterministic failure caches `status='failed'`; same key returns cached result without re-executing handler.
- Unit: transient failure deletes `command_records` row; same key retries successfully on next call.
- Unit: in-flight record older than 60s is marked `expired` by reaper; subsequent dispatch re-executes.
- Unit: same key + different body is rejected with `duplicate` regardless of prior status.

**Verification commands**:
```powershell
pnpm.cmd --filter @agenthub/bus test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd check:all
openspec.cmd validate add-agenthub-mvp --strict
```

**PR boundary**: one PR covering only the CommandBus transaction boundary fix (or the evidence document if no fix is needed).

**Independent review gate**: severe review must verify the three failure classification paths with test evidence, and confirm no command handler behavior changed.

**Done criteria**: same as P0-1.

---

### P1-2: Run Detail Raw Stream live UI via `view=raw`

**Scope**: Implement live SSE delivery for `view=raw` in the daemon SSE handler, and wire the Run Detail Raw Stream tab to consume it. The raw view carries `adapter.raw.stdout` and `adapter.raw.stderr` ephemeral events, admin-gated, with redaction and 64 KB truncation already in place from M6.

This task covers tasks.md §19.6.11 (Raw Stream tab), §19.13.5-19.13.6 (admin scope gating), and the F4 raw-view blocker fix that was partially addressed but not fully verified end-to-end in the UI.

Does NOT include: persisting raw events as durable events, changing the `replayDurableSinceSeq` behavior for `view=raw` (intentionally empty), or any new security scope beyond `admin`.

**OpenSpec refs**:
- `messaging/主流摘要 / Agent Run Detail 双投影`
- `observability/Adapter raw stream 持久化`
- `security/Debug / Raw Log 授权边界`
- tasks.md §19.6.11, §19.13.5, §19.13.6, §20.3.4

**Expected files**:
- `packages/daemon/src/index.ts` — `visible(..., view='raw')` returns true for `adapter.raw.stdout` and `adapter.raw.stderr` after admin scope check; live SSE frame delivery confirmed.
- `apps/web/src/components/RunDetail/RawStreamTab.tsx` (or equivalent) — subscribes to `view=raw` SSE for the current run; renders live stdout/stderr lines; shows "no output" placeholder when stream is empty.
- `apps/web/src/hooks/useRawStream.ts` (or equivalent) — SSE hook for `view=raw` with run filter.

**Tests**:
- Unit (daemon): `visible('adapter.raw.stdout', { view: 'raw', runId: 'x' })` returns true for admin-scoped session; returns false for non-admin.
- Unit (daemon): `visible('message.created', { view: 'raw' })` returns false (raw view only carries adapter.raw.* events).
- E2E (Playwright): open Run Detail for a running MockAdapter run; switch to Raw Stream tab; verify at least one raw line appears within 3s.

**Verification commands**:
```powershell
pnpm.cmd --filter @agenthub/daemon test
pnpm.cmd --filter @agenthub/web build
pnpm.cmd exec playwright test apps/web/e2e/main-detail-projection.spec.ts
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd check:all
openspec.cmd validate add-agenthub-mvp --strict
```

**PR boundary**: one PR covering the daemon SSE raw-view fix and the Raw Stream tab UI.

**Independent review gate**: severe review must verify admin gating, that `replayDurableSinceSeq` for `view=raw` remains empty (ephemeral only), and that the UI does not expose raw output to non-admin users.

**Done criteria**: same as P0-1.

---

### P1-3: Git workspace audit and OpenSpec evidence synchronization

**Scope**: Audit the git workspace and OpenSpec evidence state; produce a written report for the Orchestrator. This task makes NO commits, NO stashes, and NO discards of dirty files. Any concrete cleanup of dirty files requires a separate Orchestrator-approved PR boundary that is outside this task.

Does NOT include: any product code changes, any spec changes, any changes to the plan file, or any git mutations (no commit, no stash, no discard, no branch creation).

**Steps**:

1. Run `git status --short` and record every uncommitted file path and its status (modified / untracked / deleted).
2. For each dirty file, classify it: belongs to a completed task, belongs to an in-progress task, or origin unknown. Do not touch the file.
3. Run `openspec.cmd validate add-agenthub-mvp --strict` and record the result (pass / fail + error output).
4. For each task in tasks.md §0-§20 that has been implemented, check whether a corresponding evidence file exists under `.sisyphus/evidence/agenthub-mvp/`. Record which tasks are missing evidence.
5. Write the full audit report to `.sisyphus/notepads/agenthub-mvp/issues.md` (append only) under a dated heading. The report must list: dirty files with classification, OpenSpec validation result, and missing evidence entries.
6. Do not mark any task checkbox in tasks.md — that is the Orchestrator's responsibility.
7. Present the report to the Orchestrator and wait for explicit direction before any file is committed, stashed, or discarded.

**Verification commands** (read-only, no mutations):
```powershell
git status --short
openspec.cmd validate add-agenthub-mvp --strict
```

**PR boundary**: this task produces only an appended audit report in `.sisyphus/notepads/agenthub-mvp/issues.md`. Each dirty-file cleanup, if the Orchestrator approves one, becomes its own separate PR with its own branch, independent severe review, and Orchestrator merge approval.

**Independent review gate**: severe review must confirm the audit report is complete and accurate, that no git mutations were made, and that no dirty files were committed or discarded without Orchestrator direction.

**Done criteria**:
- Audit report appended to issues.md.
- `openspec.cmd validate add-agenthub-mvp --strict` result recorded.
- Missing evidence entries listed.
- No git mutations performed.
- Independent severe review returns APPROVE.
- Orchestrator explicitly approves and records the task as complete.

---

## Completion Gate

> **WARNING**: Do not declare the AgentHub MVP complete until ALL of the following are true:
>
> 1. All P0 tasks (P0-1, P0-2, P0-3) are merged and each has an independent severe review APPROVE **and** Orchestrator merge approval on record.
> 2. All P1 tasks (P1-1, P1-2, P1-3) are merged/recorded and each has an independent severe review APPROVE **and** Orchestrator approval on record.
> 3. `openspec.cmd validate add-agenthub-mvp --strict` passes on the integration branch after all merges.
> 4. `pnpm.cmd test`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, and `pnpm.cmd check:all` all pass on the integration branch.
> 5. The Playwright E2E suite passes (at minimum `main-detail-projection.spec.ts` and `pending-turn.spec.ts`).
> 6. The git workspace is clean (no uncommitted changes).
> 7. The Orchestrator has explicitly confirmed MVP completion.
>
> Partial completion of this list is not MVP completion. A single failing review gate or missing Orchestrator approval restarts the affected task.

---

## Task Execution Order

Every task is strictly sequential. Complete one task, get independent severe review APPROVE, get Orchestrator merge approval, merge, then start the next. No task may begin until the previous task's branch is merged and the Orchestrator has confirmed.

```
P0-1 (PendingTurn backend)
  → [independent severe review → Orchestrator approval → merge]
P0-2 (Task API / MCP minimum chain)
  → [independent severe review → Orchestrator approval → merge]
P0-3 (Claude adapter + ACP supervisor + bridge)
  → [independent severe review → Orchestrator approval → merge]
P1-1 (CommandBus idempotency)
  → [independent severe review → Orchestrator approval → merge]
P1-2 (Raw Stream live UI)
  → [independent severe review → Orchestrator approval → merge]
P1-3 (Workspace audit and evidence report)
  → [independent severe review → Orchestrator approval → record]
Completion Gate
```

No parallel execution. No skipping review gates. No self-merge.

---

## Escalation Rules

Stop and escalate to the Orchestrator if any of the following occur:

- A spec requirement is ambiguous or contradicts the reference implementation.
- A required DB migration conflicts with an existing migration.
- A test fails for more than 30 minutes without a clear root cause.
- A review agent returns REJECT with a blocking issue that requires a spec change.
- Any change to `RunLifecycleService`, `EventBus`, `CommandBus`, `AdapterBridge`, or `PermissionEngine` interfaces is needed beyond what is explicitly described in this plan.
- A new dependency must be introduced.

Do not use temporary hacks to unblock escalation points. Record the issue in `.sisyphus/notepads/agenthub-mvp/issues.md` and wait for Orchestrator direction.

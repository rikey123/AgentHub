## Context

V1.0 shipped Squad/Team orchestration with a mailbox, task delegation, team-dispatch, and a watchdog. A systematic code-level comparison against Multica, AionUi, WenzAgent, Symphony, Hermes-Kanban, and Golutra identified 16 multi-agent gaps (3 P0, 5 P1, 5 P2, 3 P3) plus three missing product capabilities (Kanban, team expansion, skill system). Three developers will work in parallel: Dev A owns reliability/infrastructure, Dev B owns intelligence/skills, Dev C owns frontend/Kanban. The monorepo's layered architecture (protocol → db → bus → orchestrator → daemon / web) has no circular dependencies and supports this split cleanly.

## Goals / Non-Goals

**Goals:**
- Address selected P0–P3 multi-agent gaps needed to make V1.0 squad/team collaboration dependable: worktree isolation, timeout escalation, sub-agent safety, completion protocol, context injection, turn limits, blocked reasons, mid-flight handoff, permission ref-counting, capability declaration, dependency visualization.
- Ship Kanban task board, user-initiated team expansion, and skill system.
- Maintain the Event Bus contract (all mutations publish durable events in the same SQLite transaction).
- Keep the change non-breaking: no changes to SSE envelope schema, `AgentRuntimeAdapter` interface, or existing event types.
- Enable parallel development via a single contract-week schema + event-type commit before feature branches diverge.

**Non-Goals:**
- Cloud sync, multi-user auth, SaaS (D32 red line).
- Autonomous dynamic team expansion (leader spawning agents without user approval).
- Cron scheduling, recurring tasks (V1.2).
- Dependency auto-dispatch / DAG execution (V1.2 — V1.1 only visualizes dependencies).
- WakeAgent outbox / crash-safe dispatch (V1.2).
- Daemon restart session recovery (V1.2).
- Message revocation (V1.2).
- Plugin system with code execution (V1.3).
- LAN/remote agent discovery (V1.3+).
- War Room mode (V1.5).

## Decisions

### D1 — Single migration file `0015_v11.sql`

All new tables and columns land in one migration authored during the contract week. This prevents migration-number collisions across three parallel branches. If a branch needs a schema fix mid-sprint, it appends to a `0015_v11_patch.sql` file that the branch owner coordinates with the migration owner (Dev A).

**Alternatives considered:** Per-feature migrations (0015, 0016, 0017…) — rejected because three branches would collide on the same sequence numbers and require rebase-time renumbering.

### D2 — WakeAgent outbox (deferred to V1.2)

Crash-safe WakeAgent dispatch via a persistent outbox table is deferred to V1.2. V1.1 uses the existing in-memory CommandBus dispatch path. If the daemon crashes between a task write and a WakeAgent dispatch, the task will be in `pending` state with no active run — the leader or user can manually re-trigger. This is an acceptable trade-off for V1.1 scope.

### D3 — Worktree-per-run: lifecycle + diff/artifact, no automatic merge

When `room.mode IN ('squad', 'team')`, `ArtifactFS` defaults to `isolated_worktree` mode. Each run gets a worktree at `{workspace.root_path}/.agenthub/worktrees/{runId}`. The worktree lifecycle is:

```
created (on run start)
  → active (agent writes files)
  → ready_for_review (on session.ended — diff artifact published)
  → applied | discarded (explicit user or leader action)
```

On `session.ended`, the system computes a diff between the worktree and the primary workspace HEAD and stores it as an `artifact` of type `worktree_diff`. The stored patch is the source of truth for apply; the worktree directory is retained only for inspection/debugging. The Kanban card and task detail drawer surface this diff. The user (or leader via `room.apply_worktree`) explicitly applies the changes; for V1.1 the system applies with `git apply` against the current workspace HEAD. `git merge --no-ff` is explicitly out of V1.1 default behavior and may be revisited in V1.2. If the apply fails (conflict), the artifact is marked `conflict` and the user is shown the conflict diff. Worktree cleanup policy (expiry, patch-after-expiry semantics) is deferred to V1.2.

**Why no automatic merge on run completion?** Neither OpenCode nor AionUi auto-merges. OpenCode's model is: create worktree → agent works → system shows diff/patch → user or upstream flow explicitly applies. AionUi uses `WorkspaceSnapshotService` (snapshot/compare/stage/unstage/discard) on a shared workspace. Automatic merge on completion lacks the necessary product semantics: who approves? what if there are conflicts? what if the user wants to discard? These questions require explicit user intent.

**Non-squad rooms** keep the existing `shared` mode (no change).

### D4 — Timeout escalation: two-level with `room.stalled` event

Level 1 (existing watchdog, unchanged): 90 seconds of silence on a running agent → notify leader via mailbox + `WakeAgent(reason: "agent_stalled")`.

Level 2 (new): if, within 5 minutes of a Level-1 notification, no leader run reaches `running` state OR the leader run transitions to a terminal failure state, `team-dispatch.ts` publishes `room.stalled { roomId, stalledTaskIds, reason: "leader_unavailable" | "leader_failed" }` (durable, visibility: `main`) and sets `rooms.stalled_at`. The projector surfaces a dismissible banner. User can manually cancel tasks or restart the leader. Dismissing calls `POST /rooms/:id/unstall` → clears `stalled_at` → publishes `room.unstalled`.

**Why 5 minutes?** Long enough for a slow model response, short enough to not leave users waiting silently.

### D5 — Sub-agent tool whitelist enforced at MCP dispatch

`room-mcp-server.ts` maintains `LEADER_ONLY_TOOLS = new Set(['room.delegate', 'room.spawn_agent', 'room.add_participant'])`. On every tool call, the server checks `session.isLeader`; non-leader sessions that call a leader-only tool receive `{ error: "tool_not_permitted", tool }` without executing. Sub-agents spawned via `room.spawn_agent` are always non-leader.

**Recursive spawn prevention:** `room.spawn_agent` checks `session.spawnDepth`; depth ≥ 1 returns `{ error: "recursive_spawn_not_permitted" }`.

### D6 — Structured completion report: `room.complete_task` tool call is the authoritative path

The authoritative path for task completion is a tool call, not a parsed message. Teammates MUST call `room.complete_task({ taskId, status: "completed"|"blocked"|"review", summary, blockerReason?, artifactIds?, filesChanged? })` before ending their turn. `task-service.ts` processes this call inside a transaction: resolves the effective target status (respecting `expects_review` gate for team mode), updates `tasks.status`, sets `tasks.blocker_reason` if provided, publishes `task.status.changed` and `task.delegation.completed`.

If a run reaches `session.ended` without a `room.complete_task` call having been recorded for the task, the task transitions to `review` with `blocker_reason = "missing_completion_report"` and the leader is woken with `reason: "task_review"`. The leader prompt explicitly instructs it to check for tasks in `review` state with this reason.

A fenced `task-completion` JSON block in the assistant message is retained as a **visible transcript aid** (helps the user read what happened) but is NOT parsed by the system for state transitions.

**Why tool call over fenced JSON?** Fenced JSON depends on prompt compliance — different runtimes, models, and truncation scenarios all produce failures. Tool calls are already the reliable protocol for state mutations in this codebase (see the V1.0 `room.update_task` pattern). Keeping task state transitions on the tool-call path is consistent with the existing design.

### D7 — Teammate MissionBrief: assembled from live room state, injected at wake time

Every teammate wake prepends a `<mission-brief>` XML block before the role system prompt. The brief is assembled at wake time by querying live room state — it is NOT stored in `WakeAgent` input (too large, stale by the time the run starts). The run executor calls `assembleMissionBrief(roomId, agentId, taskId?)` synchronously before constructing the prompt.

**MissionBrief structure:**

```typescript
type MissionBrief = {
  goal: string                  // see derivation below
  roomMode: RoomMode
  leaderName: string
  myTaskId?: string
  myTaskTitle?: string
  siblingTasks: Array<{
    taskId: string
    title: string
    assigneeName: string
    status: TaskStatus
    blockerReason?: string      // surfaces tasks.blocker_reason (D6)
  }>
  roomMemory: RoomMemoryEntry[] // confirmed room-scoped ContextItems
  activePlan?: string           // first 300 chars of current PlanDocument (D8)
}

type RoomMemoryEntry = {
  type: "fact" | "decision" | "constraint" | "issue"
  content: string
}
```

**Goal derivation (in priority order):**
1. A pinned workspace-scoped ContextItem whose `content` starts with `"Goal:"` — set by the user or leader.
2. The first user message in the room, truncated to 200 chars.
3. Fallback: `"No explicit goal set for this room."`.

**Room Memory** is the set of confirmed ContextItems with `scope='conversation'` and `room_id = current_room` and `status = 'confirmed'` and `type IN ('fact', 'decision', 'constraint', 'issue')`. This is the existing `context-ledger` infrastructure — no new tables. The `scope='conversation'` value already maps to room-level shared knowledge in the context-ledger spec.

Agents accumulate room memory by calling the existing `room.propose_context { scope: "conversation", type: "fact"|"decision"|"constraint", content: "..." }` MCP tool. User confirmation (or a trusted system tool write) promotes the item to `status='confirmed'`, and it appears in all future MissionBriefs for that room. This gives the room a persistent, human-curated knowledge base that survives across multiple agent wakes and daemon restarts.

**Examples of room memory entries:**
- `{ type: "decision", content: "We are using TypeScript strict mode for this project" }`
- `{ type: "constraint", content: "Do not modify auth.ts without security review" }`
- `{ type: "fact", content: "The API base path is /api/v2" }`

**Token budget:** MissionBrief is capped at 800 tokens (fixed allocation, separate from the regular context assembly budget). If `roomMemory` exceeds budget, items are truncated by `updated_at DESC` (most recently confirmed first). `siblingTasks` is capped at 10 entries (most recently updated). The MissionBrief allocation does NOT count against the run's regular context assembly budget — it is prepended before the budget window.

**Why separate from context assembly?** Context assembly (context-ledger spec, `assembleContext()`) is per-run and includes messages, artifacts, pinned items, and recent context. MissionBrief is specifically the coordination layer: "what is this room trying to accomplish, what do we collectively know, and what are my teammates doing?" Keeping them separate avoids double-counting room memory items and makes the coordination signal explicit and inspectable.

**Why XML block?** Clearly delimited, easy to strip in tests, consistent with existing `<context-items>` injection pattern in the codebase.

### D8 — Pre-execution planning phase: visible-only, not a blocking approval gate

When a squad/team room receives its first user message, the leader's first wake uses `reason: "plan"`. The leader prompt for `reason=plan` instructs the leader to produce ONLY a `PlanDocument` JSON block (no tool calls, no delegation). The daemon stores it in `task_plans` and publishes `task.plan.created` (durable, visibility: `main`). The projector surfaces it in the side panel as a collapsible "Execution Plan" card. The leader's second wake is triggered immediately after plan storage with `reason: "execute"`.

**Visible-only, not blocking:** the plan is informational. Execution begins immediately. The user can read the plan in the side panel while the leader is already delegating. If the user wants to abort, they cancel the active runs manually (existing cancel flow).

**Planning phase failure path:** if the leader's plan turn ends without a parseable `PlanDocument` JSON block (e.g., the leader produced free-form text instead), the daemon SHALL NOT block execution. It SHALL write `task.activity.added { kind: "plan_parse_failed" }` to the room's activity log, skip `task.plan.created`, and immediately trigger the second wake with `reason: "execute"`. The side panel will not show an "Execution Plan" card for this room. This is a graceful degradation — the leader proceeds to delegate without a visible plan.

**Why not a blocking approval gate?** A blocking gate requires a new `pending_user_approval` state, a UI approval button, and a timeout policy (what if the user never approves?). This is a meaningful product decision that deserves its own design. V1.1 ships the visible-only variant; a strict approval mode can be added in V1.2 as a room-level setting.

### D9 — Skill system: standard SKILL.md packages, runtime-native delivery first

A skill is a standard Agent Skill package — a `SKILL.md` file with YAML frontmatter (`name`, `description`) plus optional supporting files (`scripts/`, `examples/`, `references/`, assets). This is the same format used by Claude Code (`.claude/skills/`), Codex (`.codex/skills/`), OpenCode (`.opencode/skills/`), AionUi, and Multica. AgentHub V1.1 adopts this standard rather than inventing a proprietary format.

**Skill is NOT MCP.** MCP remains a separate tool/server integration. A skill may contain instructions that reference tools, but the skill system does not model MCP servers as a skill type.

**Skill origins:**
```
builtin   — shipped with AgentHub (e.g., task-planner, skill-creator)
workspace — created by the user in this workspace
imported  — imported from a GitHub URL, local directory, or pasted SKILL.md
```

**Data model:**
```sql
skills (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  content      TEXT NOT NULL,   -- SKILL.md body (frontmatter + instructions)
  origin       TEXT NOT NULL,   -- builtin | workspace | imported
  source_url   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE(workspace_id, name)
)

skill_files (
  id        TEXT PRIMARY KEY,
  skill_id  TEXT NOT NULL,
  path      TEXT NOT NULL,      -- relative path within skill package
  content   TEXT NOT NULL,
  UNIQUE(skill_id, path)
)

room_skills (
  room_id   TEXT NOT NULL,
  skill_id  TEXT NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(room_id, skill_id)
)

agent_skills (
  room_participant_id TEXT NOT NULL,
  skill_id            TEXT NOT NULL,
  mode                TEXT NOT NULL,  -- add | restrict
  PRIMARY KEY(room_participant_id, skill_id)
)
```

**Runtime delivery (materialization):**

Before a run starts, `SkillRegistry` resolves the active skill set for the agent (room pool + agent overrides) and materializes selected skills into the runtime's expected skill directory:

| Runtime | Directory |
|---------|-----------|
| Claude Code | `.claude/skills/<skillName>/` |
| Codex | `.codex/skills/<skillName>/` |
| OpenCode | `.opencode/skills/<skillName>/` |
| Qwen | `.qwen/skills/<skillName>/` |
| Cursor | `.cursor/skills/<skillName>/` |
| Native (AgentHub) | `.agenthub/skills/<skillName>/` |

Each materialized skill directory contains `SKILL.md` plus any `skill_files` rows for that skill. The runtime discovers and loads them natively — AgentHub does not need to teach the runtime how to use skills.

**Fallback for runtimes without native skill discovery:** inject a skill index (name + description list) into the first-message system prompt, followed by full `SKILL.md` content for each selected skill. This matches AionUi's fallback model.

**Builtin skills** are standard SKILL.md packages shipped with AgentHub (`origin = "builtin"`). They are NOT platform tool groups. Platform tools (file access, terminal, `room.delegate`, etc.) remain controlled by `roles.capabilities` and leader-only rules — those are not skills.

**`SkillRegistry` responsibilities:**
- Parse and validate SKILL.md frontmatter
- Store skill + skill_files in SQLite
- Resolve active skill set for a (room, agent) pair
- Materialize skill packages into the runtime workspace before run start
- Clean up materialized files after run ends
- Emit `skill.activated` / `skill.deactivated` / `skill.materialization_failed` durable events

**Materialization scope (critical invariant):** `SkillRegistry` MUST resolve and materialize skills per-run, scoped to that run's workspace. It MUST NOT write unselected skills into any directory visible to the run. For isolated-worktree runs, skills are materialized into the worktree's runtime skill directory (e.g., `{worktree}/.claude/skills/<skillName>/`). For shared-mode runs, skills are materialized into a run-scoped temp overlay and cleaned up in the run terminal hook. This prevents cross-room skill leakage when multiple rooms share the same workspace root but have different skill sets enabled.

**Skill event visibility:**

| Event | Durability | Visibility | Rationale |
|-------|-----------|-----------|-----------|
| `skill.activated` | durable | `detail` | Settings-level state; chat view does not need it |
| `skill.deactivated` | durable | `detail` | Same as above |
| `skill.materialization_failed` | durable | `main` | Blocks run start; user must see it in chat view |

**MCP connection pool is NOT part of the skill system.** If MCP server management is needed in a future version, it belongs in a separate `mcp-registry` capability.

### D10 — Add participant: `agentBindingId` is the only public authority

```typescript
POST /rooms/:id/participants {
  agentBindingId: string   // resolves role + runtime + model_config
  displayNameOverride?: string
}
```

`agentBindingId` references `agent_bindings` (V1.0 table), which encodes `role_id + runtime_id + model_config_id`. This is the only public identity for "an agent with a specific role, runtime, and model." The daemon inserts a `room_participants` row keyed by `agentBindingId`. If runtime internals require an `agent_profiles`-compatible row (e.g., for adapter session tracking), it is treated as a derived runtime session record — never as the public identity or API authority. The `agent_profiles` table MUST NOT be used as the input or source of truth for this command.

The leader is notified via mailbox. `room.add_participant` MCP tool wraps the same command (leader-only, enforced by D5).

**Why `agentBindingId` not `agentId`?** V1.0 decoupled Role/Runtime/ModelConfig/AgentBinding. Using `agentId` directly would bypass this decoupling and re-anchor the system to the old `agent_profiles`-as-authority model. Keeping `agentBindingId` as the input preserves the V1.0 investment.

### D11 — Kanban: tasks table as source of truth, `board_column` as override

`tasks.board_column TEXT` stores user-overridden column placement. Default mapping (when `board_column IS NULL`): `pending→Backlog`, `in_progress→In Progress`, `blocked→Waiting`, `review→Review`, `completed→Done`. Drag-to-move writes `board_column` and publishes `task.column.moved` (durable, visibility: `both`). The projector maintains a `boardColumns: Map<taskId, string>` projection. File-change badge reads from `run_file_changes` count aggregated by `task_id`.

### D12 — File change tracking: per-run, aggregated to task

`adapter-bridge.ts` already tracks `fs.writeTextFile` / `fs.deleteFile` events. On `session.ended`, the bridge writes a `run_file_changes` row with `{ runId, taskId, filesChanged: [{path, change, linesAdded, linesRemoved}] }`. Multiple runs on the same task accumulate rows. The Kanban card shows the aggregate count; the task detail drawer shows the per-run diff list via the existing artifact viewer.

### D13 — Permission ref-counting: `waitingPermissionCount: number` replaces boolean

`RunLifecycleService.waitingPermission` state becomes `waitingPermissionCount: number`. `enterWaitingPermission(requestId)` increments; `exitWaitingPermission(requestId)` decrements; run resumes only when count reaches 0. Calling `exitWaitingPermission` with an unknown `requestId` is a no-op (idempotent). Existing callers that call enter once and exit once are unaffected.

### D14 — Parallel development contract: schema + events committed in week 1

Before feature branches diverge, a single PR merges:
1. `packages/db/migrations/0015_v11.sql` — all new tables and columns.
2. `packages/protocol/src/events/registry.ts` additions — all V1.1 event types declared by the capability specs.
3. New TypeScript command types in `packages/orchestrator/src/commands.ts`.
4. New REST endpoint type stubs in `packages/daemon/src/routes/`.

Dev A owns: `task-service.ts`, `commands.ts`, `team-dispatch.ts`, `adapter-bridge.ts`, `run-lifecycle-service.ts`.
Dev B owns: `prompts/`, `mailbox-service.ts`, `mcp/room-mcp-server.ts`, `packages/skills/`.
Dev C owns: `apps/web/`, `daemon/routes/kanban.ts`, `daemon/routes/participants.ts`, `daemon/routes/skills.ts`.

## Risks / Trade-offs

**[Risk] Worktree apply conflicts require user action, adding friction** → Mitigation: the apply/discard UI is surfaced prominently in the task detail drawer; the Kanban card shows a "Conflict" badge. For non-conflicting applies, the operation is one click.

**[Risk] Skill materialization leaves stale files if a run is interrupted** → Mitigation: `SkillRegistry.cleanupRun(runId)` is called in the run terminal hook; it removes the materialized skill directories for that run's workspace. Materialization failure blocks the run (does not proceed with reduced capability) — this is the safe default since the user explicitly assigned skills.

**[Risk] `room.complete_task` not called by non-compliant adapters** → Mitigation: run ends without tool call → task enters `review(missing_completion_report)` → leader is woken. This is a graceful degradation path, not a silent failure.

**[Risk] Visible planning phase adds latency before first delegation** → Mitigation: plan turn has no tool calls; typical latency < 3s. User sees a "Planning…" indicator. The plan is visible immediately in the side panel.

**[Risk] Three parallel branches diverge on `orchestrator` package** → Mitigation: Dev A and Dev B have non-overlapping file ownership within `orchestrator` (D14). Cross-file changes require tagging the other developer in the PR description.

## Migration Plan

1. **Contract week**: merge `0015_v11.sql` + event registry additions + command type stubs to `main`. All existing tests must pass.
2. **Feature branches**: Dev A (`feat/v11-A`), Dev B (`feat/v11-B`), Dev C (`feat/v11-C`) branch from this commit.
3. **Weekly merges**: each developer merges at least one completed feature PR to `main` per week. PRs require CI green + 1 reviewer.
4. **Integration week (week 9-10)**: all branches merged; end-to-end tests run against a real multi-agent scenario (≥ 3 agents, ≥ 5 tasks, 1 worktree apply).
5. **Rollback**: `0015_v11.sql` is additive (new tables + new nullable columns). Rolling back means reverting application code; schema additions are harmless to V1.0 code.

## Open Questions

- **[DECISION-NEEDED-V1.1-A]** Should `room.complete_task` be a new MCP tool or an extension of `room.update_task`? New tool is cleaner (single responsibility); extending `update_task` reduces the tool count. Recommend new tool — the completion semantics (authoritative status transition + report) are distinct from a general update.
- **[DECISION-NEEDED-V1.1-B]** Worktree apply strategy: `git apply` (patch-based, no history, simpler conflict detection) vs `git merge --no-ff` (preserves commit history, requires branch lifecycle). **Recommend `git apply` for V1.1 default** — it matches the OpenCode and AionUi reference patterns (patch/diff apply), requires no branch management, and produces cleaner conflict output. `git merge --no-ff` can be offered as an explicit opt-in strategy in V1.2 once the commit lifecycle semantics are fully designed.
- **[DECISION-NEEDED-V1.1-C]** Skill materialization scope: per-run temp directory vs workspace persistent directory. **Recommend per-run materialization for V1.1**: before each run starts, `SkillRegistry` writes selected skills into a run-scoped staging path (e.g., `{worktree}/.claude/skills/` for isolated-worktree runs, or a temp overlay for shared-mode runs), then cleans up in the run terminal hook. This prevents cross-room skill leakage when multiple rooms share the same workspace but have different skill sets. Runtimes that do not support native skill discovery receive a prompt-injected skill index + full SKILL.md content for selected skills only.

## V1.1 Event Registry Contract

All V1.1 new events MUST be registered in `packages/protocol/src/events/registry.ts` before any implementation uses them. Both `"skill"` and `"worktree"` EventCategory values MUST be added to the `EventCategory` union type. Every event with `visibility` including `main` MUST have a handler in `apps/web/src/hooks/useProjector.ts`.

| Event | Category | Durability | Visibility | Payload | Projector Consumer |
|-------|----------|-----------|-----------|---------|-------------------|
| `task.column.moved` | `task` | durable | `both` | `{ taskId, roomId, fromColumn, toColumn }` | update `boardColumns` map |
| `task.plan.created` | `task` | durable | `main` | `{ roomId, runId, planId, taskCount }` | add "Execution Plan" card to side panel |
| `run.file_changes.recorded` | `run` | durable | `both` | `{ runId, taskId?, filesChangedCount, filesChanged }` | update file-change badge on task card |
| `worktree.diff.ready` | `worktree` | durable | `both` | `{ runId, taskId?, artifactId, filesChanged }` | show "Ready to apply" badge on task card |
| `worktree.applied` | `worktree` | durable | `both` | `{ runId, taskId?, artifactId }` | clear "Ready to apply" badge on task card |
| `worktree.discarded` | `worktree` | durable | `both` | `{ runId, taskId?, artifactId }` | clear "Ready to apply" badge on task card |
| `worktree.conflict_detected` | `worktree` | durable | `both` | `{ runId, taskId?, artifactId, conflictDiff }` | show "Conflict" badge on task card |
| `room.stalled` | `room` | durable | `main` | `{ roomId, stalledTaskIds, reason }` | show stalled banner in chat view |
| `room.unstalled` | `room` | durable | `main` | `{ roomId }` | dismiss stalled banner |
| `skill.created` | `skill` | durable | `detail` | `{ skillId, workspaceId, name, origin }` | audit/debug only; Settings refreshes via REST |
| `skill.updated` | `skill` | durable | `detail` | `{ skillId, workspaceId }` | audit/debug only; Settings refreshes via REST |
| `skill.deleted` | `skill` | durable | `detail` | `{ skillId, workspaceId }` | audit/debug only; Settings refreshes via REST |
| `skill.imported` | `skill` | durable | `detail` | `{ skillId, workspaceId, sourceUrl }` | audit/debug only; Settings refreshes via REST |
| `skill.activated` | `skill` | durable | `detail` | `{ skillId, roomId?, participantId? }` | audit/debug only; Members panel refreshes via REST |
| `skill.deactivated` | `skill` | durable | `detail` | `{ skillId, roomId?, participantId? }` | audit/debug only; Members panel refreshes via REST |
| `skill.materialization_failed` | `skill` | durable | `main` | `{ skillId, runId, error }` | show inline error in chat view |

**Reused events (no change to registration):**

| Event | Existing Visibility | V1.1 Usage |
|-------|-------------------|-----------|
| `agent.joined` | `both` | add-participant flow |
| `agent.state.changed` | `both` | add-participant flow, presence updates |
| `task.status.changed` | `both` | complete_task, turn limit, worktree conflict |
| `task.activity.added` | `both` | plan_parse_failed, priority_change |
| `task.delegation.completed` | `both` | complete_task → team-dispatch |

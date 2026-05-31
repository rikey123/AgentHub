## Why

V1.0 delivered the Role/Runtime/ModelConfig decoupling and Squad/Team orchestration primitives, but a systematic comparison against mature multi-agent platforms (Multica, AionUi, WenzAgent, Symphony, Hermes-Kanban) revealed 16 concrete gaps — three of which are P0 correctness/security issues (silent file overwrites, escalation black holes, unconstrained sub-agent recursion). V1.1 addresses the highest-priority reliability and usability gaps needed to make V1.0 multi-agent collaboration dependable, adds the Kanban task board originally planned for this milestone, introduces a Skill system for composable agent capabilities, and lets users expand teams at runtime. Scheduled automation (cron, recurring tasks) and automatic DAG execution (dependency auto-dispatch) are deferred to V1.2 to keep scope manageable. Three developers will work in parallel across well-separated package boundaries.

## What Changes

- **P0 — Worktree-per-run isolation**: agents in squad/team rooms each get an isolated git worktree; the system tracks file changes per run and exposes diff/patch artifacts; no automatic merge — the user or leader explicitly reviews and applies changes via `room.apply_worktree` or discards via `room.discard_worktree`.
- **P0 — Timeout escalation**: when a delegated task times out AND the leader run also fails, the system escalates to a user-visible banner + `room.stalled` event instead of going silent.
- **P0 — Sub-agent tool isolation**: `room.spawn_agent` and `room.delegate` enforce a tool whitelist; sub-agents cannot recursively spawn agents or call leader-only tools (`room.delegate`, `room.spawn_agent`, `room.add_participant`).
- **P1 — Structured completion report via tool call**: teammates call `room.complete_task` (new MCP tool) with a typed `TaskCompletionReport`; this is the authoritative path for task status transition; if a run ends without calling `room.complete_task`, the task enters `review` with reason `missing_completion_report`.
- **P1 — Teammate MissionBrief + Room Memory**: every teammate wake assembles a `MissionBrief` from live room state — overall goal, room mode, leader identity, sibling task summaries, and **room memory** (confirmed `context_items` with `scope='conversation'`); room memory is the existing context-ledger infrastructure repurposed as a persistent shared knowledge base for multi-agent rooms; agents propose entries via `room.propose_context`, user confirms, and all future wakes see them.
- **P1 — Per-task turn limit**: tasks carry `max_turns: number | null`; the run executor enforces the limit and transitions the task to `blocked` with reason `turn_limit_exceeded` when hit.
- **P2 — Mid-flight context handoff**: when a run fails mid-task, `task_checkpoints` table stores the last known progress summary; the replacement run receives it as part of its wake prompt.
- **P2 — Pre-execution planning phase (visible-only)**: leader's first turn in a squad/team room produces a `PlanDocument` (task breakdown + assignee mapping) stored in `task_plans` and surfaced in the side panel; execution begins immediately after the plan is stored; the plan is informational, not a blocking approval gate.
- **P3 — Concurrent permission ref-counting**: `waitingPermission` state in `RunLifecycleService` becomes a reference counter; the run only resumes when the counter reaches zero, supporting parallel tool permission requests.
- **P3 — Agent capability declaration**: `roles.capabilities` is promoted from an opaque JSON blob to a validated `string[]` of well-known capability tokens; `room.list_members` returns `capabilities[]`; leader prompt lists each teammate's declared capabilities.
- **P3 — Task dependency visualization**: `tasks.dependencies` is surfaced in the Kanban board as dependency arrows and "Waiting on N tasks" indicators; no automatic DAG dispatch in V1.1 (deferred to V1.2).
- **Kanban task board**: full Trello-style board view for the tasks side panel — drag-to-move columns, priority badges, blocker indicators, dependency arrows, per-task file-change badge, diff viewer.
- **User-initiated team expansion**: `POST /rooms/:id/participants { agentBindingId }` REST endpoint + `room.add_participant` MCP tool; users can add agents (by binding) to a running room from the Members panel; leader is notified via mailbox.
- **Skill system**: standard SKILL.md skill packages with optional supporting files; builtin skills shipped with AgentHub; workspace/imported skills created by users; room-level skill pool; per-agent skill overrides; runtime-native materialization (`.claude/skills/`, `.opencode/skills/`, etc.) with prompt-injection fallback for runtimes without native skill discovery; Settings UI for management.
- **Security hardening**: path traversal validation on all workspace/file paths; single-flight deduplication on Settings bootstrap fetches; sub-agent leader-only tool isolation.
- **File change snapshots**: per-run file change list stored in `run_file_changes`; Kanban card shows "N files changed" badge; diff viewer in task detail drawer.

## Capabilities

### New Capabilities

- `multi-agent-reliability`: worktree isolation + diff/apply lifecycle, timeout escalation, mid-flight context handoff, permission ref-counting, path traversal guard.
- `multi-agent-intelligence`: `room.complete_task` tool call as authoritative completion path, teammate MissionBrief + room memory (context-ledger integration), per-task turn limit, blocked reason field, visible planning phase, agent capability declaration.
- `task-board`: Kanban view — columns, drag-to-move, priority, blocker, dependency arrows (visualization only), file-change badge, diff viewer.
- `team-expansion`: user-initiated add-participant flow — `POST /rooms/:id/participants { agentBindingId }` REST endpoint, `room.add_participant` MCP tool, Members panel UI, leader notification.
- `skill-system`: standard SKILL.md skill packages (builtin/workspace/imported origins) with optional supporting files; room-level skill pool; per-agent skill overrides; runtime-native materialization into runtime skill directories (`.claude/skills/`, `.opencode/skills/`, etc.) with prompt-injection fallback; lifecycle events; Settings UI.

### Modified Capabilities

- `orchestrator`: adds `room.complete_task` MCP tool, `MissionBrief` injection, turn-limit enforcement, worktree lifecycle (create/diff/apply/discard), sub-agent tool whitelist, visible planning phase, mid-flight checkpoint capture.
- `task-workflow-core`: adds `blocker_reason`, `max_turns`, `board_column` columns; `task_checkpoints`, `task_plans`, `run_file_changes` tables.
- `rooms`: adds `POST /rooms/:id/participants { agentBindingId }` endpoint; `room.add_participant` MCP tool.
- `agents`: `roles.capabilities` promoted to validated token list; `room.list_members` returns `capabilities[]`.
- `v1-roadmap`: V1.1 task-board foundation fulfilled (Kanban, plan card, dependency arrows, file diff); collab-visualization/timeline remains partial — dependency arrows and plan card are delivered, but full timeline/topology views are deferred; skill-system placeholder moved from V1.2 to V1.1; cron/recurring/dependency-auto-dispatch remain V1.2.

## Impact

- **New packages**: `packages/skills` (skill registry + lifecycle).
- **Schema migration**: `0015_v11.sql` — new tables (`task_checkpoints`, `task_plans`, `run_file_changes`, `skills`, `skill_files`, `room_skills`, `agent_skills`) and new columns on `tasks` (`blocker_reason`, `max_turns`, `board_column`), `rooms` (`stalled_at`).
- **Protocol**: register V1.1 event types in `registry.ts`: `task.column.moved`, `task.plan.created`, `run.file_changes.recorded`, `worktree.diff.ready`, `worktree.applied`, `worktree.discarded`, `worktree.conflict_detected`, `room.stalled`, `room.unstalled`, `skill.created`, `skill.updated`, `skill.deleted`, `skill.imported`, `skill.activated`, `skill.deactivated`, `skill.materialization_failed`. Existing `agent.joined` / `agent.state.changed` are reused with `visibility: both` (no change).
- **Orchestrator**: `task-service.ts`, `mailbox-service.ts`, `team-dispatch.ts`, `commands.ts`, `adapter-bridge.ts`, `run-lifecycle-service.ts`, all prompt files, `mcp/room-mcp-server.ts`.
- **Daemon**: new HTTP routes for participants, skills, Kanban/worktree apply-discard flows.
- **Web**: new Kanban component tree, Members panel add-participant flow, Skill settings tab, task detail diff viewer, room stalled banner, worktree apply/discard UI.
- **No breaking changes** to existing EventBus contract, SSE envelope schema, or `AgentRuntimeAdapter` interface.

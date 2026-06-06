# multi-agent-intelligence Specification

## Purpose
TBD - created by archiving change add-v11-multi-agent-complete. Update Purpose after archive.
## Requirements
### Requirement: room.complete_task — authoritative task completion tool (complete-task-tool)

The system SHALL add a new MCP tool `room.complete_task` to the Room MCP Server. This tool is the **authoritative path** for transitioning a delegated task to a terminal or review state. Teammates MUST call this tool before ending their turn on a delegated task.

**Reference:** Multica `server/internal/handler/squad.go` — task completion is a structured API call, not inferred from message content. AionUi `TaskManager.ts` — `checkUnblocks()` is triggered by an explicit status update, not by parsing assistant text.

Tool input schema:
```typescript
room.complete_task({
  taskId: string,
  status: "completed" | "blocked" | "review",
  // "review" is the canonical value; "needs_review" is accepted as an input alias for "review"
  summary: string,           // 1-3 sentence human-readable summary
  blockerReason?: string,    // required when status = "blocked"
  artifactIds?: string[],    // artifact IDs produced during this run
  filesChanged?: string[]    // file paths written during this run
})
```

The daemon SHALL process this call inside a SQLite transaction:
1. Validate `taskId` belongs to the current room and is assigned to the calling agent.
2. Resolve the effective target status:
   - Input `"completed"` + `tasks.expects_review = 0` → target status `"completed"`.
   - Input `"completed"` + `tasks.expects_review = 1` → target status `"review"` (team review gate; teammate cannot self-complete a review-required task).
   - Input `"review"` or `"needs_review"` → target status `"review"`.
   - Input `"blocked"` → target status `"blocked"`; `blockerReason` is required.
3. Update `tasks.status` to the resolved target status.
4. Set `tasks.blocker_reason` if `blockerReason` is provided; clear it if transitioning to `"review"` or `"completed"`.
5. Publish `task.status.changed` (durable, visibility: `both`).
6. Publish `task.delegation.completed { taskId, finalStatus }` (durable, visibility: `both`) to notify the leader/team-dispatch.
7. If target status is `"review"` or `"blocked"`, wake the leader with `reason: "task_review"` or `"task_blocked"` respectively.

If a run reaches `session.ended` without a `room.complete_task` call recorded for its associated task, the daemon SHALL transition the task to `review` with `blocker_reason = "missing_completion_report"` and wake the leader with `reason: "task_review"`.

A fenced `task-completion` JSON block in the assistant message is retained as a **visible transcript aid** only — it is NOT parsed for state transitions.

**Frontend:** The task card in the Kanban board and the task detail drawer SHALL update in real-time via the `task.status.changed` SSE event. The projector handles this event and updates the task view model without a page refresh.

#### Scenario: Teammate completes task in squad mode (no review gate)

- **WHEN** a teammate calls `room.complete_task { taskId, status: "completed", summary: "..." }` and `tasks.expects_review = 0`
- **THEN** `tasks.status` transitions to `completed`; `task.status.changed { nextStatus: "completed" }` is published; the Kanban card moves to the Done column

#### Scenario: Teammate completes task in team mode (review gate enforced)

- **WHEN** a teammate calls `room.complete_task { taskId, status: "completed", summary: "..." }` and `tasks.expects_review = 1`
- **THEN** `tasks.status` transitions to `review` (NOT `completed`); `task.status.changed { nextStatus: "review" }` is published; `task.delegation.completed` is published; the leader is woken with `reason: "task_review"`; the Kanban card moves to the Review column

#### Scenario: Teammate reports blocker

- **WHEN** a teammate calls `room.complete_task { taskId, status: "blocked", summary: "...", blockerReason: "Missing API key for external service" }`
- **THEN** `tasks.status` transitions to `blocked`; `tasks.blocker_reason` is set; the Kanban card shows a blocker badge; the leader is woken with `reason: "task_blocked"`

#### Scenario: Run ends without room.complete_task

- **WHEN** a run associated with a task reaches `session.ended` without having called `room.complete_task`
- **THEN** the task transitions to `review` with `blocker_reason = "missing_completion_report"`; the leader is woken with `reason: "task_review"`; the Kanban card shows a "Missing report" badge

### Requirement: Teammate MissionBrief with Room Memory injection (mission-brief)

The system SHALL assemble a `MissionBrief` at wake time for every teammate run in a squad or team room and prepend it as a `<mission-brief>` XML block before the role system prompt.

**Reference:** Multica `server/internal/handler/squad_briefing.go` — leader receives a `squadOperatingProtocol` + full roster on every wake. AionUi `leadPrompt.ts` line 68 and `teammatePrompt.ts` line 47 — both leader and teammate receive workspace context and team roster. The key insight from AionUi: teammates that lack global context make decisions inconsistent with the overall goal.

`assembleMissionBrief(roomId, agentId, taskId?)` is called synchronously before prompt construction. It queries live room state:

```typescript
type MissionBrief = {
  goal: string                  // derived: pinned "Goal:" ContextItem → first user message → fallback
  roomMode: RoomMode
  leaderName: string
  myTaskId?: string
  myTaskTitle?: string
  siblingTasks: Array<{
    taskId: string
    title: string
    assigneeName: string
    status: TaskStatus
    blockerReason?: string
  }>
  roomMemory: Array<{           // confirmed context_items with scope='conversation'
    type: "fact" | "decision" | "constraint" | "issue"
    content: string
  }>
  activePlan?: string           // first 300 chars of current PlanDocument
}
```

**Room Memory** is the set of confirmed `context_items` with `scope='conversation'` and `room_id = current_room` and `status = 'confirmed'`. This reuses the existing context-ledger infrastructure — no new tables. Agents propose entries via `room.propose_context { scope: "conversation", type: "fact"|"decision"|"constraint", content: "..." }`. User confirmation promotes them to `status='confirmed'` and they appear in all future MissionBriefs.

Token budget: MissionBrief is capped at 800 tokens, separate from the regular context assembly budget. `siblingTasks` capped at 10 entries (most recently updated). `roomMemory` truncated by `updated_at DESC` if over budget.

**Frontend:** The Context panel (existing) already surfaces `context_items`. No new UI component needed for room memory — users manage it through the existing Context View. The MissionBrief itself is internal to the prompt and not directly surfaced in the UI.

#### Scenario: Teammate wakes with full mission context

- **WHEN** a teammate is woken for a delegated task in a team room that has 3 confirmed room memory entries and 2 sibling tasks
- **THEN** the run's system prompt begins with a `<mission-brief>` block containing the room goal, leader name, 2 sibling task summaries, and 3 room memory entries

#### Scenario: Room memory accumulates across wakes

- **WHEN** the leader proposes `room.propose_context { type: "decision", content: "Use TypeScript strict mode" }` and the user confirms it
- **THEN** all subsequent teammate wakes in that room include this entry in their `roomMemory`; the entry persists across daemon restarts

#### Scenario: Empty room memory is handled gracefully

- **WHEN** a teammate wakes in a room with no confirmed room memory entries
- **THEN** the `<mission-brief>` block omits the `roomMemory` section; no error is thrown

### Requirement: Per-task turn limit enforcement (turn-limit)

The system SHALL support a `max_turns: number | null` field on tasks. When a run associated with a task reaches `max_turns` LLM invocations without calling `room.complete_task`, the run executor SHALL terminate the run and transition the task to `blocked` with `blocker_reason = "turn_limit_exceeded"`.

**Reference:** WenzAgent `SubAgentExecutor.execute(employeeId, taskPrompt, systemPrompt, tools, maxTurns, timeout)` — explicit `maxTurns` per sub-agent invocation prevents runaway token consumption.

The turn counter increments on each LLM response received by the adapter bridge. The limit is checked before dispatching the next LLM call. When the limit is reached, the daemon SHALL:
1. Cancel the adapter session.
2. Transition the associated task to `blocked`.
3. Set `tasks.blocker_reason = "turn_limit_exceeded"`.
4. Publish `task.status.changed { nextStatus: "blocked", reason: "turn_limit_exceeded" }` (durable, visibility: `both`).
5. Wake the leader with `reason: "task_blocked"`.

This is a direct transition to `blocked` — it does NOT go through the `room.complete_task` fallback path.

`max_turns` is set by the leader when calling `room.delegate { taskId, maxTurns: 10 }` or `room.create_task { ..., maxTurns: 10 }`. Default is `null` (no limit).

**Frontend:** The task detail drawer SHALL display the current turn count and `max_turns` limit when set. The Kanban card SHALL show a "Turn limit exceeded" badge when `blocker_reason = "turn_limit_exceeded"`.

#### Scenario: Task hits turn limit

- **WHEN** a run for a task with `max_turns = 5` completes its 5th LLM response without calling `room.complete_task`
- **THEN** the run is terminated; the task transitions to `blocked` with `blocker_reason = "turn_limit_exceeded"`; the leader is woken with `reason: "task_blocked"`; the Kanban card shows a "Turn limit exceeded" badge

#### Scenario: Task completes before turn limit

- **WHEN** a run for a task with `max_turns = 10` calls `room.complete_task` on turn 3
- **THEN** the task transitions normally; the turn limit is not enforced further

#### Scenario: Task with no turn limit is unaffected

- **WHEN** a task has `max_turns = null`
- **THEN** the run executor does not enforce any turn limit; the run continues until `room.complete_task` is called or the run fails for another reason

### Requirement: Blocked reason field on tasks (blocked-reason)

The system SHALL add a `blocker_reason TEXT` column to the `tasks` table. `room.update_task` and `room.complete_task` SHALL accept an optional `blockerReason` parameter. `room.list_tasks` SHALL return `blockerReason` in each task object. The leader prompt SHALL surface `blockerReason` directly in the task list so the leader can act without querying activity logs.

**Reference:** Hermes-Kanban `KanbanCard.blockerReason: string` — structured blocker reason as a first-class field, not buried in activity comments. This enables direct query filtering (`GET /query?blocked=true`) and standup generation.

**Frontend:** The Kanban card SHALL display the `blockerReason` text directly on the card face when `status = "blocked"`. The task detail drawer SHALL show it prominently. The side panel task list SHALL show a blocker icon with tooltip containing the reason.

#### Scenario: Leader sees blocker reason without querying activity log

- **WHEN** the leader calls `room.list_tasks` and Task T has `status = "blocked"` with `blocker_reason = "Missing API key"`
- **THEN** the response includes `{ taskId, status: "blocked", blockerReason: "Missing API key" }`; the leader prompt surfaces this directly without requiring a separate activity log query

#### Scenario: Kanban card shows blocker reason

- **WHEN** a task transitions to `blocked` with `blocker_reason = "Waiting for design approval"`
- **THEN** the Kanban card in the Waiting column shows the blocker reason text; the task detail drawer highlights it in a warning callout

### Requirement: Pre-execution planning phase — visible-only (planning-phase)

The system SHALL implement a visible-only planning phase for squad and team rooms. When a squad/team room receives its first user message, the leader's first wake SHALL use `reason: "plan"`. The leader prompt for `reason = "plan"` SHALL instruct the leader to produce ONLY a `PlanDocument` JSON block — no tool calls, no delegation.

**Reference:** AionUi `agent-team-guide-flow.md` — solo agent analyzes task and recommends team structure before execution begins. Multica `squad_briefing.go` — leader receives full briefing and re-evaluates on each trigger. The key insight: users benefit from seeing the plan before agents start consuming tokens on potentially wrong decompositions.

`PlanDocument` schema:
```typescript
type PlanDocument = {
  goal: string
  tasks: Array<{
    title: string
    description: string
    assigneeRole: string    // role name, not agent ID
    dependsOn?: string[]    // task titles this depends on
    maxTurns?: number
  }>
}
```

The daemon parses the `PlanDocument` JSON block from the leader's message, stores it in `task_plans (id, room_id, run_id, plan_json, created_at)`, and publishes `task.plan.created` (durable, visibility: `main`). The leader's second wake is triggered immediately after plan storage with `reason: "execute"`.

The plan is informational — execution begins immediately. The user can read the plan in the side panel while the leader is already delegating.

**Frontend:** The projector handles `task.plan.created` and adds a collapsible "Execution Plan" card to the side panel Tasks tab. The card shows the task breakdown and assignee roles. It is read-only — users cannot edit the plan, but can cancel active runs via the existing cancel flow.

#### Scenario: Leader produces plan on first message

- **WHEN** a user sends the first message in a squad room
- **THEN** the leader's first wake uses `reason: "plan"`; the leader outputs a `PlanDocument` JSON block; the daemon stores it in `task_plans`; `task.plan.created` is published; the side panel shows an "Execution Plan" card; the leader is immediately woken again with `reason: "execute"`

#### Scenario: Plan card is visible while execution proceeds

- **WHEN** the leader has been woken with `reason: "execute"` and is delegating tasks
- **THEN** the "Execution Plan" card remains visible in the side panel; the user can read the plan while watching tasks appear in the Kanban board

#### Scenario: Solo room has no planning phase

- **WHEN** a user sends a message in a solo room
- **THEN** no planning phase is triggered; the primary agent wakes with `reason: "primary_turn"` as before

### Requirement: Agent capability declaration (capability-declaration)

The system SHALL promote `roles.capabilities` from an opaque JSON blob to a validated `string[]` of well-known capability tokens. `room.list_members` SHALL return a `capabilities: string[]` field for each member. The leader prompt SHALL list each teammate's declared capabilities alongside their name and role.

**Reference:** Multica `LoadAgentSkills` — agents have declared skill lists; the squad roster shows member names + roles as capability signals. WenzAgent `spawn_sub_agent_tool.dart` `_defaultToolNames` — explicit capability whitelist per sub-agent.

Well-known capability tokens (V1.1 initial set):
```
chat, code.edit, code.review, file.read, file.write, terminal.run,
context.read, context.write, intervention.knock, task.delegate
```

The daemon validates `roles.capabilities` against this set on role create/update. Unknown tokens are rejected with a 400 error. The leader prompt includes a capabilities summary: `"@reviewer: code.review, context.read"`.

**Frontend:** The Members panel SHALL display each agent's capability badges. The Settings → Roles page SHALL show the capabilities list for each role with a multi-select editor using the well-known token set.

#### Scenario: Leader sees teammate capabilities

- **WHEN** the leader calls `room.list_members` in a team room with a reviewer and a builder
- **THEN** the response includes `{ agentId, name, role, capabilities: ["code.review", "context.read"] }` for the reviewer and `{ capabilities: ["code.edit", "file.write", "terminal.run"] }` for the builder; the leader prompt surfaces these

#### Scenario: Unknown capability token rejected

- **WHEN** a user tries to create a role with `capabilities: ["magic.power"]`
- **THEN** the daemon returns 400 with `{ error: "unknown_capability_token", token: "magic.power" }`

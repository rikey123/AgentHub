## ADDED Requirements

### Requirement: room.complete_task MCP tool registration (complete-task-registration)

The system SHALL register `room.complete_task` as a new tool in the Room MCP Server. This tool is **teammate-only**:
- Non-leader task assignees MAY call it for their assigned task.
- Leader sessions MUST receive `{ error: "complete_task_not_for_leader" }`.
- Leaders use `room.update_task` to review, approve, or manage tasks.

`room.complete_task` is NOT in `LEADER_ONLY_TOOLS` — it is in a separate `TEAMMATE_ONLY_TOOLS` set enforced at the same MCP dispatch layer.

**Reference:** Multica `server/internal/handler/squad.go` — task completion is a structured API call. AionUi `TaskManager.ts` — explicit status update triggers `checkUnblocks()`. The pattern: task state transitions must go through a structured tool call, not be inferred from message content.

See `multi-agent-intelligence/spec.md` for the full tool schema and behavior.

#### Scenario: room.complete_task is available to teammates

- **WHEN** a teammate agent's MCP session is established
- **THEN** `room.complete_task` appears in the tool list; the teammate can call it to report task completion

#### Scenario: room.complete_task is NOT leader-only

- **WHEN** a non-leader agent calls `room.complete_task`
- **THEN** the call is accepted (it is not in `LEADER_ONLY_TOOLS`); the task status is updated

### Requirement: Sub-agent tool isolation and recursive spawn prevention (sub-agent-isolation)

The system SHALL enforce a leader-only tool whitelist at the Room MCP Server level. Non-leader sessions that call a leader-only tool SHALL receive `{ error: "tool_not_permitted", tool }` without executing. Sub-agents spawned via `room.spawn_agent` SHALL always be non-leader.

**Reference:** WenzAgent `spawn_sub_agent_tool.dart` `_defaultToolNames` — explicit tool whitelist for sub-agents; `spawn_sub_agent` excluded to prevent recursion. Multica squad leader pattern — only the leader can delegate tasks.

```typescript
const LEADER_ONLY_TOOLS = new Set([
  'room.delegate',
  'room.spawn_agent',
  'room.add_participant'
])
```

`room.spawn_agent` additionally checks `session.spawnDepth`; depth ≥ 1 returns `{ error: "recursive_spawn_not_permitted" }`.

**Frontend:** No direct UI for this — it is enforced at the protocol level. The Run Detail drawer shows tool call errors including `tool_not_permitted`.

#### Scenario: Non-leader calls leader-only tool

- **WHEN** a teammate agent calls `room.delegate`
- **THEN** the MCP server returns `{ error: "tool_not_permitted", tool: "room.delegate" }` without creating any task or dispatching any wake

#### Scenario: Sub-agent cannot recursively spawn

- **WHEN** an agent spawned via `room.spawn_agent` (spawnDepth=1) calls `room.spawn_agent`
- **THEN** the MCP server returns `{ error: "recursive_spawn_not_permitted" }`

### Requirement: MissionBrief assembly and injection (mission-brief-assembly)

The system SHALL call `assembleMissionBrief(roomId, agentId, taskId?)` before constructing the prompt for any teammate run in a squad or team room. The result is prepended as a `<mission-brief>` XML block.

See `multi-agent-intelligence/spec.md` for the full MissionBrief structure and Room Memory semantics.

**Reference:** Multica `squad_briefing.go` — leader receives full briefing on every wake. AionUi `teammatePrompt.ts` line 47 — teammate receives workspace context and team roster.

#### Scenario: MissionBrief injected for teammate wake

- **WHEN** a teammate is woken for a delegated task in a squad room
- **THEN** the run's system prompt begins with `<mission-brief>...</mission-brief>` containing goal, leader name, sibling tasks, and room memory

#### Scenario: Solo room has no MissionBrief

- **WHEN** a run starts in a solo room
- **THEN** no `<mission-brief>` block is injected; the prompt starts with the role system prompt as before

### Requirement: Visible planning phase for squad and team rooms (planning-phase-orchestration)

The system SHALL implement the visible-only planning phase. When a squad/team room receives its first user message, the leader's first wake SHALL use `reason: "plan"`. After the leader produces a `PlanDocument`, the daemon stores it and immediately triggers a second wake with `reason: "execute"`.

See `multi-agent-intelligence/spec.md` for the full PlanDocument schema and frontend behavior.

**Reference:** AionUi `agent-team-guide-flow.md` — solo agent analyzes task before team execution begins. Multica `squad_briefing.go` — leader re-evaluates on each trigger with full context.

`WakeReason` enum SHALL be extended with `"plan"` and `"execute"` values.

#### Scenario: First message triggers plan wake

- **WHEN** a user sends the first message in a squad room
- **THEN** the leader is woken with `reason: "plan"`; after producing a PlanDocument, the leader is immediately woken again with `reason: "execute"`

#### Scenario: Subsequent messages skip planning phase

- **WHEN** a user sends a second message in a squad room that already has a plan
- **THEN** the leader is woken with `reason: "primary_turn"` (no planning phase)

## MODIFIED Requirements

### Requirement: Room MCP Tools

The system SHALL add the following tools to the Room MCP Server for V1.1. All existing V1.0 tools remain unchanged.

**V1.1 新增工具：**

| Tool | 描述 | 权限要求 |
|---|---|---|
| `room.complete_task` | Teammate 提交结构化完成报告（权威路径）| 非 leader（teammate 专用）|
| `room.add_participant` | 向当前 room 添加 agent binding | leader-only |
| `room.apply_worktree` | 应用 worktree diff artifact | leader-only |
| `room.discard_worktree` | 丢弃 worktree diff artifact | leader-only |

`room.delegate` 的 `maxTurns` 参数 SHALL be added (optional, sets `tasks.max_turns`).

#### Scenario: room.complete_task 仅 teammate 可调

- **WHEN** leader agent 调 `room.complete_task`
- **THEN** 返回 `{ error: "complete_task_not_for_leader" }`（leader 用 `room.update_task` 管理任务状态）

#### Scenario: room.add_participant 仅 leader 可调

- **WHEN** observer agent 调 `room.add_participant`
- **THEN** 返回 `{ error: "tool_not_permitted", tool: "room.add_participant" }`

### Requirement: Observing 是被动状态 + WakeAgent 是模型调用唯一入口

The system SHALL extend `WakeReason` with V1.1 values. All other constraints remain unchanged.

**V1.1 新增 WakeReason 值：**
```typescript
type WakeReason =
  // ... existing V1.0 values ...
  | "plan"              // 新增：squad/team room 第一条消息触发 leader 规划阶段
  | "execute"           // 新增：规划完成后立即触发 leader 执行阶段
  | "agent_stalled"     // 新增：watchdog 90s 静默触发（Level-1 升级）
```

#### Scenario: plan wake reason triggers planning prompt

- **WHEN** WakeAgent is dispatched with `reason: "plan"` for the leader
- **THEN** the leader prompt instructs the leader to produce ONLY a PlanDocument JSON block; no tool calls or delegation are permitted in this turn

#### Scenario: execute wake reason triggers normal execution

- **WHEN** WakeAgent is dispatched with `reason: "execute"` for the leader
- **THEN** the leader prompt uses the standard execution instructions; the leader proceeds with delegation

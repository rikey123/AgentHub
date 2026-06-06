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

### Requirement: Assisted selector group chat (assisted-selector-groupchat)

The system SHALL implement assisted mode as an AutoGen-style selector group chat. For each user message in an assisted room, the orchestrator SHALL create a bounded group turn and select one speaker at a time from eligible room participants.

**Reference:** AutoGen `SelectorGroupChat` / `BaseGroupChatManager` / `ChatAgentContainer` patterns: shared message thread, selector override, candidate filtering, repeated-speaker guard, retry/fallback, termination before next speaker selection. AionUi remains the reference for mailbox and wake lifecycle, not for assisted speaker selection.

The selector flow SHALL:
1. use deterministic selector overrides for explicit `@agent` mentions;
2. filter candidates to enabled participants with available runtime/model configuration;
3. include role description, declared capabilities, and effective skill summaries in selector participant descriptions;
4. call the selector model when more than one candidate remains;
5. reject unknown, ambiguous, or repeated-speaker outputs and retry up to `max_selector_attempts`;
6. default `allow_repeated_speaker` to false for the immediately previous speaker;
7. allow a speaker to return after another participant has spoken;
8. update selector history with the completed speaker's public output before choosing the next speaker;
9. stop on `max_turns`, no valid candidate, explicit `NO_SPEAKER`/`STOP`, superseding user message, empty output, or ack-only output.

Selector/debug status SHALL NOT be rendered as ordinary chat bubbles. Public agent messages remain durable room messages; selector details belong in run detail/debug surfaces.

#### Scenario: Selector chooses the next assisted speaker

- **WHEN** a user message arrives in an assisted room with three eligible agents and no explicit mention
- **THEN** the selector receives participant descriptions and shared conversation history
- **AND** exactly one selected agent is woken

#### Scenario: Mention overrides selector model

- **WHEN** the user writes `@Builder can you sanity-check this?`
- **THEN** Builder is selected without a selector model call

#### Scenario: Assisted continuation sees prior speaker output

- **WHEN** Builder completes a public assisted turn and the group turn has remaining budget
- **THEN** the next selector call includes Builder's latest public output and any file-backed reply excerpts in the shared history

#### Scenario: Assisted group turn stops

- **WHEN** the selector returns `NO_SPEAKER` or the turn reaches its configured maximum speaker count
- **THEN** no additional agent is woken for that user message

### Requirement: Task-mode group chat presentation (task-mode-groupchat-presentation)

The system SHALL make squad and team rooms visibly conversational without changing their task-driven semantics. Squad and team rooms SHALL continue to use leader delegation, mailbox delivery, `room.complete_task`, review gates, and Kanban state as the source of truth.

The orchestrator MAY mirror key task lifecycle milestones into concise public assistant messages:
- delegation
- teammate task start
- teammate completion, block, or review report
- team review start
- team review completion

These public messages SHALL be normal durable room messages written in the same transaction as the lifecycle event they represent. They SHALL NOT replace task rows, mailbox messages, or state transition events. Raw task event names SHALL NOT be shown as chat bubbles.

#### Scenario: Delegation is visible as a group-chat handoff

- **WHEN** the leader delegates a task to Builder
- **THEN** the room shows a short public message that Builder is taking the task
- **AND** the task is still persisted through `task.delegation.created`

#### Scenario: Team review gate remains authoritative

- **WHEN** a teammate in team mode reports completion
- **THEN** a short public completion/review message may be shown
- **AND** the task still enters `review` until the leader approves it

### Requirement: Room MCP mature tool surface (room-mcp-mature-tools)

The Room MCP Server SHALL expose a mature workspace and collaboration tool surface for real runtimes. In addition to the original V1.1 tools, the tool list SHALL include:
- `room.send_file_message`
- `room.list_skills`
- `room.load_skill`
- `room.query_tasks`
- `room.get_board`
- `room.move_task`
- `room.set_blocker`
- `room.clear_blocker`
- `room.list_blockers`
- `room.standup`
- `room.review`
- `file.list`
- `file.glob`
- `file.grep`
- `file.edit`
- `file.apply_patch`
- `todo.write`

File and shell tools SHALL continue to use workspace path traversal guards and permission/capability checks. `file.edit` SHALL support exact `oldText`/`newText` replacement and multi-patch mode with missing-text hints and multiple-match rejection. Skill tools SHALL expose only selected/effective skill packages for the room/agent scope and SHALL NOT expose keychain secrets.

#### Scenario: Agent can inspect workspace through guarded tools

- **WHEN** a capable agent calls `file.glob`, `file.grep`, or `file.list`
- **THEN** the tool returns workspace-scoped results only
- **AND** absolute paths or `..` traversal are rejected

#### Scenario: Agent can use skill packages explicitly

- **WHEN** an agent calls `room.list_skills { scope: "effective" }` and then `room.load_skill`
- **THEN** it receives only the effective skill package content and supporting files selected for that room/agent

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

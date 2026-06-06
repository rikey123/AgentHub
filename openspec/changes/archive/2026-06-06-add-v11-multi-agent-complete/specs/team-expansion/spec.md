## ADDED Requirements

### Requirement: Add participant to existing room (add-participant)

The system SHALL allow users to add an existing agent (identified by `agentBindingId`) to a running room via a REST endpoint and a leader-accessible MCP tool.

**Reference:** AionUi `TeamSession.ts` `TeammateManager` — agents are added to a team session at runtime; `wakeAfterAcceptedDelivery` ensures the new agent is woken after joining. Multica `squad.go` — squad members are added with `member_type` and `role`; workspace-scoped.

**REST endpoint:**
```
POST /rooms/:id/participants
Body: { agentBindingId: string, displayNameOverride?: string }
Response 201: { participantId: string, agentBindingId: string, agentId: string, name: string, role: string, capabilities: string[] }
```

`agentBindingId` is the V1.0 `agent_bindings` table primary key, encoding `role_id + runtime_id + model_config_id`. This is the only public authority — `agent_profiles` is a derived runtime record.

The daemon SHALL, inside a single SQLite transaction:
1. Validate `agentBindingId` exists and belongs to the workspace.
2. Validate the agent is not already a participant in the room.
3. Insert a `room_participants` row.
4. Insert an `agent_presence` row with `state = "observing"`.
5. Publish `agent.joined` (durable, visibility: `both`).
6. Publish `agent.state.changed` (durable, visibility: `both`).
7. Send a mailbox message to the leader: `"New teammate <name> has joined the room"`.

**MCP tool** `room.add_participant { agentBindingId, displayNameOverride? }` — leader-only (enforced by D5 tool whitelist). Wraps the same command.

**Frontend:**
- Members panel (existing side panel tab) shows a "+ Add teammate" button
- Clicking opens a modal with a searchable dropdown of available agent bindings in the workspace
- On success, the new agent appears in the Members panel immediately via `agent.joined` SSE event
- The projector handles `agent.joined` and adds the participant to `room.participants`

#### Scenario: User adds a reviewer to a running squad room

- **WHEN** the user clicks "+ Add teammate" in the Members panel and selects the "Code Reviewer" binding
- **THEN** `POST /rooms/:id/participants { agentBindingId: "..." }` is called; the reviewer appears in the Members panel without a page refresh; the leader receives a mailbox notification

#### Scenario: Leader adds participant via MCP tool

- **WHEN** the leader calls `room.add_participant { agentBindingId: "..." }` during a run
- **THEN** the participant is added atomically; `agent.joined` is published; the leader receives confirmation in the tool response

#### Scenario: Duplicate participant rejected

- **WHEN** the user tries to add an agent that is already a participant in the room
- **THEN** the endpoint returns 409 with `{ error: "participant_already_in_room" }`; no duplicate row is created

### Requirement: Members panel UI for team management (members-panel-ui)

The system SHALL enhance the existing Members panel (side panel tab) to support team management operations: viewing participant details, adding participants, and seeing real-time presence.

**Reference:** AionUi `agentStatusChanged` / `agentSpawned` / `agentRemoved` events — real-time member roster updates. Multica squad member status endpoint — shows active issues per agent.

**Frontend:**
- Members panel lists all participants with: avatar, name, role, presence state (active/observing/offline), current task title (if assigned)
- "+ Add teammate" button opens the add-participant modal (see add-participant requirement)
- Each member row shows capability badges (from `roles.capabilities`)
- Presence state updates in real-time via `agent.state.changed` SSE events
- Leader is visually distinguished (crown icon or "Leader" badge)

#### Scenario: Members panel shows real-time presence

- **WHEN** a teammate transitions from `observing` to `active` (run starts)
- **THEN** the Members panel updates the teammate's presence indicator without a page refresh; the current task title appears next to their name

#### Scenario: Newly added participant appears immediately

- **WHEN** `agent.joined` is received via SSE
- **THEN** the projector adds the participant to the room state; the Members panel renders the new member without a page refresh

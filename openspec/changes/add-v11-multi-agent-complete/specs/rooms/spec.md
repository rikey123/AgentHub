## ADDED Requirements

### Requirement: Add participant REST endpoint (add-participant-endpoint)

The system SHALL expose `POST /rooms/:id/participants` for adding an existing agent binding to a running room.

**Reference:** AionUi `teamBridge.ts` — `addTeamMember` IPC call adds agents to a team session at runtime. Multica `squad.go` — `AddSquadMember` handler with workspace scoping and role assignment.

```
POST /rooms/:id/participants
Body: { agentBindingId: string, displayNameOverride?: string }
Response 201: { participantId: string, agentBindingId: string, agentId: string, name: string, role: string, capabilities: string[] }
Response 409: { error: "participant_already_in_room" }
Response 404: { error: "binding_not_found" }
```

The handler runs inside a single SQLite transaction: insert `room_participants`, insert `agent_presence`, publish `agent.joined` (durable, visibility: `both`), publish `agent.state.changed` (durable, visibility: `both`), send mailbox message to leader.

#### Scenario: User adds agent to running room

- **WHEN** `POST /rooms/r1/participants { agentBindingId: "b1" }` is called
- **THEN** the agent is added atomically; `agent.joined` is published; the Members panel updates without a page refresh; the leader receives a mailbox notification

#### Scenario: Duplicate participant returns 409

- **WHEN** `POST /rooms/r1/participants { agentBindingId: "b1" }` is called for an agent already in the room
- **THEN** 409 is returned; no duplicate row is created; no events are published

## MODIFIED Requirements

### Requirement: Post-MVP Mode 占位

The system SHALL accept `mode = "war_room"` at the Room creation API level but reject with 501 until V1.5. Squad and Team modes are fully implemented (V1.0). V1.1 adds participant management to running rooms.

#### Scenario: 创建 war_room 仍返回 501

- **WHEN** `POST /rooms { mode: "war_room", ... }`
- **THEN** 返回 501 + `{ error: "war_room mode is V1.5", capability: "v1-roadmap" }`

#### Scenario: Add participant to squad room

- **WHEN** `POST /rooms/:id/participants { agentBindingId }` is called on a squad room
- **THEN** the participant is added; the room continues operating normally with the new member

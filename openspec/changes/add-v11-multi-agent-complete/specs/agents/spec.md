## MODIFIED Requirements

### Requirement: Agent 能力声明与 Permission 衔接

The system SHALL promote `roles.capabilities` from an opaque JSON blob to a validated `string[]` of well-known capability tokens. The daemon SHALL validate capabilities on role create/update. `room.list_members` SHALL return `capabilities: string[]` for each member.

**Reference:** Multica `LoadAgentSkills` — agents have declared skill lists surfaced in the squad roster. WenzAgent `spawn_sub_agent_tool.dart` `_defaultToolNames` — explicit capability whitelist per sub-agent invocation.

**Well-known capability tokens (V1.1):**
```
chat, code.edit, code.review, file.read, file.write, terminal.run,
context.read, context.write, intervention.knock, task.delegate
```

Unknown tokens are rejected with 400 `{ error: "unknown_capability_token", token }`. The leader prompt includes a capabilities summary per teammate: `"@reviewer: code.review, context.read"`.

**Frontend:** Settings → Roles page shows a capability multi-select editor using the well-known token set. Members panel shows capability badges per agent.

#### Scenario: role.capabilities validated on create

- **WHEN** `POST /roles { capabilities: ["code.edit", "magic.power"] }`
- **THEN** 400 is returned with `{ error: "unknown_capability_token", token: "magic.power" }`; no role is created

#### Scenario: room.list_members returns capabilities

- **WHEN** the leader calls `room.list_members` in a team room
- **THEN** each member object includes `capabilities: string[]` derived from their role; the leader prompt surfaces these as `"@reviewer: code.review, context.read"`

#### Scenario: Capabilities editor in Settings → Roles

- **WHEN** the user opens Settings → Roles and edits a role
- **THEN** the capabilities field shows a multi-select with the well-known token set; unknown tokens cannot be added via the UI

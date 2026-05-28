# orchestrator (V1.0 delta)

## MODIFIED Requirements

### Requirement: Room MCP Tools

The system SHALL add `room.delegate` to the Room MCP Server tool list for V1.0 Squad/Team modes. All other existing tools remain unchanged.

新增工具（V1.0）：

| Tool | 描述 | 权限要求 |
|---|---|---|
| `room.delegate` | Leader 派发 Task 给 teammate（Squad/Team mode 专用）| role=leader |

`room.delegate` 完整规范见 `squad-mode/Squad 模式调度` Requirement。

#### Scenario: room.delegate 仅 leader 可调

- **WHEN** observer agent 调 `room.delegate`
- **THEN** 返回 `{ error: "delegate_requires_leader_role" }`；不创建 Task

### Requirement: V1.0 / V1.1 / V1.2 占位（Team / Squad / Board / DAG）

The system SHALL remove the Squad and Team mode placeholders from this requirement as they are now implemented in V1.0. War Room remains V1.5.

**V1.0 已实现**：`squad` mode（squad-mode capability）、`team` mode（team-mode capability）。

**仍为占位**：`war_room` mode（V1.5）；Task dependencies DAG 调度（V1.2 collab-visualization）；Task Board 拖拽（V1.1 task-board）。

#### Scenario: 创建 squad room

- **WHEN** `POST /rooms { mode: "squad", leaderRoleId: "project-manager", ... }`
- **THEN** daemon 创建 squad room，leaderRoleId 写入 `rooms.leader_role_id`
- **AND** **不**返回 501（V1.0 已实现）

#### Scenario: 创建 war_room 仍返回 501

- **WHEN** `POST /rooms { mode: "war_room", ... }`
- **THEN** 返回 501 + `{ error: "war_room mode is V1.5", capability: "v1-roadmap" }`

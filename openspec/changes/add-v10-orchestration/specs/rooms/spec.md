# rooms (V1.0 delta)

## MODIFIED Requirements

### Requirement: Room 数据模型

The system SHALL add `leader_role_id` to the rooms table for Squad/Team modes.

```sql
ALTER TABLE rooms ADD COLUMN leader_role_id TEXT;
-- 仅 mode IN ('squad', 'team') 时必填（应用层校验）
```

#### Scenario: 创建 squad room 需要 leaderRoleId

- **WHEN** `POST /rooms { mode: "squad" }` 不带 leaderRoleId
- **THEN** 返回 400 + `{ error: "squad_mode_requires_leader_role_id" }`

#### Scenario: 创建 solo room 不需要 leaderRoleId

- **WHEN** `POST /rooms { mode: "solo" }` 不带 leaderRoleId
- **THEN** 正常创建；`rooms.leader_role_id = NULL`

### Requirement: Post-MVP Mode 占位

The system SHALL implement `squad` and `team` modes in V1.0. `war_room` remains V1.5.

```ts
type RoomMode =
  | "solo"        // MVP
  | "assisted"    // MVP
  | "squad"       // V1.0：长期 Leader 路由
  | "team"        // V1.0：任务拆解派发
  | "war_room"    // V1.5：自由协作 + Leader 仲裁
```

#### Scenario: squad/team mode 不再返回 501

- **WHEN** `POST /rooms { mode: "squad", leaderRoleId: "project-manager", ... }`
- **THEN** 正常创建 squad room（V1.0 已实现）；**不**返回 501

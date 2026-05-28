# event-system (V1.0 delta)

## MODIFIED Requirements

### Requirement: 事件分级（durable / ephemeral）

The canonical event registry SHALL be extended with the following V1.0 event types. All new types MUST be registered in `packages/protocol/src/events/registry.ts` and validated by `events:check` / `visibility:check` CI before any V1.0 capability spec references them.

**V1.0 新增 durable events（18 个）**：

| 事件类型 | category | durability | visibility | 来源 capability | 备注 |
|---|---|---|---|---|---|
| `role.created` | role | durable | detail | role-system | Settings REST-only；不要求 projector handler |
| `role.updated` | role | durable | detail | role-system | Settings REST-only；不要求 projector handler |
| `role.deleted` | role | durable | detail | role-system | Settings REST-only；不要求 projector handler |
| `runtime.detected` | runtime | durable | detail | runtime-settings | Settings REST-only；不要求 projector handler |
| `runtime.updated` | runtime | durable | detail | runtime-settings | Settings REST-only；不要求 projector handler |
| `runtime.removed` | runtime | durable | detail | runtime-settings | Settings REST-only；不要求 projector handler |
| `model_config.created` | model | durable | detail | model-provider-settings | Settings REST-only；不要求 projector handler |
| `model_config.updated` | model | durable | detail | model-provider-settings | Settings REST-only；不要求 projector handler |
| `model_config.deleted` | model | durable | detail | model-provider-settings | Settings REST-only；不要求 projector handler |
| `agent_binding.created` | binding | durable | detail | agents（MODIFIED） | Settings REST-only；不要求 projector handler |
| `agent_binding.updated` | binding | durable | detail | agents | Settings REST-only；不要求 projector handler |
| `agent_binding.removed` | binding | durable | detail | agents | Settings REST-only；不要求 projector handler |
| `task.activity.added` | task | durable | both | task-workflow-core | 需要 projector handler（Task detail + Side Panel Tasks tab）|
| `task.delegation.created` | task | durable | both | team-mode + squad-mode | 需要 projector handler（主流 brief + Run Detail Tools）|
| `task.delegation.completed` | task | durable | both | squad-mode + team-mode | 需要 projector handler |
| `team.dispatch.started` | team | durable | both | team-mode + squad-mode | 需要 projector handler（主流 brief）|
| `team.dispatch.completed` | team | durable | both | team-mode + squad-mode | 需要 projector handler |
| `permission.run_summary` | permission | durable | detail | permissions（V1.0 D8）| Run Detail Permissions tab；不要求 main projector handler |

**V1.0 明确不引入的事件类型**（防止 spec agent 误加）：

- `task.updated`：状态变化走 `task.status.changed`（V0 已注册），非状态型活动走 `task.activity.added`
- `task.deleted`：删除走 `task.status.changed { nextStatus: "cancelled" }`
- `role.generation.delta` / `role.generation.completed` / `role.generation.failed`：role 生成走 REST job polling，不进 EventBus
- `runtime.test.result` / `model_config.test.result`：test 操作结果走 REST response / job polling，不进 EventBus

**projector 要求汇总**：

- visibility=both 的 V1.0 新事件（`task.activity.added` / `task.delegation.*` / `team.dispatch.*`）：**必须**在 `apps/web/src/hooks/useProjector.ts` 加 handler
- visibility=detail 的 V1.0 新事件（role / runtime / model_config / agent_binding / permission.run_summary）：**不要求** projector handler；Settings UI 通过 REST 消费；Debug Panel 通过 `/debug/events` 查询

#### Scenario: events:check 校验 18 个新事件类型

- **WHEN** 开发者在代码中 emit 任何 V1.0 新事件（如 `role.created`、`task.activity.added`）
- **THEN** `pnpm events:check` 通过（事件类型已在 registry 注册）
- **AND** `pnpm visibility:check` 通过（visibility 字段与 registry 一致）

#### Scenario: task.updated 被拒绝

- **WHEN** 开发者尝试 emit `task.updated` 事件
- **THEN** `pnpm events:check` 失败，报 `event type 'task.updated' not found in event-system canonical registry`
- **AND** 开发者应改用 `task.status.changed`（状态变化）或 `task.activity.added`（非状态型活动）

#### Scenario: role.created 不触发 projector

- **WHEN** daemon emit `role.created`（visibility=detail）
- **THEN** SSE `?view=main` 不推送该事件（detail 不进 main 流）
- **AND** Settings UI 不订阅 SSE，通过 `GET /roles` REST 拉取最新列表
- **AND** Debug Panel 通过 `/debug/events?type=role.created` 或 Event Store audit query 可查到该事件；Run Detail **不**通过 Settings CRUD SSE 实时同步

#### Scenario: task.activity.added 触发 projector

- **WHEN** daemon emit `task.activity.added`（visibility=both）
- **THEN** SSE `?view=main` 推送该事件
- **AND** `useProjector.ts` 的 `task.activity.added` handler 更新 Task detail view model
- **AND** Side Panel Tasks tab 实时显示新活动条目

# messaging (V1.0 delta)

## MODIFIED Requirements

### Requirement: Card 类型清单

The system SHALL add `TaskStatusCard` to the card type list for V1.0 Squad/Team mode dispatch notifications.

新增 Card 类型（V1.0）：

| Card 类型 | visibility | 描述 |
|---|---|---|
| `TaskStatusCard` | main | Leader 派发 / Task review 通知；显示 task title + assignee role + status + "查看 Task" 链接 |

`TaskCard` 升级（V1.0）：可显示 Task 树（child tasks + 状态 + activity 摘要）。

#### Scenario: Leader 派发后主流显示 TaskStatusCard

- **WHEN** Leader 调 `room.delegate` 创建 Task，emit `task.delegation.created`（visibility=both）
- **THEN** 主流显示 TaskStatusCard：`"<leader_name> dispatched '<task_title>' to <assignee_role_name>"`
- **AND** 点击"查看 Task"打开 Task detail slide-over

#### Scenario: 所有子 Task 进 review 后主流显示 TaskStatusCard

- **WHEN** Team Mode 所有子 Task 进 review，emit `team.dispatch.started`（visibility=both）
- **THEN** 主流显示 TaskStatusCard：`"<N> tasks ready for review"`
- **AND** 点击"查看 Task"打开 Side Panel Tasks tab

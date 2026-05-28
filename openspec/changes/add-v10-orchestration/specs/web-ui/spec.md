# web-ui (V1.0 delta)

## MODIFIED Requirements

### Requirement: Side Panel 视图

The Side Panel SHALL add a Tasks tab as a real implementation (V0.5 was a placeholder).

| Tab | 数据源 | 主要交互 |
|---|---|---|
| Context | ContextLedger via SSE projector | 看 ContextItem 列表、confirm/discard draft |
| **Tasks（V1.0 真实现）** | tasks 表 via SSE projector | 看 Task 列表（按 status 分组）、Task detail slide-over、activity timeline |
| Members | room_participants + AgentPresence | 看 Room 成员 + presence dot |
| Debug | events 表 via /debug/events | 过滤、回放（admin scope）|
| Cost | cost-panel-local API | 看 cost 聚合（V0.5 已实现）|

**Tasks tab 布局**（参考 multica `packages/views/issues/components/`）：

- 列表 view，按 status 分组（Backlog / In Progress / Blocked / Review / Done）；
- 每行：priority chip + title + assignee role avatar + status badge；
- 点击 Task 打开 detail slide-over（含 activity timeline）；
- **不做**拖拽（V1.1）。

#### Scenario: Tasks tab 实时更新

- **WHEN** Leader 调 `room.delegate` 创建新 Task，emit `task.delegation.created`（visibility=both）
- **THEN** Side Panel Tasks tab 实时显示新 Task（projector 收到事件后更新 view model）

### Requirement: Main Timeline 与 Agent Run Detail 双视图

The Run Detail Tools tab SHALL display multi-agent collaboration view for Squad/Team modes.

**V1.0 新增**：Run Detail Tools tab 在 squad/team mode 下额外显示：

- **Sibling Run 链路**：本 Run 的 wakeReason='delegated_task' 时，显示 parent Run（dispatch 自己的 Leader Run）+ sibling Run（同 Leader 派发的其他 teammate Run）；点击跳到 sibling Run Detail。
- **Task 树**：本 Run 关联的 Task + 子 Task（按 parent_task_id 树形展开），状态用 colored chip 表示。

#### Scenario: Run Detail 显示 Task 树

- **WHEN** 用户打开 teammate Run 的 Run Detail
- **THEN** Tools tab 显示该 Run 关联的 Task（含 parent Task + sibling Tasks）
- **AND** 点击 Task 打开 Task detail slide-over

### Requirement: 三栏布局

The FeatureRail SHALL add a Settings entry point.

**V1.0 新增**：FeatureRail 加 Settings 图标（齿轮）；点击打开 Settings modal（详见 settings-ui capability）。

#### Scenario: FeatureRail Settings 入口

- **WHEN** 用户点 FeatureRail 的 Settings 图标
- **THEN** Settings modal 打开，默认显示 Roles tab

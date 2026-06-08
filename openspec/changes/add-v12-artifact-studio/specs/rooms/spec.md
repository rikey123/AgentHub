# rooms Specification

## Purpose

V1.2 扩展房间列表、模式展示和联系人优先的新建对话流程，同时保持现有协议兼容。

## MODIFIED Requirements

### Requirement: Room 列表与归档

The room list SHALL support V1.2 search, pin, archive visibility, and participant contact-name display.

`RoomViewModel` 新增：
- `pinnedAt`
- `lastActivityAt`
- `archivedAt`
- `participantContactNames`

RoomList 行为：
- 默认排序：`pinnedAt DESC` 优先，再 `lastActivityAt DESC`
- 搜索框 debounce 200ms 调 `GET /rooms?q=`
- 搜索范围：room title、participant contact names、最近消息
- archived rooms 不在主列表，但必须有折叠入口查看
- 归档继续复用 `room.closed` / `room.opened`

#### Scenario: RoomList 搜索无需刷新

- **WHEN** 用户输入搜索词匹配某个 participant contact name
- **THEN** RoomList 实时只显示匹配房间
- **AND** 清空搜索后立即恢复完整排序列表

---

### Requirement: Solo Mode 行为

V1.2 UI SHALL expose `Solo` as a primary mode choice for single-agent direct execution.

`Solo` 语义：
- 1v1
- 单 agent 执行
- 无 selector 群聊轮替
- 无 team task dispatch

#### Scenario: 单联系人默认可选 Solo

- **WHEN** 用户在 New Chat 选择一个联系人
- **THEN** 模式选择中至少显示 `Solo` 和 `Assisted`

---

### Requirement: Assisted Mode 行为

V1.2 SHALL present `Assisted` as the primary multi-agent discussion / selector mode.

Assisted 前端呈现要求：
- 更像群聊讨论
- 多 agent 可轮流发言
- 适合 brainstorm / 协作生成
- `@AgentName` autocomplete 同时搜索 room participants + contacts

#### Scenario: 多人默认可选 Assisted

- **WHEN** 用户在 New Chat 选择多个联系人
- **THEN** 模式选择中显示 `Assisted` 作为主选项之一

---

### Requirement: Post-MVP Mode 占位

V1.2 UI SHALL expose `Solo` / `Assisted` / `Team` as primary choices. `Squad` MAY remain supported internally and MAY appear only under Advanced as a lightweight Team preset.

现有 `squad` 协议和迁移兼容 MUST 保留，不得删除。

#### Scenario: Squad 仅在 Advanced 中出现

- **WHEN** 用户打开 New Chat 的 Advanced Configuration
- **THEN** 可以看到 `Squad` 作为兼容模式或 lightweight Team preset
- **AND** 默认主模式按钮只显示 Solo / Assisted / Team

# web-ui (V0.5 delta)

## ADDED Requirements

### Requirement: 主题与密度系统

The Web UI SHALL support light/dark theme switching and cozy/compact density via CSS variables, with no full design system library introduced (推迟 V1.4)。

**主题（Theme）**：

- 三档：`light` / `dark` / `auto`（auto 跟系统 `prefers-color-scheme`）；
- 实现：根 `<html data-theme="light|dark">`（auto 时由 JS 在 mount 时根据 media query 写入实际值，并监听变化）；
- 偏好存 localStorage `agenthub.theme`；
- 全部颜色 token 改用 CSS variables：`--ah-bg-primary` / `--ah-bg-elevated` / `--ah-text-primary` / `--ah-text-secondary` / `--ah-text-muted` / `--ah-border` / `--ah-accent` / `--ah-danger` / `--ah-success` / `--ah-warning`；
- 不接 Tailwind / shadcn / styled-components；保持现有 vanilla CSS 文件路径。

**密度（Density）**：

- 两档：`cozy`（默认，间距大）/ `compact`（间距紧凑）；
- 实现：根 `<html data-density="cozy|compact">`；
- 偏好存 localStorage `agenthub.density`；
- 间距 / 字号 token：`--ah-space-1..8` / `--ah-font-size-xs..xl` / `--ah-line-height-tight..loose`；
- compact 模式下 `--ah-space-*` 缩放约 0.75x，`--ah-font-size-*` 不变。

**切换入口**：Settings 视图 + 命令面板（Cmd+K → "Switch theme" / "Switch density"）。

#### Scenario: 切换暗色主题

- **WHEN** 用户在 settings 选 dark
- **THEN** `<html data-theme="dark">`，所有组件颜色按 dark token 重渲染（无闪屏，CSS variables 即时生效）
- **AND** localStorage `agenthub.theme=dark` 持久化

#### Scenario: auto 跟系统切换

- **WHEN** 用户选 auto，系统从 light 切到 dark
- **THEN** UI 自动跟随，无需刷新页面
- **AND** localStorage 仍存 `auto`（不存 light/dark）

#### Scenario: compact 密度生效

- **WHEN** 用户切 compact
- **THEN** `<html data-density="compact">`，消息流间距缩小约 25%，密度档位影响 chat / list / card 全部组件

### Requirement: 键盘流第一轮收口

The Web UI SHALL provide keyboard navigation for primary chatroom actions including a command palette, message stream navigation, input box mention completion, and global shortcuts.

**命令面板**（`Cmd/Ctrl+K`）：

- 候选：所有 Room（按 unread / activity 排序）+ 切 agent（在当前 Room 内）+ 跳 Run（最近 N 个）+ 切主题 / 密度 / 工具操作（"Reload agents"/"Cancel current run"）；
- 渲染：纯 React + 现有 `react-hotkeys-hook` 库；候选 ≥ 20 时虚拟化（共用 TanStack Virtual，详见 性能 Requirement）；
- 快捷键：上下方向键导航，Enter 选中，Esc 关闭；
- **不引入** cmdk 库；保持轻量。

**消息流键盘**：

- `j` / `k`：向下 / 向上选中下一条 / 上一条消息（视觉高亮，virtualized list 自动滚动到可见）；
- `r`：当当前选中消息属于活跃 Run，打开该 Run 的 Detail slide-over；
- `Enter`：当选中消息含 brief，进入对应 Run Detail；
- `Esc`：关闭 Run Detail / 关闭命令面板 / 取消当前 modal。

**输入框键盘**：

- `Tab` / `Shift+Tab`：在 @ 候选列表上下切；
- `Enter`：选中 @ 候选；
- `Shift+Enter`：换行；
- `Cmd/Ctrl+Enter`：发送。

**全局快捷键**：

- `?`：显示 keymap cheat sheet（modal）；
- `g r`（连按）：跳到 Room 列表；
- `g d`（连按）：跳到 Debug Panel（admin scope only）。

#### Scenario: 命令面板搜索 Room

- **WHEN** 用户按 Cmd+K 输入 "auth"
- **THEN** 候选列表显示所有 title 含 "auth" 的 Room（fuzzy match），上下键选中，Enter 切到该 Room

#### Scenario: j/k 切消息

- **WHEN** 用户在消息流按 `j` 三次
- **THEN** 视觉高亮向下移动 3 条，virtualized list 自动滚动保持高亮在视口内

#### Scenario: Esc 关闭 Run Detail

- **WHEN** Run Detail slide-over 打开，用户按 Esc
- **THEN** slide-over 关闭，URL 移除 `?run=...`，焦点回到主流上次选中位置

#### Scenario: ? 显示 keymap

- **WHEN** 用户按 `?`（输入框无焦点时）
- **THEN** 弹 keymap cheat sheet modal 列出所有快捷键

### Requirement: a11y AA 基线

The Web UI SHALL meet WCAG 2.1 Level AA baseline including keyboard accessibility, ARIA labels, contrast ratios, and reduced-motion support. AAA 与完整屏幕阅读器手动测试推迟到 V1.4。

**键盘可达**：

- 所有可点击元素 `tabIndex` 合理（按视觉顺序）；
- 必须有可见 focus 反馈（`outline` 或 `box-shadow`，主题切换时各自适配）；
- modal / dropdown 打开时焦点 trap（Esc 退出后焦点回触发元素）。

**ARIA**：

- 所有 icon-only button 加 `aria-label`；
- 状态徽章 / connection status / typing indicator 加 `aria-live="polite"`；
- 输入框 placeholder 不替代 `aria-label`。

**对比度**：

- 文本 / 主要 UI 元素与背景对比度 ≥ 4.5:1；亮 / 暗主题各自满足；
- M0 依赖 HeroUI v3 oklch token 阶梯保障 AA；自动化 `axe-core` CI 推到 V1.0 a11y 闭环（届时跑 Room / Run Detail / Settings）。

**减少动画**：

- `@media (prefers-reduced-motion: reduce)` 时所有过渡 / slide-over / fade 退化为瞬时切换；
- progress / spinner 类（必要的视觉反馈）保留但减速到 ≥ 1s 周期。

**i18n**：M0 全英文；UI 字符串就近内联，不抽 `apps/web/src/i18n/en.ts`（推到 V1.4 中文化前再做集中化）。

#### Scenario: 键盘 Tab 走完主流程

- **WHEN** 用户从输入框 Tab 到发送按钮再 Tab 到主流第一条消息
- **THEN** 焦点按视觉顺序流转，每个停留点都有可见 focus 反馈

#### Scenario: 暗色主题对比度

- **WHEN** 暗色主题渲染主流消息文本与背景
- **THEN** HeroUI v3 oklch token（`--foreground` / `--background`）下对比度 ≥ 4.5:1；自动化 axe-core 校验推到 V1.0。

#### Scenario: prefers-reduced-motion 退化

- **WHEN** 系统设置启用 reduce motion
- **THEN** Run Detail slide-over 立刻弹出（无 250ms 缓动），消息进入无 fade-in

### Requirement: 性能基线（虚拟化 + 60fps batch + 骨架屏）

The Web UI SHALL meet performance targets via message stream virtualization, delta event 60fps coalescing, skeleton loading states, and lazy image loading. **V0.5 落实 MVP §14.6 + §14.7 缺的两项**。

**消息流虚拟化**：

- 用 `@tanstack/react-virtual`（V0.5 新增依赖），单 Room ≥ 50 条消息启用；
- 估算高度（含 Card 类型）+ 实际测量 fallback；
- 2x viewport overscan 保证滚动平滑。

**Delta 60fps batch**：

- `useProjector` 在 1 帧（约 16ms）内 coalesce 多个同 messageId 的 `message.part.delta` 事件，单次 setState；
- 实现：`requestAnimationFrame` schedule 一次 flush；
- coalesce 期间 deltas 用 string concat 合并，不丢内容。

**骨架屏**：

- Room 切换 / 首次加载 / Run Detail 加载时显示 skeleton（pulse 动画，受 reduced-motion 影响）；
- skeleton 占位至少展示预估的 message 数量（基于已知 lastMessageId 时长 / 平均消息高度）；
- 加载超过 5s 自动展示 timeout banner（"加载较慢，请检查 daemon 连接"）。

**图懒加载**：

- 消息附件 `<img>` 默认 `loading="lazy"` + `decoding="async"`；
- IntersectionObserver 预触发缩略图（避免可见时仍闪白）。

**性能预算**：

- 初次进 Room（10k 历史消息）首屏渲染 ≤ 500ms（在 M1 Mac 标准机）；
- Delta 流入 100/s 时主线程 frame 时间 ≤ 16ms（不掉帧）；
- 切 Room 总耗时 ≤ 200ms（含网络 + 渲染）。

**V0.5 验收说明**：上述预算以 M1 Mac 为参考机。CI 环境（Windows/Linux x86）运行 `apps/web/e2e/perf.spec.ts` 作为 smoke 验证（放宽 10x 断言），确认虚拟化和 60fps batch 路径可达；M1 Mac 上的完整 10k 验收在 V1.0 前正式复核。

#### Scenario: 10k 消息流畅滚动

- **WHEN** 用户在 10k 消息历史的 Room 中滚动
- **THEN** 虚拟化渲染保证内存中 DOM 节点 ≤ 100 条；滚动 fps ≥ 60

#### Scenario: 100/s delta 不掉帧

- **WHEN** Run 输出 100 token/s 的 message.part.delta
- **THEN** UI 主线程 frame ≤ 16ms；用户可见消息流畅增长

#### Scenario: 首次加载显骨架屏

- **WHEN** 用户首次进一个 Room
- **THEN** 立即显示 skeleton（5-10 条预估占位）；数据返回后骨架被实际消息替换；无白屏闪烁

### Requirement: Cost 面板视图

The Web UI SHALL provide a Cost panel view in the Side Panel that aggregates per-run cost data and displays totals grouped by agent / model / day. 该视图消费 `cost-panel-local` capability 提供的 `GET /workspaces/:id/cost-summary` API。

**布局**：

- Side Panel 第 5 个 tab "Cost"（位于 Context / Tasks / Members / Debug 之后）；
- 顶部时间窗口选择器：默认"最近 7 天"（V05-D6 采纳），可选"今日 / 7 天 / 30 天 / 自定义"；
- 主体：分组按钮组 `agent | model | day`（默认 agent）；
- 中央：堆叠柱状图（X 轴 = 选中分组，Y 轴 = 累计 USD）+ 列表（每行：分组键 + 总 cost USD + token 数 + run 数）；
- 底部：Workspace 总计（cost / runs / 模型 token 加总）。

**交互**：

- 切分组时实时查询（防抖 300ms）；
- 列表行点击跳到 Debug Panel `/debug/events?type=agent.run.completed&agentId=<x>` 过滤视图（如查具体 Run）；
- 不区分用户（D32 红线）；UI 不显示用户列。

**性能**：

- 单次查询 < 100ms（< 10 万 Run 数据量内）；
- 无聚合 / 预算告警（V1.5 才做）。

#### Scenario: 默认看 7 天 / 按 agent 分组

- **WHEN** 用户首次打开 Cost tab
- **THEN** 时间窗口 = 最近 7 天，分组 = agent；调 `GET /workspaces/:id/cost-summary?from=<7d_ago>&to=<now>&groupBy=agent`
- **AND** 主体显示按 agent 累计 cost 的堆叠柱状图 + 列表

#### Scenario: 切到 model 分组

- **WHEN** 用户点 "model" 按钮
- **THEN** 实时调 `?groupBy=model`，主体重渲染（< 300ms 防抖窗口后）

#### Scenario: 跳到 Debug Panel

- **WHEN** 用户点列表行 "claude-code-builder $0.42"
- **THEN** 路由跳 Debug Panel，自动过滤 `type=agent.run.completed AND agentId=claude-code-builder`

#### Scenario: 空数据状态

- **WHEN** workspace 7 天内无 Run
- **THEN** 主体显示空状态 illustration + "暂无 cost 数据" + "试试创建一个 Run"

### Requirement: PendingTurn 操作面板

The Web UI SHALL render a PendingTurn list above the input box (when ≥ 1 pending turn exists) showing each queued turn with cancel / edit actions, and persist edit drafts in sessionStorage.

**布局**：

- 仅当当前 Room 有 ≥ 1 `pending_turns.status='queued'` 时显示；
- 位置：输入框正上方；
- 每行：`#<排队位置> "<消息内容前 60 字>"` + cancel button + edit button + enqueuedAt 时间；
- 顶部 banner（如果总数 ≥ 15）："队列即将达上限（20）"。

**交互**：

- Cancel：弹 confirm modal（"确定取消？此操作不可撤销"）→ DELETE `/pending-turns/:id`；
- Edit：把消息文本载入输入框（替换当前草稿）+ 在输入框上方显示"编辑中：m_X"提示；用户改完发送 → PATCH `/messages/:id`；
- Edit 期间用户切走（关 tab、切 Room）→ sessionStorage 存 `agenthub.draft.<roomId>` 含 `{ editingMessageId, text }`；下次回来恢复；
- Edit 提交成功 → 清 sessionStorage；
- Edit 失败（如已 scheduled）→ 显示错误 banner + 保留草稿。

**键盘**：

- 输入框焦点时按 `↑`：聚焦最近一条 PendingTurn 的 edit 按钮（与 Slack 行为一致）；
- 焦点在 PendingTurn 行时 `Backspace` / `Delete`：触发 cancel confirm。

#### Scenario: 三条 pending turns 显示

- **WHEN** 用户在 busy 时连发 3 条消息
- **THEN** PendingTurnList 显示 3 行，每行带 cancel / edit 按钮；输入框仍可继续发第 4 条

#### Scenario: 编辑保留草稿

- **WHEN** 用户点 m_3 的 edit，输入框显示 "正在改..."，没发就关 tab
- **THEN** sessionStorage 存草稿
- **AND** 下次打开同 Room，输入框自动恢复 "正在改..." + "编辑 m_3 中" 提示

#### Scenario: 编辑已 scheduled 消息

- **WHEN** 用户点 m_3 的 edit，但 m_3 已经 status=scheduled（即将被消费）
- **THEN** PATCH 返回 409，UI 显示 "此消息已开始处理，无法编辑" + 保留草稿在输入框

### Requirement: 终端 Artifact 渲染（PTY 输出）

The Web UI SHALL render terminal artifact PTY output in the chat stream and Run Detail Tools tab using a virtualized log viewer. MVP §11.6 已存数据，V0.5 补 UI 渲染。

**主流 TerminalCard**：

- 显示前 10 行 + "展开" 按钮（避免巨型 log 占主流）；
- 等宽字体、彩色 ANSI 转 HTML（用 `ansi-to-html` 库，V0.5 新增依赖）；
- 折叠时显示 stdout 行数 + stderr 行数计数；
- 失败状态（exit code != 0）红色边框 + 显示 exit code。

**展开视图**：

- 全屏 modal 或 slide-over；
- 虚拟化 log viewer（共用 TanStack Virtual）；
- 搜索框（Ctrl+F），支持 regex；
- 复制按钮（拷贝纯文本）；
- 自动滚到底部（除非用户手动向上滚）。

**Run Detail Tools tab**：

- 每个 terminal artifact 在该 tab 显示完整输出（不折叠）；
- 时间轴形式按 createdAt 排序。

#### Scenario: TerminalCard 主流折叠

- **WHEN** Agent 跑 npm test 输出 200 行 stdout，artifact `type=terminal` 创建
- **THEN** 主流 TerminalCard 显示前 10 行 + "展开剩余 190 行" 按钮
- **AND** stderr 行数显示在 footer

#### Scenario: 展开看完整 log

- **WHEN** 用户点"展开"
- **THEN** 弹全屏 modal，虚拟化渲染 200 行；自动滚到底；用户向上滚 → 锁定位置

#### Scenario: ANSI 颜色渲染

- **WHEN** Agent 输出含 `\x1b[31mError\x1b[0m`
- **THEN** TerminalCard 渲染 "Error" 红色文本

## MODIFIED Requirements

### Requirement: 输入框

The input box SHALL support markdown preview, drag-drop attachments, message quoting, and `@` mention completion. **V0.5 落实 @ 自动补全 + drag-drop + 引用**（MVP §14.12 PARTIAL，仅 markdown preview 已有）。

**功能集**：

1. **markdown preview**：原 `showPreview` toggle 保留，预览渲染同主流消息样式（共用 MessagePart 渲染）。
2. **drag-drop 附件**：用户拖拽文件进输入框 → 调 `POST /attachments`（multipart）→ 返回 fileId 后插入 AttachmentPart 到当前草稿；最多 50 个，单文件 ≤ 50MB（受 daemon 限）。
3. **引用消息**：点击主流消息的"引用"按钮（或键盘 `q`）→ 输入框上方插入引用块 `> @<sender>: <quoted text>` + `quotedMessageId` 隐含传入 POST 请求；引用块可单独删除。
4. **@ 自动补全**：用户输入 `@` 时弹 `RoomMembersPopover`：
   - 候选源：`RoomViewModel.members`（已订阅 `room.member.*` events）
   - 匹配：display name / agentId / role 三字段子串匹配（不区分大小写）
   - 显示：avatar + name + role badge + 在线状态（presence dot）
   - 选中：插入 `@<displayName>` 到光标位置 + 隐含 `mentions: [agentId]` 写入 part payload
   - 多 @：按选中顺序追加到 mentions 数组
   - 候选 > 20 时虚拟化（共用 TanStack Virtual）
   - 关闭：Esc / 点击外部 / 输入空格不接 agent 名
5. **键盘**：详见 `键盘流第一轮收口` Requirement。

**实现**：用现有依赖 + `@floating-ui/react`（V0.5 新增，做 Popover 定位），不引入完整富文本编辑器（保持 contentEditable / textarea + custom rendering）。

#### Scenario: @ 触发补全

- **WHEN** 用户输入 `@`
- **THEN** 输入框上方弹 popover 显示 Room 全部成员候选列表

#### Scenario: 模糊匹配

- **WHEN** 用户输入 `@sec`
- **THEN** 候选过滤为 name / id 含 "sec" 的 agents（如 `security-reviewer`）

#### Scenario: 选中插入

- **WHEN** 用户选中 `security-reviewer`
- **THEN** 输入框文本变 `@security-reviewer ` + 光标在空格后；POST 时 mentions=`["security-reviewer"]`

#### Scenario: 多 @ 顺序

- **WHEN** 用户输入 `@security 看下 @reviewer 也`
- **THEN** mentions=`["security", "reviewer"]`（按出现顺序）

#### Scenario: drag-drop 上传

- **WHEN** 用户拖一个 PDF 进输入框
- **THEN** 自动 POST /attachments → 返回 fileId → 输入框附加 AttachmentPart preview（icon + 文件名 + size）

#### Scenario: 引用消息

- **WHEN** 用户在主流按 `q` 选中 m_42
- **THEN** 输入框上方插入引用块（含 m_42 sender + 前 100 字截断）；用户输入正文回车 → POST 时 quotedMessageId=m_42

### Requirement: Side Panel 视图

The right-side panel SHALL provide tabs for Context / Tasks / Members / Debug / **Cost (V0.5 新增)** views. 共 5 tabs。

每个 tab 加载策略：lazy（首次切到时加载），切换不卸载（保留 view state）。

| Tab | 数据源 | 主要交互 |
|---|---|---|
| Context | ContextLedger via SSE projector | 看 ContextItem 列表、confirm/discard draft、查看 conflict |
| Tasks | tasks 表 via SSE projector | 看 Task 列表、状态切换、创建 Task |
| Members | room_participants + AgentPresence | 看 Room 成员 + presence dot |
| Debug | events 表 via /debug/events | 过滤、回放、看 raw log（admin scope） |
| **Cost** | `cost-panel-local` API | 看 cost 聚合，详见 `Cost 面板视图` Requirement |

#### Scenario: 默认 Context tab

- **WHEN** 用户首次打开 Side Panel
- **THEN** 默认显示 Context tab；其他 tab 未加载（lazy）

#### Scenario: 切到 Cost tab

- **WHEN** 用户点 Cost tab
- **THEN** 调 cost-summary API、渲染 Cost 面板（详见对应 Requirement）

### Requirement: 错误与重连

The Web UI SHALL handle SSE disconnections gracefully and display a non-intrusive reconnect banner; in offline mode, mutating actions SHALL be disabled. **V0.5 落实视觉收口**（MVP 是裸 `Reconnecting...` 文本）。

**重连状态**：

- `connecting` / `connected` / `reconnecting` / `offline`；
- 顶部 banner（高度 32px）显示当前状态，带 icon + 文字 + 进度条（reconnecting 时）；
- `connected` 时 banner 隐藏（仅在变化时短暂显示成功提示 1s）；
- `offline`（连续 3 次重连失败）时 banner 红色 + "查看故障排除" 链接 + 输入框 disabled。

**重连策略**：

- 指数退避（1s / 2s / 4s / 8s / 30s 上限）；
- 用 `Last-Event-ID` 头 / `cursor` 查询参数恢复（与 MVP 一致）；
- 重连成功后 banner 显示 1s "已恢复"绿色提示后隐藏。

**离线只读防误触**：

- 输入框 disabled + 显示 "离线模式，输入暂停"；
- 所有 mutating 按钮（regenerate / pin / cancel pending / apply diff）disabled，hover 提示 "需要在线连接"；
- 已渲染消息可正常浏览。

#### Scenario: 短暂断网

- **WHEN** SSE 断开 1 秒后恢复
- **THEN** banner 显示 "Reconnecting..." 1 秒后变 "已恢复" 绿色 1 秒后隐藏

#### Scenario: 持续离线

- **WHEN** SSE 连续 3 次重连失败
- **THEN** banner 红色 "Offline - check daemon connection" + 输入框 disabled
- **AND** 主流仍可滚动浏览历史消息

#### Scenario: 离线下点击 mutating 按钮

- **WHEN** offline 状态用户点 "regenerate"
- **THEN** 按钮 disabled 不响应；hover 提示 "Needs online connection"

### Requirement: Main Timeline 与 Agent Run Detail 双视图

The Web UI SHALL render Main Timeline (default chat view) and Run Detail (slide-over) as two distinct views consuming different SSE subscriptions, per `messaging/主流摘要 / Agent Run Detail 双投影`. **V0.5 落实 7-tab 真信息**（MVP 5 个 E2E 已通过 tab 结构，V0.5 补内容）。

Run Detail slide-over 7 tabs：

| Tab | 内容 | V0 状态 | V0.5 改进 |
|---|---|---|---|
| Transcript | AdapterMessage[] 完整对话 | DONE | 加 PreCompact summary 高亮（来自 ContextItem.summary draft） |
| Tools | tool.call.requested/completed 时间轴 + SubagentStart/Stop | DONE 但缺 subagent | V0.5 接入 subagent.* 事件 |
| Context | Run 启动时的 context projection + 期间 context.item.* 变化 | DONE | 加 PreCompact 触发的 summary draft 显式标注 |
| Permissions | permission.requested/resolved 历史 | DONE | 无改 |
| Artifacts | artifact.diff.created / file / terminal / preview | DONE 但 terminal 缺 PTY 渲染 | V0.5 接入 TerminalCard 渲染 |
| Raw Stream | adapter.raw.stdout/stderr live | DONE（admin scope） | 无改 |
| Cost | 该 Run 的 cost / token 详情 | 显示字段（V0 §15.6 完成） | 加横向对比"同 agent 同期 Run 平均"（消费 cost-panel-local API） |

slide-over 进入：URL 加 `?run=<id>` + `view=detail` SSE 订阅；关闭：移除 URL + Esc 键 + 点外部。

#### Scenario: 进 Run Detail 看 7 tabs

- **WHEN** 用户点主流某 brief
- **THEN** Run Detail slide-over 打开，URL 加 `?run=<id>`，建立 view=detail SSE，7 tabs 全部可见可切换

#### Scenario: Transcript 看 PreCompact summary

- **WHEN** Run 中触发过 PreCompact
- **THEN** Transcript tab 显示原对话 + summary draft 横幅（标注"会话已压缩，可在 Context tab 确认"）

#### Scenario: Tools 看 subagent

- **WHEN** Claude 在 Run 内 spawn 一个 subagent
- **THEN** Tools tab 显示 subagent 时间轴节点（subagent.started / completed），含 cost / duration

#### Scenario: Cost tab 看横向对比

- **WHEN** 用户进 Run Detail Cost tab
- **THEN** 显示该 Run cost + "同 agent 同期 Run 平均 cost" 对比线（来自 cost-panel-local API）

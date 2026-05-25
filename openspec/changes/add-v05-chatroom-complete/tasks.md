# tasks: add-v05-chatroom-complete

> V0.5 多 Agent 聊天室完整化实施清单。每条 task 引用具体 spec capability + requirement，便于验收。
> **格式**：`- [x] N.M Task — refs: <capability>/<Requirement 名>`
> **里程碑**：M0 基础设施 → M1 OpenCode + Run Detail → M2 聊天室体验 → M3 前端打磨 → M4 Cost + CLI → M5 收尾验收

## 0. 基础设施（Migration + Event Registry + BriefGenerator 接口）

- [x] 0.1 写 migration `0012_v05.sql`：`messages.brief_published_at` / `mailbox_messages.delivery_failure_reason` + `attempt_count` / `agent_profiles` 5 列 / `idx_messages_room_created_desc` / `idx_runs_workspace_ended` — refs: design/Migration Plan
- [x] 0.2 在 `packages/protocol/src/events/registry.ts` 注册 4 个 V0.5 新事件：`agent.profile.removed`（durable/detail）/ `agent.profile.error`（ephemeral/detail）/ `mailbox.delivery.failed`（durable/both）/ `artifact.diff.detected`（ephemeral/detail）— refs: event-system/事件分级（durable / ephemeral）
- [x] 0.3 实现 `BriefGenerator` 接口 + `HeuristicBriefGenerator`（首句截断 120 字符 + artifact 统计后缀 + 失败/取消模板）— refs: context-ledger/BriefGenerator 接口（V0.5 启发式 / V1.2 LLM）
- [x] 0.4 扩展 `RunLifecycleService.complete/fail/cancelFinalized` 接受可选 `briefText` 参数，同事务发 `message.brief.published` + 更新 `messages.brief_published_at` — refs: bus-runtime/RunLifecycleService 是 runs 表的唯一写入口
- [x] 0.5 更新 `pnpm events:check` + `pnpm visibility:check` 通过（新事件类型已注册）— refs: event-system/events:check 与 visibility:check CI 校验
- [x] 0.6 单元测试：HeuristicBriefGenerator 覆盖首句截断 / 中英文标点 / 代码块跳过 / 失败模板 / 取消模板 / 解析失败退化 / artifact 统计后缀

## 1. OpenCodeACPAdapter 真实现

- [x] 1.1 调研 OpenCode ACP bridge npm package（V05-1 开工前调研）：确认 package 名 + 版本 + ACP 协议兼容性；记录到 design.md V05-1 — refs: design/V05-D1
- [x] 1.2 在 `packages/adapters/opencode/src/index.ts` 实现 `OpenCodeACPAdapter extends ACPAdapter`：覆盖 `spawnArgs() / detect() / mapProviderEvent() / mapProviderError()`；状态机 / pending 表 / line-splitter / cancel / dispose 全部继承基类 — refs: adapter-framework/OpenCodeACPAdapter 真实现
- [x] 1.3 实现 `detect()`：macOS/Linux `bash -lc 'command -v opencode'` + Windows `where opencode`；返回 `[{ id, binary, version }]` 或 `[]` — refs: adapter-framework/OpenCodeACPAdapter 真实现
- [x] 1.4 实现 `attachSession(input)`（crashRecovery=resumable 必须实现）；CI manifest 一致性校验通过 — refs: adapter-framework/OpenCodeACPAdapter 真实现
- [x] 1.5 实现 `mapProviderEvent()`：把 OpenCode native events 映射成 `AcpProviderEvent`（参考 ClaudeCodeAdapter 映射表）— refs: adapter-framework/OpenCodeACPAdapter 真实现
- [x] 1.6 确认 builder-opencode 默认 model（V05-5 调研）；写入 `~/.agenthub/agents/builder-opencode.md` 模板 — refs: agents/内置 Agent（MVP 必带）
- [x] 1.7 集成测试：OpenCodeACPAdapter detect + startRun + cancel 基本流程（无真实 OpenCode 时 skip）— refs: adapter-framework/OpenCodeACPAdapter 真实现

## 2. ClaudeCodeAdapter 事件链路补全

- [x] 2.1 在 `packages/adapters/claude-code/src/index.ts` 实现 `pre_compact` hook → emit `context.snapshot { kind: "claude_compact", text, idempotencyKey: "claude_compact:<runId>" }` — refs: adapter-framework/ClaudeCodeAdapter 事件映射
- [x] 2.2 实现 `subagent_start` → `subagent.started`（durable, visibility=detail）；`subagent_stop` → `subagent.completed`（含 cost / duration）— refs: adapter-framework/ClaudeCodeAdapter 事件映射
- [x] 2.3 实现 `tool/post_use` 写文件路径 → emit `artifact.diff.detected { runId, path }`（ephemeral, visibility=detail）；**不**发 `artifact.diff.created`（不创建 artifact 行）— refs: adapter-framework/ClaudeCodeAdapter 事件映射
- [x] 2.4 在 ContextLedger 接收 `context.snapshot` 事件时调 `propose()`（幂等：按 idempotencyKey 命中已有 draft 不重复 propose）— refs: context-ledger/长会话压缩 → ContextItem.summary
- [x] 2.5 集成测试（标 `@integration:claude-code`，无 claude binary 时 skip）：单 Run 含 tool / 触发 ask 后 allow / Diff 成功 apply / cancel 中断 — refs: adapter-framework/ClaudeCodeAdapter 事件映射

## 3. 内置 Agent 模板 + AgentProfile 热更新

- [x] 3.1 写 7 个内置 agent markdown 模板（mock-builder / mock-reviewer / claude-code-builder / claude-code-reviewer / builder-opencode / reviewer / archivist）；每个含 `version: 1.0.0` frontmatter — refs: agents/内置 Agent（MVP 必带）
- [x] 3.2 实现首启写入逻辑：daemon 启动时检查 `~/.agenthub/agents/`，不存在或为空则写入 7 个模板；同名文件存在时跳过；version 较旧时 stderr 警告不覆盖 — refs: agents/内置 Agent（MVP 必带）
- [x] 3.3 实现 chokidar 监听（从 `notImplemented` stub 升级）：`add/change` → gray-matter 解析 → upsert `agent_profiles`（含 V0.5 新增 5 列）→ emit `agent.profile.updated`；`unlink` → hidden=1 或删除 → emit `agent.profile.removed`；解析失败 → stderr + emit `agent.profile.error` — refs: agents/AgentProfile 数据模型
- [x] 3.4 实现 `agenthub agents reset --id=<agentId>` CLI 子命令（覆盖内置模板）— refs: local-daemon/daemon CLI 子命令
- [x] 3.5 单元测试：首启写入 / 同名跳过 / version 警告 / chokidar add/change/unlink / 解析失败不删旧行

## 4. 聊天室体验 — 后端

- [x] 4.1 实现 `parseMentions(text, members)` 函数（`packages/orchestrator/src/mention-parser.ts`）：正则 `/(^|\s)@([a-z0-9][a-z0-9-]*)\b/g` + 成员校验 + 去重保留首次顺序 — refs: orchestrator/Mention 解析
- [x] 4.2 在 `SendMessage` Command handler 接入 mention 解析：Assisted Room + mention list 非空时按顺序 dispatch `WakeAgent { reason: "user_mention" }`；不含 @ 时仅 dispatch primary — refs: orchestrator/Assisted 模式调度
- [x] 4.3 实现 `RoomMcpServer.handleSendMessage` 群聊纪律执行器：observer + presence != active → 转 mailbox + 返回 `{ degraded: true }`；observer + active → 允许直发 + audit log — refs: orchestrator/群聊纪律执行器（Observer 发言降级）
- [x] 4.4 实现状态行节流：daemon 侧 BoundedPubSub `status_line` 通道 30s flush + 边界强制刷新；客户端 Projector 30s 节流 — refs: orchestrator/状态行节流
- [x] 4.5 实现 `mailbox.delivery.failed` 事件发布：claim_conflict / max_retries（attempt_count >= 5）/ target_unavailable 三个触发场景；5 分钟 LRU 256 dedupe — refs: messaging/mailbox.delivery.failed 失败可见性事件
- [x] 4.6 实现消息分页 cursor-based（`(created_at, id)` 复合游标，base64 编码，不依赖 id 时间序）— refs: messaging/消息列表分页
- [x] 4.7 实现 `POST /messages/:id/regenerate` CommandBus handler `RegenerateMessage`（MVP 是 notImplemented）— refs: messaging/消息操作（固定 6 个）
- [x] 4.8 实现 `POST /messages/:id/pin` CommandBus handler `PinMessage`（MVP 是 notImplemented）— refs: messaging/消息操作（固定 6 个）
- [x] 4.9 实现 `PATCH /messages/:id` 编辑 PendingTurn 关联消息（仅 status=queued 允许；等价 cancel + 新 PendingTurn；不保留 enqueuedAt）— refs: messaging/用户 Turn 排队（primary busy 时不阻止发送）
- [x] 4.10 集成测试：@mention 解析 + Assisted 调度 / 群聊纪律 observer 降级 / 状态行节流 / mailbox 失败事件 / 消息分页 cursor / regenerate / pin / pending turn 编辑

## 5. Cost 面板 + CLI + config.toml

- [x] 5.1 实现 `GET /workspaces/:id/cost-summary` API（SQL GROUP BY `ended_at`，按 agent/model/day 分组；workspace 存在性校验；read scope）— refs: cost-panel-local/单机 Cost 聚合接口
- [x] 5.2 实现 `POST /workspaces/:id/cost-budget` 返回 501（预算告警 V1.5）— refs: cost-panel-local/不实现预算告警 / 降级
- [x] 5.3 实现 config.toml 加载（smol-toml；优先级 CLI > env > config.toml > 默认；字段命名与 security spec 对齐：`[server] bind` / `[server.remote] enabled` / `auth.allowedOrigins`）— refs: local-daemon/Daemon 启动与端口绑定
- [x] 5.4 实现 SIGINT/SIGTERM 优雅停止（30s in-flight 等待 + 强制 cancel + PID 文件写/删）— refs: local-daemon/优雅停止
- [x] 5.5 实现 `agenthub start / stop / status / doctor / auth issue / auth list / auth revoke / agents reset` CLI 子命令 — refs: local-daemon/daemon CLI 子命令
- [x] 5.6 调整 `vitest.config.ts` testTimeout 到 10s（解决 Windows 冷启动 flake）— refs: design/V05-D12
- [x] 5.7 单元测试：cost-summary 按 agent/model/day 分组 / workspace 不存在 404 / 空数据 / config.toml 加载优先级 / SIGINT 30s 等待 / CLI doctor 5 项检查

## 6. 文件附件上传安全

- [x] 6.1 实现 `POST /attachments` multipart 上传：CSRF + Origin 校验（与其他 mutating route 一致）/ MIME 白名单 + magic bytes 二次校验 / 大小限制 50MB / 路径安全（UUID fileId，不用用户文件名）/ SVG 净化（复用 MVP sanitizeSvg）— refs: security/文件附件上传安全（multipart）
- [x] 6.2 实现附件 GC：孤立附件 24h 清理 / 关联 message 软删除后 30 天清理（与 worktree GC 同一后台任务）— refs: security/文件附件上传安全（multipart）
- [x] 6.3 单元测试：合法 PDF / 可执行文件拒绝 / SVG 净化 / 超大文件 413 / 路径不出 workspace

## 7. Web UI — 聊天室功能

- [x] 7.1 实现 `@` 自动补全（`RoomMembersPopover`）：`@` 触发 / 候选源 RoomViewModel.members / 子串匹配 / Tab 切换 / Enter 选中 / 多 @ 顺序 / 候选 > 20 虚拟化 — refs: web-ui/输入框
- [x] 7.2 实现 drag-drop 附件：拖拽 → POST /attachments → AttachmentPart preview（icon + 文件名 + size）— refs: web-ui/输入框
- [x] 7.3 实现消息引用（quote）：主流 `q` 键 / 操作菜单"引用" → 输入框插入引用块 + quotedMessageId — refs: web-ui/输入框
- [x] 7.4 实现消息操作菜单（hover kebab icon）：quote / regenerate / pin / delete；键盘 `r/q/p/d` — refs: web-ui/Main Timeline 与 Agent Run Detail 双视图（MODIFIED）
- [x] 7.5 实现 PendingTurnList 组件（输入框上方）：排队列表 / cancel / edit / sessionStorage 草稿 / 编辑 409 错误处理 — refs: web-ui/PendingTurn 操作面板
- [x] 7.6 实现 MailboxFailureCard（主流 system-level 提示）：reason / target / 时间 / "重新投递"按钮 / "查看详情"跳 Debug Panel — refs: messaging/mailbox.delivery.failed 失败可见性事件
- [x] 7.7 实现 TerminalCard（PTY 输出渲染）：前 10 行折叠 + 展开 modal / ANSI 颜色（ansi-to-html）/ 虚拟化 log viewer / 搜索 / 复制 — refs: web-ui/终端 Artifact 渲染（PTY 输出）
- [x] 7.8 实现 Run Detail 7 tab 真信息：Transcript 加 PreCompact summary 高亮 / Tools 加 subagent 节点 / Artifacts 接 TerminalCard / Cost tab 加横向对比 — refs: web-ui/Main Timeline 与 Agent Run Detail 双视图（MODIFIED）
- [x] 7.9 实现 Cost 面板 UI（Side Panel 第 5 tab）：时间窗口选择 / 分组按钮 / 堆叠柱状图 + 列表 / 跳 Debug Panel — refs: web-ui/Cost 面板视图
- [x] 7.10 Playwright E2E：@ 补全选中 / PendingTurn 操作 / TerminalCard 展开 / Cost tab 加载

## 8. Web UI — 前端打磨

- [x] 8.1 实现 CSS variables 设计 token 化（`--ah-*` 前缀）：spacing / radius / font-size / line-height / color 全部改用 token — refs: web-ui/主题与密度系统
- [x] 8.2 实现亮 / 暗双主题（`data-theme` + localStorage）+ auto 跟系统 — refs: web-ui/主题与密度系统
- [x] 8.3 实现 cozy / compact 密度（`data-density` + localStorage）— refs: web-ui/主题与密度系统
- [x] 8.4 实现命令面板（Cmd+K）：Room / agent / Run 候选 / 切主题 / 切密度 / 候选 > 20 虚拟化 — refs: web-ui/键盘流第一轮收口
- [x] 8.5 实现消息流键盘导航（j/k / r / Enter / Esc）+ 全局 `?` keymap cheat sheet — refs: web-ui/键盘流第一轮收口
- [x] 8.6 实现消息流虚拟化（TanStack Virtual，≥ 50 条启用）— refs: web-ui/性能基线（虚拟化 + 60fps batch + 骨架屏）
- [x] 8.7 实现 delta 60fps batch（requestAnimationFrame coalesce）— refs: web-ui/性能基线（虚拟化 + 60fps batch + 骨架屏）
- [x] 8.8 实现骨架屏（Room 切换 / Run Detail 加载 / Cost 面板加载）+ 图懒加载 — refs: web-ui/性能基线（虚拟化 + 60fps batch + 骨架屏）
- [x] 8.9 实现动效收口（slide-over 缓动 / 消息 fade-in / prefers-reduced-motion 退化）— refs: web-ui/主题与密度系统
- [x] 8.10 实现 a11y AA 基线：focus ring / aria-label / 对比度 4.5:1 / prefers-reduced-motion；接入 axe-core CI — refs: web-ui/a11y AA 基线
- [x] 8.11 实现错误 / 重连 banner 视觉收口（状态 icon + 进度条 + 离线只读防误触）— refs: web-ui/错误与重连（MODIFIED）
- [x] 8.12 性能验证：10k 消息首屏 ≤ 500ms / delta 100/s 不掉帧 / 切 Room ≤ 200ms — refs: web-ui/性能基线（虚拟化 + 60fps batch + 骨架屏）

## 9. 收尾验收

- [x] 9.1 写 migration `0012_v05.sql` 并跑 `pnpm db:migrate`；确认 DB schema 与 spec 一致 — refs: design/Migration Plan
- [x] 9.2 跑 `pnpm test`（全部通过）+ `pnpm typecheck` + `pnpm lint` — refs: design/V05-D12
- [x] 9.3 跑 `pnpm check:all`（5 道 CI 全绿，含新事件类型）— refs: event-system/events:check 与 visibility:check CI 校验
- [x] 9.4 跑 `openspec validate add-v05-chatroom-complete --strict` 通过 — refs: design/Goals G3
- [x] 9.5 跑 Playwright E2E（含 V0.5 新增用例）全绿 — refs: web-ui/测试基础设施
- [x] 9.6 更新 tasks.md 勾选状态（所有已完成项 `[x]`）— refs: design/Goals G3
- [x] 9.7 准备 V1.0 plan：Squad Mode + Team Mode + Deployment(static/zip)（不在本 change 内，仅记录 Entry Criteria 是否满足）— refs: design/Roadmap Beyond MVP V1.0 章节

## M-阶段交付建议（不属于 spec，仅作实施计划参考）

> 这些是工程实施 milestone，不是 spec 要求。tasks 1–9 描述的是"做什么"；M 阶段描述"按什么顺序做"。

- [x] M0 基础设施（§0 全部 + §3 全部）：migration / event registry / BriefGenerator / chokidar / 内置模板
- [x] M1 OpenCode + Run Detail（§1 + §2）：OpenCodeACPAdapter + ClaudeCode hook 补全
- [x] M2 聊天室体验后端（§4 + §5 + §6）：mention / 纪律 / 节流 / mailbox 失败 / 分页 / regenerate / pin / cost / CLI / config / 附件安全
- [x] M3 Web UI 功能（§7）：@ 补全 / drag-drop / quote / 操作菜单 / PendingTurn / MailboxFailureCard / TerminalCard / Run Detail 7 tab / Cost 面板
- [x] M4 前端打磨（§8）：主题 / 密度 / 键盘流 / 虚拟化 / 60fps / 骨架屏 / 动效 / a11y / 重连 banner
- [x] M5 收尾验收（§9）：全套测试 + strict + E2E + tasks 勾选

> 关键纪律：M1 之前所有功能都要在 MockAdapter 上跑通；OpenCodeACPAdapter 不要太早接入，避免外部 agent 不稳定性拖住核心内核。

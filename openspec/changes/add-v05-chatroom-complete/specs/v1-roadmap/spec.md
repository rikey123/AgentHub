# v1-roadmap (V0.5 delta)

## REMOVED Requirements

### Requirement: V0.5 OpenCode Adapter 占位（opencode-adapter）

**Reason**：V0.5 已实现真实 `OpenCodeACPAdapter`（详见 `adapter-framework/OpenCodeACPAdapter 真实现` Requirement）；占位不再需要。

**Migration**：用户配置 `provider="opencode"` 的 AgentProfile 现在走真实 adapter 路径而非占位 501。MVP archive 内仍可见此占位 Requirement 的历史记录（`openspec/changes/archive/2026-05-24-add-agenthub-mvp/specs/v1-roadmap/spec.md`）。

### Requirement: V0.5 Run Detail 投影完整化占位（run-detail-projection）

**Reason**：V0.5 已落实 Run Detail 7 tab 完整化（详见 `web-ui/Main Timeline 与 Agent Run Detail 双视图` Requirement V0.5 增量 + `adapter-framework/ClaudeCodeAdapter 事件映射` 补 PreCompact / SubagentStart-Stop / PostToolUse→diff hooks），不再需要占位。

**Migration**：MVP 用户的 Run Detail 5 个 E2E 测试继续通过；V0.5 用户额外看到 Transcript tab 的 PreCompact summary 高亮、Tools tab 的 subagent 节点、Artifacts tab 的 PTY 渲染、Cost tab 的横向对比。

### Requirement: V0.5 单机 Cost 面板占位（cost-panel-local）

**Reason**：V0.5 已升级为独立 capability `cost-panel-local`（详见 `cost-panel-local/单机 Cost 聚合接口` Requirement），不再是占位。

**Migration**：`GET /workspaces/:id/cost-summary` 现在返回真实聚合数据而非 501；UI Side Panel 加 "Cost" tab。Schema 不变（`runs` 表 cost 字段已在 MVP 落实）。

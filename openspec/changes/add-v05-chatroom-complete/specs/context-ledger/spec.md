# context-ledger (V0.5 delta)

## ADDED Requirements

### Requirement: BriefGenerator 接口（V0.5 启发式 / V1.2 LLM）

The system SHALL define a `BriefGenerator` interface in `packages/context` that produces a one-line human-readable summary string for a finalized Run, used to fill the `message.brief.published` event payload (per `messaging/主流摘要 / Agent Run Detail 双投影`).

```ts
interface BriefGenerator {
  /**
   * Synchronously generate a brief summary for a finalized run.
   * MUST be deterministic for testability; MUST NOT block longer than 50ms in V0.5.
   * Called by the caller (AdapterBridge / Orchestrator terminal hook) OUTSIDE the transaction;
   * the resulting string is passed as briefText to RunLifecycleService.complete/fail/cancelFinalized
   * which writes it inside the transaction alongside the run terminal event.
   * Exceptions MUST be caught by the caller and fallback to empty string ("").
   */
  generate(input: BriefGeneratorInput): Effect.Effect<string, never>
}

type BriefGeneratorInput = {
  runId: string
  finalAssistantText?: string         // 最后一条 assistant message 全文（如有）
  artifactCounts: {
    diff: number
    file: number
    tool: number
  }
  failureClass?: RunFailureClass      // 失败 Run 才有
  failureReason?: string
  cancelled?: boolean
}
```

V0.5 默认实现 `HeuristicBriefGenerator`：

- 取 `finalAssistantText` 第一句作为主干（按空白行 + 中英文标点 `。？！.?!` 切分，跳过代码块开头三反引号行）
- 主干最长 **120 字符**截断，超出加 `…`
- 主干为空时（如失败 Run 无 assistant 输出）：
  - 失败：`<failureReason>`（取 failureClass 的人类可读模板，如 `"transient: lock_timeout"` → `"Lock timed out, retrying"`）
  - 取消：`"User cancelled this run"`
- 后缀拼接 artifact 统计：`（artifacts: ${diff} diff / ${file} files / ${tool} tools）`，**仅在任一计数 > 0 时**追加
- 解析失败 → 退化为 `finalAssistantText` 前 120 字符纯字符串截断 + `…`

V1.2 必换 `LlmBriefGenerator`：

- Memory pipeline 自然有 LLM 通路 + cost 已可治理（Memory Gateway / Cost 面板都已上线）
- 调用同步阻塞改为最长 5s 超时，超时退化到 `HeuristicBriefGenerator`
- 接口 `generate()` 签名不变；调用点 RunLifecycleService 不需要改

`BriefGenerator` 注入由 `cost-panel-local` 之外的所有 capability 完全无感知（接口 + Layer 注入）。

#### Scenario: 启发式生成成功 brief

- **WHEN** Run 完成，finalAssistantText = `"我已添加 OAuth 校验逻辑到 src/auth.ts，并修复了 cookie 过期处理。"`，artifactCounts = `{diff:1, file:0, tool:3}`
- **THEN** `HeuristicBriefGenerator.generate()` 返回 `"我已添加 OAuth 校验逻辑到 src/auth.ts，并修复了 cookie 过期处理。（artifacts: 1 diff / 0 files / 3 tools）"`
- **AND** RunLifecycleService 在同事务把该字符串写入 `message.brief.published.payload.text`

#### Scenario: 启发式截断超长第一句

- **WHEN** finalAssistantText 第一句长度 > 120 字符
- **THEN** brief 主干 = `<前 119 字符>…`
- **AND** 后缀 artifact 统计照常拼接（不计入 120 字符）

#### Scenario: 失败 Run 用 failureClass 模板

- **WHEN** Run failureClass=`transient`、reason=`lock_timeout`、finalAssistantText 缺失
- **THEN** brief = `"Lock timed out, retrying（artifacts: 0 diff / 0 files / 2 tools）"`（artifact 计数若有则拼）
- **AND** UI 主流显示该 brief 红色样式

#### Scenario: 取消 Run

- **WHEN** Run cancelled=true、finalAssistantText 缺失、artifacts 全零
- **THEN** brief = `"User cancelled this run"`
- **AND** 不追加 artifacts 后缀

#### Scenario: 解析失败退化为纯截断

- **WHEN** finalAssistantText 含异常 BiDi 字符或无标点的连续 200 字符
- **THEN** HeuristicBriefGenerator 退化为前 120 字符 + `…`
- **AND** 不抛错；不阻断 RunLifecycleService.complete

#### Scenario: V1.2 替换实现不改调用点

- **WHEN**（V1.2）daemon Layer 把 `BriefGenerator` 注入从 `HeuristicBriefGenerator` 换成 `LlmBriefGenerator`
- **THEN** RunLifecycleService 调用代码 0 行变更
- **AND** 启发式作为 fallback 仍可用（LLM 超时 5s 退化）

## MODIFIED Requirements

### Requirement: 长会话压缩 → ContextItem.summary

The system SHALL convert any incoming `context.snapshot` AdapterEvent (e.g. Claude Code PreCompact, OpenCode summarize hook) into a ContextItem with `type='summary', scope='task', status='draft', confidence='inferred'`.

V0.5 落实 ClaudeCodeAdapter PreCompact 路径（MVP §12.7 缺）；OpenCodeACPAdapter 的 summarize hook 走相同路径（事件类型一致）。

幂等：context.snapshot 事件携带 idempotencyKey（推荐 `<adapter>_compact:<runId>`），ContextLedger 命中已有 draft 时不重复 propose。

#### Scenario: Claude Code 触发 PreCompact

- **WHEN** Claude Code 在 Run 内执行 PreCompact 钩子
- **THEN** Adapter emit `context.snapshot { snapshot: { kind: "claude_compact", text }, idempotencyKey: "claude_compact:<runId>" }`
- **AND** ContextLedger 写入 summary draft（`type='summary', status='draft', source.kind='tool', source.id='claude_code_compact'`）
- **AND** UI 显示"会话已压缩，可在 Context View 确认摘要"

#### Scenario: 同 runId 重复 PreCompact 幂等

- **WHEN** Claude Code 在同一 Run 内连续触发两次 PreCompact（如长会话自动二次压缩）
- **THEN** ContextLedger 第二次按 idempotencyKey 命中已有 draft，不重复 propose
- **AND** 第一次 propose 的 summary draft 保留（用户可在 UI 二选一或合并）

#### Scenario: OpenCode 触发同类 snapshot

- **WHEN** OpenCodeACPAdapter 触发 summarize hook 发 `context.snapshot { snapshot: { kind: "opencode_compact", text }, idempotencyKey: "opencode_compact:<runId>" }`
- **THEN** ContextLedger 走与 Claude Code 完全一致的 propose 路径
- **AND** source.id=`opencode_compact`（区分 adapter 来源用于 audit）

# cost-panel-local

## ADDED Requirements

### Requirement: 单机 Cost 聚合接口

The system SHALL expose `GET /workspaces/:workspaceId/cost-summary` which aggregates cost data from the `runs` table, grouped by agent / model / day, returning totals scoped to the requesting workspace only. **不区分用户**（路线红线 D32：永不多用户归因）。

```ts
type CostSummaryQuery = {
  workspaceId: string                  // path param
  groupBy: "agent" | "model" | "day"   // 默认 "agent"
  from?: number                        // epoch ms（缺省 = 7 天前，默认 V05-D6 已采纳）
  to?: number                          // epoch ms（缺省 = 现在）
}

type CostSummaryResponse = {
  groupBy: "agent" | "model" | "day"
  from: number
  to: number
  groups: Array<{
    key: string                        // agent_id / model_id / "yyyy-mm-dd"
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    costUsd: number
    runCount: number
  }>
  total: {
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    costUsd: number
    runCount: number
  }
}
```

**实现**：

- 直接 SQL `SELECT ... FROM runs WHERE workspace_id=:wid AND ended_at BETWEEN :from AND :to GROUP BY <groupBy>`（使用现有 `ended_at` 列，**不**新增 `completed_at`）
- 索引：新增 `idx_runs_workspace_ended (workspace_id, ended_at DESC)` 支持范围扫描（migration `0012_v05.sql`）
- 不引入物化视图（数据量 < 10 万 Run 内即时 GROUP BY 足够）
- 单次查询 < 100ms（SLA）；超时 daemon 返回 504 + Debug Panel 提示

**权限**：

- 需要 `read` scope（与其他 GET 接口一致）；
- workspace 隔离：HTTP handler 校验 `workspaceId` 在 `workspaces` 表中存在（`SELECT 1 FROM workspaces WHERE id=:wid`），不存在返回 404；
- **不**假设 token 绑定 workspace（当前 security token 只有 scopes，无 workspace claim，D32 单用户路线）；
- 单机本地产品：所有 workspace 数据对同一 daemon 的 read scope token 可见（无跨用户隔离需求）。

**Cost 字段来源**：所有 cost 数据由 `RunLifecycleService.complete(tx, runId, cost)` 在 Run 完成时写入 `runs` 表的 `input_tokens / output_tokens / cached_tokens / cost_usd / model_id` 5 列（MVP §15.6 已落实）。本 capability 仅做读取聚合，不修改 cost 写入路径。

#### Scenario: 默认按 agent 分组 7 天

- **WHEN** 用户调 `GET /workspaces/w_1/cost-summary`（无 query 参数）
- **THEN** daemon 返回 7 天内（now - 7d → now）按 agent_id 分组的 cost 聚合
- **AND** 响应含 groups + total + groupBy="agent"

#### Scenario: 按 model 分组

- **WHEN** 用户调 `?groupBy=model&from=<3d_ago>&to=<now>`
- **THEN** daemon 返回 3 天内按 model_id 分组的聚合

#### Scenario: 按 day 分组

- **WHEN** 用户调 `?groupBy=day&from=<7d_ago>&to=<now>`
- **THEN** daemon 返回每日聚合（key 格式 `yyyy-mm-dd`，用 daemon 本地时区）

#### Scenario: workspace 不存在返回 404

- **WHEN** 用户调 `GET /workspaces/nonexistent/cost-summary`
- **THEN** daemon 返回 404 + `{ error: "workspace_not_found" }`（不泄露是否有数据）

#### Scenario: read scope 可访问所有 workspace

- **WHEN** 用户 token 有 `read` scope，调 `GET /workspaces/w_2/cost-summary`
- **THEN** 返回 w_2 的 cost 数据（单机本地，无跨用户隔离）

#### Scenario: 空数据

- **WHEN** workspace 在指定时间窗口内无 completed Run
- **THEN** daemon 返回 `{ groups: [], total: { ...zeros }, ... }`

#### Scenario: 单查询 < 100ms

- **WHEN** workspace 有 5000 个 Run，调 `?groupBy=agent`
- **THEN** daemon 在 < 100ms 内返回（受 `idx_runs_workspace_ended` 索引支持）

### Requirement: Cost 字段 Schema 不变

The system MUST NOT add new columns to `runs` table for cost-panel-local; the capability reads from existing 5 columns set by `RunLifecycleService.complete` per MVP `observability/Cost 字段记录`. New index `idx_runs_workspace_ended` MAY be added (migration-only change, no domain logic change).

#### Scenario: 实现仅添加索引

- **WHEN** V0.5 cost-panel-local 实现完成
- **THEN** migration `0012_v05.sql` 仅 `CREATE INDEX idx_runs_workspace_ended ON runs (workspace_id, ended_at DESC)`
- **AND** 不 ALTER `runs` 表 columns
- **AND** 不新增 `runs_aggregate` / `cost_summary` 等物化表

### Requirement: 不实现预算告警 / 降级

The system MUST NOT implement budget alerts, cost limits, or auto-downgrade strategies in V0.5. These features are reserved for V1.5 `permission-dsl` (per `v1-roadmap`).

#### Scenario: 用户尝试设置预算告警

- **WHEN** 用户调用 `POST /workspaces/:wid/cost-budget`
- **THEN** daemon 返回 501 + `{ error: "budget alerts are V1.5 (permission-dsl)" }`

#### Scenario: cost-summary 不含告警字段

- **WHEN** CostSummaryResponse 序列化
- **THEN** 不含 `budgetThreshold` / `overBudget` 等字段（V0.5 schema 锁定）

### Requirement: 不区分用户归因

The system MUST NOT introduce per-user cost attribution. All `runs` are attributed to the workspace level only. UI MUST NOT display user identifiers in cost panels. This aligns with路线红线 D32 (single-user product, never multi-user).

#### Scenario: UI 不显示用户列

- **WHEN** Web UI Cost panel 渲染列表
- **THEN** 列只含 agent / model / day / cost / token / run count，绝不显示用户 / token id 列

#### Scenario: API response 无 userId

- **WHEN** daemon 返回 CostSummaryResponse
- **THEN** payload 不含任何 user / token id 字段

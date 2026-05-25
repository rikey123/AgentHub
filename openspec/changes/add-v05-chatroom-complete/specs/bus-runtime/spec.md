# bus-runtime (V0.5 delta)

## MODIFIED Requirements

### Requirement: RunLifecycleService 是 `runs` 表的唯一写入口

The system SHALL implement `RunLifecycleService` as the single write entry point to the `runs` table. Every state transition MUST go through one of its methods; `RunQueue Worker`、`AdapterBridge`、`CancelRun` handler、`RunService` and any other module **MUST NOT** issue raw `UPDATE runs` SQL.

**V0.5 扩展：terminal 事务包含 brief 发布**

V0.5 在 `complete / fail / cancelFinalized` 三个 terminal 方法的同一事务内，增加 `message.brief.published` durable event 发布；`briefText` 由调用方在事务外通过 `BriefGenerator.generate()` 生成后传入（详见约束第一条）。这扩展了 MVP 的 terminal 事务契约：

**MVP terminal 事务（单事务）**：

```
tx {
  UPDATE runs.status = terminal
  INSERT events(agent.run.completed/failed/cancelled)
  INSERT outbox
}
```

**V0.5 terminal 事务（单事务，扩展）**：

```
tx {
  UPDATE runs.status = terminal
  INSERT events(agent.run.completed/failed/cancelled)
  INSERT events(message.brief.published)   ← V0.5 新增
  UPDATE messages.brief_published_at       ← V0.5 新增（如有关联 message）
  INSERT outbox（两条 events 都进 outbox）
}
```

**约束**：

- `BriefGenerator.generate()` 必须在事务**外**调用（纯计算，不访问 DB），结果字符串传入事务内；
- 如果 `BriefGenerator.generate()` 抛出异常，`complete/fail/cancelFinalized` 必须**仍然提交**（brief 降级为空字符串 `""`，不阻断 Run 终结）；
- `message.brief.published` 的 `runId` 字段必须与 `agent.run.completed/failed/cancelled` 的 `runId` 一致；
- `messages.brief_published_at` 更新：`UPDATE messages SET brief_published_at=:now WHERE run_id=:runId AND role='assistant' AND status='completed'`（通过 `messages.run_id` 反向关联，不依赖不存在的 `runs.message_id`）；如无匹配行则跳过（不报错）；
- 两条 durable events 都进 outbox，Outbox Dispatcher 按 seq 顺序派发（brief 在 run terminal event 之后）。

**回滚语义**：

- 如果整个 tx 回滚（如 DB 锁超时），两条 events 都不发布；Run 状态不变；
- 不存在"run terminal 发布但 brief 漏发"的情况（同事务保证）；
- 不存在"brief 发布但 run terminal 漏发"的情况（同事务保证）。

```ts
interface RunLifecycleService {
  // ... 所有 MVP 方法保持不变 ...

  // V0.5 扩展：complete/fail/cancelFinalized 接受可选 briefText 参数
  complete(tx: SqliteTx | null, runId: string, cost: Cost, briefText?: string): Effect.Effect<void, RunLifecycleError>
  fail(tx: SqliteTx | null, runId: string, reason: string, failureClass: RunFailureClass, error?: Error, briefText?: string): Effect.Effect<void, RunLifecycleError>
  cancelFinalized(tx: SqliteTx | null, runId: string, briefText?: string): Effect.Effect<void, RunLifecycleError>
}
```

调用方（AdapterBridge / Orchestrator terminal hook）负责在调用前调 `BriefGenerator.generate()` 并传入 `briefText`；RunLifecycleService 不直接依赖 BriefGenerator（避免循环依赖）。

#### Scenario: complete 同事务发 brief

- **WHEN** AdapterBridge 调 `RunLifecycleService.complete(tx, runId, cost, "我已添加 OAuth 校验...")`
- **THEN** 同一 tx 内：① UPDATE runs.status='completed' ② INSERT events(agent.run.completed) ③ INSERT events(message.brief.published { text: "我已添加 OAuth 校验..." }) ④ UPDATE messages.brief_published_at（如有关联 message）⑤ INSERT outbox（两条）
- **AND** 任一步失败整个 tx 回滚

#### Scenario: BriefGenerator 异常不阻断 Run 终结

- **WHEN** BriefGenerator.generate() 抛出异常（如 finalAssistantText 含异常字符）
- **THEN** AdapterBridge 捕获异常，传 `briefText=""` 调 complete
- **AND** tx 正常提交；`message.brief.published { text: "" }` 发布（UI 显示空 brief，不崩溃）
- **AND** Run 状态正常变 completed

#### Scenario: 无关联 message 时不更新 brief_published_at

- **WHEN** Run 没有关联 user message（如 daemon 内部触发的 Run）
- **THEN** tx 内不执行 `UPDATE messages.brief_published_at`
- **AND** `message.brief.published` 仍发布（runId 字段标识来源）

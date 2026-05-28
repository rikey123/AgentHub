# bus-runtime (V1.0 delta)

## MODIFIED Requirements

### Requirement: RunQueue 是 bus 的一条命名队列

The system SHALL clarify the lock matrix semantics for multi-agent Squad/Team scenarios in V1.0.

**V1.0 多 Agent 并行场景的锁矩阵语义**：

- 不同 agent + 同 room：可并行（agent 锁不冲突）；
- 同 file（不同 agent 都声明 targetFiles 含同文件）：后到者 markWaiting reason='locked_by_<other_run>'；
- 任一 agent 不声明 targetFiles：取 workspace 整体写锁，其他 agent 写任何文件都阻塞；
- Leader system prompt 应提示"派发 Task 时让 teammate 声明 targetFiles 减少锁竞争"——产品手册级建议，不是内核强制。

**Squad/Team 场景示例**：

```
Squad Room: project-manager(leader) + builder(teammate1) + reviewer(teammate2)

t=1  builder Run 1 启动，声明 targetFiles=["src/auth.ts"]
     → 获得 file 锁 lock_key="src/auth.ts"
t=2  reviewer Run 1 启动，声明 targetFiles=["src/auth.ts"]
     → 申请同 file 锁 → markWaiting reason='locked_by_builder_run_1'
t=3  builder Run 1 完成 → 释放 file 锁
t=4  reviewer Run 1 被 RunQueue 重新调度 → 获得 file 锁 → 继续执行
```

#### Scenario: 不同 agent 同 room 可并行

- **WHEN** Squad Room 中 builder Run 1 和 reviewer Run 1 同时启动，targetFiles 不重叠
- **THEN** 两个 Run 并行执行（agent 锁不冲突）

#### Scenario: 同 file 锁串行

- **WHEN** builder Run 1 持有 `src/auth.ts` file 锁，reviewer Run 1 申请同 file 锁
- **THEN** reviewer Run 1 markWaiting reason='locked_by_builder_run_1'
- **AND** builder Run 1 完成后 reviewer Run 1 自动被调度

# adapter-framework (V1.0 delta)

## MODIFIED Requirements

### Requirement: Post-MVP Adapter Stub（接口存在但 detect 返回空）

The system SHALL update the stub table to reflect that `OpenCodeAdapter` is now a real implementation (V0.5) and `NativeAgentAdapter` is a new real implementation (V1.0).

| Stub | 启用阶段 | 备注 |
|---|---|---|
| `CodexAdapter` | V1.x（具体子阶段视需求） | 半结构化事件，需在主路径稳定后再做 |
| `LangGraphAdapter` | V1.3 | Python AI worker，依赖 plugin-system 隔离基座 |
| `A2AAdapter`（即 `RemoteA2AAdapter`） | V1.3 | A2A Client 把外部 agent 装进 Room |

`OpenCodeAdapter`（V0.5 已实现）和 `NativeAgentAdapter`（V1.0 已实现）不再是 stub。

#### Scenario: NativeAgentAdapter 不返回 501

- **WHEN** 用户用 native runtime 创建 AgentBinding 并启动 Run
- **THEN** NativeAgentAdapter 正常启动（V1.0 已实现）；**不**返回 501

#### Scenario: CodexAdapter 仍返回 501

- **WHEN** 用户尝试用 CodexAdapter 启动 run
- **THEN** 返回 501 + `{ error: "CodexAdapter is V1.x (post V1.0)", capability: "adapter-framework" }`

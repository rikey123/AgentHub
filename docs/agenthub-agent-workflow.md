# AgentHub Code Agent Workflow

> 本文是给后续代码 agent、审查 agent、上级 agent 使用的协作规范。目标是让 AgentHub 的实现过程严格遵守 OpenSpec、Git 工作流和逐级审查机制，避免代码 agent 在不确定时擅自改架构或偏离产品设计。

## 1. 基本原则

AgentHub 的开发必须遵守以下优先级：

1. **OpenSpec spec 是最高实现依据**：以 `openspec/changes/add-agenthub-mvp/` 下的 `proposal.md`、`design.md`、`tasks.md` 和各 capability 的 `spec.md` 为准。
2. **任务必须可审查、可回滚、可追踪**：任何代码或文档改动都必须经过 Git 分支、提交、PR 和审查。
3. **小步提交，小步审查**：完成一个明确任务后立即交给上级 agent 或审查 agent 检查；通过后再 merge。
4. **不能私自扩大范围**：实现当前任务所需以外的重构、技术栈替换、协议改动、数据库 schema 改动都必须先记录 issue 并请求上级确认。
5. **不确定就升级**：遇到解决不了的问题、spec 与实现冲突、外部框架行为不明确、参考项目与 spec 相矛盾时，不要硬猜；先记录问题，再咨询上级 agent。
6. **参考项目只能参考，不可替代 spec**：`C:\project\refrence` 中的成熟开源项目可以用于理解技术细节和边界处理，但不能直接覆盖 AgentHub spec 的设计。

## 2. 角色分工

### 2.1 代码 Agent

代码 agent 负责按任务实现功能。必须做到：

- 开始任务前读取相关 spec 和 `tasks.md` 中对应条目。
- 在新 Git 分支上工作。
- 按测试优先或测试同步的方式实现。
- 每个任务完成后提交 PR，不直接 merge。
- 在 PR 描述中列出：
  - 实现了哪个 task 编号；
  - 对应哪些 spec requirement；
  - 改动了哪些文件；
  - 跑了哪些验证命令；
  - 是否存在未解决问题或风险。

### 2.2 审查 Agent

审查 agent 负责从多角度检查 PR。不能只看代码能否运行，还必须检查：

- 是否符合 OpenSpec。
- 是否符合 Git/PR 流程。
- 是否符合任务范围。
- 是否有边界条件遗漏。
- 是否有事务、状态机、事件、权限、安全方面的破坏。
- 是否有测试覆盖。
- 是否有不必要的架构发明或过早抽象。
- 可以使用LSP工具进行代码检查

### 2.3 上级 Agent

上级 agent 负责判断：

- 是否可以 merge。
- 是否需要修改 spec。
- 是否需要开新 issue 或新 OpenSpec change。
- 代码 agent 遇到阻塞时应该走哪条路径。
- 参考项目中的做法是否适合 AgentHub。

上级 agent 的职责不是替代码 agent 写所有代码，而是控制方向、边界和质量。

## 3. Git 工作流

任何改动都必须遵守以下流程。

### 3.1 开始任务

1. 确认当前工作区状态：

```powershell
git status --short --branch
```

2. 确认当前任务对应的 OpenSpec 条目：

```powershell
openspec.cmd validate add-agenthub-mvp --strict
```

3. 从主分支创建任务分支：

```powershell
git switch -c task/<task-id>-<short-name>
```

示例：

```powershell
git switch -c task/3-1-event-envelope
```

### 3.2 开发中提交

每个提交必须是一个清楚、可审查的逻辑单元。推荐提交格式：

```text
feat(bus): add event envelope schema
test(bus): cover event envelope validation
fix(run): reject invalid transition
docs(spec): clarify task status event payload
```

不要把多个无关功能塞进一个提交。不要提交调试垃圾、临时文件、机器私有配置、API key、数据库文件。

提交前至少执行：

```powershell
git status --short
git diff --check
```

如果已存在测试或校验脚本，必须执行对应命令。例如：

```powershell
pnpm test
pnpm typecheck
pnpm lint
openspec.cmd validate add-agenthub-mvp --strict
```

实际命令以仓库最终脚本为准。

### 3.3 提 PR

完成一个任务后，代码 agent 必须提交 PR。PR 描述必须包含：

```markdown
## Task

- Task: `tasks.md §<编号>`
- Spec refs:
  - `<capability>/<Requirement 名>`

## Changes

- ...

## Verification

- [ ] `openspec.cmd validate add-agenthub-mvp --strict`
- [ ] `<test command>`
- [ ] `<typecheck/lint command>`

## Risks / Open Questions

- ...
```

如果没有 GitHub 或远程 PR 系统，仍必须在本地模拟 PR 边界：

- 保持任务分支；
- 生成变更摘要；
- 请求审查 agent 审查该分支 diff；
- 审查通过后再由上级 agent merge。

### 3.4 Merge 规则

代码 agent 不允许自己 merge 自己的 PR。必须满足：

- 审查 agent 无阻塞问题；
- 上级 agent 明确批准；
- 必要测试通过；
- PR 描述完整；
- 没有未记录的偏离 spec 行为。

merge 后删除任务分支，并更新任务状态。

## 4. 任务执行流程

每个任务按照以下顺序执行：

1. **读 spec**：阅读任务引用的 capability spec、`design.md` 决策、相关 `tasks.md` 条目。
2. **确认范围**：写一句话说明本任务要交付什么，不交付什么。
3. **检查现有代码**：先找已有模式，不要凭空发明目录结构或抽象。
4. **写测试或验收用例**：优先写能证明 spec 行为的测试。
5. **实现最小功能**：只实现当前任务所需。
6. **运行验证**：测试、lint、typecheck、OpenSpec strict。
7. **提交 commit**：提交可审查的逻辑单元。
8. **提 PR**：请求审查。
9. **处理 review**：只处理审查指出的问题；如审查意见与 spec 冲突，升级给上级 agent。
10. **merge 后再继续下一任务**。

## 5. 遇到问题时的升级机制

代码 agent 遇到以下情况时，必须停止扩大实现，先记录 issue 并咨询上级 agent：

- spec 与代码实现明显冲突；
- spec 缺少关键字段、状态、事件或事务边界；
- 外部框架行为与预期不一致；
- 需要改数据库 schema 但任务没有要求；
- 需要改事件 envelope、Command union、RunLifecycleService 状态机、PermissionResource enum、AgentRuntimeAdapter 接口；
- 发现安全问题；
- 测试持续失败且 30 分钟内无法定位；
- 参考项目做法与 AgentHub spec 不一致；
- 需要引入新依赖；
- 需要做大规模重构；
- 需要跳过测试或降低校验标准。

Issue 记录模板：

```markdown
## Problem

一句话描述问题。

## Context

- Task:
- Spec refs:
- Files involved:

## What I Tried

- ...

## Observed Behavior

- ...

## Expected Behavior

- ...

## Options

1. ...
2. ...

## Recommendation

我的建议是 ...

## Needs Decision

- [ ] 是否修改 spec
- [ ] 是否修改实现方案
- [ ] 是否延后到后续阶段
```

在上级 agent 给出明确方向前，不要用临时 hack 绕过问题。

## 6. 使用参考项目的规则

本项目允许参考 `C:\project\refrence` 下的成熟开源项目，尤其是：

- OpenCode：Effect 总线、权限队列、事件流、adapter 运行时等实现细节。
- 其他多 agent 协作工作台：Room、Mailbox、TaskBoard、Run Detail、多 agent 可视化等产品实现经验。

但必须遵守：

1. **只参考，不照搬**：不能直接复制大段代码，除非许可证允许且上级 agent 批准。
2. **spec 优先**：参考项目与 AgentHub spec 冲突时，以 AgentHub spec 为准。
3. **记录来源**：如果实现明显参考了某项目，需要在 PR 描述中说明参考点。
4. **抽象要收敛**：参考项目中的复杂架构不要原样搬进 MVP。
5. **只引入当前任务需要的部分**：不要因为参考项目有某个能力就提前实现。

参考项目使用记录建议写法：

```markdown
## Reference Notes

- Looked at: `C:\project\refrence\<project>\<path>`
- Borrowed idea: bounded event buffer with drop policy
- Differences from AgentHub: AgentHub keeps durable events in SQLite and follows bus-runtime spec
```

## 7. 使用成熟框架与查文档规则

开发中会用到成熟框架和技术，例如 Effect、Hono、Drizzle、SQLite、Vite、React、Monaco、TanStack Virtual、MCP SDK、ACP/A2A 相关 SDK 等。

如果代码 agent 不知道怎么正确使用某个框架，必须查官方文档或权威资料，不要凭记忆硬写。规则：

- 优先查官方文档、官方示例、仓库 README、API reference。
- 对 OpenAI、ACP、A2A、MCP 等可能随时间变化的 API，必须确认当前版本文档。
- 查到的信息必须在 PR 中简短说明来源。
- 如果文档与 spec 发生冲突，先记录 issue，咨询上级 agent。
- 不要引入未在 spec 或任务中批准的新框架。

示例 PR 记录：

```markdown
## Docs Checked

- Hono middleware docs: used for request context and error handling
- Drizzle SQLite docs: used for transaction API
```

## 8. Spec 合规要求

代码 agent 每次实现必须回答以下问题：

- 这个改动对应哪个 requirement？
- 是否改变了任何 public contract？
- 是否新增了事件类型？如果是，是否已进入 event-system canonical registry？
- 是否新增了 Command？如果是，是否更新了 Command union、handler 权限、CI check？
- 是否触碰 Run 状态机？如果是，是否合法？
- 是否触碰 mailbox / run_next_turns / PendingTurn？是否保持原子性和幂等？
- 是否触碰文件写入？是否仍走 ArtifactFS / Permission Engine？
- 是否触碰 adapter？是否符合 AgentRuntimeAdapter / ACPAdapter 契约？
- 是否触碰安全边界？是否影响 token、CSRF、Origin/Host、debug scope、secret redaction？
- 是否触碰 UI？是否符合主流 brief + Run Detail 完整上下文的双投影设计？

如果任何答案不确定，必须升级。

## 9. 审查 Agent 检查清单

审查 agent 必须从以下角度审查。

### 9.1 Spec 合规

- PR 是否引用了正确 task 和 requirement？
- 代码行为是否与 spec 一致？
- 是否引入未在 spec 中定义的状态、事件、命令、字段或 API？
- 是否遗漏 spec 中的 Scenario？
- 是否有“实现方便”导致的 spec 偏离？

### 9.2 代码逻辑

- 状态机转换是否完整？
- 错误路径是否正确？
- 幂等键是否生效？
- 重试是否会造成重复写入？
- 是否存在竞态条件？
- 是否有事务窗口？
- 是否有资源泄漏，例如子进程、文件句柄、SSE 连接、PubSub 订阅？

### 9.3 数据一致性

- domain 写入、events 写入、outbox 写入是否同事务？
- durable event 是否可重放？
- handler 游标是否正确推进？
- mailbox / run_next_turns / PendingTurn 是否有丢消息、重复投递、幽灵投递风险？
- SQLite migration 是否可重复执行、可从空库启动？

### 9.4 安全与权限

- 文件路径是否 canonicalize？
- 是否可能越过 workspace 根目录？
- 敏感文件是否默认 deny？
- shell / file / tool / context / agent 权限是否走 Permission Engine？
- debug / raw log 是否需要 admin 或 debug.enabled？
- 是否泄露 API key、token、绝对路径、用户本地隐私？
- Preview iframe 是否保持 sandbox / CSP / 独立 origin？

### 9.5 Adapter 与外部进程

- adapter 是否诚实声明能力？
- ACP pending request 是否正确管理？
- cancel 与 dispose 是否分离？
- prompt 是否串行？
- 子进程是否 detached=false？
- daemon 退出是否清理进程树？
- raw stdout/stderr 是否脱敏？
- crash recovery 是否符合 manifest？

### 9.6 UI / 产品逻辑

- 群聊主流是否只展示 brief 和 actionable cards？
- Run Detail 是否承载完整上下文？
- 用户是否能理解 pending / waiting / review / failed 等状态？
- 是否有清晰的错误提示？
- 长任务是否有状态行节流？
- UI 是否避免把内部 debug 信息暴露给普通用户？

### 9.7 测试与验证

- 是否有单元测试覆盖核心逻辑？
- 是否有集成测试覆盖关键链路？
- 是否覆盖失败路径和边界条件？
- 是否运行了相关测试命令？
- 是否运行 OpenSpec strict？
- 是否需要新增 custom check？

### 9.8 范围控制

- 是否有无关重构？
- 是否引入未批准依赖？
- 是否实现了后续阶段能力？
- 是否把 V0.5 / V1.x 的占位能力提前做成真实功能？
- 是否修改了不该修改的文件？

## 10. 必须重点保护的核心契约

以下契约属于 AgentHub MVP 的骨架。任何修改都必须上级 agent 批准。

- `WakeAgent` 是模型调用唯一入口。
- 没有 `StartRun` Command。
- `RunLifecycleService` 是 `runs` 表和 `agent.run.*` durable event 的唯一写入口。
- Command 与 Event 分离。
- durable event 必须可重放。
- event envelope 由 `event-system` 持有。
- EventBus / CommandBus 接口不能随意变。
- RunQueue 通过锁矩阵调度。
- observe 是被动状态，不持续调用模型 API。
- 重型 coding agent 默认 run-level diff，不做每文件写入拦截。
- ArtifactFS 是 agent 写文件的闸口。
- Permission Engine 是权限裁决闸口。
- Context Ledger confirmed 必须有可信来源或用户裁决。
- 群聊主流只展示简讯，完整上下文进入 Run Detail。
- 单机本地产品，不做 SaaS、云端、多用户、Postgres、Redis、WebSocket Hub、Mobile Native、Marketplace。

## 11. 完成任务的定义

一个任务只有同时满足以下条件才算完成：

- 代码实现完成；
- 测试补齐并通过；
- OpenSpec strict 通过；
- PR 描述完整；
- 审查 agent 通过；
- 上级 agent 批准 merge；
- merge 后任务状态更新；
- 遗留问题已记录 issue，不是藏在代码注释里。

## 12. 不允许的行为

代码 agent 不允许：

- 在主分支直接改代码；
- 自己 merge 自己的 PR；
- 遇到 spec 不明确时自行发明协议；
- 为了测试通过降低校验标准；
- 跳过 Permission Engine 直接写文件或跑 shell；
- 跳过 RunLifecycleService 直接写 `runs` / `agent.run.*` event；
- 直接把参考项目架构搬进来；
- 引入未批准依赖；
- 提前实现后续阶段能力；
- 隐藏失败测试或未解决问题；
- 提交密钥、token、本地数据库、日志、临时文件。


## 13. 实施前提醒

AgentHub 的难点不在“写出能跑的代码”，而在保证多 agent、事件总线、Run 生命周期、权限、文件系统、UI 投影在长期演进中不互相打架。因此所有 agent 都要把以下问题放在心里：

- 这次改动会不会破坏可重放性？
- 这次改动会不会绕过唯一写入口？
- 这次改动会不会让 observe 变成隐形轮询？
- 这次改动会不会让重型 coding agent 被切得太碎？
- 这次改动会不会让主聊天流被内部细节淹没？
- 这次改动会不会把本地产品拉向云端平台？

如果答案不确定，先停下来，记录 issue，找上级 agent。

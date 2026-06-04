# Task Mode Group Chat Presentation Design

## Goal

Make `squad` and `team` rooms feel like visible group chats without changing their task-driven runtime semantics.

`assisted` remains the AutoGen-style selector group chat mode. `team` and `squad` remain AionUi-style task coordination modes: the leader delegates work through room tools, teammates execute bounded tasks, and team review rules stay intact.

## Reference Boundary

- AutoGen `SelectorGroupChat` is the model for `assisted` only: shared thread, speaker selection, bounded turns, termination.
- AionUi `TeamSession` / `Mailbox` is the model for `team` and `squad`: user messages enter the leader lane, leader uses MCP/mailbox/task tools, teammates wake for assigned work and report back.
- AgentHub should not make `team` or `squad` use selector by default.

## Presentation Rules

Task mode rooms should expose short public messages at human-readable moments:

- Delegation: the leader visibly hands work to a teammate.
- Start: the teammate visibly claims the task.
- Completion / review / blocked: the teammate visibly reports the outcome in one concise turn.
- Team review start: the leader visibly says review/synthesis is starting.
- Team review completion: the leader visibly says the batch is complete.

These messages are presentation artifacts over durable task events. They must not replace task records, mailbox delivery, `room.complete_task`, review transitions, or kanban state.

## Constraints

- Do not render raw task event names as chat bubbles.
- Do not show every task activity; only key lifecycle handoffs.
- Keep messages short and role-attributed.
- Long findings still belong in task summaries, artifacts, or file messages.
- `team` keeps `expectsReview=true` and leader review before final answer.
- `squad` keeps `expectsReview=false` by default and may complete tasks directly.

## Implementation Shape

Add a small orchestrator service that creates public assistant messages from task lifecycle facts. It writes normal `messages` and `message_parts` rows and publishes `message.created` plus `message.completed` in the same SQLite transaction.

Wire it into the existing task-mode boundaries:

- `room.delegate` after `task.delegation.created`
- delegated run start hook after `startDelegatedRun`
- `room.complete_task` after structured completion
- squad delegated-run auto-completion
- `team.dispatch.started`
- `team.dispatch.completed`

Prompt changes should reinforce the same behavior but should not be the only mechanism.

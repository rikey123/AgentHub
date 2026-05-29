# Final Code Quality Review 2

VERDICT: REJECT

## Verification

- `pnpm.cmd test`: PASS — 49 test files passed; 368 tests passed; 1 skipped.
- `pnpm.cmd lint`: PASS — ESLint completed with `--max-warnings=0`.

## Findings

### 1. Pending-turn failure rollback violates the event/state transaction contract

`packages/orchestrator/src/pending-turn.ts:121-124` reverts a scheduled pending turn back to `queued` when `WakeAgent` dispatch fails:

```ts
this.options.database.sqlite.prepare("UPDATE pending_turns SET status = 'queued', scheduled_at = NULL WHERE id = ? AND status = 'scheduled'").run(row.id);
return wake;
```

That mutation is outside `database.sqlite.transaction(...)` and publishes no matching event. The same consume path previously publishes `pending_turn.scheduled` inside a transaction (`lines 60-65`), so on wake failure durable replay/UI can observe `scheduled` while SQLite has been silently reverted to `queued`. This directly violates the project event-bus contract: every observed SQLite mutation must publish a matching event in the same transaction.

### 2. Task completion hook can run twice for one completion transition

`packages/orchestrator/src/task-service.ts:204-213` calls `updateStatus({ status: "completed" })`; `updateStatus` already invokes `onTaskCompleted` at `lines 195-198`. `complete()` then invokes `onTaskCompleted` again at `lines 209-212` when the result is ok.

The daemon wires `onTaskCompleted` to `maybePublishTeamDispatchCompleted` in `packages/daemon/src/index.ts:188`, so a single user completion can run the team-dispatch completion side effect twice. Even if downstream idempotence reduces duplicate visible events, the state-machine side effect should be single-source and covered by a meaningful assertion.

## Review notes

- Transaction/event boundaries in `packages/daemon/src/commands.ts` are generally correct for create room, archive/unarchive, send message, edit, pin, and delete paths: mutations and events are inside the same SQLite transaction.
- Task status transitions are centralized through `canTransition`, but the completion helper duplicates completion side effects.
- No `TODO`/`FIXME` markers were found in tracked TypeScript/TSX production code by `git grep`.
- The final suite is green, but the issues above are correctness defects not caught by tests.

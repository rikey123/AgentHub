<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **AgentHub** (11886 symbols, 23932 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/AgentHub/context` | Codebase overview, check index freshness |
| `gitnexus://repo/AgentHub/clusters` | All functional areas |
| `gitnexus://repo/AgentHub/processes` | All execution flows |
| `gitnexus://repo/AgentHub/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- event-bus-contract:start -->
# Event Bus Contract — Read Before Touching State

AgentHub's UI never reads SQLite directly. The frontend sees the world through one channel: durable events replayed + live events streamed by the daemon's `EventBus`. **If you mutate state without publishing an event, the UI cannot see it.** Every retrofit of a missing event has cost a debugging round and a refresh-loses-state bug. Don't add to the pile.

## The mental model

```
HTTP request / Command  ─►  service mutates SQLite  ─►  EventBus.publish(event)
                                                               │
                                                ┌──────────────┴──────────────┐
                                                ▼                             ▼
                                       outbox + events table          live SSE subscribers
                                       (durable replay)               (browser projector)
```

Three rules follow from this:

1. **State change without event = no UI update.** Refresh hides the bug because durable replay covers it; not refreshing exposes it.
2. **Event without state change = ghost.** The UI shows something the database doesn't have. Worse than no event.
3. **The two must happen in one atomic step.** Otherwise a crash between them desynchronises forever.

## Always do

- **Publish inside the same SQLite transaction as the mutation.** `database.sqlite.transaction(() => { ...mutate...; eventBus.publish(...) })()`. Pattern is everywhere in `packages/daemon/src/commands.ts` — copy it. `EventBus.publish()` is sync and re-entrant on the same connection, savepoints handle nesting.
- **Register every new event type in `packages/protocol/src/events/registry.ts`.** The registry is the source of truth: it carries `category`, `durability`, `visibility`, `schemaVersion`. Unregistered types fail validation in `EventBus`.
- **Pick `durability` deliberately:**
  - `durable` — survives daemon restart, replays on SSE reconnect. Use for any state the UI must reconstruct from scratch (room/message/run/agent/permission/context lifecycle).
  - `ephemeral` — live-only, never replayed. Use for status lines, deltas, heartbeats, raw stdout, typing indicators.
- **Pick `visibility` deliberately:**
  - `main` — included in the room-level SSE stream that drives the chat view.
  - `detail` — included only in the run-detail SSE stream (RunDetailDrawer).
  - `both` — both streams. Use this for state the chat **and** the drawer need.
- **Update the projector if you add a `main`-visible durable event.** `apps/web/src/hooks/useProjector.ts` is the only consumer the chat UI has. New event type with no projector handler = silent drop.
- **When unsure whether a path publishes**, run `gitnexus_query({query: "your concept"})` and check the listed processes for `eventBus.publish` calls. The bus is the spine of every execution flow in this repo.

## Never do

- **NEVER mutate SQLite from a service / adapter / command without a matching publish.** No exceptions for "internal" tables — mailbox, run_locks, presence, agent_profiles, attachments are all observed by the UI today or will be tomorrow.
- **NEVER call `eventBus.publish` from the renderer / UI layer.** The bus lives in the daemon process. UI reacts via projector, not by re-emitting.
- **NEVER fabricate events from the UI to "fix" a missing one.** That bug bit us in `App.handleCreateRoom` once. Find the missing publish on the daemon side and add it there.
- **NEVER bypass the registry by passing an unregistered `type` string.** `EventBus.prepareEnvelope` will throw, and even if it didn't, the projector's discriminated union would drop it.
- **NEVER mark an event `durable` if the payload is large or per-frame.** Token deltas, raw stdout, heartbeats, status lines — those are `ephemeral` for a reason. Durable events fan out to the outbox table on every publish.

## Checklist when adding a new write path

Before you call yourself done, walk this list:

1. The mutation runs inside a `database.sqlite.transaction(...)` block.
2. At least one event is published inside that same transaction, after the writes.
3. The event type is registered in `packages/protocol/src/events/registry.ts` with the right `durability` and `visibility`.
4. If the event affects what the chat view shows: `visibility` includes `main` **and** `useProjector.ts` has a handler for it.
5. If the event affects the run-detail drawer: `visibility` includes `detail` and the drawer's projector handles it.
6. The `payload` is the minimum the UI needs to update its view model — not the whole DB row. Projector reconstructs from these fields plus prior state.
7. A test exercises the path and asserts the event is published. `packages/bus/test/event-bus.test.ts` shows the assertion shape.
8. Manual check in browser: trigger the path, verify the UI updates **without a refresh**. If a refresh is required, an event is missing or `visibility` is wrong.

## Common smells

- "It works after I refresh" → durable replay is covering for a missing live publish, **or** projector misses the live event. Both are bugs, not features.
- "Members disappear on refresh" → mutation happened in HTTP handler but durable event was not published in the same tx, so replay can't rebuild state.
- "UI shows X then snaps back" → ghost event published before (or without) the SQLite write committed.
- "Run detail tab is empty but chat shows the run" → wrong `visibility`. Probably emitted as `main` only, drawer's stream filtered it out.
- "Event arrives twice on reconnect" → durable event published outside a transaction, outbox dispatcher drained it before SQLite committed, then again after.

## Where the contract is enforced

- `packages/bus/src/index.ts` — `EventBus.publish`, `prepareEnvelope`, outbox marking, durable-notifier hook.
- `packages/protocol/src/events/registry.ts` — registry + envelope schema.
- `packages/daemon/src/index.ts` — SSE replay endpoint that fans events out by `visibility`.
- `apps/web/src/hooks/useProjector.ts` — the only client-side consumer; if it doesn't handle your event, the UI doesn't see it.

When in doubt, read those four files in order — that's the whole contract in code.
<!-- event-bus-contract:end -->

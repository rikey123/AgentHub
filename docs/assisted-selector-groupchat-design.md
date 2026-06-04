# Assisted Selector GroupChat Design

This document records the design basis for making AgentHub `assisted` mode feel like a real group chat. It is intentionally separate from the implementation so future work can survive context compaction without losing the reference decisions.

## Decision

`assisted` mode should use an AutoGen-style `SelectorGroupChat` mechanism rather than a hand-written "wake 1-2 agents" heuristic.

The first implementation should use a selector from day one, not round-robin as the default. Round-robin may remain as a debug or fallback strategy, but the user-facing assisted experience should be context-aware.

## Reference Sources

Primary code-level reference:

- `C:\project\refrence\autogen`
- Remote: `https://github.com/microsoft/autogen.git`
- Observed commit: `027ecf0a3`
- Code license file: `C:\project\refrence\autogen\LICENSE-CODE` (MIT)

AutoGen files to consult before implementation:

- `C:\project\refrence\autogen\python\packages\autogen-agentchat\src\autogen_agentchat\teams\_group_chat\_selector_group_chat.py`
- `C:\project\refrence\autogen\python\packages\autogen-agentchat\src\autogen_agentchat\teams\_group_chat\_base_group_chat_manager.py`
- `C:\project\refrence\autogen\python\packages\autogen-agentchat\src\autogen_agentchat\teams\_group_chat\_round_robin_group_chat.py`
- `C:\project\refrence\autogen\python\packages\autogen-agentchat\tests\test_group_chat.py`
- `C:\project\refrence\autogen\python\docs\src\user-guide\agentchat-user-guide\selector-group-chat.ipynb`

Relevant AutoGen mechanics:

- `SelectorGroupChat` is a team where participants publish messages to all members, and a ChatCompletion model selects the next speaker based on shared conversation context.
- `BaseGroupChatManager` owns the message thread, waits for active speakers to finish, appends the completed response to the thread, applies termination/max-turn rules, then transitions to the next selected speaker. This ordering matters: AgentHub should decide whether the group should stop before asking the selector to keep the group going.
- `ChatAgentContainer` buffers group messages and passes that shared buffer into the selected participant when it receives `GroupChatRequestPublish`. AutoGen does not hard-code a "quote the previous speaker" rule; the group-chat feel comes from every participant seeing the shared message thread.
- `SelectorGroupChatManager.select_speaker()` uses this stack:
  1. `selector_func` override if it returns a valid speaker.
  2. `candidate_func` to filter participants when no selector override is set.
  3. model-based selection from candidate participants.
  4. `allow_repeated_speaker` guard, default false.
  5. `max_selector_attempts`, default 3.
  6. fallback to previous speaker or first participant.
- `selector_prompt` includes `{roles}`, `{participants}`, and `{history}` and instructs the selector to return only one role.
- `termination_condition` and `max_turns` are required guardrails. Without them a group chat can keep running.

Secondary reference for AgentHub-compatible wake/message lifecycle:

- `C:\project\refrence\AionUi\src\process\team\TeamSession.ts`
- `C:\project\refrence\AionUi\src\process\team\TeammateManager.ts`
- `C:\project\refrence\AionUi\src\process\team\mcp\team\TeamMcpServer.ts`

AionUi is not a selector-group-chat implementation. It should be used for mailbox, teammate wake, lifecycle, and tool ergonomics. AutoGen should be used for assisted speaker selection and turn control.

## AgentHub Mapping

| AutoGen concept | AgentHub concept |
| --- | --- |
| `SelectorGroupChat` | `assisted` room group turn |
| `participants` | Room members/agent bindings eligible to speak |
| participant `name` | Role/agent display name |
| participant `description` | Role description, persona summary, skill summary |
| `BaseGroupChatManager.message_thread` | Room visible chat history plus current group turn messages |
| `selector_func` | Deterministic override for @mentions and explicit user target |
| `candidate_func` | Filter available active members with runtime/model readiness |
| model selector | Cheap/configurable model call that selects the next speaker |
| `allow_repeated_speaker` | Default false within the same user turn |
| `max_selector_attempts` | Default 3 |
| `max_turns` | Assisted per-user-message speaker budget, default 3 |
| `GroupChatRequestPublish` | Existing `WakeAgent` path for selected agent |
| group output events | Durable chat messages and run events through AgentHub EventBus |

## First Implementation Scope

Implement assisted selector behavior for real conversations:

- On a user message in an `assisted` room, create a bounded group turn.
- Use deterministic selector overrides for explicit `@agent` mentions.
- Use a candidate filter to include only room members that are enabled and can run.
- Use a model-based selector when more than one candidate remains.
- Wake one selected speaker at a time.
- After the selected agent completes, refresh the selector thread from the room transcript and let the group manager decide whether to stop or select another speaker.
- Stop after `max_turns` selected speakers for that user message.
- Default `allow_repeated_speaker` to false for the immediately previous speaker. A speaker can return after another participant has spoken, matching AutoGen's previous-speaker guard rather than a "speak only once" rule.
- Default `max_selector_attempts` to 3.
- If selector output is invalid after retries, fallback to the previous speaker when one exists, otherwise the primary/leader or first valid candidate.
- Keep task/run/system notifications out of the chat transcript. Only real user/agent chat messages should appear as chat bubbles.

Do not implement a bespoke "always wake 1-2 active members" algorithm. If a deterministic shortcut is needed, express it as `selector_func` or `candidate_func`, matching AutoGen's shape.

## Selector Prompt Shape

The selector prompt should follow AutoGen's structure but be adapted to AgentHub:

```text
You are managing an AutoGen-style SelectorGroupChat for AgentHub assisted mode.

First inspect the shared conversation history.
If the latest assistant message already gives a final synthesis, answers the user, or leaves no distinct non-redundant contribution for another participant, return NO_SPEAKER.
Otherwise choose exactly one candidate whose role can add the most useful next contribution.
Do not choose a speaker just to keep the group going.

Roles:
{roles}

Conversation:
{history}

Candidates:
{participants}

Choose exactly one candidate who should speak next.
Return NO_SPEAKER only if the group should stop because the conversation is complete or no candidate should reply.
Return only the candidate id, candidate name, or NO_SPEAKER. Do not explain.
```

The parser must accept only exact valid participant ids/names. It should also accept AutoGen-compatible underscore variants, so `Story_writer`, `Story writer`, and `Story\_writer` refer to the same participant name. If the model returns none, multiple names, an unknown name, or the previous speaker when repeats are disabled, retry with feedback. Do not silently wake an unknown agent.

## Speaker Prompt Shape

AutoGen's participant agents receive the shared group buffer through their container. In AgentHub, assisted participants are independent room agents, so the first-wake prompt must make that shared-thread behavior explicit:

- Treat the room transcript as the shared group message thread.
- When another agent spoke immediately before the current speaker, briefly reference the concrete point being answered.
- Add one useful group-chat move: agree and extend, challenge with a reason, clarify a missing detail, or synthesize.
- Do not restate the previous speaker's whole answer.
- If the discussion already feels complete, give a concise closing synthesis and stop instead of forcing another handoff.

## Termination Rules

First implementation should stop the group turn when any of these is true:

- `max_turns` selected speakers have completed.
- No valid candidate remains after filtering.
- Selector repeatedly fails and fallback has already been used once.
- The user sends a new message that supersedes the active group turn.
- The completed speaker produced no visible public response.
- The completed speaker only acknowledged the handoff, such as `ok`, `got it`, `收到`, or `明白`.
- The selector explicitly returns `STOP` or `NO_SPEAKER`.

The shipped pass implements `max_turns`, candidate exhaustion, retry/fallback, new-user-message superseding, empty/ack-only response termination, and selector `STOP` / `NO_SPEAKER` termination.

Do not let agent-to-agent messages recursively wake unlimited participants in `assisted`.

## Frontend Status Rules

AutoGen can emit `SelectSpeakerEvent` as a team/debug event. AgentHub should not render that as a normal chat bubble.

The public chat UI uses existing `agent.run.*` events to show lightweight group-turn state:

- `agent.run.queued` carries `wakeReason` and `messageId`.
- The web projector stores those fields on `RunViewModel`.
- For `assisted` rooms, the bottom typing indicator shows the selected agent as a speaker handoff: `<Agent> is speaking`, with `Group turn N` derived from runs sharing the same user `messageId`.
- Selector/debug events, if added later, should go to the detail/debug surface or a transient notification, not the message timeline.

## Event Bus Contract

All state mutations must follow AgentHub's event bus contract:

- Any new group-turn state must be written in the same SQLite transaction as its event.
- New event types, if introduced, must be registered in `packages/protocol/src/events/registry.ts`.
- Main-visible durable events must be handled by `apps/web/src/hooks/useProjector.ts`.
- Agent chat messages must remain durable and visible in room replay.
- Selector debug/status events, if added, should be `detail` or ephemeral unless the chat UI needs them.

## Tests To Mirror From AutoGen

Translate these AutoGen behaviors into AgentHub tests:

- Selector picks the speaker returned by the model.
- `@mention`/selector override skips model selection.
- Candidate filtering narrows the selector options.
- Repeated speaker is rejected by default.
- A speaker can return after a different participant has spoken.
- Invalid selector outputs retry up to `max_selector_attempts`.
- Retry feedback distinguishes no valid name, multiple names, and repeated previous speaker.
- Selector fallback wakes a valid participant after repeated invalid outputs.
- Mid-thread fallback prefers the previous speaker, matching AutoGen.
- `max_turns` stops a group turn.
- A new user message supersedes the previous active group turn in the same room.
- Group turn waits for selected speaker completion before selecting the next speaker.
- Continuation selector calls include the completed speaker's latest public output in `history`, mirroring AutoGen's `_message_thread` update before speaker selection.

## Non-Goals For First Implementation

- Do not implement full AutoGen runtime.
- Do not port AutoGen Python code wholesale.
- Do not make `team` or `squad` use selector by default.
- Do not add a new public workflow engine for this change.
- Do not show selector/debug events as normal chat messages.

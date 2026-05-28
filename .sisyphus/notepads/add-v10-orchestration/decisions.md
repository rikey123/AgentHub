# Decisions — add-v10-orchestration

## [2026-05-29T00:34:45Z] Session start
- Authority order: OpenSpec tasks/specs > design/proposal > workflow manual > existing conventions.
- Settings UI: REST-only, no SSE subscription.
- Role generation: role_drafts + REST polling, no EventBus events.
- Native Runtime: explicit AI SDK 5.x providers, no string model IDs.
- Squad/Team: canonical Task creation/dispatch path shared.
- permission.run_summary: MUST display in Run Detail Permissions tab (detail SSE/projector or REST/audit endpoint); debug/audit-only is not acceptable without OpenSpec update.
- room.delegate: Task insert + run enqueue + events must be atomic; no silent half-success.
- task.created/task.status.changed projector: must support full V1.0 payload semantics; no legacy todo fallback.
- role_drafts: part of 0.1 initial schema contract.

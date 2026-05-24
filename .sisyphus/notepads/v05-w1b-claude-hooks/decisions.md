
## W1B Claude hooks - 2026-05-24
- Stored context.snapshot idempotencyKey in ContextItem.sourceMessageId for summary drafts, allowing duplicate snapshot events to be detected without schema changes.
- Kept artifact.diff.detected as an event-only marker and did not create artifact rows; final DiffArtifact creation remains ArtifactFS run-end behavior.
- Added @agenthub/protocol as an explicit @agenthub/context dependency because snapshot handling imports the event envelope type.

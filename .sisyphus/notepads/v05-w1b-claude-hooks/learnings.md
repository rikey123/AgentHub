
## W1B Claude hooks - 2026-05-24
- Claude adapter hook completion mapping can stay inside packages/adapters/claude-code by publishing canonical run events directly via services.eventBus when AdapterBridge lacks required payload fields such as idempotencyKey or duration/cost.
- artifact.diff.detected is ephemeral/detail, so tests must observe it through EventBus.subscribe rather than querying the durable events table.
- ContextLedger receives durable context.snapshot events after EventBus.deliverPersisted/outbox delivery and should use propose() so generated summaries remain draft.

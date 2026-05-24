
## ¡ì0.3 BriefGenerator
- packages/context keeps exports in src/index.ts; HeuristicBriefGenerator.generate() returns Effect.succeed(...) and stays pure/synchronous for V0.5.
- The context package needed an explicit effect dependency once its public interface imported Effect; run tests through pnpm.cmd on Windows when pnpm.ps1 is blocked by execution policy.
- packages/protocol/src/domains.ts did not define RunFailureClass at this point, so ¡ì0.3 used a local compatible context union to stay within the package boundary.


## Task 0.4 run lifecycle brief publishing - 2026-05-24
- RunLifecycleService terminal methods can safely publish message.brief.published immediately after the existing agent.run.* event inside withTransaction(); EventBus durable persistence participates in the same better-sqlite3 transaction/savepoint.
- The brief timestamp update should target messages by run_id, role='assistant', and status='completed'; zero matching rows is expected and not an error.
- Avoid naming focused tests run-lifecycle-*.test.ts unless they expose every RunLifecycleService method; run-state-machine:check scans those filenames for full lifecycle coverage.

- 2026-05-24: Ran all required v0.5 CI checks individually and via check:all.
- Observation: pnpm.exe is blocked by local PowerShell execution policy here, so pnpm.cmd is the reliable runner in this environment.
- Result: All checks passed; no fixture/registry fixes were needed.

## W0 Oracle review - 2026-05-24
- APPROVE: W0 foundation is spec-compliant and merge-ready. Verified targeted tests plus typecheck/lint/check:all pass.
- ¡ì0.4 publishes message.brief.published after terminal agent.run.* event inside RunLifecycleService.withTransaction(); EventBus nested better-sqlite3 transaction/savepoint keeps events/outbox and messages.brief_published_at atomic when lifecycle and bus share the same AgentHubDatabase instance.
- WHERE clause for brief timestamp matches spec exactly: run_id + role='assistant' + status='completed'; no dependency on runs.message_id.


## W1C agent templates implementation
- Added @agenthub/agents as the owner for built-in markdown templates, first-launch bootstrap, gray-matter parsing, DB upsert/removal, explicit reset, and chokidar hot reload.
- Vitest package scripts run from the package cwd; for @agenthub/agents the script uses '--root ../.. packages/agents/test/agents.test.ts' so the repo-level include discovers the test file on Windows.
- Durable agent.profile.updated/removed events are persisted to the events table; package tests assert the events table rather than in-memory subscriber delivery for those durable events.

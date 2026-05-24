
## ��0.3 BriefGenerator
- packages/context keeps exports in src/index.ts; HeuristicBriefGenerator.generate() returns Effect.succeed(...) and stays pure/synchronous for V0.5.
- The context package needed an explicit effect dependency once its public interface imported Effect; run tests through pnpm.cmd on Windows when pnpm.ps1 is blocked by execution policy.
- packages/protocol/src/domains.ts did not define RunFailureClass at this point, so ��0.3 used a local compatible context union to stay within the package boundary.


## Task 0.4 run lifecycle brief publishing - 2026-05-24
- RunLifecycleService terminal methods can safely publish message.brief.published immediately after the existing agent.run.* event inside withTransaction(); EventBus durable persistence participates in the same better-sqlite3 transaction/savepoint.
- The brief timestamp update should target messages by run_id, role='assistant', and status='completed'; zero matching rows is expected and not an error.
- Avoid naming focused tests run-lifecycle-*.test.ts unless they expose every RunLifecycleService method; run-state-machine:check scans those filenames for full lifecycle coverage.

- 2026-05-24: Ran all required v0.5 CI checks individually and via check:all.
- Observation: pnpm.exe is blocked by local PowerShell execution policy here, so pnpm.cmd is the reliable runner in this environment.
- Result: All checks passed; no fixture/registry fixes were needed.

## W0 Oracle review - 2026-05-24
- APPROVE: W0 foundation is spec-compliant and merge-ready. Verified targeted tests plus typecheck/lint/check:all pass.
- ��0.4 publishes message.brief.published after terminal agent.run.* event inside RunLifecycleService.withTransaction(); EventBus nested better-sqlite3 transaction/savepoint keeps events/outbox and messages.brief_published_at atomic when lifecycle and bus share the same AgentHubDatabase instance.
- WHERE clause for brief timestamp matches spec exactly: run_id + role='assistant' + status='completed'; no dependency on runs.message_id.


## W1C agent templates implementation
- Added @agenthub/agents as the owner for built-in markdown templates, first-launch bootstrap, gray-matter parsing, DB upsert/removal, explicit reset, and chokidar hot reload.
- Vitest package scripts run from the package cwd; for @agenthub/agents the script uses '--root ../.. packages/agents/test/agents.test.ts' so the repo-level include discovers the test file on Windows.
- Durable agent.profile.updated/removed events are persisted to the events table; package tests assert the events table rather than in-memory subscriber delivery for those durable events.

## W2A chat backend implementation
- Assisted room mention routing now uses packages/orchestrator/src/mention-parser.ts and WakeAgent idempotency keys wake:<messageId>:<agentId>. Mentions that omit the primary intentionally wake only mentioned agents.
- RoomMcpServer cannot import @agenthub/security without adding an orchestrator package dependency; audit-shaped observer sends are published through the injected EventBus using registered event type server.connected.
- command:check derives canonical commands from openspec/specs/bus-runtime/spec.md, so PinMessage was implemented as a self-contained command handler rather than nested WriteContextItem dispatch.
- Windows worktrees may need pnpm.cmd install before package test scripts can find node_modules/.bin/vitest.cmd.

## W3 web UI completion - 2026-05-24
- Committed W3 web UI work in six semantic commits on task/v05-w3-web-features.
- Final verification: cmd /c pnpm --filter @agenthub/web build exits 0; LSP diagnostics for apps/web reports 0 errors.
- Root cmd /c pnpm typecheck is blocked by existing packages/adapters/claude-code/test/claude-code-adapter.test.ts constructor fixture error outside the W3 web scope.
- packages/daemon/src/commands.ts still has an uncommitted out-of-scope change and was intentionally not included because the task constrained commits to apps/web/** and pnpm-lock.yaml.

## v05-w5-final web cleanup - 2026-05-24
- RoomMembersPopover needed explicit VirtualItem and Floating UI middleware parameter types to satisfy TypeScript under noImplicitAny.
- pnpm.cmd install was required in this Windows worktree before typecheck could resolve @floating-ui/react, @tanstack/react-virtual, and ansi-to-html from the lockfile.
- Repository lint clean-up was mostly unused bindings/imports in apps/web and one console warning guard in the OpenCode adapter smoke test.

## Oracle F1 remediation - 2026-05-24
- AdapterRegistry routes both opencode and opencode-default to OpenCodeACPAdapter, matching builder-opencode profiles.
- SendMessage persistence keeps quotedMessageId in messages.quoted_message_id, stores mentions in text part payloads, and associates uploaded attachments by file_id.
- Mailbox delivery failures persist delivery_failure_reason and failed rows are excluded from future claimUnread selection; lifecycle fatal/configuration failures publish target_unavailable for claimed mailbox rows.
- Terminal artifact previews are sourced from artifact metadata stdoutPreview/stderrPreview; cost panel consumes the daemon/spec CostSummaryResponse with groups plus total and epoch-ms query bounds.

# 2026-05-25
- For `TerminalCard` E2E coverage, the test must seed a real `artifacts` row with `type="terminal"` and enough stdout lines to expose the expand control; otherwise the modal path never renders.

- 2026-05-25: Real ACP adapters need the daemon command bus propagated through AdapterRegistry services for AdapterBridge terminal tool completions to create terminal artifacts. Use lazy getCommandBus: () => commandBusRef.current to avoid daemon startup circularity, and conditionally spread optional commandBus values for exact optional property compatibility.

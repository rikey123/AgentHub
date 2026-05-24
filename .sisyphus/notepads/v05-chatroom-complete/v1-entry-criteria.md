# V1.0 Entry Criteria Checklist

> Generated after V0.5 implementation. Checklist only — no V1.0 design or implementation.
> Source: `openspec/changes/add-v05-chatroom-complete/design.md` Roadmap Beyond MVP section.

## V1.0 Prerequisites (Squad Mode + Team Mode + Deployment)

- ✅ **Second real adapter (OpenCode)**: OpenCodeACPAdapter implemented and tested. V1.0 multi-adapter scenarios are unblocked.
- ✅ **Adapter abstraction validated**: V0.5 added OpenCode without changing AgentRuntimeAdapter/ACPAdapter base interfaces. V1.0 can add more adapters safely.
- ✅ **RunLifecycleService terminal brief tx**: V0.5 extended terminal methods with briefText. V1.0 can build on this for richer brief generation.
- ✅ **BriefGenerator interface**: V0.5 defined the interface with HeuristicBriefGenerator. V1.2 LlmBriefGenerator can swap in without changing RunLifecycleService.
- ✅ **AgentProfile hot reload**: chokidar watcher implemented. V1.0 dynamic agent management is unblocked.
- ✅ **Mailbox failure visibility**: mailbox.delivery.failed event and UI card implemented. V1.0 multi-agent coordination has observable failure paths.
- ✅ **@mention dispatch**: Assisted mode mention parsing and WakeAgent dispatch implemented. V1.0 Squad Mode can build on this.
- ✅ **Group discipline**: Observer send_message downgrade to mailbox implemented. V1.0 Team Mode discipline is unblocked.
- ✅ **Cost panel**: GET /workspaces/:id/cost-summary API and UI implemented. V1.5 budget alerts can extend this.
- ✅ **config.toml + CLI**: Daemon config loading and CLI subcommands implemented. V1.0 deployment hygiene is unblocked.
- ✅ **SIGINT graceful stop**: 30s in-flight wait + forced cancel implemented. V1.0 production deployment is unblocked.
- ✅ **Cursor-based pagination**: Message pagination implemented. V1.0 large room history is unblocked.
- ✅ **Frontend polish**: Theme/density/keyboard/virtualization/a11y baseline implemented. V1.0 UI can build on this foundation.
- ✅ **5 CI checks all green**: events:check, visibility:check, subscriptions:check, command:check, run-state-machine:check all pass.
- ✅ **34/34 test files pass**: Full test suite green including E2E.

## V1.0 Deferred Items (not blocking V1.0 start)

- ⚠️ **Terminal artifact full PTY persistence**: Only preview stored (PF.5 finding). TerminalCard renders preview only. Full stdout/stderr persistence is a V1.0 backend task.
- ⚠️ **Attachment orphan schema**: attachments.message_id is NOT NULL; orphan upload support needs schema change. Tracked in issues/attachments-schema-orphan.md.
- ⚠️ **E2E coverage for V0.5 features**: v05-chatroom-features.spec.ts exists but some flows require running daemon with specific state. Coverage is partial.
- ❌ **Squad Mode / Team Mode**: Not implemented (V1.0 scope per design.md).
- ❌ **Codex/LangGraph/A2A adapters**: Stubs only (V1.x scope).
- ❌ **Memory / vector search**: Not implemented (V1.2 scope).
- ❌ **Responsive / PWA / Tauri**: Not implemented (V1.4 scope).
- ❌ **Budget alerts**: POST /cost-budget returns 501 (V1.5 scope).

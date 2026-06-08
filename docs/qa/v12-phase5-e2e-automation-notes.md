# V1.2 Phase 5 E2E Acceptance Notes

Date: 2026-06-08
OpenSpec change: `add-v12-artifact-studio`
Worktree: `C:\project\AgentHub\.worktrees\v12-integration-final`

This note records the evidence used to close Phase 5 tasks `5.2` through `5.7`. It intentionally does not close `5.10`; archive remains a separate explicit step.

## Environment

Installed and detected on this machine:

- `officecli`: `1.0.106`
- `claude`: `2.1.168 (Claude Code)`
- `opencode`: `1.14.48`
- `codex`: `codex-cli 0.134.0`

OfficeCLI was installed at:

```text
C:\Users\26943\AppData\Local\OfficeCLI\officecli.exe
```

The daemon OfficeCLI detection was updated so Windows sessions whose PATH has not refreshed can still find `%LOCALAPPDATA%\OfficeCLI\officecli.exe`.

## Key Implementation Evidence

### OfficeCLI / PPTX Preview

Evidence captured during this integration closeout:

- `officecli --version` via the installed path returned `1.0.106`.
- A real OfficeCLI preview acceptance script created a PPTX and started `officecli watch` through `createPptPreviewBridge`.
- Real preview bridge response evidence:

```json
{"status":200,"port":41077,"pid":69368,"bodyBytes":92554}
```

Additional automated coverage:

- `packages/daemon/test/ppt-preview-bridge.test.ts` verifies detection, current installer source, retry, active ports, and stop behavior.
- `apps/web/e2e/v12-artifact-studio.spec.ts` now verifies that a `presentation_pptx` card starts the daemon preview route, renders a proxied iframe, and stops the active preview session when the card unmounts.
- The existing inactive-port check still verifies `/api/ppt-proxy/:port/*` returns `403` for non-active ports.

### Real Runtime Acceptance

Real runtime acceptance was run with no daemon `adapterCommands` override.

Claude Code:

```json
{
  "latestRun": {
    "status": "completed",
    "adapter_id": "claude-code",
    "agent_id": "binding-real-claude"
  },
  "artifacts": [
    {
      "title": "REAL_CLAUDE_RUNTIME_ACCEPTANCE",
      "kind": "web_page",
      "path": "real_claude_runtime_acceptance.html"
    }
  ]
}
```

OpenCode:

```json
{
  "latestRun": {
    "status": "completed",
    "adapter_id": "opencode",
    "agent_id": "binding-real-opencode"
  },
  "artifacts": [
    {
      "title": "Runtime Acceptance Marker",
      "kind": "document",
      "path": "runtime-acceptance.md"
    }
  ]
}
```

The opt-in browser spec `apps/web/e2e/v12-real-runtime-acceptance.spec.ts` verifies:

- Claude Code health/test connection.
- Claude Code solo room run completion.
- Claude Code `web_page` artifact and visible PreviewCard.
- OpenCode health/test connection.
- OpenCode solo room run completion.
- OpenCode `document` artifact and visible DocumentCard.
- Contact status returns to `available` after runs.
- Codex remains displayed as experimental and is not counted as a mainline runtime gate.

During closeout, one real Claude Code run reached `mcp__agenthub-room__room_publish_artifact` but Claude Code denied the MCP publish as an external collaboration action from an untrusted AgentHub message. The E2E fixture now writes a test-local `.claude/settings.local.json` under the temporary workspace with `permissions.defaultMode = "bypassPermissions"`, so the opt-in real-runtime acceptance is noninteractive and does not modify the user's global Claude settings.

Latest focused evidence:

```powershell
cmd /c pnpm.cmd exec playwright test apps/web/e2e/v12-real-runtime-acceptance.spec.ts --workers=1 --reporter=list
```

Result: 1 passed, 1 skipped. The skipped test is the opt-in real runtime scenario when `AGENTHUB_REAL_RUNTIME_E2E` is not set; the fixture self-check passed.

```powershell
cmd /c "set AGENTHUB_REAL_RUNTIME_E2E=1&& pnpm.cmd exec playwright test apps/web/e2e/v12-real-runtime-acceptance.spec.ts --workers=1 --reporter=list"
```

Result: 2 passed. Claude Code and OpenCode both completed solo runs and published visible artifacts.

### AdapterBridge Timeout Race

A real OpenCode acceptance run exposed a watchdog callback after terminal session close. This was fixed in `packages/orchestrator/src/adapter-bridge.ts` by making the watchdog terminal-aware and checking persisted run status before leader notification.

Regression coverage:

- `packages/orchestrator/test/timeout-escalation.test.ts`
- Test case: terminal sessions clear watchdogs and do not notify after completion.

## Task Acceptance Mapping

### 5.2 E2E: Artifact Generation And Preview

Accepted.

Covered by:

- Browser artifact generation/preview E2E:
  - PreviewCard sandbox iframe.
  - Artifact Studio preview modal.
  - DocumentCard reference pill.
  - HTML PresentationCard slide navigation and slide reference pill.
  - PPTX PresentationCard daemon-started proxied iframe.
  - Preview session stop on card unmount.
  - Inactive PPT proxy returns `403`.
- Real runtime scripts and opt-in browser spec prove Claude/OpenCode can publish visible artifacts through Room MCP.
- OfficeCLI real preview script proves the actual `officecli watch` bridge path works on this machine.

### 5.3 E2E: Artifact Editing And Version History

Accepted.

Covered by:

- Browser Artifact Studio flow:
  - Edit HTML in Monaco.
  - Save with Ctrl/Cmd+S.
  - New text version written with save message.
  - History tab updates.
  - Text diff route and UI.
  - Restore prior text version.
  - Agent update of an existing artifact creates a new History version.
  - Binary PPTX History shows metadata.
  - Binary PPTX restore updates `content_path`, hash, and size metadata.
- Lower-level artifact versioning tests cover text/binary storage and restore behavior.

### 5.4 E2E: Deployment Publish

Accepted with environment-gated interpretation for optional external tooling.

Covered by:

- `preview-url` deployment creation and DeploymentCard projection.
- Static-site publish and stable URL across daemon restart.
- Static-site stop/unpublish behavior.
- Source zip download and archive inspection.
- Container export download and Dockerfile/context inspection.
- Container-build fallback when Docker/Nixpacks are unavailable.
- Deployment cancel and cancelled status projection.
- In-progress deployment marked failed after daemon restart.
- Log UI with REST fallback.

Environment-gated:

- Real Docker/Nixpacks image-tag production is only expected when those CLIs are installed.
- Real CapRover deployment is only expected when a provider is configured.
- CapRover request contract is covered by daemon/provider tests.

### 5.5 E2E: Group Chat Orchestrator

Accepted.

Covered by:

- Browser E2E verifies visible dispatch announcements.
- Browser E2E verifies short member message plus separate Artifact Card.
- Browser E2E verifies visible failure downgrade message.
- Browser E2E verifies final orchestrator summary.
- Orchestrator package acceptance tests cover live backend dispatch/aggregate behavior and wake-outbox integration.
- AdapterBridge timeout regression coverage prevents post-terminal watchdog notifications from corrupting the runtime flow.

### 5.6 E2E: IM Experience And Frontend Entry

Accepted.

Covered by:

- FeatureRail visible results for Chat, Contacts, Runs, Tasks, Artifacts, and Settings.
- Contact-first New Chat flow.
- Advanced role/runtime/model/skills configuration remains available.
- Contact card avatar/runtime/status/capability display.
- Start Chat from existing and newly created contacts.
- New Agent creation through Contacts rail and `/agents/custom`.
- RoomList search, pin sorting, archive filtering, and no-refresh updates.
- Pinned Context drawer no-refresh update.
- Pinned context is consumed by a subsequent run.
- Message actions: Reply, Quote, Unpin, Regenerate availability, Copy Code, Apply Diff, Reject Diff, Expand Preview.

### 5.7 E2E: Runtime Acceptance

Accepted.

Covered by:

- Claude Code real adapter run creates a `web_page` artifact.
- OpenCode real adapter run creates a `document` artifact.
- Browser opt-in real-runtime spec verifies health/test connection, run completion, expected artifact card visibility, and status returning to `available`.
- Codex is displayed as experimental and excluded from the mainline runtime acceptance gate.

## Latest Verification Commands

Final pre-archive commands run during the closeout:

```powershell
cmd /c pnpm.cmd test
```

Result: 104 test files passed; 916 passed, 1 skipped.

```powershell
cmd /c pnpm.cmd check:all
```

Result: 6 custom checks passed.

```powershell
cmd /c pnpm.cmd typecheck
```

Result: passed.

```powershell
cmd /c pnpm.cmd lint
```

Result: passed.

```powershell
cmd /c pnpm.cmd --filter @agenthub/web build
```

Result: passed. Vite emitted the existing large chunk warning.

```powershell
cmd /c openspec.cmd validate add-v12-artifact-studio --strict
```

Result: `Change 'add-v12-artifact-studio' is valid`.

```powershell
git diff --check
```

Result: exit code 0; Windows line-ending warnings only.

Focused Phase 5 commands:

```powershell
cmd /c pnpm.cmd exec vitest run apps/web/src/components/cards/CardRenderer.v12.test.tsx --reporter=verbose
cmd /c pnpm.cmd exec vitest run packages/daemon/test/ppt-preview-bridge.test.ts --reporter=verbose
cmd /c pnpm.cmd exec vitest run packages/orchestrator/test/timeout-escalation.test.ts --reporter=verbose
cmd /c pnpm.cmd exec vitest run packages/orchestrator/test/timeout-escalation.test.ts packages/daemon/test/ppt-preview-bridge.test.ts --reporter=verbose
cmd /c pnpm.cmd exec vitest run packages/daemon/test/v12-artifacts-backend.test.ts --reporter=verbose -t "ppt preview"
cmd /c pnpm.cmd exec vitest run packages/daemon/test/v12-artifacts-backend.test.ts packages/daemon/test/ppt-preview-bridge.test.ts packages/orchestrator/test/timeout-escalation.test.ts --reporter=verbose
cmd /c pnpm.cmd exec playwright test apps/web/e2e/v12-artifact-studio.spec.ts --workers=1 --reporter=list
cmd /c pnpm.cmd exec playwright test apps/web/e2e/v12-phase5-im-orchestrator-runtime.spec.ts --workers=1 --reporter=list
cmd /c pnpm.cmd exec playwright test apps/web/e2e/v12-real-runtime-acceptance.spec.ts --workers=1 --reporter=list
cmd /c pnpm.cmd exec playwright test apps/web/e2e/v12-artifact-studio.spec.ts apps/web/e2e/v12-phase5-im-orchestrator-runtime.spec.ts apps/web/e2e/v12-real-runtime-acceptance.spec.ts --workers=1 --reporter=list
cmd /c "set AGENTHUB_REAL_RUNTIME_E2E=1&& pnpm.cmd exec playwright test apps/web/e2e/v12-real-runtime-acceptance.spec.ts --workers=1 --reporter=list"
```

Latest focused combined results: 43 vitest tests passed; browser Phase 5 combined run passed 11 and skipped the opt-in real runtime scenario; opt-in real runtime run passed 2 tests.

GitNexus `detect_changes(scope=all)` was reviewed after verification. It reported `critical` risk because the V1.2 integration line touches 58 files and affects 54 indexed execution flows, including daemon startup, App/NewRoomDialog, RunManaged/AdapterBridge, and runtime/publish flows.

## Archive Status

Do not archive yet.

`5.10` remains unchecked until:

- The user explicitly asks to run the archive workflow.

# V1.2 Completion Worktree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete OpenSpec change `add-v12-artifact-studio` with parallel agents in isolated worktrees, atomic commits, and independent spec-compliance review before any merge.

**Architecture:** Keep `feat/v12-integration-final` as the integration branch and spawn one worktree per independent track. Every track must preserve the Event Bus contract: SQLite mutation and `EventBus.publish(...)` happen in the same transaction, and chat cards are inserted only by `message.part.added`.

**Tech Stack:** TypeScript, pnpm, Vitest, Vite, HeroUI v3, SQLite, AgentHub EventBus, OpenSpec, GitNexus MCP.

---

## Status Snapshot

Date: 2026-06-08

Source of truth:
- OpenSpec change: `openspec/changes/add-v12-artifact-studio`
- Apply command: `openspec.cmd instructions apply --change "add-v12-artifact-studio" --json`
- Reported progress: `0/51` tasks complete
- Current integration branch: `feat/v12-integration-final`
- Current integration worktree: `C:\project\AgentHub\.worktrees\v12-integration-final`

Current evidence found in the integration branch:
- `packages/db/migrations/0019_v12.sql` exists.
- V1.2 event registry entries exist in `packages/protocol/src/events/registry.ts`.
- Typed card, message, room, and contact schemas exist in `packages/protocol/src/domains.ts`.
- Deployment service and tests exist at `packages/daemon/src/services/deployment-service.ts` and `packages/daemon/test/deployment-service.test.ts`.
- Artifact versioning service and tests exist at `packages/artifacts/src/artifact-versioning-service.ts` and `packages/artifacts/test/artifact-versioning-service.test.ts`.
- PPT preview bridge and tests exist at `packages/daemon/src/services/ppt-preview-bridge.ts` and `packages/daemon/test/ppt-preview-bridge.test.ts`.
- Wake outbox dispatcher exists at `packages/orchestrator/src/wake-outbox-dispatcher.ts`.
- V1.2 projector state and tests exist in `apps/web/src/hooks/useProjector.ts` and `apps/web/src/hooks/useProjector.test.ts`.
- V1.2 card renderer tests exist in `apps/web/src/components/cards/CardRenderer.v12.test.tsx`.
- Contacts and artifacts rail views exist in `apps/web/src/components/rail/RailViews.tsx`.

Unaccepted areas from local evidence:
- OpenSpec task checkboxes remain unchecked and must stay unchecked until a track proves full task coverage.
- `Settings -> Deploy Providers` is not proven complete; `SettingsModal.tsx` does not show a dedicated provider tab in the searched evidence.
- Input composer structured pills are not proven complete; `InputBox.tsx` still exposes `mentions: string[]` and does not show `refs` pill serialization in searched evidence.
- Pinned Context drawer is not proven complete; message pin backend/projector evidence exists, but a top-of-chat drawer is not proven.
- Room list UI pin/archive controls are not proven complete; `RoomList.test.tsx` still asserts inert pin/archive labels are absent.
- Artifact Studio is partial; preview fallback and tab filtering exist, but Monaco save, history compare/restore UI, and reference-in-chat pills are not proven complete.
- Full E2E acceptance is not present.

Do not mark any `openspec/changes/add-v12-artifact-studio/tasks.md` checkbox complete until a track documents exact evidence, verification commands, and review approval for that task.

---

## Mandatory Rules

### GitNexus Gate

Before editing any function, class, method, or other code symbol:

Example MCP tool call for a web composer edit:

```text
mcp__gitnexus__.impact({
  repo: "AgentHub",
  target: "InputBox",
  file_path: "apps/web/src/components/chat/InputBox.tsx",
  direction: "upstream"
})
```

Replace `InputBox` and `apps/web/src/components/chat/InputBox.tsx` with the exact symbol and file being edited. If GitNexus cannot resolve the symbol, run `mcp__gitnexus__.query` or `mcp__gitnexus__.context` and record that result in the commit notes.

Each implementation commit message body or review handoff must include:
- target symbol
- direct callers
- affected processes
- risk level
- whether the public API/signature changed

If impact risk is `HIGH` or `CRITICAL`, warn the coordinator before editing and state why the edit is still needed.

### Event Bus Contract

Every daemon mutation must use this shape:

```ts
database.sqlite.transaction(() => {
  // write SQLite state first
  eventBus.publish({
    id: randomUUID(),
    type: "registered.event.type",
    schemaVersion: 1,
    workspaceId,
    roomId,
    payload,
    createdAt: now
  });
})();
```

Checklist for each mutating route or service:
- The mutation runs inside a SQLite transaction.
- The matching event is published inside that transaction.
- The event type exists in `packages/protocol/src/events/registry.ts`.
- Durable events with `main` visibility have a projector handler in `apps/web/src/hooks/useProjector.ts`.
- Chat cards are inserted by `message.part.added`, not by `artifact.*` or `deployment.*` alone.
- Tests assert both database state and event publication.

### Git Workflow

Atomic commit rule:
- One OpenSpec task or one narrow sub-slice per commit.
- Do not mix backend, web, and docs in the same commit unless the slice is a shared contract.
- Do not stage unrelated dirty files from the main checkout or metadata files.

Required pre-commit commands for every code commit:

```powershell
git status --short
git diff --check
git diff --cached --check
```

Then run GitNexus staged detection from the relevant worktree:

Run `mcp__gitnexus__.detect_changes` with the current track worktree before every commit. For example, Track C uses:

```text
mcp__gitnexus__.detect_changes({
  repo: "AgentHub",
  scope: "staged",
  worktree: "C:\\project\\AgentHub\\.worktrees\\v12-web-studio-composer"
})
```

Commit format examples:

```powershell
git commit -m "feat(v12): complete artifact version restore"
git commit -m "fix(v12): publish room pin events transactionally"
git commit -m "test(v12): cover deployment replay ordering"
```

### Review Gate

No track may merge into `feat/v12-integration-final` until an independent reviewer has approved spec compliance.

Reviewer prompt template:

```text
Review V1.2 OpenSpec compliance for this change.

Scope:
- OpenSpec change: openspec/changes/add-v12-artifact-studio
- Task IDs: 4.7 Input Composer token/pill model
- Base SHA: output of `git rev-parse HEAD~1`
- Head SHA: output of `git rev-parse HEAD`
- Worktree: C:\project\AgentHub\.worktrees\v12-web-studio-composer

Focus:
1. Does the implementation satisfy every acceptance scenario for the listed task IDs?
2. Are SQLite mutations and EventBus publishes atomic?
3. Are event registry, projector handlers, and message.part.added card insertion correct?
4. Are tests meaningful and sufficient for the task?
5. Did the change avoid unrelated refactors and unrelated files?

Return Critical, Important, and Minor findings. Critical or Important findings block merge.
```

After the spec reviewer passes, run a code-quality review with the same SHA range. Critical or Important code-quality findings also block merge.

---

## Worktree Setup

Create all track worktrees from the integration branch so agents do not touch the main checkout:

```powershell
cd C:\project\AgentHub
git worktree add .worktrees\v12-contract-final -b feat/v12-contract-final feat/v12-integration-final
git worktree add .worktrees\v12-backend-deploy-orch -b feat/v12-backend-deploy-orch feat/v12-integration-final
git worktree add .worktrees\v12-artifacts-ppt-context -b feat/v12-artifacts-ppt-context feat/v12-integration-final
git worktree add .worktrees\v12-web-studio-composer -b feat/v12-web-studio-composer feat/v12-integration-final
git worktree add .worktrees\v12-e2e-docs-release -b feat/v12-e2e-docs-release feat/v12-integration-final
```

If a branch already exists:

```powershell
git worktree add .worktrees\v12-contract-final feat/v12-contract-final
```

Baseline in each worktree:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd typecheck
```

If `pnpm.cmd install --frozen-lockfile` fails because dependencies are already installed through the shared workspace, record the failure and run the package-specific verification commands instead.

---

## Track Ownership

### Track 0: Contract Closure

Worktree: `C:\project\AgentHub\.worktrees\v12-contract-final`

Branch: `feat/v12-contract-final`

Owner: contract worker

OpenSpec tasks:
- 1.1 migration
- 1.2 events
- 1.3 shared protocol/frontend state contract
- 1.4 service stubs
- 1.5 route stubs
- 1.6 baseline verification

Files owned:
- `packages/db/migrations/0019_v12.sql`
- `packages/db/src/schema.ts`
- `packages/db/test/sqlite.test.ts`
- `packages/protocol/src/events/registry.ts`
- `packages/protocol/src/domains.ts`
- `packages/protocol/test/v12-contract.test.ts`
- `packages/daemon/src/routes/*.ts`
- `packages/daemon/test/route-stubs.test.ts`
- `apps/web/src/types.ts`
- `apps/web/src/hooks/useProjector.ts`
- `apps/web/src/hooks/useProjector.test.ts`

Do not edit:
- deployment runtime logic in `packages/daemon/src/services/deployment-service.ts`
- artifact runtime logic in `packages/artifacts/src/artifact-versioning-service.ts`
- web UI components other than projector/type tests

Acceptance commands:

```powershell
pnpm.cmd --filter @agenthub/db test
pnpm.cmd --filter @agenthub/protocol test
pnpm.cmd --filter @agenthub/protocol schema:check
pnpm.cmd --filter @agenthub/daemon test -- route-stubs.test.ts
pnpm.cmd typecheck
openspec.cmd validate add-v12-artifact-studio --strict
```

Commit sequence:
- `test(v12): prove contract registry coverage`
- `fix(v12): close v12 contract gaps`
- `docs(v12): record contract task evidence`

### Track A: Backend Deployment and Orchestrator

Worktree: `C:\project\AgentHub\.worktrees\v12-backend-deploy-orch`

Branch: `feat/v12-backend-deploy-orch`

Owner: backend/orchestrator worker

OpenSpec tasks:
- 2.1 WakeAgent Outbox Dispatcher
- 2.2 daemon startup recovery
- 2.3 dependency auto-dispatch
- 2.4 visible orchestrator coordination messages
- 2.5 deployment preview-url and static-site
- 2.6 source-zip and container-export
- 2.7 container-build
- 2.8 CapRover self-hosted
- 2.9 deployment REST API
- 2.10 RoomList backend retrofit
- 2.11 Phase 2 tests
- 3.12 orchestrator prompt template updates where they are orchestrator-owned

Files owned:
- `packages/orchestrator/src/wake-outbox-dispatcher.ts`
- `packages/orchestrator/src/run-lifecycle-service.ts`
- `packages/orchestrator/src/task-service.ts`
- `packages/orchestrator/src/team-dispatch.ts`
- `packages/orchestrator/src/prompts/*.ts`
- `packages/daemon/src/services/deployment-service.ts`
- `packages/daemon/src/index.ts` only for deployment, rooms, and provider routes
- `packages/daemon/src/routes/deployments.ts`
- `packages/daemon/src/routes/deployment-providers.ts`
- `packages/daemon/test/deployment-service.test.ts`
- `packages/daemon/test/v12-artifacts-backend.test.ts`
- `packages/orchestrator/test/*.test.ts`

Do not edit:
- `apps/web/src/**`
- `packages/artifacts/src/artifact-versioning-service.ts`
- `packages/skills/**`
- `openspec/**` except when marking a fully proven task after review

Implementation order:

- [ ] **A1: Prove existing deployment service coverage before modifying it**

Run:

```powershell
pnpm.cmd --filter @agenthub/daemon test -- deployment-service.test.ts
pnpm.cmd --filter @agenthub/daemon test -- v12-artifacts-backend.test.ts
```

Expected evidence:
- `deployment.created` and `message.part.added` are emitted in one service call.
- `deployment.log.appended` is live-only and not durable.
- CapRover test uses `x-captain-auth`.
- container-build fallback updates final kind.
- restart recovery fails stale in-progress deployments.

- [ ] **A2: Close any missing deployment REST behavior**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "createDeploymentService", file_path: "packages/daemon/src/services/deployment-service.ts", direction: "upstream" })
mcp__gitnexus__.api_impact({ repo: "AgentHub", route: "/deployments" })
```

Required checks:
- `POST /deployments`
- `GET /deployments/:id`
- `GET /deployments?artifactId=`
- `POST /deployments/:id/redeploy`
- `POST /deployments/:id/retry`
- `POST /deployments/:id/cancel`
- `POST /deployments/:id/unpublish`
- `GET /deployments/:id/logs`
- `GET /deployments/:id/download`
- `GET /deployment-providers`
- `POST /deployment-providers`
- `PATCH /deployment-providers/:id`
- `DELETE /deployment-providers/:id`
- `POST /deployment-providers/:id/test`

Each mutating endpoint must assert database row changes and matching event publication inside the same transaction.

- [ ] **A3: Prove RoomList backend search and pin contract**

Before editing symbols in `packages/daemon/src/index.ts`, run impact on the route handler functions that will change.

Required checks:
- `GET /rooms?q=<keyword>` searches room title, participant contact names, and recent messages.
- archived rooms do not appear in the main list.
- `POST /rooms/:id/pin` publishes `room.pinned`.
- `DELETE /rooms/:id/pin` publishes `room.unpinned`.
- `last_activity_at` updates in the same transaction for message, run, task, and participant activity.

- [ ] **A4: Prove orchestrator wake/outbox and visible coordination**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "WakeOutboxDispatcher", file_path: "packages/orchestrator/src/wake-outbox-dispatcher.ts", direction: "upstream" })
mcp__gitnexus__.impact({ repo: "AgentHub", target: "team-dispatch", file_path: "packages/orchestrator/src/team-dispatch.ts", direction: "upstream" })
```

Required checks:
- pending outbox rows recover after daemon restart.
- dependency unblock writes `tasks.last_unblocked_at`, publishes `task.unblocked`, and creates `wake_outbox`.
- team dispatch writes visible system delegation messages through `message.created`.
- teammate failure writes visible fallback system messages.
- final aggregate wake uses `reason: "aggregate"`.

Acceptance commands:

```powershell
pnpm.cmd --filter @agenthub/daemon test
pnpm.cmd --filter @agenthub/orchestrator test
pnpm.cmd --filter @agenthub/db test
pnpm.cmd typecheck
```

Commit sequence:
- `test(v12): prove deployment route lifecycle`
- `fix(v12): close deployment lifecycle gaps`
- `test(v12): prove room pin search backend`
- `fix(v12): close room list backend gaps`
- `test(v12): prove orchestrator visible coordination`
- `fix(v12): close orchestrator wake gaps`

### Track B: Artifacts, Skills, PPT, and Context Refs

Worktree: `C:\project\AgentHub\.worktrees\v12-artifacts-ppt-context`

Branch: `feat/v12-artifacts-ppt-context`

Owner: artifacts/PPT/context worker

OpenSpec tasks:
- 3.1 builtin skills
- 3.2 artifact versioning service
- 3.3 `room.publish_artifact` binary support
- 3.4 artifact library/list API
- 3.5 PPT preview bridge
- 3.6 PPT proxy route
- 3.7 `@artifact` / `@workspace` context-ref resolver
- 3.8 pinned messages context assembly priority
- 3.9 message pin/unpin backend retrofit
- 3.10 message actions backend verification
- 3.11 Agent Contacts backend
- 3.13 Phase 3 tests

Files owned:
- `packages/skills/**`
- `packages/artifacts/src/artifact-versioning-service.ts`
- `packages/artifacts/test/artifact-versioning-service.test.ts`
- `packages/orchestrator/src/mcp/room-mcp-server.ts`
- `packages/orchestrator/src/context-ref-resolver.ts`
- `packages/orchestrator/src/prompts/mission-brief.ts`
- `packages/daemon/src/services/ppt-preview-bridge.ts`
- `packages/daemon/src/routes/ppt-proxy.ts`
- `packages/daemon/src/routes/artifact-versions.ts`
- `packages/daemon/src/routes/agents-contacts.ts`
- `packages/daemon/src/index.ts` only for artifact, contact, message pin, and PPT proxy routes
- `packages/daemon/test/ppt-preview-bridge.test.ts`
- `packages/daemon/test/v12-artifacts-backend.test.ts`

Do not edit:
- deployment service implementation
- web UI components
- broad orchestrator task dispatch files except context resolver and MCP tool boundary

Implementation order:

- [ ] **B1: Prove builtin skills are complete**

Run:

```powershell
pnpm.cmd --filter @agenthub/skills test
```

Required skill names:
- `web-page-builder`
- `web-app-builder`
- `one-pager-builder`
- `html-slides-builder`
- `document-builder`
- `officecli-pptx`

Each skill must expose an `artifact_kind` field and instructions that constrain output according to the OpenSpec.

- [ ] **B2: Prove artifact versioning text and binary behavior**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "createArtifactVersioningService", file_path: "packages/artifacts/src/artifact-versioning-service.ts", direction: "upstream" })
```

Required checks:
- text save updates `artifact_files.new_content` and writes `artifact_versions`.
- binary save copies to `.agenthub/artifacts/<artifactId>/v<n>/`.
- binary restore validates controlled storage path.
- restore always creates a forward version.
- diff returns unified text diff for text and metadata diff for binary.
- `artifact.version.created` publishes inside the same transaction.

- [ ] **B3: Prove `room.publish_artifact` creates card parts**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "room.publish_artifact", file_path: "packages/orchestrator/src/mcp/room-mcp-server.ts", direction: "upstream" })
```

Required checks:
- text path writes `artifacts`, `artifact_files`, `artifact_versions`, `artifact.version.created`, message part, and `message.part.added` in one transaction.
- binary path rejects path traversal after `path.resolve`.
- binary path writes `content_path`, `binary = 1`, `mime_type`, `size_bytes`, and `new_sha256`.

- [ ] **B4: Prove PPT bridge and proxy guard**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "createPptPreviewBridge", file_path: "packages/daemon/src/services/ppt-preview-bridge.ts", direction: "upstream" })
```

Required checks:
- Windows detection uses `where.exe officecli` or `officecli --version`.
- macOS/Linux detection uses `command -v officecli` through a shell.
- install failure is guarded for the daemon session.
- active ports are tracked and `ppt-proxy` rejects inactive ports with 403.
- bridge stops spawned watch processes on unmount/session end.

- [ ] **B5: Prove context-ref and pinned-message assembly**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "resolveContextRefs", file_path: "packages/orchestrator/src/context-ref-resolver.ts", direction: "upstream" })
```

Required checks:
- `@artifact:<id>#Lx-Ly`
- `@artifact:<id>#slide=N`
- `@artifact:<id>` whole artifact truncation
- `@workspace:src/auth.ts#Lx-Ly`
- path traversal protection for workspace refs
- pinned messages injected ahead of recent messages and not trimmed by the recent-message window
- pinned artifact messages inject compact artifact refs

- [ ] **B6: Prove contacts backend**

Required checks:
- `GET /agents/contacts` derives contacts from `agent_bindings`.
- `POST /agents/custom` validates duplicate names and creates role/binding rows.
- `PATCH /agents/contacts/:agentBindingId` publishes `agent.contact.updated`.
- `DELETE /agents/contacts/:agentBindingId` hard-deletes only when unreferenced, otherwise sets `disabled_at`.
- runtime health is reflected in `available`, `busy`, or `offline`.

Acceptance commands:

```powershell
pnpm.cmd --filter @agenthub/skills test
pnpm.cmd --filter @agenthub/artifacts test
pnpm.cmd --filter @agenthub/daemon test
pnpm.cmd --filter @agenthub/orchestrator test
pnpm.cmd typecheck
```

Commit sequence:
- `test(v12): prove builtin artifact skills`
- `fix(v12): close builtin skill gaps`
- `test(v12): prove artifact versioning contract`
- `fix(v12): close artifact versioning gaps`
- `test(v12): prove ppt proxy guard`
- `fix(v12): close ppt preview gaps`
- `test(v12): prove context ref injection`
- `fix(v12): close context ref gaps`
- `test(v12): prove agent contacts backend`
- `fix(v12): close contacts backend gaps`

### Track C: Web Shell, Studio, Composer, Settings

Worktree: `C:\project\AgentHub\.worktrees\v12-web-studio-composer`

Branch: `feat/v12-web-studio-composer`

Owner: web worker

OpenSpec tasks:
- 4.1 FeatureRail real navigation and HeroUI shell
- 4.2 Contacts rail/panel and Agent Contact Directory
- 4.3 Contact-first NewRoomDialog and advanced participant config
- 4.4 PreviewCard / DocumentCard / PresentationCard anatomy
- 4.5 ArtifactPreviewModal -> Artifact Studio
- 4.6 DeploymentCard full state machine and logs UI
- 4.7 Input Composer token/pill model
- 4.8 RoomList + Pinned Context drawer + message actions
- 4.9 Settings -> Deploy Providers
- 4.10 Projector normalized state and handlers
- 4.11 Phase 4 tests

Files owned:
- `apps/web/src/App.tsx`
- `apps/web/src/types.ts`
- `apps/web/src/hooks/useProjector.ts`
- `apps/web/src/hooks/useProjector.test.ts`
- `apps/web/src/components/shell/FeatureRail.tsx`
- `apps/web/src/components/rail/RailViews.tsx`
- `apps/web/src/components/rail/RailViews.test.tsx`
- `apps/web/src/components/cards/CardRenderer.tsx`
- `apps/web/src/components/cards/ArtifactCards.tsx`
- `apps/web/src/components/cards/CardRenderer.v12.test.tsx`
- `apps/web/src/components/artifacts/ArtifactPreviewModal.tsx`
- `apps/web/src/components/artifacts/ArtifactPreviewModal.test.tsx`
- `apps/web/src/components/chat/InputBox.tsx`
- `apps/web/src/components/chat/ChatStream.tsx`
- `apps/web/src/components/chat/MessageItem.tsx`
- `apps/web/src/components/rooms/RoomList.tsx`
- `apps/web/src/components/rooms/RoomList.test.tsx`
- `apps/web/src/components/settings/SettingsModal.tsx`
- `apps/web/src/components/settings/SettingsModal.test.ts`
- `apps/web/src/components/NewRoomDialog.tsx`
- `apps/web/src/components/NewRoomDialog.test.tsx`

Do not edit:
- backend service implementations
- protocol schemas unless Track 0 has merged and assigned the change
- route behavior in `packages/daemon/src/index.ts`

Implementation order:

- [ ] **C1: Prove current web baseline**

Run:

```powershell
pnpm.cmd --filter @agenthub/web test -- App.test.tsx NewRoomDialog.test.tsx RailViews.test.tsx RoomList.test.tsx CardRenderer.v12.test.tsx ArtifactPreviewModal.test.tsx useProjector.test.ts
pnpm.cmd --filter @agenthub/web build
pnpm.cmd typecheck
```

Record which OpenSpec task IDs are still missing based on test failures or absence of UI.

- [ ] **C2: Close FeatureRail and contact panel gaps**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "FeatureRail", file_path: "apps/web/src/components/shell/FeatureRail.tsx", direction: "upstream" })
mcp__gitnexus__.impact({ repo: "AgentHub", target: "ContactsRailView", file_path: "apps/web/src/components/rail/RailViews.tsx", direction: "upstream" })
```

Required checks:
- `chat`, `contacts`, `runs`, `tasks`, `artifacts`, and `settings` produce visible UI changes.
- Contacts show avatar, display name, role/runtime, status, capabilities, start chat, and edit/configure.
- Codex runtime is visibly marked experimental where runtime choices are shown.

- [ ] **C3: Close NewRoomDialog gaps**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "NewRoomDialog", file_path: "apps/web/src/components/NewRoomDialog.tsx", direction: "upstream" })
```

Required checks:
- contact-first default flow
- single contact offers Solo and Assisted
- multiple contacts offer Assisted and Team
- Squad is available only in Advanced compatibility controls
- per-contact advanced role/runtime/model/skills/presence configuration remains available

- [ ] **C4: Close Artifact Studio gaps**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "ArtifactPreviewModal", file_path: "apps/web/src/components/artifacts/ArtifactPreviewModal.tsx", direction: "upstream" })
```

Required checks:
- Preview / Editor / History / Raw tabs render according to kind/type/binary rules.
- Monaco or the existing editor abstraction saves with `PATCH /artifacts/:id { content, message? }`.
- Ctrl/Cmd+S triggers Save.
- History lists versions, supports compare, restore, and binary metadata display.
- `Reference in Chat` emits a structured ref for selected lines or current slide.
- large and unsupported preview states degrade to Download without crashing.

- [ ] **C5: Close Input Composer structured token model**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "InputBox", file_path: "apps/web/src/components/chat/InputBox.tsx", direction: "upstream" })
```

Required checks:
- `@AgentName` autocomplete searches room participants and contacts.
- `@artifact:<id>#Lx-Ly`, `@artifact:<id>#slide=N`, and `@workspace:src/auth.ts#Lx-Ly` render as independent removable pills.
- send payload carries readable text and stable `refs`.
- send payload carries `mentions` as objects with `agentBindingId`, not a bare string array.
- quote preview and attachments continue to work.

- [ ] **C6: Close RoomList, Pinned Context drawer, and message actions**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "RoomList", file_path: "apps/web/src/components/rooms/RoomList.tsx", direction: "upstream" })
mcp__gitnexus__.impact({ repo: "AgentHub", target: "MessageItem", file_path: "apps/web/src/components/chat/MessageItem.tsx", direction: "upstream" })
```

Required checks:
- RoomList search uses 200 ms debounce and backend `GET /rooms?q=`.
- pinned rooms sort first and can be pinned/unpinned from a menu.
- archived rooms have a collapsed entry and do not appear in the main list.
- Reply, Quote, Regenerate, Copy Code, Apply Diff, Expand Preview, and Pin/Unpin are reachable.
- Pinned Context drawer appears at the top of the chat area, shows badge count, lists pinned messages, and supports unpin.
- large artifact pins show compact ref plus warning.

- [ ] **C7: Close Settings -> Deploy Providers**

Before editing:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "SettingsModal", file_path: "apps/web/src/components/settings/SettingsModal.tsx", direction: "upstream" })
```

Required checks:
- A `deploy-providers` tab exists.
- list/create/edit/delete/test provider workflows call `/deployment-providers` endpoints.
- credential fields never echo raw token after save.
- Test Connection calls the backend test endpoint.
- only CapRover appears as a V1.2 provider option.
- empty state prompts adding a CapRover provider.

- [ ] **C8: Re-prove DeploymentCard and projector**

Before editing `CardRenderer`, run impact and warn the coordinator if risk remains critical:

```text
mcp__gitnexus__.impact({ repo: "AgentHub", target: "CardRenderer", file_path: "apps/web/src/components/cards/CardRenderer.tsx", direction: "upstream" })
```

Required checks:
- DeploymentCard action buttons are disabled while a request is in flight.
- View Logs fetches `/deployments/:id/logs` and avoids duplicate log lines.
- ready-only outputs do not render from stale terminal fields after failed/cancelled/unpublished events.
- `deployment.ready` before `message.part.added` hydrates the card as ready.
- `artifact.version.created`, `room.pinned/unpinned`, `message.pinned/unpinned`, `agent.contact.updated`, and `task.unblocked` all patch normalized state without refresh.

Acceptance commands:

```powershell
pnpm.cmd --filter @agenthub/web test
pnpm.cmd --filter @agenthub/web build
pnpm.cmd typecheck
```

Commit sequence:
- `test(v12): prove web rail gaps`
- `fix(v12): complete web rail navigation`
- `test(v12): prove contact-first chat flow`
- `fix(v12): complete contact-first chat flow`
- `test(v12): prove artifact studio gaps`
- `feat(v12): complete artifact studio`
- `test(v12): prove composer refs`
- `feat(v12): add composer ref pills`
- `test(v12): prove pinned context drawer`
- `feat(v12): complete pinned context drawer`
- `test(v12): prove deploy provider settings`
- `feat(v12): add deploy provider settings`
- `test(v12): prove projector replay coverage`
- `fix(v12): close projector replay gaps`

### Track D: Integration, E2E, Docs, Release Hygiene

Worktree: `C:\project\AgentHub\.worktrees\v12-e2e-docs-release`

Branch: `feat/v12-e2e-docs-release`

Owner: integration/E2E worker

OpenSpec tasks:
- 5.1 full CI
- 5.2 artifact generation and preview E2E
- 5.3 artifact editing and history E2E
- 5.4 deployment publish E2E
- 5.5 group chat orchestrator E2E
- 5.6 IM experience and frontend entry E2E
- 5.7 runtime acceptance
- 5.8 event registry and projector completeness
- 5.9 documentation hygiene
- 5.10 OpenSpec closure archive gate

Files owned:
- `tests/**`
- `apps/web/e2e/**`
- `playwright.config.*`
- `README.md`
- `package.json`
- `apps/web/package.json`
- `packages/daemon/package.json`
- docs under `docs/**`
- `openspec/changes/add-v12-artifact-studio/tasks.md` only after review-approved evidence

Do not edit:
- production code unless a reviewed integration bug fix is assigned back by the coordinator

Implementation order:

- [ ] **D1: Build acceptance matrix**

Create an evidence matrix in `docs/superpowers/plans/2026-06-08-v12-acceptance-matrix.md` with rows:
- OpenSpec task ID
- acceptance scenario
- verification command
- manual check, if needed
- commit SHA
- reviewer
- status

- [ ] **D2: Add focused E2E tests**

Required E2E coverage:
- web artifact -> PreviewCard -> Artifact Studio -> Save -> History restore
- Markdown document -> DocumentCard -> line ref pill
- HTML slides -> PresentationCard -> slide ref pill
- PPTX -> PresentationCard -> PPT proxy guard 403 for inactive port
- deployment preview-url/static-site/source-zip/container-export/container-build/self-hosted mocked paths
- group chat delegation announcement, failure message, and aggregate summary
- contacts start chat and custom agent create/edit
- room search/pin/archive without refresh
- message pin updates Pinned Context drawer without refresh

- [ ] **D3: Run full verification**

Run from a fully merged integration branch:

```powershell
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd check:all
pnpm.cmd events:check
pnpm.cmd visibility:check
pnpm.cmd test:e2e
openspec.cmd validate add-v12-artifact-studio --strict
```

If a command fails, record:
- exact command
- exit code
- failing file or test name
- root cause
- assigned owner track

- [ ] **D4: Release hygiene**

Required changes after all functional tracks pass:
- README describes V1.2 artifact studio, contacts, deployment publish, and runtime acceptance.
- `package.json` version becomes `1.2.0`.
- `apps/web/package.json` version becomes `1.2.0`.
- `packages/daemon/package.json` version becomes `1.2.0`.
- Codex runtime displays `"experimental"` in runtime/contact UI.

- [ ] **D5: OpenSpec task closure**

Only after all review-approved evidence exists:

```powershell
openspec.cmd instructions apply --change "add-v12-artifact-studio" --json
openspec.cmd validate add-v12-artifact-studio --strict
```

Then update `openspec/changes/add-v12-artifact-studio/tasks.md` checkboxes for tasks with complete evidence. Do not archive the change unless the user explicitly asks for archive.

Acceptance commands:

```powershell
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd check:all
pnpm.cmd test:e2e
openspec.cmd validate add-v12-artifact-studio --strict
```

Commit sequence:
- `test(v12): add artifact studio e2e`
- `test(v12): add deployment publish e2e`
- `test(v12): add im contacts e2e`
- `docs(v12): add acceptance evidence matrix`
- `docs(v12): update v12 release docs`
- `chore(v12): bump packages to 1.2.0`
- `docs(v12): mark reviewed openspec tasks complete`

---

## Merge Order

1. Merge Track 0 first. It defines the contract and prevents downstream drift.
2. Merge Track A and Track B after Track 0. They can proceed in parallel but must rebase onto Track 0 before review.
3. Merge Track C after Track 0 and after any API shape changes from Track A/B are stable.
4. Merge Track D last. It must run from the fully merged integration branch.
5. After all tracks merge, run final independent review against the full `feat/v12-integration-final` range.

Merge command shape from the coordinator worktree:

```powershell
cd C:\project\AgentHub\.worktrees\v12-integration-final
git fetch --all --prune
git merge --no-ff feat/v12-contract-final
git merge --no-ff feat/v12-backend-deploy-orch
git merge --no-ff feat/v12-artifacts-ppt-context
git merge --no-ff feat/v12-web-studio-composer
git merge --no-ff feat/v12-e2e-docs-release
```

Before each merge:

```powershell
git status --short
git log --oneline --decorate -5
```

After each merge:

```powershell
pnpm.cmd typecheck
```

If the merge touched daemon writes or protocol events, also run:

```powershell
pnpm.cmd events:check
pnpm.cmd visibility:check
```

---

## Conflict Rules

Shared files requiring coordinator approval:
- `packages/protocol/src/events/registry.ts`
- `packages/protocol/src/domains.ts`
- `apps/web/src/types.ts`
- `apps/web/src/hooks/useProjector.ts`
- `packages/daemon/src/index.ts`
- `openspec/changes/add-v12-artifact-studio/tasks.md`

If two tracks need the same shared file:
- the first track proposes the contract in Track 0 or a small coordination commit.
- the second track rebases and consumes the merged contract.
- do not make competing edits in parallel.

If a worker finds a missing event type:
- add the registry entry in Track 0 or a coordinator-approved contract commit.
- add projector coverage if visibility includes `main`.
- add an event validation test before consuming it.

If a worker finds a missing backend endpoint needed by web:
- create or update the route in Track A/B.
- add a route test.
- web must consume the endpoint only after that branch is merged into integration.

---

## Task Checkbox Policy

OpenSpec checkboxes are changed only by Track D or the coordinator after review.

Evidence required per checked task:
- exact commit SHA or merge SHA
- exact test command output with exit code 0
- independent spec review approval
- no open Critical or Important review findings
- manual check notes when the task has a browser/runtime acceptance scenario

Example evidence note to add near a checkbox change:

```markdown
Evidence: f765523, `pnpm.cmd --filter @agenthub/web test -- CardRenderer.v12.test.tsx`, `pnpm.cmd typecheck`, spec review by Mencius on 2026-06-08.
```

Do not use a passing package test alone as proof for a task that has UI or E2E acceptance requirements.

---

## Independent Review Assignments

Use existing agents when available:
- Mencius: primary spec-compliance reviewer
- Turing: backend/orchestrator code-quality reviewer
- Dewey: web/code-quality reviewer
- Beauvoir: docs/OpenSpec consistency reviewer

Review order per track:
1. spec compliance review
2. code quality review
3. coordinator merge review

Reviewer output must start with findings:

```text
Critical:
- None

Important:
- None

Minor:
- Example: add a narrower client-side click test in a follow-up.

Spec coverage:
- Covered: 4.6 DeploymentCard full state machine and logs UI
- Not proven: 4.9 Settings -> Deploy Providers

Merge recommendation:
- approved
- blocked
```

Critical or Important findings block merge. The same reviewer or another independent reviewer must re-review after fixes.

---

## Final Integration Gate

Run this from `C:\project\AgentHub\.worktrees\v12-integration-final` after all track merges:

```powershell
git status --short
openspec.cmd instructions apply --change "add-v12-artifact-studio" --json
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd check:all
pnpm.cmd events:check
pnpm.cmd visibility:check
pnpm.cmd test:e2e
openspec.cmd validate add-v12-artifact-studio --strict
```

Then run:

```text
mcp__gitnexus__.detect_changes({
  repo: "AgentHub",
  scope: "compare",
  base_ref: "main",
  worktree: "C:\\project\\AgentHub\\.worktrees\\v12-integration-final"
})
```

Final review prompt:

```text
Review the complete V1.2 add-v12-artifact-studio implementation against all OpenSpec files under openspec/changes/add-v12-artifact-studio.

Base: main
Head: feat/v12-integration-final

Block merge for:
- any missing acceptance scenario
- missing event registry entry
- daemon mutation without same-transaction publish
- durable main-visible event without projector handling
- chat card insertion not driven by message.part.added
- unchecked or incorrectly checked OpenSpec task evidence
- failing or skipped required verification without recorded justification
```

Only after final review passes should the coordinator prepare the merge or PR into `main`. Do not archive the OpenSpec change unless explicitly requested.

# AgentHub V1.2

AgentHub is a local-first multi-agent workbench for running a daemon, a web UI, and task-oriented agents on your own machine. V1.2 completes the chat-to-artifact loop: agents can produce web pages, web apps, documents, presentations, code artifacts, diffs, and deployment cards that stay visible in the conversation, can be previewed or edited, and can be published through local deployment flows.

V1.2 keeps the V1 foundation of SQLite persistence, OS keychain-backed secrets, HeroUI-based frontend surfaces, and task-backed multi-agent orchestration. It extends that foundation with Artifact Studio, deployment publishing, contact-first agent workflows, pinned context, room search and pinning, and stricter projector/EventBus state guarantees.

## Quick start

```powershell
pnpm.cmd install
pnpm.cmd build
.\agenthub.cmd web
```

The `web` launcher starts the local daemon and opens the browser UI. On a machine where the CLI is already on your `PATH`, the same command is also available as `agenthub web` or `agenthub -web`.

By default, the daemon listens on `http://127.0.0.1:6677` and the web app runs on `http://127.0.0.1:5173`.

## What V1.2 includes

### 1. Artifact Studio

- Agents can publish typed artifacts for `web_page`, `web_app`, `document`, `presentation`, `presentation_pptx`, `source_code`, and generic files.
- Chat timeline cards render through stable payloads: `PreviewCard`, `DocumentCard`, `PresentationCard`, `DiffCard`, and `DeploymentCard`.
- Artifact Studio adds preview, editor, history, and raw views, including version restore flows for editable artifacts.
- Text artifacts store version snapshots, while binary artifacts such as PPTX use controlled storage paths with size, MIME type, and checksum metadata.

### 2. Built-in artifact skills

- V1.2 ships built-in SKILL.md packages for `web-page-builder`, `web-app-builder`, `one-pager-builder`, `html-slides-builder`, `document-builder`, and `officecli-pptx`.
- Each built-in package declares an `artifact_kind` contract so artifact generation and card rendering can stay typed.
- Web and slide builders prefer self-contained outputs that can be previewed without external network dependencies.
- The `officecli-pptx` skill covers real PPTX generation and read-only preview through the daemon PPT bridge when `officecli` is available.

### 3. Deployment publishing

- Artifacts can be deployed as preview URLs, static sites, source zips, container export bundles, local container builds, or CapRover self-hosted deployments.
- Deployment records live in SQLite and are reflected into chat through `DeploymentCard` message parts.
- Build logs stream through `deployment.log.appended` live events and can be recovered through REST log endpoints.
- CapRover provider credentials are stored by reference through the keychain path; raw tokens are not echoed back to the UI.

### 4. Contacts and custom agents

- Agent contacts are the IM-facing view of agent bindings, with display names, avatars, descriptions, runtime metadata, capabilities, and availability.
- The Contacts rail supports contact discovery and contact-first chat creation.
- New chat creation starts with contacts and mode selection, while advanced role/runtime/model/skills configuration remains available.
- Custom agent creation and contact editing update agent binding display fields without changing the role/runtime/model identity model underneath.

### 5. Room list, pinned context, and message actions

- Rooms support search, pinning, archive filtering, and last-activity ordering.
- Pinned rooms and pinned messages publish durable events so the UI updates without requiring a refresh.
- Pinned messages are injected into prompt context ahead of ordinary clipped conversation history.
- Message actions include reply, quote, regenerate, copy code, apply diff, expand preview, and pin/unpin.

### 6. Visible group orchestration

- Assisted and Team flows expose the coordination process in chat instead of hiding it entirely in run detail.
- Team dispatch can post visible assignment announcements, failure downgrade messages, member summaries, and final aggregate messages.
- Long-form outputs are expected to enter the timeline as artifacts or files, keeping ordinary chat messages short and readable.
- WakeAgent outbox recovery and dependency auto-dispatch remain internal reliability mechanisms, backed by SQLite state.

### 7. Settings and runtime directory

- Settings includes real tabs for roles, runtimes, models, skills, permissions, workspace, deploy providers, and MCP/tool visibility.
- Runtime cards support detection, custom ACP command configuration, connection testing, and version display.
- Claude Code and OpenCode are the main V1.2 runtime targets.
- Codex appears in the runtime directory with an `experimental` badge and is not treated as a primary V1.2 acceptance runtime.

### 8. EventBus and projector state guarantees

- AgentHub's UI reconstructs state from durable event replay plus live SSE streams, not from direct SQLite reads.
- State mutations and `EventBus.publish()` calls must happen in the same SQLite transaction.
- `message.part.added` is the timeline insertion signal for artifact and deployment cards.
- The projector tracks normalized room state for pinned rooms, participant contact names, deployments, deployment logs, artifact versions, pinned messages, and relevant V1.2 lifecycle events.

### 9. Security and storage

- Durable state lives in SQLite.
- Third-party API keys and deployment provider tokens are stored in the OS keychain and are not written to SQLite in plaintext.
- Raw adapter output is redacted before it reaches the UI, logs, or persisted events.
- The local daemon and browser UI keep localhost-only defaults unless remote access is explicitly configured with authentication.

## Core command surface

```powershell
agenthub web|-web
agenthub start|stop|status|doctor
agenthub auth issue|list|revoke
agenthub agents reset --id=<agentId>
agenthub permissions profiles|requests|resolve
agenthub interventions list
agenthub artifacts list
agenthub debug stats
```

If you are working directly from the repository on Windows, `.\agenthub.cmd web` is the most convenient one-command launcher.

## What is intentionally out of scope for V1.2

- Workflow artifacts, DAG execution, WorkflowCard, workflow visual editing, and recurring schedulers
- SaaS deployment providers such as Vercel, Cloudflare, Fly.io, Dokploy, and Coolify
- Full Codex adapter certification beyond the experimental runtime marker
- Multi-user authentication, cloud sync, marketplace distribution, and hosted multi-tenant infrastructure
- BM25/vector hybrid memory upgrades and plugin or LAN discovery flows

V1.2 is focused on the local workbench loop: chat, contacts, orchestration, artifact creation, preview/edit/history, and practical local/self-hosted publishing.

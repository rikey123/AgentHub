# AgentHub V1.0

AgentHub is a local-first multi-agent workbench for running a daemon, a web UI, and a set of task-oriented agents on your own machine. V1.0 is no longer a mock chat demo or an MVP sketch: it ships a real daemon, a HeroUI-based frontend, SQLite persistence, OS keychain-backed secrets, and a first-class task orchestration model for multi-agent work.

## Quick start

```powershell
pnpm.cmd install
pnpm.cmd build
.\agenthub.cmd web
```

The `web` launcher starts the local daemon and opens the browser UI. On a machine where the CLI is already on your `PATH`, the same command is also available as `agenthub web` or `agenthub -web`.

By default, the daemon listens on `http://127.0.0.1:6677` and the web app runs on `http://127.0.0.1:5173`.

## What V1.0 includes

### 1. Separate role, runtime, and model configuration

- Roles are now independent from runtimes and model providers.
- Runtime settings support external executors such as `claude-code`, `opencode`, `native`, and other custom ACP-compatible runtimes.
- Model provider settings support provider-specific configuration such as OpenAI, Anthropic, Google, OpenAI-compatible providers, Ollama, and local-only providers that do not need an API key.
- Agent bindings connect a role to a runtime and a model configuration without hard-coding them together.

### 2. A real Settings experience

- V1.0 adds a dedicated Settings UI with six top-level sections: `Agents`, `Runtimes`, `Models`, `Permissions`, `Workspace`, and `MCP`.
- The Settings experience is REST-driven rather than SSE-driven, so it stays stable and predictable while you edit configuration.
- API keys are stored in the OS keychain; SQLite stores only references and metadata, not raw secret material.
- Model and runtime entries can be detected, edited, and tested from the UI.

### 3. Native agent runtime

- AgentHub ships a native runtime implemented on top of the Vercel AI SDK.
- The runtime uses an explicit provider registry instead of relying on implicit global provider resolution.
- Per-run permission checks and caching are built into the runtime path so model calls stay visible to the permission system.
- The built-in runtime is meant to cover the same class of internal agent workflows as the reference built-in runtime, not to clone every Claude Code-specific behavior.

### 4. AI role generation with approval

- Users can generate a new role from a natural-language description.
- Generation produces a draft first, then requires human review before the role is saved.
- Drafts are visible as drafts, not silently auto-created as production roles.

### 5. Team mode and Squad mode

- `Team` mode supports review-based delegation, where a leader can break a request into tasks and review the results before completion.
- `Squad` mode supports lighter-weight delegation for ongoing collaboration.
- Both modes use task-backed coordination instead of free-form multi-agent chat, which avoids the infinite-loop behavior that the earlier mailbox-only approach could trigger.

### 6. Task workflow core

- Tasks are now a first-class product object, not just an internal placeholder.
- The workflow includes task activities, delegation chains, status transitions, review steps, and a task board / timeline view.
- The UI shows task progress and task-related activity alongside the chat experience so work can be tracked without losing the conversation context.

### 7. A more complete workbench UI

- The web app uses HeroUI v3, React 19, Vite, and Tailwind CSS 4.
- The main workbench includes chat, run detail, artifact inspection, permission flows, task notifications, and a command palette.
- Light and dark themes, density modes, responsive panels, and polished loading / empty / error states are part of the shipped UI.
- The launcher and web UI are designed around a local workbench workflow rather than a marketing site or a blank landing page.

### 8. Security and storage

- Durable state lives in SQLite.
- Third-party API keys are stored in the OS keychain and are not written to SQLite in plaintext.
- Raw adapter output is redacted before it reaches the UI, logs, or persisted events.
- The local daemon and browser UI are built around localhost-only defaults.

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

## What is intentionally out of scope for V1.0

- SaaS hosting and cloud sync
- Mobile apps
- Marketplace or plugin ecosystem
- Multi-tenant remote infrastructure
- Postgres / Redis-backed deployment
- Browser automation, web search, and image generation inside the native runtime by default

V1.0 is focused on a strong local workbench: clear role/runtime/model separation, real orchestration, a usable settings surface, task-backed collaboration, and a UI that reflects the actual product rather than placeholders.

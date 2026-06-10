<div align="center">

# AgentHub

**A local-first multi-agent collaboration platform built around group chat.**

[![Version](https://img.shields.io/badge/version-1.2.0-blue)](#release-history)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)

[中文](README.md) | English

</div>

---

AgentHub turns "chat with agents to create things" into a real local workbench. Agents behave like contacts, tasks live in rooms, and outputs appear as reviewable cards: diffs, previews, documents, terminal output, deployment status, and more.

It is not just a chat UI and not just a single model-call demo. AgentHub focuses on the engineering layer behind multi-agent work: room-based context, orchestration, run tracking, permission approval, artifact review, durable event replay, and multi-client access.

## Highlights

- IM-style room list, chat stream, message actions, pinned context, and artifact cards.
- Solo, assisted, team, and squad room modes for different collaboration patterns.
- Orchestrator-driven routing with explicit `@Agent` overrides.
- Run Detail drawer for transcript, tools, permissions, context, cost, and artifacts.
- Diff review, artifact preview, version history, and deployment cards.
- Local-first daemon backed by SQLite and durable events.
- Permission Engine for file, shell, tool, context, and agent-control operations.
- Web, Electron desktop, Capacitor mobile, and CLI share one daemon API.

## Quick Start

Requirements:

- Node.js `>= 22`
- pnpm `>= 10`
- Bun `>= 1.1`

```powershell
pnpm install
pnpm build
.\agenthub.cmd web
```

Service URLs:

| Service               | URL                   |
| --------------------- | --------------------- |
| daemon / built Web UI | http://127.0.0.1:6677 |
| Web dev server        | http://127.0.0.1:5173 |
| Mobile dev UI         | http://127.0.0.1:5174 |

For a first run, create a room with the `mock` runtime. It does not require external agent CLIs and can produce deterministic messages, diffs, and artifacts.

## Common Commands

```powershell
.\agenthub.cmd web
.\agenthub.cmd start
.\agenthub.cmd status
.\agenthub.cmd stop
.\agenthub.cmd doctor
.\agenthub.cmd auth issue

pnpm typecheck
pnpm test
pnpm lint
pnpm check:all

pnpm --filter @agenthub/web dev
pnpm --filter @agenthub/desktop start
pnpm --filter @agenthub/mobile dev
pnpm --filter @agenthub/desktop run package:dir
pnpm --filter @agenthub/mobile run android:apk
```

## Architecture

```text
Web / Desktop / Mobile / CLI
            |
            v
packages/daemon
HTTP API / SSE / auth / preview / deploy
            |
            v
CommandBus -> Domain Services -> SQLite transaction
            |                         |
            |                         v
            +------------------ state mutation + EventBus.publish()
                                      |
                                      v
                     events/outbox -> durable replay + live SSE
                                      |
                                      v
                     Web Projector / Run Detail / Artifact Workspace
```

The important contract is simple: state changes and events are written atomically in the same SQLite transaction. The frontend rebuilds UI state from durable replay and live SSE instead of reading SQLite directly.

## Runtime Support

| Runtime                                     | Status                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| `mock`                                      | main path, deterministic demo/test adapter           |
| `claude-code`                               | main path, Claude Code ACP adapter                   |
| `opencode`                                  | main path, OpenCode ACP adapter                      |
| `native`                                    | main path, AgentHub native runtime                   |
| `custom-acp`                                | main path, user-provided ACP runtime                 |
| Codex / Qwen / Goose / Kimi / Kiro / Hermes | catalog entries, availability depends on local setup |

## Release History

| Version | Milestone                                                    |
| ------- | ------------------------------------------------------------ |
| v0.1    | local daemon, SQLite, CommandBus/EventBus, single-agent room |
| v0.5    | IM chat experience and message cards                         |
| v1.0    | Orchestrator, RunQueue, RunLifecycle, pending turns          |
| v1.1    | assisted/team/squad multi-agent collaboration                |
| v1.2    | Artifact Studio, diff review, deployment, desktop, mobile    |

## Documentation

| Doc                                                      | Content                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Product Design](docs/PRODUCT_DESIGN_zh.md)              | product positioning, scenarios, flows, IA, experience design                |
| [Technical Report](docs/TECHNICAL_REPORT_zh.md)          | architecture, data flow, event bus, orchestration, security, multi-platform |
| [Architecture](docs/ARCHITECTURE.md)                     | layered architecture and module boundaries                                  |
| [Security](docs/SECURITY.md)                             | local access, auth, redaction, path safety                                  |
| [Multi-platform Runbook](docs/multi-platform-runbook.md) | Web, desktop, and mobile run/packaging notes                                |
| [Agent Workflow](docs/agenthub-agent-workflow.md)        | AI collaboration and review workflow                                        |

## License

This is a competition / learning project and currently ships without a formal open-source license. Contact the author before reusing the code.

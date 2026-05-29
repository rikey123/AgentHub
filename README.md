# AgentHub MVP

AgentHub is a local-first multi-agent coding workbench. The MVP runs a TypeScript daemon on `127.0.0.1`, serves a Vite web UI, persists durable state in SQLite, and keeps external agent behavior behind adapter, permission, artifact, and context boundaries.

## Quick start

```powershell
pnpm.cmd install
pnpm.cmd build
pnpm.cmd --filter @agenthub/daemon test
pnpm.cmd --filter @agenthub/web dev
```

The daemon defaults to `http://127.0.0.1:6677`. Browser clients first call `POST /auth/session` to receive an HttpOnly `agenthub_session` cookie plus an in-memory CSRF token. CLI and SDK clients can use Bearer tokens for non-browser access.

## MVP scope

- Local-only daemon, SQLite, EventBus/CommandBus, Mock and Claude adapter surfaces.
- Solo and Assisted rooms, Permission Engine, Context Ledger, ArtifactFS run-level diffs, Debug/observability basics.
- V1 capabilities are stubs only for unavailable adapters; NativeAgentAdapter is already a real V1.0 implementation, while unsupported adapters still return deterministic `501`, `404`, `adapter_not_found`, or `tool_not_found` responses.

AgentHub intentionally does not introduce SaaS, cloud sync, multi-user auth, Postgres, Redis, WebSocket Hub, native mobile, or marketplace behavior.

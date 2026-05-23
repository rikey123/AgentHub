# AgentHub Architecture

AgentHub is split into thin HTTP surfaces and package-owned domain services. `packages/daemon` translates HTTP/SSE into `CommandBus` commands and read queries. Mutations that affect domain state go through package services such as `RunLifecycleService`, `PermissionEngine`, `ContextLedger`, and `ArtifactService`.

Core flow: browser/SDK request -> daemon route -> `CommandBus` -> domain service -> SQLite transaction -> durable event -> outbox/handler dispatch -> SSE projection. Durable events use the canonical registry in `packages/protocol`; visibility (`main`, `detail`, `both`) is resolved by the event system and consumed by the web projector.

Adapters run behind `AgentRuntimeAdapter`/ACP boundaries. File writes route through `ArtifactFS`, permissions route through `PermissionEngine`, and raw adapter output is redacted before disk, SSE, or API exposure.

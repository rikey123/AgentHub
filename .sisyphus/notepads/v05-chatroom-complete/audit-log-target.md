VERDICT: EXISTS

Target:
- Durable audit entries are written through the EventBus into the `events` table (and `outbox` for dispatch), not a dedicated `audit_log` table.

Exact function:
- `packages/security/src/index.ts:70-110`
- `publishAuditEvent(eventBus, input)`

Signature:
- `type`, `workspaceId`, `actor`, `action`, `target`, `outcome`
- optional: `createdAt`, `roomId`, `runId`, `agentId`, `traceId`, `causationId`, `correlationId`, `payload`

Required fields for audit writes:
- `input.type` (free-form event type string; can be `observer_speaking_after_knock`)
- `input.workspaceId`
- `input.actor`
- `input.action`
- `input.target`
- `input.outcome`

Persistence path:
- `publishAuditEvent` calls `eventBus.publish(...)`
- EventBus persists durable events via the `events` table schema in `packages/db/src/schema.ts:107-123`
- The event bus runtime also records outbox rows in `outbox` for dispatch

Existing audit examples:
- `auth.token.issued` in `packages/security/src/index.ts:163-172`
- `auth.token.revoked` in `packages/security/src/index.ts:182-191`

Recommendation for PF.8:
- Use the existing `publishAuditEvent` path; no new audit table is needed for this preflight.
- Add the observer entry as a new event type with payload fields for `agentId`, `roomId`, and `interventionId`.

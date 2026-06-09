import { Schema } from "effect";
import { EpochMillisSchema, IdSchema, type EventDurability, type EventVisibility } from "../primitives.ts";
import {
  AgentWorkflowEdgeDeliverySchema,
  AgentWorkflowEdgeSchema,
  AgentWorkflowNodeRunSchema,
  AgentWorkflowNodeSchema,
  AgentWorkflowRunSchema,
  AgentWorkflowSchema,
  AgentWorkflowVersionSchema,
  WorkflowValidationResultSchema
} from "../workflows.ts";

export type EventCategory =
  | "room"
  | "message"
  | "agent"
  | "run"
  | "task"
  | "role"
  | "runtime"
  | "model"
  | "binding"
  | "team"
  | "context"
  | "permission"
  | "intervention"
  | "artifact"
  | "adapter"
  | "mailbox"
  | "local-daemon"
  | "auth"
  | "bus"
  | "server"
  | "ui"
  | "skill"
  | "workflow"
  | "worktree";

export type EventRegistryEntry = {
  readonly type: string;
  readonly category: EventCategory;
  readonly durability: EventDurability;
  readonly visibility: EventVisibility;
  readonly schemaVersion: 1;
};

export const AgentProfileRemovedPayloadSchema = Schema.Struct({
  agentId: IdSchema,
  workspaceId: Schema.Union(IdSchema, Schema.Literal(null))
});
export type AgentProfileRemovedPayload = typeof AgentProfileRemovedPayloadSchema.Type;

export const AgentProfileErrorPayloadSchema = Schema.Struct({
  path: Schema.String,
  reason: Schema.String
});
export type AgentProfileErrorPayload = typeof AgentProfileErrorPayloadSchema.Type;

export const MailboxDeliveryFailedPayloadSchema = Schema.Struct({
  mailboxMessageId: IdSchema,
  roomId: IdSchema,
  targetAgentId: IdSchema,
  reason: Schema.Literal("claim_conflict", "max_retries", "target_unavailable"),
  attemptCount: Schema.Number,
  failedAt: EpochMillisSchema
});
export type MailboxDeliveryFailedPayload = typeof MailboxDeliveryFailedPayloadSchema.Type;

export const ArtifactDiffDetectedPayloadSchema = Schema.Struct({
  runId: IdSchema,
  path: Schema.String
});
export type ArtifactDiffDetectedPayload = typeof ArtifactDiffDetectedPayloadSchema.Type;

export const WorkflowCreatedPayloadSchema = Schema.Struct({
  workflow: AgentWorkflowSchema,
  version: AgentWorkflowVersionSchema,
  nodes: Schema.Array(AgentWorkflowNodeSchema),
  edges: Schema.Array(AgentWorkflowEdgeSchema),
  validation: Schema.optional(WorkflowValidationResultSchema)
});
export type WorkflowCreatedPayload = typeof WorkflowCreatedPayloadSchema.Type;

export const WorkflowVersionUpdatedPayloadSchema = Schema.Struct({
  workflowId: IdSchema,
  version: AgentWorkflowVersionSchema,
  nodes: Schema.Array(AgentWorkflowNodeSchema),
  edges: Schema.Array(AgentWorkflowEdgeSchema),
  validation: WorkflowValidationResultSchema
});
export type WorkflowVersionUpdatedPayload = typeof WorkflowVersionUpdatedPayloadSchema.Type;

export const WorkflowDeletedPayloadSchema = Schema.Struct({
  workflowId: IdSchema,
  workspaceId: IdSchema,
  roomId: Schema.optional(IdSchema),
  deletedAt: EpochMillisSchema
});
export type WorkflowDeletedPayload = typeof WorkflowDeletedPayloadSchema.Type;

export const WorkflowRunPayloadSchema = Schema.Struct({
  workflowId: IdSchema,
  run: AgentWorkflowRunSchema
});
export type WorkflowRunPayload = typeof WorkflowRunPayloadSchema.Type;

export const WorkflowNodeRunPayloadSchema = Schema.Struct({
  workflowId: IdSchema,
  workflowRunId: IdSchema,
  nodeRun: AgentWorkflowNodeRunSchema
});
export type WorkflowNodeRunPayload = typeof WorkflowNodeRunPayloadSchema.Type;

export const WorkflowEdgeDeliveryPayloadSchema = Schema.Struct({
  workflowId: IdSchema,
  workflowRunId: IdSchema,
  delivery: AgentWorkflowEdgeDeliverySchema
});
export type WorkflowEdgeDeliveryPayload = typeof WorkflowEdgeDeliveryPayloadSchema.Type;

export const EVENT_PAYLOAD_SCHEMAS = {
  "agent.profile.removed": AgentProfileRemovedPayloadSchema,
  "agent.profile.error": AgentProfileErrorPayloadSchema,
  "mailbox.delivery.failed": MailboxDeliveryFailedPayloadSchema,
  "artifact.diff.detected": ArtifactDiffDetectedPayloadSchema,
  "workflow.created": WorkflowCreatedPayloadSchema,
  "workflow.version.updated": WorkflowVersionUpdatedPayloadSchema,
  "workflow.deleted": WorkflowDeletedPayloadSchema,
  "workflow.run.started": WorkflowRunPayloadSchema,
  "workflow.run.completed": WorkflowRunPayloadSchema,
  "workflow.run.failed": WorkflowRunPayloadSchema,
  "workflow.run.cancelled": WorkflowRunPayloadSchema,
  "workflow.node.queued": WorkflowNodeRunPayloadSchema,
  "workflow.node.started": WorkflowNodeRunPayloadSchema,
  "workflow.node.completed": WorkflowNodeRunPayloadSchema,
  "workflow.node.failed": WorkflowNodeRunPayloadSchema,
  "workflow.node.skipped": WorkflowNodeRunPayloadSchema,
  "workflow.node.cancelled": WorkflowNodeRunPayloadSchema,
  "workflow.edge.delivery.created": WorkflowEdgeDeliveryPayloadSchema,
  "workflow.edge.delivery.mailbox_created": WorkflowEdgeDeliveryPayloadSchema,
  "workflow.edge.delivery.delivered": WorkflowEdgeDeliveryPayloadSchema,
  "workflow.edge.delivery.cancelled": WorkflowEdgeDeliveryPayloadSchema,
  "workflow.edge.delivery.failed": WorkflowEdgeDeliveryPayloadSchema
} as const;

export const EVENT_REGISTRY = [
  { type: "message.created", category: "message", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "message.part.delta", category: "message", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "message.part.added", category: "message", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "message.completed", category: "message", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "message.cancelled", category: "message", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "message.deleted", category: "message", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "message.updated", category: "message", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "message.brief.published", category: "message", durability: "durable", visibility: "main", schemaVersion: 1 },
  { type: "pending_turn.created", category: "message", durability: "durable", visibility: "main", schemaVersion: 1 },
  { type: "pending_turn.cancelled", category: "message", durability: "durable", visibility: "main", schemaVersion: 1 },
  { type: "pending_turn.scheduled", category: "message", durability: "durable", visibility: "main", schemaVersion: 1 },
  { type: "pending_turn.consumed", category: "message", durability: "durable", visibility: "main", schemaVersion: 1 },
  { type: "room.created", category: "room", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "room.opened", category: "room", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "room.closed", category: "room", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.profile.loaded", category: "agent", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "agent.profile.updated", category: "agent", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "agent.profile.removed", category: "agent", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "agent.profile.error", category: "agent", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "agent.joined", category: "agent", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.left", category: "agent", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.state.changed", category: "agent", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.blocked", category: "agent", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.capabilities.updated", category: "agent", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "agent.token.delta", category: "agent", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "agent.typing", category: "agent", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "agent.status_line.updated", category: "agent", durability: "ephemeral", visibility: "main", schemaVersion: 1 },
  { type: "agent.run.queued", category: "run", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.run.waiting", category: "run", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.run.started", category: "run", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.run.completed", category: "run", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.run.failed", category: "run", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.run.cancelling", category: "run", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.run.cancelled", category: "run", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.run.waiting_permission", category: "run", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "agent.run.resumed", category: "run", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "run.heartbeat", category: "run", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "tool.call.requested", category: "run", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "tool.call.completed", category: "run", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "tool.update.diverted", category: "run", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "tool.output.delta", category: "run", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "subagent.started", category: "run", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "subagent.completed", category: "run", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "file.changed", category: "run", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "task.created", category: "task", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "task.assigned", category: "task", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "task.status.changed", category: "task", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "task.status.changed.rejected", category: "task", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "role.created", category: "role", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "role.updated", category: "role", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "role.deleted", category: "role", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "runtime.detected", category: "runtime", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "runtime.updated", category: "runtime", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "runtime.removed", category: "runtime", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "model_config.created", category: "model", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "model_config.updated", category: "model", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "model_config.deleted", category: "model", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "agent_binding.created", category: "binding", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "agent_binding.updated", category: "binding", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "agent_binding.removed", category: "binding", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "task.activity.added", category: "task", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "task.delegation.created", category: "task", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "task.delegation.completed", category: "task", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "team.dispatch.started", category: "team", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "team.dispatch.completed", category: "team", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "permission.run_summary", category: "permission", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "context.item.created", category: "context", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "context.item.proposed", category: "context", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "context.item.confirmed", category: "context", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "context.item.update_requested", category: "context", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "context.item.conflict_created", category: "context", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "context.item.deprecated", category: "context", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "context.item.visibility.changed", category: "context", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "context.snapshot", category: "context", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "permission.requested", category: "permission", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "permission.resolved", category: "permission", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "intervention.requested", category: "intervention", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "intervention.approved", category: "intervention", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "intervention.ignored", category: "intervention", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "intervention.rejected", category: "intervention", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "intervention.snoozed", category: "intervention", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "intervention.injected", category: "intervention", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "intervention.resolved", category: "intervention", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "intervention.closed", category: "intervention", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "intervention.invalid_transition", category: "intervention", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "artifact.diff.created", category: "artifact", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "artifact.diff.detected", category: "artifact", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "artifact.file.created", category: "artifact", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "artifact.reviewing", category: "artifact", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "artifact.accepted", category: "artifact", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "artifact.applying", category: "artifact", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "artifact.applied", category: "artifact", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "artifact.rejected", category: "artifact", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "artifact.failed", category: "artifact", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "artifact.preview.started", category: "artifact", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "artifact.preview.stopped", category: "artifact", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "adapter.registered", category: "adapter", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "adapter.session.created", category: "adapter", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "adapter.session.ended", category: "adapter", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "adapter.session.disposed", category: "adapter", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "adapter.crashed", category: "adapter", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "adapter.liveness.changed", category: "adapter", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "adapter.config.updated", category: "adapter", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "adapter.raw.stdout", category: "adapter", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "adapter.raw.stderr", category: "adapter", durability: "ephemeral", visibility: "detail", schemaVersion: 1 },
  { type: "mailbox.message.created", category: "mailbox", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "mailbox.delivery.failed", category: "mailbox", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "worktree.gc.removed", category: "local-daemon", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "worktree.gc.skipped", category: "local-daemon", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "auth.token.issued", category: "auth", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "auth.token.revoked", category: "auth", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "handler.stalled", category: "bus", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "server.connected", category: "server", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "server.shutting_down", category: "server", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "ui.toast.shown", category: "ui", durability: "ephemeral", visibility: "main", schemaVersion: 1 },
  { type: "ui.presence.changed", category: "ui", durability: "ephemeral", visibility: "main", schemaVersion: 1 },
  { type: "stream.chunk", category: "ui", durability: "ephemeral", visibility: "main", schemaVersion: 1 },
  // ---------------------------------------------------------------------------
  // V1.1 new event types (contract week — all 16 registered here before branching)
  // ---------------------------------------------------------------------------
  // task category additions
  { type: "task.column.moved", category: "task", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "task.plan.created", category: "task", durability: "durable", visibility: "main", schemaVersion: 1 },
  // run category additions
  { type: "run.file_changes.recorded", category: "run", durability: "durable", visibility: "both", schemaVersion: 1 },
  // worktree category (new in V1.1)
  { type: "worktree.diff.ready", category: "worktree", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "worktree.applied", category: "worktree", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "worktree.discarded", category: "worktree", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "worktree.conflict_detected", category: "worktree", durability: "durable", visibility: "both", schemaVersion: 1 },
  // room category additions
  { type: "room.stalled", category: "room", durability: "durable", visibility: "main", schemaVersion: 1 },
  { type: "room.unstalled", category: "room", durability: "durable", visibility: "main", schemaVersion: 1 },
  // skill category (new in V1.1)
  { type: "skill.created", category: "skill", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "skill.updated", category: "skill", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "skill.deleted", category: "skill", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "skill.imported", category: "skill", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "skill.activated", category: "skill", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "skill.deactivated", category: "skill", durability: "durable", visibility: "detail", schemaVersion: 1 },
  { type: "skill.materialization_failed", category: "skill", durability: "durable", visibility: "main", schemaVersion: 1 },
  // workflow canvas events
  { type: "workflow.created", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.version.updated", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.deleted", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.run.started", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.run.completed", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.run.failed", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.run.cancelled", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.node.queued", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.node.started", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.node.completed", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.node.failed", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.node.skipped", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.node.cancelled", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.edge.delivery.created", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.edge.delivery.mailbox_created", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.edge.delivery.delivered", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.edge.delivery.cancelled", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 },
  { type: "workflow.edge.delivery.failed", category: "workflow", durability: "durable", visibility: "both", schemaVersion: 1 }
] as const satisfies readonly EventRegistryEntry[];

export type EventType = (typeof EVENT_REGISTRY)[number]["type"];

export const EVENT_REGISTRY_BY_TYPE: ReadonlyMap<EventType, EventRegistryEntry> = new Map(EVENT_REGISTRY.map((entry) => [entry.type, entry]));

export function getEventRegistryEntry(type: EventType): EventRegistryEntry {
  const entry = EVENT_REGISTRY_BY_TYPE.get(type);
  if (!entry) {
    throw new Error(`event type '${type}' not found in canonical registry`);
  }
  return entry;
}

export function isRegisteredEventType(type: string): type is EventType {
  return EVENT_REGISTRY_BY_TYPE.has(type as EventType);
}

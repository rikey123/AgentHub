import { Schema } from "effect";
import { EpochMillisSchema, IdSchema, JsonObjectSchema } from "./primitives.ts";

export const WorkflowNodeKindSchema = Schema.Literal("agent_context", "note");
export type WorkflowNodeKind = typeof WorkflowNodeKindSchema.Type;

export const WorkflowVersionStateSchema = Schema.Literal("draft", "locked");
export type WorkflowVersionState = typeof WorkflowVersionStateSchema.Type;

export const WorkflowRunStatusSchema = Schema.Literal("queued", "running", "completed", "failed", "cancelled");
export type WorkflowRunStatus = typeof WorkflowRunStatusSchema.Type;

export const WorkflowNodeRunStatusSchema = Schema.Literal(
  "waiting",
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled"
);
export type WorkflowNodeRunStatus = typeof WorkflowNodeRunStatusSchema.Type;

export const WorkflowEdgeDeliveryStatusSchema = Schema.Literal(
  "queued",
  "mailbox_created",
  "delivered",
  "failed",
  "skipped",
  "cancelled"
);
export type WorkflowEdgeDeliveryStatus = typeof WorkflowEdgeDeliveryStatusSchema.Type;

export const WorkflowValidationIssueSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  nodeId: Schema.optional(IdSchema),
  edgeId: Schema.optional(IdSchema),
  severity: Schema.Literal("error", "warning")
});
export type WorkflowValidationIssue = typeof WorkflowValidationIssueSchema.Type;

export const WorkflowNeighborIndexSchema = Schema.Record({ key: IdSchema, value: Schema.Array(IdSchema) });
export type WorkflowNeighborIndex = typeof WorkflowNeighborIndexSchema.Type;

export const WorkflowValidationResultSchema = Schema.Struct({
  runnable: Schema.Boolean,
  issues: Schema.Array(WorkflowValidationIssueSchema),
  upstreamByNodeId: WorkflowNeighborIndexSchema,
  downstreamByNodeId: WorkflowNeighborIndexSchema
});
export type WorkflowValidationResult = typeof WorkflowValidationResultSchema.Type;

export const AgentWorkflowSchema = Schema.Struct({
  id: IdSchema,
  workspaceId: IdSchema,
  roomId: Schema.optional(IdSchema),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  draftVersionId: Schema.optional(IdSchema),
  activeVersionId: Schema.optional(IdSchema),
  createdBy: Schema.optional(IdSchema),
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema,
  deletedAt: Schema.optional(EpochMillisSchema)
});
export type AgentWorkflow = typeof AgentWorkflowSchema.Type;

export const AgentWorkflowVersionSchema = Schema.Struct({
  id: IdSchema,
  workflowId: IdSchema,
  versionNumber: Schema.Number,
  state: WorkflowVersionStateSchema,
  valid: Schema.Boolean,
  validationErrors: Schema.Array(WorkflowValidationIssueSchema),
  viewport: JsonObjectSchema,
  createdFromVersionId: Schema.optional(IdSchema),
  lockedFromVersionId: Schema.optional(IdSchema),
  lockedAt: Schema.optional(EpochMillisSchema),
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema
});
export type AgentWorkflowVersion = typeof AgentWorkflowVersionSchema.Type;

export const AgentWorkflowNodeSchema = Schema.Struct({
  id: IdSchema,
  workflowVersionId: IdSchema,
  nodeId: IdSchema,
  kind: WorkflowNodeKindSchema,
  displayName: Schema.String,
  agentBindingId: Schema.optional(IdSchema),
  roleLabel: Schema.optional(Schema.String),
  prompt: Schema.String,
  position: Schema.Struct({ x: Schema.Number, y: Schema.Number }),
  size: Schema.optional(Schema.Struct({ width: Schema.Number, height: Schema.Number })),
  enabled: Schema.Boolean,
  locked: Schema.Boolean,
  config: JsonObjectSchema,
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema
});
export type AgentWorkflowNode = typeof AgentWorkflowNodeSchema.Type;

export const AgentWorkflowEdgeSchema = Schema.Struct({
  id: IdSchema,
  workflowVersionId: IdSchema,
  edgeId: IdSchema,
  sourceNodeId: IdSchema,
  targetNodeId: IdSchema,
  label: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  config: JsonObjectSchema,
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema
});
export type AgentWorkflowEdge = typeof AgentWorkflowEdgeSchema.Type;

export const AgentWorkflowRunSchema = Schema.Struct({
  id: IdSchema,
  workflowId: IdSchema,
  workflowVersionId: IdSchema,
  workspaceId: IdSchema,
  roomId: Schema.optional(IdSchema),
  status: WorkflowRunStatusSchema,
  seedContext: Schema.optional(Schema.String),
  startedBy: Schema.optional(IdSchema),
  startedAt: Schema.optional(EpochMillisSchema),
  endedAt: Schema.optional(EpochMillisSchema),
  failureReason: Schema.optional(Schema.String),
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema
});
export type AgentWorkflowRun = typeof AgentWorkflowRunSchema.Type;

export const AgentWorkflowNodeRunSchema = Schema.Struct({
  id: IdSchema,
  workflowRunId: IdSchema,
  workflowNodeId: IdSchema,
  nodeId: IdSchema,
  agentRunId: Schema.optional(IdSchema),
  agentBindingId: Schema.optional(IdSchema),
  status: WorkflowNodeRunStatusSchema,
  inputContexts: Schema.Array(JsonObjectSchema),
  outputContext: Schema.optional(JsonObjectSchema),
  error: Schema.optional(Schema.String),
  queuedAt: Schema.optional(EpochMillisSchema),
  startedAt: Schema.optional(EpochMillisSchema),
  completedAt: Schema.optional(EpochMillisSchema),
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema
});
export type AgentWorkflowNodeRun = typeof AgentWorkflowNodeRunSchema.Type;

export const AgentWorkflowEdgeDeliverySchema = Schema.Struct({
  id: IdSchema,
  workflowRunId: IdSchema,
  workflowEdgeId: IdSchema,
  edgeId: IdSchema,
  sourceNodeId: IdSchema,
  targetNodeId: IdSchema,
  sourceNodeRunId: Schema.optional(IdSchema),
  targetNodeRunId: Schema.optional(IdSchema),
  mailboxMessageId: Schema.optional(IdSchema),
  status: WorkflowEdgeDeliveryStatusSchema,
  context: JsonObjectSchema,
  idempotencyKey: Schema.optional(Schema.String),
  attemptCount: Schema.Number,
  error: Schema.optional(Schema.String),
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema,
  deliveredAt: Schema.optional(EpochMillisSchema)
});
export type AgentWorkflowEdgeDelivery = typeof AgentWorkflowEdgeDeliverySchema.Type;

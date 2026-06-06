import { Schema } from "effect";
import { ContextScopeSchema, EpochMillisSchema, IdSchema } from "./primitives.ts";

export const RoomModeSchema = Schema.Literal("solo", "assisted", "team", "squad", "war_room");
export const AgentPresenceStateSchema = Schema.Literal(
  "offline",
  "observing",
  "active",
  "working",
  "waiting_approval",
  "knocking",
  "blocked"
);

export const RoomParticipantSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("user"),
    userId: IdSchema,
    role: Schema.Literal("owner", "member")
  }),
  Schema.Struct({
    type: Schema.Literal("agent"),
    agentId: IdSchema,
    role: Schema.Literal("primary", "observer", "reviewer", "specialist"),
    adapterId: IdSchema,
    adapterSessionId: Schema.optional(IdSchema),
    defaultPresence: Schema.Literal("offline", "observing", "active")
  })
);
export type RoomParticipant = typeof RoomParticipantSchema.Type;

export const RoomSchema = Schema.Struct({
  id: IdSchema,
  workspaceId: IdSchema,
  title: Schema.String,
  mode: RoomModeSchema,
  defaultContextScope: Schema.Literal("conversation", "task", "workspace"),
  primaryAgentId: Schema.optional(IdSchema),
  participants: Schema.Array(RoomParticipantSchema),
  archivedAt: Schema.optional(EpochMillisSchema),
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema
});
export type Room = typeof RoomSchema.Type;

export const MessageSenderSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal("user"), id: IdSchema }),
  Schema.Struct({ type: Schema.Literal("agent"), id: IdSchema, runId: Schema.optional(IdSchema) }),
  Schema.Struct({ type: Schema.Literal("system"), id: Schema.Literal("system") })
);
export type MessageSender = typeof MessageSenderSchema.Type;

export const PermissionResourceSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal("file"), path: Schema.String, operation: Schema.Literal("read", "write", "delete") }),
  Schema.Struct({ type: Schema.Literal("shell"), command: Schema.String }),
  Schema.Struct({ type: Schema.Literal("tool"), toolName: Schema.String, input: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("context"), contextId: Schema.optional(IdSchema), operation: Schema.Literal("read", "write", "share") }),
  Schema.Struct({ type: Schema.Literal("agent"), targetAgentId: IdSchema, operation: Schema.Literal("invoke", "interrupt", "mention", "control") })
);
export type PermissionResource = typeof PermissionResourceSchema.Type;

export const CardSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("task"),
    taskId: IdSchema,
    title: Schema.String,
    status: Schema.Literal("todo", "queued", "running", "waiting_approval", "blocked", "review", "done", "failed", "cancelled"),
    assigneeAgentId: Schema.optional(IdSchema)
  }),
  Schema.Struct({
    type: Schema.Literal("context"),
    contextId: IdSchema,
    title: Schema.String,
    summary: Schema.String,
    status: Schema.Literal("draft", "confirmed", "deprecated", "disputed"),
    actions: Schema.Array(Schema.Literal("confirm", "edit", "discard"))
  }),
  Schema.Struct({
    type: Schema.Literal("diff"),
    artifactId: IdSchema,
    files: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        additions: Schema.Number,
        deletions: Schema.Number,
        status: Schema.Literal("added", "modified", "deleted")
      })
    ),
    applyStatus: Schema.Literal("draft", "reviewing", "accepted", "applying", "applied", "rejected", "failed")
  }),
  Schema.Struct({ type: Schema.Literal("preview"), artifactId: IdSchema, url: Schema.String, kind: Schema.Literal("html", "markdown", "image") }),
  Schema.Struct({
    type: Schema.Literal("permission"),
    permissionId: IdSchema,
    agentId: IdSchema,
    resource: PermissionResourceSchema,
    reason: Schema.optional(Schema.String),
    status: Schema.Literal("pending", "allowed", "denied", "expired")
  }),
  Schema.Struct({
    type: Schema.Literal("intervention"),
    interventionId: IdSchema,
    agentId: IdSchema,
    reason: Schema.String,
    priority: Schema.Literal("low", "medium", "high"),
    preview: Schema.optional(Schema.String),
    actions: Schema.Array(Schema.Literal("approve", "later", "ignore", "reject")),
    status: Schema.Literal("pending_user_decision", "approved", "ignored", "rejected", "snoozed", "injected", "resolved", "closed")
  }),
  Schema.Struct({ type: Schema.Literal("decision"), data: Schema.optional(Schema.Unknown) }),
  Schema.Struct({ type: Schema.Literal("trust"), data: Schema.optional(Schema.Unknown) }),
  Schema.Struct({ type: Schema.Literal("memory"), data: Schema.optional(Schema.Unknown) })
);
export type Card = typeof CardSchema.Type;

export const MessagePartSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal("text"), seq: Schema.Number, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("code"), seq: Schema.Number, lang: Schema.String, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("tool_call"), seq: Schema.Number, name: Schema.String, input: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("tool_result"), seq: Schema.Number, toolCallId: IdSchema, output: Schema.Unknown, ok: Schema.Boolean }),
  Schema.Struct({
    type: Schema.Literal("attachment"),
    seq: Schema.Number,
    fileId: IdSchema,
    name: Schema.String,
    mimeType: Schema.String,
    sizeBytes: Schema.Number,
    artifactId: Schema.optional(IdSchema),
    path: Schema.optional(Schema.String),
    previewKind: Schema.optional(Schema.Literal("markdown", "text", "code", "image", "download"))
  }),
  Schema.Struct({ type: Schema.Literal("card"), seq: Schema.Number, card: CardSchema })
);
export type MessagePart = typeof MessagePartSchema.Type;

export const MessageSchema = Schema.Struct({
  id: IdSchema,
  roomId: IdSchema,
  sender: MessageSenderSchema,
  role: Schema.Literal("user", "assistant", "system", "tool"),
  status: Schema.Literal("streaming", "completed", "failed", "cancelled", "deleted"),
  quotedMessageId: Schema.optional(IdSchema),
  turnDispatchMode: Schema.optional(Schema.Literal("immediate", "pending")),
  pendingTurnId: Schema.optional(IdSchema),
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema
});
export type Message = typeof MessageSchema.Type;

export const AgentCapabilitySchema = Schema.Literal(
  "chat",
  "code.edit",
  "code.review",
  "terminal.run",
  "file.read",
  "file.write",
  "web.search",
  "web.fetch",
  "context.read",
  "context.write",
  "intervention.knock",
  "task.delegate"
);

export const AgentProfileSchema = Schema.Struct({
  id: IdSchema,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  avatar: Schema.optional(Schema.String),
  provider: Schema.Literal("native", "claude-code", "codex", "opencode", "langgraph", "a2a"),
  adapterId: IdSchema,
  model: Schema.optional(Schema.String),
  prompt: Schema.String,
  defaultPresence: Schema.Literal("offline", "observing", "active"),
  capabilities: Schema.Array(AgentCapabilitySchema),
  permissionProfileId: Schema.optional(IdSchema),
  hidden: Schema.optional(Schema.Boolean)
});
export type AgentProfile = typeof AgentProfileSchema.Type;

export const RunCostSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedTokens: Schema.Number,
  costUsd: Schema.Number,
  modelId: Schema.String
});

export const RunSchema = Schema.Struct({
  id: IdSchema,
  taskId: Schema.optional(IdSchema),
  roomId: IdSchema,
  agentId: IdSchema,
  adapterId: IdSchema,
  adapterSessionId: Schema.optional(IdSchema),
  status: Schema.Literal("queued", "waiting", "starting", "running", "waiting_permission", "cancelling", "completed", "failed", "cancelled"),
  waitingReason: Schema.optional(Schema.String),
  workspacePath: Schema.optional(Schema.String),
  contextVersion: Schema.optional(Schema.Number),
  startedAt: Schema.optional(EpochMillisSchema),
  endedAt: Schema.optional(EpochMillisSchema),
  cost: Schema.optional(RunCostSchema)
});
export type Run = typeof RunSchema.Type;

export const ContextItemSchema = Schema.Struct({
  id: IdSchema,
  workspaceId: IdSchema,
  roomId: Schema.optional(IdSchema),
  taskId: Schema.optional(IdSchema),
  runId: Schema.optional(IdSchema),
  type: Schema.Literal("fact", "decision", "constraint", "issue", "artifact", "preference", "summary"),
  scope: ContextScopeSchema,
  content: Schema.String,
  source: Schema.Struct({ type: Schema.Literal("user", "agent", "tool", "file", "system"), id: Schema.optional(Schema.String) }),
  visibility: Schema.Struct({ agents: Schema.optional(Schema.Array(IdSchema)), roles: Schema.optional(Schema.Array(Schema.String)), users: Schema.optional(Schema.Array(IdSchema)) }),
  status: Schema.Literal("draft", "confirmed", "deprecated", "disputed"),
  confidence: Schema.Literal("verified", "inferred", "unverified"),
  version: Schema.Number,
  ownerId: Schema.optional(IdSchema),
  ownerType: Schema.optional(Schema.Literal("user", "agent", "system")),
  createdBy: IdSchema,
  pinned: Schema.optional(Schema.Boolean),
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema
});
export type ContextItem = typeof ContextItemSchema.Type;

export const PermissionRequestSchema = Schema.Struct({
  id: IdSchema,
  workspaceId: IdSchema,
  roomId: IdSchema,
  agentId: IdSchema,
  runId: Schema.optional(IdSchema),
  resource: PermissionResourceSchema,
  reason: Schema.optional(Schema.String),
  status: Schema.Literal("pending", "allowed", "denied", "expired"),
  rememberDecision: Schema.optional(Schema.Boolean),
  scope: Schema.optional(Schema.Literal("once", "this_run", "this_room", "this_workspace")),
  createdAt: EpochMillisSchema,
  resolvedAt: Schema.optional(EpochMillisSchema),
  expiresAt: EpochMillisSchema
});
export type PermissionRequest = typeof PermissionRequestSchema.Type;

export const InterventionSchema = Schema.Struct({
  id: IdSchema,
  workspaceId: IdSchema,
  roomId: IdSchema,
  sourceAgentId: IdSchema,
  targetRunId: Schema.optional(IdSchema),
  targetMessageId: Schema.optional(IdSchema),
  targetContextId: Schema.optional(IdSchema),
  targetArtifactId: Schema.optional(IdSchema),
  type: Schema.Literal("knock", "tag", "rule", "emergency", "rollback"),
  reason: Schema.String,
  preview: Schema.optional(Schema.String),
  priority: Schema.Literal("low", "medium", "high"),
  status: Schema.Literal("requested", "pending_user_decision", "approved", "ignored", "rejected", "snoozed", "injected", "resolved", "closed"),
  snoozedUntil: Schema.optional(EpochMillisSchema),
  createdAt: EpochMillisSchema,
  resolvedAt: Schema.optional(EpochMillisSchema)
});
export type Intervention = typeof InterventionSchema.Type;

export const ArtifactFileSchema = Schema.Struct({
  artifactId: IdSchema,
  path: Schema.String,
  oldContent: Schema.optional(Schema.String),
  newContent: Schema.optional(Schema.String),
  patch: Schema.optional(Schema.String),
  additions: Schema.Number,
  deletions: Schema.Number,
  fileStatus: Schema.Literal("added", "modified", "deleted"),
  oldSha256: Schema.optional(Schema.String),
  appliedState: Schema.optional(Schema.Literal("original", "new", "unknown"))
});
export type ArtifactFile = typeof ArtifactFileSchema.Type;

export const ArtifactSchema = Schema.Struct({
  id: IdSchema,
  workspaceId: IdSchema,
  roomId: Schema.optional(IdSchema),
  taskId: Schema.optional(IdSchema),
  runId: Schema.optional(IdSchema),
  messageId: Schema.optional(IdSchema),
  type: Schema.Literal("diff", "file", "preview", "document", "terminal", "deployment", "worktree_diff"),
  title: Schema.String,
  status: Schema.Literal("draft", "reviewing", "accepted", "applying", "applied", "rejected", "failed", "ready_for_review", "conflict", "discarded"),
  createdBy: IdSchema,
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema,
  appliedAt: Schema.optional(EpochMillisSchema)
});
export type Artifact = typeof ArtifactSchema.Type;

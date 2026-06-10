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
  pinnedAt: Schema.optional(EpochMillisSchema),
  lastActivityAt: Schema.optional(EpochMillisSchema),
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

export const ArtifactKindSchema = Schema.Literal(
  "web_page",
  "web_app",
  "document",
  "presentation",
  "presentation_pptx",
  "source_code",
  "generic_file"
);
export type ArtifactKind = typeof ArtifactKindSchema.Type;

export const DeploymentKindSchema = Schema.Literal(
  "preview-url",
  "static-site",
  "source-zip",
  "container-export",
  "container-build",
  "self-hosted"
);
export type DeploymentKind = typeof DeploymentKindSchema.Type;

export const DeploymentProviderKindSchema = Schema.Literal("agenthub-local", "caprover");
export type DeploymentProviderKind = typeof DeploymentProviderKindSchema.Type;

export const DeploymentStatusSchema = Schema.Literal(
  "queued",
  "in_progress",
  "ready",
  "failed",
  "cancelled",
  "expired",
  "unpublished"
);
export type DeploymentStatus = typeof DeploymentStatusSchema.Type;

export const ArtifactCardPayloadSchema = Schema.Struct({
  type: Schema.Literal("artifact"),
  artifactId: IdSchema,
  kind: ArtifactKindSchema,
  title: Schema.String,
  filename: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Number)
});
export type ArtifactCardPayload = typeof ArtifactCardPayloadSchema.Type;

export const DeploymentCardPayloadSchema = Schema.Struct({
  type: Schema.Literal("deployment"),
  deploymentId: IdSchema,
  artifactId: IdSchema,
  kind: DeploymentKindSchema,
  provider: DeploymentProviderKindSchema,
  status: DeploymentStatusSchema,
  url: Schema.optional(Schema.String),
  downloadUrl: Schema.optional(Schema.String),
  imageTag: Schema.optional(Schema.String),
  expiresAt: Schema.optional(EpochMillisSchema)
});
export type DeploymentCardPayload = typeof DeploymentCardPayloadSchema.Type;

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
  ArtifactCardPayloadSchema,
  DeploymentCardPayloadSchema,
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
    previewKind: Schema.optional(Schema.Literal("markdown", "text", "code", "html", "image", "pdf", "audio", "video", "download"))
  }),
  Schema.Struct({ type: Schema.Literal("card"), seq: Schema.Number, card: CardSchema })
);
export type MessagePart = typeof MessagePartSchema.Type;

export const MessageContextRefSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("artifact"),
    artifactId: IdSchema,
    lineStart: Schema.optional(Schema.Number),
    lineEnd: Schema.optional(Schema.Number),
    slide: Schema.optional(Schema.Number)
  }),
  Schema.Struct({
    type: Schema.Literal("workspace"),
    path: Schema.String,
    lineStart: Schema.optional(Schema.Number),
    lineEnd: Schema.optional(Schema.Number)
  })
);
export type MessageContextRef = typeof MessageContextRefSchema.Type;

export const MessageMentionSchema = Schema.Struct({
  agentBindingId: IdSchema,
  label: Schema.optional(Schema.String),
  roleName: Schema.optional(Schema.String),
  runtimeName: Schema.optional(Schema.String)
});
export type MessageMention = typeof MessageMentionSchema.Type;

export const MessageCreatePayloadSchema = Schema.Struct({
  messageId: IdSchema,
  role: Schema.Literal("user", "assistant", "system", "tool"),
  senderId: Schema.optional(IdSchema),
  senderType: Schema.optional(Schema.Literal("user", "agent", "system")),
  text: Schema.optional(Schema.String),
  parts: Schema.optional(Schema.Array(MessagePartSchema)),
  mentions: Schema.optional(Schema.Array(MessageMentionSchema)),
  refs: Schema.optional(Schema.Array(MessageContextRefSchema)),
  quotedMessageId: Schema.optional(IdSchema),
  pendingTurnId: Schema.optional(IdSchema)
});
export type MessageCreatePayload = typeof MessageCreatePayloadSchema.Type;

export const RoomViewModelSchema = Schema.Struct({
  id: IdSchema,
  title: Schema.String,
  mode: Schema.String,
  primaryAgentId: Schema.optional(IdSchema),
  pinnedAt: Schema.optional(EpochMillisSchema),
  lastActivityAt: Schema.optional(EpochMillisSchema),
  participants: Schema.Array(Schema.Unknown),
  participantContactNames: Schema.Record({ key: Schema.String, value: Schema.String }),
  messages: Schema.Array(Schema.Unknown),
  briefs: Schema.Array(Schema.Unknown),
  unresolvedInterventions: Schema.Array(Schema.Unknown),
  pendingPermissions: Schema.Array(Schema.Unknown),
  contextItems: Schema.Array(Schema.Unknown),
  tasks: Schema.Array(Schema.Unknown),
  runs: Schema.Array(Schema.Unknown),
  pendingTurns: Schema.Array(Schema.Unknown),
  mailboxFailures: Schema.Array(Schema.Unknown),
  artifactVersionsById: Schema.Record({ key: Schema.String, value: Schema.Array(Schema.Unknown) }),
  deploymentsById: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  deploymentLogsById: Schema.Record({ key: Schema.String, value: Schema.Array(Schema.String) }),
  cursor: Schema.optional(Schema.String),
  unreadCount: Schema.Number
});
export type RoomViewModel = typeof RoomViewModelSchema.Type;

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
  contentPath: Schema.optional(Schema.String),
  isBinary: Schema.optional(Schema.Boolean),
  mimeType: Schema.optional(Schema.String),
  sizeBytes: Schema.optional(Schema.Number),
  patch: Schema.optional(Schema.String),
  additions: Schema.Number,
  deletions: Schema.Number,
  fileStatus: Schema.Literal("added", "modified", "deleted"),
  oldSha256: Schema.optional(Schema.String),
  newSha256: Schema.optional(Schema.String),
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
  kind: Schema.optional(ArtifactKindSchema),
  title: Schema.String,
  status: Schema.Literal("draft", "reviewing", "accepted", "applying", "applied", "rejected", "failed", "ready_for_review", "conflict", "discarded"),
  createdBy: IdSchema,
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema,
  appliedAt: Schema.optional(EpochMillisSchema)
});
export type Artifact = typeof ArtifactSchema.Type;

export const ArtifactVersionSchema = Schema.Struct({
  id: IdSchema,
  artifactId: IdSchema,
  version: Schema.Number,
  contentEncoding: Schema.Literal("text", "binary"),
  storagePath: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.String),
  createdBy: Schema.optional(IdSchema),
  message: Schema.optional(Schema.String),
  createdAt: EpochMillisSchema
});
export type ArtifactVersion = typeof ArtifactVersionSchema.Type;

export const DeploymentProviderSchema = Schema.Struct({
  id: IdSchema,
  workspaceId: IdSchema,
  kind: Schema.Literal("caprover", "dokploy", "coolify"),
  name: Schema.String,
  baseUrl: Schema.String,
  credentialRef: IdSchema,
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema
});
export type DeploymentProvider = typeof DeploymentProviderSchema.Type;

export const DeploymentSchema = Schema.Struct({
  id: IdSchema,
  artifactId: IdSchema,
  roomId: Schema.optional(IdSchema),
  workspaceId: IdSchema,
  kind: DeploymentKindSchema,
  provider: DeploymentProviderKindSchema,
  status: DeploymentStatusSchema,
  url: Schema.optional(Schema.String),
  downloadUrl: Schema.optional(Schema.String),
  imageTag: Schema.optional(Schema.String),
  providerResourceId: Schema.optional(Schema.String),
  providerConfigId: Schema.optional(IdSchema),
  sourcePath: Schema.optional(Schema.String),
  zipPath: Schema.optional(Schema.String),
  dockerfilePath: Schema.optional(Schema.String),
  logPath: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  pid: Schema.optional(Schema.String),
  artifactVersion: Schema.optional(Schema.Number),
  lastError: Schema.optional(Schema.String),
  startedAt: Schema.optional(EpochMillisSchema),
  finishedAt: Schema.optional(EpochMillisSchema),
  cancelledAt: Schema.optional(EpochMillisSchema),
  expiresAt: Schema.optional(EpochMillisSchema),
  publishedAt: Schema.optional(EpochMillisSchema),
  unpublishedAt: Schema.optional(EpochMillisSchema),
  createdAt: EpochMillisSchema,
  updatedAt: EpochMillisSchema
});
export type Deployment = typeof DeploymentSchema.Type;

export const WakeOutboxSchema = Schema.Struct({
  id: IdSchema,
  roomId: IdSchema,
  agentId: IdSchema,
  reason: Schema.String,
  payload: Schema.optional(Schema.String),
  status: Schema.Literal("pending", "dispatching", "dispatched", "failed"),
  attemptCount: Schema.Number,
  maxAttempts: Schema.Number,
  lastError: Schema.optional(Schema.String),
  dispatchAfter: Schema.optional(EpochMillisSchema),
  dispatchedAt: Schema.optional(EpochMillisSchema),
  createdAt: EpochMillisSchema
});
export type WakeOutbox = typeof WakeOutboxSchema.Type;

export const AgentContactSchema = Schema.Struct({
  agentBindingId: IdSchema,
  displayName: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
  contactName: Schema.optional(Schema.String),
  roleId: IdSchema,
  runtimeKind: Schema.String,
  capabilities: Schema.Array(Schema.String),
  status: Schema.Literal("available", "busy", "offline"),
  contactDescription: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  lastUsedAt: Schema.optional(EpochMillisSchema)
});
export type AgentContact = typeof AgentContactSchema.Type;

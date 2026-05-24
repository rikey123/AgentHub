import { integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  title: text("title").notNull(),
  mode: text("mode").notNull(),
  defaultContextScope: text("default_context_scope").notNull(),
  primaryAgentId: text("primary_agent_id"),
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const roomParticipants = sqliteTable(
  "room_participants",
  {
    roomId: text("room_id").notNull(),
    participantId: text("participant_id").notNull(),
    participantType: text("participant_type").notNull(),
    role: text("role").notNull(),
    adapterId: text("adapter_id"),
    adapterSessionId: text("adapter_session_id"),
    defaultPresence: text("default_presence").notNull(),
    joinedAt: integer("joined_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.roomId, table.participantId] })]
);

export const agentProfiles = sqliteTable("agent_profiles", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id"),
  name: text("name").notNull(),
  description: text("description"),
  avatar: text("avatar"),
  version: text("version"),
  provider: text("provider"),
  defaultPresence: text("default_presence"),
  adapterId: text("adapter_id").notNull(),
  model: text("model"),
  rolePrompt: text("role_prompt").notNull(),
  capabilities: text("capabilities").notNull(),
  permissionProfileId: text("permission_profile_id"),
  hidden: integer("hidden").notNull(),
  sourcePath: text("source_path"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const agentPresence = sqliteTable(
  "agent_presence",
  {
    roomId: text("room_id").notNull(),
    agentId: text("agent_id").notNull(),
    state: text("state").notNull(),
    reason: text("reason"),
    statusLine: text("status_line"),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.roomId, table.agentId] })]
);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  roomId: text("room_id").notNull(),
  senderType: text("sender_type").notNull(),
  senderId: text("sender_id"),
  runId: text("run_id"),
  role: text("role").notNull(),
  status: text("status").notNull(),
  quotedMessageId: text("quoted_message_id"),
  turnDispatchMode: text("turn_dispatch_mode").notNull(),
  pendingTurnId: text("pending_turn_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
  briefPublishedAt: integer("brief_published_at")
});

export const messageParts = sqliteTable(
  "message_parts",
  {
    messageId: text("message_id").notNull(),
    seq: integer("seq").notNull(),
    partType: text("part_type").notNull(),
    payload: text("payload").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.messageId, table.seq] })]
);

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull(),
  fileId: text("file_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256"),
  storagePath: text("storage_path").notNull(),
  createdAt: integer("created_at").notNull()
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  seq: integer("seq").notNull().unique(),
  type: text("type").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  visibility: text("visibility").notNull(),
  workspaceId: text("workspace_id"),
  roomId: text("room_id"),
  taskId: text("task_id"),
  runId: text("run_id"),
  agentId: text("agent_id"),
  traceId: text("trace_id"),
  causationId: text("causation_id"),
  correlationId: text("correlation_id"),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull()
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  roomId: text("room_id"),
  parentTaskId: text("parent_task_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  assigneeAgentId: text("assignee_agent_id"),
  sourceRunId: text("source_run_id"),
  sourceMessageId: text("source_message_id"),
  dependencies: text("dependencies").notNull(),
  priority: text("priority"),
  dueAt: integer("due_at"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  taskId: text("task_id"),
  roomId: text("room_id").notNull(),
  agentId: text("agent_id").notNull(),
  adapterId: text("adapter_id"),
  adapterSessionId: text("adapter_session_id"),
  providerConversationId: text("provider_conversation_id"),
  parentRunId: text("parent_run_id"),
  status: text("status").notNull(),
  wakeReason: text("wake_reason"),
  waitingReason: text("waiting_reason"),
  workspacePath: text("workspace_path"),
  workDir: text("work_dir"),
  workspaceMode: text("workspace_mode"),
  contextVersion: integer("context_version"),
  targetFiles: text("target_files").notNull(),
  mailboxClaimCount: integer("mailbox_claim_count").notNull(),
  pidAtStart: integer("pid_at_start"),
  claimedAt: integer("claimed_at"),
  startedAt: integer("started_at"),
  endedAt: integer("ended_at"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cachedTokens: integer("cached_tokens"),
  costUsd: real("cost_usd"),
  modelId: text("model_id"),
  failureClass: text("failure_class"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const taskRuns = sqliteTable("task_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  runId: text("run_id").notNull(),
  createdAt: integer("created_at").notNull()
});

export const contextItems = sqliteTable("context_items", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  roomId: text("room_id"),
  taskId: text("task_id"),
  runId: text("run_id"),
  sourceMessageId: text("source_message_id"),
  type: text("type").notNull(),
  scope: text("scope").notNull(),
  content: text("content").notNull(),
  source: text("source").notNull(),
  visibility: text("visibility").notNull(),
  status: text("status").notNull(),
  confidence: real("confidence"),
  version: integer("version").notNull(),
  ownerId: text("owner_id"),
  ownerType: text("owner_type"),
  createdBy: text("created_by").notNull(),
  pinned: integer("pinned").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deprecatedAt: integer("deprecated_at")
});

export const contextVersions = sqliteTable(
  "context_versions",
  {
    contextId: text("context_id").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
    changedBy: text("changed_by").notNull(),
    changedAt: integer("changed_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.contextId, table.version] })]
);

export const permissionProfiles = sqliteTable("permission_profiles", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id"),
  name: text("name").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const permissionRules = sqliteTable("permission_rules", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  agentId: text("agent_id"),
  profileId: text("profile_id"),
  resourceType: text("resource_type").notNull(),
  resourceMatch: text("resource_match").notNull(),
  action: text("action").notNull(),
  remember: integer("remember").notNull(),
  createdAt: integer("created_at").notNull()
});

export const permissionRequests = sqliteTable("permission_requests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  roomId: text("room_id"),
  agentId: text("agent_id"),
  runId: text("run_id"),
  adapterSessionId: text("adapter_session_id"),
  idempotencyKey: text("idempotency_key"),
  resource: text("resource").notNull(),
  reason: text("reason"),
  status: text("status").notNull(),
  rememberDecision: integer("remember_decision").notNull(),
  scope: text("scope"),
  decision: text("decision"),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at"),
  expiresAt: integer("expires_at")
});

export const interventions = sqliteTable("interventions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  roomId: text("room_id").notNull(),
  sourceAgentId: text("source_agent_id").notNull(),
  targetRunId: text("target_run_id"),
  targetMessageId: text("target_message_id"),
  targetContextId: text("target_context_id"),
  targetArtifactId: text("target_artifact_id"),
  type: text("type").notNull(),
  reason: text("reason").notNull(),
  preview: text("preview"),
  priority: text("priority").notNull(),
  status: text("status").notNull(),
  snoozedUntil: integer("snoozed_until"),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at")
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  roomId: text("room_id"),
  taskId: text("task_id"),
  runId: text("run_id"),
  messageId: text("message_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  createdBy: text("created_by"),
  metadata: text("metadata").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  appliedAt: integer("applied_at")
});

export const artifactFiles = sqliteTable(
  "artifact_files",
  {
    artifactId: text("artifact_id").notNull(),
    path: text("path").notNull(),
    oldContent: text("old_content"),
    newContent: text("new_content"),
    patch: text("patch"),
    additions: integer("additions"),
    deletions: integer("deletions"),
    fileStatus: text("file_status").notNull(),
    oldSha256: text("old_sha256"),
    newSha256: text("new_sha256"),
    appliedState: text("applied_state"),
    contentPath: text("content_path"),
    createdAt: integer("created_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.path] })]
);

export const mailboxMessages = sqliteTable("mailbox_messages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  roomId: text("room_id").notNull(),
  fromType: text("from_type"),
  fromId: text("from_id"),
  toAgentId: text("to_agent_id").notNull(),
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  files: text("files").notNull(),
  read: integer("read").notNull(),
  claimedRunId: text("claimed_run_id"),
  claimedAt: integer("claimed_at"),
  deliveryBatchId: text("delivery_batch_id"),
  deliveryFailureReason: text("delivery_failure_reason"),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  consumedAt: integer("consumed_at")
});

export const pendingTurns = sqliteTable(
  "pending_turns",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    userMessageId: text("user_message_id").notNull(),
    primaryAgentId: text("primary_agent_id").notNull(),
    status: text("status").notNull(),
    enqueuedAt: integer("enqueued_at").notNull(),
    scheduledAt: integer("scheduled_at"),
    cancelledAt: integer("cancelled_at"),
    notes: text("notes")
  },
  (table) => [uniqueIndex("pending_turns_user_message_id_unique").on(table.userMessageId)]
);

export const runNextTurns = sqliteTable("run_next_turns", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  roomId: text("room_id").notNull(),
  agentId: text("agent_id").notNull(),
  promptDeltaJson: text("prompt_delta_json").notNull(),
  messageId: text("message_id"),
  pendingTurnId: text("pending_turn_id"),
  sourceReason: text("source_reason"),
  sourceIdempotencyKey: text("source_idempotency_key"),
  createdAt: integer("created_at").notNull(),
  consumedAt: integer("consumed_at")
});

export const mailboxDeliveries = sqliteTable(
  "mailbox_deliveries",
  {
    deliveryBatchId: text("delivery_batch_id").notNull(),
    runId: text("run_id").notNull(),
    mailboxIds: text("mailbox_ids").notNull(),
    nextTurnIds: text("next_turn_ids").notNull(),
    deliveredAt: integer("delivered_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.deliveryBatchId, table.runId] })]
);

export const authTokens = sqliteTable("auth_tokens", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  hash: text("hash").notNull().unique(),
  description: text("description"),
  scopes: text("scopes").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at"),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at")
});

export const sessions = sqliteTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  csrfTokenHash: text("csrf_token_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull()
});

export const outbox = sqliteTable("outbox", {
  eventId: text("event_id").primaryKey(),
  seq: integer("seq").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull(),
  lastError: text("last_error"),
  enqueuedAt: integer("enqueued_at").notNull(),
  dispatchedAt: integer("dispatched_at")
});

export const handlerCursors = sqliteTable("handler_cursors", {
  handlerName: text("handler_name").primaryKey(),
  lastSeq: integer("last_seq").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const deadLetterEvents = sqliteTable("dead_letter_events", {
  id: text("id").primaryKey(),
  handlerName: text("handler_name").notNull(),
  eventId: text("event_id").notNull(),
  eventSeq: integer("event_seq").notNull(),
  attempts: integer("attempts").notNull(),
  lastError: text("last_error").notNull(),
  failedAt: integer("failed_at").notNull(),
  status: text("status").notNull()
});

export const runLocks = sqliteTable(
  "run_locks",
  {
    lockType: text("lock_type").notNull(),
    lockKey: text("lock_key").notNull(),
    workspaceId: text("workspace_id"),
    runId: text("run_id").notNull(),
    acquiredAt: integer("acquired_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.lockType, table.lockKey] })]
);

export const commandRecords = sqliteTable(
  "command_records",
  {
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    commandType: text("command_type").notNull(),
    commandHash: text("command_hash").notNull(),
    status: text("status").notNull(),
    resultJson: text("result_json"),
    traceId: text("trace_id"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.actorType, table.actorId, table.idempotencyKey] })]
);

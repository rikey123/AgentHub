import type { Effect, Stream } from "effect";
import { Schema } from "effect";
import { ContextItemSchema, PermissionResourceSchema } from "./domains.ts";
import { IdSchema, InjectionModeSchema } from "./primitives.ts";

export const AgentRuntimeKindSchema = Schema.Literal("native_sdk", "native", "cli", "server", "mcp", "acp", "a2a", "langgraph");
export type AgentRuntimeKind = typeof AgentRuntimeKindSchema.Type;

export const AgentAdapterManifestSchema = Schema.Struct({
  id: IdSchema,
  name: Schema.String,
  runtimeKind: AgentRuntimeKindSchema,
  provider: Schema.Literal("claude-code", "codex", "opencode", "aion", "langgraph", "a2a", "custom", "mock"),
  capabilities: Schema.Struct({
    canStreamTokens: Schema.Boolean,
    canEmitToolEvents: Schema.Boolean,
    canEmitPermissionEvents: Schema.Boolean,
    canEmitSubagentEvents: Schema.Boolean,
    canInjectAtStart: Schema.Boolean,
    canInjectNextTurn: Schema.Boolean,
    canInjectRuntime: Schema.Boolean,
    canCancel: Schema.Boolean,
    canReadContextSnapshot: Schema.Boolean,
    canRestoreSession: Schema.Boolean,
    supportsMcp: Schema.Boolean,
    supportsHooks: Schema.Boolean,
    supportsWorkspaceIsolation: Schema.Boolean
  }),
  reliability: Schema.Struct({
    level: Schema.Literal("structured", "semi_structured", "scraped", "manual"),
    eventSource: Schema.Literal("native_event_stream", "hooks", "json_stdout", "stdout_scraping", "filesystem_polling"),
    crashRecovery: Schema.Literal("resumable", "restartable", "fail_run"),
    parseFailure: Schema.Literal("skip_event", "degrade_to_text", "fail_run", "ask_user"),
    maxRestartAttempts: Schema.Number
  }),
  context: Schema.Struct({
    startupInjection: Schema.Boolean,
    runtimeInjection: Schema.Boolean,
    injectionMode: InjectionModeSchema,
    canPullExternalContext: Schema.Boolean,
    canPushLedgerUpdates: Schema.Boolean
  }),
  workspace: Schema.Struct({ mode: Schema.Literal("shared", "isolated_copy", "worktree", "external", "shadow_buffer") })
});
export type AgentAdapterManifest = typeof AgentAdapterManifestSchema.Type;

export const DetectedRuntimeSchema = Schema.Struct({
  id: IdSchema,
  name: Schema.String,
  version: Schema.optional(Schema.String),
  executablePath: Schema.optional(Schema.String)
});
export type DetectedRuntime = typeof DetectedRuntimeSchema.Type;

export const AdapterErrorSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
});
export type AdapterError = typeof AdapterErrorSchema.Type;

export const CreateSessionInputSchema = Schema.Struct({
  runId: IdSchema,
  roomId: IdSchema,
  agentId: IdSchema,
  workDir: Schema.optional(Schema.String),
  context: Schema.optional(Schema.Array(ContextItemSchema)),
  mcpServer: Schema.optional(Schema.Unknown)
});
export type CreateSessionInput = typeof CreateSessionInputSchema.Type;

export const AttachSessionInputSchema = Schema.Struct({
  runId: IdSchema,
  adapterSessionId: IdSchema,
  workDir: Schema.optional(Schema.String),
  providerConversationId: Schema.optional(Schema.String)
});
export type AttachSessionInput = typeof AttachSessionInputSchema.Type;

export const ExternalSessionSchema = Schema.Struct({
  id: IdSchema,
  runId: IdSchema,
  workDir: Schema.optional(Schema.String),
  providerConversationId: Schema.optional(Schema.String),
  mcpServer: Schema.optional(Schema.Unknown)
});
export type ExternalSession = typeof ExternalSessionSchema.Type;

export const AdapterMessageSchema = Schema.Struct({
  role: Schema.Literal("user", "assistant", "system", "tool"),
  content: Schema.String
});
export type AdapterMessage = typeof AdapterMessageSchema.Type;

export const AdapterRunInputSchema = Schema.Struct({
  runId: IdSchema,
  sessionId: Schema.optional(IdSchema),
  message: AdapterMessageSchema,
  targetFiles: Schema.optional(Schema.Array(Schema.String))
});
export type AdapterRunInput = typeof AdapterRunInputSchema.Type;

export const ContextProjectionSchema = Schema.Struct({
  items: Schema.Array(ContextItemSchema),
  reason: Schema.optional(Schema.String)
});
export type ContextProjection = typeof ContextProjectionSchema.Type;

export const ContextInjectionResultSchema = Schema.Struct({
  mode: InjectionModeSchema,
  applied: Schema.Boolean,
  effectiveAt: Schema.optional(Schema.Literal("now", "next_turn", "next_session")),
  reason: Schema.optional(Schema.String)
});
export type ContextInjectionResult = typeof ContextInjectionResultSchema.Type;

export const ExternalContextSnapshotSchema = Schema.Struct({
  kind: Schema.String,
  text: Schema.String,
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
});
export type ExternalContextSnapshot = typeof ExternalContextSnapshotSchema.Type;

export const AdapterEventSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal("session.opened"), sessionId: IdSchema }),
  Schema.Struct({ type: Schema.Literal("message.delta"), messageId: IdSchema, delta: Schema.String }),
  Schema.Struct({ type: Schema.Literal("message.completed"), messageId: IdSchema, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("tool.call.requested"), toolCallId: IdSchema, name: Schema.String, input: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("tool.call.completed"), toolCallId: IdSchema, output: Schema.Unknown, ok: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("permission.requested"), permissionId: IdSchema, resource: PermissionResourceSchema, reason: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("subagent.started"), subRunId: IdSchema, profileRef: Schema.String }),
  Schema.Struct({ type: Schema.Literal("subagent.completed"), subRunId: IdSchema }),
  Schema.Struct({ type: Schema.Literal("file.changed"), path: Schema.String, change: Schema.Literal("added", "modified", "deleted") }),
  Schema.Struct({ type: Schema.Literal("context.snapshot"), snapshot: ExternalContextSnapshotSchema }),
  Schema.Struct({ type: Schema.Literal("raw.stdout"), line: Schema.String }),
  Schema.Struct({ type: Schema.Literal("raw.stderr"), line: Schema.String }),
  Schema.Struct({ type: Schema.Literal("session.ended"), sessionId: IdSchema, reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("session.crashed"), sessionId: IdSchema, error: Schema.String })
);
export type AdapterEvent = typeof AdapterEventSchema.Type;

export interface AgentRuntimeAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind: AgentRuntimeKind;
  readonly manifest: AgentAdapterManifest;
  detect(): Effect.Effect<DetectedRuntime[], AdapterError>;
  createSession(input: CreateSessionInput): Effect.Effect<ExternalSession, AdapterError>;
  runAgent(input: AdapterRunInput): Stream.Stream<AdapterEvent, AdapterError>;
  sendMessage(sessionId: string, message: AdapterMessage): Effect.Effect<void, AdapterError>;
  cancelRun(runId: string): Effect.Effect<void, AdapterError>;
  injectContext(sessionId: string, patch: ContextProjection): Effect.Effect<ContextInjectionResult, AdapterError>;
  readSnapshot?(sessionId: string): Effect.Effect<ExternalContextSnapshot, AdapterError>;
  attachSession?(input: AttachSessionInput): Effect.Effect<ExternalSession, AdapterError>;
  dispose(sessionId: string): Effect.Effect<void, AdapterError>;
}

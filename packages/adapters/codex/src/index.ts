import { notImplementedEffect, notImplementedStream } from "@agenthub/adapter-acp-base";
import type { AdapterError, AdapterMessage, AdapterRunInput, AgentAdapterManifest, ContextInjectionResult, ContextProjection, CreateSessionInput, DetectedRuntime, ExternalSession } from "@agenthub/protocol";
import { Effect, Stream } from "effect";

export const codexManifest: AgentAdapterManifest = {
  id: "codex",
  name: "Codex Adapter Stub",
  runtimeKind: "acp",
  provider: "codex",
  capabilities: { canStreamTokens: false, canEmitToolEvents: false, canEmitPermissionEvents: false, canEmitSubagentEvents: false, canInjectAtStart: true, canInjectNextTurn: true, canInjectRuntime: false, canCancel: false, canReadContextSnapshot: false, canRestoreSession: false, supportsMcp: false, supportsHooks: false, supportsWorkspaceIsolation: false },
  reliability: { level: "semi_structured", eventSource: "json_stdout", crashRecovery: "fail_run", parseFailure: "fail_run", maxRestartAttempts: 0 },
  context: { startupInjection: true, runtimeInjection: false, injectionMode: "next_turn", canPullExternalContext: false, canPushLedgerUpdates: false },
  workspace: { mode: "isolated_copy" }
};

export class CodexAdapterStub {
  readonly id = "codex";
  readonly name = "Codex Adapter Stub";
  readonly kind = "acp" as const;
  readonly manifest = codexManifest;
  detect(): Effect.Effect<DetectedRuntime[], AdapterError> { return Effect.succeed([]); }
  createSession(input: CreateSessionInput): Effect.Effect<ExternalSession, AdapterError> { void input; return notImplementedEffect("CodexAdapter", "V1.x (post V1.0)"); }
  runAgent(input: AdapterRunInput): Stream.Stream<never, AdapterError> { void input; return notImplementedStream("CodexAdapter", "V1.x (post V1.0)"); }
  sendMessage(sessionId: string, message: AdapterMessage): Effect.Effect<void, AdapterError> { void sessionId; void message; return notImplementedEffect("CodexAdapter", "V1.x (post V1.0)"); }
  cancelRun(runId: string): Effect.Effect<void, AdapterError> { void runId; return notImplementedEffect("CodexAdapter", "V1.x (post V1.0)"); }
  injectContext(sessionId: string, patch: ContextProjection): Effect.Effect<ContextInjectionResult, AdapterError> { void sessionId; void patch; return notImplementedEffect("CodexAdapter", "V1.x (post V1.0)"); }
  dispose(sessionId: string): Effect.Effect<void, AdapterError> { void sessionId; return notImplementedEffect("CodexAdapter", "V1.x (post V1.0)"); }
}

export function createCodexAdapter(): CodexAdapterStub { return new CodexAdapterStub(); }

import { AdapterNotImplementedError, notImplementedEffect, notImplementedStream } from "@agenthub/adapter-acp-base";
import type { AdapterError, AdapterMessage, AdapterRunInput, AgentAdapterManifest, AttachSessionInput, ContextInjectionResult, ContextProjection, CreateSessionInput, DetectedRuntime, ExternalSession } from "@agenthub/protocol";
import { Effect, Stream } from "effect";

export const opencodeManifest: AgentAdapterManifest = {
  id: "opencode",
  name: "OpenCode Adapter Stub",
  runtimeKind: "server",
  provider: "opencode",
  capabilities: { canStreamTokens: false, canEmitToolEvents: false, canEmitPermissionEvents: false, canEmitSubagentEvents: false, canInjectAtStart: true, canInjectNextTurn: true, canInjectRuntime: false, canCancel: false, canReadContextSnapshot: false, canRestoreSession: false, supportsMcp: false, supportsHooks: false, supportsWorkspaceIsolation: false },
  reliability: { level: "manual", eventSource: "filesystem_polling", crashRecovery: "fail_run", parseFailure: "fail_run", maxRestartAttempts: 0 },
  context: { startupInjection: true, runtimeInjection: false, injectionMode: "next_turn", canPullExternalContext: false, canPushLedgerUpdates: false },
  workspace: { mode: "external" }
};

export class OpenCodeAdapterStub {
  readonly id = "opencode";
  readonly name = "OpenCode Adapter Stub";
  readonly kind = "server" as const;
  readonly manifest = opencodeManifest;
  detect(): Effect.Effect<DetectedRuntime[], AdapterError> { return Effect.succeed([]); }
  createSession(input: CreateSessionInput): Effect.Effect<ExternalSession, AdapterError> { void input; return notImplementedEffect("OpenCodeAdapter", "V0.5"); }
  runAgent(input: AdapterRunInput): Stream.Stream<never, AdapterError> { void input; return notImplementedStream("OpenCodeAdapter", "V0.5"); }
  sendMessage(sessionId: string, message: AdapterMessage): Effect.Effect<void, AdapterError> { void sessionId; void message; return notImplementedEffect("OpenCodeAdapter", "V0.5"); }
  cancelRun(runId: string): Effect.Effect<void, AdapterError> { void runId; return notImplementedEffect("OpenCodeAdapter", "V0.5"); }
  injectContext(sessionId: string, patch: ContextProjection): Effect.Effect<ContextInjectionResult, AdapterError> { void sessionId; void patch; return notImplementedEffect("OpenCodeAdapter", "V0.5"); }
  attachSession(input: AttachSessionInput): Effect.Effect<ExternalSession, AdapterError> { void input; return Effect.fail(new AdapterNotImplementedError("OpenCodeAdapter", "V0.5")); }
  dispose(sessionId: string): Effect.Effect<void, AdapterError> { void sessionId; return notImplementedEffect("OpenCodeAdapter", "V0.5"); }
}

export function createOpenCodeAdapter(): OpenCodeAdapterStub { return new OpenCodeAdapterStub(); }

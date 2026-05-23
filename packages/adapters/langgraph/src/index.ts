import { notImplementedEffect, notImplementedStream } from "@agenthub/adapter-acp-base";
import type { AdapterError, AdapterRunInput, AgentAdapterManifest, CreateSessionInput, DetectedRuntime, ExternalSession } from "@agenthub/protocol";
import { Effect, Stream } from "effect";

export const langGraphManifest: AgentAdapterManifest = {
  id: "langgraph",
  name: "LangGraph Adapter Stub",
  runtimeKind: "langgraph",
  provider: "langgraph",
  capabilities: { canStreamTokens: false, canEmitToolEvents: false, canEmitPermissionEvents: false, canEmitSubagentEvents: false, canInjectAtStart: false, canInjectNextTurn: false, canInjectRuntime: false, canCancel: false, canReadContextSnapshot: false, canRestoreSession: false, supportsMcp: false, supportsHooks: false, supportsWorkspaceIsolation: false },
  reliability: { level: "manual", eventSource: "filesystem_polling", crashRecovery: "fail_run", parseFailure: "fail_run", maxRestartAttempts: 0 },
  context: { startupInjection: false, runtimeInjection: false, injectionMode: "next_session", canPullExternalContext: false, canPushLedgerUpdates: false },
  workspace: { mode: "external" }
};

export class LangGraphAdapterStub {
  readonly id = "langgraph";
  readonly name = "LangGraph Adapter Stub";
  readonly kind = "langgraph" as const;
  readonly manifest = langGraphManifest;
  detect(): Effect.Effect<DetectedRuntime[], AdapterError> { return Effect.succeed([]); }
  createSession(input: CreateSessionInput): Effect.Effect<ExternalSession, AdapterError> { void input; return notImplementedEffect("LangGraphAdapter", "V1.3; depends on plugin-system isolation infrastructure"); }
  runAgent(input: AdapterRunInput): Stream.Stream<never, AdapterError> { void input; return notImplementedStream("LangGraphAdapter", "V1.3; depends on plugin-system isolation infrastructure"); }
}

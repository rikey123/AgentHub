import { notImplementedEffect, notImplementedStream } from "@agenthub/adapter-acp-base";
import type { AdapterError, AdapterRunInput, AgentAdapterManifest, CreateSessionInput, DetectedRuntime, ExternalSession } from "@agenthub/protocol";
import { Effect, Stream } from "effect";

export const a2aManifest: AgentAdapterManifest = {
  id: "a2a",
  name: "A2A Adapter Stub",
  runtimeKind: "a2a",
  provider: "a2a",
  capabilities: { canStreamTokens: false, canEmitToolEvents: false, canEmitPermissionEvents: false, canEmitSubagentEvents: false, canInjectAtStart: false, canInjectNextTurn: false, canInjectRuntime: false, canCancel: false, canReadContextSnapshot: false, canRestoreSession: false, supportsMcp: false, supportsHooks: false, supportsWorkspaceIsolation: false },
  reliability: { level: "manual", eventSource: "filesystem_polling", crashRecovery: "fail_run", parseFailure: "fail_run", maxRestartAttempts: 0 },
  context: { startupInjection: false, runtimeInjection: false, injectionMode: "next_session", canPullExternalContext: false, canPushLedgerUpdates: false },
  workspace: { mode: "external" }
};

export class A2AAdapterStub {
  readonly id = "a2a";
  readonly name = "A2A Adapter Stub";
  readonly kind = "a2a" as const;
  readonly manifest = a2aManifest;
  detect(): Effect.Effect<DetectedRuntime[], AdapterError> { return Effect.succeed([]); }
  createSession(input: CreateSessionInput): Effect.Effect<ExternalSession, AdapterError> { void input; return notImplementedEffect("A2AAdapter", "V1.3; depends on plugin-system isolation infrastructure"); }
  runAgent(input: AdapterRunInput): Stream.Stream<never, AdapterError> { void input; return notImplementedStream("A2AAdapter", "V1.3; depends on plugin-system isolation infrastructure"); }
}

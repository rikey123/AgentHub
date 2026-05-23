import { randomUUID } from "node:crypto";

import { ACPAdapter, ACPAdapterError, AdapterHealthRegistry, AdapterRawLogger, classifyClaudeDetection, emitAdapterRegistered, permissionForTool, type AcpAdapterSession, type AcpProviderEvent, type AdapterRuntimeServices, type JsonRpcMessage } from "@agenthub/adapter-acp-base";
import { AdapterBridge, type AdapterArtifactFSBoundary, type RoomMcpServer, type RunLifecycleService, type RunRow } from "@agenthub/orchestrator";
import type { PermissionEngine } from "@agenthub/permissions";
import type { AdapterError, AgentAdapterManifest, DetectedRuntime } from "@agenthub/protocol";
import { Effect } from "effect";

export const claudeCodeManifest: AgentAdapterManifest = {
  id: "claude-code",
  name: "Claude Code Adapter",
  runtimeKind: "acp",
  provider: "claude-code",
  capabilities: { canStreamTokens: true, canEmitToolEvents: true, canEmitPermissionEvents: true, canEmitSubagentEvents: true, canInjectAtStart: true, canInjectNextTurn: true, canInjectRuntime: true, canCancel: true, canReadContextSnapshot: true, canRestoreSession: true, supportsMcp: true, supportsHooks: true, supportsWorkspaceIsolation: true },
  reliability: { level: "structured", eventSource: "native_event_stream", crashRecovery: "resumable", parseFailure: "fail_run", maxRestartAttempts: 3 },
  context: { startupInjection: true, runtimeInjection: true, injectionMode: "immediate", canPullExternalContext: true, canPushLedgerUpdates: true },
  workspace: { mode: "worktree" }
};

export type ClaudeCodeAdapterOptions = {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly services?: AdapterRuntimeServices;
  readonly workspaceId?: string;
  readonly lifecycle?: RunLifecycleService;
  readonly artifactFs?: AdapterArtifactFSBoundary;
  readonly mcpServer?: RoomMcpServer;
  readonly permissionEngine?: PermissionEngine;
  readonly now?: () => number;
};

export class ClaudeCodeACPAdapter extends ACPAdapter {
  private readonly command: string;
  private readonly args: readonly string[];
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly bridgeByRun = new Map<string, AdapterBridge>();
  private readonly permissionEngine: PermissionEngine | undefined;
  private readonly health: AdapterHealthRegistry | undefined;

  constructor(private readonly options: ClaudeCodeAdapterOptions = {}) {
    const logger = options.services !== undefined && options.workspaceId !== undefined ? new AdapterRawLogger(options.services.eventBus, { workspaceId: options.workspaceId, ...(options.now !== undefined ? { now: options.now } : {}) }) : undefined;
    const rawLogger = logger?.write.bind(logger);
    super("claude-code", "Claude Code Adapter", claudeCodeManifest, { ...(options.now !== undefined ? { now: options.now } : {}), ...(rawLogger !== undefined ? { rawSink: rawLogger } : {}) });
    this.command = options.command ?? "claude";
    this.args = options.args ?? ["--acp"];
    this.env = options.env;
    this.permissionEngine = options.permissionEngine ?? options.services?.permissionEngine;
    this.health = options.services !== undefined ? new AdapterHealthRegistry(options.services.eventBus, { ...(options.now !== undefined ? { now: options.now } : {}) }) : undefined;
  }

  detect(): Effect.Effect<DetectedRuntime[], AdapterError> {
    return Effect.try({
      try: () => {
        const result = classifyClaudeDetection(this.command);
        if (!result.ok) throw new ACPAdapterError(result.code, result.message);
        return result.runtimes;
      },
      catch: (error) => error instanceof ACPAdapterError ? error : new ACPAdapterError("spawn_failed", error instanceof Error ? error.message : String(error), error)
    });
  }

  async runManaged(run: RunRow): Promise<void> {
    if (this.options.services === undefined || this.options.lifecycle === undefined) throw new ACPAdapterError("configuration", "Claude managed run requires services and lifecycle");
    const workDir = run.work_dir ?? process.cwd();
    this.health?.update({ adapterId: this.id, workspaceId: run.workspace_id, liveness: "starting", pendingRunIds: [run.id] });
    emitAdapterRegistered(this.options.services.eventBus, run.workspace_id, claudeCodeManifest, this.options.now?.() ?? Date.now());
    const artifactFs = this.options.artifactFs ?? this.options.services.artifactFs;
    const bridge = new AdapterBridge({ runId: run.id, workspaceId: run.workspace_id, roomId: run.room_id, agentId: run.agent_id, lifecycle: this.options.lifecycle, eventBus: this.options.services.eventBus, ...(this.options.now !== undefined ? { now: this.options.now } : {}), ...(run.task_id !== null ? { taskId: run.task_id } : {}), messageId: `msg_${run.id}`, ...(run.workspace_mode !== null ? { workspaceMode: run.workspace_mode } : {}), terminalEnabled: false, ...(artifactFs !== undefined ? { artifactFs } : {}) });
    this.bridgeByRun.set(run.id, bridge);
    const session = Effect.runSync(this.createSession({ runId: run.id, roomId: run.room_id, agentId: run.agent_id, workDir, ...(this.options.mcpServer !== undefined ? { mcpServer: this.options.mcpServer } : {}) }));
    bridge.handle({ type: "session.opened", sessionId: session.id, workDir, ...(session.providerConversationId !== undefined ? { providerConversationId: session.providerConversationId } : {}) });
    this.health?.update({ adapterId: this.id, workspaceId: run.workspace_id, liveness: "busy", pendingRunIds: [run.id] });
    this.sendPrompt(session.id, { role: "user", content: promptFromRun(run) });
  }

  async cancelManagedRun(runId: string): Promise<void> {
    await Effect.runPromise(this.cancelRun(runId));
  }

  override attachSession(input: Parameters<ACPAdapter["attachSession"]>[0]) {
    const attached = super.attachSession(input);
    return attached;
  }

  feedProviderLineForTest(sessionId: string, line: string): AcpProviderEvent | undefined {
    const session = this.debugSession(sessionId);
    if (session === undefined) throw new ACPAdapterError("session_not_found", `ACP session '${sessionId}' not found`);
    return this.handleLine(session, line);
  }

  protected spawnArgs() { return { command: this.command, args: this.args, ...(this.env !== undefined ? { env: this.env } : {}) }; }

  protected mapProviderEvent(message: JsonRpcMessage): AcpProviderEvent | undefined {
    if (message.method === undefined) return undefined;
    return { type: message.method, payload: message.params };
  }

  protected mapProviderError(error: unknown): AdapterError {
    return new ACPAdapterError("provider_error", typeof error === "string" ? error : JSON.stringify(error), error);
  }

  protected override onProviderEvent(session: AcpAdapterSession, event: AcpProviderEvent): void {
    if (session.runId === undefined) return;
    this.mapToBridgeEvent(session.runId, event);
  }

  mapToBridgeEvent(runId: string, event: AcpProviderEvent): void {
    const bridge = this.bridgeByRun.get(runId);
    if (bridge === undefined) return;
    const payload = isRecord(event.payload) ? event.payload : {};
    if (event.type === "assistant/message_delta" && typeof payload.delta === "string") return;
    if (event.type === "assistant/message_complete") return;
    if (event.type === "tool/pre_use") {
      const toolCallId = stringField(payload, "toolCallId") ?? randomUUID();
      const name = stringField(payload, "name") ?? "unknown";
      bridge.handle({ type: "tool.call.requested", toolCallId, name, input: payload.input ?? {} });
      const decision = this.permissionEngine?.check({ workspaceId: stringField(payload, "workspaceId") ?? "default-workspace", runId, resource: permissionForTool(name, payload.input), reason: `claude tool ${name}` });
      if (decision?.status === "deny") throw new ACPAdapterError("permission_denied", decision.reason);
      return;
    }
    if (event.type === "tool/post_use") bridge.handle({ type: "tool.call.completed", toolCallId: stringField(payload, "toolCallId") ?? randomUUID(), output: payload.output ?? {}, ok: payload.ok !== false });
    if (event.type === "fs/write") bridge.handle({ type: "fs.writeTextFile", path: requiredString(payload, "path"), content: stringField(payload, "content") ?? "" });
    if (event.type === "fs/delete") bridge.handle({ type: "fs.deleteFile", path: requiredString(payload, "path") });
    if (event.type === "session/end") bridge.handle({ type: "session.ended", sessionId: stringField(payload, "sessionId") ?? `claude-${runId}`, reason: stringField(payload, "reason") ?? "completed", cost: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId: stringField(payload, "modelId") ?? "claude" } });
  }
}

export function createClaudeCodeAdapter(options: ClaudeCodeAdapterOptions = {}): ClaudeCodeACPAdapter {
  return new ClaudeCodeACPAdapter(options);
}

function promptFromRun(run: RunRow): string {
  return `Run ${run.id} for agent ${run.agent_id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringField(value: Record<string, unknown>, key: string): string | undefined { const field = value[key]; return typeof field === "string" ? field : undefined; }
function requiredString(value: Record<string, unknown>, key: string): string { const field = stringField(value, key); if (field === undefined) throw new ACPAdapterError("invalid_provider_event", `${key} is required`); return field; }

import { randomUUID } from "node:crypto";

import { ACPAdapter, ACPAdapterError, AdapterHealthRegistry, AdapterRawLogger, emitAdapterRegistered, type AcpAdapterSession, type AcpProviderEvent, type AdapterRuntimeServices, type JsonRpcMessage } from "@agenthub/adapter-acp-base";
import type { PublishInput } from "@agenthub/bus";
import { AdapterBridge, buildRunPrompt, persistAssistantPublicMessage, prepareAdapterRunWorkspace, runWithPreparedWorkDir, type AdapterArtifactFSBoundary, type RoomMcpServer, type RunLifecycleService, type RunRow } from "@agenthub/orchestrator";
import type { AdapterError, AgentAdapterManifest, DetectedRuntime } from "@agenthub/protocol";
import { Effect } from "effect";

export type GenericAcpAdapterConfig = {
  readonly id: string;
  readonly runtimeKind: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
};

export type GenericAcpAdapterOptions = GenericAcpAdapterConfig & {
  readonly services?: AdapterRuntimeServices;
  readonly workspaceId?: string;
  readonly lifecycle?: RunLifecycleService;
  readonly artifactFs?: AdapterArtifactFSBoundary;
  readonly mcpServer?: RoomMcpServer;
  readonly onWarmSessionFailed?: (input: { readonly roomId: string; readonly agentId: string; readonly adapterSessionId: string }) => void;
  readonly onSessionEndedWithoutCompletion?: (taskId: string) => void | Promise<void>;
  readonly onPlanPhaseEnded?: (runId: string) => void | Promise<void>;
  readonly getSkillsBlock?: (runId: string) => string | undefined;
  readonly now?: () => number;
};

export class GenericACPAdapter extends ACPAdapter {
  private readonly bridgeByRun = new Map<string, AdapterBridge>();
  private readonly runById = new Map<string, RunRow>();
  private readonly workspaceByRun = new Map<string, string>();
  private readonly assistantTextByRun = new Map<string, string>();
  private readonly openedRuns = new Set<string>();
  private readonly pendingFailuresByRun = new Map<string, ACPAdapterError>();
  private readonly health: AdapterHealthRegistry | undefined;

  constructor(private readonly options: GenericAcpAdapterOptions) {
    const manifest = genericManifest(options);
    const logger = options.services !== undefined && options.workspaceId !== undefined ? new AdapterRawLogger(options.services.eventBus, { workspaceId: options.workspaceId, ...(options.now !== undefined ? { now: options.now } : {}) }) : undefined;
    const rawLogger = logger?.write.bind(logger);
    super(options.id, options.name, manifest, { ...(options.now !== undefined ? { now: options.now } : {}), ...(rawLogger !== undefined ? { rawSink: rawLogger } : {}) });
    this.health = options.services !== undefined ? new AdapterHealthRegistry(options.services.eventBus, { ...(options.now !== undefined ? { now: options.now } : {}) }) : undefined;
  }

  detect(): Effect.Effect<DetectedRuntime[], AdapterError> {
    return Effect.succeed([{ id: this.options.runtimeKind, name: this.options.name, executablePath: this.options.command }]);
  }

  async runManaged(run: RunRow): Promise<void> {
    if (this.options.services === undefined || this.options.lifecycle === undefined) throw new ACPAdapterError("configuration", `${this.options.name} managed run requires services and lifecycle`);
    this.health?.update({ adapterId: this.id, workspaceId: run.workspace_id, liveness: "starting", pendingRunIds: [run.id] });
    emitAdapterRegistered(this.options.services.eventBus, run.workspace_id, this.manifest, this.options.now?.() ?? Date.now());
    const artifactFs = this.options.artifactFs ?? this.options.services.artifactFs;
    const messageId = `msg_${run.id}`;
    const workDir = prepareAdapterRunWorkspace({ run, ...(artifactFs !== undefined ? { artifactFs } : {}), terminalEnabled: false, messageId });
    const getCommandBus = this.options.services.getCommandBus;
    const bridge = new AdapterBridge({ runId: run.id, workspaceId: run.workspace_id, roomId: run.room_id, agentId: run.agent_id, lifecycle: this.options.lifecycle, eventBus: this.options.services.eventBus, database: this.options.services.database, ...(getCommandBus !== undefined ? { getCommandBus } : {}), ...(this.options.services.briefResolver !== undefined ? { briefResolver: this.options.services.briefResolver } : {}), ...(this.options.now !== undefined ? { now: this.options.now } : {}), ...(run.wake_reason !== null ? { wakeReason: run.wake_reason } : {}), ...(this.options.onSessionEndedWithoutCompletion !== undefined ? { onSessionEndedWithoutCompletion: this.options.onSessionEndedWithoutCompletion } : {}), ...(this.options.onPlanPhaseEnded !== undefined ? { onPlanPhaseEnded: this.options.onPlanPhaseEnded } : {}), ...(run.task_id !== null ? { taskId: run.task_id } : {}), messageId, ...(run.workspace_mode !== null ? { workspaceMode: run.workspace_mode } : {}), terminalEnabled: false, ...(artifactFs !== undefined ? { artifactFs } : {}) });
    this.bridgeByRun.set(run.id, bridge);
    this.runById.set(run.id, runWithPreparedWorkDir(run, workDir));
    this.workspaceByRun.set(run.id, run.workspace_id);
    let session = this.bindWarmSessionToRun({ roomId: run.room_id, agentId: run.agent_id, runId: run.id, workDir });
    if (session === undefined) {
      const sessionId = `acp-${this.id}-${run.id}`;
      const mcpServer = this.options.mcpServer?.getRegisteredStdioConfig({ roomId: run.room_id, runId: run.id, agentId: run.agent_id, adapterSessionId: sessionId });
      session = Effect.runSync(this.createSession({ runId: run.id, roomId: run.room_id, agentId: run.agent_id, workDir, ...(mcpServer !== undefined ? { mcpServer } : {}) }));
    }
    const sessionWorkDir = session.workDir ?? workDir;
    const promptRun = runWithPreparedWorkDir(run, sessionWorkDir);
    this.runById.set(run.id, promptRun);
    const acpSession = this.debugSession(session.id);
    if (acpSession === undefined) throw new ACPAdapterError("session_not_found", `ACP session '${session.id}' not found`);
    bridge.handle({ type: "session.opened", sessionId: session.id, workDir: sessionWorkDir, ...(session.providerConversationId !== undefined ? { providerConversationId: session.providerConversationId } : {}) });
    this.openedRuns.add(run.id);
    this.drainPendingFailure(run.id, acpSession);
    if (acpSession.state === "failed") return;
    this.health?.update({ adapterId: this.id, workspaceId: run.workspace_id, liveness: "busy", pendingRunIds: [run.id] });
    this.sendPrompt(session.id, { role: "user", content: this.promptFromRun(promptRun) });
  }

  warmRoomAgent(input: { readonly roomId: string; readonly agentId: string; readonly workDir?: string }): string {
    const adapterSessionId = `acp-${this.id}-warm-${input.roomId}-${input.agentId}`;
    const mcpServer = this.options.mcpServer?.getRegisteredStdioConfig({ roomId: input.roomId, agentId: input.agentId, adapterSessionId });
    return this.createWarmSession({ roomId: input.roomId, agentId: input.agentId, sessionId: adapterSessionId, ...(input.workDir !== undefined ? { workDir: input.workDir } : {}), ...(mcpServer !== undefined ? { mcpServer } : {}) }).id;
  }

  async cancelManagedRun(runId: string): Promise<void> {
    await Effect.runPromise(this.cancelRun(runId));
  }

  protected spawnArgs() {
    return { command: this.options.command, args: this.options.args, ...(this.options.env !== undefined ? { env: this.options.env } : {}) };
  }

  protected mapProviderEvent(message: JsonRpcMessage): AcpProviderEvent | undefined {
    if (message.method === undefined) return undefined;
    if (message.method.startsWith("turn/")) {
      const record = message as unknown as Record<string, unknown>;
      const payload: Record<string, unknown> = isRecord(message.params) ? { ...message.params } : {};
      const usage = isRecord(record.usage) ? record.usage : undefined;
      if (usage !== undefined) payload.usage = usage;
      return { type: message.method, payload };
    }
    return { type: message.method, payload: message.params };
  }

  protected mapProviderError(error: unknown): AdapterError {
    return new ACPAdapterError("provider_error", error instanceof Error ? error.message : String(error), error);
  }

  protected override onProviderEvent(session: AcpAdapterSession, event: AcpProviderEvent): void {
    if (session.runId === undefined) return;
    this.mapToBridgeEvent(session.runId, event);
  }

  protected override onSessionFailed(session: AcpAdapterSession, error: ACPAdapterError): void {
    if (session.runId === undefined) {
      this.options.onWarmSessionFailed?.({ roomId: session.roomId, agentId: session.agentId, adapterSessionId: session.acpSessionId });
      return;
    }
    if (!this.openedRuns.has(session.runId)) {
      this.pendingFailuresByRun.set(session.runId, error);
      return;
    }
    this.bridgeSessionCrashed(session, error);
  }

  private mapToBridgeEvent(runId: string, event: AcpProviderEvent): void {
    const bridge = this.bridgeByRun.get(runId);
    if (bridge === undefined) return;
    const payload = isRecord(event.payload) ? event.payload : {};
    if (event.type === "message/delta") {
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      if (delta.length === 0) return;
      const messageId = `msg_${runId}`;
      const accumulated = (this.assistantTextByRun.get(runId) ?? "") + delta;
      if (!this.assistantTextByRun.has(runId)) this.persistAssistantMessageStart(runId, messageId);
      this.assistantTextByRun.set(runId, accumulated);
      this.publishRunEvent(runId, "message.part.delta", { messageId, text: delta });
      bridge.onMessageDelta();
      return;
    }
    if (event.type === "tool/pre_use") bridge.handle({ type: "tool.call.requested", toolCallId: stringField(payload, "toolCallId") ?? randomUUID(), name: stringField(payload, "name") ?? stringField(payload, "title") ?? "unknown", input: payload.input ?? payload.rawInput ?? {} });
    if (event.type === "tool/post_use") bridge.handle({ type: "tool.call.completed", toolCallId: stringField(payload, "toolCallId") ?? randomUUID(), output: payload.output ?? payload.rawOutput ?? {}, ok: payload.ok !== false });
    if (event.type === "context.snapshot") bridge.handle({ type: "context.snapshot", snapshot: payload.snapshot ?? payload });
    if (event.type === "session/end" || event.type === "turn/completed" || event.type === "turn/cancelled") {
      this.completeAssistantMessage(runId);
      bridge.handle({
        type: "session.ended",
        sessionId: stringField(payload, "sessionId") ?? stringField(payload, "session_id") ?? `${this.id}-${runId}`,
        reason: event.type === "turn/cancelled" ? "cancelled" : stringField(payload, "reason") ?? "completed",
        cost: costFromPayload(payload, stringField(payload, "modelId") ?? this.options.runtimeKind)
      });
      return;
    }
    if (event.type === "turn/failed") {
      this.completeAssistantMessage(runId);
      const error = stringField(payload, "error") ?? stringField(payload, "reason") ?? stringField(payload, "message") ?? "Codex turn failed";
      bridge.handle({ type: "session.crashed", sessionId: stringField(payload, "sessionId") ?? stringField(payload, "session_id") ?? `${this.id}-${runId}`, error });
      this.health?.update({ adapterId: this.id, workspaceId: this.workspaceByRun.get(runId) ?? "default-workspace", liveness: "crashed", pendingRunIds: [runId], reason: error });
    }
  }

  private completeAssistantMessage(runId: string): void {
    const messageId = `msg_${runId}`;
    const text = this.assistantTextByRun.get(runId) ?? "";
    if (!this.assistantTextByRun.has(runId)) return;
    this.persistAssistantMessageEnd(runId, messageId, text);
    this.assistantTextByRun.delete(runId);
  }

  private drainPendingFailure(runId: string, session: AcpAdapterSession): void {
    const error = this.pendingFailuresByRun.get(runId);
    if (error === undefined) return;
    this.pendingFailuresByRun.delete(runId);
    this.bridgeSessionCrashed(session, error);
  }

  private bridgeSessionCrashed(session: AcpAdapterSession, error: ACPAdapterError): void {
    if (session.runId === undefined) return;
    const bridge = this.bridgeByRun.get(session.runId);
    if (bridge === undefined) return;
    bridge.handle({ type: "session.crashed", sessionId: session.acpSessionId, error: error.message });
    this.health?.update({ adapterId: this.id, workspaceId: this.workspaceByRun.get(session.runId) ?? "default-workspace", liveness: "crashed", pendingRunIds: [session.runId], reason: error.message });
  }

  private persistAssistantMessageStart(runId: string, messageId: string): void {
    const run = this.runById.get(runId);
    const db = this.options.services?.database;
    if (run === undefined || db === undefined) return;
    const now = this.options.now?.() ?? Date.now();
    db.sqlite.prepare(
      `INSERT OR IGNORE INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'agent', ?, ?, 'assistant', 'streaming', NULL, 'immediate', NULL, ?, ?, NULL)`
    ).run(messageId, run.workspace_id, run.room_id, run.agent_id, runId, now, now);
    this.publishRunEvent(runId, "message.created", { messageId, role: "assistant", senderId: run.agent_id, runId });
  }

  private persistAssistantMessageEnd(runId: string, messageId: string, text: string): void {
    const db = this.options.services?.database;
    const eventBus = this.options.services?.eventBus;
    const run = this.runById.get(runId);
    if (db === undefined || eventBus === undefined || run === undefined) return;
    persistAssistantPublicMessage({
      database: db,
      eventBus,
      run,
      messageId,
      text,
      ...(this.options.services?.fileMessageService !== undefined ? { fileMessageService: this.options.services.fileMessageService } : {}),
      ...(this.options.now !== undefined ? { now: this.options.now } : {})
    });
  }

  private publishRunEvent(runId: string, type: PublishInput["type"], payload: Record<string, unknown>): void {
    const run = this.runById.get(runId);
    const eventBus = this.options.services?.eventBus;
    if (run === undefined || eventBus === undefined) return;
    eventBus.publish({ id: randomUUID(), type, schemaVersion: 1, workspaceId: run.workspace_id, roomId: run.room_id, ...(run.task_id !== null ? { taskId: run.task_id } : {}), runId, agentId: run.agent_id, payload, createdAt: this.options.now?.() ?? Date.now() } satisfies PublishInput);
  }

  private promptFromRun(run: RunRow): string {
    const db = this.options.services?.database;
    if (db === undefined) return `Run ${run.id} for agent ${run.agent_id}`;
    const skillsBlock = this.options.getSkillsBlock?.(run.id);
    return buildRunPrompt(run, db, { ...(this.options.now !== undefined ? { now: this.options.now } : {}), ...(skillsBlock !== undefined ? { skillsBlock } : {}) });
  }
}

function genericManifest(options: GenericAcpAdapterConfig): AgentAdapterManifest {
  return {
    id: options.id,
    name: options.name,
    runtimeKind: "acp",
    provider: genericProvider(options.runtimeKind),
    capabilities: { canStreamTokens: true, canEmitToolEvents: true, canEmitPermissionEvents: true, canEmitSubagentEvents: false, canInjectAtStart: true, canInjectNextTurn: true, canInjectRuntime: true, canCancel: true, canReadContextSnapshot: true, canRestoreSession: false, supportsMcp: true, supportsHooks: false, supportsWorkspaceIsolation: true },
    reliability: { level: "structured", eventSource: "native_event_stream", crashRecovery: "fail_run", parseFailure: "skip_event", maxRestartAttempts: 1 },
    context: { startupInjection: true, runtimeInjection: true, injectionMode: "immediate", canPullExternalContext: true, canPushLedgerUpdates: true },
    workspace: { mode: "worktree" }
  };
}

function genericProvider(runtimeKind: string): AgentAdapterManifest["provider"] {
  if (runtimeKind === "codex") return "codex";
  if (runtimeKind === "opencode") return "opencode";
  if (runtimeKind === "claude-code") return "claude-code";
  return "custom";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function costFromPayload(payload: Record<string, unknown>, modelId: string) {
  const cost = isRecord(payload.cost) ? payload.cost : undefined;
  if (cost !== undefined) {
    return {
      inputTokens: numberField(cost, "inputTokens"),
      outputTokens: numberField(cost, "outputTokens"),
      cachedTokens: numberField(cost, "cachedTokens"),
      costUsd: numberField(cost, "costUsd"),
      modelId: stringField(cost, "modelId") ?? modelId
    };
  }
  const usage = isRecord(payload.usage) ? payload.usage : undefined;
  return {
    inputTokens: usage !== undefined ? numberField(usage, "inputTokens") : 0,
    outputTokens: usage !== undefined ? numberField(usage, "outputTokens") : 0,
    cachedTokens: usage !== undefined ? numberField(usage, "cachedTokens") + numberField(usage, "cachedReadTokens") + numberField(usage, "cachedWriteTokens") : 0,
    costUsd: 0,
    modelId
  };
}

function numberField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : 0;
}

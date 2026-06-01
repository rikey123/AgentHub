import { randomUUID } from "node:crypto";

import { ACPAdapter, ACPAdapterError, AdapterHealthRegistry, AdapterRawLogger, classifyClaudeDetection, emitAdapterRegistered, permissionForTool, type AcpAdapterSession, type AcpProviderEvent, type AdapterRuntimeServices, type JsonRpcMessage } from "@agenthub/adapter-acp-base";
import type { PublishInput } from "@agenthub/bus";
import { AdapterBridge, buildRunPrompt, type AdapterArtifactFSBoundary, type RoomMcpServer, type RunLifecycleService, type RunRow } from "@agenthub/orchestrator";
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
  readonly onWarmSessionFailed?: (input: { readonly roomId: string; readonly agentId: string; readonly adapterSessionId: string }) => void;
  readonly onSessionEndedWithoutCompletion?: (taskId: string) => void | Promise<void>;
  readonly onPlanPhaseEnded?: (runId: string) => void | Promise<void>;
  readonly now?: () => number;
};

export class ClaudeCodeACPAdapter extends ACPAdapter {
  private readonly command: string;
  private readonly args: readonly string[];
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly bridgeByRun = new Map<string, AdapterBridge>();
  private readonly runById = new Map<string, RunRow>();
  private readonly workspaceByRun = new Map<string, string>();
  private readonly assistantTextByRun = new Map<string, string>();
  private readonly openedRuns = new Set<string>();
  private readonly pendingFailuresByRun = new Map<string, ACPAdapterError>();
  private readonly permissionEngine: PermissionEngine | undefined;
  private readonly health: AdapterHealthRegistry | undefined;

  constructor(private readonly options: ClaudeCodeAdapterOptions = {}) {
    const logger = options.services !== undefined && options.workspaceId !== undefined ? new AdapterRawLogger(options.services.eventBus, { workspaceId: options.workspaceId, ...(options.now !== undefined ? { now: options.now } : {}) }) : undefined;
    const rawLogger = logger?.write.bind(logger);
    super("claude-code", "Claude Code Adapter", claudeCodeManifest, { ...(options.now !== undefined ? { now: options.now } : {}), ...(rawLogger !== undefined ? { rawSink: rawLogger } : {}) });
    // Anthropic's `claude` CLI no longer ships an ACP server (--acp / --experimental-acp removed
    // around v2.1). The community ACP bridge `@agentclientprotocol/claude-agent-acp` provides one.
    // We launch it via `npx -y` so users only need npx + the claude CLI on PATH (the bridge calls
    // `claude` itself for the actual conversation).
    this.command = options.command ?? "npx";
    this.args = options.args ?? ["-y", "@agentclientprotocol/claude-agent-acp@0.29.2"];
    this.env = options.env;
    this.permissionEngine = options.permissionEngine ?? options.services?.permissionEngine;
    this.health = options.services !== undefined ? new AdapterHealthRegistry(options.services.eventBus, { ...(options.now !== undefined ? { now: options.now } : {}) }) : undefined;
  }

  detect(): Effect.Effect<DetectedRuntime[], AdapterError> {
    return Effect.try({
      try: () => {
        // The bridge calls `claude` under the hood, but tests construct the adapter with a
        // custom command to verify the not-found path. Honor the custom command if provided
        // (anything other than the default npx invocation), otherwise probe `claude`.
        const probeCmd = this.options.command !== undefined && this.options.command !== "npx" ? this.options.command : "claude";
        const result = classifyClaudeDetection(probeCmd);
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
    const getCommandBus = this.options.services.getCommandBus;
    const bridge = new AdapterBridge({ runId: run.id, workspaceId: run.workspace_id, roomId: run.room_id, agentId: run.agent_id, lifecycle: this.options.lifecycle, eventBus: this.options.services.eventBus, database: this.options.services.database, ...(getCommandBus !== undefined ? { getCommandBus } : {}), ...(this.options.services.briefResolver !== undefined ? { briefResolver: this.options.services.briefResolver } : {}), ...(this.options.now !== undefined ? { now: this.options.now } : {}), ...(run.wake_reason !== null ? { wakeReason: run.wake_reason } : {}), ...(this.options.onSessionEndedWithoutCompletion !== undefined ? { onSessionEndedWithoutCompletion: this.options.onSessionEndedWithoutCompletion } : {}), ...(this.options.onPlanPhaseEnded !== undefined ? { onPlanPhaseEnded: this.options.onPlanPhaseEnded } : {}), ...(run.task_id !== null ? { taskId: run.task_id } : {}), messageId: `msg_${run.id}`, ...(run.workspace_mode !== null ? { workspaceMode: run.workspace_mode } : {}), terminalEnabled: false, ...(artifactFs !== undefined ? { artifactFs } : {}) });
    this.bridgeByRun.set(run.id, bridge);
    this.runById.set(run.id, run);
    this.workspaceByRun.set(run.id, run.workspace_id);
    let session = this.bindWarmSessionToRun({ roomId: run.room_id, agentId: run.agent_id, runId: run.id });
    if (session === undefined) {
      const sessionId = `acp-${this.id}-${run.id}`;
      const mcpServer = this.options.mcpServer?.getRegisteredStdioConfig({ roomId: run.room_id, runId: run.id, agentId: run.agent_id, adapterSessionId: sessionId });
      session = Effect.runSync(this.createSession({ runId: run.id, roomId: run.room_id, agentId: run.agent_id, workDir, ...(mcpServer !== undefined ? { mcpServer } : {}) }));
    }
    const acpSession = this.debugSession(session.id);
    if (acpSession === undefined) throw new ACPAdapterError("session_not_found", `ACP session '${session.id}' not found`);
    bridge.handle({ type: "session.opened", sessionId: session.id, workDir, ...(session.providerConversationId !== undefined ? { providerConversationId: session.providerConversationId } : {}) });
    this.openedRuns.add(run.id);
    this.drainPendingFailure(run.id, acpSession);
    if (acpSession.state === "failed") return;
    this.health?.update({ adapterId: this.id, workspaceId: run.workspace_id, liveness: "busy", pendingRunIds: [run.id] });
    this.sendPrompt(session.id, { role: "user", content: this.promptFromRun(run) });
  }

  warmRoomAgent(input: { readonly roomId: string; readonly agentId: string; readonly workDir?: string }): string {
    const adapterSessionId = `acp-${this.id}-warm-${input.roomId}-${input.agentId}`;
    const mcpServer = this.options.mcpServer?.getRegisteredStdioConfig({ roomId: input.roomId, agentId: input.agentId, adapterSessionId });
    return this.createWarmSession({ roomId: input.roomId, agentId: input.agentId, sessionId: adapterSessionId, ...(input.workDir !== undefined ? { workDir: input.workDir } : {}), ...(mcpServer !== undefined ? { mcpServer } : {}) }).id;
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

  mapToBridgeEvent(runId: string, event: AcpProviderEvent): void {
    const bridge = this.bridgeByRun.get(runId);
    if (bridge === undefined) return;
    const payload = isRecord(event.payload) ? event.payload : {};
    // Stream agent message text from ACP v1 `session/update.agent_message_chunk` (translated by acp-base).
    if (event.type === "message/delta") {
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      if (delta.length === 0) return;
      const messageId = `msg_${runId}`;
      const accumulated = (this.assistantTextByRun.get(runId) ?? "") + delta;
      if (!this.assistantTextByRun.has(runId)) {
        this.persistAssistantMessageStart(runId, messageId);
      }
      this.assistantTextByRun.set(runId, accumulated);
      this.publishRunEvent(runId, "message.part.delta", { messageId, text: delta });
      bridge.onMessageDelta();
      return;
    }
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
    if (event.type === "tool/post_use") {
      bridge.handle({ type: "tool.call.completed", toolCallId: stringField(payload, "toolCallId") ?? randomUUID(), output: payload.output ?? {}, ok: payload.ok !== false });
      const changedPath = fileWritingToolPath(payload);
      if (changedPath !== undefined) {
        bridge.handle({ type: "file.changed", path: changedPath, change: "modified" });
        this.publishRunEvent(runId, "artifact.diff.detected", { runId, path: changedPath });
      }
      return;
    }
    if (event.type === "fs/write") bridge.handle({ type: "fs.writeTextFile", path: requiredString(payload, "path"), content: stringField(payload, "content") ?? "" });
    if (event.type === "fs/delete") bridge.handle({ type: "fs.deleteFile", path: requiredString(payload, "path") });
    if (event.type === "pre_compact") {
      const text = stringField(payload, "text") ?? stringField(payload, "summary") ?? "";
      this.publishRunEvent(runId, "context.snapshot", { runId, snapshot: { kind: "claude_compact", text }, idempotencyKey: `claude_compact:${runId}` });
      return;
    }
    if (event.type === "subagent_start") {
      const subagentId = stringField(payload, "subagentId") ?? stringField(payload, "id") ?? randomUUID();
      this.publishRunEvent(runId, "subagent.started", { runId, subagentId, role: stringField(payload, "role") ?? stringField(payload, "profileRef") ?? "subagent" });
      return;
    }
    if (event.type === "subagent_stop") {
      const subagentId = stringField(payload, "subagentId") ?? stringField(payload, "id") ?? randomUUID();
      this.publishRunEvent(runId, "subagent.completed", { runId, subagentId, cost: costFromPayload(payload), durationMs: numberField(payload, "durationMs") ?? numberField(payload, "duration") ?? 0 });
      return;
    }
    if (event.type === "session/end") {
      const messageId = `msg_${runId}`;
      const text = this.assistantTextByRun.get(runId) ?? "";
      if (this.assistantTextByRun.has(runId)) {
        this.persistAssistantMessageEnd(runId, messageId, text);
        this.assistantTextByRun.delete(runId);
      }
      bridge.handle({ type: "session.ended", sessionId: stringField(payload, "sessionId") ?? `claude-${runId}`, reason: stringField(payload, "reason") ?? "completed", cost: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId: stringField(payload, "modelId") ?? "claude" } });
    }
  }

  private persistAssistantMessageStart(runId: string, messageId: string): void {
    const run = this.runById.get(runId);
    const db = this.options.services?.database;
    if (run === undefined || db === undefined) return;
    const now = this.options.now?.() ?? Date.now();
    db.sqlite.prepare(
      `INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'agent', ?, ?, 'assistant', 'streaming', NULL, 'immediate', NULL, ?, ?, NULL)`
    ).run(messageId, run.workspace_id, run.room_id, run.agent_id, runId, now, now);
    this.publishRunEvent(runId, "message.created", { messageId, role: "assistant", senderId: run.agent_id, runId });
  }

  private persistAssistantMessageEnd(runId: string, messageId: string, text: string): void {
    const db = this.options.services?.database;
    if (db === undefined) return;
    const now = this.options.now?.() ?? Date.now();
    const nextSeq = ((db.sqlite.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM message_parts WHERE message_id = ?").get(messageId) as { seq: number }).seq);
    db.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, ?, 'text', ?, ?)").run(messageId, nextSeq, JSON.stringify({ text }), now);
    db.sqlite.prepare("UPDATE messages SET status = 'completed', updated_at = ? WHERE id = ?").run(now, messageId);
    this.publishRunEvent(runId, "message.completed", { messageId, text });
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
    return buildRunPrompt(run, db, { ...(this.options.now !== undefined ? { now: this.options.now } : {}) });
  }
}

export function createClaudeCodeAdapter(options: ClaudeCodeAdapterOptions = {}): ClaudeCodeACPAdapter {
  return new ClaudeCodeACPAdapter(options);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringField(value: Record<string, unknown>, key: string): string | undefined { const field = value[key]; return typeof field === "string" ? field : undefined; }
function numberField(value: Record<string, unknown>, key: string): number | undefined { const field = value[key]; return typeof field === "number" && Number.isFinite(field) ? field : undefined; }
function requiredString(value: Record<string, unknown>, key: string): string { const field = stringField(value, key); if (field === undefined) throw new ACPAdapterError("invalid_provider_event", `${key} is required`); return field; }

function fileWritingToolPath(payload: Record<string, unknown>): string | undefined {
  const name = stringField(payload, "name")?.toLowerCase();
  if (name !== "write" && name !== "edit" && name !== "multiedit" && name !== "notebookedit") return undefined;
  return stringField(payload, "path") ?? pathFromRecord(payload.input) ?? pathFromRecord(payload.output);
}

function pathFromRecord(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return stringField(value, "path") ?? stringField(value, "file_path") ?? stringField(value, "filePath");
}

function costFromPayload(payload: Record<string, unknown>) {
  const cost = isRecord(payload.cost) ? payload.cost : payload;
  return { inputTokens: numberField(cost, "inputTokens") ?? 0, outputTokens: numberField(cost, "outputTokens") ?? 0, cachedTokens: numberField(cost, "cachedTokens") ?? 0, costUsd: numberField(cost, "costUsd") ?? 0, modelId: stringField(cost, "modelId") ?? "claude" };
}

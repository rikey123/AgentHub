import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { ACPAdapter, ACPAdapterError, AdapterHealthRegistry, AdapterRawLogger, emitAdapterRegistered, type AcpAdapterSession, type AcpProviderEvent, type AdapterRuntimeServices, type JsonRpcMessage } from "@agenthub/adapter-acp-base";
import type { PublishInput } from "@agenthub/bus";
import { AdapterBridge, buildRunPrompt, type AdapterArtifactFSBoundary, type RoomMcpServer, type RunLifecycleService, type RunRow } from "@agenthub/orchestrator";
import type { PermissionEngine } from "@agenthub/permissions";
import type { AdapterError, AgentAdapterManifest, DetectedRuntime } from "@agenthub/protocol";
import { Effect } from "effect";

export const opencodeManifest: AgentAdapterManifest = {
  id: "opencode",
  name: "OpenCode Adapter",
  runtimeKind: "acp",
  provider: "opencode",
  capabilities: { canStreamTokens: true, canEmitToolEvents: true, canEmitPermissionEvents: true, canEmitSubagentEvents: true, canInjectAtStart: true, canInjectNextTurn: true, canInjectRuntime: true, canCancel: true, canReadContextSnapshot: true, canRestoreSession: true, supportsMcp: true, supportsHooks: true, supportsWorkspaceIsolation: true },
  reliability: { level: "structured", eventSource: "native_event_stream", crashRecovery: "resumable", parseFailure: "skip_event", maxRestartAttempts: 3 },
  context: { startupInjection: true, runtimeInjection: true, injectionMode: "immediate", canPullExternalContext: true, canPushLedgerUpdates: true },
  workspace: { mode: "worktree" }
};

export type OpenCodeAdapterOptions = {
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
  readonly now?: () => number;
};

export class OpenCodeACPAdapter extends ACPAdapter {
  private readonly command: string;
  private readonly args: readonly string[];
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly bridgeByRun = new Map<string, AdapterBridge>();
  private readonly runById = new Map<string, RunRow>();
  private readonly workspaceByRun = new Map<string, string>();
  private readonly assistantTextByRun = new Map<string, string>();
  private readonly openedRuns = new Set<string>();
  private readonly pendingFailuresByRun = new Map<string, ACPAdapterError>();
  private readonly health: AdapterHealthRegistry | undefined;

  constructor(private readonly options: OpenCodeAdapterOptions = {}) {
    const logger = options.services !== undefined && options.workspaceId !== undefined ? new AdapterRawLogger(options.services.eventBus, { workspaceId: options.workspaceId, ...(options.now !== undefined ? { now: options.now } : {}) }) : undefined;
    const rawLogger = logger?.write.bind(logger);
    super("opencode", "OpenCode Adapter", opencodeManifest, { ...(options.now !== undefined ? { now: options.now } : {}), ...(rawLogger !== undefined ? { rawSink: rawLogger } : {}) });
    // Resolve the native binary path at construction time so spawnArgs() always uses
    // the real executable, not the npm .cmd wrapper (which uses stdio:"inherit" and
    // breaks pipe-based ACP communication on Windows).
    const rawCommand = options.command ?? process.env.OPENCODE_BIN ?? "opencode";
    const found = findExecutable(rawCommand);
    this.command = (found !== undefined ? (resolveNativeBinary(found) ?? found) : rawCommand);
    this.args = options.args ?? ["acp"];
    this.env = options.env;
    this.health = options.services !== undefined ? new AdapterHealthRegistry(options.services.eventBus, { ...(options.now !== undefined ? { now: options.now } : {}) }) : undefined;
  }

  detect(): Effect.Effect<DetectedRuntime[], AdapterError> {
    return Effect.sync(() => detectOpenCode(this.command));
  }

  async runManaged(run: RunRow): Promise<void> {
    if (this.options.services === undefined || this.options.lifecycle === undefined) throw new ACPAdapterError("configuration", "OpenCode managed run requires services and lifecycle");
    const workDir = run.work_dir ?? process.cwd();
    this.health?.update({ adapterId: this.id, workspaceId: run.workspace_id, liveness: "starting", pendingRunIds: [run.id] });
    emitAdapterRegistered(this.options.services.eventBus, run.workspace_id, opencodeManifest, this.options.now?.() ?? Date.now());
    const artifactFs = this.options.artifactFs ?? this.options.services.artifactFs;
    const getCommandBus = this.options.services.getCommandBus;
    const bridge = new AdapterBridge({ runId: run.id, workspaceId: run.workspace_id, roomId: run.room_id, agentId: run.agent_id, lifecycle: this.options.lifecycle, eventBus: this.options.services.eventBus, database: this.options.services.database, ...(getCommandBus !== undefined ? { getCommandBus } : {}), ...(this.options.services.briefResolver !== undefined ? { briefResolver: this.options.services.briefResolver } : {}), ...(this.options.now !== undefined ? { now: this.options.now } : {}), ...(run.task_id !== null ? { taskId: run.task_id } : {}), messageId: `msg_${run.id}`, ...(run.workspace_mode !== null ? { workspaceMode: run.workspace_mode } : {}), terminalEnabled: false, ...(artifactFs !== undefined ? { artifactFs } : {}) });
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

  feedProviderLineForTest(sessionId: string, line: string): AcpProviderEvent | undefined {
    const session = this.debugSession(sessionId);
    if (session === undefined) throw new ACPAdapterError("session_not_found", `ACP session '${sessionId}' not found`);
    return this.handleLine(session, line);
  }

  protected spawnArgs() { return { command: this.command, args: this.args, ...(this.env !== undefined ? { env: this.env } : {}) }; }

  protected mapProviderEvent(message: JsonRpcMessage): AcpProviderEvent | undefined {
    if (message.method === undefined) return undefined;
    const payload = isRecord(message.params) ? message.params : {};
    const nativeType = stringField(payload, "type") ?? message.method;
    const params = isRecord(payload.event) ? payload.event : payload;

    if (isPromptEvent(nativeType)) return { type: "prompt.started", payload: params };
    if (isMessageDeltaEvent(nativeType)) return { type: "message.part.delta", payload: params };
    if (isToolRequestedEvent(nativeType)) return { type: "tool.call.requested", payload: normalizeToolRequested(params) };
    if (isToolCompletedEvent(nativeType)) return { type: "tool.call.completed", payload: normalizeToolCompleted(params) };
    if (isPermissionEvent(nativeType)) return { type: "permission.requested", payload: normalizePermission(params) };
    if (isSubagentStartedEvent(nativeType)) return { type: "subagent.started", payload: normalizeSubagent(params) };
    if (isSubagentCompletedEvent(nativeType)) return { type: "subagent.completed", payload: normalizeSubagent(params) };
    if (isContextSnapshotEvent(nativeType)) return { type: "context.snapshot", payload: normalizeContextSnapshot(params) };
    if (isCancelEvent(nativeType)) return { type: "session.ended", payload: { ...params, reason: "cancelled" } };
    if (isSessionEndEvent(nativeType)) return { type: "session.ended", payload: normalizeSessionEnd(params) };
    if (isErrorEvent(nativeType)) return { type: "session.crashed", payload: normalizeError(params) };

    return undefined;
  }

  protected mapProviderError(error: unknown): AdapterError {
    const message = providerErrorMessage(error);
    const code = /cancel|abort|interrupt/iu.test(message) ? "user_cancelled" : "provider_error";
    return new ACPAdapterError(code, message, error);
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
    // Stream agent message text — persist to DB and publish delta event.
    if (event.type === "message.part.delta") {
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
    if (event.type === "tool.call.requested") bridge.handle({ type: "tool.call.requested", toolCallId: requiredString(payload, "toolCallId"), name: requiredString(payload, "name"), input: payload.input ?? {} });
    if (event.type === "tool.call.completed") bridge.handle({ type: "tool.call.completed", toolCallId: requiredString(payload, "toolCallId"), output: payload.output ?? {}, ok: payload.ok !== false });
    if (event.type === "subagent.started") bridge.handle({ type: "subagent.started", subRunId: requiredString(payload, "subRunId"), profileRef: requiredString(payload, "profileRef") });
    if (event.type === "subagent.completed") bridge.handle({ type: "subagent.completed", subRunId: requiredString(payload, "subRunId") });
    if (event.type === "context.snapshot") bridge.handle({ type: "context.snapshot", snapshot: payload });
    if (event.type === "session.ended") {
      // Persist the accumulated assistant message before finalizing the run.
      const messageId = `msg_${runId}`;
      const text = this.assistantTextByRun.get(runId) ?? "";
      if (this.assistantTextByRun.has(runId)) {
        this.persistAssistantMessageEnd(runId, messageId, text);
        this.assistantTextByRun.delete(runId);
      }
      bridge.handle({ type: "session.ended", sessionId: stringField(payload, "sessionId") ?? `opencode-${runId}`, reason: stringField(payload, "reason") ?? "completed", cost: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId: stringField(payload, "modelId") ?? "opencode" } });
    }
    if (event.type === "session.crashed") bridge.handle({ type: "session.crashed", sessionId: stringField(payload, "sessionId") ?? `opencode-${runId}`, error: stringField(payload, "error") ?? JSON.stringify(payload) });
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
    if (db === undefined) return;
    const now = this.options.now?.() ?? Date.now();
    const nextSeq = ((db.sqlite.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM message_parts WHERE message_id = ?").get(messageId) as { seq: number }).seq);
    db.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, ?, 'text', ?, ?)").run(messageId, nextSeq, JSON.stringify({ text }), now);
    db.sqlite.prepare("UPDATE messages SET status = 'completed', updated_at = ? WHERE id = ?").run(now, messageId);
    this.publishRunEvent(runId, "message.completed", { messageId, text });
  }

  private publishRunEvent(runId: string, type: PublishInput["type"], payload: Record<string, unknown>): void {
    const eventBus = this.options.services?.eventBus;
    const lifecycle = this.options.lifecycle;
    if (eventBus === undefined || lifecycle === undefined) return;
    let run: RunRow | undefined;
    try { run = lifecycle.read(runId); } catch { return; }
    if (run === undefined) return;
    eventBus.publish({ id: randomUUID(), type, schemaVersion: 1, workspaceId: run.workspace_id, roomId: run.room_id, ...(run.task_id !== null ? { taskId: run.task_id } : {}), runId, agentId: run.agent_id, payload, createdAt: this.options.now?.() ?? Date.now() } satisfies PublishInput);
  }

  private promptFromRun(run: RunRow): string {
    const db = this.options.services?.database;
    if (db === undefined) return `Run ${run.id} for agent ${run.agent_id}`;
    return buildRunPrompt(run, db, { ...(this.options.now !== undefined ? { now: this.options.now } : {}) });
  }

}

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions = {}): OpenCodeACPAdapter { return new OpenCodeACPAdapter(options); }

function detectOpenCode(command: string): DetectedRuntime[] {
  const found = findExecutable(command);
  if (found === undefined) return [];
  // On Windows, `where opencode` returns the .cmd npm wrapper which uses stdio:"inherit"
  // and breaks pipe-based ACP communication. Resolve to the actual native binary instead.
  const resolved = resolveNativeBinary(found) ?? found;
  const version = spawnSyncText(resolved, ["--version"]).trim().split(/\r?\n/u)[0] ?? "";
  return [{ id: "opencode", name: "opencode", ...(version.length > 0 ? { version } : {}), executablePath: resolved }];
}

/**
 * On Windows, npm-installed CLIs like opencode are .cmd wrappers that spawn the real
 * binary with stdio:"inherit", breaking pipe-based ACP. Walk up from the .cmd file to
 * find the actual native binary in node_modules.
 */
function resolveNativeBinary(cmdPath: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  if (!/\.(cmd|bat)$/iu.test(cmdPath)) return undefined;

  // The .cmd lives in e.g. C:\Users\...\npm\opencode.cmd
  // The package is at C:\Users\...\npm\node_modules\opencode-ai\
  // The native binary is at node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe
  const npmDir = dirname(cmdPath);
  const packageDir = join(npmDir, "node_modules", "opencode-ai", "node_modules");
  if (!existsSync(packageDir)) return undefined;

  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const candidates = [
    join(packageDir, `opencode-windows-${arch}`, "bin", "opencode.exe"),
    join(packageDir, `opencode-windows-${arch}-baseline`, "bin", "opencode.exe"),
  ];
  return candidates.find((p) => existsSync(p));
}

function findExecutable(command: string): string | undefined {
  if (command.includes("\\") || command.includes("/")) return command;
  const result = process.platform === "win32" ? spawnSyncStdout("where", [command]) : spawnSyncStdout("bash", ["-lc", `command -v ${shellQuote(command)}`]);
  return result.trim().split(/\r?\n/u).find(Boolean);
}

function spawnSyncText(command: string, args: readonly string[]): string {
  const invocation = windowsCommandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, { encoding: "utf8", shell: false, windowsVerbatimArguments: false });
  if (result.error !== undefined) return "";
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function spawnSyncStdout(command: string, args: readonly string[]): string {
  const invocation = windowsCommandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, { encoding: "utf8", shell: false, windowsVerbatimArguments: false });
  if (result.error !== undefined || result.status !== 0) return "";
  return result.stdout ?? "";
}

function windowsCommandInvocation(command: string, args: readonly string[]): { readonly command: string; readonly args: string[] } {
  if (process.platform === "win32" && /\.(cmd|bat)$/iu.test(command)) return { command: "cmd.exe", args: ["/c", command, ...args] };
  return { command, args: [...args] };
}

function isPromptEvent(type: string): boolean { return matches(type, "prompt/start", "prompt_started", "session/prompt/start", "session/prompt_started"); }
function isMessageDeltaEvent(type: string): boolean { return matches(type, "message/delta", "message_delta", "message/part_delta", "message_part_delta", "assistant/message_delta"); }
function isToolRequestedEvent(type: string): boolean { return matches(type, "tool/call/requested", "tool.call.requested", "tool/pre_use", "tool_call_start", "tool_call_requested"); }
function isToolCompletedEvent(type: string): boolean { return matches(type, "tool/call/completed", "tool.call.completed", "tool/post_use", "tool_call_stop", "tool_call_completed"); }
function isPermissionEvent(type: string): boolean { return matches(type, "permission/requested", "permission.requested", "permission/request", "permission_request"); }
function isSubagentStartedEvent(type: string): boolean { return matches(type, "subagent/started", "subagent.started", "subagent_start", "subagent/start"); }
function isSubagentCompletedEvent(type: string): boolean { return matches(type, "subagent/completed", "subagent.completed", "subagent_stop", "subagent/stop"); }
function isContextSnapshotEvent(type: string): boolean { return matches(type, "context/snapshot", "context.snapshot", "context_snapshot", "session/context_snapshot"); }
function isCancelEvent(type: string): boolean { return matches(type, "session/cancelled", "session.cancelled", "session/canceled", "cancelled", "canceled"); }
function isSessionEndEvent(type: string): boolean { return matches(type, "session/end", "session.ended", "session_end", "session/completed"); }
function isErrorEvent(type: string): boolean { return matches(type, "error", "session/error", "session.error", "session/crashed", "session.crashed"); }

function matches(type: string, ...candidates: readonly string[]): boolean {
  return candidates.includes(type.toLowerCase());
}

function normalizeToolRequested(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, toolCallId: stringField(payload, "toolCallId") ?? stringField(payload, "id") ?? randomUUID(), name: stringField(payload, "name") ?? stringField(payload, "tool") ?? "unknown", input: payload.input ?? payload.arguments ?? {} };
}

function normalizeToolCompleted(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, toolCallId: stringField(payload, "toolCallId") ?? stringField(payload, "id") ?? randomUUID(), output: payload.output ?? payload.result ?? {}, ok: payload.ok !== false && payload.error === undefined };
}

function normalizePermission(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, permissionId: stringField(payload, "permissionId") ?? stringField(payload, "id") ?? randomUUID(), reason: stringField(payload, "reason") ?? "OpenCode requested permission" };
}

function normalizeSubagent(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, subRunId: stringField(payload, "subRunId") ?? stringField(payload, "id") ?? randomUUID(), profileRef: stringField(payload, "profileRef") ?? stringField(payload, "role") ?? stringField(payload, "name") ?? "opencode-subagent" };
}

function normalizeContextSnapshot(payload: Record<string, unknown>): Record<string, unknown> {
  const text = stringField(payload, "text") ?? stringField(payload, "summary") ?? JSON.stringify(payload);
  return { kind: "opencode_context", text, metadata: payload.metadata ?? { adapterId: "opencode" } };
}

function normalizeSessionEnd(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, sessionId: stringField(payload, "sessionId") ?? stringField(payload, "id") ?? "opencode-session", reason: stringField(payload, "reason") ?? "completed" };
}

function normalizeError(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, error: stringField(payload, "error") ?? stringField(payload, "message") ?? JSON.stringify(payload) };
}

function providerErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    const message = stringField(error, "message");
    if (message !== undefined) return message;
  }
  return JSON.stringify(error);
}

function shellQuote(value: string): string { return `'${value.replace(/'/gu, "'\\''")}'`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringField(value: Record<string, unknown>, key: string): string | undefined { const field = value[key]; return typeof field === "string" && field.length > 0 ? field : undefined; }
function requiredString(value: Record<string, unknown>, key: string): string { return stringField(value, key) ?? (() => { throw new ACPAdapterError("invalid_event", `Missing string field '${key}'`); })(); }

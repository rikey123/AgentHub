import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import type { AdapterArtifactFSBoundary } from "@agenthub/orchestrator";
import type { PermissionEngine, PermissionResource } from "@agenthub/permissions";
import type { AdapterError, AdapterMessage, AdapterRunInput, AgentAdapterManifest, AttachSessionInput, ContextInjectionResult, ContextProjection, CreateSessionInput, DetectedRuntime, ExternalContextSnapshot, ExternalSession } from "@agenthub/protocol";
import type { EventType } from "@agenthub/protocol/events";
import { redactAndTruncate } from "@agenthub/security";
import { Effect, Stream } from "effect";

export type AcpSessionState = "disconnected" | "connecting" | "initializing" | "ready" | "prompting" | "cancelling" | "failed" | "disposed";
export type AdapterLiveness = "available" | "starting" | "ready" | "busy" | "blocked" | "crashed" | "offline";
export type AdapterDiscoveryErrorCode = "not_found" | "node_missing" | "version_mismatch" | "spawn_failed" | "handshake_timeout" | "auth_required";

export type AcpClientCapabilities = {
  readonly fs: { readonly readTextFile: true; readonly writeTextFile: true; readonly deleteFile: true };
  readonly terminal: false;
  readonly permission: { readonly request: true };
  readonly context: { readonly inject: true };
};

export type AcpPendingRequest = {
  readonly requestId: string;
  readonly method: string;
  readonly startedAt: number;
  readonly timeoutMs: number;
  readonly resolve: (result: unknown) => void;
  readonly reject: (err: AdapterError) => void;
  readonly timer?: ReturnType<typeof setTimeout>;
};

export type AcpAdapterSession = {
  state: AcpSessionState;
  acpSessionId: string;
  runId: string | undefined;
  workDir: string;
  pendingRequests: Map<string, AcpPendingRequest>;
  inflightPromptRequestId: string | undefined;
  clientCapabilities: AcpClientCapabilities;
  mcpServer: unknown | undefined;
  process: ChildProcessWithoutNullStreams | undefined;
  lineSplitter: NdjsonLineSplitter;
  promptTimeoutPaused: boolean;
};

export type JsonRpcMessage = { readonly jsonrpc?: "2.0"; readonly id?: string | number; readonly method?: string; readonly params?: unknown; readonly result?: unknown; readonly error?: unknown };
export type AcpProviderEvent = { readonly type: string; readonly payload?: unknown };
export type AdapterRawSink = (input: { readonly adapterId: string; readonly sessionId: string; readonly runId?: string; readonly stream: "stdout" | "stderr"; readonly line: string }) => void;

export const acpClientCapabilities: AcpClientCapabilities = {
  fs: { readTextFile: true, writeTextFile: true, deleteFile: true },
  terminal: false,
  permission: { request: true },
  context: { inject: true }
};

export class ACPAdapterError extends Error implements AdapterError {
  constructor(readonly code: string, message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "ACPAdapterError";
  }
}

export class AdapterNotImplementedError extends ACPAdapterError {
  constructor(adapterName: string, stage: string, capability = "adapter-framework") {
    super("not_implemented", `${adapterName} is ${stage}; MVP only ships mock and claude-code`, { status: 501, capability });
  }
}

export class NdjsonLineSplitter {
  private buffer = "";

  push(chunk: string | Buffer): string[] {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    const lines = this.buffer.split(/\r?\n/u);
    this.buffer = lines.pop() ?? "";
    return lines.filter((line) => line.length > 0);
  }

  flush(): string | undefined {
    if (this.buffer.length === 0) return undefined;
    const line = this.buffer;
    this.buffer = "";
    return line;
  }
}

export abstract class ACPAdapter {
  readonly kind = "acp" as const;
  protected readonly sessions = new Map<string, AcpAdapterSession>();
  protected readonly pendingByRun = new Map<string, string>();
  protected readonly now: () => number;
  protected readonly requestTimeoutMs: number;
  protected readonly rawSink: AdapterRawSink | undefined;

  protected constructor(readonly id: string, readonly name: string, readonly manifest: AgentAdapterManifest, options: { readonly now?: () => number; readonly requestTimeoutMs?: number; readonly rawSink?: AdapterRawSink } = {}) {
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.rawSink = options.rawSink;
  }

  abstract detect(): Effect.Effect<DetectedRuntime[], AdapterError>;
  protected abstract spawnArgs(): { readonly command: string; readonly args: readonly string[]; readonly env?: NodeJS.ProcessEnv };
  protected abstract mapProviderEvent(message: JsonRpcMessage): AcpProviderEvent | undefined;
  protected abstract mapProviderError(error: unknown): AdapterError;

  createSession(input: CreateSessionInput): Effect.Effect<ExternalSession, AdapterError> {
    return Effect.try({ try: () => this.createSessionSync(input), catch: (error) => toAdapterError(error) });
  }

  runAgent(input: AdapterRunInput): Stream.Stream<never, AdapterError> {
    const sessionId = input.sessionId ?? this.pendingByRun.get(input.runId);
    if (sessionId === undefined) return Stream.fail(new ACPAdapterError("session_not_found", `No ACP session for run '${input.runId}'`));
    try {
      this.sendPrompt(sessionId, input.message);
      return Stream.empty;
    } catch (error) {
      return Stream.fail(toAdapterError(error));
    }
  }

  sendMessage(sessionId: string, message: AdapterMessage): Effect.Effect<void, AdapterError> {
    return Effect.try({ try: () => { this.sendPrompt(sessionId, message); }, catch: (error) => toAdapterError(error) });
  }

  cancelRun(runId: string): Effect.Effect<void, AdapterError> {
    return Effect.try({ try: () => { this.cancelRunSync(runId); }, catch: (error) => toAdapterError(error) });
  }

  injectContext(sessionId: string, patch: ContextProjection): Effect.Effect<ContextInjectionResult, AdapterError> {
    return Effect.try({ try: () => { this.request(sessionId, "context/inject", patch); return { mode: this.manifest.context.injectionMode, applied: true, effectiveAt: "now" as const }; }, catch: (error) => toAdapterError(error) });
  }

  readSnapshot(sessionId: string): Effect.Effect<ExternalContextSnapshot, AdapterError> {
    return Effect.try({ try: () => ({ kind: "acp", text: JSON.stringify(this.snapshot(sessionId)), metadata: { adapterId: this.id } }), catch: (error) => toAdapterError(error) });
  }

  attachSession(input: AttachSessionInput): Effect.Effect<ExternalSession, AdapterError> {
    return Effect.try({ try: () => this.attachSessionSync(input), catch: (error) => toAdapterError(error) });
  }

  dispose(sessionId: string): Effect.Effect<void, AdapterError> {
    return Effect.try({ try: () => { this.disposeSync(sessionId); }, catch: (error) => toAdapterError(error) });
  }

  pausePromptTimeout(sessionId: string): void {
    this.requiredSession(sessionId).promptTimeoutPaused = true;
  }

  resumePromptTimeout(sessionId: string): void {
    this.requiredSession(sessionId).promptTimeoutPaused = false;
  }

  debugSession(sessionId: string): AcpAdapterSession | undefined {
    return this.sessions.get(sessionId);
  }

  completePromptForTest(sessionId: string, reason: "completed" | "cancelled" = "completed"): void {
    const session = this.requiredSession(sessionId);
    if (session.inflightPromptRequestId !== undefined) {
      const pending = session.pendingRequests.get(session.inflightPromptRequestId);
      if (pending !== undefined) {
        clearPending(pending);
        session.pendingRequests.delete(pending.requestId);
        if (reason === "cancelled") pending.reject(new ACPAdapterError("cancelled", "prompt cancelled"));
        else pending.resolve({ ok: true });
      }
    }
    session.inflightPromptRequestId = undefined;
    if (session.state === "prompting" || session.state === "cancelling") session.state = "ready";
  }

  addPendingForTest(sessionId: string, input: { readonly requestId: string; readonly method: string; readonly reject?: (error: AdapterError) => void; readonly resolve?: (result: unknown) => void }): void {
    const session = this.requiredSession(sessionId);
    session.pendingRequests.set(input.requestId, { requestId: input.requestId, method: input.method, startedAt: this.now(), timeoutMs: this.requestTimeoutMs, resolve: input.resolve ?? (() => undefined), reject: input.reject ?? (() => undefined) });
  }

  protected createSessionSync(input: CreateSessionInput): ExternalSession {
    const sessionId = `acp-${this.id}-${input.runId}`;
    if (this.sessions.has(sessionId)) throw new ACPAdapterError("session_exists", `ACP session '${sessionId}' already exists`);
    const session: AcpAdapterSession = { state: "connecting", acpSessionId: sessionId, runId: input.runId, workDir: input.workDir ?? process.cwd(), pendingRequests: new Map(), inflightPromptRequestId: undefined, clientCapabilities: acpClientCapabilities, mcpServer: input.mcpServer, process: undefined, lineSplitter: new NdjsonLineSplitter(), promptTimeoutPaused: false };
    this.sessions.set(sessionId, session);
    this.pendingByRun.set(input.runId, sessionId);
    const spawned = this.trySpawn(session);
    if (!spawned) session.state = "ready";
    return { id: sessionId, runId: input.runId, workDir: session.workDir, ...(input.mcpServer !== undefined ? { mcpServer: input.mcpServer } : {}) };
  }

  protected attachSessionSync(input: AttachSessionInput): ExternalSession {
    const session: AcpAdapterSession = { state: "ready", acpSessionId: input.adapterSessionId, runId: input.runId, workDir: input.workDir ?? process.cwd(), pendingRequests: new Map(), inflightPromptRequestId: undefined, clientCapabilities: acpClientCapabilities, mcpServer: undefined, process: undefined, lineSplitter: new NdjsonLineSplitter(), promptTimeoutPaused: false };
    this.sessions.set(input.adapterSessionId, session);
    this.pendingByRun.set(input.runId, input.adapterSessionId);
    return { id: input.adapterSessionId, runId: input.runId, workDir: session.workDir, ...(input.providerConversationId !== undefined ? { providerConversationId: input.providerConversationId } : {}) };
  }

  protected request(sessionId: string, method: string, params?: unknown, options: { readonly timeoutMs?: number; readonly prompt?: boolean } = {}): string {
    const session = this.requiredLiveSession(sessionId);
    if (options.prompt === true && session.inflightPromptRequestId !== undefined && !providerAllowsConcurrentPrompt(this.manifest)) {
      throw new ACPAdapterError("prompt_in_flight", "ACP prompt already in flight");
    }
    const requestId = randomUUID();
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const pending: AcpPendingRequest = {
      requestId,
      method,
      startedAt: this.now(),
      timeoutMs,
      resolve: () => undefined,
      reject: () => undefined,
      timer: setTimeout(() => {
        session.pendingRequests.delete(requestId);
        if (session.inflightPromptRequestId === requestId) session.inflightPromptRequestId = undefined;
      }, timeoutMs)
    };
    pending.timer?.unref?.();
    session.pendingRequests.set(requestId, pending);
    if (options.prompt === true) {
      session.inflightPromptRequestId = requestId;
      session.state = "prompting";
    }
    this.writeJson(session, { jsonrpc: "2.0", id: requestId, method, params });
    return requestId;
  }

  protected sendPrompt(sessionId: string, message: AdapterMessage): string {
    return this.request(sessionId, "session/prompt", { message: serializePrompt(message) }, { prompt: true });
  }

  protected cancelRunSync(runId: string): void {
    const sessionId = this.pendingByRun.get(runId);
    if (sessionId === undefined) return;
    const session = this.requiredLiveSession(sessionId);
    if (session.inflightPromptRequestId === undefined) return;
    const prompt = session.pendingRequests.get(session.inflightPromptRequestId);
    session.state = "cancelling";
    this.writeJson(session, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: session.acpSessionId } });
    if (prompt !== undefined) {
      clearPending(prompt);
      session.pendingRequests.delete(prompt.requestId);
      prompt.reject(new ACPAdapterError("cancelled", "prompt cancelled"));
    }
    session.inflightPromptRequestId = undefined;
  }

  protected disposeSync(sessionId: string): void {
    const session = this.requiredSession(sessionId);
    if (session.state === "disposed") return;
    try { this.writeJson(session, { jsonrpc: "2.0", method: "session/end", params: { sessionId } }); } catch { /* process may already be gone */ }
    for (const pending of session.pendingRequests.values()) {
      clearPending(pending);
      pending.reject(new ACPAdapterError("session_disposed", "ACP session disposed"));
    }
    session.pendingRequests.clear();
    session.inflightPromptRequestId = undefined;
    if (session.process !== undefined && !session.process.killed) killProcessTree(session.process);
    session.state = "disposed";
    if (session.runId !== undefined) this.pendingByRun.delete(session.runId);
  }

  protected handleLine(session: AcpAdapterSession, line: string): AcpProviderEvent | undefined {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emitRaw(session, "stderr", line);
      return undefined;
    }
    if (message.id !== undefined && message.method === undefined) {
      const requestId = String(message.id);
      const pending = session.pendingRequests.get(requestId);
      if (pending !== undefined) {
        clearPending(pending);
        session.pendingRequests.delete(requestId);
        if (message.error !== undefined) pending.reject(this.mapProviderError(message.error));
        else pending.resolve(message.result);
        if (session.inflightPromptRequestId === requestId) {
          session.inflightPromptRequestId = undefined;
          if (session.state === "prompting" || session.state === "cancelling") session.state = "ready";
        }
      }
      return undefined;
    }
    if (message.method === "protocol/configUpdated") return { type: "protocol/configUpdated", payload: message.params };
    return this.mapProviderEvent(message);
  }

  protected emitRaw(session: AcpAdapterSession, stream: "stdout" | "stderr", line: string): void {
    this.rawSink?.({ adapterId: this.id, sessionId: session.acpSessionId, ...(session.runId !== undefined ? { runId: session.runId } : {}), stream, line: redactAndTruncate(line) });
  }

  private trySpawn(session: AcpAdapterSession): boolean {
    const spawnSpec = this.spawnArgs();
    if (spawnSpec.command.length === 0) return false;
    try {
      const child = spawn(spawnSpec.command, [...spawnSpec.args], { cwd: session.workDir, env: filterSafeEnv(spawnSpec.env ?? process.env), windowsVerbatimArguments: false, detached: false });
      session.process = child;
      session.state = "initializing";
      child.stdout.on("data", (chunk: Buffer) => {
        for (const line of session.lineSplitter.push(chunk)) this.handleLine(session, line);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        for (const line of new NdjsonLineSplitter().push(chunk)) this.emitRaw(session, "stderr", line);
      });
      child.on("exit", () => { if (session.state !== "disposed") session.state = "failed"; });
      this.writeJson(session, { jsonrpc: "2.0", method: "initialize", params: { clientCapabilities: session.clientCapabilities } });
      session.state = "ready";
      return true;
    } catch (error) {
      session.state = "failed";
      throw new ACPAdapterError("spawn_failed", error instanceof Error ? error.message : String(error), error);
    }
  }

  private writeJson(session: AcpAdapterSession, message: JsonRpcMessage): void {
    if (session.process !== undefined && !session.process.killed) session.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private requiredSession(sessionId: string): AcpAdapterSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new ACPAdapterError("session_not_found", `ACP session '${sessionId}' not found`);
    return session;
  }

  private requiredLiveSession(sessionId: string): AcpAdapterSession {
    const session = this.requiredSession(sessionId);
    if (session.state === "disposed") throw new ACPAdapterError("session_disposed", `ACP session '${sessionId}' is disposed`);
    if (session.state === "failed") throw new ACPAdapterError("session_failed", `ACP session '${sessionId}' failed`);
    return session;
  }

  private snapshot(sessionId: string): Record<string, unknown> {
    const session = this.requiredSession(sessionId);
    return { sessionId, state: session.state, pendingRequests: [...session.pendingRequests.keys()], inflightPromptRequestId: session.inflightPromptRequestId };
  }
}

export type AdapterHealth = { readonly adapterId: string; readonly liveness: AdapterLiveness; readonly lastHeartbeatAt?: number; readonly pendingRunIds: readonly string[]; readonly crashCount: number; readonly lastError?: { readonly reason: string; readonly at: number } };

export class AdapterHealthRegistry {
  private readonly health = new Map<string, AdapterHealth>();
  private readonly now: () => number;

  constructor(private readonly eventBus: EventBus, options: { readonly now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  update(input: { readonly adapterId: string; readonly workspaceId: string; readonly liveness: AdapterLiveness; readonly pendingRunIds?: readonly string[]; readonly reason?: string }): AdapterHealth {
    const previous = this.health.get(input.adapterId);
    const next: AdapterHealth = { adapterId: input.adapterId, liveness: input.liveness, lastHeartbeatAt: this.now(), pendingRunIds: input.pendingRunIds ?? previous?.pendingRunIds ?? [], crashCount: (previous?.crashCount ?? 0) + (input.liveness === "crashed" ? 1 : 0), ...(input.reason !== undefined ? { lastError: { reason: input.reason, at: this.now() } } : previous?.lastError !== undefined ? { lastError: previous.lastError } : {}) };
    this.health.set(input.adapterId, next);
    this.eventBus.publish(adapterEvent("adapter.liveness.changed", input.workspaceId, input.adapterId, { adapterId: input.adapterId, liveness: input.liveness, pendingRunIds: next.pendingRunIds, crashCount: next.crashCount, lastError: next.lastError }, this.now()));
    return next;
  }

  get(adapterId: string): AdapterHealth | undefined {
    return this.health.get(adapterId);
  }
}

export class AdapterRawLogger {
  private readonly recentHashes = new Map<string, string[]>();

  constructor(private readonly eventBus: EventBus, private readonly options: { readonly workspaceId: string; readonly logRoot?: string; readonly now?: () => number }) {}

  write(input: { readonly adapterId: string; readonly sessionId: string; readonly runId?: string; readonly stream: "stdout" | "stderr"; readonly line: string }): void {
    const line = redactAndTruncate(input.line);
    const key = `${input.sessionId}:${input.stream}`;
    const hash = sha256(line);
    const hashes = this.recentHashes.get(key) ?? [];
    if (hashes.includes(hash)) return;
    hashes.push(hash);
    while (hashes.length > 256) hashes.shift();
    this.recentHashes.set(key, hashes);
    const logPath = join(this.options.logRoot ?? join(homedir(), ".agenthub", "logs", "sessions"), `${input.sessionId}-${input.runId ?? "no-run"}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${new Date(this.options.now?.() ?? Date.now()).toISOString()} ${input.stream} ${input.adapterId} | ${line}\n`, "utf8");
    this.eventBus.publish(adapterEvent(input.stream === "stdout" ? "adapter.raw.stdout" : "adapter.raw.stderr", this.options.workspaceId, input.adapterId, { adapterId: input.adapterId, adapterSessionId: input.sessionId, line }, this.options.now?.() ?? Date.now(), input.runId));
  }
}

export type AdapterRuntimeServices = { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly permissionEngine?: PermissionEngine; readonly artifactFs?: AdapterArtifactFSBoundary; readonly now?: () => number };

export function emitAdapterRegistered(eventBus: EventBus, workspaceId: string, manifest: AgentAdapterManifest, now = Date.now()): void {
  eventBus.publish(adapterEvent("adapter.registered", workspaceId, manifest.id, { adapterId: manifest.id, manifest }, now));
}

export function emitAdapterConfigUpdated(eventBus: EventBus, workspaceId: string, manifest: AgentAdapterManifest, changedFields: readonly string[], now = Date.now()): void {
  eventBus.publish(adapterEvent("adapter.config.updated", workspaceId, manifest.id, { adapterId: manifest.id, changedFields, current: { id: manifest.id, name: manifest.name, capabilities: manifest.capabilities, context: manifest.context } }, now));
}

export function emitAgentCapabilitiesUpdated(eventBus: EventBus, workspaceId: string, agentId: string, before: readonly string[], after: readonly string[], now = Date.now()): void {
  eventBus.publish({ id: randomUUID(), type: "agent.capabilities.updated", schemaVersion: 1, workspaceId, agentId, payload: { agentId, before, after }, createdAt: now } satisfies PublishInput);
}

export function adapterEvent(type: EventType, workspaceId: string, adapterId: string, payload: Record<string, unknown>, createdAt: number, runId?: string): PublishInput {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId, ...(runId !== undefined ? { runId } : {}), agentId: adapterId, payload, createdAt };
}

export function serializePrompt(message: AdapterMessage): string {
  const header = `<agenthub-message role="${message.role}">`;
  return `${header}\n${message.content}\n</agenthub-message>`;
}

export function notImplementedEffect(adapterName: string, stage: string): Effect.Effect<never, AdapterError> {
  return Effect.fail(new AdapterNotImplementedError(adapterName, stage));
}

export function notImplementedStream(adapterName: string, stage: string): Stream.Stream<never, AdapterError> {
  return Stream.fail(new AdapterNotImplementedError(adapterName, stage));
}

export function detectCommand(command: string, versionArg = "--version"): DetectedRuntime[] {
  const found = process.platform === "win32" ? spawnSyncStdout("where", [command]).trim().split(/\r?\n/u).find(Boolean) : spawnSyncStdout("bash", ["-lc", `command -v ${shellQuote(command)}`]).trim() || spawnSyncStdout("zsh", ["-lc", `command -v ${shellQuote(command)}`]).trim();
  if (!found) return [];
  const version = spawnSyncText(found, [versionArg]).trim().split(/\r?\n/u)[0];
  return [{ id: command, name: command, ...(version ? { version } : {}), executablePath: found }];
}

export function classifyClaudeDetection(command = "claude"): { readonly ok: true; readonly runtimes: DetectedRuntime[] } | { readonly ok: false; readonly code: AdapterDiscoveryErrorCode; readonly message: string } {
  const runtimes = detectCommand(command);
  if (runtimes.length === 0) return { ok: false, code: "not_found", message: "claude binary was not found on PATH" };
  const authProbe = spawnSyncText(command, ["--version"]);
  if (/auth|login|required/i.test(authProbe) && !/version/i.test(authProbe)) return { ok: false, code: "auth_required", message: "claude CLI reported authentication is required" };
  return { ok: true, runtimes };
}

export function permissionForTool(toolName: string, input: unknown): PermissionResource {
  if (toolName.toLowerCase() === "bash" && isRecord(input) && typeof input.command === "string") return { type: "shell", command: input.command };
  return { type: "tool", toolName, input };
}

function clearPending(pending: AcpPendingRequest): void {
  if (pending.timer !== undefined) clearTimeout(pending.timer);
}

function providerAllowsConcurrentPrompt(manifest: AgentAdapterManifest): boolean {
  const maybe = manifest as AgentAdapterManifest & { readonly acp?: { readonly concurrentPrompt?: boolean } };
  return maybe.acp?.concurrentPrompt === true;
}

function toAdapterError(error: unknown): AdapterError {
  if (error instanceof ACPAdapterError) return error;
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") return error as AdapterError;
  return new ACPAdapterError("adapter_error", error instanceof Error ? error.message : String(error), error);
}

function filterSafeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (/TOKEN|API_KEY|SECRET|PASSWORD|AGENTHUB_TOKEN/iu.test(key)) continue;
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsVerbatimArguments: false });
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }, 5_000).unref?.();
  }
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

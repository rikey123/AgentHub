import { createHash, randomUUID } from "node:crypto";
import { spawn as crossSpawn } from "cross-spawn";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { CommandBus, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import type { AdapterArtifactFSBoundary, BriefResolver } from "@agenthub/orchestrator";
import type { PermissionEngine, PermissionResource } from "@agenthub/permissions";
import type { AdapterError, AdapterMessage, AdapterRunInput, AgentAdapterManifest, AttachSessionInput, ContextInjectionResult, ContextProjection, CreateSessionInput, DetectedRuntime, ExternalContextSnapshot, ExternalSession } from "@agenthub/protocol";
import type { EventType } from "@agenthub/protocol/events";
import { redactAndTruncate, wrapExternalContent } from "@agenthub/security";
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
  timer?: ReturnType<typeof setTimeout>;
};

export type AcpAdapterSession = {
  state: AcpSessionState;
  acpSessionId: string;
  runId: string | undefined;
  roomId: string;
  agentId: string;
  workDir: string;
  pendingRequests: Map<string, AcpPendingRequest>;
  inflightPromptRequestId: string | undefined;
  clientCapabilities: AcpClientCapabilities;
  mcpServer: unknown | undefined;
  process: ChildProcessWithoutNullStreams | undefined;
  lineSplitter: NdjsonLineSplitter;
  stderrLineSplitter: NdjsonLineSplitter;
  stderrTail: string[];
  livenessTimer: ReturnType<typeof setInterval> | undefined;
  /** Fires if the ACP handshake (initialize→session/new) doesn't complete within the deadline. */
  handshakeTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
  consecutivePingMisses: number;
  pingDisabled?: boolean;
  /** Server-issued sessionId from session/new. Used in outgoing ACP requests; falls back to acpSessionId. */
  serverSessionId?: string;
  /** True after initialize+session/new resolve (or fall back to legacy). Gates queued prompt flush. */
  handshakeComplete?: boolean;
  /** Agent-declared prompt capabilities from initialize. Undefined means legacy/unknown ACP server. */
  agentPromptCapabilities?: AcpPromptCapabilities;
  promptTimeoutPaused: boolean;
  /** Prompts submitted before session/new returned. Flushed once the server-issued sessionId is available. */
  queuedPrompts?: Array<{ message: AdapterMessage }>;
};

export type JsonRpcMessage = { readonly jsonrpc?: "2.0"; readonly id?: string | number; readonly method?: string; readonly params?: unknown; readonly result?: unknown; readonly error?: unknown };
export type AcpProviderEvent = { readonly type: string; readonly payload?: unknown };
export type AdapterRawSink = (input: { readonly adapterId: string; readonly sessionId: string; readonly runId?: string; readonly stream: "stdout" | "stderr"; readonly line: string }) => void;
export type WarmSessionInput = { readonly roomId: string; readonly agentId: string; readonly sessionId?: string; readonly workDir?: string; readonly mcpServer?: unknown };
export type WarmSessionBindingInput = { readonly roomId: string; readonly agentId: string; readonly runId: string; readonly mcpServer?: unknown };
export type WarmExternalSession = Omit<ExternalSession, "runId"> & { readonly runId?: string };
type AcpPromptContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly mimeType: string; readonly data: string; readonly uri?: string }
  | { readonly type: "audio"; readonly mimeType: string; readonly data: string }
  | { readonly type: "resource"; readonly resource: { readonly uri: string; readonly mimeType?: string; readonly text: string } | { readonly uri: string; readonly mimeType?: string; readonly blob: string } };
export type AcpPromptCapabilities = { readonly image?: boolean; readonly audio?: boolean; readonly embeddedContext?: boolean };
export type AcpPromptCapabilityOverrides = Partial<AcpPromptCapabilities>;

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
  protected readonly warmByRoomAgent = new Map<string, string>();
  protected readonly now: () => number;
  protected readonly requestTimeoutMs: number;
  protected readonly promptTimeoutMs: number;
  protected readonly rawSink: AdapterRawSink | undefined;
  private readonly promptCapabilityOverrides: AcpPromptCapabilityOverrides | undefined;

  protected constructor(readonly id: string, readonly name: string, readonly manifest: AgentAdapterManifest, options: { readonly now?: () => number; readonly requestTimeoutMs?: number; readonly promptTimeoutMs?: number; readonly rawSink?: AdapterRawSink; readonly promptCapabilityOverrides?: AcpPromptCapabilityOverrides } = {}) {
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.promptTimeoutMs = options.promptTimeoutMs ?? 600_000;
    this.rawSink = options.rawSink;
    this.promptCapabilityOverrides = options.promptCapabilityOverrides;
  }

  abstract detect(): Effect.Effect<DetectedRuntime[], AdapterError>;
  protected abstract spawnArgs(): { readonly command: string; readonly args: readonly string[]; readonly env?: NodeJS.ProcessEnv };
  protected abstract mapProviderEvent(message: JsonRpcMessage): AcpProviderEvent | undefined;
  protected abstract mapProviderError(error: unknown): AdapterError;

  protected onProviderEvent(session: AcpAdapterSession, event: AcpProviderEvent): void {
    void session;
    void event;
    // Subclasses may bridge provider events into AdapterBridge or other boundaries.
  }

  protected onSessionFailed(session: AcpAdapterSession, error: ACPAdapterError): void {
    void session;
    void error;
    // Subclasses may bridge supervision failures into AdapterBridge or other boundaries.
  }

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

  updateSessionMcpServer(sessionId: string, mcpServer: unknown): void {
    this.requiredSession(sessionId).mcpServer = mcpServer;
  }

  disposeRoomWarmSessions(roomId: string): void {
    for (const [sessionId, session] of [...this.sessions.entries()]) {
      if (session.roomId === roomId && session.runId === undefined) this.disposeSync(sessionId);
    }
  }

  disposeAllSessions(): void {
    for (const sessionId of [...this.sessions.keys()]) this.disposeSync(sessionId);
  }

  createWarmSession(input: WarmSessionInput): WarmExternalSession {
    const key = warmKey(input.roomId, input.agentId);
    const existingSessionId = this.warmByRoomAgent.get(key);
    if (existingSessionId !== undefined) {
      const existing = this.sessions.get(existingSessionId);
      if (existing !== undefined && existing.state !== "disposed" && existing.state !== "failed") {
        return { id: existing.acpSessionId, workDir: existing.workDir, ...(existing.mcpServer !== undefined ? { mcpServer: existing.mcpServer } : {}) };
      }
      this.warmByRoomAgent.delete(key);
    }
    const sessionId = input.sessionId ?? `acp-${this.id}-warm-${input.roomId}-${input.agentId}`;
    if (this.sessions.has(sessionId)) throw new ACPAdapterError("session_exists", `ACP session '${sessionId}' already exists`);
    const session = this.newSession({ sessionId, roomId: input.roomId, agentId: input.agentId, ...(input.workDir !== undefined ? { workDir: input.workDir } : {}), ...(input.mcpServer !== undefined ? { mcpServer: input.mcpServer } : {}) });
    this.sessions.set(sessionId, session);
    this.warmByRoomAgent.set(key, sessionId);
    const spawned = this.trySpawn(session);
    if (!spawned) {
      session.state = "ready";
      session.handshakeComplete = true;
    }
    return { id: sessionId, workDir: session.workDir, ...(input.mcpServer !== undefined ? { mcpServer: input.mcpServer } : {}) };
  }

  bindWarmSessionToRun(input: WarmSessionBindingInput): ExternalSession | undefined {
    const key = warmKey(input.roomId, input.agentId);
    const sessionId = this.warmByRoomAgent.get(key);
    if (sessionId === undefined) return undefined;
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.state === "disposed" || session.state === "failed") {
      this.warmByRoomAgent.delete(key);
      return undefined;
    }
    if (session.inflightPromptRequestId !== undefined || session.state === "prompting" || session.state === "cancelling") return undefined;
    if (session.runId !== undefined) this.pendingByRun.delete(session.runId);
    session.runId = input.runId;
    if (input.mcpServer !== undefined) session.mcpServer = input.mcpServer;
    this.pendingByRun.set(input.runId, sessionId);
    return { id: sessionId, runId: input.runId, workDir: session.workDir, ...(session.mcpServer !== undefined ? { mcpServer: session.mcpServer } : {}) };
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
    const session = this.newSession({ sessionId, runId: input.runId, roomId: input.roomId, agentId: input.agentId, ...(input.workDir !== undefined ? { workDir: input.workDir } : {}), ...(input.mcpServer !== undefined ? { mcpServer: input.mcpServer } : {}) });
    this.sessions.set(sessionId, session);
    this.pendingByRun.set(input.runId, sessionId);
    const spawned = this.trySpawn(session);
    if (!spawned) {
      session.state = "ready";
      // No real ACP handshake to perform; treat the session as already established so prompts
      // are sent directly (and existing tests that stub spawnSpec to {command:""} continue to work).
      session.handshakeComplete = true;
    }
    return { id: sessionId, runId: input.runId, workDir: session.workDir, ...(input.mcpServer !== undefined ? { mcpServer: input.mcpServer } : {}) };
  }

  protected attachSessionSync(input: AttachSessionInput): ExternalSession {
    const session = this.newSession({ sessionId: input.adapterSessionId, runId: input.runId, roomId: "", agentId: "", ...(input.workDir !== undefined ? { workDir: input.workDir } : {}) });
    session.state = "ready";
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
    const timeoutMs = options.timeoutMs ?? (options.prompt === true ? this.promptTimeoutMs : this.requestTimeoutMs);
    const pending: AcpPendingRequest = {
      requestId,
      method,
      startedAt: this.now(),
      timeoutMs,
      resolve: () => undefined,
      reject: () => undefined
    };
    const scheduleTimeout = (): void => {
      pending.timer = setTimeout(() => {
        const current = session.pendingRequests.get(requestId);
        if (current === undefined) return;
        session.pendingRequests.delete(requestId);
        if (session.inflightPromptRequestId === requestId) {
          session.inflightPromptRequestId = undefined;
          if (options.prompt === true && !session.promptTimeoutPaused) {
            this.failSession(session, new ACPAdapterError("prompt_timeout", `ACP prompt did not complete within ${timeoutMs}ms`));
            return;
          }
        }
        current.reject(new ACPAdapterError("request_timeout", `ACP request '${method}' did not complete within ${timeoutMs}ms`));
      }, timeoutMs);
      pending.timer?.unref?.();
    };
    scheduleTimeout();
    session.pendingRequests.set(requestId, pending);
    if (options.prompt === true) {
      session.inflightPromptRequestId = requestId;
      session.state = "prompting";
    }
    this.writeJson(session, { jsonrpc: "2.0", id: requestId, method, params });
    return requestId;
  }

  protected sendPrompt(sessionId: string, message: AdapterMessage): string {
    const session = this.requiredSession(sessionId);
    // If the ACP handshake (initialize -> session/new) hasn't completed yet, queue the prompt
    // so it can be flushed with the correct server-issued sessionId.
    if (session.handshakeComplete !== true && session.serverSessionId === undefined) {
      session.queuedPrompts ??= [];
      session.queuedPrompts.push({ message });
      return `queued-${randomUUID()}`;
    }
    // ACP `session/prompt` requires `{ sessionId, prompt: ContentBlock[] }`.
    return this.request(sessionId, "session/prompt", {
      sessionId: session.serverSessionId ?? session.acpSessionId,
      prompt: acpPromptContentBlocks(message, session.agentPromptCapabilities)
    }, { prompt: true });
  }

  protected cancelRunSync(runId: string): void {
    const sessionId = this.pendingByRun.get(runId);
    if (sessionId === undefined) return;
    const session = this.requiredLiveSession(sessionId);
    if (session.inflightPromptRequestId === undefined) return;
    const prompt = session.pendingRequests.get(session.inflightPromptRequestId);
    session.state = "cancelling";
    this.writeJson(session, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: session.serverSessionId ?? session.acpSessionId } });
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
    session.state = "disposed";
    try { this.writeJson(session, { jsonrpc: "2.0", method: "session/end", params: { sessionId } }); } catch { /* process may already be gone */ }
    for (const pending of session.pendingRequests.values()) {
      clearPending(pending);
      pending.reject(new ACPAdapterError("session_disposed", "ACP session disposed"));
    }
    session.pendingRequests.clear();
    session.inflightPromptRequestId = undefined;
    if (session.process !== undefined && !session.process.killed) killProcessTree(session.process);
    if (session.livenessTimer !== undefined) clearInterval(session.livenessTimer);
    if (session.runId !== undefined) this.pendingByRun.delete(session.runId);
    this.warmByRoomAgent.delete(warmKey(session.roomId, session.agentId));
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
        if (message.error !== undefined) {
          // Detect "Method not found" from the raw JSON-RPC error before subclasses' mapProviderError
          // strips the code. Pass through a synthetic AdapterError that initialize/session/new/ping
          // handlers can recognize via isMethodNotFound().
          const rawCode = isRecord(message.error) ? (message.error as { code?: unknown }).code : undefined;
          const rawMsg = isRecord(message.error) ? (message.error as { message?: unknown }).message : undefined;
          const isMethodMissing = rawCode === -32601 || (typeof rawMsg === "string" && /method not found|unknown method/i.test(rawMsg));
          if (isMethodMissing) {
            pending.reject(new ACPAdapterError("method_not_found", typeof rawMsg === "string" ? rawMsg : "Method not found"));
          } else {
            pending.reject(this.mapProviderError(message.error));
          }
        } else {
          pending.resolve(wrapFileReadResult(pending, message.result));
          if (pending.method === "protocol/ping") session.consecutivePingMisses = 0;
        }
        if (session.inflightPromptRequestId === requestId) {
          session.inflightPromptRequestId = undefined;
          if (session.state === "prompting" || session.state === "cancelling") session.state = "ready";
          // Emit a synthetic session.ended event so adapters/bridges can finalize the run.
          if (pending.method === "session/prompt" && message.error === undefined) {
            const result = isRecord(message.result) ? message.result : {};
            const stopReason = typeof result.stopReason === "string" ? result.stopReason : "completed";
            const usage = isRecord(result.usage) ? result.usage : undefined;
            const cost = usage !== undefined ? {
              inputTokens: typeof usage.inputTokens === "number" ? usage.inputTokens : 0,
              outputTokens: typeof usage.outputTokens === "number" ? usage.outputTokens : 0,
              cachedTokens: (typeof usage.cachedReadTokens === "number" ? usage.cachedReadTokens : 0) + (typeof usage.cachedWriteTokens === "number" ? usage.cachedWriteTokens : 0),
              costUsd: 0,
              modelId: typeof result.modelId === "string" ? result.modelId : "claude"
            } : undefined;
            const synthetic: JsonRpcMessage = { jsonrpc: "2.0", method: "session/end", params: { sessionId: session.serverSessionId ?? session.acpSessionId, reason: stopReason, ...(cost !== undefined ? { cost } : {}) } };
            const event = this.mapProviderEvent(synthetic) ?? { type: "session/end", payload: synthetic.params };
            this.onProviderEvent(session, event);
          }
        }
      }
      return undefined;
    }
    if (message.id !== undefined && message.method !== undefined) {
      if (this.handleProviderRequest(session, message)) {
        this.refreshInflightPromptTimeout(session);
        return undefined;
      }
      this.writeJson(session, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
      this.refreshInflightPromptTimeout(session);
      return undefined;
    }
    if (message.method === "protocol/configUpdated") {
      const event = { type: "protocol/configUpdated", payload: message.params };
      this.onProviderEvent(session, event);
      this.refreshInflightPromptTimeout(session);
      return event;
    }
    // ACP v1 spec uses `session/update` as the umbrella notification; translate the inner
    // `update.sessionUpdate` discriminator to legacy event types so subclasses' mapProviderEvent
    // (which were written for older Claude/Qwen-style verbs) keep working.
    if (message.method === "session/update" && isRecord(message.params)) {
      const update = isRecord((message.params as { update?: unknown }).update) ? (message.params as { update: Record<string, unknown> }).update : undefined;
      if (update !== undefined && typeof update.sessionUpdate === "string") {
        const translated = translateSessionUpdate(update);
        if (translated !== undefined) {
          const synthetic: JsonRpcMessage = { jsonrpc: "2.0", method: translated.method, params: translated.params };
          const event = this.mapProviderEvent(synthetic) ?? { type: translated.method, payload: translated.params };
          this.onProviderEvent(session, event);
          this.refreshInflightPromptTimeout(session);
          return event;
        }
      }
    }
    const event = this.mapProviderEvent(message);
    if (event !== undefined) {
      this.onProviderEvent(session, event);
      this.refreshInflightPromptTimeout(session);
    }
    return event;
  }

  private handleProviderRequest(session: AcpAdapterSession, message: JsonRpcMessage): boolean {
    const requestId = message.id;
    if (requestId === undefined) return false;
    if (message.method === "session/request_permission" || message.method === "session/request_permissions") {
      this.writeJson(session, {
        jsonrpc: "2.0",
        id: requestId,
        result: permissionResponseForProviderRequest(message.params)
      });
      return true;
    }
    return false;
  }

  protected emitRaw(session: AcpAdapterSession, stream: "stdout" | "stderr", line: string): void {
    if (stream === "stderr") {
      session.stderrTail.push(line);
      while (session.stderrTail.length > 100) session.stderrTail.shift();
    }
    this.rawSink?.({ adapterId: this.id, sessionId: session.acpSessionId, ...(session.runId !== undefined ? { runId: session.runId } : {}), stream, line: redactAndTruncate(line) });
  }

  private trySpawn(session: AcpAdapterSession): boolean {
    const spawnSpec = this.spawnArgs();
    if (spawnSpec.command.length === 0) return false;
    try {
      const invocation = windowsCommandInvocation(spawnSpec.command, spawnSpec.args);
      // cross-spawn resolves Windows .cmd/.bat extensions and avoids ENOENT when invoking Node-based CLIs
      // (e.g. `claude` from `npm i -g`). It still works on POSIX without changes.
      const child = crossSpawn(invocation.command, invocation.args, {
        cwd: session.workDir,
        env: filterSafeEnv({ ...process.env, ...(spawnSpec.env ?? {}) }),
        windowsVerbatimArguments: false,
        windowsHide: process.platform === "win32",
        detached: false
      }) as unknown as ChildProcessWithoutNullStreams;
      session.process = child;
      session.state = "initializing";
      child.stdin.on("error", (error) => {
        this.handleStdinWriteError(session, error);
      });
      child.stdout.on("data", (chunk: Buffer) => {
        for (const line of session.lineSplitter.push(chunk)) this.handleLine(session, line);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        for (const line of session.stderrLineSplitter.push(chunk)) this.emitRaw(session, "stderr", line);
      });
      child.on("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.emitRaw(session, "stderr", message);
        this.failSession(session, new ACPAdapterError("process_error", message, error));
      });
      const handleProcessExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (session.state === "disposed") return;
        const detail = signal !== null ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
        this.failSession(session, new ACPAdapterError("process_exit", `ACP process exited with ${detail}`, { code, signal }));
      };
      child.on("exit", handleProcessExit);
      child.on("close", handleProcessExit);
      // ACP handshake is async (initialize -> session/new). We start liveness immediately so
      // process-crash detection doesn't depend on handshake completion. Prompts that arrive
      // before session/new returns get queued; once the server-issued sessionId is known they
      // flush. If the server doesn't implement session/new (-32601), we fall back to using the
      // client-issued sessionId on the wire.
      const initId = randomUUID();
      session.pendingRequests.set(initId, {
        requestId: initId,
        method: "initialize",
        startedAt: this.now(),
        timeoutMs: 30_000,
        resolve: (result) => {
          session.agentPromptCapabilities = promptCapabilitiesFromInitializeResult(result, this.promptCapabilityOverrides);
          // authMethods in initialize does NOT require calling authenticate first.
          // AionUi's confirmed strategy: attempt session/new directly regardless of authMethods.
          // opencode returns authMethods but doesn't implement authenticate (-32603 "not implemented").
          // If credentials are stored, session/new succeeds; if not, it fails with a clear error.
          this.sendSessionNew(session);
        },
        reject: (err) => {
          if (isMethodNotFound(err)) {
            // Server doesn't implement initialize; assume legacy sessionId works.
            session.handshakeComplete = true;
            this.flushQueuedPrompts(session);
            return;
          }
          this.failSession(session, err instanceof ACPAdapterError ? err : new ACPAdapterError("initialize_failed", err instanceof Error ? err.message : String(err)));
        }
      });
      this.writeJson(session, {
        jsonrpc: "2.0",
        id: initId,
        method: "initialize",
        params: {
          protocolVersion: 1,
          // Per ACP spec, only `fs` is required. Adapters that need permission/context/terminal
          // negotiate them via session/new metadata once initialize succeeds.
          clientCapabilities: {
            fs: {
              readTextFile: session.clientCapabilities.fs.readTextFile,
              writeTextFile: session.clientCapabilities.fs.writeTextFile
            }
          }
        }
      });
      this.startLiveness(session);
      // Overall handshake timeout: if initialize+session/new doesn't complete within 60s,
      // the ACP process is considered hung and the session is failed. This catches cases where
      // the child process starts but never responds (e.g. concurrent spawn collision, CLI hang).
      session.handshakeTimeoutTimer = setTimeout(() => {
        session.handshakeTimeoutTimer = undefined;
        if (session.handshakeComplete) return;
        this.failSession(session, new ACPAdapterError("handshake_timeout", "ACP handshake (initialize→session/new) did not complete within 60s"));
      }, 60_000);
      this.markReadyUnlessFailed(session);
      return true;
    } catch (error) {
      session.state = "failed";
      throw new ACPAdapterError("spawn_failed", error instanceof Error ? error.message : String(error), error);
    }
  }

  private writeJson(session: AcpAdapterSession, message: JsonRpcMessage): void {
    const child = session.process;
    if (child !== undefined && !child.killed && child.exitCode === null && child.signalCode === null && child.stdin.writable && !child.stdin.destroyed) {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error !== null && error !== undefined) this.handleStdinWriteError(session, error);
        });
      } catch (error) {
        this.handleStdinWriteError(session, error);
      }
    }
  }

  private refreshInflightPromptTimeout(session: AcpAdapterSession): void {
    const requestId = session.inflightPromptRequestId;
    if (requestId === undefined) return;
    const pending = session.pendingRequests.get(requestId);
    if (pending === undefined || pending.method !== "session/prompt") return;
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      const current = session.pendingRequests.get(requestId);
      if (current === undefined) return;
      session.pendingRequests.delete(requestId);
      if (session.inflightPromptRequestId === requestId) {
        session.inflightPromptRequestId = undefined;
        if (!session.promptTimeoutPaused) {
          this.failSession(session, new ACPAdapterError("prompt_timeout", `ACP prompt did not complete within ${current.timeoutMs}ms of provider activity`));
          return;
        }
      }
      current.reject(new ACPAdapterError("request_timeout", `ACP request '${current.method}' did not complete within ${current.timeoutMs}ms`));
    }, pending.timeoutMs);
    pending.timer?.unref?.();
  }

  private handleStdinWriteError(session: AcpAdapterSession, error: unknown): void {
    if (session.state === "disposed" || session.state === "failed") return;
    const message = error instanceof Error ? error.message : String(error);
    this.emitRaw(session, "stderr", message);
    this.failSession(session, new ACPAdapterError("process_error", `ACP stdin write failed: ${message}`, error));
  }

  private failSession(session: AcpAdapterSession, error: ACPAdapterError): void {
    if (session.state === "disposed" || session.state === "failed") return;
    if (session.livenessTimer !== undefined) clearInterval(session.livenessTimer);
    if (session.handshakeTimeoutTimer !== undefined) clearTimeout(session.handshakeTimeoutTimer);
    const pendingRequests = [...session.pendingRequests.values()];
    session.pendingRequests.clear();
    session.inflightPromptRequestId = undefined;
    session.state = "failed";
    for (const pending of pendingRequests) {
      clearPending(pending);
      pending.reject(error);
    }
    if (session.process !== undefined && !session.process.killed && session.process.exitCode === null && session.process.signalCode === null) killProcessTree(session.process);
    if (session.runId !== undefined) this.pendingByRun.delete(session.runId);
    this.warmByRoomAgent.delete(warmKey(session.roomId, session.agentId));
    this.onSessionFailed(session, error);
    this.sessions.delete(session.acpSessionId);
  }

  private sendSessionNew(session: AcpAdapterSession): void {
    const newId = randomUUID();
    session.pendingRequests.set(newId, {
      requestId: newId,
      method: "session/new",
      startedAt: this.now(),
      timeoutMs: 30_000,
      resolve: (result) => {
        // Handshake complete — cancel the overall handshake timeout.
        if (session.handshakeTimeoutTimer !== undefined) {
          clearTimeout(session.handshakeTimeoutTimer);
          session.handshakeTimeoutTimer = undefined;
        }
        const serverSessionId = isRecord(result) && typeof result.sessionId === "string" ? result.sessionId : undefined;
        if (serverSessionId !== undefined) session.serverSessionId = serverSessionId;
        session.handshakeComplete = true;
        this.flushQueuedPrompts(session);
      },
      reject: (err) => {
        if (session.handshakeTimeoutTimer !== undefined) {
          clearTimeout(session.handshakeTimeoutTimer);
          session.handshakeTimeoutTimer = undefined;
        }
        if (isMethodNotFound(err)) {
          session.handshakeComplete = true;
          this.flushQueuedPrompts(session);
          return;
        }
        this.failSession(session, err instanceof ACPAdapterError ? err : new ACPAdapterError("session_new_failed", err instanceof Error ? err.message : String(err)));
      }
    });
    this.writeJson(session, {
      jsonrpc: "2.0",
      id: newId,
      method: "session/new",
      params: { cwd: session.workDir, mcpServers: buildMcpServers(session.mcpServer) }
    });
  }

  private markReadyUnlessFailed(session: AcpAdapterSession): void {
    if (session.state !== "failed") session.state = "ready";
  }

  private flushQueuedPrompts(session: AcpAdapterSession): void {
    const queued = session.queuedPrompts ?? [];
    delete session.queuedPrompts;
    for (const item of queued) {
      try {
        this.request(session.acpSessionId, "session/prompt", {
          sessionId: session.serverSessionId ?? session.acpSessionId,
          prompt: acpPromptContentBlocks(item.message, session.agentPromptCapabilities)
        }, { prompt: true });
      } catch (err) {
        this.emitRaw(session, "stderr", `failed to flush queued prompt: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private startLiveness(session: AcpAdapterSession): void {
    session.livenessTimer = setInterval(() => {
      if (session.state === "disposed" || session.state === "failed") return;
      // Startup can be slow for npx-backed ACP servers (notably Codex). The
      // handshake timeout covers startup hangs; liveness pings only make sense
      // after the server is ready to answer JSON-RPC requests.
      if (session.handshakeComplete !== true) return;
      // Some ACP servers (e.g. opencode) don't implement `protocol/ping`. Skip pinging once
      // the server has told us it's an unknown method — process liveness is still detected
      // via `child.exit` + stdin write errors elsewhere.
      if (session.pingDisabled === true) return;
      const requestId = randomUUID();
      const pending: AcpPendingRequest = {
        requestId,
        method: "protocol/ping",
        startedAt: this.now(),
        timeoutMs: 2_500,
        resolve: () => { session.consecutivePingMisses = 0; },
        reject: (err) => {
          // -32601 = Method not found in JSON-RPC. If the server doesn't implement ping,
          // stop sending them; don't count this as a missed liveness check.
          if (isMethodNotFound(err)) session.pingDisabled = true;
        },
        timer: setTimeout(() => {
          session.pendingRequests.delete(requestId);
          if (session.pingDisabled === true) return;
          session.consecutivePingMisses += 1;
          if (session.consecutivePingMisses >= 5) this.failSession(session, new ACPAdapterError("liveness_timeout", "ACP process missed 5 consecutive liveness pings"));
        }, 2_500)
      };
      // Do NOT unref the ping timeout — it must fire even when the event loop is busy,
      // otherwise a hung ACP process won't be detected for an arbitrarily long time.
      session.pendingRequests.set(requestId, pending);
      this.writeJson(session, { jsonrpc: "2.0", id: requestId, method: "protocol/ping", params: { sessionId: session.serverSessionId ?? session.acpSessionId } });
    }, 3_000);
    // Do NOT unref the liveness interval — it must keep firing to detect hung processes.
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

  private newSession(input: { readonly sessionId: string; readonly runId?: string; readonly roomId: string; readonly agentId: string; readonly workDir?: string; readonly mcpServer?: unknown }): AcpAdapterSession {
    return { state: "connecting", acpSessionId: input.sessionId, runId: input.runId, roomId: input.roomId, agentId: input.agentId, workDir: input.workDir ?? process.cwd(), pendingRequests: new Map(), inflightPromptRequestId: undefined, clientCapabilities: acpClientCapabilities, mcpServer: input.mcpServer, process: undefined, lineSplitter: new NdjsonLineSplitter(), stderrLineSplitter: new NdjsonLineSplitter(), stderrTail: [], livenessTimer: undefined, handshakeTimeoutTimer: undefined, consecutivePingMisses: 0, promptTimeoutPaused: false };
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

export type AdapterFileMessageService = {
  readonly createFromContent: (input: {
    readonly workspaceId: string;
    readonly roomId: string;
    readonly runId: string;
    readonly agentId: string;
    readonly messageId: string;
    readonly title: string;
    readonly path: string;
    readonly content: string;
    readonly mimeType: string;
    readonly previewKind: "markdown" | "text" | "code";
  }) => {
    readonly artifactId: string;
    readonly path: string;
    readonly name: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly previewKind: "markdown" | "text" | "code";
  };
};

export type AdapterRuntimeServices = { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly getCommandBus?: () => CommandBus | undefined; readonly permissionEngine?: PermissionEngine; readonly artifactFs?: AdapterArtifactFSBoundary; readonly fileMessageService?: AdapterFileMessageService; readonly briefResolver?: BriefResolver; readonly now?: () => number };

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
  const attachments = message.attachments?.length
    ? `\n\n<agenthub-attachments>\n${message.attachments.map(serializeAttachmentSummary).join("\n")}\n</agenthub-attachments>`
    : "";
  return `${header}\n${message.content}${attachments}\n</agenthub-message>`;
}

function serializeAttachmentSummary(attachment: NonNullable<AdapterMessage["attachments"]>[number], index: number): string {
  const localPath = localPathForAttachment(attachment);
  return `- ${attachment.type} ${index + 1}: ${attachment.name} (${attachment.mimeType})${localPath !== undefined ? ` [local path: ${localPath}]` : ""}`;
}

export function acpPromptContentBlocks(message: AdapterMessage, capabilities?: AcpPromptCapabilities): AcpPromptContentBlock[] {
  void capabilities;
  const blocks: AcpPromptContentBlock[] = [{ type: "text", text: serializePrompt(message) }];
  for (const attachment of message.attachments ?? []) {
    if (attachment.type === "image") {
      blocks.push({ type: "image", mimeType: attachment.mimeType, data: attachment.data, ...(attachment.uri !== undefined ? { uri: attachment.uri } : {}) });
    }
    if (attachment.type === "audio") {
      blocks.push({ type: "audio", mimeType: attachment.mimeType, data: attachment.data });
    }
    if (attachment.type === "file" && shouldSendAcpFileResource(attachment)) {
      blocks.push({ type: "resource", resource: resourceContentBlock(attachment) });
    }
  }
  return blocks;
}

function shouldSendAcpFileResource(attachment: Extract<NonNullable<AdapterMessage["attachments"]>[number], { readonly type: "file" }>): boolean {
  if (isTextResourceAttachment(attachment)) return true;
  return localPathForAttachment(attachment) === undefined;
}

function localPathForAttachment(attachment: NonNullable<AdapterMessage["attachments"]>[number]): string | undefined {
  if (!("localPath" in attachment)) return undefined;
  return typeof attachment.localPath === "string" && attachment.localPath.length > 0 ? attachment.localPath : undefined;
}

function resourceContentBlock(attachment: Extract<NonNullable<AdapterMessage["attachments"]>[number], { readonly type: "file" }>): { readonly uri: string; readonly mimeType?: string; readonly text: string } | { readonly uri: string; readonly mimeType?: string; readonly blob: string } {
  if (isTextResourceAttachment(attachment)) {
    return { uri: attachment.uri, mimeType: attachment.mimeType, text: Buffer.from(attachment.data, "base64").toString("utf8") };
  }
  return { uri: attachment.uri, mimeType: attachment.mimeType, blob: attachment.data };
}

function isTextResourceAttachment(attachment: { readonly name: string; readonly mimeType: string }): boolean {
  const mime = attachment.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  const name = attachment.name.toLowerCase();
  return mime.startsWith("text/")
    || mime.includes("json")
    || mime.includes("xml")
    || mime.includes("yaml")
    || mime.includes("javascript")
    || mime.includes("typescript")
    || name.endsWith(".md")
    || name.endsWith(".markdown")
    || name.endsWith(".txt")
    || name.endsWith(".json")
    || name.endsWith(".xml")
    || name.endsWith(".yaml")
    || name.endsWith(".yml")
    || name.endsWith(".js")
    || name.endsWith(".ts")
    || name.endsWith(".tsx")
    || name.endsWith(".jsx")
    || name.endsWith(".css")
    || name.endsWith(".html");
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

function permissionResponseForProviderRequest(params: unknown): { readonly outcome: { readonly outcome: "selected"; readonly optionId: string } | { readonly outcome: "cancelled" } } {
  const options = permissionOptions(params);
  const agentHubRoomRequest = isAgentHubRoomPermissionRequest(params);
  const preferred = agentHubRoomRequest
    ? selectPermissionOption(options, ["allow_once", "allow_always"]) ?? firstNonRejectOption(options)
    : selectPermissionOption(options, ["reject_once", "reject_always"]);
  if (preferred !== undefined) return { outcome: { outcome: "selected", optionId: preferred.optionId } };
  if (agentHubRoomRequest) return { outcome: { outcome: "selected", optionId: "allow_once" } };
  return { outcome: { outcome: "cancelled" } };
}

function permissionOptions(params: unknown): Array<{ readonly optionId: string; readonly kind?: string; readonly name?: string }> {
  const root = isRecord(params) ? params : {};
  const rawOptions = rawPermissionOptions(root.options) ?? rawPermissionOptions(root.permissionOptions) ?? [];
  const options: Array<{ readonly optionId: string; readonly kind?: string; readonly name?: string }> = [];
  for (const rawOption of rawOptions) {
    if (typeof rawOption === "string" && rawOption.length > 0) {
      options.push({ optionId: rawOption, kind: normalizePermissionToken(rawOption), name: rawOption });
      continue;
    }
    if (!isRecord(rawOption)) continue;
    const optionId = stringField(rawOption, "optionId") ?? stringField(rawOption, "option_id") ?? stringField(rawOption, "id") ?? stringField(rawOption, "value");
    if (optionId === undefined) continue;
    const kind = stringField(rawOption, "kind") ?? stringField(rawOption, "type") ?? stringField(rawOption, "permissionKind");
    const name = stringField(rawOption, "name") ?? stringField(rawOption, "label") ?? stringField(rawOption, "title");
    options.push({
      optionId,
      ...(kind !== undefined ? { kind: normalizePermissionToken(kind) } : {}),
      ...(name !== undefined ? { name } : {})
    });
  }
  return options;
}

function selectPermissionOption(options: ReadonlyArray<{ readonly optionId: string; readonly kind?: string; readonly name?: string }>, kinds: readonly string[]): { readonly optionId: string } | undefined {
  const normalizedKinds = kinds.map(normalizePermissionToken);
  for (const kind of normalizedKinds) {
    const exact = options.find((option) => normalizePermissionToken(option.kind ?? "") === kind);
    if (exact !== undefined) return exact;
  }
  const patterns = normalizedKinds.flatMap((kind) => [kind, kind.replace(/_/gu, " "), kind.replace(/_/gu, "-")]);
  return options.find((option) => {
    const haystack = normalizePermissionToken(`${option.optionId} ${option.name ?? ""}`);
    return patterns.some((pattern) => haystack.includes(normalizePermissionToken(pattern)));
  });
}

function firstNonRejectOption(options: ReadonlyArray<{ readonly optionId: string; readonly kind?: string; readonly name?: string }>): { readonly optionId: string } | undefined {
  return options.find((option) => {
    const haystack = normalizePermissionToken(`${option.optionId} ${option.kind ?? ""} ${option.name ?? ""}`);
    return !haystack.includes("reject") && !haystack.includes("deny");
  });
}

function rawPermissionOptions(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return undefined;
  return Object.entries(value).map(([id, option]) => isRecord(option) ? { id, ...option } : option);
}

function normalizePermissionToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[\s-]+/gu, "_")
    .toLowerCase();
}

function isAgentHubRoomPermissionRequest(params: unknown): boolean {
  const root = isRecord(params) ? params : {};
  const toolCall = isRecord(root.toolCall) ? root.toolCall : isRecord(root.tool_call) ? root.tool_call : root;
  const rawInput = isRecord(toolCall.rawInput)
    ? toolCall.rawInput
    : isRecord(toolCall.input)
      ? toolCall.input
      : isRecord(toolCall.arguments)
        ? toolCall.arguments
        : {};
  const server = stringField(rawInput, "server") ?? stringField(toolCall, "server");
  const title = stringField(toolCall, "title") ?? stringField(toolCall, "name") ?? stringField(root, "title") ?? stringField(root, "name");
  const toolName = stringField(rawInput, "tool") ?? stringField(toolCall, "tool");
  if (server === "agenthub-room") return true;
  if (toolName !== undefined && toolName.startsWith("agenthub-room/")) return true;
  if (title !== undefined && /\bagenthub-room\//u.test(title)) return true;
  return containsAgentHubRoomReference(params);
}

function containsAgentHubRoomReference(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === "string") return /\bagenthub-room(?:\/|$)/u.test(value);
  if (Array.isArray(value)) return value.some((item) => containsAgentHubRoomReference(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).some((item) => containsAgentHubRoomReference(item, depth + 1));
}

function clearPending(pending: AcpPendingRequest): void {
  if (pending.timer !== undefined) clearTimeout(pending.timer);
}

/**
 * Translate ACP v1 `session/update` payloads into the legacy event method/params shape that
 * subclasses' mapProviderEvent expects. Returns undefined for updates that have no chat-side
 * side effect (e.g. usage_update, available_commands_update).
 */
function translateSessionUpdate(update: Record<string, unknown>): { method: string; params: Record<string, unknown> } | undefined {
  const kind = update.sessionUpdate;
  switch (kind) {
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const content = isRecord(update.content) ? update.content : undefined;
      const text = content !== undefined && typeof content.text === "string" ? content.text : "";
      return { method: "message/delta", params: { delta: text, kind: kind === "agent_thought_chunk" ? "thought" : "message" } };
    }
    case "tool_call": {
      return { method: "tool/pre_use", params: {
        toolCallId: typeof update.toolCallId === "string" ? update.toolCallId : (typeof update.id === "string" ? update.id : undefined),
        name: typeof update.title === "string" ? update.title : (typeof update.kind === "string" ? update.kind : "unknown"),
        input: update.rawInput ?? update.locations ?? update.content ?? {}
      } };
    }
    case "tool_call_update": {
      const status = typeof update.status === "string" ? update.status : "completed";
      return { method: "tool/post_use", params: {
        toolCallId: typeof update.toolCallId === "string" ? update.toolCallId : undefined,
        output: update.rawOutput ?? update.content ?? {},
        ok: status !== "failed"
      } };
    }
    case "plan":
      return { method: "context.snapshot", params: { snapshot: { kind: "plan", entries: update.entries ?? [] } } };
    case "user_message_chunk":
    case "config_option_update":
    case "available_commands_update":
    case "usage_update":
    case "current_mode_update":
      return undefined;
    default:
      return { method: `session/update/${String(kind)}`, params: update };
  }
}

function isMethodNotFound(err: AdapterError): boolean {
  if (typeof err === "object" && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (code === -32601 || code === "method_not_found") return true;
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && /method not found|unknown method/i.test(message)) return true;
  }
  return false;
}

function promptCapabilitiesFromInitializeResult(result: unknown, overrides?: AcpPromptCapabilityOverrides): AcpPromptCapabilities {
  const root = isRecord(result) ? result : {};
  const agentCapabilities = isRecord(root.agentCapabilities)
    ? root.agentCapabilities
    : isRecord(root.capabilities) ? root.capabilities : {};
  const promptCapabilities = isRecord(agentCapabilities.promptCapabilities)
    ? agentCapabilities.promptCapabilities
    : isRecord(root.promptCapabilities) ? root.promptCapabilities : {};
  return {
    image: overrides?.image ?? promptCapabilities.image === true,
    audio: overrides?.audio ?? promptCapabilities.audio === true,
    embeddedContext: overrides?.embeddedContext ?? promptCapabilities.embeddedContext === true
  };
}

function wrapFileReadResult(pending: AcpPendingRequest, result: unknown): unknown {
  if (!isFileReadMethod(pending.method)) return result;
  if (typeof result === "string") return wrapExternalContent("unknown", result);
  if (!isRecord(result)) return result;

  const path = stringField(result, "path") ?? stringField(result, "filePath") ?? stringField(result, "uri") ?? "unknown";
  for (const key of ["content", "text", "data"] as const) {
    const value = result[key];
    if (typeof value === "string") return { ...result, [key]: wrapExternalContent(path, value) };
  }
  return result;
}

function isFileReadMethod(method: string): boolean {
  return method === "fs/read" || method === "fs.read" || method === "fs.readTextFile" || method.endsWith("/readTextFile") || method.endsWith(".readTextFile");
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function providerAllowsConcurrentPrompt(manifest: AgentAdapterManifest): boolean {
  const maybe = manifest as AgentAdapterManifest & { readonly acp?: { readonly concurrentPrompt?: boolean } };
  return maybe.acp?.concurrentPrompt === true;
}

function warmKey(roomId: string, agentId: string): string {
  return `${roomId}:${agentId}`;
}

function toAdapterError(error: unknown): AdapterError {
  if (error instanceof ACPAdapterError) return error;
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") return error as AdapterError;
  return new ACPAdapterError("adapter_error", error instanceof Error ? error.message : String(error), error);
}

function filterSafeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    // Only strip AgentHub-internal secrets that must not leak to child agent processes.
    // Provider API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) must pass through
    // so that opencode, claude-code, and other adapters can authenticate with their providers.
    if (/^AGENTHUB_TOKEN$/i.test(key)) continue;
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
  if (process.platform !== "win32") return { command, args: [...args] };
  // Already a .cmd/.bat: route through cmd.exe so it actually executes.
  if (/\.(cmd|bat)$/iu.test(command)) return { command: "cmd.exe", args: ["/c", command, ...args] };
  // Bare command: cmd.exe will resolve PATHEXT and find `command.cmd` / `command.exe`.
  if (!/[\\/]/.test(command) && !/\.[a-z]+$/iu.test(command)) {
    return { command: "cmd.exe", args: ["/c", command, ...args] };
  }
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

/**
 * Convert a RoomMcpStdioConfig into the mcpServers array expected by ACP session/new.
 * zMcpServerStdio schema requires: { name, command, args: string[], env: [{name,value}][] }
 * All four fields are required (no optional).
 */
function buildMcpServers(mcpServer: unknown): unknown[] {
  if (!isRecord(mcpServer)) return [];
  if (typeof mcpServer["command"] !== "string") return [];
  // env must be [{name, value}][] — keep as-is if already in that shape, else empty array
  const envArray: Array<{ name: string; value: string }> = [];
  if (Array.isArray(mcpServer["env"])) {
    for (const item of mcpServer["env"]) {
      if (isRecord(item) && typeof item["name"] === "string" && typeof item["value"] === "string") {
        envArray.push({ name: item["name"], value: item["value"] });
      }
    }
  }
  return [{
    name: typeof mcpServer["name"] === "string" ? mcpServer["name"] : "agenthub-room",
    command: mcpServer["command"],
    args: Array.isArray(mcpServer["args"]) ? mcpServer["args"] : [],
    env: envArray,
  }];
}

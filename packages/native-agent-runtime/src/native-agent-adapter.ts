import { randomUUID } from "node:crypto";

import { stepCountIs, streamText, type LanguageModel, type ToolSet } from "ai";
import type { EventBus, PublishInput } from "../../bus/src/index.ts";
import type { AgentHubDatabase } from "../../db/src/index.ts";
import { AdapterBridge, buildFirstWakePrompt, buildPlanPhasePrompt, buildRunPrompt, persistAssistantPublicMessage, type AdapterArtifactFSBoundary, type FileMessageService, type RunLifecycleService, type RunRow } from "../../orchestrator/src/index.ts";
import { nameToSlug } from "../../orchestrator/src/mention-parser.ts";
import type { AgentAdapterManifest } from "../../protocol/src/index.ts";
import type { PermissionEngine, PermissionResource } from "../../permissions/src/index.ts";

import { convertMcpToolsToAiSdkTools, type McpToolDefinition, type McpToolExecutor } from "./mcp-tool-converter.ts";
import { roomMcpTools } from "./room-mcp-tools.ts";
import { resolveProvider, type ModelConfigRow } from "./provider-registry.ts";

type RoomMcpServerLike = {
  readonly callTool: (name: string, input: unknown, ctx: { readonly roomId: string; readonly runId: string; readonly agentId: string }) => Promise<{ readonly ok: boolean; readonly data?: unknown; readonly error?: { readonly code?: string; readonly message?: string; readonly details?: unknown } }>;
};

export const nativeAgentManifest: AgentAdapterManifest = {
  id: "native",
  name: "Native Agent Adapter",
  runtimeKind: "native",
  provider: "custom",
  capabilities: {
    canStreamTokens: true,
    canEmitToolEvents: true,
    canEmitPermissionEvents: true,
    canEmitSubagentEvents: false,
    canInjectAtStart: true,
    canInjectNextTurn: true,
    canInjectRuntime: true,
    canCancel: true,
    canReadContextSnapshot: false,
    canRestoreSession: false,
    supportsMcp: true,
    supportsHooks: false,
    supportsWorkspaceIsolation: true
  },
  reliability: {
    level: "structured",
    eventSource: "native_event_stream",
    crashRecovery: "restartable",
    parseFailure: "skip_event",
    maxRestartAttempts: 0
  },
  context: {
    startupInjection: true,
    runtimeInjection: true,
    injectionMode: "immediate",
    canPullExternalContext: true,
    canPushLedgerUpdates: true
  },
  workspace: { mode: "shadow_buffer" }
};

export type NativeAgentAdapterOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly lifecycle: RunLifecycleService;
  readonly permissions?: PermissionEngine;
  readonly modelConfig: ModelConfigRow;
  readonly apiKey?: string;
  readonly getModelConfigForRun?: (run: RunRow) => ModelConfigRow;
  readonly getApiKeyForRun?: (run: RunRow) => Promise<string | undefined> | string | undefined;
  readonly getRoomMcpServer?: () => RoomMcpServerLike | undefined;
  readonly artifactFs?: AdapterArtifactFSBoundary;
  readonly mcpTools?: readonly McpToolDefinition[];
  readonly mcpToolExecutor?: McpToolExecutor;
  readonly fileMessageService?: FileMessageService;
  readonly tools?: ToolSet;
  readonly onSessionEndedWithoutCompletion?: (taskId: string) => void | Promise<void>;
  readonly onPlanPhaseEnded?: (runId: string, planText?: string) => void | Promise<void>;
  readonly getSkillsBlock?: (runId: string) => string | undefined;
  readonly now?: () => number;
};

type ActiveRunState = {
  readonly controller: AbortController;
  readonly bridge: AdapterBridge;
  readonly run: RunRow;
  readonly permissionSummary: PermissionDecisionSummary[];
};

type PermissionDecisionSummary = {
  readonly resource: PermissionResource;
  readonly decision: "allowed" | "denied" | "expired";
  readonly modelConfigId: string;
};

export class NativeAgentAdapter {
  readonly manifest = nativeAgentManifest;
  private readonly now: () => number;
  private readonly activeRuns = new Map<string, ActiveRunState>();
  private readonly permissionCache = new Map<string, { readonly decision: "allowed" | "denied" | "expired"; readonly summary: PermissionDecisionSummary }>();
  private readonly assistantTextByRun = new Map<string, string>();

  constructor(private readonly options: NativeAgentAdapterOptions) {
    this.now = options.now ?? Date.now;
  }

  async runManaged(run: RunRow, mcpTools: readonly McpToolDefinition[] = this.options.mcpTools ?? roomMcpTools): Promise<void> {
    const controller = new AbortController();
    const bridge = new AdapterBridge({
      runId: run.id,
      workspaceId: run.workspace_id,
      roomId: run.room_id,
      agentId: run.agent_id,
      lifecycle: this.options.lifecycle,
      eventBus: this.options.eventBus,
      database: this.options.database,
      now: this.now,
      ...(run.wake_reason !== null ? { wakeReason: run.wake_reason } : {}),
      ...(this.options.onSessionEndedWithoutCompletion !== undefined ? { onSessionEndedWithoutCompletion: this.options.onSessionEndedWithoutCompletion } : {}),
      ...(run.task_id !== null ? { taskId: run.task_id } : {}),
      messageId: `msg_${run.id}`,
      ...(run.workspace_mode !== null ? { workspaceMode: run.workspace_mode } : {}),
      terminalEnabled: false,
      ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {})
    });
    this.activeRuns.set(run.id, { controller, bridge, run, permissionSummary: [] });
    const sessionId = `native-${run.id}`;
    bridge.handle({ type: "session.opened", sessionId });
    let modelConfig = this.options.modelConfig;
    let apiKey = this.options.apiKey;

    try {
      modelConfig = this.options.getModelConfigForRun?.(run) ?? this.options.modelConfig;
      apiKey = this.options.getApiKeyForRun !== undefined ? await this.options.getApiKeyForRun(run) : this.options.apiKey;
      const permission = await this.checkModelPermission(run, modelConfig);
      if (permission.decision !== "allowed") {
        this.failWithPermissionDenied(run, permission.decision);
        return;
      }

      const providerModel = resolveProvider(modelConfig, apiKey) as LanguageModel;
      const mcpToolExecutor = this.options.getRoomMcpServer !== undefined
        ? async (name: string, input: unknown): Promise<import("./mcp-tool-converter.ts").McpToolResult> => {
            const server = this.options.getRoomMcpServer?.();
            if (!server) return { ok: false as const, error: { code: "tool_not_found", message: "No MCP server", details: input } };
            const roomId = run.room_id ?? "";
            const agentId = run.agent_id ?? "";
            if (roomId.length === 0 || agentId.length === 0) return { ok: false as const, error: { code: "tool_not_found", message: "No MCP server", details: input } };
            const result = await server.callTool(name, input, { roomId, runId: run.id, agentId });
            if (result.ok) return { ok: true as const, data: result.data };
            const err = result.error;
            return { ok: false as const, error: { code: String(err?.code ?? "tool_execution_failed"), message: String(err?.message ?? "MCP tool failed"), details: input } };
          }
        : this.options.mcpToolExecutor ?? (async (name: string, input: unknown) => ({ ok: false as const, error: { code: "tool_not_found", message: `No MCP executor configured for '${name}'`, details: input } }));
      const mcpToolSet = convertMcpToolsToAiSdkTools(
        mcpTools,
        mcpToolExecutor,
        bridge
      );
      const tools = {
        ...(this.options.tools ?? {}),
        ...mcpToolSet
      } satisfies ToolSet;
      const prompt = this.loadRunPrompt(run);
      const messageId = `msg_${run.id}`;
      const result = streamText({
        model: providerModel,
        ...(prompt.system !== undefined ? { system: prompt.system } : {}),
        messages: [{ role: "user" as const, content: prompt.input }],
        abortSignal: controller.signal,
        tools,
        stopWhen: stepCountIs(5)
      });
      const usagePromise = result.usage;
      void usagePromise.catch(() => undefined);

      for await (const chunk of result.fullStream) {
        if (chunk.type === "error") {
          throw normalizeStreamError(chunk.error);
        }
        if (chunk.type === "text-delta") {
          const delta = chunk.text;
          if (delta.length === 0) continue;
          this.appendAssistantText(run, messageId, delta, bridge);
        }
      }

      const finalText = this.completeAssistantText(run, messageId);
      const usage = await usagePromise;
      bridge.handle({ type: "session.ended", sessionId, reason: "completed", cost: costFromUsage(usage, modelConfig.model) });
      if (run.wake_reason === "plan") void Promise.resolve(this.options.onPlanPhaseEnded?.(run.id, finalText));
    } catch (error) {
      if (isAbortError(error)) {
        this.completeAssistantText(run, `msg_${run.id}`);
        this.options.lifecycle.markCancelling(null, run.id);
        bridge.handle({ type: "session.ended", sessionId, reason: "cancelled", cost: zeroCost(modelConfig.model) });
        return;
      }
      this.completeAssistantText(run, `msg_${run.id}`);
      this.options.lifecycle.fail(null, run.id, "native_agent_runtime_error", classifyFailureClass(error), error instanceof Error ? error.message : String(error));
    } finally {
      this.publishPermissionSummary(run.id);
      this.activeRuns.delete(run.id);
    }
  }

  async cancelManagedRun(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (active === undefined) return;
    this.options.lifecycle.markCancelling(null, runId);
    active.controller.abort(new DOMException("Cancelled", "AbortError"));
  }

  disposeAllRuns(): void {
    for (const active of this.activeRuns.values()) active.controller.abort(new DOMException("Cancelled", "AbortError"));
    this.activeRuns.clear();
    this.permissionCache.clear();
  }

  private async checkModelPermission(run: RunRow, modelConfig: ModelConfigRow): Promise<{ readonly decision: "allowed" | "denied" | "expired" }> {
    const cacheKey = `${run.id}:${modelConfig.id}`;
    const cached = this.permissionCache.get(cacheKey);
    if (cached) {
      const active = this.activeRuns.get(run.id);
      if (active) active.permissionSummary.push(cached.summary);
      return { decision: cached.decision };
    }

    const resource: PermissionResource = { type: "model.api_call", provider: modelConfig.provider as "openai" | "anthropic" | "google" | "openai-compatible" | "ollama" };
    const decided = this.options.permissions?.check({
      workspaceId: run.workspace_id,
      ...(run.room_id !== null ? { roomId: run.room_id } : {}),
      ...(run.agent_id !== null ? { agentId: run.agent_id } : {}),
      runId: run.id,
      resource
    }) ?? { status: "allow", reason: "default_allow" };

    let decision: "allowed" | "denied" | "expired";
    if (decided.status === "allow") {
      decision = "allowed";
    } else if (decided.status === "deny") {
      decision = "denied";
      } else if (decided.status === "ask") {
        this.options.lifecycle.markWaitingPermission(null, run.id, decided.requestId);
        const resolution = await decided.promise;
        decision = resolution.decision === "allowed" ? "allowed" : resolution.decision === "denied" ? "denied" : "expired";
        // Use ref-count exit path instead of direct markRunning
        this.options.lifecycle.markPermissionResolved(null, run.id, decided.requestId, decision);
      } else {
        decision = "expired";
      }
    const summary: PermissionDecisionSummary = { resource, decision, modelConfigId: modelConfig.id };
    this.permissionCache.set(cacheKey, { decision, summary });
    const active = this.activeRuns.get(run.id);
    if (active) active.permissionSummary.push(summary);
    return { decision };
  }

  private failWithPermissionDenied(run: RunRow, decision: "denied" | "expired"): void {
    this.options.lifecycle.fail(null, run.id, "model_api_call_denied", decision === "denied" ? "permission_denied" : "permission_expired", "model.api_call permission denied");
  }

  private publishPermissionSummary(runId: string): void {
    const active = this.activeRuns.get(runId);
    if (!active || active.permissionSummary.length === 0) return;
    this.options.eventBus.publish({
      id: `permission-summary-${runId}`,
      type: "permission.run_summary",
      schemaVersion: 1,
      workspaceId: active.run.workspace_id,
      ...(active.run.room_id !== null ? { roomId: active.run.room_id } : {}),
      ...(active.run.agent_id !== null ? { agentId: active.run.agent_id } : {}),
      runId,
      payload: { runId, decisions: active.permissionSummary },
      createdAt: this.now()
    });
  }

  private appendAssistantText(run: RunRow, messageId: string, delta: string, bridge: AdapterBridge): void {
    const existing = this.assistantTextByRun.get(run.id);
    if (existing === undefined) {
      if (run.wake_reason !== "plan") this.persistAssistantMessageStart(run, messageId);
      this.assistantTextByRun.set(run.id, delta);
    } else {
      this.assistantTextByRun.set(run.id, existing + delta);
    }
    if (run.wake_reason !== "plan") this.publishRunEvent(run, "message.part.delta", { messageId, text: delta });
    bridge.onMessageDelta();
  }

  private completeAssistantText(run: RunRow, messageId: string): string | undefined {
    const text = this.assistantTextByRun.get(run.id);
    if (text === undefined) return undefined;
    this.assistantTextByRun.delete(run.id);
    if (run.wake_reason !== "plan") this.persistAssistantMessageEnd(run, messageId, text);
    return text;
  }

  private persistAssistantMessageStart(run: RunRow, messageId: string): void {
    const now = this.now();
    this.options.database.sqlite.prepare(
      `INSERT OR IGNORE INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'agent', ?, ?, 'assistant', 'streaming', NULL, 'immediate', NULL, ?, ?, NULL)`
    ).run(messageId, run.workspace_id, run.room_id, run.agent_id, run.id, now, now);
    this.publishRunEvent(run, "message.created", { messageId, role: "assistant", senderId: run.agent_id, runId: run.id });
  }

  private persistAssistantMessageEnd(run: RunRow, messageId: string, text: string): void {
    persistAssistantPublicMessage({
      database: this.options.database,
      eventBus: this.options.eventBus,
      run,
      messageId,
      text,
      ...(this.options.fileMessageService !== undefined ? { fileMessageService: this.options.fileMessageService } : {}),
      now: this.now
    });
  }

  private publishRunEvent(run: RunRow, type: PublishInput["type"], payload: Record<string, unknown>): void {
    this.options.eventBus.publish({
      id: randomUUID(),
      type,
      schemaVersion: 1,
      workspaceId: run.workspace_id,
      roomId: run.room_id,
      ...(run.task_id !== null ? { taskId: run.task_id } : {}),
      runId: run.id,
      agentId: run.agent_id,
      payload,
      createdAt: this.now()
    } satisfies PublishInput);
  }

  private loadRunPrompt(run: RunRow): { readonly system?: string; readonly input: string } {
    const system = run.wake_reason === "plan"
      ? buildPlanPhasePrompt(buildPlanLeaderPromptParams(run, this.options.database))
      : buildFirstWakePrompt(run.id, run.agent_id, run.room_id, this.options.database);
    const skillsBlock = this.options.getSkillsBlock?.(run.id);
    const rendered = buildRunPrompt(run, this.options.database, { now: this.now, ...(skillsBlock !== undefined ? { skillsBlock } : {}) });
    // Strip the system prompt from the user-turn input to avoid duplication.
    // buildRunPrompt joins parts with "\n\n---\n\n"; the prompt block may appear after
    // skillsBlock / missionBrief / priorProgress depending on wake reason and room mode.
    const separator = "\n\n---\n\n";
    let input = rendered;
    let separatedSystem = false;
    if (system !== undefined && system.length > 0) {
      const systemWithSep = `${system}${separator}`;
      const idx = rendered.indexOf(systemWithSep);
      if (idx !== -1) {
        input = rendered.slice(0, idx) + rendered.slice(idx + systemWithSep.length);
        if (input.startsWith(separator)) input = input.slice(separator.length);
        separatedSystem = true;
      } else if (rendered === system) {
        input = "";
        separatedSystem = true;
      }
    }
    return { ...(system !== undefined ? { system } : {}), input: separatedSystem ? input : rendered };
  }
}

type NativePlanLeaderPromptParams = Parameters<typeof buildPlanPhasePrompt>[0];

function buildPlanLeaderPromptParams(run: RunRow, database: AgentHubDatabase): NativePlanLeaderPromptParams {
  const participants = database.sqlite.prepare(
    `SELECT rp.participant_id AS agentId, rp.role, ap.name, ap.adapter_id AS adapterId, COALESCE(ap2.state, 'offline') AS presence
            , r.capabilities AS capabilities
      FROM room_participants rp
      LEFT JOIN agent_profiles ap ON ap.id = rp.participant_id
      LEFT JOIN agent_presence ap2 ON ap2.room_id = rp.room_id AND ap2.agent_id = rp.participant_id
      LEFT JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
      LEFT JOIN roles r ON r.id = ab.role_id
      WHERE rp.room_id = ? AND rp.participant_type = 'agent'
      ORDER BY rp.joined_at ASC`
  ).all(run.room_id) as Array<{ readonly agentId: string; readonly role: string; readonly name: string | null; readonly adapterId: string | null; readonly presence: string; readonly capabilities: string | null }>;

  return {
    agentName: participants.find((participant) => participant.agentId === run.agent_id)?.name ?? run.agent_id,
    teammates: participants
      .filter((participant) => participant.agentId !== run.agent_id)
      .map((participant) => ({
        agentId: participant.agentId,
        name: participant.name ?? participant.agentId,
        slug: nameToSlug(participant.name ?? participant.agentId),
        role: participant.role,
        presence: participant.presence,
        capabilities: parseCapabilities(participant.capabilities)
      }))
  };
}

function parseCapabilities(value: string | null): string[] {
  if (value === null) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function costFromUsage(usage: unknown, modelId: string) {
  const record = usage as Record<string, unknown>;
  const inputTokenDetails = record.inputTokenDetails as Record<string, unknown> | undefined;
  const inputTokens = Number(record.inputTokens ?? 0);
  const outputTokens = Number(record.outputTokens ?? 0);
  const cachedTokens = Number(inputTokenDetails?.cacheReadTokens ?? record.cachedInputTokens ?? 0);
  const costUsd = Math.round((((inputTokens / 1_000_000) * 3) + ((outputTokens / 1_000_000) * 15)) * 1_000_000) / 1_000_000;
  return { inputTokens, outputTokens, cachedTokens, costUsd, modelId };
}

function zeroCost(modelId: string) {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && /abort|cancel/i.test(error.message);
}

function classifyFailureClass(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/api key|auth|credentials|unsupported-provider|not found|model_not_found|no available channel|unknown model|does not exist/i.test(message)) return "configuration" as const;
  return "retryable_visible" as const;
}

function normalizeStreamError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error(JSON.stringify(error));
}

import { streamText, type LanguageModel, type ToolSet } from "ai";
import type { EventBus } from "../../bus/src/index.ts";
import type { AgentHubDatabase } from "../../db/src/index.ts";
import { AdapterBridge, type AdapterArtifactFSBoundary, type RunLifecycleService, type RunRow } from "../../orchestrator/src/index.ts";
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
  readonly tools?: ToolSet;
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
      ...(run.task_id !== null ? { taskId: run.task_id } : {}),
      messageId: `msg_${run.id}`,
      ...(run.workspace_mode !== null ? { workspaceMode: run.workspace_mode } : {}),
      terminalEnabled: false,
      ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {})
    });
    this.activeRuns.set(run.id, { controller, bridge, run, permissionSummary: [] });
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
      const userText = this.loadLatestUserText(run.room_id);
      const rolePrompt = this.loadRolePrompt(run.room_id, run.agent_id);
      const result = streamText({
        model: providerModel,
        ...(rolePrompt !== undefined ? { system: rolePrompt } : {}),
        messages: [{ role: "user" as const, content: userText ?? `Run ${run.id}` }],
        abortSignal: controller.signal,
        tools
      });

      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          const delta = chunk.text;
          if (delta.length === 0) continue;
          bridge.handle({ type: "message.part.delta", messageId: `msg_${run.id}`, delta });
        }
      }

      const usage = await result.usage;
      bridge.handle({ type: "session.ended", sessionId: `native-${run.id}`, reason: "completed", cost: costFromUsage(usage, modelConfig.model) });
    } catch (error) {
      if (isAbortError(error)) {
        this.options.lifecycle.markCancelling(null, run.id);
        bridge.handle({ type: "session.ended", sessionId: `native-${run.id}`, reason: "cancelled", cost: zeroCost(modelConfig.model) });
        return;
      }
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
      if (decision === "allowed") {
        this.options.lifecycle.markRunning(null, run.id, `native-${run.id}`);
      }
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

  private loadLatestUserText(roomId: string | null): string | undefined {
    if (roomId === null) return undefined;
    const row = this.options.database.sqlite
      .prepare(
        `SELECT mp.payload AS payload
         FROM messages m
         JOIN message_parts mp ON mp.message_id = m.id
         WHERE m.room_id = ? AND m.role = 'user' AND m.status = 'completed'
         ORDER BY m.created_at DESC, mp.seq ASC
         LIMIT 1`
      )
      .get(roomId) as { readonly payload: string } | undefined;
    if (row === undefined) return undefined;
    try {
      const parsed = JSON.parse(row.payload) as { readonly text?: unknown };
      return typeof parsed.text === "string" && parsed.text.length > 0 ? parsed.text : undefined;
    } catch {
      return undefined;
    }
  }

  private loadRolePrompt(roomId: string | null, agentId: string | null): string | undefined {
    if (roomId === null || agentId === null) return undefined;
    const row = this.options.database.sqlite
      .prepare(
        `SELECT r.prompt AS prompt
         FROM room_participants rp
         JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
         JOIN roles r ON r.id = ab.role_id
         WHERE rp.room_id = ? AND rp.participant_id = ? AND rp.participant_type = 'agent'
         LIMIT 1`
      )
      .get(roomId, agentId) as { readonly prompt: string } | undefined;
    return row?.prompt;
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
  if (/api key|auth|credentials|unsupported-provider|not found/i.test(message)) return "configuration" as const;
  return "retryable_visible" as const;
}

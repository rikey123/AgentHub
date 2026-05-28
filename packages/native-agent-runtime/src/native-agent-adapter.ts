import { streamText, type LanguageModel, type ToolSet } from "ai";
import type { EventBus } from "../../bus/src/index.ts";
import type { AgentHubDatabase } from "../../db/src/index.ts";
import { AdapterBridge, type AdapterArtifactFSBoundary, type RunLifecycleService, type RunRow } from "../../orchestrator/src/index.ts";
import type { AgentAdapterManifest } from "../../protocol/src/index.ts";
import type { PermissionEngine } from "../../permissions/src/index.ts";

import { convertMcpToolsToAiSdkTools, type McpToolDefinition, type McpToolExecutor } from "./mcp-tool-converter.ts";
import { roomMcpTools } from "./room-mcp-tools.ts";
import { resolveProvider, type ModelConfigRow } from "./provider-registry.ts";

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
  readonly resource: { readonly type: "model.api_call"; readonly provider: string };
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

    try {
      const permission = this.checkModelPermission(run);
      if (permission.decision !== "allowed") {
        this.failWithPermissionDenied(run, permission.decision);
        return;
      }

      const providerModel = resolveProvider(this.options.modelConfig, this.options.apiKey) as LanguageModel;
      const mcpToolSet = convertMcpToolsToAiSdkTools(
        mcpTools,
        this.options.mcpToolExecutor ?? (async (name: string, input: unknown) => ({ ok: false as const, error: { code: "tool_not_found", message: `No MCP executor configured for '${name}'`, details: input } })),
        bridge
      );
      const tools = {
        ...(this.options.tools ?? {}),
        ...mcpToolSet
      } satisfies ToolSet;
      const result = streamText({
        model: providerModel,
        prompt: `Run ${run.id} for agent ${run.agent_id}`,
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
      bridge.handle({ type: "session.ended", sessionId: `native-${run.id}`, reason: "completed", cost: costFromUsage(usage, this.options.modelConfig.model) });
    } catch (error) {
      if (isAbortError(error)) {
        this.options.lifecycle.markCancelling(null, run.id);
        bridge.handle({ type: "session.ended", sessionId: `native-${run.id}`, reason: "cancelled", cost: zeroCost(this.options.modelConfig.model) });
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

  private checkModelPermission(run: RunRow): { readonly decision: "allowed" | "denied" | "expired" } {
    const cacheKey = `${run.id}:${this.options.modelConfig.provider}`;
    const cached = this.permissionCache.get(cacheKey);
    if (cached) {
      const active = this.activeRuns.get(run.id);
      if (active) active.permissionSummary.push(cached.summary);
      return { decision: cached.decision };
    }

    const resource = { type: "model.api_call", provider: this.options.modelConfig.provider as "openai" | "anthropic" | "google" | "openai-compatible" | "ollama" };
    const decided = this.options.permissions?.check({
      workspaceId: run.workspace_id,
      roomId: run.room_id ?? undefined,
      agentId: run.agent_id ?? undefined,
      runId: run.id,
      resource
    }) ?? { status: "allow", reason: "default_allow" };

    const decision = decided.status === "allow" ? "allowed" : decided.status === "deny" ? "denied" : "expired";
    const summary: PermissionDecisionSummary = { resource, decision, modelConfigId: this.options.modelConfig.model };
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
}

function costFromUsage(usage: any, modelId: string) {
  const inputTokens = Number(usage?.inputTokens ?? 0);
  const outputTokens = Number(usage?.outputTokens ?? 0);
  const cachedTokens = Number(usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens ?? 0);
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

import { streamText, type LanguageModel } from "ai";
import type { EventBus } from "../../bus/src/index.ts";
import type { AgentHubDatabase } from "../../db/src/index.ts";
import { AdapterBridge, type AdapterArtifactFSBoundary, type RunLifecycleService, type RunRow } from "../../orchestrator/src/index.ts";
import type { AgentAdapterManifest } from "../../protocol/src/index.ts";

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
  readonly modelConfig: ModelConfigRow;
  readonly apiKey?: string;
  readonly artifactFs?: AdapterArtifactFSBoundary;
  readonly tools?: Record<string, unknown>;
  readonly now?: () => number;
};

type ActiveRunState = {
  readonly controller: AbortController;
  readonly bridge: AdapterBridge;
  readonly run: RunRow;
};

export class NativeAgentAdapter {
  readonly manifest = nativeAgentManifest;
  private readonly now: () => number;
  private readonly activeRuns = new Map<string, ActiveRunState>();

  constructor(private readonly options: NativeAgentAdapterOptions) {
    this.now = options.now ?? Date.now;
  }

  async runManaged(run: RunRow): Promise<void> {
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
    this.activeRuns.set(run.id, { controller, bridge, run });

    try {
      const providerModel = resolveProvider(this.options.modelConfig, this.options.apiKey) as LanguageModel;
      const result = streamText({
        model: providerModel,
        prompt: `Run ${run.id} for agent ${run.agent_id}`,
        abortSignal: controller.signal,
        ...(this.options.tools !== undefined ? { tools: this.options.tools as never } : {})
      });

      const assistantMessageId = `msg_${run.id}`;
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          const delta = chunk.text;
          if (delta.length === 0) continue;
          bridge.handle({ type: "message.part.delta", messageId: assistantMessageId, delta });
        } else if (chunk.type === "tool-call") {
          bridge.handle({ type: "tool.call.requested", toolCallId: chunk.toolCallId, name: chunk.toolName, input: chunk.input ?? {} });
        } else if (chunk.type === "tool-result") {
          bridge.handle({ type: "tool.call.completed", toolCallId: chunk.toolCallId, output: chunk.output, ok: true });
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
      this.activeRuns.delete(run.id);
    }
  }

  async cancelManagedRun(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (active === undefined) return;
    this.options.lifecycle.markCancelling(null, runId);
    active.controller.abort(new DOMException("Cancelled", "AbortError"));
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

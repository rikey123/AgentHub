import { randomUUID } from "node:crypto";

import type { EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import { AdapterBridge, type AdapterArtifactFSBoundary, type RunRow } from "@agenthub/orchestrator";
import type { AgentAdapterManifest } from "@agenthub/protocol";

export type MockAgentScriptStep =
  | { readonly type: "say"; readonly text: string }
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "tool"; readonly name: string; readonly input?: unknown; readonly output?: unknown }
  | { readonly type: "write"; readonly path: string; readonly content: string }
  | { readonly type: "delete"; readonly path: string }
  | { readonly type: "file"; readonly path: string; readonly change?: "added" | "modified" | "deleted" }
  | { readonly type: "subagent"; readonly profileRef: string }
  | { readonly type: "snapshot"; readonly text: string }
  | { readonly type: "complete" };

export type MockAgentScript = {
  readonly steps: readonly MockAgentScriptStep[];
};

export const mockAgentManifest: AgentAdapterManifest = {
  id: "mock",
  name: "Mock Agent Adapter",
  runtimeKind: "native_sdk",
  provider: "mock",
  capabilities: {
    canStreamTokens: true,
    canEmitToolEvents: true,
    canEmitPermissionEvents: false,
    canEmitSubagentEvents: true,
    canInjectAtStart: true,
    canInjectNextTurn: true,
    canInjectRuntime: false,
    canCancel: true,
    canReadContextSnapshot: true,
    canRestoreSession: false,
    supportsMcp: false,
    supportsHooks: false,
    supportsWorkspaceIsolation: false
  },
  reliability: {
    level: "structured",
    eventSource: "native_event_stream",
    crashRecovery: "fail_run",
    parseFailure: "fail_run",
    maxRestartAttempts: 0
  },
  context: {
    startupInjection: true,
    runtimeInjection: false,
    injectionMode: "immediate",
    canPullExternalContext: false,
    canPushLedgerUpdates: false
  },
  workspace: { mode: "shared" }
};

export type MockAdapterManagerOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly lifecycle: ConstructorParameters<typeof AdapterBridge>[0]["lifecycle"];
  readonly artifactFs?: AdapterArtifactFSBoundary;
  readonly script?: MockAgentScript;
  readonly now?: () => number;
};

export class MockAdapterManager {
  readonly manifest = mockAgentManifest;
  readonly llmCallCounts = new Map<string, number>();
  private readonly now: () => number;
  private readonly script: MockAgentScript;
  private readonly cancelledRuns = new Set<string>();

  constructor(private readonly options: MockAdapterManagerOptions) {
    this.now = options.now ?? Date.now;
    this.script = options.script ?? defaultMockScript;
  }

  async runAgent(run: RunRow): Promise<void> {
    this.llmCallCounts.set(run.agent_id, (this.llmCallCounts.get(run.agent_id) ?? 0) + 1);
    const bridge = new AdapterBridge({
      runId: run.id,
      workspaceId: run.workspace_id,
      roomId: run.room_id,
      agentId: run.agent_id,
      lifecycle: this.options.lifecycle,
      eventBus: this.options.eventBus,
      now: this.now,
      ...(run.task_id !== null ? { taskId: run.task_id } : {}),
      messageId: `msg_${run.id}`,
      ...(run.workspace_mode !== null ? { workspaceMode: run.workspace_mode } : {}),
      terminalEnabled: this.script.steps.some((step) => step.type === "tool" && step.name.toLowerCase().includes("bash")),
      ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {})
    });

    const sessionId = `mock-session-${run.id}`;
    bridge.handle({ type: "session.opened", sessionId, workDir: run.work_dir ?? process.cwd(), providerConversationId: `mock-conversation-${run.id}` });

    const messageId = randomUUID();
    this.createAssistantMessage(run, messageId);
    let text = "";

    for (const step of this.script.steps) {
      if (this.cancelledRuns.has(run.id)) {
        bridge.handle({ type: "session.ended", sessionId, reason: "cancelled", cost: zeroCost() });
        return;
      }
      if (step.type === "say") {
        text += step.text;
        this.appendPart(messageId, text);
        this.publishMessageDelta(run, messageId, step.text);
      } else if (step.type === "delta") {
        text += step.text;
        this.appendPart(messageId, step.text);
        this.publishMessageDelta(run, messageId, step.text);
      } else if (step.type === "tool") {
        const toolCallId = randomUUID();
        bridge.handle({ type: "tool.call.requested", toolCallId, name: step.name, input: step.input ?? {} });
        bridge.handle({ type: "tool.call.completed", toolCallId, output: step.output ?? { ok: true }, ok: true });
      } else if (step.type === "write") {
        bridge.handle({ type: "fs.writeTextFile", path: step.path, content: step.content });
      } else if (step.type === "delete") {
        bridge.handle({ type: "fs.deleteFile", path: step.path });
      } else if (step.type === "file") {
        bridge.handle({ type: "file.changed", path: step.path, change: step.change ?? "modified" });
      } else if (step.type === "subagent") {
        const subRunId = randomUUID();
        bridge.handle({ type: "subagent.started", subRunId, profileRef: step.profileRef });
        bridge.handle({ type: "subagent.completed", subRunId });
      } else if (step.type === "snapshot") {
        bridge.handle({ type: "context.snapshot", snapshot: { kind: "mock", text: step.text } });
      }
    }

    this.completeAssistantMessage(run, messageId, text.length > 0 ? text : "Mock assistant completed.");
    bridge.handle({ type: "session.ended", sessionId, reason: "completed", cost: syntheticCost(text, this.script.steps) });
  }

  cancelRun(runId: string): void {
    this.cancelledRuns.add(runId);
  }

  llmCallsFor(agentId: string): number {
    return this.llmCallCounts.get(agentId) ?? 0;
  }

  private createAssistantMessage(run: RunRow, messageId: string): void {
    const now = this.now();
    this.options.database.sqlite
      .prepare(
        `INSERT INTO messages (
          id, workspace_id, room_id, sender_type, sender_id, run_id, role, status,
          quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, 'agent', ?, ?, 'assistant', 'streaming', NULL, 'immediate', NULL, ?, ?, NULL)`
      )
      .run(messageId, run.workspace_id, run.room_id, run.agent_id, run.id, now, now);
    this.options.eventBus.publish(messageEvent(run, "message.created", messageId, { role: "assistant", senderId: run.agent_id, runId: run.id }, now));
  }

  private appendPart(messageId: string, text: string): void {
    const nextSeq = ((this.options.database.sqlite.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM message_parts WHERE message_id = ?").get(messageId) as { seq: number }).seq);
    this.options.database.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, ?, 'text', ?, ?)").run(messageId, nextSeq, JSON.stringify({ text }), this.now());
  }

  private completeAssistantMessage(run: RunRow, messageId: string, text: string): void {
    const now = this.now();
    this.options.database.sqlite.prepare("UPDATE messages SET status = 'completed', updated_at = ? WHERE id = ?").run(now, messageId);
    this.options.eventBus.publish(messageEvent(run, "message.completed", messageId, { text }, now));
  }

  private publishMessageDelta(run: RunRow, messageId: string, delta: string): void {
    this.options.eventBus.publish(messageEvent(run, "message.part.delta", messageId, { delta }, this.now()));
  }
}

const defaultMockScript: MockAgentScript = {
  steps: [
    { type: "say", text: "Mock assistant reply" },
    { type: "tool", name: "mock.echo", input: { text: "ping" }, output: { text: "pong" } },
    { type: "file", path: "mock-output.txt" },
    { type: "snapshot", text: "mock context snapshot" },
    { type: "complete" }
  ]
};

function messageEvent(run: RunRow, type: "message.created" | "message.completed" | "message.part.delta", messageId: string, payload: Record<string, unknown>, createdAt: number): PublishInput {
  return {
    id: randomUUID(),
    type,
    schemaVersion: 1,
    workspaceId: run.workspace_id,
    roomId: run.room_id,
    runId: run.id,
    agentId: run.agent_id,
    payload: { messageId, roomId: run.room_id, ...payload },
    createdAt
  };
}

function zeroCost() {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId: "mock" };
}

/**
 * Generate plausible-looking cost numbers for mock runs so the V0.5 Cost panel has data to
 * visualize when the user is just kicking the tires with `chatter` or other mock-backed agents.
 * NOT real billing — derived deterministically from the run's script + final text length.
 *
 * Approximate model: ~4 chars per token; tool calls add 50 input tokens each (system prompt
 * inflation), each "say"/"delta" adds output tokens; price = $3/M input, $15/M output (Sonnet).
 */
function syntheticCost(text: string, steps: MockAgentScript["steps"]): { inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number; modelId: string } {
  const outputTokens = Math.max(1, Math.ceil(text.length / 4));
  const toolCount = steps.filter((s) => s.type === "tool").length;
  const inputTokens = 200 + toolCount * 50;
  const cachedTokens = Math.floor(inputTokens * 0.3);
  const costUsd = Math.round(((inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15) * 1_000_000) / 1_000_000;
  return { inputTokens, outputTokens, cachedTokens, costUsd, modelId: "mock-sonnet" };
}

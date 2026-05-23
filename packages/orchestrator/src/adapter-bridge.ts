import { randomUUID } from "node:crypto";

import type { EventBus, PublishInput } from "@agenthub/bus";
import type { EventType } from "@agenthub/protocol/events";

import { RunLifecycleService, type Cost } from "./run-lifecycle-service.ts";

export type AdapterEvent =
  | { readonly type: "session.opened"; readonly sessionId: string; readonly workDir?: string; readonly providerConversationId?: string }
  | { readonly type: "provider.conversation.updated"; readonly providerConversationId: string }
  | { readonly type: "tool.call.requested"; readonly toolCallId: string; readonly name: string; readonly input: unknown }
  | { readonly type: "tool.call.completed"; readonly toolCallId: string; readonly output: unknown; readonly ok: boolean }
  | { readonly type: "subagent.started"; readonly subRunId: string; readonly profileRef: string }
  | { readonly type: "subagent.completed"; readonly subRunId: string }
  | { readonly type: "fs.writeTextFile"; readonly path: string; readonly content: string }
  | { readonly type: "fs.deleteFile"; readonly path: string }
  | { readonly type: "file.changed"; readonly path: string; readonly change: "added" | "modified" | "deleted" }
  | { readonly type: "context.snapshot"; readonly snapshot: unknown }
  | { readonly type: "session.ended"; readonly sessionId: string; readonly reason: "completed" | "cancelled" | string; readonly cost?: Cost }
  | { readonly type: "session.crashed"; readonly sessionId: string; readonly error: string };

export type AdapterArtifactFSBoundary = {
  readonly beginRun?: (input: { readonly runId: string; readonly workspaceId: string; readonly roomId: string; readonly agentId: string; readonly taskId?: string; readonly messageId?: string; readonly mode?: string; readonly terminalEnabled?: boolean; readonly workDir?: string }) => void;
  readonly writeTextFile: (input: { readonly runId: string; readonly path: string; readonly content: string }) => void;
  readonly deleteFile: (input: { readonly runId: string; readonly path: string }) => void;
  readonly buildRunArtifact: (input: { readonly runId: string; readonly title?: string }) => unknown;
};

export class AdapterBridge {
  constructor(
    private readonly input: {
      readonly runId: string;
      readonly workspaceId: string;
      readonly roomId: string;
      readonly agentId: string;
      readonly lifecycle: RunLifecycleService;
      readonly eventBus: EventBus;
      readonly now?: () => number;
      readonly taskId?: string;
      readonly messageId?: string;
      readonly workspaceMode?: string;
      readonly terminalEnabled?: boolean;
      readonly artifactFs?: AdapterArtifactFSBoundary;
    }
  ) {}

  handle(event: AdapterEvent): void {
    if (event.type === "session.opened") {
      this.input.lifecycle.updateSessionState(null, this.input.runId, {
        adapterSessionId: event.sessionId,
        ...(event.workDir !== undefined ? { workDir: event.workDir } : {}),
        ...(event.providerConversationId !== undefined ? { providerConversationId: event.providerConversationId } : {})
      });
      this.input.artifactFs?.beginRun?.({ runId: this.input.runId, workspaceId: this.input.workspaceId, roomId: this.input.roomId, agentId: this.input.agentId, ...(this.input.taskId !== undefined ? { taskId: this.input.taskId } : {}), ...(this.input.messageId !== undefined ? { messageId: this.input.messageId } : {}), ...(this.input.workspaceMode !== undefined ? { mode: this.input.workspaceMode } : {}), terminalEnabled: this.input.terminalEnabled === true, ...(event.workDir !== undefined ? { workDir: event.workDir } : {}) });
      this.input.lifecycle.markRunning(null, this.input.runId, event.sessionId);
      return;
    }
    if (event.type === "provider.conversation.updated") {
      this.input.lifecycle.updateSessionState(null, this.input.runId, { providerConversationId: event.providerConversationId });
      return;
    }
    if (event.type === "session.ended") {
      this.input.artifactFs?.buildRunArtifact({ runId: this.input.runId, title: `Run ${this.input.runId} changes` });
      if (event.reason === "cancelled") this.input.lifecycle.cancelFinalized(null, this.input.runId);
      else this.input.lifecycle.complete(null, this.input.runId, event.cost ?? zeroCost());
      return;
    }
    if (event.type === "session.crashed") {
      this.input.artifactFs?.buildRunArtifact({ runId: this.input.runId, title: `Run ${this.input.runId} changes` });
      this.input.lifecycle.fail(null, this.input.runId, "adapter_session_crashed", "retryable_visible", event.error);
      return;
    }
    if (event.type === "fs.writeTextFile") {
      this.input.artifactFs?.writeTextFile({ runId: this.input.runId, path: event.path, content: event.content });
      this.publishAdapterDomainEvent({ type: "file.changed", path: event.path, change: "modified" });
      return;
    }
    if (event.type === "fs.deleteFile") {
      this.input.artifactFs?.deleteFile({ runId: this.input.runId, path: event.path });
      this.publishAdapterDomainEvent({ type: "file.changed", path: event.path, change: "deleted" });
      return;
    }
    this.publishAdapterDomainEvent(event);
  }

  private publishAdapterDomainEvent(event: Exclude<AdapterEvent, { readonly type: "session.opened" | "provider.conversation.updated" | "session.ended" | "session.crashed" | "fs.writeTextFile" | "fs.deleteFile" }>): void {
    this.input.eventBus.publish({
      id: randomUUID(),
      type: event.type as EventType,
      schemaVersion: 1,
      workspaceId: this.input.workspaceId,
      roomId: this.input.roomId,
      runId: this.input.runId,
      agentId: this.input.agentId,
      payload: { runId: this.input.runId, ...event },
      createdAt: this.input.now?.() ?? Date.now()
    } satisfies PublishInput);
  }
}

function zeroCost(): Cost {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId: "unknown" };
}

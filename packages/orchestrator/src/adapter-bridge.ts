import { randomUUID } from "node:crypto";

import type { Command, CommandBus, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import type { EventType } from "@agenthub/protocol/events";

import { RunLifecycleService, type Cost, type RunRow, type WakeReason } from "./run-lifecycle-service.ts";

/**
 * Synchronous brief resolver. Returns the brief text to embed in `message.brief.published`.
 * Implementations should be deterministic and fast (no LLM calls). The resolver is given the
 * runId, the final assistant text (if any), and counts of artifacts produced by the run, and
 * may inspect failure/cancel state for templated outputs. We keep this structural to avoid an
 * orchestrator -> context circular import.
 */
export type BriefResolver = (input: {
  readonly runId: string;
  readonly finalAssistantText?: string;
  readonly artifactCounts: { readonly diff: number; readonly file: number; readonly tool: number };
  readonly failureClass?: string;
  readonly failureReason?: string;
  readonly cancelled?: boolean;
}) => string;

export type AdapterEvent =
  | { readonly type: "session.opened"; readonly sessionId: string; readonly workDir?: string; readonly providerConversationId?: string }
  | { readonly type: "provider.conversation.updated"; readonly providerConversationId: string }
  | { readonly type: "message.part.delta"; readonly messageId: string; readonly delta: string }
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
  readonly beginRun?: (input: { readonly runId: string; readonly workspaceId: string; readonly roomId: string; readonly agentId: string; readonly taskId?: string; readonly messageId?: string; readonly mode?: string; readonly terminalEnabled?: boolean; readonly workDir?: string }) => { readonly workDir: string } | void;
  readonly writeTextFile: (input: { readonly runId: string; readonly path: string; readonly content: string }) => void;
  readonly deleteFile: (input: { readonly runId: string; readonly path: string }) => void;
  readonly buildRunArtifact: (input: { readonly runId: string; readonly title?: string }) => unknown;
  readonly buildWorktreeDiffArtifact?: (input: { readonly runId: string; readonly title?: string }) => unknown;
};

export function prepareAdapterRunWorkspace(input: { readonly run: RunRow; readonly artifactFs?: AdapterArtifactFSBoundary; readonly terminalEnabled?: boolean; readonly messageId?: string }): string {
  const run = input.run;
  const prepared = input.artifactFs?.beginRun?.({
    runId: run.id,
    workspaceId: run.workspace_id,
    roomId: run.room_id,
    agentId: run.agent_id,
    ...(run.task_id !== null ? { taskId: run.task_id } : {}),
    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
    ...(run.workspace_mode !== null ? { mode: run.workspace_mode } : {}),
    terminalEnabled: input.terminalEnabled === true,
    ...(run.work_dir !== null ? { workDir: run.work_dir } : {})
  });
  return prepared !== undefined && typeof prepared === "object" && typeof prepared.workDir === "string" && prepared.workDir.length > 0
    ? prepared.workDir
    : (run.work_dir ?? process.cwd());
}

export function runWithPreparedWorkDir(run: RunRow, workDir: string): RunRow {
  return run.work_dir === workDir ? run : { ...run, work_dir: workDir };
}

const MAX_AUTO_CONTINUATION_DEPTH = 4;
const CONTINUABLE_WAKE_REASONS = new Set<WakeReason>([
  "primary_turn",
  "user_mention",
  "delegated_task",
  "task_review",
  "task_blocked",
  "rule_review",
  "knock_approved",
  "group_review",
  "phase_completed",
  "agent_crashed",
  "consume_pending_turn",
  "mailbox_message",
  "execute",
  "agent_stalled"
]);

const AUTO_CONTINUE_INSTRUCTIONS = [
  "Continue the previous run and finish the user's task now.",
  "Do not stop after describing what you will do next. Use the available runtime tools now; when an uploaded attachment is represented by a local path, inspect that path directly.",
  "Only end after you have provided the requested answer, or after you have clearly reported a concrete runtime limitation."
].join("\n");

const CONTINUATION_PROMISE_PATTERNS = [
  /(?:\u63a5\u4e0b\u6765|\u4e0b\u4e00\u6b65|\u73b0\u5728)[\s,，、]*(?:\u6211)?(?:\u4f1a|\u5c06|\u8981|\u5148)?(?:\u5c1d\u8bd5)?(?:\u76f4\u63a5)?(?:\u8bfb\u53d6|\u9605\u8bfb|\u62bd\u53d6|\u63d0\u53d6|\u89e3\u6790|\u67e5\u770b|\u6253\u5f00|\u5206\u6790|\u68c0\u67e5|\u5904\u7406|\u7ee7\u7eed)/u,
  /\u6211(?:\u4f1a|\u5c06|\u8981|\u5148)(?:\u5c1d\u8bd5|\u7ee7\u7eed|\u76f4\u63a5)?(?:\u8bfb\u53d6|\u9605\u8bfb|\u62bd\u53d6|\u63d0\u53d6|\u89e3\u6790|\u67e5\u770b|\u6253\u5f00|\u5206\u6790|\u68c0\u67e5|\u5904\u7406)/u,
  /(?:\u6211\u6b63\u5728|\u6b63\u5728)(?:\u8bfb\u53d6|\u9605\u8bfb|\u62bd\u53d6|\u63d0\u53d6|\u89e3\u6790|\u67e5\u770b|\u6253\u5f00|\u5206\u6790|\u68c0\u67e5|\u5904\u7406)/u,
  /\b(?:next|now)\s*,?\s*(?:i\s*)?(?:will|am going to|shall|need to|can)?\s*(?:try to\s*)?(?:inspect|read|extract|parse|open|analy[sz]e|check|process|continue|summari[sz]e)\b/iu,
  /\bi(?:'ll| will| am going to| need to| can)\s+(?:try to\s+)?(?:inspect|read|extract|parse|open|analy[sz]e|check|process|continue|summari[sz]e)\b/iu,
  /\blet me\s+(?:inspect|read|extract|parse|open|analy[sz]e|check|process|continue|summari[sz]e)\b/iu,
  /\bi(?:'m| am)\s+(?:currently\s+)?(?:reading|extracting|parsing|opening|analy[sz]ing|checking|processing|continuing|summari[sz]ing)\b/iu
];

const EXPLICIT_LIMITATION_PATTERNS = [
  /\b(?:cannot|can't|unable to|not able to|do not have access|don't have access|runtime limitation)\b/iu,
  /(?:\u65e0\u6cd5|\u4e0d\u80fd|\u4e0d\u652f\u6301)/u
];

export class AdapterBridge {
  private readonly toolNamesByCallId = new Map<string, string>();
  private watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  private level2Timer: ReturnType<typeof setTimeout> | undefined;
  private turnCount = 0;
  private turnLimitTriggered = false;
  private readonly seenMessageIds = new Set<string>();
  private terminal = false;
  private static readonly WATCHDOG_MS = 90_000; // 90s of silence → notify leader
  private static readonly LEVEL2_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly input: {
      readonly runId: string;
      readonly workspaceId: string;
      readonly roomId: string;
      readonly agentId: string;
      readonly wakeReason?: string;
      readonly lifecycle: RunLifecycleService;
      readonly eventBus: EventBus;
      readonly now?: () => number;
      readonly taskId?: string;
      readonly messageId?: string;
      readonly workspaceMode?: string;
      readonly terminalEnabled?: boolean;
      readonly artifactFs?: AdapterArtifactFSBoundary;
      readonly getCommandBus?: () => CommandBus | undefined;
      readonly onSessionEndedWithoutCompletion?: (taskId: string) => void | Promise<void>;
      readonly onPlanPhaseEnded?: (runId: string) => void | Promise<void>;
      /** Optional brief resolver. When omitted, briefs default to "" (legacy behavior). */
      readonly briefResolver?: BriefResolver;
      /** Database used to look up the final assistant message text + artifact counts when computing the brief. */
      readonly database?: AgentHubDatabase;
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
      this.resetWatchdog();
      return;
    }
    if (event.type === "provider.conversation.updated") {
      this.input.lifecycle.updateSessionState(null, this.input.runId, { providerConversationId: event.providerConversationId });
      return;
    }
    if (event.type === "message.part.delta") {
      if (!this.seenMessageIds.has(event.messageId)) {
        this.seenMessageIds.add(event.messageId);
        this.turnCount += 1;
        this.checkTurnLimit();
      }
      this.publishAdapterDomainEvent(event);
      this.onMessageDelta();
      return;
    }
    if (event.type === "session.ended") {
      this.terminal = true;
      this.clearWatchdog();
      // For isolated_worktree runs, generate worktree diff artifact.
      // buildWorktreeDiffArtifact returns undefined (without consuming the run) when mode
      // is not isolated_worktree, so we fall back to the regular buildRunArtifact.
      const worktreeArtifact = this.input.artifactFs?.buildWorktreeDiffArtifact?.({ runId: this.input.runId, title: `Run ${this.input.runId} changes` });
      if (worktreeArtifact === undefined) {
        this.input.artifactFs?.buildRunArtifact({ runId: this.input.runId, title: `Run ${this.input.runId} changes` });
      }
      const cancelled = event.reason === "cancelled";
      const briefText = this.computeBriefText({ cancelled });
      if (cancelled) {
        const run = this.input.lifecycle.read(this.input.runId);
        if (run.status === "cancelling") this.input.lifecycle.cancelFinalized(null, this.input.runId, briefText);
        else {
          const failureText = this.computeBriefText({ failureClass: "retryable_visible", failureReason: "provider_cancelled" });
          this.input.lifecycle.fail(null, this.input.runId, "adapter_session_cancelled", "retryable_visible", "provider_cancelled", failureText);
          return;
        }
      } else {
        this.input.lifecycle.complete(null, this.input.runId, event.cost ?? zeroCost(), briefText);
      }
      const autoContinued = !cancelled && this.maybeAutoContinueIncompleteReply();
      if (this.input.wakeReason === "plan") void Promise.resolve(this.input.onPlanPhaseEnded?.(this.input.runId));
      if (!autoContinued && this.input.taskId !== undefined && !this.hasRecordedCompletionReport(this.input.taskId)) {
        void Promise.resolve(this.input.onSessionEndedWithoutCompletion?.(this.input.taskId));
      }
      return;
    }
    if (event.type === "session.crashed") {
      this.terminal = true;
      this.clearWatchdog();
      this.input.artifactFs?.buildRunArtifact({ runId: this.input.runId, title: `Run ${this.input.runId} changes` });
      const briefText = this.computeBriefText({ failureClass: "adapter_error", failureReason: event.error });
      this.input.lifecycle.fail(null, this.input.runId, "adapter_session_crashed", "retryable_visible", event.error, briefText);
      return;
    }
    if (event.type === "fs.writeTextFile" || event.type === "fs.deleteFile") {
      const path = event.path;
      if (path.includes("..") || path.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(path)) {
        // Spec §path-traversal-guard: rejected paths return { error: "path_traversal_denied", path }.
        // For adapter-sourced events the "caller" is the run itself; publish a visible tool.call.completed
        // error so the run log records the rejection rather than silently dropping it.
        this.input.eventBus.publish({
          id: randomUUID(),
          type: "tool.call.completed",
          schemaVersion: 1,
          workspaceId: this.input.workspaceId,
          roomId: this.input.roomId,
          runId: this.input.runId,
          agentId: this.input.agentId,
          payload: { runId: this.input.runId, toolCallId: `path-traversal:${path}`, ok: false, output: { error: "path_traversal_denied", path } },
          createdAt: this.input.now?.() ?? Date.now()
        });
        return;
      }
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
    // Any streaming activity resets the inactivity watchdog.
    if (event.type === "tool.call.requested" || event.type === "tool.call.completed") {
      this.resetWatchdog();
    }
    if (event.type === "tool.call.requested") this.toolNamesByCallId.set(event.toolCallId, event.name);
    if (event.type === "tool.call.completed") this.createTerminalArtifact(event);
    this.publishAdapterDomainEvent(event);
  }

  /** Called by the adapter when a message delta arrives (streaming text). */
  onMessageDelta(): void {
    this.resetWatchdog();
  }

  private createTerminalArtifact(event: Extract<AdapterEvent, { readonly type: "tool.call.completed" }>): void {
    const toolName = this.toolNamesByCallId.get(event.toolCallId);
    if (toolName === undefined || !isTerminalTool(toolName)) return;
    const output = isRecord(event.output) ? event.output : {};
    const stdout = typeof output.stdout === "string" ? output.stdout : "";
    const stderr = typeof output.stderr === "string" ? output.stderr : "";
    const idempotencyKey = `terminal-artifact:${this.input.runId}:${event.toolCallId}`;
    const command: Command = { type: "CreateArtifact", workspaceId: this.input.workspaceId, roomId: this.input.roomId, ...(this.input.taskId !== undefined ? { taskId: this.input.taskId } : {}), runId: this.input.runId, ...(this.input.messageId !== undefined ? { messageId: this.input.messageId } : {}), artifactType: "terminal", title: `${toolName} output`, metadata: { toolCallId: event.toolCallId, toolName, ok: event.ok, stdout, stderr }, idempotencyKey };
    void this.input.getCommandBus?.()?.dispatch(command, { actor: { type: "agent", id: this.input.agentId }, traceId: `terminal:${this.input.runId}:${event.toolCallId}`, idempotencyKey, origin: "internal" });
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

  private hasRecordedCompletionReport(taskId: string): boolean {
    const db = this.input.database;
    if (db === undefined) return false;
    if (db.sqlite.prepare("SELECT 1 FROM events WHERE task_id = ? AND type = 'task.delegation.completed' LIMIT 1").get(taskId) !== undefined) return true;
    return db.sqlite.prepare("SELECT 1 FROM task_activities WHERE task_id = ? AND kind = 'status_change' AND by = 'room.complete_task' LIMIT 1").get(taskId) !== undefined;
  }

  private maybeAutoContinueIncompleteReply(): boolean {
    if (this.input.wakeReason === "plan") return false;
    const db = this.input.database;
    const commandBus = this.input.getCommandBus?.();
    if (db === undefined || commandBus === undefined) return false;
    const finalAssistantText = this.finalAssistantText();
    if (finalAssistantText === undefined || !shouldAutoContinueFinalAssistantText(finalAssistantText)) return false;
    if (this.autoContinuationDepth() >= MAX_AUTO_CONTINUATION_DEPTH) return false;

    const idempotencyKey = `auto-continue:${this.input.runId}`;
    const inputRef = this.continuationInputRef();
    const command: Command = {
      type: "WakeAgent",
      roomId: this.input.roomId,
      agentId: this.input.agentId,
      workspaceId: this.input.workspaceId,
      reason: this.continuationWakeReason(),
      ...(this.input.taskId !== undefined ? { taskId: this.input.taskId } : {}),
      parentRunId: this.input.runId,
      promptDelta: { kind: "delta_only", instructions: AUTO_CONTINUE_INSTRUCTIONS },
      ...(inputRef.messageId !== undefined ? { messageId: inputRef.messageId } : {}),
      ...(inputRef.pendingTurnId !== undefined ? { pendingTurnId: inputRef.pendingTurnId } : {}),
      idempotencyKey
    };

    try {
      const result = commandBus.dispatch(command, { actor: { type: "system" }, traceId: idempotencyKey, idempotencyKey, origin: "internal" });
      if (isPromiseLike(result)) {
        void result.catch(() => undefined);
        return true;
      }
      return result.ok === true;
    } catch {
      return false;
    }
  }

  private continuationWakeReason(): WakeReason {
    const wakeReason = this.input.wakeReason;
    return isContinuableWakeReason(wakeReason) ? wakeReason : "primary_turn";
  }

  private autoContinuationDepth(): number {
    const db = this.input.database;
    if (db === undefined) return 0;
    const seen = new Set<string>();
    let depth = 0;
    let cursor: string | null = this.input.runId;
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      const row = db.sqlite.prepare("SELECT parent_run_id AS parentRunId FROM runs WHERE id = ?").get(cursor) as { readonly parentRunId: string | null } | undefined;
      if (row?.parentRunId === undefined || row.parentRunId === null) break;
      depth += 1;
      cursor = row.parentRunId;
    }
    return depth;
  }

  private continuationInputRef(): { readonly messageId?: string; readonly pendingTurnId?: string } {
    const db = this.input.database;
    if (db === undefined) return {};
    const queued = db.sqlite.prepare("SELECT payload FROM events WHERE run_id = ? AND type = 'agent.run.queued' ORDER BY seq DESC LIMIT 1").get(this.input.runId) as { readonly payload: string } | undefined;
    const queuedPayload = queued !== undefined ? parseJsonRecord(queued.payload) : undefined;
    const queuedMessageId = typeof queuedPayload?.messageId === "string" && queuedPayload.messageId.length > 0 ? queuedPayload.messageId : undefined;
    const queuedPendingTurnId = typeof queuedPayload?.pendingTurnId === "string" && queuedPayload.pendingTurnId.length > 0 ? queuedPayload.pendingTurnId : undefined;
    if (queuedMessageId !== undefined || queuedPendingTurnId !== undefined) return { ...(queuedMessageId !== undefined ? { messageId: queuedMessageId } : {}), ...(queuedPendingTurnId !== undefined ? { pendingTurnId: queuedPendingTurnId } : {}) };

    const nextTurn = db.sqlite
      .prepare("SELECT message_id AS messageId, pending_turn_id AS pendingTurnId FROM run_next_turns WHERE run_id = ? ORDER BY created_at ASC, id ASC LIMIT 1")
      .get(this.input.runId) as { readonly messageId: string | null; readonly pendingTurnId: string | null } | undefined;
    return {
      ...(nextTurn?.messageId !== undefined && nextTurn.messageId !== null ? { messageId: nextTurn.messageId } : {}),
      ...(nextTurn?.pendingTurnId !== undefined && nextTurn.pendingTurnId !== null ? { pendingTurnId: nextTurn.pendingTurnId } : {})
    };
  }

  // ---------------------------------------------------------------------------
  // Inactivity watchdog
  // ---------------------------------------------------------------------------

  private resetWatchdog(): void {
    if (this.terminal) return;
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = undefined;
      if (this.terminal) return;
      void this.notifyLeaderOfStall();
    }, AdapterBridge.WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== undefined) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
    if (this.level2Timer !== undefined) {
      clearTimeout(this.level2Timer);
      this.level2Timer = undefined;
    }
  }

  private notifyLeaderOfStall(): void {
    const db = this.input.database;
    if (db === undefined) return;
    void Promise.resolve().then(async () => {
      try {
        if (this.terminal) return;
        const run = db.sqlite.prepare("SELECT status FROM runs WHERE id = ?").get(this.input.runId) as { readonly status: string } | undefined;
        if (run === undefined || run.status !== "running") return;
        const room = db.sqlite
          .prepare("SELECT workspace_id, primary_agent_id, mode FROM rooms WHERE id = ?")
          .get(this.input.roomId) as { workspace_id: string; primary_agent_id: string | null; mode: string } | undefined;
        if (!room) return;
        // Only notify in team/squad/assisted rooms where there is a distinct leader.
        if (room.mode !== "team" && room.mode !== "squad" && room.mode !== "assisted") return;
        const leaderId = room.primary_agent_id;
        if (!leaderId || leaderId === this.input.agentId) return;

        const now = this.input.now?.() ?? Date.now();
        const mailboxMessageId = randomUUID();
        const agentName = (db.sqlite.prepare("SELECT name FROM agent_profiles WHERE id = ?").get(this.input.agentId) as { name: string } | undefined)?.name ?? this.input.agentId;
        const stallMessage = `[Watchdog] Agent **${agentName}** (run ${this.input.runId.slice(0, 8)}) has been silent for ${Math.round(AdapterBridge.WATCHDOG_MS / 1000)}s with no output. It may be stuck. Consider reassigning its task or cancelling the run.`;

        db.sqlite.transaction(() => {
          db.sqlite
            .prepare(
              "INSERT INTO mailbox_messages (id, workspace_id, room_id, from_type, from_id, to_agent_id, kind, content, files, read, claimed_run_id, claimed_at, delivery_batch_id, delivery_failure_reason, attempt_count, created_at, consumed_at) VALUES (?, ?, ?, 'system', 'watchdog', ?, 'message', ?, '[]', 0, NULL, NULL, NULL, NULL, 0, ?, NULL)"
            )
            .run(mailboxMessageId, room.workspace_id, this.input.roomId, leaderId, JSON.stringify({ text: stallMessage }), now);
          this.input.eventBus.publish({ id: randomUUID(), type: "mailbox.message.created", schemaVersion: 1, workspaceId: room.workspace_id, roomId: this.input.roomId, agentId: leaderId, payload: { mailboxMessageId, roomId: this.input.roomId, fromAgentId: "watchdog", targetAgentId: leaderId }, createdAt: now });
        })();

        // Wake the leader so it sees the stall notification.
        const wakeResult = await Promise.resolve(this.input.getCommandBus?.()?.dispatch(
          { type: "WakeAgent", roomId: this.input.roomId, agentId: leaderId, workspaceId: room.workspace_id, reason: "agent_stalled", promptDelta: { kind: "delta_only", instructions: stallMessage }, idempotencyKey: `watchdog:${this.input.runId}:${now}` },
          { actor: { type: "system" }, traceId: `watchdog:${this.input.runId}`, origin: "internal" }
        ));
        const wakeData = wakeResult?.ok === true ? (wakeResult.data as { runId?: string; appendedToRunId?: string } | undefined) : undefined;
        const leaderRunId = wakeData?.runId ?? wakeData?.appendedToRunId;

        // Always start Level-2 timer regardless of whether WakeAgent succeeded.
        // The timer checks if any leader run reached 'running' after Level-1 fired.
        const level2StartTime = this.input.now?.() ?? Date.now();
        this.level2Timer = setTimeout(() => {
          this.level2Timer = undefined;
          if (this.terminal) return;
          this.checkLevel2Stall(leaderRunId ?? null, level2StartTime);
        }, AdapterBridge.LEVEL2_MS);
      } catch (err) {
        // eslint-disable-next-line no-console -- watchdog last-resort fallback when CommandBus dispatch fails; intentional console to avoid silent loss
        console.warn("[AdapterBridge] watchdog notification failed:", err);
      }
    });
  }

  private checkLevel2Stall(leaderRunId: string | null, since: number): void {
    const db = this.input.database;
    if (!db) return;
    try {
      const room = db.sqlite.prepare("SELECT workspace_id, primary_agent_id FROM rooms WHERE id = ?").get(this.input.roomId) as { workspace_id: string; primary_agent_id: string | null } | undefined;
      if (!room) return;

      // Check if leader recovered: any leader run created after Level-1 that reached running/completed
      const leaderId = room.primary_agent_id;
      if (leaderId) {
        const recoveredRun = db.sqlite.prepare(
          "SELECT id FROM runs WHERE room_id = ? AND agent_id = ? AND created_at >= ? AND status IN ('running', 'completed') LIMIT 1"
        ).get(this.input.roomId, leaderId, since) as { id: string } | undefined;
        if (recoveredRun) return; // Leader recovered in time
      }

      // If we have a specific leaderRunId, also check if it's still running
      if (leaderRunId) {
        const leaderRun = db.sqlite.prepare("SELECT status FROM runs WHERE id = ?").get(leaderRunId) as { status: string } | undefined;
        if (leaderRun?.status === "running" || leaderRun?.status === "completed") return;
      }

      const leaderRun = leaderRunId
        ? db.sqlite.prepare("SELECT status FROM runs WHERE id = ?").get(leaderRunId) as { status: string } | undefined
        : undefined;
      const reason = (() => {
        if (leaderRunId) {
          return (leaderRun?.status === "failed" || leaderRun?.status === "cancelled") ? "leader_failed" : "leader_unavailable";
        }
        return "leader_unavailable";
      })();

      const stalledTasks = db.sqlite.prepare(
        "SELECT id FROM tasks WHERE room_id = ? AND status IN ('in_progress', 'blocked')"
      ).all(this.input.roomId) as { id: string }[];
      const stalledTaskIds = stalledTasks.map((t) => t.id);

      const now = this.input.now?.() ?? Date.now();

      db.sqlite.transaction(() => {
        db.sqlite.prepare("UPDATE rooms SET stalled_at = ? WHERE id = ?").run(now, this.input.roomId);
        this.input.eventBus.publish({
          id: randomUUID(),
          type: "room.stalled",
          schemaVersion: 1,
          workspaceId: room.workspace_id,
          roomId: this.input.roomId,
          payload: { roomId: this.input.roomId, stalledTaskIds, reason },
          createdAt: now
        });
      })();
    } catch (err) {
      void err;
    }
  }

  private checkTurnLimit(): void {
    if (this.turnLimitTriggered) return;
    if (!this.input.taskId || !this.input.database) return;
    const task = this.input.database.sqlite
      .prepare("SELECT max_turns FROM tasks WHERE id = ?")
      .get(this.input.taskId) as { max_turns: number | null } | undefined;
    if (!task?.max_turns || this.turnCount < task.max_turns) return;

    this.turnLimitTriggered = true;

    const db = this.input.database;
    const now = this.input.now?.() ?? Date.now();
    const taskId = this.input.taskId;
    const runId = this.input.runId;
    const room = db.sqlite.prepare("SELECT workspace_id, primary_agent_id FROM rooms WHERE id = ?").get(this.input.roomId) as { workspace_id: string; primary_agent_id: string | null } | undefined;

    if (room) {
      db.sqlite.transaction(() => {
        // Read prevStatus before update so the event payload is accurate
        const prevRow = db.sqlite.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
        const prevStatus = prevRow?.status ?? "in_progress";
        const result = db.sqlite.prepare("UPDATE tasks SET status = 'blocked', blocker_reason = 'turn_limit_exceeded', updated_at = ? WHERE id = ? AND status NOT IN ('blocked', 'completed', 'cancelled')").run(now, taskId);
        if (result.changes > 0) {
          this.input.eventBus.publish({
            id: randomUUID(),
            type: "task.status.changed",
            schemaVersion: 1,
            workspaceId: room.workspace_id,
            roomId: this.input.roomId,
            payload: { taskId, prevStatus, nextStatus: "blocked", blockerReason: "turn_limit_exceeded", reason: "turn_limit_exceeded" },
            createdAt: now
          });
        }
      })();
    }

    try {
      if (room?.primary_agent_id) {
        void this.input.getCommandBus?.()?.dispatch(
          { type: "WakeAgent", roomId: this.input.roomId, agentId: room.primary_agent_id, workspaceId: room.workspace_id, reason: "task_blocked", taskId, idempotencyKey: `turn-limit:${runId}` },
          { actor: { type: "system" }, traceId: `turn-limit:${runId}`, origin: "internal" }
        );
      }
      void this.input.getCommandBus?.()?.dispatch(
        { type: "CancelRun", runId, idempotencyKey: `turn-limit:${runId}` },
        { actor: { type: "system" }, traceId: `turn-limit:${runId}`, origin: "internal" }
      );
    } catch {
      /* best effort */
    }
  }

  /**
   * Look up the run's final assistant text + artifact counts from the database and feed them
   * to the configured `briefResolver`. Returns "" when no resolver/database is wired (legacy
   * behavior — keeps tests with stubbed services working).
   */
  private computeBriefText(extra: { readonly cancelled?: boolean; readonly failureClass?: string; readonly failureReason?: string } = {}): string | undefined {
    const resolver = this.input.briefResolver;
    const db = this.input.database;
    if (resolver === undefined || db === undefined) return undefined;
    try {
      const finalAssistantText = this.finalAssistantText();
      const artifactCounts = (db.sqlite.prepare(
        `SELECT
           SUM(CASE WHEN type = 'diff' THEN 1 ELSE 0 END) AS diff,
           SUM(CASE WHEN type = 'file' THEN 1 ELSE 0 END) AS file,
           SUM(CASE WHEN type = 'terminal' THEN 1 ELSE 0 END) AS tool
         FROM artifacts WHERE run_id = ?`
      ).get(this.input.runId) as { diff: number | null; file: number | null; tool: number | null } | undefined) ?? { diff: 0, file: 0, tool: 0 };
      return resolver({
        runId: this.input.runId,
        ...(finalAssistantText !== undefined ? { finalAssistantText } : {}),
        artifactCounts: {
          diff: artifactCounts.diff ?? 0,
          file: artifactCounts.file ?? 0,
          tool: artifactCounts.tool ?? 0
        },
        ...(extra.cancelled !== undefined ? { cancelled: extra.cancelled } : {}),
        ...(extra.failureClass !== undefined ? { failureClass: extra.failureClass } : {}),
        ...(extra.failureReason !== undefined ? { failureReason: extra.failureReason } : {})
      });
    } catch {
      // Brief generation must never crash the lifecycle finalize. Fall back to empty.
      return undefined;
    }
  }

  private finalAssistantText(): string | undefined {
    const db = this.input.database;
    if (db === undefined) return undefined;
    try {
      const lastAssistant = db.sqlite.prepare(
        `SELECT id FROM messages
         WHERE run_id = ? AND sender_type = 'agent' AND role = 'assistant' AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT 1`
      ).get(this.input.runId) as { readonly id: string } | undefined;
      if (lastAssistant === undefined) return undefined;
      const parts = db.sqlite.prepare(
        "SELECT payload FROM message_parts WHERE message_id = ? AND part_type IN ('text','code') ORDER BY seq ASC"
      ).all(lastAssistant.id) as Array<{ readonly payload: string }>;
      const joined = parts
        .map((row) => {
          const parsed = parseJsonRecord(row.payload);
          return typeof parsed?.text === "string" ? parsed.text : "";
        })
        .filter((text) => text.length > 0)
        .join("\n")
        .trim();
      return joined.length > 0 ? joined : undefined;
    } catch {
      return undefined;
    }
  }
}

function zeroCost(): Cost {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId: "unknown" };
}

function isTerminalTool(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "bash" || normalized === "terminal" || normalized.endsWith(".bash") || normalized.endsWith("/bash") || normalized.includes("terminal");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function shouldAutoContinueFinalAssistantText(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (normalized.length === 0) return false;
  if (EXPLICIT_LIMITATION_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return CONTINUATION_PROMISE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isContinuableWakeReason(value: string | undefined): value is WakeReason {
  return value !== undefined && CONTINUABLE_WAKE_REASONS.has(value as WakeReason);
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return isRecord(value) && typeof value.then === "function";
}

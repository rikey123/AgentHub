import { randomUUID } from "node:crypto";

import type { Command, CommandBus, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import type { EventType } from "@agenthub/protocol/events";

import { RunLifecycleService, type Cost } from "./run-lifecycle-service.ts";

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
  readonly beginRun?: (input: { readonly runId: string; readonly workspaceId: string; readonly roomId: string; readonly agentId: string; readonly taskId?: string; readonly messageId?: string; readonly mode?: string; readonly terminalEnabled?: boolean; readonly workDir?: string }) => void;
  readonly writeTextFile: (input: { readonly runId: string; readonly path: string; readonly content: string }) => void;
  readonly deleteFile: (input: { readonly runId: string; readonly path: string }) => void;
  readonly buildRunArtifact: (input: { readonly runId: string; readonly title?: string }) => unknown;
  readonly buildWorktreeDiffArtifact?: (input: { readonly runId: string; readonly title?: string }) => unknown;
};

export class AdapterBridge {
  private readonly toolNamesByCallId = new Map<string, string>();
  private watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  private level2Timer: ReturnType<typeof setTimeout> | undefined;
  private turnCount = 0;
  private turnLimitTriggered = false;
  private readonly seenMessageIds = new Set<string>();
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
      if (cancelled) this.input.lifecycle.cancelFinalized(null, this.input.runId, briefText);
      else this.input.lifecycle.complete(null, this.input.runId, event.cost ?? zeroCost(), briefText);
      if (this.input.wakeReason === "plan") void Promise.resolve(this.input.onPlanPhaseEnded?.(this.input.runId));
      if (this.input.taskId !== undefined && !this.hasRecordedCompletionReport(this.input.taskId)) {
        void Promise.resolve(this.input.onSessionEndedWithoutCompletion?.(this.input.taskId));
      }
      return;
    }
    if (event.type === "session.crashed") {
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

  // ---------------------------------------------------------------------------
  // Inactivity watchdog
  // ---------------------------------------------------------------------------

  private resetWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = undefined;
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
      const lastAssistant = db.sqlite.prepare(
        `SELECT id FROM messages
         WHERE run_id = ? AND sender_type = 'agent' AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      ).get(this.input.runId) as { readonly id: string } | undefined;
      let finalAssistantText: string | undefined;
      if (lastAssistant !== undefined) {
        const parts = db.sqlite.prepare(
          "SELECT payload FROM message_parts WHERE message_id = ? AND part_type IN ('text','code') ORDER BY seq ASC"
        ).all(lastAssistant.id) as Array<{ readonly payload: string }>;
        const joined = parts
          .map((row) => {
            try {
              const parsed = JSON.parse(row.payload) as { text?: unknown };
              return typeof parsed.text === "string" ? parsed.text : "";
            } catch { return ""; }
          })
          .filter((t) => t.length > 0)
          .join("\n");
        if (joined.length > 0) finalAssistantText = joined;
      }
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

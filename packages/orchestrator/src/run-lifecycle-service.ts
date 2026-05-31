import { randomUUID } from "node:crypto";

import type { AgentHubDatabase } from "@agenthub/db";
import type { EventType } from "@agenthub/protocol/events";
import type { EventBus, PublishInput } from "@agenthub/bus";

export type SqliteTx = AgentHubDatabase["sqlite"];

export type RunStatus =
  | "queued"
  | "waiting"
  | "claimed"
  | "starting"
  | "running"
  | "waiting_permission"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type RunFailureClass =
  | "transient"
  | "retryable_visible"
  | "fresh_session_required"
  | "permission_denied"
  | "permission_expired"
  | "user_cancelled"
  | "configuration"
  | "fatal";

export type WakeReason =
  | "primary_turn"
  | "user_mention"
  | "delegated_task"
  | "task_review"
  | "task_blocked"
  | "rule_review"
  | "knock_approved"
  | "group_review"
  | "phase_completed"
  | "agent_crashed"
  | "consume_pending_turn"
  | "mailbox_message"
  // V1.1 additions
  | "plan"          // leader's planning-phase wake (D8)
  | "execute"       // leader's execution-phase wake immediately after plan (D8)
  | "agent_stalled"; // Level-2 timeout escalation wake (D4)

export type AgentPromptDelta =
  | { readonly kind: "first_wake"; readonly fullRolePrompt: string }
  | { readonly kind: "delta_only"; readonly instructions: string };

export type Cost = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly costUsd: number;
  readonly modelId: string;
};

export type CreateRunInput = {
  readonly runId: string;
  readonly agentId: string;
  readonly roomId: string;
  readonly taskId?: string;
  readonly workspaceId: string;
  readonly wakeReason: WakeReason;
  readonly workspaceMode?: "isolated_worktree" | "isolated_copy" | "shadow_buffer" | "shared" | "external";
  readonly parentRunId?: string;
  readonly targetFiles?: readonly string[];
  readonly promptDelta?: AgentPromptDelta;
  readonly mailboxClaimIds?: readonly string[];
  readonly carryNextTurnIds?: readonly string[];
  readonly sourceRunId?: string;
  readonly triggerEventId?: string;
  readonly messageId?: string;
  readonly pendingTurnId?: string;
};

export type RunRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly task_id: string | null;
  readonly room_id: string;
  readonly agent_id: string;
  readonly adapter_id: string | null;
  readonly adapter_session_id: string | null;
  readonly provider_conversation_id: string | null;
  readonly parent_run_id: string | null;
  readonly status: RunStatus;
  readonly wake_reason: string | null;
  readonly waiting_reason: string | null;
  readonly workspace_path: string | null;
  readonly work_dir: string | null;
  readonly workspace_mode: string | null;
  readonly context_version: number | null;
  readonly target_files: string;
  readonly mailbox_claim_count: number;
  readonly pid_at_start: number | null;
  readonly claimed_at: number | null;
  readonly started_at: number | null;
  readonly ended_at: number | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly cached_tokens: number | null;
  readonly cost_usd: number | null;
  readonly model_id: string | null;
  readonly failure_class: RunFailureClass | null;
  readonly error: string | null;
  readonly created_at: number;
  readonly updated_at: number;
};

export type RunLifecycleSideEffects = {
  readonly onRunning?: (runId: string) => void;
  readonly onCompleted?: (runId: string) => void;
  readonly onFailed?: (runId: string, failureClass: RunFailureClass) => void;
  readonly onTerminal?: (runId: string) => void;
  readonly finalizeNextTurns?: (tx: SqliteTx, runId: string, failureClass: RunFailureClass, now: number) => void;
  readonly onTargetUnavailable?: (tx: SqliteTx, runId: string) => void;
};

export class RunLifecycleError extends Error {
  constructor(readonly code: "not_found" | "illegal_transition" | "invalid_failure_class" | "stale_next_turn", message: string) {
    super(message);
    this.name = "RunLifecycleError";
  }
}

export class RunLifecycleService {
  private readonly now: () => number;
  private readonly sideEffects: RunLifecycleSideEffects;
  private readonly permissionRequests = new Map<string, Set<string>>();

  constructor(
    private readonly database: AgentHubDatabase,
    private readonly eventBus: EventBus,
    options: { readonly now?: () => number; readonly sideEffects?: RunLifecycleSideEffects } = {}
  ) {
    this.now = options.now ?? Date.now;
    this.sideEffects = options.sideEffects ?? {};
  }

  create(tx: SqliteTx | null, input: CreateRunInput): RunRow {
    return this.withTransaction(tx, (db) => {
      const now = this.now();
      if ((input.carryNextTurnIds?.length ?? 0) > 0) {
        if (!input.sourceRunId) {
          throw new RunLifecycleError("stale_next_turn", "sourceRunId is required when carrying next turns");
        }
        const carried = input.carryNextTurnIds ?? [];
        const placeholders = carried.map(() => "?").join(", ");
        const result = db
          .prepare(
            `UPDATE run_next_turns SET run_id = ?, consumed_at = NULL
             WHERE id IN (${placeholders}) AND room_id = ? AND agent_id = ? AND run_id = ? AND consumed_at IS NULL`
          )
          .run(input.runId, ...carried, input.roomId, input.agentId, input.sourceRunId);
        if (result.changes !== carried.length) {
          throw new RunLifecycleError("stale_next_turn", "carryNextTurnIds did not match unconsumed source rows");
        }
      }

      const participant = db
        .prepare("SELECT adapter_id FROM room_participants WHERE room_id = ? AND participant_id = ? AND participant_type = 'agent' LIMIT 1")
        .get(input.roomId, input.agentId) as { readonly adapter_id: string | null } | undefined;

      db.prepare(
        `INSERT INTO runs (
          id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id,
          parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version,
          target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens,
          cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'queued', ?, NULL, NULL, NULL, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
      ).run(
        input.runId,
        input.workspaceId,
        input.taskId ?? null,
        input.roomId,
        input.agentId,
        participant?.adapter_id ?? null,
        input.parentRunId ?? null,
        input.wakeReason,
        input.workspaceMode ?? null,
        JSON.stringify([...(input.targetFiles ?? [])]),
        input.mailboxClaimIds?.length ?? 0,
        now,
        now
      );
      this.publishRunEvent(db, "agent.run.queued", input.runId, input.workspaceId, input.roomId, input.agentId, {
        runId: input.runId,
        roomId: input.roomId,
        agentId: input.agentId,
        wakeReason: input.wakeReason,
        targetFiles: input.targetFiles ?? [],
        mailboxClaimCount: input.mailboxClaimIds?.length ?? 0,
        promptDelta: input.promptDelta,
        messageId: input.messageId,
        pendingTurnId: input.pendingTurnId
      }, input.triggerEventId);
      return this.getRun(db, input.runId);
    });
  }

  markWaiting(tx: SqliteTx | null, runId: string, reason: string): void {
    this.withTransaction(tx, (db) => {
      const run = this.getRun(db, runId);
      if (run.status === "waiting" && run.waiting_reason === reason) return;
      this.requireStatus(run, ["queued"], "markWaiting");
      this.updateStatus(db, runId, "waiting", { waiting_reason: reason });
      this.publishRunEvent(db, "agent.run.waiting", runId, run.workspace_id, run.room_id, run.agent_id, { runId, reason });
    });
  }

  markClaimed(tx: SqliteTx | null, runId: string): void {
    this.withTransaction(tx, (db) => {
      const run = this.getRun(db, runId);
      if (run.status === "claimed") return;
      this.requireStatus(run, ["queued", "waiting"], "markClaimed");
      this.updateStatus(db, runId, "claimed", { claimed_at: this.now(), waiting_reason: null });
    });
  }

  markStarting(tx: SqliteTx | null, runId: string, pidAtStart: number): void {
    this.withTransaction(tx, (db) => {
      const run = this.getRun(db, runId);
      this.requireStatus(run, ["claimed"], "markStarting");
      const now = this.now();
      this.updateStatus(db, runId, "starting", { pid_at_start: pidAtStart, started_at: now });
      this.publishRunEvent(db, "agent.run.started", runId, run.workspace_id, run.room_id, run.agent_id, { runId, pidAtStart, ...(run.task_id !== null ? { taskId: run.task_id } : {}), ...(run.parent_run_id !== null ? { parentRunId: run.parent_run_id } : {}) });
    });
  }

  markRunning(tx: SqliteTx | null, runId: string, adapterSessionId: string): void {
    this.withTransaction(tx, (db) => {
      const run = this.getRun(db, runId);
      this.requireStatus(run, ["starting", "waiting_permission"], "markRunning");
      this.updateStatus(db, runId, "running", { adapter_session_id: adapterSessionId, waiting_reason: null });
      if (run.status === "waiting_permission") {
        this.publishRunEvent(db, "agent.run.resumed", runId, run.workspace_id, run.room_id, run.agent_id, { runId, adapterSessionId });
      }
    });
    this.sideEffects.onRunning?.(runId);
  }

  markWaitingPermission(tx: SqliteTx | null, runId: string, permissionId: string): void {
    this.withTransaction(tx, (db) => {
      const run = this.getRun(db, runId);
      this.requireStatus(run, ["running", "waiting_permission"], "markWaitingPermission");
      const requests = this.permissionRequests.get(runId) ?? new Set<string>();
      const wasAdded = !requests.has(permissionId);
      requests.add(permissionId);
      this.permissionRequests.set(runId, requests);
      if (wasAdded && requests.size === 1) {
        this.updateStatus(db, runId, "waiting_permission", { waiting_reason: `permission:${permissionId}` });
        this.publishRunEvent(db, "agent.run.waiting_permission", runId, run.workspace_id, run.room_id, run.agent_id, { runId, permissionId });
      }
    });
  }

  markPermissionResolved(tx: SqliteTx | null, runId: string, permissionId: string): void {
    this.withTransaction(tx, (db) => {
      const requests = this.permissionRequests.get(runId);
      if (!requests || !requests.has(permissionId)) return;

      requests.delete(permissionId);
      if (requests.size > 0) return;

      this.permissionRequests.delete(runId);
      const run = this.getRun(db, runId);
      if (run.adapter_session_id === null) return;
      this.markRunning(db, runId, run.adapter_session_id);
    });
  }

  markCancelling(tx: SqliteTx | null, runId: string): void {
    this.withTransaction(tx, (db) => {
      const run = this.getRun(db, runId);
      if (run.status === "cancelling") return;
      this.requireStatus(run, ["queued", "waiting", "claimed", "starting", "running", "waiting_permission"], "markCancelling");
      this.updateStatus(db, runId, "cancelling", { waiting_reason: null });
    });
  }

  complete(tx: SqliteTx | null, runId: string, cost: Cost, briefText?: string): void {
    this.withTransaction(tx, (db) => {
      const run = this.getRun(db, runId);
      this.requireStatus(run, ["starting", "running", "waiting_permission"], "complete");
      this.updateStatus(db, runId, "completed", {
        ended_at: this.now(),
        input_tokens: cost.inputTokens,
        output_tokens: cost.outputTokens,
        cached_tokens: cost.cachedTokens,
        cost_usd: cost.costUsd,
        model_id: cost.modelId,
        waiting_reason: null
      });
      this.publishRunEvent(db, "agent.run.completed", runId, run.workspace_id, run.room_id, run.agent_id, { runId, cost });
      this.publishBriefEvent(db, runId, run.workspace_id, run.room_id, run.agent_id, briefText);
    });
    this.sideEffects.onCompleted?.(runId);
    this.sideEffects.onTerminal?.(runId);
  }

  fail(tx: SqliteTx | null, runId: string, reason: string, failureClass: RunFailureClass, error?: string, briefText?: string): void {
    if (!isFailureClass(failureClass)) {
      throw new RunLifecycleError("invalid_failure_class", `Invalid failureClass '${String(failureClass)}'`);
    }
    this.withTransaction(tx, (db) => {
      const run = this.getRun(db, runId);
      this.requireStatus(run, ["queued", "waiting", "claimed", "starting", "running", "waiting_permission", "cancelling"], "fail");
      const now = this.now();
      this.updateStatus(db, runId, "failed", { ended_at: now, failure_class: failureClass, error: error ?? reason, waiting_reason: null });
      if (failureClass === "transient" || failureClass === "retryable_visible" || failureClass === "fresh_session_required") {
        db.prepare("UPDATE mailbox_messages SET read = 0, claimed_run_id = NULL, claimed_at = NULL, delivery_batch_id = NULL WHERE claimed_run_id = ?").run(runId);
      } else if (failureClass === "configuration" || failureClass === "fatal") {
        this.sideEffects.onTargetUnavailable?.(db, runId);
      }
      this.sideEffects.finalizeNextTurns?.(db, runId, failureClass, now);
      if (run.task_id !== null) {
        const lastAssistantText = this.getLastAssistantText(db, run.id);
        const filesTouched = this.getFilesTouched(db, run.id);
        db.prepare(
          "INSERT INTO task_checkpoints (id, task_id, run_id, progress_summary, files_touched, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(randomUUID(), run.task_id, run.id, lastAssistantText.slice(0, 2000), JSON.stringify(filesTouched), this.now());
      }
      this.publishRunEvent(db, "agent.run.failed", runId, run.workspace_id, run.room_id, run.agent_id, { runId, reason, failureClass, error });
      this.publishBriefEvent(db, runId, run.workspace_id, run.room_id, run.agent_id, briefText);
    });
    this.sideEffects.onFailed?.(runId, failureClass);
    this.sideEffects.onTerminal?.(runId);
  }

  cancelFinalized(tx: SqliteTx | null, runId: string, briefText?: string): void {
    this.withTransaction(tx, (db) => {
      const run = this.getRun(db, runId);
      this.requireStatus(run, ["cancelling"], "cancelFinalized");
      this.updateStatus(db, runId, "cancelled", { ended_at: this.now(), failure_class: "user_cancelled", waiting_reason: null });
      if (run.task_id !== null) {
        const lastAssistantText = this.getLastAssistantText(db, run.id);
        const filesTouched = this.getFilesTouched(db, run.id);
        db.prepare(
          "INSERT INTO task_checkpoints (id, task_id, run_id, progress_summary, files_touched, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(randomUUID(), run.task_id, run.id, lastAssistantText.slice(0, 2000), JSON.stringify(filesTouched), this.now());
      }
      this.publishRunEvent(db, "agent.run.cancelled", runId, run.workspace_id, run.room_id, run.agent_id, { runId });
      this.publishBriefEvent(db, runId, run.workspace_id, run.room_id, run.agent_id, briefText);
    });
    this.sideEffects.onTerminal?.(runId);
  }

  updateSessionState(
    tx: SqliteTx | null,
    runId: string,
    patch: Partial<{ readonly adapterSessionId: string; readonly workDir: string; readonly providerConversationId: string; readonly pidAtStart: number }>
  ): void {
    this.withTransaction(tx, (db) => {
      this.getRun(db, runId);
      const assignments: string[] = ["updated_at = ?"];
      const params: unknown[] = [this.now()];
      if (patch.adapterSessionId !== undefined) {
        assignments.push("adapter_session_id = ?");
        params.push(patch.adapterSessionId);
      }
      if (patch.workDir !== undefined) {
        assignments.push("work_dir = ?");
        params.push(patch.workDir);
      }
      if (patch.providerConversationId !== undefined) {
        assignments.push("provider_conversation_id = ?");
        params.push(patch.providerConversationId);
      }
      if (patch.pidAtStart !== undefined) {
        assignments.push("pid_at_start = ?");
        params.push(patch.pidAtStart);
      }
      params.push(runId);
      db.prepare(`UPDATE runs SET ${assignments.join(", ")} WHERE id = ?`).run(...params);
    });
  }

  read(runId: string): RunRow {
    return this.getRun(this.database.sqlite, runId);
  }

  private withTransaction<T>(tx: SqliteTx | null, fn: (db: SqliteTx) => T): T {
    if (tx) return fn(tx);
    return this.database.sqlite.transaction(() => fn(this.database.sqlite))();
  }

  private getRun(db: SqliteTx, runId: string): RunRow {
    const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
    if (!row) throw new RunLifecycleError("not_found", `Run '${runId}' not found`);
    return row;
  }

  private getLastAssistantText(db: SqliteTx, runId: string): string {
    const msg = db.prepare(
      "SELECT id FROM messages WHERE run_id = ? AND role = 'assistant' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
    ).get(runId) as { id: string } | undefined;
    if (!msg) return "";
    const parts = db.prepare(
      "SELECT payload FROM message_parts WHERE message_id = ? AND part_type IN ('text','code') ORDER BY seq ASC"
    ).all(msg.id) as { payload: string }[];
    return parts
      .map((p) => {
        try {
          return (JSON.parse(p.payload) as { text?: string }).text ?? "";
        } catch {
          return "";
        }
      })
      .join("\n")
      .trim();
  }

  private getFilesTouched(db: SqliteTx, runId: string): string[] {
    const rows = db.prepare(
      "SELECT DISTINCT json_extract(payload, '$.path') AS path FROM events WHERE run_id = ? AND type = 'file.changed'"
    ).all(runId) as { path: string | null }[];
    return rows.map((r) => r.path).filter((p): p is string => p !== null);
  }

  private requireStatus(run: RunRow, allowed: readonly RunStatus[], method: string): void {
    if (!allowed.includes(run.status)) {
      throw new RunLifecycleError("illegal_transition", `${method} cannot transition run '${run.id}' from '${run.status}'`);
    }
  }

  private updateStatus(db: SqliteTx, runId: string, status: RunStatus, patch: Record<string, unknown>): void {
    const assignments = ["status = ?", "updated_at = ?", ...Object.keys(patch).map((key) => `${key} = ?`)];
    db.prepare(`UPDATE runs SET ${assignments.join(", ")} WHERE id = ?`).run(status, this.now(), ...Object.values(patch), runId);
  }

  private publishRunEvent(
    db: SqliteTx,
    type: Extract<EventType, `agent.run.${string}`>,
    runId: string,
    workspaceId: string,
    roomId: string,
    agentId: string,
    payload: unknown,
    causationId?: string
  ): void {
    this.eventBus.publish({
      id: randomUUID(),
      type,
      schemaVersion: 1,
      workspaceId,
      roomId,
      runId,
      agentId,
      ...(causationId !== undefined ? { causationId } : {}),
      payload,
      createdAt: this.now()
    } satisfies PublishInput);
    void db;
  }

  private publishBriefEvent(db: SqliteTx, runId: string, workspaceId: string, roomId: string, agentId: string, briefText?: string): void {
    this.eventBus.publish({
      id: randomUUID(),
      type: "message.brief.published",
      schemaVersion: 1,
      workspaceId,
      roomId,
      runId,
      agentId,
      payload: { text: briefText ?? "" },
      createdAt: this.now()
    } satisfies PublishInput);
    db.prepare(
      `UPDATE messages SET brief_published_at = :now
       WHERE run_id = :runId AND role = 'assistant' AND status = 'completed'`
    ).run({ now: this.now(), runId });
  }
}

function isFailureClass(value: unknown): value is RunFailureClass {
  return (
    value === "transient" ||
    value === "retryable_visible" ||
    value === "fresh_session_required" ||
    value === "permission_denied" ||
    value === "permission_expired" ||
    value === "user_cancelled" ||
    value === "configuration" ||
    value === "fatal"
  );
}

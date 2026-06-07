import { randomUUID } from "node:crypto";

import type { AgentHubDatabase } from "@agenthub/db";
import type { EventBus } from "@agenthub/bus";

import { RunLifecycleService, type RunRow } from "./run-lifecycle-service.ts";
import { TaskService, type TaskStatus } from "./task-service.ts";

export type CrashRecoveryMode = "resumable" | "restartable" | "fail_run";

export type ReclaimAdapter = {
  readonly crashRecovery: CrashRecoveryMode;
  attachSession?(input: { readonly runId: string; readonly adapterSessionId: string; readonly workDir?: string; readonly providerConversationId?: string }): void | Promise<void>;
};

export type ReclaimAdapterResolver = (run: RunRow) => ReclaimAdapter | undefined;

export type TerminalDelegatedTaskRunReconciliation = {
  readonly checkedRunIds: readonly string[];
  readonly reviewDispatchRunIds: readonly string[];
  readonly reviewedTaskIds: readonly string[];
  readonly completedTaskIds: readonly string[];
  readonly blockedTaskIds: readonly string[];
};

type TerminalDelegatedTaskRunRow = {
  readonly run_id: string;
  readonly run_status: "completed" | "failed";
  readonly task_id: string;
  readonly task_status: TaskStatus;
  readonly expects_review: number;
  readonly room_mode: string;
  readonly workspace_id: string;
  readonly room_id: string;
};

export class StartupRecovery {
  constructor(
    private readonly database: AgentHubDatabase,
    private readonly lifecycle: RunLifecycleService,
    private readonly reclaim: ReclaimStaleClaimedRun,
    private readonly now: () => number = Date.now,
    private readonly currentPid: number = process.pid
  ) {}

  async run(): Promise<void> {
    this.database.sqlite.prepare("DELETE FROM run_locks").run();
    const rows = this.database.sqlite.prepare("SELECT * FROM runs WHERE status NOT IN ('completed', 'failed', 'cancelled') ORDER BY created_at ASC").all() as RunRow[];
    for (const run of rows) {
      if (run.status === "queued" || run.status === "waiting") continue;
      if (run.status === "claimed" && (run.claimed_at ?? 0) < this.now() - 30_000) {
        this.lifecycle.fail(null, run.id, "claim_aborted", "transient");
      } else if (run.status === "starting" && run.adapter_session_id === null) {
        this.lifecycle.fail(null, run.id, "daemon_restarted_before_session", "transient");
      } else if (
        (run.status === "starting" || run.status === "running" || run.status === "waiting_permission") &&
        run.adapter_session_id !== null &&
        run.pid_at_start !== this.currentPid
      ) {
        await this.reclaim.reclaimRun(run);
      } else if (run.status === "cancelling") {
        this.lifecycle.cancelFinalized(null, run.id);
      }
    }
  }
}

export function reconcileTerminalDelegatedTaskRuns(input: { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly taskService: TaskService; readonly now?: () => number }): TerminalDelegatedTaskRunReconciliation {
  const rows = input.database.sqlite
    .prepare(
      `SELECT r.id AS run_id,
              r.status AS run_status,
              r.task_id AS task_id,
              t.status AS task_status,
              t.expects_review AS expects_review,
              t.workspace_id AS workspace_id,
              t.room_id AS room_id,
              rooms.mode AS room_mode
       FROM runs r
       INNER JOIN tasks t ON t.id = r.task_id
       INNER JOIN rooms ON rooms.id = t.room_id
       WHERE r.wake_reason = 'delegated_task'
         AND r.status IN ('completed', 'failed')
         AND t.status IN ('pending', 'in_progress')
       ORDER BY COALESCE(r.ended_at, r.updated_at), r.id`
    )
    .all() as TerminalDelegatedTaskRunRow[];

  const checkedRunIds: string[] = [];
  const reviewDispatchRunIds: string[] = [];
  const reviewedTaskIds: string[] = [];
  const completedTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  const now = input.now?.() ?? Date.now();

  for (const row of rows) {
    checkedRunIds.push(row.run_id);
    const requiresReview = row.room_mode === "team" || row.expects_review !== 0;
    if (row.room_mode === "team" && row.expects_review === 0) {
      input.database.sqlite.transaction(() => {
        input.database.sqlite.prepare("UPDATE tasks SET expects_review = 1, updated_at = ? WHERE id = ? AND expects_review = 0").run(now, row.task_id);
        input.eventBus.publish(taskEvent("task.status.changed", row.workspace_id, row.room_id, row.task_id, {
          taskId: row.task_id,
          prevStatus: row.task_status,
          nextStatus: row.task_status,
          reason: "startup_reconciliation",
          expectsReview: true
        }, now));
      })();
    }

    if (row.task_status === "pending") {
      input.taskService.startDelegatedRun(row.task_id, row.run_id);
    }

    if (row.run_status === "completed") {
      if (requiresReview) {
        const review = input.taskService.review(row.task_id);
        if (review.ok) {
          pushUnique(reviewedTaskIds, row.task_id);
          pushUnique(reviewDispatchRunIds, row.run_id);
        }
        continue;
      }
      // V1.1: room.complete_task is the authoritative completion path (D6).
      // A completed run whose task is still pending/in_progress means room.complete_task
      // was never called (if it had been, task.status would already be completed/review/blocked
      // and the recovery query would not have returned this row). Always treat as
      // missing_completion_report — no auto-complete path exists in V1.1.
      const review = input.taskService.updateStatus({ taskId: row.task_id, status: "review", blockerReason: "missing_completion_report" });
      if (review.ok) {
        pushUnique(reviewedTaskIds, row.task_id);
        pushUnique(reviewDispatchRunIds, row.run_id);
      }
      continue;
    }

    const blocked = input.taskService.blockDelegatedRun(row.task_id, row.run_id);
    if (blocked.ok) {
      pushUnique(blockedTaskIds, row.task_id);
      if (requiresReview) pushUnique(reviewDispatchRunIds, row.run_id);
    }
  }

  return { checkedRunIds, reviewDispatchRunIds, reviewedTaskIds, completedTaskIds, blockedTaskIds };
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

function taskEvent(type: "task.status.changed", workspaceId: string, roomId: string, taskId: string, payload: Record<string, unknown>, createdAt: number) {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId, roomId, taskId, payload, createdAt };
}

export class ReclaimStaleClaimedRun {
  constructor(
    private readonly database: AgentHubDatabase,
    private readonly lifecycle: RunLifecycleService,
    private readonly resolveAdapter: ReclaimAdapterResolver,
    private readonly now: () => number = Date.now,
    private readonly currentPid: number = process.pid
  ) {}

  async scan(): Promise<void> {
    const rows = this.database.sqlite
      .prepare(
        `SELECT * FROM runs
         WHERE (status = 'claimed' AND claimed_at < ?)
            OR (status = 'starting' AND started_at < ? AND adapter_session_id IS NULL)
            OR (status IN ('starting', 'running', 'waiting_permission') AND adapter_session_id IS NOT NULL AND (pid_at_start IS NULL OR pid_at_start != ?))
         ORDER BY created_at ASC`
      )
      .all(this.now() - 30_000, this.now() - 60_000, this.currentPid) as RunRow[];
    for (const run of rows) {
      await this.reclaimRun(run);
    }
  }

  async reclaimRun(run: RunRow): Promise<void> {
    if (run.status === "claimed") {
      this.lifecycle.fail(null, run.id, "claim_aborted", "transient");
      return;
    }
    if (run.status === "starting" && run.adapter_session_id === null) {
      this.lifecycle.fail(null, run.id, "daemon_restarted_before_session", "transient");
      return;
    }

    const adapter = this.resolveAdapter(run);
    if (!adapter || adapter.crashRecovery === "fail_run") {
      this.lifecycle.fail(null, run.id, "daemon_restarted", "retryable_visible");
      return;
    }
    if (adapter.crashRecovery === "restartable") {
      this.database.sqlite.transaction(() => {
        this.lifecycle.fail(null, run.id, "daemon_restarted", "transient");
        this.enqueueRestartRecoveryWake(run);
      })();
      return;
    }

    try {
      if (!adapter.attachSession || !run.adapter_session_id) throw new Error("attachSession unavailable");
      await adapter.attachSession({
        runId: run.id,
        adapterSessionId: run.adapter_session_id,
        ...(run.work_dir !== null ? { workDir: run.work_dir } : {}),
        ...(run.provider_conversation_id !== null ? { providerConversationId: run.provider_conversation_id } : {})
      });
      if (run.status === "starting") {
        this.lifecycle.markRunning(null, run.id, run.adapter_session_id);
      }
      this.lifecycle.updateSessionState(null, run.id, { pidAtStart: this.currentPid });
    } catch (error) {
      this.lifecycle.fail(null, run.id, "reclaim_attach_failed", "fresh_session_required", error instanceof Error ? error.message : String(error));
    }
  }

  private enqueueRestartRecoveryWake(run: RunRow): void {
    if (run.room_id === null || run.agent_id === null) return;
    const payload = JSON.stringify({ runId: run.id });
    const existing = this.database.sqlite
      .prepare("SELECT id FROM wake_outbox WHERE room_id = ? AND agent_id = ? AND reason = 'restart_recovery' AND payload = ? AND status IN ('pending', 'dispatching', 'dispatched') LIMIT 1")
      .get(run.room_id, run.agent_id, payload);
    if (existing !== undefined) return;
    this.database.sqlite
      .prepare("INSERT INTO wake_outbox (id, room_id, agent_id, reason, payload, status, attempt_count, max_attempts, created_at, dispatch_after) VALUES (?, ?, ?, 'restart_recovery', ?, 'pending', 0, 3, ?, NULL)")
      .run(randomUUID(), run.room_id, run.agent_id, payload, this.now());
  }
}

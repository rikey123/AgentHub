import type { AgentHubDatabase } from "@agenthub/db";
import type { EventEnvelope } from "@agenthub/protocol/events";

import { RunLifecycleError, RunLifecycleService, type RunFailureClass, type RunRow, type SqliteTx } from "./run-lifecycle-service.ts";

export type AdapterExecutionManager = {
  runAgent(run: RunRow): void | Promise<void>;
};

export type RunQueueOptions = {
  readonly database: AgentHubDatabase;
  readonly lifecycle: RunLifecycleService;
  readonly adapterManager?: AdapterExecutionManager;
  readonly now?: () => number;
  readonly pid?: number;
  readonly lockTimeoutMs?: number;
};

export type LockAcquireResult =
  | { readonly ok: true; readonly locks: readonly LockRow[] }
  | { readonly ok: false; readonly reason: string };

export type LockRow = {
  readonly lockType: "agent" | "room" | "file" | "workspace";
  readonly lockKey: string;
  readonly workspaceId: string | null;
  readonly runId: string;
};

export class RunQueue {
  private readonly now: () => number;
  private readonly pid: number;
  private readonly lockTimeoutMs: number;

  constructor(private readonly options: RunQueueOptions) {
    this.now = options.now ?? Date.now;
    this.pid = options.pid ?? process.pid;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5 * 60 * 1000;
  }

  async scheduleTick(): Promise<void> {
    const rows = this.options.database.sqlite
      .prepare("SELECT * FROM runs WHERE status IN ('queued', 'waiting') ORDER BY created_at ASC LIMIT 25")
      .all() as RunRow[];

    for (const run of rows) {
      if (run.status === "waiting" && this.now() - run.updated_at > this.lockTimeoutMs) {
        const acquired = this.tryAcquireAllLocks(run);
        if (acquired.ok) {
          await this.startAcquiredRun(run);
          continue;
        }
        this.options.lifecycle.fail(null, run.id, "lock_timeout", "transient");
        continue;
      }
      await this.scheduleRun(run);
    }
  }

  releaseLocks(runId: string): void {
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("DELETE FROM run_locks WHERE run_id = ?").run(runId);
    })();
  }

  async handleEvent(event: Pick<EventEnvelope, "type" | "runId">): Promise<void> {
    if ((event.type === "agent.run.completed" || event.type === "agent.run.failed" || event.type === "agent.run.cancelled") && event.runId) {
      this.releaseLocks(event.runId);
      await this.scheduleTick();
    }
    if (event.type === "agent.run.queued") {
      await this.scheduleTick();
    }
  }

  tryAcquireAllLocks(run: RunRow): LockAcquireResult {
    return this.options.database.sqlite.transaction(() => this.tryAcquireAllLocksInTx(this.options.database.sqlite, run))();
  }

  private async scheduleRun(run: RunRow): Promise<void> {
    const acquired = this.tryAcquireAllLocks(run);
    if (!acquired.ok) {
      this.options.lifecycle.markWaiting(null, run.id, acquired.reason);
      return;
    }

    await this.startAcquiredRun(run);
  }

  private async startAcquiredRun(run: RunRow): Promise<void> {
    try {
      this.options.lifecycle.markClaimed(null, run.id);
      this.options.lifecycle.markStarting(null, run.id, this.pid);
      await this.options.adapterManager?.runAgent(this.options.lifecycle.read(run.id));
    } catch (error) {
      this.releaseLocks(run.id);
      if (error instanceof RunLifecycleError && error.code === "illegal_transition") {
        return;
      }
      this.options.lifecycle.fail(null, run.id, "adapter_start_failed", adapterStartFailureClass(this.options.database, run.id, error), error instanceof Error ? error.message : String(error));
    }
  }

  private tryAcquireAllLocksInTx(tx: SqliteTx, run: RunRow): LockAcquireResult {
    const locks = desiredLocks(run);
    const now = this.now();
    for (const lock of locks) {
      const direct = tx
        .prepare("SELECT run_id FROM run_locks WHERE lock_type = ? AND lock_key = ? AND run_id != ?")
        .get(lock.lockType, lock.lockKey, run.id) as { readonly run_id: string } | undefined;
      if (direct) return { ok: false, reason: `${lock.lockType}_lock_held_by:${direct.run_id}` };

      if (lock.lockType === "file") {
        const workspace = tx
          .prepare("SELECT run_id FROM run_locks WHERE lock_type = 'workspace' AND workspace_id = ? AND run_id != ? LIMIT 1")
          .get(lock.workspaceId, run.id) as { readonly run_id: string } | undefined;
        if (workspace) return { ok: false, reason: `workspace_lock_held_by:${workspace.run_id}` };
      }
      if (lock.lockType === "workspace") {
        const file = tx
          .prepare("SELECT run_id FROM run_locks WHERE lock_type = 'file' AND workspace_id = ? AND run_id != ? LIMIT 1")
          .get(lock.workspaceId, run.id) as { readonly run_id: string } | undefined;
        if (file) return { ok: false, reason: `file_locks_held_in_workspace:${run.workspace_id}` };
      }
    }

    const insert = tx.prepare("INSERT INTO run_locks (lock_type, lock_key, workspace_id, run_id, acquired_at) VALUES (?, ?, ?, ?, ?)");
    for (const lock of locks) {
      insert.run(lock.lockType, lock.lockKey, lock.workspaceId, run.id, now);
    }
    return { ok: true, locks };
  }
}

function desiredLocks(run: RunRow): readonly LockRow[] {
  const targetFiles = parseTargetFiles(run.target_files);
  const locks: LockRow[] = [{ lockType: "agent", lockKey: run.agent_id, workspaceId: null, runId: run.id }];
  if (isDelegatedIsolatedWorktreeRun(run)) return locks;

  locks.push({ lockType: "room", lockKey: run.room_id, workspaceId: null, runId: run.id });
  if (targetFiles.length === 0) {
    locks.push({ lockType: "workspace", lockKey: run.workspace_id, workspaceId: run.workspace_id, runId: run.id });
  } else {
    for (const file of [...new Set(targetFiles)].sort()) {
      locks.push({ lockType: "file", lockKey: `${run.workspace_id}:${file}`, workspaceId: run.workspace_id, runId: run.id });
    }
  }
  return locks;
}

function isDelegatedIsolatedWorktreeRun(run: RunRow): boolean {
  return run.workspace_mode === "isolated_worktree" && run.wake_reason === "delegated_task";
}

function parseTargetFiles(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
}

function adapterStartFailureClass(database: AgentHubDatabase, runId: string, error: unknown): RunFailureClass {
  if (hasAdapterStartDelivery(database, runId)) return "transient";
  return errorCode(error) === "prompt_in_flight" ? "transient" : "configuration";
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function hasAdapterStartDelivery(database: AgentHubDatabase, runId: string): boolean {
  const row = database.sqlite
    .prepare("SELECT 1 FROM mailbox_deliveries WHERE delivery_batch_id = ? AND run_id = ? LIMIT 1")
    .get(`adapter-start:${runId}`, runId);
  return row !== undefined;
}

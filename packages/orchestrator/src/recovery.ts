import type { AgentHubDatabase } from "@agenthub/db";

import { RunLifecycleService, type RunRow } from "./run-lifecycle-service.ts";

export type CrashRecoveryMode = "resumable" | "restartable" | "fail_run";

export type ReclaimAdapter = {
  readonly crashRecovery: CrashRecoveryMode;
  attachSession?(input: { readonly runId: string; readonly adapterSessionId: string; readonly workDir?: string; readonly providerConversationId?: string }): void | Promise<void>;
};

export type ReclaimAdapterResolver = (run: RunRow) => ReclaimAdapter | undefined;

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
      this.lifecycle.fail(null, run.id, "daemon_restarted", "transient");
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
}

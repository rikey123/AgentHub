import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import { randomUUID } from "node:crypto";

export type WakeOutboxDispatchItem = {
  readonly id: string;
  readonly roomId: string;
  readonly agentId: string;
  readonly reason: string;
  readonly payload?: string | undefined;
};

export type WakeOutboxDispatcher = {
  readonly start: () => void;
  readonly stop: () => void;
  readonly dispatchPending: () => Promise<readonly WakeOutboxDispatchItem[]>;
};

export type WakeOutboxDispatchResult = {
  readonly runId?: string;
};

export type WakeOutboxDispatcherOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly now?: () => number;
  readonly pollIntervalMs?: number;
  readonly dispatchWake?: (item: WakeOutboxDispatchItem) => Promise<WakeOutboxDispatchResult | void> | WakeOutboxDispatchResult | void;
};

type WakeOutboxRow = {
  readonly id: string;
  readonly room_id: string;
  readonly agent_id: string;
  readonly reason: string;
  readonly payload: string | null;
  readonly attempt_count: number;
  readonly max_attempts: number;
};

export function createWakeOutboxDispatcher(options: WakeOutboxDispatcherOptions): WakeOutboxDispatcher {
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const resetStartupRows = (): void => {
    options.database.sqlite
      .prepare("UPDATE wake_outbox SET status = 'pending', last_error = NULL WHERE status IN ('pending', 'dispatching')")
      .run();
  };

  const dispatchPending = async (): Promise<readonly WakeOutboxDispatchItem[]> => {
    const claimed = claimNext(options.database, now());
    if (claimed === undefined) return [];
    const item = rowToItem(claimed);
    try {
      const result = await options.dispatchWake?.(item);
      const runId = result?.runId ?? item.id;
      options.database.sqlite.transaction(() => {
        const dispatchedAt = now();
        const workspaceId = workspaceIdForRoom(options.database, item.roomId);
        options.database.sqlite
          .prepare("UPDATE wake_outbox SET status = 'dispatched', dispatched_at = ?, last_error = NULL WHERE id = ?")
          .run(dispatchedAt, item.id);
        options.eventBus.publish({
          id: randomUUID(),
          type: "wake_outbox.dispatched",
          schemaVersion: 1,
          workspaceId,
          roomId: item.roomId,
          agentId: item.agentId,
          runId,
          payload: { outboxId: item.id, runId },
          createdAt: dispatchedAt
        });
      })();
      return [item];
    } catch (error) {
      const nextAttempt = claimed.attempt_count + 1;
      const message = error instanceof Error ? error.message : String(error);
      const nextStatus = nextAttempt >= claimed.max_attempts ? "failed" : "pending";
      const dispatchAfter = nextStatus === "failed" ? null : now() + backoffMs(nextAttempt);
      options.database.sqlite
        .prepare("UPDATE wake_outbox SET status = ?, attempt_count = ?, last_error = ?, dispatch_after = ? WHERE id = ?")
        .run(nextStatus, nextAttempt, message, dispatchAfter, item.id);
      return [];
    }
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      resetStartupRows();
      timer = setInterval(() => {
        void dispatchPending();
      }, pollIntervalMs);
    },
    stop: () => {
      running = false;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    dispatchPending
  };
}

function claimNext(database: AgentHubDatabase, now: number): WakeOutboxRow | undefined {
  return database.sqlite.transaction(() => {
    const row = database.sqlite
      .prepare(
        `SELECT id, room_id, agent_id, reason, payload, attempt_count, max_attempts
         FROM wake_outbox
         WHERE status = 'pending'
           AND (dispatch_after IS NULL OR dispatch_after <= ?)
         ORDER BY created_at ASC, id ASC
         LIMIT 1`
      )
      .get(now) as WakeOutboxRow | undefined;
    if (row === undefined) return undefined;
    const claimed = database.sqlite
      .prepare("UPDATE wake_outbox SET status = 'dispatching' WHERE id = ? AND status = 'pending'")
      .run(row.id);
    return claimed.changes === 1 ? row : undefined;
  })();
}

function rowToItem(row: WakeOutboxRow): WakeOutboxDispatchItem {
  return {
    id: row.id,
    roomId: row.room_id,
    agentId: row.agent_id,
    reason: row.reason,
    ...(row.payload !== null ? { payload: row.payload } : {})
  };
}

function backoffMs(attempt: number): number {
  return 100 * (2 ** Math.max(0, attempt - 1));
}

function workspaceIdForRoom(database: AgentHubDatabase, roomId: string): string {
  const row = database.sqlite.prepare("SELECT workspace_id FROM rooms WHERE id = ?").get(roomId) as { readonly workspace_id: string } | undefined;
  return row?.workspace_id ?? "default-workspace";
}

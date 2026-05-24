import { randomUUID } from "node:crypto";

import type { EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

import type { AgentPromptDelta, SqliteTx, WakeReason } from "./run-lifecycle-service.ts";

export type AppendNextTurnInput = {
  readonly roomId: string;
  readonly agentId: string;
  readonly promptDelta?: AgentPromptDelta;
  readonly messageId?: string;
  readonly pendingTurnId?: string;
  readonly sourceReason: WakeReason;
  readonly sourceIdempotencyKey: string;
};

export class MailboxService {
  private readonly deliveryFailureDedupe = new Map<string, number>();

  constructor(private readonly database: AgentHubDatabase, private readonly now: () => number = Date.now, private readonly eventBus?: EventBus) {}

  claimUnread(tx: SqliteTx, input: { readonly roomId: string; readonly toAgentId: string; readonly runId: string; readonly limit?: number }): string[] {
    const rows = tx
      .prepare(
        `SELECT id FROM mailbox_messages
         WHERE room_id = ? AND to_agent_id = ? AND read = 0 AND claimed_run_id IS NULL AND delivery_failure_reason IS NULL
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(input.roomId, input.toAgentId, input.limit ?? 20) as { readonly id: string }[];
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const claimedAt = this.now();
    const result = tx
      .prepare(`UPDATE mailbox_messages SET read = 1, claimed_run_id = ?, claimed_at = ?, attempt_count = attempt_count + 1 WHERE id IN (${placeholders}) AND claimed_run_id IS NULL`)
      .run(input.runId, claimedAt, ...ids);
    if (result.changes !== ids.length) {
      this.publishDeliveryFailures(tx, ids, "claim_conflict", claimedAt);
      return [];
    }
    this.publishMaxRetryFailures(tx, ids, claimedAt);
    return ids;
  }

  appendNextTurn(tx: SqliteTx | null, runId: string, input: AppendNextTurnInput): { readonly appended: boolean } {
    if (!hasNextTurnInput(input)) return { appended: false };
    const write = (db: SqliteTx) => {
      db.prepare(
        `INSERT INTO run_next_turns (
          id, run_id, room_id, agent_id, prompt_delta_json, message_id, pending_turn_id,
          source_reason, source_idempotency_key, created_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        randomUUID(),
        runId,
        input.roomId,
        input.agentId,
        input.promptDelta === undefined ? "" : JSON.stringify(input.promptDelta),
        input.messageId ?? null,
        input.pendingTurnId ?? null,
        input.sourceReason,
        input.sourceIdempotencyKey,
        this.now()
      );
      return { appended: true } as const;
    };
    return tx ? write(tx) : this.database.sqlite.transaction(() => write(this.database.sqlite))();
  }

  finalizeForRun(tx: SqliteTx, runId: string, failureClass: string, now: number): void {
    if (failureClass === "permission_denied" || failureClass === "user_cancelled" || failureClass === "configuration" || failureClass === "fatal") {
      tx.prepare("UPDATE run_next_turns SET consumed_at = ? WHERE run_id = ? AND consumed_at IS NULL").run(now, runId);
    }
  }

  publishTargetUnavailable(tx: SqliteTx, mailboxMessageId: string): void {
    this.publishDeliveryFailures(tx, [mailboxMessageId], "target_unavailable", this.now());
  }

  private publishMaxRetryFailures(tx: SqliteTx, ids: readonly string[], failedAt: number): void {
    const rows = this.mailboxRows(tx, ids).filter((row) => row.attempt_count >= 5);
    for (const row of rows) this.publishDeliveryFailure(row, "max_retries", failedAt);
  }

  private publishDeliveryFailures(tx: SqliteTx, ids: readonly string[], reason: "claim_conflict" | "max_retries" | "target_unavailable", failedAt: number): void {
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(", ");
      tx.prepare(`UPDATE mailbox_messages SET delivery_failure_reason = ? WHERE id IN (${placeholders}) AND delivery_failure_reason IS NULL`).run(reason, ...ids);
    }
    for (const row of this.mailboxRows(tx, ids)) this.publishDeliveryFailure(row, reason, failedAt);
  }

  private mailboxRows(tx: SqliteTx, ids: readonly string[]): { readonly id: string; readonly workspace_id: string; readonly room_id: string; readonly to_agent_id: string; readonly attempt_count: number }[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    return tx.prepare(`SELECT id, workspace_id, room_id, to_agent_id, attempt_count FROM mailbox_messages WHERE id IN (${placeholders})`).all(...ids) as { readonly id: string; readonly workspace_id: string; readonly room_id: string; readonly to_agent_id: string; readonly attempt_count: number }[];
  }

  private publishDeliveryFailure(row: { readonly id: string; readonly workspace_id: string; readonly room_id: string; readonly to_agent_id: string; readonly attempt_count: number }, reason: "claim_conflict" | "max_retries" | "target_unavailable", failedAt: number): void {
    if (!this.eventBus) return;
    const key = `${row.id}:${reason}`;
    this.reapDeliveryFailureDedupe(failedAt);
    const previous = this.deliveryFailureDedupe.get(key);
    if (previous !== undefined && failedAt - previous < 5 * 60 * 1000) return;
    this.deliveryFailureDedupe.set(key, failedAt);
    while (this.deliveryFailureDedupe.size > 256) this.deliveryFailureDedupe.delete(this.deliveryFailureDedupe.keys().next().value as string);
    this.eventBus.publish(mailboxDeliveryFailedEvent(row, reason, failedAt));
  }

  private reapDeliveryFailureDedupe(now: number): void {
    for (const [key, createdAt] of this.deliveryFailureDedupe) {
      if (now - createdAt >= 5 * 60 * 1000) this.deliveryFailureDedupe.delete(key);
    }
  }
}

function mailboxDeliveryFailedEvent(row: { readonly id: string; readonly workspace_id: string; readonly room_id: string; readonly to_agent_id: string; readonly attempt_count: number }, reason: "claim_conflict" | "max_retries" | "target_unavailable", failedAt: number): PublishInput {
  return {
    id: randomUUID(),
    type: "mailbox.delivery.failed",
    schemaVersion: 1,
    workspaceId: row.workspace_id,
    roomId: row.room_id,
    agentId: row.to_agent_id,
    payload: { mailboxMessageId: row.id, roomId: row.room_id, targetAgentId: row.to_agent_id, reason, attemptCount: row.attempt_count, failedAt },
    createdAt: failedAt
  };
}

function hasNextTurnInput(input: AppendNextTurnInput): boolean {
  return input.messageId !== undefined || input.pendingTurnId !== undefined || hasMeaningfulPromptDelta(input.promptDelta);
}

export function hasMeaningfulPromptDelta(delta: AgentPromptDelta | undefined): boolean {
  if (!delta) return false;
  if (delta.kind === "first_wake") return delta.fullRolePrompt.trim().length > 0;
  return delta.instructions.trim().length > 0;
}

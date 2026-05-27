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
    if (failureClass === "transient" || failureClass === "retryable_visible" || failureClass === "fresh_session_required") {
      reopenAdapterStartNextTurns(tx, runId);
      return;
    }
    if (failureClass === "permission_denied" || failureClass === "user_cancelled" || failureClass === "configuration" || failureClass === "fatal") {
      tx.prepare("UPDATE run_next_turns SET consumed_at = ? WHERE run_id = ? AND consumed_at IS NULL").run(now, runId);
    }
  }

  readForRun(tx: SqliteTx | null, input: { readonly runId: string; readonly roomId: string; readonly agentId: string; readonly deliveryBatchId: string }): MailboxDeliveryBatch {
    const read = (db: SqliteTx) => readMailboxBatch(db, input, this.now());
    return tx ? read(tx) : this.database.sqlite.transaction(() => read(this.database.sqlite))();
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

export type MailboxMessageDelivery = {
  readonly id: string;
  readonly roomId: string;
  readonly fromType: string | null;
  readonly fromId: string | null;
  readonly fromName: string | null;
  readonly toAgentId: string;
  readonly kind: string;
  readonly text: string;
  readonly files: readonly string[];
  readonly createdAt: number;
};

export type NextTurnDelivery = {
  readonly id: string;
  readonly promptDelta?: AgentPromptDelta | undefined;
  readonly messageId?: string | undefined;
  readonly pendingTurnId?: string | undefined;
  readonly messageText?: string | undefined;
  readonly sourceReason: WakeReason | null;
  readonly sourceIdempotencyKey: string | null;
  readonly createdAt: number;
};

export type MailboxDeliveryBatch = {
  readonly deliveryBatchId: string;
  readonly runId: string;
  readonly mailbox: readonly MailboxMessageDelivery[];
  readonly nextTurns: readonly NextTurnDelivery[];
};

export function readMailboxBatch(db: SqliteTx, input: { readonly runId: string; readonly roomId: string; readonly agentId: string; readonly deliveryBatchId: string }, now: number): MailboxDeliveryBatch {
  const existing = db.prepare("SELECT mailbox_ids, next_turn_ids FROM mailbox_deliveries WHERE delivery_batch_id = ? AND run_id = ?").get(input.deliveryBatchId, input.runId) as { readonly mailbox_ids: string; readonly next_turn_ids: string } | undefined;
  if (existing !== undefined) {
    return {
      deliveryBatchId: input.deliveryBatchId,
      runId: input.runId,
      mailbox: mailboxRowsByIds(db, parseIdList(existing.mailbox_ids)),
      nextTurns: nextTurnRowsByIds(db, parseIdList(existing.next_turn_ids))
    };
  }

  const mailboxRows = db.prepare(
    `SELECT id FROM mailbox_messages
     WHERE room_id = ? AND to_agent_id = ? AND delivery_failure_reason IS NULL
       AND (
         (read = 0 AND claimed_run_id IS NULL)
         OR (claimed_run_id = ? AND (delivery_batch_id IS NULL OR delivery_batch_id = ?))
       )
     ORDER BY created_at ASC`
  ).all(input.roomId, input.agentId, input.runId, input.deliveryBatchId) as Array<{ readonly id: string }>;
  const nextTurnRows = db.prepare("SELECT id FROM run_next_turns WHERE run_id = ? AND room_id = ? AND agent_id = ? AND consumed_at IS NULL ORDER BY created_at ASC").all(input.runId, input.roomId, input.agentId) as Array<{ readonly id: string }>;
  const mailboxIds = mailboxRows.map((row) => row.id);
  const nextTurnIds = nextTurnRows.map((row) => row.id);

  if (mailboxIds.length > 0) {
    const placeholders = mailboxIds.map(() => "?").join(", ");
    const result = db.prepare(`UPDATE mailbox_messages SET read = 1, claimed_run_id = ?, claimed_at = ?, delivery_batch_id = ? WHERE id IN (${placeholders}) AND (claimed_run_id IS NULL OR claimed_run_id = ?)`).run(input.runId, now, input.deliveryBatchId, ...mailboxIds, input.runId);
    if (result.changes !== mailboxIds.length) throw new Error("MailboxDeliveryConflict");
  }
  if (nextTurnIds.length > 0) {
    const placeholders = nextTurnIds.map(() => "?").join(", ");
    const result = db.prepare(`UPDATE run_next_turns SET consumed_at = ? WHERE id IN (${placeholders}) AND run_id = ? AND consumed_at IS NULL`).run(now, ...nextTurnIds, input.runId);
    if (result.changes !== nextTurnIds.length) throw new Error("NextTurnDeliveryConflict");
  }
  db.prepare("INSERT INTO mailbox_deliveries (delivery_batch_id, run_id, mailbox_ids, next_turn_ids, delivered_at) VALUES (?, ?, ?, ?, ?)").run(input.deliveryBatchId, input.runId, JSON.stringify(mailboxIds), JSON.stringify(nextTurnIds), now);

  return {
    deliveryBatchId: input.deliveryBatchId,
    runId: input.runId,
    mailbox: mailboxRowsByIds(db, mailboxIds),
    nextTurns: nextTurnRowsByIds(db, nextTurnIds)
  };
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

function mailboxRowsByIds(db: SqliteTx, ids: readonly string[]): MailboxMessageDelivery[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT mb.id, mb.room_id, mb.from_type, mb.from_id, ap.name AS from_name, mb.to_agent_id, mb.kind, mb.content, mb.files, mb.created_at
     FROM mailbox_messages mb
     LEFT JOIN agent_profiles ap ON mb.from_type = 'agent' AND ap.id = mb.from_id
     WHERE mb.id IN (${placeholders})
     ORDER BY mb.created_at ASC`
  ).all(...ids) as Array<{ readonly id: string; readonly room_id: string; readonly from_type: string | null; readonly from_id: string | null; readonly from_name: string | null; readonly to_agent_id: string; readonly kind: string; readonly content: string; readonly files: string; readonly created_at: number }>;
  return rows.map((row) => ({
    id: row.id,
    roomId: row.room_id,
    fromType: row.from_type,
    fromId: row.from_id,
    fromName: row.from_name,
    toAgentId: row.to_agent_id,
    kind: row.kind,
    text: parseMailboxText(row.content),
    files: parseStringArray(row.files),
    createdAt: row.created_at
  }));
}

function nextTurnRowsByIds(db: SqliteTx, ids: readonly string[]): NextTurnDelivery[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT id, prompt_delta_json, message_id, pending_turn_id, source_reason, source_idempotency_key, created_at
     FROM run_next_turns
     WHERE id IN (${placeholders})
     ORDER BY created_at ASC`
  ).all(...ids) as Array<{ readonly id: string; readonly prompt_delta_json: string; readonly message_id: string | null; readonly pending_turn_id: string | null; readonly source_reason: WakeReason | null; readonly source_idempotency_key: string | null; readonly created_at: number }>;
  return rows.map((row) => {
    const promptDelta = parsePromptDelta(row.prompt_delta_json);
    const messageId = row.message_id ?? pendingTurnMessageId(db, row.pending_turn_id);
    return {
      id: row.id,
      ...(promptDelta !== undefined ? { promptDelta } : {}),
      ...(messageId !== undefined ? { messageId, messageText: messageText(db, messageId) } : {}),
      ...(row.pending_turn_id !== null ? { pendingTurnId: row.pending_turn_id } : {}),
      sourceReason: row.source_reason,
      sourceIdempotencyKey: row.source_idempotency_key,
      createdAt: row.created_at
    };
  });
}

function pendingTurnMessageId(db: SqliteTx, pendingTurnId: string | null): string | undefined {
  if (pendingTurnId === null) return undefined;
  const row = db.prepare("SELECT user_message_id FROM pending_turns WHERE id = ?").get(pendingTurnId) as { readonly user_message_id: string } | undefined;
  return row?.user_message_id;
}

export function messageText(db: SqliteTx, messageId: string): string | undefined {
  const rows = db.prepare("SELECT payload FROM message_parts WHERE message_id = ? AND part_type = 'text' ORDER BY seq ASC").all(messageId) as Array<{ readonly payload: string }>;
  const text = rows.map((row) => {
    try {
      const parsed = JSON.parse(row.payload) as { readonly text?: unknown };
      return typeof parsed.text === "string" ? parsed.text : "";
    } catch {
      return "";
    }
  }).filter((part) => part.length > 0).join("\n");
  return text.length > 0 ? text : undefined;
}

function parseMailboxText(value: string): string {
  try {
    const parsed = JSON.parse(value) as { readonly text?: unknown };
    if (typeof parsed.text === "string") return parsed.text;
  } catch {
    // Older rows may be plain text.
  }
  return value;
}

function parsePromptDelta(value: string): AgentPromptDelta | undefined {
  if (value.length === 0) return undefined;
  try {
    return JSON.parse(value) as AgentPromptDelta;
  } catch {
    return undefined;
  }
}

function parseIdList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function reopenAdapterStartNextTurns(tx: SqliteTx, runId: string): void {
  const row = tx
    .prepare("SELECT next_turn_ids FROM mailbox_deliveries WHERE delivery_batch_id = ? AND run_id = ?")
    .get(`adapter-start:${runId}`, runId) as { readonly next_turn_ids: string } | undefined;
  const ids = row !== undefined ? parseIdList(row.next_turn_ids) : [];
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  tx.prepare(`UPDATE run_next_turns SET consumed_at = NULL WHERE run_id = ? AND id IN (${placeholders})`).run(runId, ...ids);
}

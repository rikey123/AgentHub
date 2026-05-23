import { randomUUID } from "node:crypto";

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
  constructor(private readonly database: AgentHubDatabase, private readonly now: () => number = Date.now) {}

  claimUnread(tx: SqliteTx, input: { readonly roomId: string; readonly toAgentId: string; readonly runId: string; readonly limit?: number }): string[] {
    const rows = tx
      .prepare(
        `SELECT id FROM mailbox_messages
         WHERE room_id = ? AND to_agent_id = ? AND read = 0 AND claimed_run_id IS NULL
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(input.roomId, input.toAgentId, input.limit ?? 20) as { readonly id: string }[];
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const result = tx
      .prepare(`UPDATE mailbox_messages SET read = 1, claimed_run_id = ?, claimed_at = ? WHERE id IN (${placeholders}) AND claimed_run_id IS NULL`)
      .run(input.runId, this.now(), ...ids);
    return result.changes === ids.length ? ids : [];
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
}

function hasNextTurnInput(input: AppendNextTurnInput): boolean {
  return input.messageId !== undefined || input.pendingTurnId !== undefined || hasMeaningfulPromptDelta(input.promptDelta);
}

export function hasMeaningfulPromptDelta(delta: AgentPromptDelta | undefined): boolean {
  if (!delta) return false;
  if (delta.kind === "first_wake") return delta.fullRolePrompt.trim().length > 0;
  return delta.instructions.trim().length > 0;
}

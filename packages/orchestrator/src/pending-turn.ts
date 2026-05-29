import { randomUUID, createHash } from "node:crypto";

import type { AgentHubDatabase } from "@agenthub/db";
import type { Command, CommandBus, CommandErrorCode, CommandHandler, CommandMeta, CommandResult, EventBus, PublishInput } from "@agenthub/bus";

export type PendingTurnStatus = "queued" | "scheduled" | "consumed" | "cancelled";

export type PendingTurnRow = {
  readonly id: string;
  readonly room_id: string;
  readonly user_message_id: string;
  readonly primary_agent_id: string;
  readonly status: PendingTurnStatus;
  readonly enqueued_at: number;
  readonly scheduled_at: number | null;
  readonly cancelled_at: number | null;
  readonly notes: string | null;
};

type RunRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly room_id: string;
  readonly agent_id: string;
};

export class PendingTurnService {
  constructor(
    private readonly options: {
      readonly database: AgentHubDatabase;
      readonly eventBus: EventBus;
      readonly getCommandBus: () => CommandBus;
      readonly now?: () => number;
    }
  ) {}

  cancel(pendingTurnId: string, notes?: string): CommandResult {
    const row = this.find(pendingTurnId);
    if (!row) return failed("not_found", `PendingTurn '${pendingTurnId}' not found`);
    if (row.status !== "queued") return failed("conflict", `PendingTurn '${pendingTurnId}' is ${row.status}`);
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("UPDATE pending_turns SET status = 'cancelled', cancelled_at = ?, notes = ? WHERE id = ? AND status = 'queued'").run(now, notes ?? row.notes, pendingTurnId);
      const room = this.room(row.room_id);
      this.options.eventBus.publish(pendingTurnEvent("pending_turn.cancelled", row, room?.workspace_id ?? "default-workspace", { pendingTurnId, messageId: row.user_message_id }, now));
    })();
    return { ok: true, data: { pendingTurnId, status: "cancelled" }, emittedEvents: latestRoomEvents(this.options.database, row.room_id) };
  }

  consume(pendingTurnId: string, meta: CommandMeta): CommandResult | Promise<CommandResult> {
    if (meta.origin !== "internal") return failed("validation_failed", "ConsumePendingTurn is internal only");
    const row = this.find(pendingTurnId);
    if (!row) return failed("not_found", `PendingTurn '${pendingTurnId}' not found`);
    if (row.status !== "queued") return failed("conflict", `PendingTurn '${pendingTurnId}' is ${row.status}`);
    const room = this.room(row.room_id);
    if (!room) return failed("not_found", `Room '${row.room_id}' not found`);
    const text = this.messageText(row.user_message_id);
    const now = this.now();

    this.options.database.sqlite.transaction(() => {
      const updated = this.options.database.sqlite.prepare("UPDATE pending_turns SET status = 'scheduled', scheduled_at = ? WHERE id = ? AND status = 'queued'").run(now, pendingTurnId);
      if (updated.changes !== 1) throw new Error("pending_turn_schedule_conflict");
      const scheduled = { ...row, status: "scheduled" as const, scheduled_at: now };
      this.options.eventBus.publish(pendingTurnEvent("pending_turn.scheduled", scheduled, room.workspace_id, { pendingTurnId, messageId: row.user_message_id }, now));
    })();

    const wake = this.options.getCommandBus().dispatch(
      {
        type: "WakeAgent",
        roomId: row.room_id,
        agentId: row.primary_agent_id,
        workspaceId: room.workspace_id,
        reason: "consume_pending_turn",
        messageId: row.user_message_id,
        pendingTurnId: row.id,
        promptDelta: { kind: "delta_only", instructions: text },
        idempotencyKey: `pending-turn:${row.id}`
      },
      { actor: { type: "system" }, traceId: meta.traceId, idempotencyKey: `wake:pending-turn:${row.id}`, origin: "internal" }
    );
    if (isPromiseLike(wake)) return wake.then((result) => this.finishConsume(row, result));
    return this.finishConsume(row, wake);
  }

  handleTerminal(runId: string): void {
    const run = this.options.database.sqlite.prepare("SELECT id, workspace_id, room_id, agent_id FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
    if (!run) return;

    const nextTurns = this.options.database.sqlite
      .prepare("SELECT id FROM run_next_turns WHERE run_id = ? AND room_id = ? AND agent_id = ? AND consumed_at IS NULL ORDER BY created_at ASC LIMIT 20")
      .all(runId, run.room_id, run.agent_id) as { readonly id: string }[];
    if (nextTurns.length > 0) {
      const ids = nextTurns.map((row) => row.id);
      const key = hashKey(`${runId}:${ids.join(":")}`);
      void this.options.getCommandBus().dispatch(
        {
          type: "WakeAgent",
          roomId: run.room_id,
          agentId: run.agent_id,
          workspaceId: run.workspace_id,
          reason: "primary_turn",
          carryNextTurnIds: ids,
          sourceRunId: runId,
          idempotencyKey: `carry-next-turns:${key}`
        },
        { actor: { type: "system" }, traceId: `terminal:${runId}`, idempotencyKey: `wake:carry-next-turns:${key}`, origin: "internal" }
      );
      return;
    }

    const pending = this.options.database.sqlite
      .prepare("SELECT * FROM pending_turns WHERE room_id = ? AND primary_agent_id = ? AND status = 'queued' ORDER BY enqueued_at ASC LIMIT 1")
      .get(run.room_id, run.agent_id) as PendingTurnRow | undefined;
    if (!pending) return;
    void this.options.getCommandBus().dispatch(
      { type: "ConsumePendingTurn", pendingTurnId: pending.id, idempotencyKey: `consume-pending-turn:${pending.id}` },
      { actor: { type: "system" }, traceId: `terminal:${runId}`, idempotencyKey: `consume-pending-turn:${pending.id}`, origin: "internal" }
    );
  }

  private finishConsume(row: PendingTurnRow, wake: CommandResult): CommandResult {
    if (!wake.ok) {
      const now = this.now();
      const room = this.room(row.room_id);
      this.options.database.sqlite.transaction(() => {
        this.options.database.sqlite.prepare("UPDATE pending_turns SET status = 'queued', scheduled_at = NULL WHERE id = ? AND status = 'scheduled'").run(row.id);
        this.options.eventBus.publish(pendingTurnEvent("pending_turn.cancelled", { ...row, status: "queued" }, room?.workspace_id ?? "default-workspace", { pendingTurnId: row.id, messageId: row.user_message_id, reason: "wake_failed" }, now));
      })();
      return wake;
    }
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("UPDATE pending_turns SET status = 'consumed' WHERE id = ? AND status = 'scheduled'").run(row.id);
      const room = this.room(row.room_id);
      this.options.eventBus.publish(pendingTurnEvent("pending_turn.consumed", { ...row, status: "consumed" }, room?.workspace_id ?? "default-workspace", { pendingTurnId: row.id, messageId: row.user_message_id }, now));
    })();
    return { ok: true, data: { pendingTurnId: row.id, status: "consumed" }, emittedEvents: latestRoomEvents(this.options.database, row.room_id) };
  }

  private find(id: string): PendingTurnRow | undefined {
    return this.options.database.sqlite.prepare("SELECT * FROM pending_turns WHERE id = ?").get(id) as PendingTurnRow | undefined;
  }

  private room(roomId: string): { readonly workspace_id: string } | undefined {
    return this.options.database.sqlite.prepare("SELECT workspace_id FROM rooms WHERE id = ?").get(roomId) as { readonly workspace_id: string } | undefined;
  }

  private messageText(messageId: string): string {
    const rows = this.options.database.sqlite.prepare("SELECT payload FROM message_parts WHERE message_id = ? ORDER BY seq ASC").all(messageId) as { readonly payload: string }[];
    return rows.map((row) => textPayload(row.payload)).filter((text) => text.length > 0).join("\n");
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

export function createConsumePendingTurnHandler(service: PendingTurnService): CommandHandler {
  return (command: Command, meta: CommandMeta) => {
    const pendingTurnId = typeof command.pendingTurnId === "string" ? command.pendingTurnId : undefined;
    if (!pendingTurnId) return failed("validation_failed", "pendingTurnId is required");
    return service.consume(pendingTurnId, meta);
  };
}

export function createCancelPendingTurnHandler(service: PendingTurnService): CommandHandler {
  return (command: Command) => {
    const pendingTurnId = typeof command.pendingTurnId === "string" ? command.pendingTurnId : undefined;
    if (!pendingTurnId) return failed("validation_failed", "pendingTurnId is required");
    return service.cancel(pendingTurnId, typeof command.notes === "string" ? command.notes : undefined);
  };
}

function pendingTurnEvent(type: "pending_turn.created" | "pending_turn.cancelled" | "pending_turn.scheduled" | "pending_turn.consumed", row: Pick<PendingTurnRow, "id" | "room_id" | "user_message_id" | "primary_agent_id" | "status">, workspaceId: string, payload: Record<string, unknown>, createdAt: number): PublishInput {
  return {
    id: randomUUID(),
    type,
    schemaVersion: 1,
    workspaceId,
    roomId: row.room_id,
    agentId: row.primary_agent_id,
    payload: { roomId: row.room_id, pendingTurnId: row.id, messageId: row.user_message_id, status: row.status, ...payload },
    createdAt
  };
}

function textPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { readonly text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

function latestRoomEvents(database: AgentHubDatabase, roomId: string): { readonly seq: number; readonly type: string }[] {
  return database.sqlite.prepare("SELECT seq, type FROM events WHERE room_id = ? ORDER BY seq ASC").all(roomId) as { readonly seq: number; readonly type: string }[];
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

function failed(code: CommandErrorCode, message: string): CommandResult {
  return { ok: false, error: { code, message } };
}

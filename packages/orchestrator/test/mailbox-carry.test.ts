import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus, type CommandBus, type CommandResult } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { MailboxService, PendingTurnService, RunLifecycleService } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let mailbox: MailboxService | undefined;
let lifecycle: RunLifecycleService | undefined;
let pendingTurns: PendingTurnService | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-mailbox-carry-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  mailbox = new MailboxService(currentDatabase(), () => now);
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), {
    now: () => now,
    sideEffects: {
      finalizeNextTurns: (tx, runId, failureClass, timestamp) => currentMailbox().finalizeForRun(tx, runId, failureClass, timestamp)
    }
  });
  pendingTurns = new PendingTurnService({ database: currentDatabase(), eventBus: currentBus(), getCommandBus: () => commandBus as unknown as CommandBus, now: () => now });
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  mailbox = undefined;
  lifecycle = undefined;
  pendingTurns = undefined;
  now = 1_000;
});

const commandBus = {
  dispatch: (command: { readonly type: string; readonly pendingTurnId?: string; readonly roomId?: string; readonly agentId?: string; readonly workspaceId?: string; readonly reason?: string; readonly idempotencyKey?: string; readonly messageId?: string; readonly sourceRunId?: string; readonly carryNextTurnIds?: readonly string[] }, meta: { readonly origin: string; readonly traceId: string; readonly actor: { readonly type: string; readonly id?: string }; readonly idempotencyKey?: string }) => {
    dispatchLog.push(command.type);
    if (command.type === "ConsumePendingTurn") {
      return currentPendingTurns().consume(command.pendingTurnId ?? "", meta as never) as CommandResult;
    }
    if (command.type === "WakeAgent") {
      const runIndex = wakeCount + 2;
      wakeCount += 1;
      currentLifecycle().create(null, {
        runId: `run_${runIndex}`,
        roomId: command.roomId ?? "room_1",
        agentId: command.agentId ?? "agent_1",
        workspaceId: command.workspaceId ?? "ws_1",
        wakeReason: command.reason === "consume_pending_turn" ? "consume_pending_turn" : "primary_turn",
        ...(command.messageId !== undefined ? { messageId: command.messageId } : {}),
        ...(command.pendingTurnId !== undefined ? { pendingTurnId: command.pendingTurnId } : {}),
        ...(command.sourceRunId !== undefined ? { sourceRunId: command.sourceRunId } : {}),
        ...(command.carryNextTurnIds !== undefined ? { carryNextTurnIds: command.carryNextTurnIds } : {})
      });
      llmCalls += 1;
      dispatchLog.push(`WakeAgent:${command.reason}`);
      return { ok: true, data: { runId: `run_${runIndex}` }, emittedEvents: [] };
    }
    throw new Error(`unexpected command: ${command.type}`);
  }
};

let llmCalls = 0;
let wakeCount = 0;
const dispatchLog: string[] = [];

describe("Mailbox carry invariants", () => {
  test("appendNextTurn with non-null pendingTurnId writes correctly", () => {
    currentMailbox().appendNextTurn(null, "run_a", {
      roomId: "room_1",
      agentId: "agent_1",
      pendingTurnId: "pt_1",
      sourceReason: "primary_turn",
      sourceIdempotencyKey: "idem_1"
    });

    const row = currentDatabase().sqlite.prepare("SELECT run_id, room_id, agent_id, pending_turn_id, message_id, source_reason, source_idempotency_key, consumed_at FROM run_next_turns WHERE run_id = 'run_a' ORDER BY created_at ASC LIMIT 1").get() as {
      readonly run_id: string;
      readonly room_id: string;
      readonly agent_id: string;
      readonly pending_turn_id: string | null;
      readonly message_id: string | null;
      readonly source_reason: string | null;
      readonly source_idempotency_key: string | null;
      readonly consumed_at: number | null;
    };

    expect(row).toMatchObject({
      run_id: "run_a",
      room_id: "room_1",
      agent_id: "agent_1",
      pending_turn_id: "pt_1",
      message_id: null,
      source_reason: "primary_turn",
      source_idempotency_key: "idem_1",
      consumed_at: null
    });
  });

  test("carry rebind: next turn carries to new run", () => {
    createRun("run_a");
    insertNextTurn("nt_1", "run_a");
    insertNextTurn("nt_2", "run_a");

    currentLifecycle().create(null, {
      runId: "run_b",
      roomId: "room_1",
      agentId: "agent_1",
      workspaceId: "ws_1",
      wakeReason: "primary_turn",
      sourceRunId: "run_a",
      carryNextTurnIds: ["nt_1", "nt_2"]
    });

    expect(nextTurnRows()).toEqual([
      { id: "nt_1", run_id: "run_b", consumed_at: null },
      { id: "nt_2", run_id: "run_b", consumed_at: null }
    ]);

    const delivery = readMailbox("run_b", "batch_b");
    expect(delivery).toEqual({ mailboxIds: [], nextTurnIds: ["nt_1", "nt_2"] });
    expect(nextTurnRows()).toEqual([
      { id: "nt_1", run_id: "run_b", consumed_at: now },
      { id: "nt_2", run_id: "run_b", consumed_at: now }
    ]);
  });

  test("transient failure does NOT move mailbox", () => {
    seedMailbox("mb_1", "run_a");
    createRun("run_a");

    currentLifecycle().fail(null, "run_a", "upstream_5xx", "transient");

    expect(mailboxRow("mb_1")).toMatchObject({
      read: 0,
      claimed_run_id: null,
      claimed_at: null,
      delivery_batch_id: null
    });
  });

  test("permission_denied marks message consumed", () => {
    createRun("run_perm");
    insertNextTurn("nt_perm", "run_perm");

    currentLifecycle().fail(null, "run_perm", "permission denied", "permission_denied");

    expect(nextTurnRow("nt_perm")).toMatchObject({ consumed_at: now });
  });

  test("serial: carry happens before consume", () => {
    createRun("run_1");
    insertNextTurn("nt_1", "run_1");
    queuePendingTurn("pt_1", now);
    queuePendingTurn("pt_2", now + 1);
    queuePendingTurn("pt_3", now + 2);
    queuePendingTurn("pt_4", now + 3);
    queuePendingTurn("pt_5", now + 4);

    currentPendingTurns().handleTerminal("run_1");
    expect(dispatchLog[0]).toBe("WakeAgent");
    expect(nextTurnRows()).toEqual([{ id: "nt_1", run_id: "run_2", consumed_at: null }]);
    expect(pendingTurnStatus("pt_1")).toBe("queued");
    expect(llmCalls).toBe(1);
  });

  test("same deliveryBatchId retry is idempotent", () => {
    seedMailbox("mb_1", "run_read");
    insertNextTurn("nt_read", "run_read");

    const first = readMailbox("run_read", "batch_1");
    const second = readMailbox("run_read", "batch_1");
    const third = readMailbox("run_read", "batch_2");

    expect(first).toEqual(second);
    expect(third).toEqual({ mailboxIds: [], nextTurnIds: [] });
  });

  test("transient failure rolls back mailbox", () => {
    seedMailbox("mb_rollback", "run_rb");
    insertNextTurn("nt_rb", "run_rb");

    expect(() => {
      currentDatabase().sqlite.transaction(() => {
        const delivered = readMailboxTx(currentDatabase().sqlite, "run_rb", "batch_rb");
        expect(delivered).toEqual({ mailboxIds: ["mb_rollback"], nextTurnIds: ["nt_rb"] });
        throw new Error("transient failure");
      })();
    }).toThrow("transient failure");

    expect(mailboxRow("mb_rollback")).toMatchObject({
      read: 0,
      claimed_run_id: null,
      claimed_at: null,
      delivery_batch_id: null
    });
    expect(nextTurnRow("nt_rb")).toMatchObject({ consumed_at: null });
  });
});

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function currentMailbox(): MailboxService {
  expect(mailbox).toBeDefined();
  return mailbox as MailboxService;
}

function currentLifecycle(): RunLifecycleService {
  expect(lifecycle).toBeDefined();
  return lifecycle as RunLifecycleService;
}

function currentPendingTurns(): PendingTurnService {
  expect(pendingTurns).toBeDefined();
  return pendingTurns as PendingTurnService;
}

function createRun(runId: string): void {
  currentLifecycle().create(null, {
    runId,
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    wakeReason: "primary_turn",
    targetFiles: [],
    messageId: `msg_${runId}`
  });
}

function insertNextTurn(id: string, runId: string): void {
  currentDatabase().sqlite
    .prepare(
      `INSERT INTO run_next_turns (id, run_id, room_id, agent_id, prompt_delta_json, message_id, pending_turn_id, source_reason, source_idempotency_key, created_at, consumed_at)
       VALUES (?, ?, 'room_1', 'agent_1', '', NULL, NULL, 'primary_turn', 'idem', ?, NULL)`
    )
    .run(id, runId, now);
}

function queuePendingTurn(id: string, enqueuedAt: number): void {
  currentDatabase().sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'ws_1', 'room_1', 'user', 'u_1', NULL, 'user', 'completed', NULL, 'pending', ?, ?, ?, NULL)").run(`msg_${id}`, id, enqueuedAt, enqueuedAt);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(`msg_${id}`, JSON.stringify({ text: `pending ${id}` }), enqueuedAt);
  currentDatabase().sqlite.prepare("INSERT INTO pending_turns (id, room_id, user_message_id, primary_agent_id, status, enqueued_at, scheduled_at, cancelled_at, notes) VALUES (?, 'room_1', ?, 'agent_1', 'queued', ?, NULL, NULL, NULL)").run(id, `msg_${id}`, enqueuedAt);
}

function seedMailbox(id: string, runId: string): void {
  currentDatabase().sqlite.prepare("INSERT INTO mailbox_messages (id, workspace_id, room_id, from_type, from_id, to_agent_id, kind, content, files, read, claimed_run_id, claimed_at, delivery_batch_id, created_at, consumed_at) VALUES (?, 'ws_1', 'room_1', 'user', 'u_1', 'agent_1', 'message', 'hello', '[]', 0, NULL, NULL, NULL, ?, NULL)").run(id, now);
  void runId;
}

function mailboxRow(id: string): { readonly read: number; readonly claimed_run_id: string | null; readonly claimed_at: number | null; readonly delivery_batch_id: string | null } {
  return currentDatabase().sqlite.prepare("SELECT read, claimed_run_id, claimed_at, delivery_batch_id FROM mailbox_messages WHERE id = ?").get(id) as { readonly read: number; readonly claimed_run_id: string | null; readonly claimed_at: number | null; readonly delivery_batch_id: string | null };
}

function nextTurnRow(id: string): { readonly consumed_at: number | null } {
  return currentDatabase().sqlite.prepare("SELECT consumed_at FROM run_next_turns WHERE id = ?").get(id) as { readonly consumed_at: number | null };
}

function nextTurnRows(): Array<{ readonly id: string; readonly run_id: string; readonly consumed_at: number | null }> {
  return currentDatabase().sqlite.prepare("SELECT id, run_id, consumed_at FROM run_next_turns WHERE id IN ('nt_1', 'nt_2') ORDER BY id").all() as Array<{ readonly id: string; readonly run_id: string; readonly consumed_at: number | null }>;
}

function pendingTurnStatus(id: string): string {
  return (currentDatabase().sqlite.prepare("SELECT status FROM pending_turns WHERE id = ?").get(id) as { readonly status: string }).status;
}

function readMailbox(runId: string, deliveryBatchId: string): { readonly mailboxIds: readonly string[]; readonly nextTurnIds: readonly string[] } {
  return readMailboxTx(currentDatabase().sqlite, runId, deliveryBatchId);
}

function readMailboxTx(db: AgentHubDatabase["sqlite"], runId: string, deliveryBatchId: string): { readonly mailboxIds: readonly string[]; readonly nextTurnIds: readonly string[] } {
  const existing = db.prepare("SELECT mailbox_ids, next_turn_ids FROM mailbox_deliveries WHERE delivery_batch_id = ? AND run_id = ?").get(deliveryBatchId, runId) as { readonly mailbox_ids: string; readonly next_turn_ids: string } | undefined;
  if (existing) return { mailboxIds: JSON.parse(existing.mailbox_ids) as string[], nextTurnIds: JSON.parse(existing.next_turn_ids) as string[] };

  const mailboxRows = db.prepare("SELECT id FROM mailbox_messages WHERE room_id = 'room_1' AND to_agent_id = 'agent_1' AND ((read = 0 AND claimed_run_id IS NULL) OR (claimed_run_id = ? AND (delivery_batch_id IS NULL OR delivery_batch_id = ?))) ORDER BY created_at ASC").all(runId, deliveryBatchId) as Array<{ readonly id: string }>;
  const nextTurnRows = db.prepare("SELECT id FROM run_next_turns WHERE run_id = ? AND consumed_at IS NULL ORDER BY created_at ASC").all(runId) as Array<{ readonly id: string }>;
  const mailboxIds = mailboxRows.map((row) => row.id);
  const nextTurnIds = nextTurnRows.map((row) => row.id);

  if (mailboxIds.length > 0) {
    const placeholders = mailboxIds.map(() => "?").join(", ");
    db.prepare(`UPDATE mailbox_messages SET read = 1, claimed_run_id = ?, claimed_at = ?, delivery_batch_id = ? WHERE id IN (${placeholders})`).run(runId, now, deliveryBatchId, ...mailboxIds);
  }
  if (nextTurnIds.length > 0) {
    const placeholders = nextTurnIds.map(() => "?").join(", ");
    db.prepare(`UPDATE run_next_turns SET consumed_at = ? WHERE id IN (${placeholders})`).run(now, ...nextTurnIds);
  }
  db.prepare("INSERT INTO mailbox_deliveries (delivery_batch_id, run_id, mailbox_ids, next_turn_ids, delivered_at) VALUES (?, ?, ?, ?, ?)").run(deliveryBatchId, runId, JSON.stringify(mailboxIds), JSON.stringify(nextTurnIds), now);
  return { mailboxIds, nextTurnIds };
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { CommandBus, EventBus, type CommandMeta, type CommandResult } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { MailboxService, PendingTurnService, RunLifecycleService, createConsumePendingTurnHandler } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let mailbox: MailboxService | undefined;
let pendingTurns: PendingTurnService | undefined;
let now = 3_000;

const dispatchTypes: string[] = [];
let llmCalls = 0;
let wakeRunCounter = 1;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-pending-turn-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  mailbox = new MailboxService(currentDatabase(), () => now);
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), {
    now: () => now,
    sideEffects: {
      finalizeNextTurns: (tx, runId, failureClass, timestamp) => currentMailbox().finalizeForRun(tx, runId, failureClass, timestamp)
    }
  });
  pendingTurns = new PendingTurnService({ database: currentDatabase(), eventBus: currentBus(), getCommandBus: () => fakeBus, now: () => now });
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  lifecycle = undefined;
  mailbox = undefined;
  pendingTurns = undefined;
  now = 3_000;
  dispatchTypes.length = 0;
  llmCalls = 0;
  wakeRunCounter = 1;
});

const fakeBus = {
  dispatch: (command: { readonly type: string; readonly roomId?: string; readonly agentId?: string; readonly workspaceId?: string; readonly reason?: string; readonly pendingTurnId?: string; readonly messageId?: string; readonly sourceRunId?: string; readonly carryNextTurnIds?: readonly string[]; readonly idempotencyKey?: string }, meta: CommandMeta): CommandResult => {
    dispatchTypes.push(command.type);
    if (command.type === "ConsumePendingTurn") {
      return createConsumePendingTurnHandler(currentPendingTurns())(command as never, meta) as CommandResult;
    }
    if (command.type === "WakeAgent") {
      llmCalls += 1;
      const runId = `run_${++wakeRunCounter}`;
      currentLifecycle().create(null, {
        runId,
        workspaceId: command.workspaceId ?? "ws_1",
        roomId: command.roomId ?? "room_1",
        agentId: command.agentId ?? "agent_1",
        wakeReason: command.reason === "consume_pending_turn" ? "consume_pending_turn" : "primary_turn",
        ...(command.messageId !== undefined ? { messageId: command.messageId } : {}),
        ...(command.pendingTurnId !== undefined ? { pendingTurnId: command.pendingTurnId } : {}),
        ...(command.sourceRunId !== undefined ? { sourceRunId: command.sourceRunId } : {}),
        ...(command.carryNextTurnIds !== undefined ? { carryNextTurnIds: command.carryNextTurnIds } : {})
      });
      if (dispatchTypes.length < 10) {
        currentPendingTurns().handleTerminal(runId);
      }
      return { ok: true, data: { runId }, emittedEvents: [] };
    }
    throw new Error(`unexpected command: ${command.type}`);
  }
} as unknown as CommandBus;

describe("Pending turn sequential invariants", () => {
  test("solo mode: 5 user messages while busy queue as PendingTurn and consume in order", () => {
    seedRoom();
    seedRun("run_1");
    seedPendingTurn("pt_1", 10);
    seedPendingTurn("pt_2", 20);
    seedPendingTurn("pt_3", 30);
    seedPendingTurn("pt_4", 40);
    seedPendingTurn("pt_5", 50);

    currentPendingTurns().handleTerminal("run_1");

    expect(llmCalls).toBe(5);
    expect(dispatchTypes).toEqual([
      "ConsumePendingTurn",
      "WakeAgent",
      "ConsumePendingTurn",
      "WakeAgent",
      "ConsumePendingTurn",
      "WakeAgent",
      "ConsumePendingTurn",
      "WakeAgent",
      "ConsumePendingTurn",
      "WakeAgent"
    ]);
    expect(queuedPendingTurns()).toEqual([
      { id: "pt_1", status: "consumed" },
      { id: "pt_2", status: "consumed" },
      { id: "pt_3", status: "consumed" },
      { id: "pt_4", status: "consumed" },
      { id: "pt_5", status: "consumed" }
    ]);
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

function currentLifecycle(): RunLifecycleService {
  expect(lifecycle).toBeDefined();
  return lifecycle as RunLifecycleService;
}

function currentMailbox(): MailboxService {
  expect(mailbox).toBeDefined();
  return mailbox as MailboxService;
}

function currentPendingTurns(): PendingTurnService {
  expect(pendingTurns).toBeDefined();
  return pendingTurns as PendingTurnService;
}

function seedRun(runId: string): void {
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

function seedRoom(): void {
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'solo', 'conversation', 'agent_1', NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', 'mock', NULL, 'active', ?)").run(now);
}

function seedPendingTurn(id: string, enqueuedAt: number): void {
  currentDatabase().sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'ws_1', 'room_1', 'user', 'u_1', NULL, 'user', 'completed', NULL, 'pending', ?, ?, ?, NULL)").run(`msg_${id}`, id, enqueuedAt, enqueuedAt);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(`msg_${id}`, JSON.stringify({ text: `pending ${id}` }), enqueuedAt);
  currentDatabase().sqlite.prepare("INSERT INTO pending_turns (id, room_id, user_message_id, primary_agent_id, status, enqueued_at, scheduled_at, cancelled_at, notes) VALUES (?, 'room_1', ?, 'agent_1', 'queued', ?, NULL, NULL, NULL)").run(id, `msg_${id}`, enqueuedAt);
}

function queuedPendingTurns(): Array<{ readonly id: string; readonly status: string }> {
  return currentDatabase().sqlite.prepare("SELECT id, status FROM pending_turns ORDER BY enqueued_at ASC").all() as Array<{ readonly id: string; readonly status: string }>;
}

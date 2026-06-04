import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus, type CommandBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { RunLifecycleService } from "@agenthub/orchestrator";

import { continueAssistedSelectorAfterRun } from "../src/assisted-selector-continuation.ts";

type WakeDispatch = {
  readonly type: string;
  readonly agentId: string;
  readonly messageId?: string;
  readonly idempotencyKey?: string;
};

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let dispatches: WakeDispatch[] = [];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-assisted-selector-continuation-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  dispatches = [];
  seedRun();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  dispatches = [];
});

describe("continueAssistedSelectorAfterRun", () => {
  test("continues an assisted group turn when a selected run completes", async () => {
    const selector = {
      continueTurn: vi.fn(async () => ({
        agentId: "agent_reviewer",
        reason: "selector" as const,
        turnIndex: 2,
        userMessageId: "msg_user"
      }))
    };

    await continueAssistedSelectorAfterRun({
      database: currentDatabase(),
      getCommandBus: () => currentCommandBus(),
      assistedSelector: selector
    }, "run_builder");

    expect(selector.continueTurn).toHaveBeenCalledWith({
      userMessageId: "msg_user",
      completedRunId: "run_builder",
      completedAgentId: "agent_builder",
      completedText: "Builder says to use selector group chat.",
      history: expect.stringContaining("agent_builder: Builder says to use selector group chat.")
    });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      type: "WakeAgent",
      agentId: "agent_reviewer",
      messageId: "msg_user",
      idempotencyKey: "assisted-selector:msg_user:2:agent_reviewer"
    });
  });
});

function currentCommandBus(): CommandBus {
  return {
    dispatch(command: { readonly type: string; readonly agentId?: string; readonly messageId?: string; readonly idempotencyKey?: string }) {
      dispatches.push({ type: command.type, agentId: command.agentId ?? "", ...(command.messageId !== undefined ? { messageId: command.messageId } : {}), ...(command.idempotencyKey !== undefined ? { idempotencyKey: command.idempotencyKey } : {}) });
      return { ok: true, data: {}, emittedEvents: [] };
    }
  } as unknown as CommandBus;
}

function seedRun(): void {
  const db = currentDatabase();
  db.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  db.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_assisted', 'ws_1', 'Assisted Room', 'assisted', 'conversation', 'agent_pm', NULL, 1, 1)").run();
  db.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_assisted', 'agent_builder', 'agent', 'teammate', 'mock', NULL, 'active', 1)").run();
  db.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_assisted', 'agent_reviewer', 'agent', 'teammate', 'mock', NULL, 'active', 2)").run();
  db.sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES ('msg_user', 'ws_1', 'room_assisted', 'user', 'u_1', NULL, 'user', 'completed', NULL, 'immediate', NULL, 1, 1, NULL)").run();
  db.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES ('msg_user', 1, 'text', ?, 1)").run(JSON.stringify({ text: "Discuss this" }));
  const lifecycle = new RunLifecycleService(db, currentBus(), { now: () => 2 });
  lifecycle.create(null, {
    runId: "run_builder",
    agentId: "agent_builder",
    roomId: "room_assisted",
    workspaceId: "ws_1",
    wakeReason: "primary_turn",
    messageId: "msg_user"
  });
  db.sqlite.prepare("UPDATE runs SET status = 'completed', ended_at = 3 WHERE id = 'run_builder'").run();
  db.sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES ('msg_builder', 'ws_1', 'room_assisted', 'agent', 'agent_builder', 'run_builder', 'assistant', 'completed', NULL, 'immediate', NULL, 3, 3, NULL)").run();
  db.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES ('msg_builder', 1, 'text', ?, 3)").run(JSON.stringify({ text: "Builder says to use selector group chat." }));
}

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

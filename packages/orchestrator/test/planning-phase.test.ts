import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus, type CommandBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { createDaemonCommandHandlers } from "../../daemon/src/commands.ts";
import type { PendingTurnService } from "../src/pending-turn.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let dispatches: Array<{ readonly type: string; readonly reason: string; readonly agentId: string }> = [];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-orchestrator-planning-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  dispatches = [];
  seedWorkspace();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  dispatches = [];
});

describe("sendMessage planning wake reasons", () => {
  test("first squad message wakes the primary agent with plan", async () => {
    insertSquadRoom();
    insertAgent("agent_leader", "Leader");
    insertAgent("agent_worker", "Worker");
    insertParticipant("room_squad", "agent_leader", "primary");
    insertParticipant("room_squad", "agent_worker", "teammate");

    const result = await sendMessage({ roomId: "room_squad", text: "Plan this" });

    expect(result.ok).toBe(true);
    expect(dispatches.find((item) => item.agentId === "agent_leader")?.reason).toBe("plan");
  });

  test("existing task plan switches the primary wake to primary_turn", async () => {
    insertSquadRoom();
    insertAgent("agent_leader", "Leader");
    insertAgent("agent_worker", "Worker");
    insertParticipant("room_squad", "agent_leader", "primary");
    insertParticipant("room_squad", "agent_worker", "teammate");
    currentDatabase().sqlite.prepare("INSERT INTO task_plans (id, room_id, run_id, plan_json, created_at) VALUES ('plan_1', 'room_squad', 'run_plan_1', '{\"goal\":\"ship\",\"tasks\":[]}', 1)").run();

    const result = await sendMessage({ roomId: "room_squad", text: "Continue" });

    expect(result.ok).toBe(true);
    expect(dispatches.find((item) => item.agentId === "agent_leader")?.reason).toBe("primary_turn");
  });

  test("solo rooms never use the plan wake reason", async () => {
    insertSoloRoom();
    insertAgent("agent_solo", "Solo");
    insertParticipant("room_solo", "agent_solo", "primary");

    const result = await sendMessage({ roomId: "room_solo", text: "Hi" });

    expect(result.ok).toBe(true);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.reason).toBe("primary_turn");
  });
});

async function sendMessage(command: { readonly roomId: string; readonly text: string }) {
  const handlers = createDaemonCommandHandlers({
    database: currentDatabase(),
    eventBus: currentBus(),
    getCommandBus: () => currentCommandBus(),
    pendingTurns: { cancel: vi.fn(() => ({ ok: true, data: {}, emittedEvents: [] })) } as unknown as PendingTurnService,
    now: () => 1_000
  });
  const handler = handlers.SendMessage;
  if (!handler) throw new Error("sendMessage handler missing");
  return Promise.resolve(handler({ type: "SendMessage", ...command }, { actor: { type: "user", id: "u_1" }, traceId: "trace_1", idempotencyKey: `idem_${command.roomId}`, origin: "mcp_tool" }));
}

function currentCommandBus(): CommandBus {
  return {
    dispatch(command: { readonly type: string; readonly reason?: string; readonly agentId?: string }) {
      dispatches.push({ type: command.type, reason: command.reason ?? "", agentId: command.agentId ?? "" });
      return { ok: true, data: {}, emittedEvents: [] };
    }
  } as unknown as CommandBus;
}

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
}

function insertSoloRoom(): void {
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_solo', 'ws_1', 'Solo Room', 'solo', 'conversation', 'agent_solo', NULL, 1, 1)").run();
}

function insertSquadRoom(): void {
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_squad', 'ws_1', 'Squad Room', 'squad', 'conversation', 'agent_leader', NULL, 1, 1)").run();
}

function insertAgent(agentId: string, name: string): void {
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, 'ws_1', ?, 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run(agentId, name);
}

function insertParticipant(roomId: string, agentId: string, role: "primary" | "teammate"): void {
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', ?, 'mock', NULL, 'active', 1)").run(roomId, agentId, role);
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { assembleMissionBrief, buildMissionBriefBlock, type MissionBrief } from "../src/prompts/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-orchestrator-mission-brief-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  seedWorkspace();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  now = 1_000;
});

describe("assembleMissionBrief", () => {
  test("returns undefined for solo rooms", () => {
    expect(assembleMissionBrief("room_solo", "agent_worker", currentDatabase())).toBeUndefined();
  });

  test("returns a brief for squad rooms with derived goal, siblings, and room memory", () => {
    insertRoom({ roomId: "room_squad", mode: "squad", primaryAgentId: "agent_leader" });
    insertParticipant("room_squad", "agent_leader", "primary");
    insertParticipant("room_squad", "agent_worker", "teammate");
    insertAgent("agent_leader", "Leader");
    insertAgent("agent_worker", "Worker");
    insertTask("task_sibling", "room_squad", "Sibling task", "agent_leader", "in_progress", "Missing spec");
    insertContextItem({ roomId: "room_squad", scope: "workspace", status: "confirmed", type: "fact", content: "Goal: ship the feature" });
    insertContextItem({ roomId: "room_squad", scope: "conversation", status: "confirmed", type: "decision", content: "Use TypeScript strict mode" });
    insertContextItem({ roomId: "room_squad", scope: "conversation", status: "proposed", type: "fact", content: "Ignore me" });

    const brief = assembleMissionBrief("room_squad", "agent_worker", currentDatabase());

    expect(brief).toMatchObject<MissionBrief>({
      goal: "Goal: ship the feature",
      leaderName: "Leader",
      roomMode: "squad",
      siblingTasks: [{ taskId: "task_sibling", title: "Sibling task", assigneeName: "Leader", status: "in_progress", blockerReason: "Missing spec" }],
      roomMemory: [{ type: "decision", content: "Use TypeScript strict mode" }]
    });
  });

  test("uses first user message when no pinned goal exists and falls back when no messages exist", () => {
    insertRoom({ roomId: "room_messages", mode: "team", primaryAgentId: "agent_leader" });
    insertParticipant("room_messages", "agent_leader", "primary");
    insertParticipant("room_messages", "agent_worker", "teammate");
    insertAgent("agent_leader", "Leader");
    insertAgent("agent_worker", "Worker");
    insertMessage("msg_1", "room_messages", "Need docs first");

    expect(assembleMissionBrief("room_messages", "agent_worker", currentDatabase())?.goal).toBe("Need docs first");

    insertRoom({ roomId: "room_empty", mode: "team", primaryAgentId: "agent_leader" });
    insertParticipant("room_empty", "agent_leader", "primary");
    insertParticipant("room_empty", "agent_worker", "teammate");
    insertAgent("agent_leader", "Leader");
    insertAgent("agent_worker", "Worker");

    expect(assembleMissionBrief("room_empty", "agent_worker", currentDatabase())?.goal).toBe("No explicit goal set for this room.");
    expect(assembleMissionBrief("room_empty", "agent_worker", currentDatabase())?.roomMemory).toEqual([]);
  });

  test("buildMissionBriefBlock renders the XML wrapper", () => {
    const xml = buildMissionBriefBlock({
      goal: "Goal: ship",
      roomMode: "team",
      leaderName: "Leader",
      siblingTasks: [{ taskId: "task_1", title: "Do work", assigneeName: "Worker", status: "in_progress", blockerReason: "Waiting" }],
      roomMemory: [{ type: "fact", content: "Remember this" }]
    });

    expect(xml).toContain("<mission-brief>");
    expect(xml).toContain("<goal>Goal: ship</goal>");
    expect(xml).toContain("<leader>Leader</leader>");
    expect(xml).toContain("<sibling-tasks>");
    expect(xml).toContain("<room-memory>");
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

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_solo', 'ws_1', 'Solo', 'solo', 'conversation', 'agent_worker', NULL, 1, 1)").run();
}

function insertRoom(input: { readonly roomId: string; readonly mode: "team" | "squad"; readonly primaryAgentId: string }): void {
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, 'ws_1', ?, ?, 'conversation', ?, NULL, ?, ?)").run(input.roomId, input.roomId, input.mode, input.primaryAgentId, now, now);
}

function insertAgent(agentId: string, name: string): void {
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, 'ws_1', ?, 'mock', NULL, '', '[]', NULL, 0, NULL, ?, ?)").run(agentId, name, now, now);
}

function insertParticipant(roomId: string, agentId: string, role: "primary" | "teammate"): void {
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', ?, 'mock', NULL, 'active', ?)").run(roomId, agentId, role, now);
}

function insertTask(taskId: string, roomId: string, title: string, assigneeAgentId: string, status: string, blockerReason: string | null): void {
  currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, delegation_chain, title, description, status, assignee_agent_id, assignee_role_id, assignee_binding_id, source_run_id, source_message_id, dependencies, priority, expects_review, due_at, created_by, created_at, updated_at, blocker_reason, max_turns, board_column) VALUES (?, 'ws_1', ?, NULL, NULL, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, '[]', NULL, 0, NULL, 'system', ?, ?, ?, NULL, NULL)").run(taskId, roomId, title, status, assigneeAgentId, now, now, blockerReason);
}

function insertContextItem(input: { readonly roomId: string; readonly scope: "workspace" | "conversation"; readonly status: "confirmed" | "proposed"; readonly type: "fact" | "decision" | "constraint" | "issue"; readonly content: string }): void {
  currentDatabase().sqlite.prepare("INSERT INTO context_items (id, workspace_id, room_id, task_id, run_id, source_message_id, type, scope, content, source, visibility, status, confidence, version, owner_id, owner_type, created_by, pinned, created_at, updated_at, deprecated_at) VALUES (?, 'ws_1', ?, NULL, NULL, NULL, ?, ?, ?, '{\"type\":\"user\",\"id\":\"u_1\"}', '{}', ?, 'verified', 1, NULL, NULL, 'system', 0, ?, ?, NULL)").run(`ctx_${Math.random().toString(16).slice(2)}`, input.roomId, input.type, input.scope, input.content, input.status, now, now);
}

function insertMessage(messageId: string, roomId: string, text: string): void {
  currentDatabase().sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'ws_1', ?, 'user', 'u_1', NULL, 'user', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)").run(messageId, roomId, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(messageId, JSON.stringify({ text }), now);
}

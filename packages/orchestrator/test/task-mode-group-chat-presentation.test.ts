import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { TaskModeGroupChatPresenter } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let presenter: TaskModeGroupChatPresenter | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-task-mode-chat-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  presenter = new TaskModeGroupChatPresenter({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
  seedWorkspace();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  presenter = undefined;
  now = 1_000;
});

describe("TaskModeGroupChatPresenter", () => {
  test("publishes a short leader handoff when a team task is delegated", () => {
    now = 2_000;
    currentPresenter().publishDelegationCreated({ roomId: "room_team", leaderAgentId: "agent_pm", taskId: "task_builder", teammateAgentId: "agent_builder" });

    const message = latestMessage();
    expect(message).toMatchObject({ room_id: "room_team", sender_type: "agent", sender_id: "agent_pm", role: "assistant", status: "completed" });
    expect(messageText(message.id)).toBe("Builder，我把「架构边界梳理」交给你，先从你的角度推进。");
    expect(messageEventTypes(message.id)).toEqual(["message.created", "message.completed"]);
    expect(roomActivity("room_team")).toBe(2_000);
  });

  test("publishes teammate start and completion turns without replacing task events", () => {
    currentPresenter().publishTaskStarted({ roomId: "room_squad", taskId: "task_builder", teammateAgentId: "agent_builder", runId: "run_builder" });
    currentPresenter().publishTaskOutcome({ roomId: "room_squad", taskId: "task_builder", teammateAgentId: "agent_builder", finalStatus: "completed", summary: "完成了架构边界，建议先收紧任务状态机。" });

    const messages = allMessages();
    expect(messages.map((message) => message.sender_id)).toEqual(["agent_builder", "agent_builder"]);
    expect(messages.map((message) => message.text)).toEqual([
      "Builder：我来处理「架构边界梳理」。",
      "Builder：我完成了「架构边界梳理」。核心结论：完成了架构边界，建议先收紧任务状态机。"
    ]);
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'task.%'").get()).toMatchObject({ count: 0 });
  });

  test("does not publish task-mode chat turns in solo or assisted rooms", () => {
    currentPresenter().publishTaskStarted({ roomId: "room_solo", taskId: "task_solo", teammateAgentId: "agent_builder" });
    currentPresenter().publishTaskStarted({ roomId: "room_assisted", taskId: "task_assisted", teammateAgentId: "agent_builder" });

    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM messages").get()).toMatchObject({ count: 0 });
  });

  test("publishes a leader review turn when team dispatch starts", () => {
    currentPresenter().publishTeamReviewStarted({ roomId: "room_team", leaderAgentId: "agent_pm", taskIds: ["task_builder", "task_reviewer"], runId: "run_pm_review" });

    const message = latestMessage();
    expect(message).toMatchObject({ sender_id: "agent_pm", run_id: "run_pm_review" });
    expect(messageText(message.id)).toBe("Project Manager：我开始 review 这 2 个结果，稍后给你收束。");
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

function currentPresenter(): TaskModeGroupChatPresenter {
  expect(presenter).toBeDefined();
  return presenter as TaskModeGroupChatPresenter;
}

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_pm', 'ws_1', 'Project Manager', 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_builder', 'ws_1', 'Builder', 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_reviewer', 'ws_1', 'Reviewer', 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, created_at, updated_at) VALUES ('room_team', 'ws_1', 'Team', 'team', 'conversation', 'agent_pm', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, created_at, updated_at) VALUES ('room_squad', 'ws_1', 'Squad', 'squad', 'conversation', 'agent_pm', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, created_at, updated_at) VALUES ('room_solo', 'ws_1', 'Solo', 'solo', 'conversation', 'agent_builder', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, created_at, updated_at) VALUES ('room_assisted', 'ws_1', 'Assisted', 'assisted', 'conversation', 'agent_pm', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, title, description, status, assignee_agent_id, expects_review, created_by, created_at, updated_at) VALUES ('task_builder', 'ws_1', 'room_team', '架构边界梳理', '', 'pending', 'agent_builder', 1, 'agent_pm', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, title, description, status, assignee_agent_id, expects_review, created_by, created_at, updated_at) VALUES ('task_reviewer', 'ws_1', 'room_team', '风险 review', '', 'pending', 'agent_reviewer', 1, 'agent_pm', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, title, description, status, assignee_agent_id, expects_review, created_by, created_at, updated_at) VALUES ('task_solo', 'ws_1', 'room_solo', 'Solo task', '', 'pending', 'agent_builder', 0, 'agent_builder', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, title, description, status, assignee_agent_id, expects_review, created_by, created_at, updated_at) VALUES ('task_assisted', 'ws_1', 'room_assisted', 'Assisted task', '', 'pending', 'agent_builder', 0, 'agent_pm', 1, 1)").run();
}

function latestMessage(): { readonly id: string; readonly room_id: string; readonly sender_type: string; readonly sender_id: string | null; readonly run_id: string | null; readonly role: string; readonly status: string } {
  const row = currentDatabase().sqlite.prepare("SELECT id, room_id, sender_type, sender_id, run_id, role, status FROM messages ORDER BY created_at DESC, id DESC LIMIT 1").get() as { readonly id: string; readonly room_id: string; readonly sender_type: string; readonly sender_id: string | null; readonly run_id: string | null; readonly role: string; readonly status: string } | undefined;
  expect(row).toBeDefined();
  return row as NonNullable<typeof row>;
}

function allMessages(): Array<{ readonly id: string; readonly sender_id: string | null; readonly text: string }> {
  const rows = currentDatabase().sqlite.prepare("SELECT id, sender_id FROM messages ORDER BY created_at ASC, id ASC").all() as Array<{ readonly id: string; readonly sender_id: string | null }>;
  return rows.map((row) => ({ ...row, text: messageText(row.id) }));
}

function messageText(messageId: string): string {
  const row = currentDatabase().sqlite.prepare("SELECT payload FROM message_parts WHERE message_id = ? AND part_type = 'text' ORDER BY seq ASC LIMIT 1").get(messageId) as { readonly payload: string } | undefined;
  expect(row).toBeDefined();
  return (JSON.parse(row!.payload) as { readonly text: string }).text;
}

function messageEventTypes(messageId: string): string[] {
  const rows = currentDatabase().sqlite.prepare("SELECT type FROM events WHERE json_extract(payload, '$.messageId') = ? ORDER BY seq ASC").all(messageId) as Array<{ readonly type: string }>;
  return rows.map((row) => row.type);
}

function roomActivity(roomId: string): number | null {
  const row = currentDatabase().sqlite.prepare("SELECT last_activity_at FROM rooms WHERE id = ?").get(roomId) as { readonly last_activity_at: number | null };
  return row.last_activity_at;
}

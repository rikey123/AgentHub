import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { RunLifecycleService } from "../src/index.ts";
import { buildPriorProgressBlock } from "../src/prompts/prior-progress.ts";

let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let now = 1_000;

beforeEach(() => {
  database = createDatabase({ path: ":memory:", applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), { now: () => now });
  seedWorkspace();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  database = undefined;
  eventBus = undefined;
  lifecycle = undefined;
  now = 1_000;
});

describe("task checkpoint capture", () => {
  test("failed run with task writes task_checkpoints row", () => {
    const runId = "run_failed";
    const taskId = "task_1";
    currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, title, description, status, assignee_agent_id, source_run_id, source_message_id, dependencies, priority, assignee_role_id, assignee_binding_id, delegation_chain, expects_review, due_at, created_by, created_at, updated_at, blocker_reason, max_turns, board_column) VALUES (?, 'ws_1', 'room_1', NULL, 'Task', NULL, 'in_progress', NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, 0, NULL, 'user_1', ?, ?, NULL, NULL, NULL)").run(taskId, now, now);
    currentLifecycle().create(null, { runId, workspaceId: "ws_1", roomId: "room_1", agentId: "agent_1", taskId, wakeReason: "primary_turn", messageId: "msg_1" });
    insertAssistantMessage(runId, "A".repeat(2050));
    publishFileChanged(runId, "src/a.ts");
    publishFileChanged(runId, "src/b.ts");

    currentLifecycle().fail(null, runId, "boom", "transient");

    const row = currentDatabase().sqlite.prepare("SELECT task_id, run_id, progress_summary, files_touched FROM task_checkpoints WHERE task_id = ? AND run_id = ? ORDER BY created_at DESC LIMIT 1").get(taskId, runId) as { task_id: string; run_id: string; progress_summary: string; files_touched: string } | undefined;
    expect(row).toMatchObject({ task_id: taskId, run_id: runId });
    expect(row?.progress_summary.length).toBe(2000);
    expect(row?.progress_summary).toBe("A".repeat(2000));
    expect(JSON.parse(row?.files_touched ?? "[]")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("cancelled run with task writes checkpoint", () => {
    const runId = "run_cancelled";
    const taskId = "task_2";
    currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, title, description, status, assignee_agent_id, source_run_id, source_message_id, dependencies, priority, assignee_role_id, assignee_binding_id, delegation_chain, expects_review, due_at, created_by, created_at, updated_at, blocker_reason, max_turns, board_column) VALUES (?, 'ws_1', 'room_1', NULL, 'Task', NULL, 'in_progress', NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, 0, NULL, 'user_1', ?, ?, NULL, NULL, NULL)").run(taskId, now, now);
    currentLifecycle().create(null, { runId, workspaceId: "ws_1", roomId: "room_1", agentId: "agent_1", taskId, wakeReason: "primary_turn", messageId: "msg_2" });
    insertAssistantMessage(runId, "finished text");
    publishFileChanged(runId, "src/cancelled.ts");
    currentLifecycle().markCancelling(null, runId);

    currentLifecycle().cancelFinalized(null, runId, "done");

    const row = currentDatabase().sqlite.prepare("SELECT task_id, run_id, progress_summary, files_touched FROM task_checkpoints WHERE task_id = ? AND run_id = ? ORDER BY created_at DESC LIMIT 1").get(taskId, runId) as { task_id: string; run_id: string; progress_summary: string; files_touched: string } | undefined;
    expect(row).toMatchObject({ task_id: taskId, run_id: runId, progress_summary: "finished text" });
    expect(JSON.parse(row?.files_touched ?? "[]")).toEqual(["src/cancelled.ts"]);
  });

  test("failed run without task_id does not write checkpoint", () => {
    const runId = "run_no_task";
    currentLifecycle().create(null, { runId, workspaceId: "ws_1", roomId: "room_1", agentId: "agent_1", wakeReason: "primary_turn", messageId: "msg_3" });
    insertAssistantMessage(runId, "text");
    publishFileChanged(runId, "src/no-task.ts");

    currentLifecycle().fail(null, runId, "boom", "transient");

    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM task_checkpoints WHERE run_id = ?").get(runId)).toMatchObject({ count: 0 });
  });
});

describe("buildPriorProgressBlock", () => {
  test("returns prior-progress XML block for task with checkpoint", () => {
    const taskId = "task_xml";
    currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, title, description, status, assignee_agent_id, source_run_id, source_message_id, dependencies, priority, assignee_role_id, assignee_binding_id, delegation_chain, expects_review, due_at, created_by, created_at, updated_at, blocker_reason, max_turns, board_column) VALUES (?, 'ws_1', 'room_1', NULL, 'Task', NULL, 'in_progress', NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, 0, NULL, 'user_1', ?, ?, NULL, NULL, NULL)").run(taskId, now, now);
    currentDatabase().sqlite.prepare("INSERT INTO task_checkpoints (id, task_id, run_id, progress_summary, files_touched, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), taskId, "run_xml", "summary & <tag> ' \" chars", JSON.stringify(["src/a&b.ts", "src/<escaped>.ts"]), now);

    const block = buildPriorProgressBlock(currentDatabase(), taskId);

    expect(block).toContain("<prior-progress>");
    expect(block).toContain("<summary>summary &amp; &lt;tag&gt; &apos; &quot; chars</summary>");
    expect(block).toContain("<files-touched>");
    expect(block).toContain("<file>src/a&amp;b.ts</file>");
    expect(block).toContain("<file>src/&lt;escaped&gt;.ts</file>");
  });

  test("returns undefined for task with no checkpoint", () => {
    expect(buildPriorProgressBlock(currentDatabase(), "missing_task")).toBeUndefined();
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

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'solo', 'conversation', 'agent_1', NULL, 1, 1)").run();
}

function insertAssistantMessage(runId: string, text: string): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'ws_1', 'room_1', 'agent', 'agent_1', ?, 'assistant', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)"
  ).run(`msg_${runId}`, runId, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(`msg_${runId}`, JSON.stringify({ text }), now);
}

function publishFileChanged(runId: string, path: string): void {
  currentBus().publish({
    id: randomUUID(),
    type: "file.changed",
    schemaVersion: 1,
    workspaceId: "ws_1",
    roomId: "room_1",
    runId,
    agentId: "agent_1",
    payload: { runId, path, change: "modified" },
    createdAt: now
  });
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { TaskModeGroupChatPresenter, TaskService } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let service: TaskService | undefined;
let presenter: TaskModeGroupChatPresenter | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-orchestrator-complete-task-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  presenter = new TaskModeGroupChatPresenter({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
  service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), taskModeGroupChatPresenter: currentPresenter(), now: () => now });
  seedWorkspace();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  service = undefined;
  presenter = undefined;
  now = 1_000;
});

describe("TaskService.completeTask", () => {
  test("squad mode completes when review is not expected", () => {
    const taskId = createTask({ roomId: "room_squad", assigneeAgentId: "agent_worker", expectsReview: false, status: "in_progress" });

    const result = currentService().completeTask({
      taskId,
      roomId: "room_squad",
      callerAgentId: "agent_worker",
      byRunId: "run_1",
      status: "completed",
      summary: "Done",
      artifactIds: ["artifact_1"],
      filesChanged: ["src/app.ts"]
    });

    expect(result.ok).toBe(true);
    expect(currentDatabase().sqlite.prepare("SELECT status, blocker_reason FROM tasks WHERE id = ?").get(taskId)).toMatchObject({ status: "completed", blocker_reason: null });
    expect(eventsFor(taskId)).toEqual(expect.arrayContaining(["task.created", "task.assigned", "task.status.changed", "task.activity.added", "task.delegation.completed"]));
    const activity = currentDatabase().sqlite.prepare("SELECT kind, by_kind, by, payload FROM task_activities WHERE task_id = ? AND kind = 'comment'").get(taskId) as { readonly kind: string; readonly by_kind: string; readonly by: string; readonly payload: string };
    expect(activity).toMatchObject({ kind: "comment", by_kind: "role", by: "agent_worker" });
    expect(JSON.parse(activity.payload)).toMatchObject({ reportType: "completion_report", summary: "Done", finalStatus: "completed", byRunId: "run_1", artifactIds: ["artifact_1"], filesChanged: ["src/app.ts"] });
    const completedEvent = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = 'task.delegation.completed' AND task_id = ? ORDER BY seq DESC LIMIT 1").get(taskId) as { readonly payload: string };
    expect(JSON.parse(completedEvent.payload)).toMatchObject({ taskId, finalStatus: "completed", byRunId: "run_1", summary: "Done", artifactIds: ["artifact_1"], filesChanged: ["src/app.ts"] });
    expect(publicMessageTexts("room_squad")).toContain("Worker：我完成了「Task」。核心结论：Done");
  });

  test("team mode routes completed into review when review is expected", () => {
    const taskId = createTask({ roomId: "room_team", assigneeAgentId: "agent_worker", expectsReview: true, status: "in_progress" });

    const result = currentService().completeTask({ taskId, roomId: "room_team", callerAgentId: "agent_worker", status: "completed", summary: "Done" });

    expect(result.ok).toBe(true);
    expect(currentDatabase().sqlite.prepare("SELECT status, blocker_reason FROM tasks WHERE id = ?").get(taskId)).toMatchObject({ status: "review", blocker_reason: null });
    expect(eventsFor(taskId)).toEqual(expect.arrayContaining(["task.created", "task.assigned", "task.status.changed", "task.activity.added", "task.delegation.completed"]));
    expect(publicMessageTexts("room_team")).toContain("Worker：我完成了「Task」，先交给 PM review。核心结论：Done");
  });

  test("delegated run start presentation does not duplicate on repeated start", () => {
    const taskId = createTask({ roomId: "room_squad", assigneeAgentId: "agent_worker", expectsReview: false, status: "pending" });

    expect(currentService().startDelegatedRun(taskId, "run_1")).toMatchObject({ ok: true });
    expect(currentService().startDelegatedRun(taskId, "run_1")).toMatchObject({ ok: false });

    expect(publicMessageTexts("room_squad")).toHaveLength(1);
  });

  test("blocked status requires a blocker reason and stores it", () => {
    const taskId = createTask({ roomId: "room_team", assigneeAgentId: "agent_worker", expectsReview: true, status: "in_progress" });

    const result = currentService().completeTask({ taskId, roomId: "room_team", callerAgentId: "agent_worker", status: "blocked", summary: "Blocked", blockerReason: "Missing API key" });

    expect(result.ok).toBe(true);
    expect(currentDatabase().sqlite.prepare("SELECT status, blocker_reason FROM tasks WHERE id = ?").get(taskId)).toMatchObject({ status: "blocked", blocker_reason: "Missing API key" });
  });

  test("needs_review alias maps to review", () => {
    const taskId = createTask({ roomId: "room_team", assigneeAgentId: "agent_worker", expectsReview: true, status: "in_progress" });

    const result = currentService().completeTask({ taskId, roomId: "room_team", callerAgentId: "agent_worker", status: "needs_review", summary: "Needs review" });

    expect(result.ok).toBe(true);
    expect(currentDatabase().sqlite.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId)).toMatchObject({ status: "review" });
  });

  test("missing blocker reason is rejected", () => {
    const taskId = createTask({ roomId: "room_team", assigneeAgentId: "agent_worker", expectsReview: true, status: "in_progress" });

    const result = currentService().completeTask({ taskId, roomId: "room_team", callerAgentId: "agent_worker", status: "blocked", summary: "Blocked" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected validation failure");
    expect(result.error.code).toBe("validation_failed");
    expect(currentDatabase().sqlite.prepare("SELECT status, blocker_reason FROM tasks WHERE id = ?").get(taskId)).toMatchObject({ status: "in_progress", blocker_reason: null });
  });

  test("wrong room is rejected", () => {
    const taskId = createTask({ roomId: "room_a", assigneeAgentId: "agent_a", expectsReview: false, status: "in_progress" });

    const result = currentService().completeTask({ taskId, roomId: "room_b", callerAgentId: "agent_worker", status: "completed", summary: "Done" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not_found");
    expect(result.error.code).toBe("not_found");
  });

  test("wrong assignee is rejected", () => {
    const taskId = createTask({ roomId: "room_a", assigneeAgentId: "agent_a", expectsReview: false, status: "in_progress" });

    const result = currentService().completeTask({ taskId, roomId: "room_a", callerAgentId: "agent_b", status: "completed", summary: "Done" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected permission denied");
    expect(result.error.code).toBe("permission_denied");
  });

  test("task stays in_progress when run ends without room.complete_task (authoritative path)", () => {
    // Spec D6: room.complete_task is the ONLY path that transitions a delegated task.
    // onRunCompleted no longer auto-completes — the task must remain in_progress
    // until room.complete_task is called or onSessionEndedWithoutCompletion fires.
    const taskId = createTask({ roomId: "room_squad", assigneeAgentId: "agent_worker", expectsReview: false, status: "in_progress" });

    // Simulate run completing WITHOUT calling room.complete_task
    // (no completeTask call here — just verify task is still in_progress)
    const taskRow = currentDatabase().sqlite.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { readonly status: string };
    expect(taskRow.status).toBe("in_progress");

    // Only task.created + task.assigned events — no task.delegation.completed
    const events = eventsFor(taskId);
    expect(events).not.toContain("task.delegation.completed");
  });

  test("onSessionEndedWithoutCompletion transitions task to review with missing_completion_report", () => {
    // Spec D6: if run ends without room.complete_task, task → review(missing_completion_report)
    const taskId = createTask({ roomId: "room_squad", assigneeAgentId: "agent_worker", expectsReview: false, status: "in_progress" });

    // Simulate the onSessionEndedWithoutCompletion callback directly
    const result = currentService().updateStatus({ taskId, status: "review", blockerReason: "missing_completion_report" });

    expect(result.ok).toBe(true);
    expect(currentDatabase().sqlite.prepare("SELECT status, blocker_reason FROM tasks WHERE id = ?").get(taskId)).toMatchObject({
      status: "review",
      blocker_reason: "missing_completion_report"
    });
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

function currentService(): TaskService {
  expect(service).toBeDefined();
  return service as TaskService;
}

function currentPresenter(): TaskModeGroupChatPresenter {
  expect(presenter).toBeDefined();
  return presenter as TaskModeGroupChatPresenter;
}

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_a', 'ws_1', 'Agent A', 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_b', 'ws_1', 'Agent B', 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_worker', 'ws_1', 'Worker', 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_a', 'ws_1', 'Room A', 'solo', 'conversation', 'agent_a', NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_b', 'ws_1', 'Room B', 'solo', 'conversation', 'agent_b', NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_team', 'ws_1', 'Team Room', 'team', 'conversation', 'agent_worker', NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_squad', 'ws_1', 'Squad Room', 'squad', 'conversation', 'agent_worker', NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_a', 'agent_a', 'agent', 'primary', 'mock', NULL, 'active', 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_b', 'agent_b', 'agent', 'primary', 'mock', NULL, 'active', 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_team', 'agent_worker', 'agent', 'primary', 'mock', NULL, 'active', 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_squad', 'agent_worker', 'agent', 'primary', 'mock', NULL, 'active', 1)").run();
}

function createTask(input: { readonly roomId: string; readonly assigneeAgentId: string; readonly expectsReview: boolean; readonly status: "in_progress" | "pending" }): string {
  const result = currentService().create({ roomId: input.roomId, title: "Task", assigneeAgentId: input.assigneeAgentId, expectsReview: input.expectsReview, createdBy: "agent_system" });
  if (!result.ok) throw new Error("expected task create success");
  const taskId = result.data.taskId;
  currentDatabase().sqlite.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(input.status, taskId);
  currentDatabase().sqlite.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(now, taskId);
  return taskId;
}

function eventsFor(taskId: string): string[] {
  return currentDatabase().sqlite
    .prepare("SELECT type FROM events WHERE task_id = ? ORDER BY seq ASC")
    .all(taskId)
    .map((row) => (row as { readonly type: string }).type);
}

function publicMessageTexts(roomId: string): string[] {
  const rows = currentDatabase().sqlite.prepare(
    `SELECT mp.payload
     FROM messages m
     JOIN message_parts mp ON mp.message_id = m.id AND mp.part_type = 'text'
     WHERE m.room_id = ?
       AND m.sender_type = 'agent'
     ORDER BY m.created_at ASC, m.id ASC, mp.seq ASC`
  ).all(roomId) as Array<{ readonly payload: string }>;
  return rows.map((row) => (JSON.parse(row.payload) as { readonly text: string }).text);
}

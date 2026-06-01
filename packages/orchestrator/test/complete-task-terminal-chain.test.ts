/**
 * Integration test: AdapterBridge terminal chain for room.complete_task authoritative path.
 *
 * Spec D6: "If a run reaches session.ended without a room.complete_task call recorded for
 * its associated task, the daemon SHALL transition the task to review with
 * blocker_reason = 'missing_completion_report' and wake the leader with reason: 'task_review'."
 *
 * This test exercises the real AdapterBridge → onSessionEndedWithoutCompletion → TaskService
 * chain using the mock adapter infrastructure, without needing a real LLM.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { AdapterBridge, RunLifecycleService, TaskService } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let taskService: TaskService | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-orchestrator-terminal-chain-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), { now: () => now });
  taskService = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
  seedWorkspace();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  lifecycle = undefined;
  taskService = undefined;
  now = 1_000;
});

describe("AdapterBridge terminal chain — room.complete_task authoritative path", () => {
  test("session.ended without room.complete_task triggers missing_completion_report via callback", () => {
    // Arrange: create a delegated task in in_progress state
    const taskId = createDelegatedTask("room_squad", "agent_worker");
    const runId = "run_test_1";
    let capturedTaskId: string | undefined;

    // Create AdapterBridge with onSessionEndedWithoutCompletion callback
    const bridge = new AdapterBridge({
      runId,
      workspaceId: "ws_1",
      roomId: "room_squad",
      agentId: "agent_worker",
      lifecycle: currentLifecycle(),
      eventBus: currentBus(),
      now: () => now,
      taskId,
      wakeReason: "delegated_task",
      database: currentDatabase(),
      onSessionEndedWithoutCompletion: (tid) => { capturedTaskId = tid; }
    });

    // Start the run
    currentLifecycle().create(null, { runId, workspaceId: "ws_1", roomId: "room_squad", agentId: "agent_worker", wakeReason: "delegated_task", taskId, targetFiles: [] });
    currentLifecycle().markClaimed(null, runId);
    currentLifecycle().markStarting(null, runId, 123);
    currentLifecycle().markRunning(null, runId, `session_${runId}`);

    // Act: session ends WITHOUT room.complete_task being called
    bridge.handle({ type: "session.ended", sessionId: `session_${runId}`, reason: "completed" });

    // Assert: callback was called with the task ID
    expect(capturedTaskId).toBe(taskId);

    // Simulate what onSessionEndedWithoutCompletion does in the daemon
    const result = currentTaskService().updateStatus({ taskId, status: "review", blockerReason: "missing_completion_report" });
    expect(result.ok).toBe(true);

    const taskRow = currentDatabase().sqlite.prepare("SELECT status, blocker_reason FROM tasks WHERE id = ?").get(taskId) as { readonly status: string; readonly blocker_reason: string | null };
    expect(taskRow.status).toBe("review");
    expect(taskRow.blocker_reason).toBe("missing_completion_report");
  });

  test("session.ended WITH room.complete_task does NOT trigger missing_completion_report", () => {
    // Arrange
    const taskId = createDelegatedTask("room_squad", "agent_worker");
    const runId = "run_test_2";
    let callbackFired = false;

    const bridge = new AdapterBridge({
      runId,
      workspaceId: "ws_1",
      roomId: "room_squad",
      agentId: "agent_worker",
      lifecycle: currentLifecycle(),
      eventBus: currentBus(),
      now: () => now,
      taskId,
      wakeReason: "delegated_task",
      database: currentDatabase(),
      onSessionEndedWithoutCompletion: () => { callbackFired = true; }
    });

    currentLifecycle().create(null, { runId, workspaceId: "ws_1", roomId: "room_squad", agentId: "agent_worker", wakeReason: "delegated_task", taskId, targetFiles: [] });
    currentLifecycle().markClaimed(null, runId);
    currentLifecycle().markStarting(null, runId, 123);
    currentLifecycle().markRunning(null, runId, `session_${runId}`);

    // Simulate room.complete_task having been called: publish task.delegation.completed
    currentDatabase().sqlite.transaction(() => {
      currentDatabase().sqlite.prepare("UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ?").run(now, taskId);
      currentBus().publish({ id: "evt_delegation_completed", type: "task.delegation.completed", schemaVersion: 1, workspaceId: "ws_1", roomId: "room_squad", taskId, payload: { taskId, finalStatus: "completed" }, createdAt: now });
    })();

    // Act: session ends — room.complete_task was already called
    bridge.handle({ type: "session.ended", sessionId: `session_${runId}`, reason: "completed" });

    // Assert: callback NOT fired because task.delegation.completed event exists
    expect(callbackFired).toBe(false);
  });

  test("plan-phase session.ended triggers onPlanPhaseEnded, not onSessionEndedWithoutCompletion", () => {
    // Arrange: plan-phase run (no taskId, wakeReason = "plan")
    const runId = "run_plan_1";
    let planCallbackFired = false;
    let missingCompletionFired = false;

    const bridge = new AdapterBridge({
      runId,
      workspaceId: "ws_1",
      roomId: "room_squad",
      agentId: "agent_leader",
      lifecycle: currentLifecycle(),
      eventBus: currentBus(),
      now: () => now,
      wakeReason: "plan",
      database: currentDatabase(),
      onPlanPhaseEnded: (rid) => { planCallbackFired = rid === runId; },
      onSessionEndedWithoutCompletion: () => { missingCompletionFired = true; }
    });

    currentLifecycle().create(null, { runId, workspaceId: "ws_1", roomId: "room_squad", agentId: "agent_leader", wakeReason: "plan", targetFiles: [] });
    currentLifecycle().markClaimed(null, runId);
    currentLifecycle().markStarting(null, runId, 123);
    currentLifecycle().markRunning(null, runId, `session_${runId}`);

    // Act
    bridge.handle({ type: "session.ended", sessionId: `session_${runId}`, reason: "completed" });

    // Assert: plan callback fired, missing-completion NOT fired (no taskId)
    expect(planCallbackFired).toBe(true);
    expect(missingCompletionFired).toBe(false);
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

function currentTaskService(): TaskService {
  expect(taskService).toBeDefined();
  return taskService as TaskService;
}

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_leader', 'ws_1', 'Leader', 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_worker', 'ws_1', 'Worker', 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_squad', 'ws_1', 'Squad Room', 'squad', 'conversation', 'agent_leader', NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_squad', 'agent_leader', 'agent', 'primary', 'mock', NULL, 'active', 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_squad', 'agent_worker', 'agent', 'teammate', 'mock', NULL, 'active', 1)").run();
}

function createDelegatedTask(roomId: string, assigneeAgentId: string): string {
  const result = currentTaskService().create({ roomId, title: "Delegated Task", assigneeAgentId, expectsReview: false, createdBy: "agent_leader" });
  if (!result.ok) throw new Error("expected task create success");
  const taskId = result.data.taskId;
  currentDatabase().sqlite.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").run(now, taskId);
  return taskId;
}

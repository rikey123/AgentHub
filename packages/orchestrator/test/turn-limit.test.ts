import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { AdapterBridge, type RunLifecycleService } from "../src/index.ts";

let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let publishSpy: ReturnType<typeof vi.spyOn> | undefined;
let dispatchSpy: ReturnType<typeof vi.fn> | undefined;
let bridge: AdapterBridge | undefined;

let now = 1_000;

beforeEach(() => {
  database = createDatabase({ path: ":memory:", applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  publishSpy = vi.spyOn(currentBus(), "publish");
  dispatchSpy = vi.fn(() => ({ ok: true }));
  bridge = new AdapterBridge({
    runId: "run_1",
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    taskId: "task_1",
    lifecycle: {} as unknown as RunLifecycleService,
    eventBus: currentBus(),
    now: () => now,
    getCommandBus: () => ({ dispatch: currentDispatch } as never),
    database: currentDatabase()
  });

  seedWorkspaceRoomTask();
  publishSpy.mockClear();
  dispatchSpy.mockClear();
});

  afterEach(() => {
    currentBus().close();
    currentDatabase().sqlite.close();
    database = undefined;
    eventBus = undefined;
    publishSpy = undefined;
    dispatchSpy = undefined;
    bridge = undefined;
    now = 1_000;
    vi.restoreAllMocks();
  });

describe("AdapterBridge turn limit", () => {
  test("reaching max_turns blocks task and wakes leader exactly once", () => {
    currentBridge().handle({ type: "message.part.delta", messageId: "msg_1", delta: "hello" });
    currentBridge().handle({ type: "message.part.delta", messageId: "msg_2", delta: "world" });

    expect(currentDatabase().sqlite.prepare("SELECT status, blocker_reason FROM tasks WHERE id = ?").get("task_1")).toMatchObject({
      status: "blocked",
      blocker_reason: "turn_limit_exceeded"
    });
    expect(taskStatusChangedEvents()).toHaveLength(1);
    expect(taskStatusChangedEvents()[0]).toMatchObject({ type: "task.status.changed" });
    expect(currentDispatchSpy()).toHaveBeenCalledTimes(2);
    expect(currentDispatchSpy()).toHaveBeenCalledWith(expect.objectContaining({ type: "WakeAgent", reason: "task_blocked", taskId: "task_1" }), expect.objectContaining({ origin: "internal" }));
    expect(currentDispatchSpy()).toHaveBeenCalledWith(expect.objectContaining({ type: "CancelRun", runId: "run_1" }), expect.objectContaining({ origin: "internal" }));
  });

  test("turn limit latch prevents duplicate events on subsequent deltas", () => {
    currentDatabase().sqlite.prepare("UPDATE tasks SET max_turns = 1 WHERE id = ?").run("task_1");
    currentBridge().handle({ type: "message.part.delta", messageId: "msg_same", delta: "1" });
    currentBridge().handle({ type: "message.part.delta", messageId: "msg_same", delta: "2" });
    currentBridge().handle({ type: "message.part.delta", messageId: "msg_same", delta: "3" });

    expect(taskStatusChangedEvents()).toHaveLength(1);
    expect(currentDispatchSpy().mock.calls.filter(([command]) => (command as { type: string }).type === "WakeAgent")).toHaveLength(1);
    expect(currentDispatchSpy().mock.calls.filter(([command]) => (command as { type: string }).type === "CancelRun")).toHaveLength(1);
  });

  test("task without max_turns is never blocked by turn limit", () => {
    currentDatabase().sqlite.prepare("UPDATE tasks SET max_turns = NULL WHERE id = ?").run("task_1");

    currentBridge().handle({ type: "message.part.delta", messageId: "msg_a", delta: "a" });
    currentBridge().handle({ type: "message.part.delta", messageId: "msg_b", delta: "b" });
    currentBridge().handle({ type: "message.part.delta", messageId: "msg_c", delta: "c" });

    expect(currentDatabase().sqlite.prepare("SELECT status, blocker_reason FROM tasks WHERE id = ?").get("task_1")).toMatchObject({
      status: "in_progress",
      blocker_reason: null
    });
    expect(taskStatusChangedEvents()).toHaveLength(0);
    expect(currentDispatchSpy()).not.toHaveBeenCalled();
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

function currentBridge(): AdapterBridge {
  expect(bridge).toBeDefined();
  return bridge as AdapterBridge;
}

function currentPublishSpy(): ReturnType<typeof vi.spyOn> {
  expect(publishSpy).toBeDefined();
  return publishSpy as ReturnType<typeof vi.spyOn>;
}

function taskStatusChangedEvents(): Array<{ readonly type: string }> {
  return currentPublishSpy().mock.calls
    .map(([event]) => event as { readonly type: string })
    .filter((event) => event.type === "task.status.changed");
}

function currentDispatchSpy(): ReturnType<typeof vi.fn> {
  expect(dispatchSpy).toBeDefined();
  return dispatchSpy as ReturnType<typeof vi.fn>;
}

function currentDispatch(...args: Parameters<NonNullable<ReturnType<typeof currentCommandBus>['dispatch']>>): ReturnType<typeof dispatchSpy> {
  expect(dispatchSpy).toBeDefined();
  return dispatchSpy!(...args);
}

function currentCommandBus(): { readonly dispatch: typeof currentDispatch } {
  return { dispatch: currentDispatch };
}

function seedWorkspaceRoomTask(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'team', 'conversation', 'agent_leader', NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, title, description, status, assignee_agent_id, source_run_id, source_message_id, dependencies, priority, assignee_role_id, assignee_binding_id, delegation_chain, expects_review, due_at, created_by, created_at, updated_at, blocker_reason, max_turns, board_column) VALUES ('task_1', 'ws_1', 'room_1', NULL, 'Task', NULL, 'in_progress', NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, 0, NULL, 'user_1', 1, 1, NULL, 2, NULL)").run();
}

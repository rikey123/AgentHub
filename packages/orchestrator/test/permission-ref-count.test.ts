import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { RunLifecycleService } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-orchestrator-permission-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), { now: () => now });
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  lifecycle = undefined;
  now = 1_000;
});

describe("RunLifecycleService permission ref-counting", () => {
  test("single allowed permission resumes run", () => {
    createRunningRun("run_1");

    currentLifecycle().markWaitingPermission(null, "run_1", "req1");

    expect(statusOf("run_1")).toBe("waiting_permission");

    currentLifecycle().markPermissionResolved(null, "run_1", "req1", "allowed");

    expect(statusOf("run_1")).toBe("running");
    expect(eventTypes("run_1")).toEqual(["agent.run.queued", "agent.run.started", "agent.run.waiting_permission", "agent.run.resumed"]);
  });

  test("two concurrent permissions resume run only when both resolved", () => {
    createRunningRun("run_2");

    currentLifecycle().markWaitingPermission(null, "run_2", "req1");
    currentLifecycle().markWaitingPermission(null, "run_2", "req2");

    currentLifecycle().markPermissionResolved(null, "run_2", "req1", "allowed");
    expect(statusOf("run_2")).toBe("waiting_permission");
    expect(eventTypes("run_2")).toEqual(["agent.run.queued", "agent.run.started", "agent.run.waiting_permission"]);

    currentLifecycle().markPermissionResolved(null, "run_2", "req2", "allowed");

    expect(statusOf("run_2")).toBe("running");
    expect(eventTypes("run_2")).toEqual(["agent.run.queued", "agent.run.started", "agent.run.waiting_permission", "agent.run.resumed"]);
  });

  test("denied permission does not resume run", () => {
    createRunningRun("run_3");

    currentLifecycle().markWaitingPermission(null, "run_3", "req1");
    currentLifecycle().markPermissionResolved(null, "run_3", "req1", "denied");

    expect(statusOf("run_3")).toBe("waiting_permission");
    expect(eventTypes("run_3")).toEqual(["agent.run.queued", "agent.run.started", "agent.run.waiting_permission"]);
    expect(eventTypes("run_3")).not.toContain("agent.run.resumed");
  });

  test("unknown permissionId in markPermissionResolved is a no-op", () => {
    createRunningRun("run_4");

    currentLifecycle().markWaitingPermission(null, "run_4", "req1");

    expect(() => currentLifecycle().markPermissionResolved(null, "run_4", "unknown-req", "allowed")).not.toThrow();

    expect(statusOf("run_4")).toBe("waiting_permission");
    expect(eventTypes("run_4")).toEqual(["agent.run.queued", "agent.run.started", "agent.run.waiting_permission"]);
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

function createRunningRun(runId: string): void {
  currentLifecycle().create(null, {
    runId,
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    wakeReason: "primary_turn",
    targetFiles: []
  });
  currentLifecycle().markClaimed(null, runId);
  currentLifecycle().markStarting(null, runId, 123);
  currentLifecycle().markRunning(null, runId, `session_${runId}`);
}

function statusOf(runId: string): string {
  return currentLifecycle().read(runId).status;
}

function eventTypes(runId: string): string[] {
  return currentDatabase().sqlite
    .prepare("SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC")
    .all(runId)
    .map((row) => (row as { readonly type: string }).type);
}

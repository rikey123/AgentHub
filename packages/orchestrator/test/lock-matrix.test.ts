import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { RunLifecycleService, RunQueue } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let now = 2_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-lock-matrix-"));
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
  now = 2_000;
});

describe("RunQueue lock matrix", () => {
  test("workspace lock blocks file lock request in same workspace", async () => {
    createRun("run_workspace", [], "ws_1", "room_1", "agent_1");
    createRun("run_file", ["src/a.ts"], "ws_1", "room_2", "agent_2");

    await queue().scheduleTick();

    expect(statusOf("run_workspace")).toBe("starting");
    expect(statusOf("run_file")).toBe("waiting");
    expect(waitingReason("run_file")).toBe("workspace_lock_held_by:run_workspace");
  });

  test("file lock blocks workspace lock request in same workspace", async () => {
    createRun("run_file", ["src/a.ts"], "ws_1", "room_1", "agent_1");
    createRun("run_workspace", [], "ws_1", "room_2", "agent_2");

    await queue().scheduleTick();

    expect(statusOf("run_file")).toBe("starting");
    expect(statusOf("run_workspace")).toBe("waiting");
    expect(waitingReason("run_workspace")).toBe("file_locks_held_in_workspace:ws_1");
  });

  test("different workspaces do NOT block each other", async () => {
    createRun("run_a", ["src/a.ts"], "ws_1", "room_1", "agent_1");
    createRun("run_b", ["src/a.ts"], "ws_2", "room_2", "agent_2");

    await queue().scheduleTick();

    expect(statusOf("run_a")).toBe("starting");
    expect(statusOf("run_b")).toBe("starting");
  });

  test("same workspace, different file locks run in parallel (different lock_key)", async () => {
    createRun("run_a", ["src/a.ts"], "ws_1", "room_1", "agent_1");
    createRun("run_b", ["src/b.ts"], "ws_1", "room_2", "agent_2");

    await queue().scheduleTick();

    expect(statusOf("run_a")).toBe("starting");
    expect(statusOf("run_b")).toBe("starting");
    expect(lockKeys()).toEqual(expect.arrayContaining(["ws_1:src/a.ts", "ws_1:src/b.ts"]));
  });

  test("targetFiles=undefined degrades to workspace lock", async () => {
    createRun("run_a", undefined, "ws_1", "room_1", "agent_1");

    await queue().scheduleTick();

    expect(lockRows()).toEqual(expect.arrayContaining([{ lock_type: "workspace", lock_key: "ws_1", workspace_id: "ws_1", run_id: "run_a" }]));
  });

  test("delegated isolated worktree runs in the same room can start in parallel", async () => {
    createRun("run_a", undefined, "ws_1", "room_1", "agent_a", { wakeReason: "delegated_task", workspaceMode: "isolated_worktree" });
    createRun("run_b", undefined, "ws_1", "room_1", "agent_b", { wakeReason: "delegated_task", workspaceMode: "isolated_worktree" });

    await queue().scheduleTick();

    expect(statusOf("run_a")).toBe("starting");
    expect(statusOf("run_b")).toBe("starting");
    expect(lockRows()).toEqual([
      { lock_type: "agent", lock_key: "agent_a", workspace_id: null, run_id: "run_a" },
      { lock_type: "agent", lock_key: "agent_b", workspace_id: null, run_id: "run_b" }
    ]);
  });

  test("stale waiting run starts once its blocking lock has been released", async () => {
    createRun("run_blocker", [], "ws_1", "room_1", "agent_blocker");
    createRun("run_waiting", [], "ws_1", "room_2", "agent_waiting");
    const runQueue = new RunQueue({ database: currentDatabase(), lifecycle: currentLifecycle(), pid: 321, now: () => now, lockTimeoutMs: 100 });

    await runQueue.scheduleTick();
    expect(statusOf("run_blocker")).toBe("starting");
    expect(statusOf("run_waiting")).toBe("waiting");

    runQueue.releaseLocks("run_blocker");
    now += 101;
    await runQueue.scheduleTick();

    expect(statusOf("run_waiting")).toBe("starting");
    expect(waitingReason("run_waiting")).toBeNull();
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

function queue(): RunQueue {
  return new RunQueue({ database: currentDatabase(), lifecycle: currentLifecycle(), pid: 321, now: () => now });
}

function createRun(
  runId: string,
  targetFiles: readonly string[] | undefined,
  workspaceId = "ws_1",
  roomId = "room_1",
  agentId = "agent_1",
  options: { readonly wakeReason?: "primary_turn" | "delegated_task"; readonly workspaceMode?: "isolated_worktree" } = {}
): void {
  currentLifecycle().create(null, {
    runId,
    workspaceId,
    roomId,
    agentId,
    wakeReason: options.wakeReason ?? "primary_turn",
    ...(options.workspaceMode !== undefined ? { workspaceMode: options.workspaceMode } : {}),
    ...(targetFiles !== undefined ? { targetFiles } : {}),
    messageId: `msg_${runId}`
  });
}

function statusOf(runId: string): string {
  return currentLifecycle().read(runId).status;
}

function waitingReason(runId: string): string | null {
  return currentLifecycle().read(runId).waiting_reason;
}

function lockRows(): Array<{ readonly lock_type: string; readonly lock_key: string; readonly workspace_id: string | null; readonly run_id: string }> {
  return currentDatabase().sqlite.prepare("SELECT lock_type, lock_key, workspace_id, run_id FROM run_locks ORDER BY lock_type, lock_key").all() as Array<{ readonly lock_type: string; readonly lock_key: string; readonly workspace_id: string | null; readonly run_id: string }>;
}

function lockKeys(): string[] {
  return lockRows().map((row) => row.lock_key);
}

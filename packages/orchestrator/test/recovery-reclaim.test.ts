import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { ReclaimStaleClaimedRun, RunLifecycleService } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let bus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-reclaim-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  bus = new EventBus({ database: currentDatabase() });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), { now: () => now });
  seedRun();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  bus = undefined;
  lifecycle = undefined;
  now = 100_000;
  vi.restoreAllMocks();
});

let now = 100_000;

describe("ReclaimStaleClaimedRun", () => {
  test("scans a stale claimed run and fails it as claim_aborted transient", async () => {
    const failSpy = vi.spyOn(currentLifecycle(), "fail");
    const reclaim = new ReclaimStaleClaimedRun(currentDatabase(), currentLifecycle(), () => ({ crashRecovery: "fail_run" }), () => now, 123);

    await reclaim.scan();

    expect(failSpy).toHaveBeenCalledWith(null, "run_stuck", "claim_aborted", "transient");
    expect(currentDatabase().sqlite.prepare("SELECT status, failure_class, error FROM runs WHERE id = 'run_stuck'").get()).toMatchObject({
      status: "failed",
      failure_class: "transient",
      error: "claim_aborted"
    });
  });

  test("attaches a resumable running run from a previous daemon pid", async () => {
    currentLifecycle().markStarting(null, "run_stuck", 456);
    currentLifecycle().markRunning(null, "run_stuck", "ses_abc");
    const attachSession = vi.fn();
    const reclaim = new ReclaimStaleClaimedRun(currentDatabase(), currentLifecycle(), () => ({ crashRecovery: "resumable", attachSession }), () => now, 123);

    await reclaim.scan();

    expect(attachSession).toHaveBeenCalledWith({ runId: "run_stuck", adapterSessionId: "ses_abc" });
    expect(currentDatabase().sqlite.prepare("SELECT status, adapter_session_id, pid_at_start FROM runs WHERE id = 'run_stuck'").get()).toMatchObject({
      status: "running",
      adapter_session_id: "ses_abc",
      pid_at_start: 123
    });
  });
});

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(bus).toBeDefined();
  return bus as EventBus;
}

function currentLifecycle(): RunLifecycleService {
  expect(lifecycle).toBeDefined();
  return lifecycle as RunLifecycleService;
}

function seedRun(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'solo', 'conversation', 'agent_1', NULL, 1, 1)").run();
  currentLifecycle().create(null, {
    runId: "run_stuck",
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    wakeReason: "primary_turn",
    messageId: "msg_run_stuck"
  });
  currentLifecycle().markClaimed(null, "run_stuck");
  currentDatabase().sqlite.prepare("UPDATE runs SET claimed_at = ? WHERE id = 'run_stuck'").run(now - 31_000);
}

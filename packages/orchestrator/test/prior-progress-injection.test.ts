import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { buildRunPrompt, RunLifecycleService, type RunRow } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-orchestrator-prior-progress-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), { now: () => now });
  seedRoom();
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

describe("buildRunPrompt prior-progress injection", () => {
  test("run with task checkpoint includes prior-progress block in prompt", () => {
    createRun("run_1", { taskId: "task_1" });
    currentDatabase().sqlite.prepare(
      "INSERT INTO task_checkpoints (id, task_id, run_id, progress_summary, files_touched, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("cp_1", "task_1", "run_1", "Built the ref-counting core", JSON.stringify(["packages/orchestrator/src/run-lifecycle-service.ts"]), now);

    const prompt = buildRunPrompt(run("run_1"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("<prior-progress>");
    expect(prompt).toContain("Built the ref-counting core");
    expect(prompt).toContain("packages/orchestrator/src/run-lifecycle-service.ts");
  });

  test("run without task has no prior-progress block", () => {
    createRun("run_2");

    const prompt = buildRunPrompt(run("run_2"), currentDatabase(), { now: () => now });

    expect(prompt).not.toContain("<prior-progress>");
  });

  test("run with task but no checkpoint has no prior-progress block", () => {
    createRun("run_3", { taskId: "task_3" });

    const prompt = buildRunPrompt(run("run_3"), currentDatabase(), { now: () => now });

    expect(prompt).not.toContain("<prior-progress>");
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

function seedRoom(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_1', 'ws_1', 'Agent One', 'opencode', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'assisted', 'conversation', 'agent_1', NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', 'opencode', NULL, 'active', ?)").run(now);
}

function createRun(runId: string, options: { readonly taskId?: string } = {}): void {
  currentLifecycle().create(null, {
    runId,
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    wakeReason: "primary_turn",
    targetFiles: [],
    ...(options.taskId !== undefined ? { taskId: options.taskId } : {})
  });
}

function run(runId: string): RunRow {
  return currentLifecycle().read(runId);
}

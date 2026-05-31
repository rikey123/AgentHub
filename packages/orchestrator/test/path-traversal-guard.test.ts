import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { AdapterBridge, RunLifecycleService } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-orchestrator-path-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), { now: () => 1_000 });
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  lifecycle = undefined;
  vi.restoreAllMocks();
});

describe("AdapterBridge fs path traversal guard", () => {
  test("fs.writeTextFile with .. path is silently dropped", () => {
    const artifactFs = {
      writeTextFile: vi.fn(),
      deleteFile: vi.fn()
    };
    const bridge = createBridge(artifactFs);

    bridge.handle({ type: "fs.writeTextFile", path: "../../etc/passwd", content: "evil" });

    expect(artifactFs.writeTextFile).not.toHaveBeenCalled();
  });

  test("fs.writeTextFile with absolute path is silently dropped", () => {
    const artifactFs = {
      writeTextFile: vi.fn(),
      deleteFile: vi.fn()
    };
    const bridge = createBridge(artifactFs);

    bridge.handle({ type: "fs.writeTextFile", path: "/etc/passwd", content: "evil" });

    expect(artifactFs.writeTextFile).not.toHaveBeenCalled();
  });

  test("fs.deleteFile with .. path is silently dropped", () => {
    const artifactFs = {
      writeTextFile: vi.fn(),
      deleteFile: vi.fn()
    };
    const bridge = createBridge(artifactFs);

    bridge.handle({ type: "fs.deleteFile", path: "../secret.txt" });

    expect(artifactFs.deleteFile).not.toHaveBeenCalled();
  });

  test("valid relative path passes through to ArtifactFS", () => {
    const artifactFs = {
      writeTextFile: vi.fn(),
      deleteFile: vi.fn()
    };
    const bridge = createBridge(artifactFs);

    bridge.handle({ type: "fs.writeTextFile", path: "src/utils.ts", content: "code" });

    expect(artifactFs.writeTextFile).toHaveBeenCalledTimes(1);
    expect(artifactFs.writeTextFile).toHaveBeenCalledWith({ runId: "run_1", path: "src/utils.ts", content: "code" });
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

function createBridge(artifactFs: { readonly writeTextFile: ReturnType<typeof vi.fn>; readonly deleteFile: ReturnType<typeof vi.fn> }): AdapterBridge {
  return new AdapterBridge({
    runId: "run_1",
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    lifecycle: currentLifecycle(),
    eventBus: currentBus(),
    artifactFs
  });
}

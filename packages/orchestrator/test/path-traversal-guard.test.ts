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
  test("fs.writeTextFile with .. path is rejected with visible error event", () => {
    const artifactFs = { writeTextFile: vi.fn(), deleteFile: vi.fn() };
    const publishSpy = vi.spyOn(currentBus(), "publish");
    const bridge = createBridge(artifactFs);

    bridge.handle({ type: "fs.writeTextFile", path: "../../etc/passwd", content: "evil" });

    // ArtifactFS must NOT be called
    expect(artifactFs.writeTextFile).not.toHaveBeenCalled();
    // Spec §path-traversal-guard: rejected paths return { error: "path_traversal_denied", path }
    // For adapter events, this is surfaced as a tool.call.completed error event
    const errorEvents = (publishSpy.mock.calls as Array<[{ type: string; payload?: { output?: { error?: string; path?: string } } }]>)
      .filter(([e]) => e.type === "tool.call.completed" && e.payload?.output?.error === "path_traversal_denied");
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0]![0].payload?.output?.path).toBe("../../etc/passwd");
  });

  test("fs.writeTextFile with absolute path is rejected with visible error event", () => {
    const artifactFs = { writeTextFile: vi.fn(), deleteFile: vi.fn() };
    const publishSpy = vi.spyOn(currentBus(), "publish");
    const bridge = createBridge(artifactFs);

    bridge.handle({ type: "fs.writeTextFile", path: "/etc/passwd", content: "evil" });

    expect(artifactFs.writeTextFile).not.toHaveBeenCalled();
    const errorEvents = (publishSpy.mock.calls as Array<[{ type: string; payload?: { output?: { error?: string } } }]>)
      .filter(([e]) => e.type === "tool.call.completed" && e.payload?.output?.error === "path_traversal_denied");
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("fs.deleteFile with .. path is rejected with visible error event", () => {
    const artifactFs = { writeTextFile: vi.fn(), deleteFile: vi.fn() };
    const publishSpy = vi.spyOn(currentBus(), "publish");
    const bridge = createBridge(artifactFs);

    bridge.handle({ type: "fs.deleteFile", path: "../secret.txt" });

    expect(artifactFs.deleteFile).not.toHaveBeenCalled();
    const errorEvents = (publishSpy.mock.calls as Array<[{ type: string; payload?: { output?: { error?: string } } }]>)
      .filter(([e]) => e.type === "tool.call.completed" && e.payload?.output?.error === "path_traversal_denied");
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("valid relative path passes through to ArtifactFS", () => {
    const artifactFs = { writeTextFile: vi.fn(), deleteFile: vi.fn() };
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

function createBridge(artifactFs: { readonly writeTextFile: ReturnType<typeof vi.fn>; readonly deleteFile: ReturnType<typeof vi.fn>; readonly buildRunArtifact?: ReturnType<typeof vi.fn> }): AdapterBridge {
  return new AdapterBridge({
    runId: "run_1",
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    lifecycle: currentLifecycle(),
    eventBus: currentBus(),
    artifactFs: artifactFs as unknown as import("../src/adapter-bridge.ts").AdapterArtifactFSBoundary
  });
}

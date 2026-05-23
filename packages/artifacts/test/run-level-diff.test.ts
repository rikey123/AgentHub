import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactFSRunRegistry, ArtifactService } from "../src/index.ts";

let dir: string | undefined;
let workspaceRoot: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let service: ArtifactService | undefined;
let registry: ArtifactFSRunRegistry | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agenthub-run-diff-"));
  workspaceRoot = join(dir, "workspace");
  mkdirSync(workspaceRoot, { recursive: true });
  database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDb() });
  service = new ArtifactService({ database: currentDb(), eventBus: currentEventBus(), now: () => 70_000 });
  registry = new ArtifactFSRunRegistry({ database: currentDb(), eventBus: currentEventBus(), service: currentService(), now: () => 70_000 });
  currentDb().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, 1, 1)").run(currentRoot());
  currentDb().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'assisted', 'conversation', 'builder', NULL, 1, 1)").run();
});

afterEach(() => {
  eventBus?.close();
  database?.sqlite.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  workspaceRoot = undefined;
  database = undefined;
  eventBus = undefined;
  service = undefined;
  registry = undefined;
});

describe("ArtifactFSRunRegistry run-level diffs", () => {
  it("builds a four-file diff after one file is rolled back and rewritten", () => {
    writeWorkspace("src/a.ts", "old a");
    writeWorkspace("src/b.ts", "old b");
    writeWorkspace("src/c.ts", "old c");
    writeWorkspace("src/d.ts", "old d");
    const run = currentRegistry().beginRun({ runId: "run_four_files", workspaceId: "ws_1", roomId: "room_1", agentId: "builder", mode: "shadow_buffer" });

    run.write("src/a.ts", "new a");
    run.write("src/b.ts", "new b");
    run.write("src/c.ts", "experimental c");
    run.write("src/d.ts", "new d");
    run.write("src/c.ts", "old c");
    run.write("src/c.ts", "new c");
    const artifact = currentRegistry().buildRunArtifact({ runId: "run_four_files", title: "Run four file diff" });

    expect(artifact).toMatchObject({ type: "diff", status: "draft", runId: "run_four_files" });
    expect(artifact ? currentService().files(artifact.id).map((file) => ({ path: file.path, oldContent: file.oldContent, newContent: file.newContent })) : []).toEqual([
      { path: "src/a.ts", oldContent: "old a", newContent: "new a" },
      { path: "src/b.ts", oldContent: "old b", newContent: "new b" },
      { path: "src/c.ts", oldContent: "old c", newContent: "new c" },
      { path: "src/d.ts", oldContent: "old d", newContent: "new d" }
    ]);
  });

  it("builds a draft artifact for a failed run that never completed", () => {
    const run = currentRegistry().beginRun({ runId: "run_failed", workspaceId: "ws_1", roomId: "room_1", agentId: "builder", mode: "shadow_buffer" });

    run.write("src/partial.ts", "partial work");
    const artifact = currentRegistry().buildRunArtifact({ runId: "run_failed", title: "Failed run diff" });

    expect(artifact).toMatchObject({ type: "diff", status: "draft", runId: "run_failed" });
    expect(artifact ? currentService().files(artifact.id).map((file) => file.path) : []).toEqual(["src/partial.ts"]);
  });
});

function currentDb(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentEventBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function currentService(): ArtifactService {
  expect(service).toBeDefined();
  return service as ArtifactService;
}

function currentRegistry(): ArtifactFSRunRegistry {
  expect(registry).toBeDefined();
  return registry as ArtifactFSRunRegistry;
}

function currentRoot(): string {
  expect(workspaceRoot).toBeDefined();
  return workspaceRoot as string;
}

function writeWorkspace(path: string, content: string): void {
  const target = join(currentRoot(), path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

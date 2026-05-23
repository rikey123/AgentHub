import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArtifactFSRunRegistry, ArtifactService } from "@agenthub/artifacts";
import { createEventBus } from "@agenthub/bus";
import { createDatabase } from "@agenthub/db";
import { RunLifecycleService } from "@agenthub/orchestrator";
import { describe, expect, it } from "vitest";

import { MockAdapterManager } from "../src/index.ts";

describe("MockAdapter", () => {
  it("emits assistant output and terminal lifecycle through AdapterBridge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-mock-test-"));
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('w', 'w', '.', 1, 1)").run();
    database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('r', 'w', 'r', 'solo', 'conversation', 'a', NULL, 1, 1)").run();
    const eventBus = createEventBus({ database });
    const lifecycle = new RunLifecycleService(database, eventBus);
    lifecycle.create(null, { runId: "run", workspaceId: "w", roomId: "r", agentId: "a", wakeReason: "primary_turn", messageId: "m" });
    lifecycle.markClaimed(null, "run");
    lifecycle.markStarting(null, "run", 123);
    const adapter = new MockAdapterManager({ database, eventBus, lifecycle, script: { steps: [{ type: "say", text: "hi" }] } });
    await adapter.runAgent(lifecycle.read("run"));
    const run = lifecycle.read("run");
    expect(run.status).toBe("completed");
    expect(adapter.llmCallsFor("a")).toBe(1);
    database.sqlite.close();
  }, 15_000);

  it("routes mock file writes through ArtifactFS and builds one run-level artifact on completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-mock-artifactfs-"));
    const workspace = join(dir, "workspace");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src", "a.ts"), "old a", "utf8");
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('w', 'w', ?, 1, 1)").run(workspace);
    database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('r', 'w', 'r', 'solo', 'conversation', 'a', NULL, 1, 1)").run();
    const eventBus = createEventBus({ database });
    const lifecycle = new RunLifecycleService(database, eventBus);
    const artifacts = new ArtifactService({ database, eventBus });
    const artifactFs = new ArtifactFSRunRegistry({ database, service: artifacts, eventBus });
    lifecycle.create(null, { runId: "run", workspaceId: "w", roomId: "r", agentId: "a", wakeReason: "primary_turn", workspaceMode: "shadow_buffer", messageId: "m" });
    lifecycle.markClaimed(null, "run");
    lifecycle.markStarting(null, "run", 123);
    const adapter = new MockAdapterManager({ database, eventBus, lifecycle, artifactFs, script: { steps: [{ type: "write", path: "src/a.ts", content: "new a" }, { type: "write", path: "src/b.ts", content: "new b" }] } });

    await adapter.runAgent(lifecycle.read("run"));

    expect(readFileSync(join(workspace, "src", "a.ts"), "utf8")).toBe("old a");
    const artifactRows = database.sqlite.prepare("SELECT id, type, status, run_id FROM artifacts").all() as { readonly id: string; readonly type: string; readonly status: string; readonly run_id: string }[];
    expect(artifactRows).toMatchObject([{ type: "diff", status: "draft", run_id: "run" }]);
    const files = database.sqlite.prepare("SELECT path, old_content, new_content, file_status FROM artifact_files ORDER BY path ASC").all() as unknown[];
    expect(files).toEqual([
      { path: "src/a.ts", old_content: "old a", new_content: "new a", file_status: "modified" },
      { path: "src/b.ts", old_content: "", new_content: "new b", file_status: "added" }
    ]);
    database.sqlite.close();
  }, 15_000);

  it("does not create a run-level artifact when the run has no ArtifactFS writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-mock-artifactfs-empty-"));
    const workspace = join(dir, "workspace");
    mkdirSync(workspace, { recursive: true });
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('w', 'w', ?, 1, 1)").run(workspace);
    database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('r', 'w', 'r', 'solo', 'conversation', 'a', NULL, 1, 1)").run();
    const eventBus = createEventBus({ database });
    const lifecycle = new RunLifecycleService(database, eventBus);
    const artifacts = new ArtifactService({ database, eventBus });
    const artifactFs = new ArtifactFSRunRegistry({ database, service: artifacts, eventBus });
    lifecycle.create(null, { runId: "run", workspaceId: "w", roomId: "r", agentId: "a", wakeReason: "primary_turn", workspaceMode: "shadow_buffer", messageId: "m" });
    lifecycle.markClaimed(null, "run");
    lifecycle.markStarting(null, "run", 123);
    const adapter = new MockAdapterManager({ database, eventBus, lifecycle, artifactFs, script: { steps: [{ type: "say", text: "no writes" }] } });

    await adapter.runAgent(lifecycle.read("run"));

    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toMatchObject({ count: 0 });
    database.sqlite.close();
  }, 15_000);
});

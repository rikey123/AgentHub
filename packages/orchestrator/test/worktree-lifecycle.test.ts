import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { ArtifactFSRunRegistry, ArtifactService } from "../../artifacts/src/index.ts";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let service: ArtifactService | undefined;
let registry: ArtifactFSRunRegistry | undefined;
let tempDir: string | undefined;
let workspaceRoot: string | undefined;
let worktreeRoot: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-worktree-"));
  workspaceRoot = join(tempDir, "workspace");
  worktreeRoot = join(tempDir, "worktree");
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });

  database = createDatabase({ path: ":memory:", applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  service = new ArtifactService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
  registry = new ArtifactFSRunRegistry({ database: currentDatabase(), service: currentService(), eventBus: currentBus(), now: () => now });

  seedWorkspace();
  execFileSyncMock.mockReset();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  database = undefined;
  eventBus = undefined;
  service = undefined;
  registry = undefined;
  tempDir = undefined;
  workspaceRoot = undefined;
  worktreeRoot = undefined;
  now = 1_000;
  vi.restoreAllMocks();
});

let now = 1_000;

describe("ArtifactFSRunRegistry.buildWorktreeDiffArtifact", () => {
  test("isolated_worktree with file changes creates worktree_diff artifact and publishes event", () => {
    const runId = "run_worktree_diff";
    currentRegistry().beginRun({ runId, workspaceId: "ws_1", agentId: "agent_1", mode: "isolated_worktree", workDir: currentWorktreeRoot() });
    execFileSyncMock
      .mockReturnValueOnce("diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n")
      .mockReturnValueOnce("src/app.ts\n");

    const artifact = currentRegistry().buildWorktreeDiffArtifact({ runId, title: "Worktree changes" });

    expect(artifact).toMatchObject({ type: "worktree_diff", status: "ready_for_review", runId, workspaceId: "ws_1", title: "Worktree changes" });
    expect(currentDatabase().sqlite.prepare("SELECT type, status, run_id, workspace_id, title FROM artifacts WHERE run_id = ?").get(runId)).toMatchObject({
      type: "worktree_diff",
      status: "ready_for_review",
      run_id: runId,
      workspace_id: "ws_1",
      title: "Worktree changes"
    });
    expect(currentDatabase().sqlite.prepare("SELECT path, patch, file_status FROM artifact_files WHERE artifact_id = ?").get(artifact?.id)).toMatchObject({
      path: "worktree.patch",
      patch: expect.stringContaining("diff --git a/src/app.ts b/src/app.ts"),
      file_status: "modified"
    });
    expect(currentDatabase().sqlite.prepare("SELECT type, payload FROM events WHERE type = 'worktree.diff.ready' AND run_id = ?").get(runId)).toMatchObject({
      type: "worktree.diff.ready"
    });
    expect(currentRegistry().buildRunArtifact({ runId })).toBeUndefined();
  });

  test("isolated_worktree with no file changes returns undefined without consuming run", () => {
    const runId = "run_worktree_empty";
    currentRegistry().beginRun({ runId, workspaceId: "ws_1", agentId: "agent_1", mode: "isolated_worktree", workDir: currentWorktreeRoot() });
    execFileSyncMock.mockReturnValueOnce("");

    const artifact = currentRegistry().buildWorktreeDiffArtifact({ runId });

    expect(artifact).toBeUndefined();
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'worktree.diff.ready' AND run_id = ?").get(runId)).toMatchObject({ count: 0 });

    expect(() => currentRegistry().writeTextFile({ runId, path: "later.txt", content: "hello" })).not.toThrow();
    const fallback = currentRegistry().buildRunArtifact({ runId });
    expect(fallback).toMatchObject({ type: "diff", status: "draft", runId });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE run_id = ? AND type = 'diff'").get(runId)).toMatchObject({ count: 1 });
  });

  test("shadow_buffer mode returns undefined without consuming run", () => {
    const runId = "run_shadow_buffer";
    currentRegistry().beginRun({ runId, workspaceId: "ws_1", agentId: "agent_1", mode: "shadow_buffer" });

    const artifact = currentRegistry().buildWorktreeDiffArtifact({ runId });

    expect(artifact).toBeUndefined();
    expect(() => currentRegistry().writeTextFile({ runId, path: "shadow.txt", content: "hello" })).not.toThrow();
    const fallback = currentRegistry().buildRunArtifact({ runId });
    expect(fallback).toMatchObject({ type: "diff", status: "draft", runId });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'worktree.diff.ready' AND run_id = ?").get(runId)).toMatchObject({ count: 0 });
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

function currentService(): ArtifactService {
  expect(service).toBeDefined();
  return service as ArtifactService;
}

function currentRegistry(): ArtifactFSRunRegistry {
  expect(registry).toBeDefined();
  return registry as ArtifactFSRunRegistry;
}

function currentWorktreeRoot(): string {
  expect(worktreeRoot).toBeDefined();
  return worktreeRoot as string;
}

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, ?, ?)"
  ).run(currentWorkspaceRoot(), now, now);
}

function currentWorkspaceRoot(): string {
  expect(workspaceRoot).toBeDefined();
  return workspaceRoot as string;
}

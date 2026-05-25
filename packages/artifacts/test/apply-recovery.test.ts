import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactService, sha256, type FileOps } from "../src/index.ts";

let dir: string | undefined;
let workspaceRoot: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agenthub-apply-recovery-"));
  workspaceRoot = join(dir, "workspace");
  mkdirSync(workspaceRoot, { recursive: true });
  database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDb() });
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
});

describe("ArtifactService apply recovery", () => {
  it("applies a reviewed DiffCard and writes files to disk", () => {
    writeWorkspace("src/a.ts", "old");
    const service = new ArtifactService({ database: currentDb(), eventBus: currentEventBus(), now: () => 50_000 });
    const artifact = service.create(baseDiffInput("src/a.ts", "old", "new"));

    const reviewed = service.review(artifact.id);
    const applied = service.apply(artifact.id);

    expect(reviewed.status).toBe("reviewing");
    expect(applied.status).toBe("applied");
    expect(readWorkspace("src/a.ts")).toBe("new");
    expect(service.files(artifact.id).map((file) => file.appliedState)).toEqual(["new"]);
  });

  it("rejects stale_base before writing to disk", () => {
    writeWorkspace("a.txt", "external");
    const service = new ArtifactService({ database: currentDb(), eventBus: currentEventBus(), now: () => 50_000 });
    const artifact = service.create(baseDiffInput("a.txt", "old", "new"));

    service.review(artifact.id);
    const applied = service.apply(artifact.id);

    expect(applied.status).toBe("failed");
    expect(readWorkspace("a.txt")).toBe("external");
    expect(lastPayload("artifact.failed")).toMatchObject({ reason: "stale_base", path: "a.txt", failedAt: "a.txt", recoveryRequired: false });
  });

  it("fails permission_denied before writing to disk", () => {
    writeWorkspace("a.txt", "old");
    const service = new ArtifactService({ database: currentDb(), eventBus: currentEventBus(), permissionCheck: () => ({ ok: false, path: "a.txt", reason: "deny profile" }), now: () => 50_000 });
    const artifact = service.create(baseDiffInput("a.txt", "old", "new"));

    service.review(artifact.id);
    const applied = service.apply(artifact.id);

    expect(applied.status).toBe("failed");
    expect(readWorkspace("a.txt")).toBe("old");
    expect(lastPayload("artifact.failed")).toMatchObject({ reason: "permission_denied", path: "a.txt", failedAt: "a.txt", recoveryRequired: false });
  });

  it("rolls back a multi-file apply when a later file write fails", () => {
    writeWorkspace("a.txt", "a_old");
    writeWorkspace("b.txt", "b_old");
    const service = new ArtifactService({ database: currentDb(), eventBus: currentEventBus(), fileOps: failOnRename("b.txt"), now: () => 50_000 });
    const artifact = service.create({
      workspaceId: "ws_1",
      roomId: "room_1",
      type: "diff",
      title: "Two file edit",
      createdBy: "agent",
      files: [diffFile("a.txt", "a_old", "a_new"), diffFile("b.txt", "b_old", "b_new")]
    });

    service.review(artifact.id);
    const applied = service.apply(artifact.id);

    expect(applied.status).toBe("failed");
    expect(readWorkspace("a.txt")).toBe("a_old");
    expect(readWorkspace("b.txt")).toBe("b_old");
    expect(lastPayload("artifact.failed")).toMatchObject({ reason: "apply_partial", recoveryRequired: false });
    expect(service.files(artifact.id).map((file) => file.appliedState)).toEqual(["original", "original"]);
    expect(service.files(artifact.id).some((file) => file.appliedState === "new")).toBe(false);
  });

  it("marks recovery_required and persists affected applied states when rollback fails", () => {
    writeWorkspace("a.txt", "a_old");
    writeWorkspace("b.txt", "b_old");
    const service = new ArtifactService({ database: currentDb(), eventBus: currentEventBus(), fileOps: failingOps({ renamePath: "b.txt", rollbackWritePath: "a.txt" }), now: () => 50_000 });
    const artifact = service.create({ ...baseDiffInput("a.txt", "a_old", "a_new"), files: [diffFile("a.txt", "a_old", "a_new"), diffFile("b.txt", "b_old", "b_new")] });

    service.review(artifact.id);
    const applied = service.apply(artifact.id);

    expect(applied.status).toBe("failed");
    expect(lastPayload("artifact.failed")).toMatchObject({
      reason: "recovery_required",
      failedAt: "a.txt",
      rolledBack: 0,
      recoveryRequired: true,
      affectedFiles: [{ path: "a.txt", appliedState: "unknown" }, { path: "b.txt", appliedState: "original" }]
    });
    expect(service.files(artifact.id).map((file) => file.appliedState)).toEqual(["unknown", "original"]);
  });

  // ArtifactService currently only creates preview token metadata; it has no preview token validation or consumption API to expire against.
  it.skip("rejects expired preview tokens when ArtifactService exposes preview token validation", () => {});
});

function currentDb(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentEventBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function currentRoot(): string {
  expect(workspaceRoot).toBeDefined();
  return workspaceRoot as string;
}

function baseDiffInput(path: string, oldContent: string, newContent: string): Parameters<ArtifactService["create"]>[0] {
  return { workspaceId: "ws_1", roomId: "room_1", messageId: "msg_1", type: "diff", title: "Edit file", createdBy: "agent", files: [diffFile(path, oldContent, newContent)] };
}

function diffFile(path: string, oldContent: string, newContent: string): NonNullable<Parameters<ArtifactService["create"]>[0]["files"]>[number] {
  return { path, oldContent, newContent, patch: `--- ${path}\n+++ ${path}`, additions: 1, deletions: 1, fileStatus: "modified" as const, oldSha256: sha256(oldContent), newSha256: sha256(newContent) };
}

function writeWorkspace(path: string, content: string): void {
  const target = join(currentRoot(), path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function readWorkspace(path: string): string {
  return readFileSync(join(currentRoot(), path), "utf8");
}

function lastPayload(type: string): unknown {
  const row = currentDb().sqlite.prepare("SELECT payload FROM events WHERE type = ? ORDER BY seq DESC LIMIT 1").get(type) as { readonly payload: string };
  return JSON.parse(row.payload) as unknown;
}

function failOnRename(path: string): Partial<FileOps> {
  return {
    rename: (from, to) => {
      if (to.endsWith(path)) throw new Error(path);
      const content = readFileSync(from, "utf8");
      writeFileSync(to, content, "utf8");
      rmSync(from, { force: true });
    }
  };
}

function failingOps(input: { readonly renamePath: string; readonly rollbackWritePath?: string }): Partial<FileOps> {
  const renamed = new Set<string>();
  return {
    rename: (from, to) => {
      if (to.endsWith(input.renamePath)) throw new Error(input.renamePath);
      renamed.add(to);
      return defaultRename(from, to);
    },
    write: (path, content) => {
      if (input.rollbackWritePath !== undefined && renamed.has(path) && path.endsWith(input.rollbackWritePath)) throw new Error(input.rollbackWritePath);
      return writeFileSync(path, content, "utf8");
    }
  };
}

function defaultRename(from: string, to: string): void {
  const content = readFileSync(from, "utf8");
  writeFileSync(to, content, "utf8");
  rmSync(from, { force: true });
}

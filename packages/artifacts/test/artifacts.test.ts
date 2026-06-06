import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createCommandBus, EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactFS, ArtifactFSError, ArtifactService, SafeWritePolicyMatcher, createArtifactCommandHandlers, parseGitDiffFiles, sha256, type FileOps } from "../src/index.ts";

let dir: string | undefined;
let workspaceRoot: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let service: ArtifactService | undefined;
let now = 50_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agenthub-artifacts-"));
  workspaceRoot = join(dir, "workspace");
  mkdirSync(workspaceRoot, { recursive: true });
  database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database });
  service = new ArtifactService({ database, eventBus, now: () => now });
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
  now = 50_000;
});

describe("ArtifactService", () => {
  it("parses git patches into per-file artifact rows", () => {
    const files = parseGitDiffFiles([
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "diff --git a/src/removed.ts b/src/removed.ts",
      "deleted file mode 100644",
      "--- a/src/removed.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      ""
    ].join("\n"), ["src/a.ts", "src/removed.ts"]);

    expect(files).toEqual([
      expect.objectContaining({ path: "src/a.ts", fileStatus: "modified", additions: 1, deletions: 1, patch: expect.stringContaining("diff --git a/src/a.ts b/src/a.ts") }),
      expect.objectContaining({ path: "src/removed.ts", fileStatus: "deleted", additions: 0, deletions: 1, patch: expect.stringContaining("deleted file mode") })
    ]);
  });

  it("parses rename, binary, mode-only, and no-newline git patch metadata", () => {
    const files = parseGitDiffFiles([
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 92%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "index 1111111..2222222 100644",
      "--- a/src/old.ts",
      "+++ b/src/new.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "diff --git a/assets/logo.png b/assets/logo.png",
      "new file mode 100644",
      "index 0000000..3333333",
      "Binary files /dev/null and b/assets/logo.png differ",
      "diff --git a/scripts/run.sh b/scripts/run.sh",
      "old mode 100644",
      "new mode 100755",
      ""
    ].join("\n"), ["src/new.ts", "assets/logo.png", "scripts/run.sh"]);

    expect(files).toEqual([
      expect.objectContaining({ path: "src/new.ts", fileStatus: "renamed", oldPath: "src/old.ts", additions: 1, deletions: 1, binary: false, noNewlineAtEnd: true }),
      expect.objectContaining({ path: "assets/logo.png", fileStatus: "added", additions: 0, deletions: 0, binary: true }),
      expect.objectContaining({ path: "scripts/run.sh", fileStatus: "mode_changed", additions: 0, deletions: 0, binary: false })
    ]);
  });

  it("creates and reads diff/file/document artifacts and files", () => {
    const diff = currentService().create(baseDiffInput("src/a.ts", "old", "new"));
    const file = currentService().create({ workspaceId: "ws_1", roomId: "room_1", type: "file", title: "chart", createdBy: "agent", files: [{ path: ".agenthub/attachments/chart.png", newContent: "png", additions: 1, deletions: 0, fileStatus: "added", contentPath: ".agenthub/attachments/chart.png" }] });
    const document = currentService().create({ workspaceId: "ws_1", roomId: "room_1", type: "document", title: "notes", createdBy: "agent", metadata: { markdown: "# Notes" } });

    expect(currentService().get(diff.id)).toMatchObject({ type: "diff", status: "draft", messageId: "msg_1" });
    expect(currentService().files(diff.id)).toHaveLength(1);
    expect(currentService().fileContent(file.id, ".agenthub/attachments/chart.png")?.content).toBe("png");
    expect(currentService().get(document.id)?.metadata).toEqual({ markdown: "# Notes" });
    expect(artifactEvents()).toEqual(["artifact.diff.created", "artifact.file.created"]);
  });

  it("moves draft to reviewing and rejects without writing disk", () => {
    writeWorkspace("src/a.ts", "old");
    const diff = currentService().create(baseDiffInput("src/a.ts", "old", "new"));
    const reviewing = currentService().review(diff.id);
    const rejected = currentService().reject(diff.id, "not wanted");

    expect(reviewing.status).toBe("reviewing");
    expect(rejected.status).toBe("rejected");
    expect(readWorkspace("src/a.ts")).toBe("old");
    expect(artifactEvents()).toEqual(["artifact.diff.created", "artifact.reviewing", "artifact.rejected"]);
    expect(currentService().reviews(diff.id)).toEqual([
      expect.objectContaining({ artifactId: diff.id, decision: "reviewing", reviewerKind: "system", reviewerId: "system" }),
      expect.objectContaining({ artifactId: diff.id, decision: "rejected", reason: "not wanted", reviewerKind: "system", reviewerId: "system" })
    ]);
  });

  it("records line-level artifact review comments as durable audit events", () => {
    const diff = currentService().create(baseDiffInput("src/a.ts", "old", "new"));

    const review = currentService().addReview({
      artifactId: diff.id,
      decision: "comment",
      reviewerKind: "user",
      reviewerId: "local",
      reason: "Please keep this helper private.",
      filePath: "src/a.ts",
      lineNumber: 12
    });

    expect(review).toMatchObject({
      artifactId: diff.id,
      decision: "comment",
      reviewerKind: "user",
      reviewerId: "local",
      reason: "Please keep this helper private.",
      filePath: "src/a.ts",
      lineNumber: 12
    });
    expect(currentService().reviews(diff.id)).toEqual([
      expect.objectContaining({ id: review.id, decision: "comment", filePath: "src/a.ts", lineNumber: 12 })
    ]);
    expect(artifactEvents()).toEqual(["artifact.diff.created", "artifact.review.added"]);
    expect(lastPayload("artifact.review.added")).toMatchObject({
      artifactId: diff.id,
      reviewId: review.id,
      decision: "comment",
      filePath: "src/a.ts",
      lineNumber: 12
    });
  });

  it("updates, resolves, and soft-deletes artifact review comments with durable events", () => {
    const diff = currentService().create(baseDiffInput("src/a.ts", "old", "new"));
    const review = currentService().addReview({
      artifactId: diff.id,
      decision: "comment",
      reviewerKind: "user",
      reviewerId: "local",
      reason: "Initial note",
      filePath: "src/a.ts",
      lineNumber: 2,
      side: "new",
      lineStart: 2,
      lineEnd: 3
    });

    now += 1;
    const updated = currentService().updateReview(diff.id, review.id, { reason: "Updated note", lineNumber: 4, side: "old" });
    now += 1;
    const resolved = currentService().resolveReview(diff.id, review.id);
    now += 1;
    const deleted = currentService().deleteReview(diff.id, review.id);

    expect(updated).toMatchObject({ reason: "Updated note", lineNumber: 4, side: "old", status: "open", updatedAt: 50_001 });
    expect(resolved).toMatchObject({ status: "resolved", resolvedAt: 50_002 });
    expect(deleted).toMatchObject({ status: "deleted", deletedAt: 50_003 });
    expect(currentService().reviews(diff.id)).toEqual([]);
    expect(currentService().reviews(diff.id, { includeDeleted: true })).toEqual([
      expect.objectContaining({ id: review.id, reason: "Updated note", status: "deleted", deletedAt: 50_003 })
    ]);
    expect(artifactEvents()).toEqual(["artifact.diff.created", "artifact.review.added", "artifact.review.updated", "artifact.review.resolved", "artifact.review.deleted"]);
    expect(lastPayload("artifact.review.updated")).toMatchObject({ artifactId: diff.id, reviewId: review.id, reason: "Updated note", side: "old" });
    expect(lastPayload("artifact.review.deleted")).toMatchObject({ artifactId: diff.id, reviewId: review.id });
  });

  it("archives and soft-deletes artifacts without returning deleted rows in normal lists", () => {
    const diff = currentService().create(baseDiffInput("src/a.ts", "old", "new"));

    now += 1;
    const archived = currentService().archive(diff.id);
    now += 1;
    const deleted = currentService().delete(diff.id);

    expect(archived).toMatchObject({ id: diff.id, archivedAt: 50_001 });
    expect(deleted).toMatchObject({ id: diff.id, deletedAt: 50_002 });
    expect(currentService().list({ roomId: "room_1" })).toEqual([]);
    expect(currentService().list({ roomId: "room_1", includeDeleted: true })).toEqual([expect.objectContaining({ id: diff.id, deletedAt: 50_002 })]);
    expect(artifactEvents()).toEqual(["artifact.diff.created", "artifact.archived", "artifact.deleted"]);
  });

  it("applies multiple files after prevalidation in sorted path order", () => {
    writeWorkspace("b.txt", "b_old");
    writeWorkspace("a.txt", "a_old");
    const diff = currentService().create({ ...baseDiffInput("b.txt", "b_old", "b_new"), files: [diffFile("b.txt", "b_old", "b_new"), diffFile("a.txt", "a_old", "a_new")] });
    currentService().review(diff.id);
    now += 1;
    const applied = currentService().apply(diff.id);

    expect(applied).toMatchObject({ status: "applied", appliedAt: now });
    expect(readWorkspace("a.txt")).toBe("a_new");
    expect(readWorkspace("b.txt")).toBe("b_new");
    expect(currentService().files(diff.id).map((file) => file.appliedState)).toEqual(["new", "new"]);
    expect(artifactEvents()).toEqual(["artifact.diff.created", "artifact.reviewing", "artifact.accepted", "artifact.applying", "artifact.applied"]);
  });

  it("fails stale_base before any disk writes", () => {
    writeWorkspace("a.txt", "external");
    const diff = currentService().create(baseDiffInput("a.txt", "old", "new"));
    currentService().review(diff.id);
    const failed = currentService().apply(diff.id);

    expect(failed.status).toBe("failed");
    expect(readWorkspace("a.txt")).toBe("external");
    expect(lastPayload("artifact.failed")).toMatchObject({ reason: "stale_base", path: "a.txt", recoveryRequired: false });
    expect(artifactEvents()).toEqual(["artifact.diff.created", "artifact.reviewing", "artifact.accepted", "artifact.failed"]);
  });

  it("fails permission denied before any disk writes", () => {
    writeWorkspace("a.txt", "old");
    const denied = new ArtifactService({ database: currentDb(), eventBus: currentEventBus(), now: () => now, permissionCheck: () => ({ ok: false, path: "a.txt", reason: "simulated deny" }) });
    const diff = denied.create(baseDiffInput("a.txt", "old", "new"));
    denied.review(diff.id);

    expect(denied.apply(diff.id).status).toBe("failed");
    expect(readWorkspace("a.txt")).toBe("old");
    expect(lastPayload("artifact.failed")).toMatchObject({ reason: "permission_denied", path: "a.txt", recoveryRequired: false });
  });

  it("rolls back partial rename failure and marks original states", () => {
    writeWorkspace("a.txt", "a_old");
    writeWorkspace("b.txt", "b_old");
    const ops = failingOps({ renamePath: "b.txt" });
    const failing = new ArtifactService({ database: currentDb(), eventBus: currentEventBus(), now: () => now, fileOps: ops });
    const diff = failing.create({ ...baseDiffInput("a.txt", "a_old", "a_new"), files: [diffFile("a.txt", "a_old", "a_new"), diffFile("b.txt", "b_old", "b_new")] });
    failing.review(diff.id);

    expect(failing.apply(diff.id).status).toBe("failed");
    expect(readWorkspace("a.txt")).toBe("a_old");
    expect(readWorkspace("b.txt")).toBe("b_old");
    expect(lastPayload("artifact.failed")).toMatchObject({ reason: "apply_partial", recoveryRequired: false, rolledBack: 1 });
    expect(failing.files(diff.id).map((file) => file.appliedState)).toEqual(["original", "original"]);
  });

  it("persists recovery_required affectedFiles when rollback fails", () => {
    writeWorkspace("a.txt", "a_old");
    writeWorkspace("b.txt", "b_old");
    const ops = failingOps({ renamePath: "b.txt", rollbackWritePath: "a.txt" });
    const failing = new ArtifactService({ database: currentDb(), eventBus: currentEventBus(), now: () => now, fileOps: ops });
    const diff = failing.create({ ...baseDiffInput("a.txt", "a_old", "a_new"), files: [diffFile("a.txt", "a_old", "a_new"), diffFile("b.txt", "b_old", "b_new")] });
    failing.review(diff.id);

    expect(failing.apply(diff.id).status).toBe("failed");
    expect(lastPayload("artifact.failed")).toMatchObject({ reason: "recovery_required", recoveryRequired: true, affectedFiles: [{ path: "a.txt", appliedState: "unknown" }, { path: "b.txt", appliedState: "original" }] });
    expect(failing.files(diff.id).map((file) => file.appliedState)).toEqual(["unknown", "original"]);
  });

  it("creates a reviewing reverse diff for applied artifacts without mutating disk", () => {
    writeWorkspace("a.txt", "old");
    const diff = currentService().create(baseDiffInput("a.txt", "old", "new"));
    currentService().review(diff.id);
    currentService().apply(diff.id);

    const revert = currentService().revert(diff.id);

    expect(revert).toMatchObject({ type: "diff", status: "reviewing", title: `Revert ${diff.title}` });
    expect(currentService().files(revert.id)[0]).toMatchObject({ oldContent: "new", newContent: "old", oldSha256: sha256("new") });
    expect(readWorkspace("a.txt")).toBe("new");
  });

  it("rejects deployment creation with deterministic not_implemented CommandResult", () => {
    const bus = createCommandBus({ database: currentDb(), handlers: createArtifactCommandHandlers(currentService()) });
    const result = bus.dispatch({ type: "CreateArtifact", workspaceId: "ws_1", artifactType: "deployment", title: "Deploy", files: [] }, { actor: { type: "user", id: "u_1" }, traceId: "trace", origin: "http" });

    expect(result).toMatchObject({ ok: false, error: { code: "not_implemented", details: { error: "deployment artifact is V1+", capability: "v1-roadmap" } } });
    expect(currentDb().sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toMatchObject({ count: 0 });
  });

  it("ignores caller-supplied alternate roots and applies using persisted workspace root", () => {
    const alternateRoot = join(currentDir(), "attacker-root");
    mkdirSync(alternateRoot, { recursive: true });
    writeWorkspace("a.txt", "old");
    writeFileSync(join(alternateRoot, "a.txt"), "old", "utf8");
    const diff = currentService().create(baseDiffInput("a.txt", "old", "new"));
    currentService().review(diff.id);
    const bus = createCommandBus({ database: currentDb(), handlers: createArtifactCommandHandlers(currentService()) });

    const result = bus.dispatch({ type: "ApplyDiff", artifactId: diff.id, workspaceRoot: alternateRoot }, { actor: { type: "user", id: "u_1" }, traceId: "trace", origin: "http" });

    expect(result).toMatchObject({ ok: true, data: { status: "applied" } });
    expect(readWorkspace("a.txt")).toBe("new");
    expect(readFileSync(join(alternateRoot, "a.txt"), "utf8")).toBe("old");
  });

  it("stores preview token expiry and terminal first 200 lines metadata", () => {
    const preview = currentService().create({ workspaceId: "ws_1", roomId: "room_1", type: "preview", title: "HTML", createdBy: "agent", metadata: { previewType: "html", contentRef: "file_1" } });
    const stdout = Array.from({ length: 205 }, (_, index) => `line-${index + 1}`).join("\n");
    const terminal = currentService().create({ workspaceId: "ws_1", roomId: "room_1", type: "terminal", title: "pnpm test", createdBy: "agent", metadata: { command: "pnpm test", stdout, stderr: "err", exitCode: 0, durationMs: 10 } });

    expect(preview.metadata).toMatchObject({ tokenExpiresAt: 1_850_000, oneTime: true });
    expect(typeof preview.metadata.token).toBe("string");
    expect(String(terminal.metadata.stdoutPreview).split("\n")).toHaveLength(200);
    expect(artifactEvents()).toEqual(["artifact.preview.started"]);
  });

  it("matches SafeWritePolicy default empty and explicit globs", () => {
    expect(new SafeWritePolicyMatcher({ workspaceId: "ws_1", globs: [] }).canBypassDiff(".agenthub/cache/x.json")).toBe(false);
    const policy = new SafeWritePolicyMatcher({ workspaceId: "ws_1", globs: [".agenthub/cache/**", "tmp/*.txt"] });
    expect(policy.canBypassDiff(".agenthub/cache/x.json")).toBe(true);
    expect(policy.canBypassDiff("tmp/a.txt")).toBe(true);
    expect(policy.canBypassDiff("src/a.ts")).toBe(false);
  });

  it("routes non-terminal writes through shadow buffer without touching real disk and builds one run-level diff", () => {
    writeWorkspace("src/a.ts", "old a");
    writeWorkspace("src/reverted.ts", "keep me");
    const artifactFs = new ArtifactFS(baseArtifactFsOptions({ mode: "shadow_buffer", runId: "run_shadow", snapshot: { "src/a.ts": "old a", "src/reverted.ts": "keep me" } }));

    artifactFs.write("src/a.ts", "new a");
    artifactFs.write("src/b.ts", "new b");
    artifactFs.write("src/reverted.ts", "temporary");
    artifactFs.write("src/reverted.ts", "keep me");
    const artifact = artifactFs.buildRunArtifact("run shadow diff");

    expect(readWorkspace("src/a.ts")).toBe("old a");
    expect(artifact).toMatchObject({ type: "diff", status: "draft", runId: "run_shadow" });
    expect(artifact ? currentService().files(artifact.id).map((file) => ({ path: file.path, status: file.fileStatus, oldContent: file.oldContent, newContent: file.newContent })) : []).toEqual([
      { path: "src/a.ts", status: "modified", oldContent: "old a", newContent: "new a" },
      { path: "src/b.ts", status: "added", oldContent: "", newContent: "new b" }
    ]);
  });

  it("requires isolated mode for terminal-enabled runs and rejects shadow_buffer", () => {
    expect(() => new ArtifactFS(baseArtifactFsOptions({ mode: "shadow_buffer", terminalEnabled: true }))).toThrowError(ArtifactFSError);
    expect(() => new ArtifactFS(baseArtifactFsOptions({ mode: "isolated_worktree", terminalEnabled: true, isolatedRoot: join(currentDir(), "worktree") }))).not.toThrow();
  });

  it("denies sensitive ArtifactFS writes before shadow or disk mutation", () => {
    const artifactFs = new ArtifactFS(baseArtifactFsOptions({ mode: "shadow_buffer", runId: "run_sensitive", eventBus: currentEventBus() }));

    expect(() => artifactFs.write(".env", "SECRET=1")).toThrowError(ArtifactFSError);
    expect(artifactFs.buildRunArtifact("no secret artifact")).toBeUndefined();
    expect(currentDb().sqlite.prepare("SELECT type, payload FROM events WHERE type = 'permission.resolved'").all()).toHaveLength(1);
    expect(lastPayload("permission.resolved")).toMatchObject({ decision: "deny", reason: "sensitive_pattern_match", requested: false, path: ".env" });
  });

  it("builds terminal run-level diff from isolated worktree with final content wins and reverted files omitted", () => {
    const isolatedRoot = join(currentDir(), "isolated-run");
    mkdirSync(join(isolatedRoot, "src"), { recursive: true });
    writeWorkspace("src/a.ts", "old a");
    writeWorkspace("src/reverted.ts", "base");
    writeFileSync(join(isolatedRoot, "src", "a.ts"), "new a", "utf8");
    writeFileSync(join(isolatedRoot, "src", "b.ts"), "final b", "utf8");
    writeFileSync(join(isolatedRoot, "src", "reverted.ts"), "base", "utf8");
    const artifactFs = new ArtifactFS(baseArtifactFsOptions({ mode: "isolated_worktree", terminalEnabled: true, runId: "run_terminal", isolatedRoot, snapshot: { "src/a.ts": "old a", "src/reverted.ts": "base" } }));

    const artifact = artifactFs.buildRunArtifact("terminal final diff");

    expect(artifact).toMatchObject({ type: "diff", status: "draft", runId: "run_terminal", metadata: { artifactFsMode: "isolated_worktree", terminalEnabled: true } });
    expect(artifact ? currentService().files(artifact.id).map((file) => ({ path: file.path, status: file.fileStatus, newContent: file.newContent })) : []).toEqual([
      { path: "src/a.ts", status: "modified", newContent: "new a" },
      { path: "src/b.ts", status: "added", newContent: "final b" }
    ]);
  });
});

function currentDb(): AgentHubDatabase { expect(database).toBeDefined(); return database as AgentHubDatabase; }
function currentEventBus(): EventBus { expect(eventBus).toBeDefined(); return eventBus as EventBus; }
function currentService(): ArtifactService { expect(service).toBeDefined(); return service as ArtifactService; }
function currentDir(): string { expect(dir).toBeDefined(); return dir as string; }
function currentRoot(): string { expect(workspaceRoot).toBeDefined(); return workspaceRoot as string; }

function baseArtifactFsOptions(overrides: Partial<ConstructorParameters<typeof ArtifactFS>[0]> = {}): ConstructorParameters<typeof ArtifactFS>[0] {
  return { runId: "run_1", workspaceId: "ws_1", roomId: "room_1", createdBy: "agent", mode: "shadow_buffer", terminalEnabled: false, workspaceRoot: currentRoot(), service: currentService(), ...overrides };
}

function baseDiffInput(path: string, oldContent: string, newContent: string): Parameters<ArtifactService["create"]>[0] {
  return { workspaceId: "ws_1", roomId: "room_1", messageId: "msg_1", type: "diff", title: "Edit file", createdBy: "agent", files: [diffFile(path, oldContent, newContent)] };
}

function diffFile(path: string, oldContent: string, newContent: string): NonNullable<Parameters<ArtifactService["create"]>[0]["files"]>[number] {
  return { path, oldContent, newContent, patch: `--- ${path}\n+++ ${path}`, additions: 1, deletions: 1, fileStatus: "modified", oldSha256: sha256(oldContent), newSha256: sha256(newContent) };
}

function writeWorkspace(path: string, content: string): void {
  const target = join(currentRoot(), path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function readWorkspace(path: string): string { return readFileSync(join(currentRoot(), path), "utf8"); }
function artifactEvents(): string[] { return currentDb().sqlite.prepare("SELECT type FROM events WHERE type LIKE 'artifact.%' ORDER BY seq ASC").all().map((row) => (row as { type: string }).type); }
function lastPayload(type: string): unknown { const row = currentDb().sqlite.prepare("SELECT payload FROM events WHERE type = ? ORDER BY seq DESC LIMIT 1").get(type) as { readonly payload: string }; return JSON.parse(row.payload) as unknown; }

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

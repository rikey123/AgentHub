import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";

import { createDatabase } from "@agenthub/db";
import { createEventBus } from "@agenthub/bus";
import { describe, expect, it } from "vitest";

import { authenticateBrowserRequest, issueBrowserSession, ManagedRunGarbageCollector, resolveSafeUri, resolveWorkspacePath, SecretRedactor } from "../src/index.ts";

describe("M6 security package", () => {
  it("enforces browser Origin/Host/session/CSRF matrix", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-security-auth-"));
    const database = createDatabase({ path: join(dir, "db.sqlite"), applyMigrations: true });
    const session = issueBrowserSession(database, 1_000);

    const headers = { origin: "http://127.0.0.1:6677", host: "127.0.0.1:6677", "content-type": "application/json", cookie: `agenthub_session=${session.sessionId}`, "x-agenthub-csrf": session.csrfToken };
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/rooms", headers, database, now: 2_000 }).ok).toBe(true);
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/rooms", headers: { ...headers, origin: "http://attacker.example.com" }, database, now: 2_000 })).toMatchObject({ ok: false, status: 403, error: "origin_or_host_mismatch" });
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/rooms", headers: { ...headers, "content-type": "text/plain" }, database, now: 2_000 })).toMatchObject({ ok: false, status: 415 });
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/rooms", headers: { ...headers, "x-agenthub-csrf": "wrong" }, database, now: 2_000 })).toMatchObject({ ok: false, status: 403, error: "csrf_token_mismatch" });
    expect(authenticateBrowserRequest({ method: "GET", pathname: "/event", headers: { origin: headers.origin, host: headers.host, cookie: headers.cookie }, database, now: 2_000 }).ok).toBe(true);
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/auth/session", headers: { origin: headers.origin, host: headers.host, "content-type": "application/json" }, database, now: 2_000 }).ok).toBe(true);
    database.sqlite.close();
  });

  it("redacts known token patterns and fails closed for non-string JSON", () => {
    const redactor = new SecretRedactor({ knownSecrets: ["literal-secret"] });
    const output = redactor.redact("Authorization: Bearer sk-ant-12345678901234567890 and AGENTHUB_TOKEN=literal-secret");
    expect(output).not.toContain("sk-ant-12345678901234567890");
    expect(output).not.toContain("literal-secret");
    expect(redactor.redact({ token: "ghp_123456789012345678901234567890123456" })).toContain("«REDACTED:github-token»");
  });

  it("classifies traversal, symlink escape, file URI, and data URI constraints", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-security-path-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "ok.txt"), "ok");
    let symlinkCreated = false;
    try { symlinkSync(tmpdir(), join(root, "escape"), "dir"); symlinkCreated = true; } catch { symlinkCreated = false; }

    expect(resolveWorkspacePath(root, "src/../src/ok.txt")).toMatchObject({ ok: true, classification: "internal", relativePath: "src/ok.txt" });
    expect(resolveWorkspacePath(root, "../../outside.txt")).toMatchObject({ ok: true, classification: "external" });
    if (symlinkCreated) expect(resolveWorkspacePath(root, "escape/secret.txt")).toMatchObject({ ok: true, classification: "external" });
    expect(resolveSafeUri(`file://${join(root, "src", "ok.txt").replaceAll("\\", "/")}`, { workspaceRoot: root })).toMatchObject({ ok: true, kind: "file" });
    expect(resolveSafeUri("data:text/html;base64,PGgxPm5vPC9oMT4=", { workspaceRoot: root })).toMatchObject({ ok: false, reason: "data_uri_mime_rejected" });
  });

  it("GC only removes managed terminal runs and skips unsafe candidates", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-security-gc-"));
    const database = createDatabase({ path: join(dir, "db.sqlite"), applyMigrations: true });
    const eventBus = createEventBus({ database });
    const root = join(dir, ".agenthub");
    const oldRunId = "01HX00000000000000000000AA";
    const activeRunId = "01HX00000000000000000000AB";
    mkdirSync(resolve(root, "worktrees", oldRunId), { recursive: true });
    mkdirSync(resolve(root, "runs", activeRunId), { recursive: true });
    database.sqlite.prepare("INSERT INTO runs (id, workspace_id, room_id, agent_id, status, target_files, created_at, updated_at, ended_at) VALUES (?, 'default-workspace', 'room', 'agent', ?, '[]', 1, 1, ?)").run(oldRunId, "completed", 1);
    database.sqlite.prepare("INSERT INTO runs (id, workspace_id, room_id, agent_id, status, target_files, created_at, updated_at, ended_at) VALUES (?, 'default-workspace', 'room', 'agent', ?, '[]', 1, 1, ?)").run(activeRunId, "running", 1);
    const result = new ManagedRunGarbageCollector({ database, eventBus, agenthubRoot: root, now: () => 10 * 86_400_000, execGit: () => ({ ok: false }) }).collect();
    expect(result.removed).toEqual([oldRunId]);
    expect(result.skipped).toEqual([{ runId: activeRunId, reason: "run_not_terminal" }]);
    expect(database.sqlite.prepare("SELECT type FROM events WHERE type = 'worktree.gc.removed'").get()).toMatchObject({ type: "worktree.gc.removed" });
    database.sqlite.close();
  });
});

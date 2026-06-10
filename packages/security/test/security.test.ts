import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtempSync } from "node:fs";

import { createDatabase } from "@agenthub/db";
import { createEventBus } from "@agenthub/bus";
import { describe, expect, it } from "vitest";

import { attachmentMaxBytes, authenticateBrowserRequest, issueBrowserSession, ManagedRunGarbageCollector, orphanAttachmentMessageId, resolveSafeUri, resolveWorkspacePath, revokeAuthToken, SecretRedactor, storeAttachment } from "../src/index.ts";

let dir: string | undefined;
let database = createDatabase({ path: join(mkdtempSync(join(tmpdir(), "agenthub-security-db-")), "db.sqlite"), applyMigrations: true });

describe("M6 security package", () => {
  it("persists an audit event when issuing a browser session", () => {
    const eventBus = createEventBus({ database });
    issueBrowserSession(database, 1_000, eventBus);
    const row = database.sqlite.prepare("SELECT type, payload FROM events WHERE type = 'auth.token.issued' ORDER BY seq DESC LIMIT 1").get() as { readonly type: string; readonly payload: string } | undefined;
    expect(row?.type).toBe("auth.token.issued");
    expect(JSON.parse(row?.payload ?? "{}") as { audit?: boolean; action?: string; outcome?: string }).toMatchObject({ audit: true, action: "issue", outcome: "issued" });
    eventBus.close();
  });

  it("persists an audit event when revoking a token", () => {
    const eventBus = createEventBus({ database });
    database.sqlite.prepare("INSERT INTO auth_tokens (id, fingerprint, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)").run("token_1", "fp_1", "hash_1", JSON.stringify(["read"]), 1_000);
    expect(revokeAuthToken(database, "token_1", eventBus, { type: "user", id: "local" }, 2_000)).toBe(true);
    const row = database.sqlite.prepare("SELECT type, payload FROM events WHERE type = 'auth.token.revoked' ORDER BY seq DESC LIMIT 1").get() as { readonly type: string; readonly payload: string } | undefined;
    expect(row?.type).toBe("auth.token.revoked");
    expect(JSON.parse(row?.payload ?? "{}") as { audit?: boolean; action?: string; outcome?: string }).toMatchObject({ audit: true, action: "revoke", outcome: "revoked" });
    eventBus.close();
  });

  it("enforces browser Origin/Host/session/CSRF matrix", () => {
    dir = mkdtempSync(join(tmpdir(), "agenthub-security-auth-"));
    database = createDatabase({ path: join(dir, "db.sqlite"), applyMigrations: true });
    const session = issueBrowserSession(database, 1_000);

    const headers = { origin: "http://127.0.0.1:6677", host: "127.0.0.1:6677", "content-type": "application/json", cookie: `agenthub_session=${session.sessionId}`, "x-agenthub-csrf": session.csrfToken };
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/rooms", headers, database, now: 2_000 }).ok).toBe(true);
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/attachments", headers: { ...headers, "content-type": "multipart/form-data; boundary=test" }, database, now: 2_000 }).ok).toBe(true);
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/attachments", headers: { ...headers, "content-type": "multipart/form-data; boundary=test", "x-agenthub-csrf": "wrong" }, database, now: 2_000 })).toMatchObject({ ok: false, status: 403, error: "csrf_token_mismatch" });
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/rooms", headers: { ...headers, origin: "http://attacker.example.com" }, database, now: 2_000 })).toMatchObject({ ok: false, status: 403, error: "origin_or_host_mismatch" });
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/rooms", headers: { ...headers, "content-type": "text/plain" }, database, now: 2_000 })).toMatchObject({ ok: false, status: 415 });
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/rooms", headers: { ...headers, "x-agenthub-csrf": "wrong" }, database, now: 2_000 })).toMatchObject({ ok: false, status: 403, error: "csrf_token_mismatch" });
    expect(authenticateBrowserRequest({ method: "GET", pathname: "/event", headers: { origin: headers.origin, host: headers.host, cookie: headers.cookie }, database, now: 2_000 }).ok).toBe(true);
    expect(authenticateBrowserRequest({ method: "POST", pathname: "/auth/session", headers: { origin: headers.origin, host: headers.host, "content-type": "application/json" }, database, now: 2_000 }).ok).toBe(true);
    expect(authenticateBrowserRequest({ method: "GET", pathname: "/event", headers: { host: headers.host }, database, now: 2_000 })).toMatchObject({ ok: true, scopes: ["read", "write"], authKind: "local" });
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
    const outside = mkdtempSync(join(tmpdir(), "agenthub-security-outside-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "ok.txt"), "ok");
    writeFileSync(join(outside, "secret.txt"), "secret");
    let symlinkCreated = false;
    try { symlinkSync(outside, join(root, "escape"), "dir"); symlinkCreated = true; } catch { symlinkCreated = false; }

    expect(resolveWorkspacePath(root, "src/../src/ok.txt")).toMatchObject({ ok: true, classification: "internal", relativePath: "src/ok.txt" });
    expect(resolveWorkspacePath(root, "../../outside.txt")).toMatchObject({ ok: true, classification: "external" });
    const absoluteOutside = process.platform === "win32"
      ? `${root[0]?.toUpperCase() === "C" ? "D" : "C"}:\\agenthub-security-outside.txt`
      : "/agenthub-security-outside.txt";
    expect(resolveWorkspacePath(root, absoluteOutside)).toMatchObject({ ok: true, classification: "external" });
    if (symlinkCreated) expect(resolveWorkspacePath(root, "escape/secret.txt")).toMatchObject({ ok: true, classification: "external" });
    expect(resolveSafeUri(`file://${join(root, "src", "ok.txt").replaceAll("\\", "/")}`, { workspaceRoot: root })).toMatchObject({ ok: true, kind: "file" });
    expect(resolveSafeUri(pathToFileURL(absoluteOutside).toString(), { workspaceRoot: root })).toMatchObject({ ok: false, reason: "path_classification_external" });
    expect(resolveSafeUri("data:text/html;base64,PGgxPm5vPC9oMT4=", { workspaceRoot: root })).toMatchObject({ ok: false, reason: "data_uri_mime_rejected" });
  });

  it("stores valid PDF attachments with UUID paths and orphan sentinel rows", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-security-attachment-pdf-"));
    const database = createDatabase({ path: join(root, "db.sqlite"), applyMigrations: true });
    const bytes = Buffer.from("%PDF-1.7\nbody");

    const result = storeAttachment({ database, workspaceRoot: root, originalName: "../report.pdf", mimeType: "application/pdf", bytes, now: Date.UTC(2026, 4, 24), fileId: "123e4567-e89b-12d3-a456-426614174000" });

    expect(result).toMatchObject({ ok: true, fileId: "123e4567-e89b-12d3-a456-426614174000", originalName: "../report.pdf", sizeBytes: bytes.byteLength });
    const row = database.sqlite.prepare("SELECT message_id, file_id, file_name, mime_type, byte_size, storage_path FROM attachments WHERE file_id = ?").get("123e4567-e89b-12d3-a456-426614174000") as { readonly message_id: string; readonly file_id: string; readonly file_name: string; readonly mime_type: string; readonly byte_size: number; readonly storage_path: string };
    expect(row).toMatchObject({ message_id: orphanAttachmentMessageId, file_name: "../report.pdf", mime_type: "application/pdf", byte_size: bytes.byteLength, storage_path: ".agenthub/attachments/2026/05/123e4567-e89b-12d3-a456-426614174000" });
    expect(existsSync(join(root, row.storage_path))).toBe(true);
    database.sqlite.close();
  });

  it("stores common Office document MIME types when ZIP magic matches", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-security-attachment-office-"));
    const database = createDatabase({ path: join(root, "db.sqlite"), applyMigrations: true });
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    const result = storeAttachment({ database, workspaceRoot: root, originalName: "brief.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes, now: 1, fileId: "123e4567-e89b-12d3-a456-426614174004" });

    expect(result).toMatchObject({ ok: true, fileId: "123e4567-e89b-12d3-a456-426614174004" });
    expect(database.sqlite.prepare("SELECT mime_type FROM attachments WHERE file_id = ?").get("123e4567-e89b-12d3-a456-426614174004")).toMatchObject({ mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    database.sqlite.close();
  });

  it("infers common attachment MIME types from filenames when the browser omits MIME", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-security-attachment-infer-"));
    const database = createDatabase({ path: join(root, "db.sqlite"), applyMigrations: true });
    const bytes = Buffer.from("%PDF-1.7\nbody");

    const result = storeAttachment({ database, workspaceRoot: root, originalName: "report.pdf", mimeType: "", bytes, now: 1, fileId: "123e4567-e89b-12d3-a456-426614174005" });

    expect(result).toMatchObject({ ok: true, fileId: "123e4567-e89b-12d3-a456-426614174005" });
    expect(database.sqlite.prepare("SELECT mime_type FROM attachments WHERE file_id = ?").get("123e4567-e89b-12d3-a456-426614174005")).toMatchObject({ mime_type: "application/pdf" });
    database.sqlite.close();
  });

  it("rejects executable magic bytes even when MIME claims octet-stream", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-security-attachment-exe-"));
    const database = createDatabase({ path: join(root, "db.sqlite"), applyMigrations: true });
    const result = storeAttachment({ database, workspaceRoot: root, originalName: "malware.bin", mimeType: "application/octet-stream", bytes: Buffer.from("#!/bin/sh\necho bad"), now: 1, fileId: "123e4567-e89b-12d3-a456-426614174001" });

    expect(result).toMatchObject({ ok: false, status: 415, error: "attachment_mime_not_allowed", mime: "application/octet-stream" });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attachments").get()).toMatchObject({ count: 0 });
    database.sqlite.close();
  });

  it("sanitizes SVG before storing and hashing", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-security-attachment-svg-"));
    const database = createDatabase({ path: join(root, "db.sqlite"), applyMigrations: true });
    const result = storeAttachment({ database, workspaceRoot: root, originalName: "diagram.svg", mimeType: "image/svg+xml", bytes: Buffer.from("<svg onclick=\"evil()\"><script>alert(1)</script><rect /></svg>"), now: Date.UTC(2026, 4, 24), fileId: "123e4567-e89b-12d3-a456-426614174002" });

    expect(result).toMatchObject({ ok: true });
    const stored = readFileSync(join(root, ".agenthub/attachments/2026/05/123e4567-e89b-12d3-a456-426614174002"), "utf8");
    expect(stored).toBe("<svg><rect /></svg>");
    database.sqlite.close();
  });

  it("rejects oversized attachments before writing", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-security-attachment-large-"));
    const database = createDatabase({ path: join(root, "db.sqlite"), applyMigrations: true });
    const result = storeAttachment({ database, workspaceRoot: root, originalName: "large.txt", mimeType: "text/plain", bytes: Buffer.alloc(attachmentMaxBytes + 1), now: 1, fileId: "123e4567-e89b-12d3-a456-426614174003" });

    expect(result).toEqual({ ok: false, status: 413, error: "attachment_too_large", maxBytes: attachmentMaxBytes });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attachments").get()).toMatchObject({ count: 0 });
    database.sqlite.close();
  });

  it("prevents path traversal by rejecting non-UUID file ids", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-security-attachment-path-"));
    const database = createDatabase({ path: join(root, "db.sqlite"), applyMigrations: true });
    const result = storeAttachment({ database, workspaceRoot: root, originalName: "ok.txt", mimeType: "text/plain", bytes: Buffer.from("hello"), now: 1, fileId: "../../escape" });

    expect(result).toEqual({ ok: false, status: 400, error: "attachment_path_invalid" });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attachments").get()).toMatchObject({ count: 0 });
    database.sqlite.close();
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
    expect(result.attachments).toEqual({ removed: [], skipped: [] });
    expect(database.sqlite.prepare("SELECT type FROM events WHERE type = 'worktree.gc.removed'").get()).toMatchObject({ type: "worktree.gc.removed" });
    database.sqlite.close();
  });

  it("GC removes expired orphan and soft-deleted message attachments", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-security-attachment-gc-"));
    const database = createDatabase({ path: join(dir, "db.sqlite"), applyMigrations: true });
    const eventBus = createEventBus({ database });
    const root = join(dir, ".agenthub");
    mkdirSync(join(root, "attachments", "2026", "05"), { recursive: true });
    writeFileSync(join(root, "attachments", "2026", "05", "orphan-file"), "orphan");
    writeFileSync(join(root, "attachments", "2026", "05", "deleted-file"), "deleted");
    database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, primary_agent_id, created_at, updated_at) VALUES ('room', 'default-workspace', 'Room', 'solo', 'agent', 1, 1)").run();
    database.sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, role, status, turn_dispatch_mode, created_at, updated_at, deleted_at) VALUES ('message_deleted', 'default-workspace', 'room', 'user', 'user', 'completed', 'immediate', 1, 1, ?)").run(1);
    database.sqlite.prepare("INSERT INTO attachments (id, message_id, file_id, file_name, mime_type, byte_size, sha256, storage_path, created_at) VALUES ('att_orphan', ?, 'orphan-file', 'orphan.txt', 'text/plain', 6, 'hash', '.agenthub/attachments/2026/05/orphan-file', 1), ('att_deleted', 'message_deleted', 'deleted-file', 'deleted.txt', 'text/plain', 7, 'hash', '.agenthub/attachments/2026/05/deleted-file', 1)").run(orphanAttachmentMessageId);

    const result = new ManagedRunGarbageCollector({ database, eventBus, agenthubRoot: root, workspaceRoot: dir, now: () => 31 * 86_400_000, execGit: () => ({ ok: false }) }).collect();

    expect(result.attachments.removed).toEqual(["orphan-file", "deleted-file"]);
    expect(existsSync(join(root, "attachments", "2026", "05", "orphan-file"))).toBe(false);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attachments").get()).toMatchObject({ count: 0 });
    eventBus.close();
    database.sqlite.close();
  });
});

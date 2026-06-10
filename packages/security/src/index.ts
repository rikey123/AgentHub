import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export { wrapExternalContent } from "./external-content.ts";
export type { KeychainBridge } from "./keychain.ts";
export { createKeychain, createKeychainAccount } from "./keychain.ts";

export type AuthScope = "read" | "write" | "admin";
export type WorkspacePathClassification = "internal" | "external" | "sensitive";
export type WorkspacePathResult = { readonly ok: true; readonly abs: string; readonly relativePath: string; readonly classification: WorkspacePathClassification } | { readonly ok: false; readonly reason: string };
export type SafeUriResult = { readonly ok: true; readonly kind: "file"; readonly abs: string; readonly relativePath: string; readonly mime?: never; readonly bytes?: never; readonly text?: never } | { readonly ok: true; readonly kind: "data"; readonly mime: string; readonly bytes: number; readonly text: string; readonly abs?: never; readonly relativePath?: never } | { readonly ok: false; readonly reason: string };
export type BrowserAuthResult = { readonly ok: true; readonly scopes: readonly AuthScope[]; readonly authKind: "session" | "bearer" | "local" } | { readonly ok: false; readonly status: 401 | 403 | 415; readonly error: string };
export type BrowserAuthInput = { readonly method: string; readonly pathname: string; readonly headers: Readonly<Record<string, string | undefined>>; readonly now?: number; readonly token?: string; readonly host?: string; readonly allowedOrigins?: readonly string[]; readonly database: AgentHubDatabase };
export type AuditActor = { readonly type: string; readonly id: string };
export type AttachmentUploadInput = { readonly database: AgentHubDatabase; readonly workspaceRoot: string; readonly originalName: string; readonly mimeType: string | undefined; readonly bytes: Buffer; readonly now?: number; readonly fileId?: string };
export type AttachmentUploadResult = { readonly ok: true; readonly fileId: string; readonly originalName: string; readonly sizeBytes: number; readonly sha256: string } | { readonly ok: false; readonly status: 413; readonly error: "attachment_too_large"; readonly maxBytes: number } | { readonly ok: false; readonly status: 415; readonly error: "attachment_mime_not_allowed"; readonly mime: string } | { readonly ok: false; readonly status: 400; readonly error: "attachment_path_invalid" | "attachment_svg_invalid" };
export type AttachmentGcResult = { readonly removed: readonly string[]; readonly skipped: readonly { readonly fileId: string; readonly reason: string }[] };

const defaultSensitiveGlobs = [".env", ".env.*", "*.pem", "*.key", "id_rsa", "id_ed25519", ".aws/**", ".gcp/**", ".ssh/**", ".netrc", "**/credentials.json", "**/service-account*.json"];
const allowedDataMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "text/plain", "text/markdown", "text/csv", "application/json"]);
const oneMb = 1024 * 1024;
export const attachmentMaxBytes = 50 * 1024 * 1024;
export const orphanAttachmentMessageId = "__agenthub_orphan_attachment__";
const blockedAttachmentMimes = new Set(["text/html", "application/javascript", "application/x-javascript", "text/javascript", "application/x-sh", "application/x-executable"]);
const zipContainerAttachmentMimes = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation"
]);
const oleAttachmentMimes = new Set(["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"]);

export class SecretRedactor {
  private readonly patterns: readonly { readonly name: string; readonly regex: RegExp; readonly replacement?: (match: string, ...groups: string[]) => string }[];
  private readonly knownSecrets: readonly string[];
  private readonly cache = new Map<string, string>();

  constructor(options: { readonly extraPatterns?: readonly { readonly name: string; readonly regex: string | RegExp }[]; readonly knownSecrets?: readonly string[] } = {}) {
    this.patterns = [
      { name: "bearer-token", regex: /\b(?:Bearer|Token)\s+([A-Za-z0-9._+/=-]{20,})\b/giu, replacement: (match) => `${match.split(/\s+/u)[0]} «REDACTED:bearer-token»` },
      { name: "anthropic-key", regex: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/gu },
      { name: "openai-key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu },
      { name: "github-token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/gu },
      { name: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/gu },
      { name: "generic-jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu },
      { name: "agenthub-token", regex: /\bAGENTHUB_TOKEN[=:]\s*([^\s]+)/giu, replacement: () => "AGENTHUB_TOKEN=«REDACTED:agenthub-token»" },
      { name: "env-secret-line", regex: /^([A-Z_][A-Z0-9_]*?(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD))=(.+)$/gmu, replacement: (_match, key) => `${key}=«REDACTED:env-secret-line»` },
      { name: "url-userinfo", regex: /\b([a-zA-Z][\w+.-]*:\/\/[^\s:]+):([^\s@]+)@/gu, replacement: (_match, prefix) => `${prefix}:«REDACTED:url-userinfo»@` },
      ...(options.extraPatterns ?? []).map((pattern) => ({ name: pattern.name, regex: typeof pattern.regex === "string" ? new RegExp(pattern.regex, "gu") : pattern.regex }))
    ];
    this.knownSecrets = [...new Set((options.knownSecrets ?? []).filter((secret) => secret.length >= 6))];
  }

  redact(value: unknown): string {
    if (typeof value !== "string") return this.redactJson(value);
    const cached = this.cache.get(value);
    if (cached !== undefined) return cached;
    let output = value;
    try {
      for (const secret of this.knownSecrets) output = output.split(secret).join("«REDACTED:known-secret»");
      for (const pattern of this.patterns) output = output.replace(pattern.regex, pattern.replacement ?? (() => `«REDACTED:${pattern.name}»`));
      this.cache.set(value, output);
      if (this.cache.size > 1024) this.cache.delete(this.cache.keys().next().value as string);
      return output;
    } catch {
      return `«REDACTOR_ERROR: line dropped, len=${value.length}»`;
    }
  }

  redactJson(value: unknown): string {
    try { return this.redact(JSON.stringify(value)); } catch { return "«REDACTOR_ERROR»"; }
  }
}

export const defaultSecretRedactor = new SecretRedactor();

export function publishAuditEvent(
  eventBus: EventBus,
  input: {
    readonly type: string;
    readonly workspaceId: string;
    readonly actor: AuditActor;
    readonly action: string;
    readonly target: string;
    readonly outcome: string;
    readonly createdAt?: number;
    readonly roomId?: string;
    readonly runId?: string;
    readonly agentId?: string;
    readonly traceId?: string;
    readonly causationId?: string;
    readonly correlationId?: string;
    readonly payload?: Record<string, unknown>;
  }
): void {
  eventBus.publish({
    id: randomUUID(),
    type: input.type as Parameters<EventBus["publish"]>[0]["type"],
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    payload: {
      audit: true,
      actor: input.actor,
      action: input.action,
      target: input.target,
      outcome: input.outcome,
      ...(input.payload ?? {})
    },
    createdAt: input.createdAt ?? Date.now()
  });
}

export function redactAndTruncate(line: string, max = 8 * 1024, redactor: SecretRedactor = defaultSecretRedactor): string {
  const redacted = redactor.redact(line);
  if (redacted.length <= max) return redacted;
  return `${redacted.slice(0, max)}«...truncated, original size=${redacted.length}b»`;
}

export function resolveWorkspacePath(workspaceRoot: string, requested: string, options: { readonly sensitiveGlobs?: readonly string[] } = {}): WorkspacePathResult {
  try {
    if (requested.includes("\0")) return { ok: false, reason: "nul_byte" };
    const root = realpathOrResolve(workspaceRoot);
    const candidate = resolve(root, requested);
    const real = realpathOrResolve(candidate);
    const rel = relative(root, real);
    const normalizedRel = rel === "" ? "" : rel.replaceAll("\\", "/");
    const inside = rel === "" || (!isAbsolute(rel) && !rel.startsWith("..") && !rel.split(sep).includes(".."));
    const classification: WorkspacePathClassification = !inside ? "external" : matchesAny(options.sensitiveGlobs ?? defaultSensitiveGlobs, normalizedRel) ? "sensitive" : "internal";
    return { ok: true, abs: real, relativePath: normalizedRel, classification };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function resolveSafeUri(uri: string, ctx: { readonly workspaceRoot: string; readonly attachmentRoot?: string; readonly runRoot?: string; readonly daemonOrigin?: string; readonly signedPreviewTokens?: ReadonlySet<string> }): SafeUriResult {
  if (uri.startsWith("file://")) {
    const path = fileURLToPath(uri);
    for (const root of [ctx.workspaceRoot, ctx.attachmentRoot, ctx.runRoot]) {
      if (root === undefined) continue;
      const resolved = resolveWorkspacePath(root, path);
      if (resolved.ok && resolved.classification === "internal") return { ok: true, kind: "file", abs: resolved.abs, relativePath: resolved.relativePath };
    }
    return { ok: false, reason: "path_classification_external" };
  }
  if (uri.startsWith("data:")) return parseDataUri(uri);
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const url = new URL(uri);
    if (ctx.daemonOrigin !== undefined && url.origin === ctx.daemonOrigin && ctx.signedPreviewTokens?.has(url.pathname.split("/").pop() ?? "") === true) return { ok: true, kind: "data", mime: "text/uri-list", bytes: uri.length, text: uri };
    return { ok: false, reason: "external_http_uri_not_allowed" };
  }
  return { ok: false, reason: "unsupported_uri_scheme" };
}

export function sanitizeSvg(svg: string): string {
  return svg.replace(/<\s*(script|foreignObject)\b[\s\S]*?<\s*\/\s*\1\s*>/giu, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/giu, "");
}

export function storeAttachment(input: AttachmentUploadInput): AttachmentUploadResult {
  const sizeBytes = input.bytes.byteLength;
  const mime = contentType(input.mimeType) ?? attachmentMimeForName(input.originalName) ?? "application/octet-stream";
  if (sizeBytes > attachmentMaxBytes) return { ok: false, status: 413, error: "attachment_too_large", maxBytes: attachmentMaxBytes };
  if (!attachmentMimeAllowed(mime) || !attachmentMagicAllowed(mime, input.bytes.subarray(0, 512))) return { ok: false, status: 415, error: "attachment_mime_not_allowed", mime };
  const fileId = input.fileId ?? randomUUID();
  if (!isUuid(fileId)) return { ok: false, status: 400, error: "attachment_path_invalid" };
  const now = input.now ?? Date.now();
  const date = new Date(now);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const relativeStoragePath = `.agenthub/attachments/${year}/${month}/${fileId}`;
  const resolved = resolveWorkspacePath(input.workspaceRoot, relativeStoragePath);
  if (!resolved.ok || resolved.classification !== "internal") return { ok: false, status: 400, error: "attachment_path_invalid" };
  let bytes = input.bytes;
  if (mime === "image/svg+xml") {
    try {
      bytes = Buffer.from(sanitizeSvg(input.bytes.toString("utf8")), "utf8");
    } catch {
      return { ok: false, status: 400, error: "attachment_svg_invalid" };
    }
  }
  mkdirSync(dirname(resolved.abs), { recursive: true });
  writeFileSync(resolved.abs, bytes, { flag: "wx" });
  const digest = sha256Buffer(bytes);
  input.database.sqlite.prepare("INSERT INTO attachments (id, message_id, file_id, file_name, mime_type, byte_size, sha256, storage_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), orphanAttachmentMessageId, fileId, input.originalName, mime, bytes.byteLength, digest, resolved.relativePath, now);
  return { ok: true, fileId, originalName: input.originalName, sizeBytes: bytes.byteLength, sha256: digest };
}

export function issueBrowserSession(database: AgentHubDatabase, now = Date.now(), eventBus?: EventBus): { readonly sessionId: string; readonly csrfToken: string; readonly expiresAt: number } {
  const sessionId = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const expiresAt = now + 60 * 60 * 1000;
  database.sqlite.prepare("INSERT INTO sessions (session_id, csrf_token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sessionId, sha256(csrfToken), now, expiresAt);
  if (eventBus) {
    publishAuditEvent(eventBus, {
      type: "auth.token.issued",
      workspaceId: "default-workspace",
      actor: { type: "user", id: "local" },
      action: "issue",
      target: `browser-session:${sessionId}`,
      outcome: "issued",
      createdAt: now,
      payload: { sessionId, csrfToken: "redacted" }
    });
  }
  return { sessionId, csrfToken, expiresAt };
}

export function revokeAuthToken(database: AgentHubDatabase, tokenId: string, eventBus?: EventBus, actor: AuditActor = { type: "user", id: "local" }, now = Date.now()): boolean {
  const row = database.sqlite.prepare("SELECT id, fingerprint FROM auth_tokens WHERE id = ?").get(tokenId) as { readonly id: string; readonly fingerprint: string } | undefined;
  if (!row) return false;
  const result = database.sqlite.prepare("UPDATE auth_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now, tokenId);
  if (result.changes > 0 && eventBus) {
    publishAuditEvent(eventBus, {
      type: "auth.token.revoked",
      workspaceId: "default-workspace",
      actor,
      action: "revoke",
      target: `auth-token:${row.id}`,
      outcome: "revoked",
      createdAt: now,
      payload: { tokenId: row.id, fingerprint: row.fingerprint }
    });
  }
  return result.changes > 0;
}

export function authenticateBrowserRequest(input: BrowserAuthInput): BrowserAuthResult {
  const method = input.method.toUpperCase();
  const origin = input.headers.origin;
  const authorization = input.headers.authorization;
  const bearer = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
  const hasOrigin = origin !== undefined && origin.length > 0;
  if (hasOrigin && !originAllowed(origin as string, input.allowedOrigins)) return { ok: false, status: 403, error: "origin_or_host_mismatch" };
  if (hasOrigin && !hostAllowed(input.headers.host, input.host)) return { ok: false, status: 403, error: "origin_or_host_mismatch" };
  if (bearer !== undefined) {
    if (input.token !== undefined && bearer === input.token) return { ok: true, scopes: ["admin", "read", "write"], authKind: "bearer" };
    const scopes = validateStoredBearer(input.database, bearer, input.now ?? Date.now());
    if (scopes !== undefined) return { ok: true, scopes, authKind: "bearer" };
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (!hasOrigin) return input.token === undefined ? { ok: true, scopes: ["read", "write"], authKind: "local" } : { ok: false, status: 401, error: "unauthorized" };
  if (method !== "GET" && input.pathname !== "/attachments" && contentType(input.headers["content-type"]) !== "application/json") return { ok: false, status: 415, error: "content_type_not_json" };
  if (method === "POST" && input.pathname === "/auth/session") return { ok: true, scopes: ["read"], authKind: "session" };
  const session = sessionFromCookie(input.headers.cookie);
  if (session === undefined) return { ok: false, status: 401, error: "missing_session" };
  const row = input.database.sqlite.prepare("SELECT csrf_token_hash, expires_at FROM sessions WHERE session_id = ?").get(session) as { readonly csrf_token_hash: string; readonly expires_at: number } | undefined;
  if (row === undefined || row.expires_at <= (input.now ?? Date.now())) return { ok: false, status: 401, error: "missing_session" };
  if (method === "GET") return { ok: true, scopes: ["read"], authKind: "session" };
  const csrf = input.headers["x-agenthub-csrf"];
  if (csrf === undefined || sha256(csrf) !== row.csrf_token_hash) return { ok: false, status: 403, error: "csrf_token_mismatch" };
  return { ok: true, scopes: ["read", "write"], authKind: "session" };
}

export type WorktreeGcResult = { readonly removed: readonly string[]; readonly skipped: readonly { readonly runId: string; readonly reason: string }[]; readonly attachments: AttachmentGcResult };
export class ManagedRunGarbageCollector {
  constructor(private readonly options: { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly agenthubRoot: string; readonly workspaceRoot?: string; readonly retentionDays?: number; readonly maxTotalSizeGb?: number; readonly now?: () => number; readonly execGit?: (args: readonly string[], cwd: string) => { readonly ok: boolean } }) {}
  collect(): WorktreeGcResult {
    const removed: string[] = [];
    const skipped: { runId: string; reason: string }[] = [];
    for (const rootName of ["worktrees", "runs"] as const) {
      const root = resolve(this.options.agenthubRoot, rootName);
      mkdirSync(root, { recursive: true });
      for (const entry of safeEntries(root)) {
        const runId = entry;
        const path = resolve(root, entry);
        const decision = this.decision(root, path, runId, rootName);
        if (!decision.ok) { skipped.push({ runId, reason: decision.reason }); this.publishSkipped(runId, decision.reason); continue; }
        if (rootName === "worktrees") this.removeWorktree(path);
        else rmSync(path, { recursive: true, force: true });
        removed.push(runId);
        this.publishRemoved(runId, rootName === "worktrees" ? "isolated_worktree" : "isolated_copy", decision.sizeBytes, decision.retainedDays);
      }
    }
    return { removed, skipped, attachments: this.collectAttachments() };
  }
  private collectAttachments(): AttachmentGcResult {
    const removed: string[] = [];
    const skipped: { fileId: string; reason: string }[] = [];
    const workspaceRoot = this.options.workspaceRoot ?? dirname(this.options.agenthubRoot);
    const now = this.options.now?.() ?? Date.now();
    const rows = this.options.database.sqlite.prepare("SELECT a.id, a.message_id AS messageId, a.file_id AS fileId, a.storage_path AS storagePath, a.created_at AS createdAt, m.id AS joinedMessageId, m.deleted_at AS deletedAt FROM attachments a LEFT JOIN messages m ON m.id = a.message_id").all() as { readonly id: string; readonly messageId: string; readonly fileId: string; readonly storagePath: string; readonly createdAt: number; readonly joinedMessageId: string | null; readonly deletedAt: number | null }[];
    for (const row of rows) {
      const orphan = row.messageId === orphanAttachmentMessageId || row.joinedMessageId === null;
      const expired = orphan ? now - row.createdAt >= 86_400_000 : row.deletedAt !== null && now - row.deletedAt >= 30 * 86_400_000;
      if (!expired) continue;
      const resolved = resolveWorkspacePath(workspaceRoot, row.storagePath);
      if (!resolved.ok || resolved.classification !== "internal") { skipped.push({ fileId: row.fileId, reason: "path_invalid" }); continue; }
      rmSync(resolved.abs, { force: true });
      this.options.database.sqlite.prepare("DELETE FROM attachments WHERE id = ?").run(row.id);
      removed.push(row.fileId);
      this.publishAttachmentRemoved(row.fileId, orphan ? "orphan" : "soft_deleted_message");
    }
    return { removed, skipped };
  }
  private decision(root: string, path: string, runId: string, rootName: "worktrees" | "runs"): { readonly ok: true; readonly sizeBytes: number; readonly retainedDays: number } | { readonly ok: false; readonly reason: string } {
    if (!isUlidLike(runId)) return { ok: false, reason: "invalid_run_id" };
    const realRoot = realpathOrResolve(root);
    const realPath = realpathOrResolve(path);
    if (realPath === realRoot || escapes(realRoot, realPath)) return { ok: false, reason: "outside_managed_root" };
    if (lstatSync(path).isSymbolicLink()) return { ok: false, reason: "symlink_candidate" };
    const run = this.options.database.sqlite.prepare("SELECT status, ended_at FROM runs WHERE id = ?").get(runId) as { readonly status: string; readonly ended_at: number | null } | undefined;
    if (run === undefined) return { ok: false, reason: "run_not_found" };
    if (!["completed", "failed", "cancelled"].includes(run.status)) return { ok: false, reason: "run_not_terminal" };
    const retainedDays = Math.floor(((this.options.now?.() ?? Date.now()) - (run.ended_at ?? 0)) / 86_400_000);
    if (retainedDays < (this.options.retentionDays ?? 3)) return { ok: false, reason: "retention_active" };
    const inFlight = this.options.database.sqlite.prepare("SELECT id FROM artifacts WHERE run_id = ? AND status IN ('draft','reviewing','accepted','applying') LIMIT 1").get(runId);
    if (inFlight !== undefined) return { ok: false, reason: "artifact_in_flight" };
    if (rootName === "runs" && (existsSync(resolve(path, ".git")) || existsSync(resolve(path, ".agenthub-real-workspace")))) return { ok: false, reason: "isolated_copy_safety_marker" };
    return { ok: true, sizeBytes: directorySize(path), retainedDays };
  }
  private removeWorktree(path: string): void {
    const exec = this.options.execGit ?? ((args, cwd) => ({ ok: spawnSync("git", [...args], { cwd, stdio: "ignore" }).status === 0 }));
    const result = exec(["worktree", "remove", "--force", path], dirname(path));
    if (!result.ok) rmSync(path, { recursive: true, force: true });
  }
  private publishRemoved(runId: string, mode: string, sizeBytes: number, retainedDays: number): void { this.options.eventBus.publish({ id: randomUUID(), type: "worktree.gc.removed", schemaVersion: 1, workspaceId: "default-workspace", runId, payload: { runId, mode, sizeBytes, retainedDays }, createdAt: this.options.now?.() ?? Date.now() }); }
  private publishAttachmentRemoved(fileId: string, reason: string): void { this.options.eventBus.publish({ id: randomUUID(), type: "worktree.gc.removed", schemaVersion: 1, workspaceId: "default-workspace", payload: { fileId, mode: "attachment", reason }, createdAt: this.options.now?.() ?? Date.now() }); }
  private publishSkipped(runId: string, reason: string): void { this.options.eventBus.publish({ id: randomUUID(), type: "worktree.gc.skipped", schemaVersion: 1, workspaceId: "default-workspace", runId, payload: { runId, reason }, createdAt: this.options.now?.() ?? Date.now() }); }
}

function parseDataUri(uri: string): SafeUriResult {
  const match = uri.match(/^data:([^;,]+)(;base64)?,(.*)$/su);
  if (!match) return { ok: false, reason: "invalid_data_uri" };
  const mime = match[1] as string;
  if (!allowedDataMimes.has(mime)) return { ok: false, reason: "data_uri_mime_rejected" };
  try {
    const raw = match[2] === ";base64" ? Buffer.from(match[3] ?? "", "base64") : Buffer.from(decodeURIComponent(match[3] ?? ""), "utf8");
    if (raw.byteLength > oneMb) return { ok: false, reason: "data_uri_size_exceeded" };
    const text = mime === "image/svg+xml" ? sanitizeSvg(raw.toString("utf8")) : raw.toString("utf8");
    return { ok: true, kind: "data", mime, bytes: raw.byteLength, text };
  } catch { return { ok: false, reason: "data_uri_decode_failed" }; }
}
function validateStoredBearer(database: AgentHubDatabase, token: string, now: number): readonly AuthScope[] | undefined { const row = database.sqlite.prepare("SELECT scopes, expires_at, revoked_at FROM auth_tokens WHERE hash = ?").get(sha256(token)) as { readonly scopes: string; readonly expires_at: number | null; readonly revoked_at: number | null } | undefined; if (row === undefined || row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= now)) return undefined; const scopes = JSON.parse(row.scopes) as AuthScope[]; return scopes.includes("admin") ? ["admin", "read", "write"] : scopes; }
function originAllowed(origin: string, configured?: readonly string[]): boolean { if (configured?.includes(origin) === true) return true; try { const url = new URL(origin); return (url.protocol === "tauri:" && url.hostname === "localhost") || ((url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "127.0.0.1" || url.hostname === "localhost")); } catch { return false; } }
function hostAllowed(header: string | undefined, publicHost?: string): boolean { if (header === undefined) return false; const host = header.split(":")[0]?.toLowerCase(); if (publicHost !== undefined && header === publicHost) return true; return host === "127.0.0.1" || host === "localhost"; }
function contentType(value: string | undefined): string | undefined {
  const normalized = value?.split(";")[0]?.trim().toLowerCase();
  return normalized !== undefined && normalized.length > 0 ? normalized : undefined;
}
function attachmentMimeForName(name: string): string | undefined {
  const ext = name.toLowerCase().split(/[\\/]/u).pop()?.split(".").pop();
  switch (ext) {
    case "md":
    case "markdown":
      return "text/markdown";
    case "txt":
    case "log":
    case "csv":
    case "tsv":
    case "json":
    case "xml":
    case "yaml":
    case "yml":
    case "toml":
    case "ini":
    case "conf":
      return "text/plain";
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "odt":
      return "application/vnd.oasis.opendocument.text";
    case "ods":
      return "application/vnd.oasis.opendocument.spreadsheet";
    case "odp":
      return "application/vnd.oasis.opendocument.presentation";
    case "doc":
      return "application/msword";
    case "xls":
      return "application/vnd.ms-excel";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "zip":
      return "application/zip";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    case "aac":
      return "audio/aac";
    case "opus":
      return "audio/opus";
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    case "mkv":
      return "video/x-matroska";
    case "avi":
      return "video/x-msvideo";
    default:
      return undefined;
  }
}
function attachmentMimeAllowed(mime: string): boolean { return mime.length > 0 && !blockedAttachmentMimes.has(mime) && (mime.startsWith("text/") || mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/") || mime === "application/json" || mime === "application/pdf" || mime === "application/zip" || mime === "application/octet-stream" || zipContainerAttachmentMimes.has(mime) || oleAttachmentMimes.has(mime)); }
function attachmentMagicAllowed(mime: string, header: Buffer): boolean {
  if (header.length === 0) return true;
  if (mime === "application/pdf") return header.subarray(0, 5).equals(Buffer.from("%PDF-"));
  if (mime === "application/zip" || zipContainerAttachmentMimes.has(mime)) return hasZipMagic(header);
  if (oleAttachmentMimes.has(mime)) return header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (mime === "image/png") return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/jpeg") return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (mime === "image/gif") return header.subarray(0, 6).toString("ascii") === "GIF87a" || header.subarray(0, 6).toString("ascii") === "GIF89a";
  if (mime === "image/webp") return header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP";
  if (mime === "image/svg+xml") return /^\s*<svg[\s>]/iu.test(header.toString("utf8"));
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return !hasExecutableMagic(header) && !looksLikeHtmlOrScript(header);
  if (mime.startsWith("text/") || mime === "application/json") return !hasExecutableMagic(header);
  if (mime === "application/octet-stream") return !hasExecutableMagic(header) && !looksLikeHtmlOrScript(header);
  return true;
}
function hasZipMagic(header: Buffer): boolean { return header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) || header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x07, 0x08])); }
function hasExecutableMagic(header: Buffer): boolean { return header.subarray(0, 2).equals(Buffer.from([0x4d, 0x5a])) || header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || header.subarray(0, 2).toString("ascii") === "#!"; }
function looksLikeHtmlOrScript(header: Buffer): boolean { return /^\s*<(?:!doctype\s+html|html|script)\b/iu.test(header.toString("utf8")); }
function sessionFromCookie(cookie: string | undefined): string | undefined { return cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("agenthub_session="))?.slice("agenthub_session=".length); }
function realpathOrResolve(path: string): string { return existsSync(path) ? realpathSync(path) : resolve(path); }
function escapes(root: string, path: string): boolean { const rel = relative(root, path); return rel.startsWith("..") || rel.split(sep).includes(".."); }
function matchesAny(globs: readonly string[], path: string): boolean { return globs.some((glob) => globMatch(glob, path)); }
function globMatch(glob: string, path: string): boolean { return new RegExp(`^${globToRegExp(glob.replaceAll("\\", "/"))}$`).test(path.replaceAll("\\", "/")); }
function globToRegExp(glob: string): string { let pattern = ""; for (let i = 0; i < glob.length; i += 1) { const char = glob[i]; const next = glob[i + 1]; if (char === "*" && next === "*") { pattern += ".*"; i += 1; } else if (char === "*") pattern += "[^/]*"; else pattern += (char ?? "").replace(/[.+?^${}()|[\]\\]/gu, "\\$&"); } return pattern; }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function sha256Buffer(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function isUlidLike(value: string): boolean { return /^[0-9A-HJKMNP-TV-Z]{26}$/u.test(value); }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value); }
function safeEntries(path: string): string[] { try { return existsSync(path) ? readdirSync(path) : []; } catch { return []; } }
function directorySize(path: string): number { const stat = statSync(path); if (stat.isFile()) return stat.size; if (!stat.isDirectory()) return 0; let total = 0; for (const entry of readdirSync(path)) total += directorySize(resolve(path, entry)); return total; }

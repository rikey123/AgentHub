import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, normalize, relative, resolve, sep } from "node:path";

import type { Command, CommandHandler, CommandMeta, CommandResult, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type ArtifactType = "diff" | "file" | "preview" | "document" | "terminal" | "deployment" | "worktree_diff";
export type ArtifactStatus = "draft" | "reviewing" | "accepted" | "applying" | "applied" | "rejected" | "failed" | "ready_for_review" | "conflict" | "discarded";
export type ArtifactFileStatus = "added" | "modified" | "deleted";
export type AppliedState = "original" | "new" | "unknown";
export type ArtifactEventType = "artifact.diff.created" | "artifact.file.created" | "artifact.reviewing" | "artifact.accepted" | "artifact.applying" | "artifact.applied" | "artifact.rejected" | "artifact.failed" | "artifact.preview.started" | "artifact.preview.stopped" | "worktree.diff.ready";

export type Artifact = {
  readonly id: string;
  readonly workspaceId: string;
  readonly roomId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly messageId?: string;
  readonly type: ArtifactType;
  readonly title: string;
  readonly status: ArtifactStatus;
  readonly createdBy: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly appliedAt?: number;
};

export type ArtifactFile = {
  readonly artifactId: string;
  readonly path: string;
  readonly oldContent?: string;
  readonly newContent?: string;
  readonly patch?: string;
  readonly additions: number;
  readonly deletions: number;
  readonly fileStatus: ArtifactFileStatus;
  readonly oldSha256?: string;
  readonly newSha256?: string;
  readonly appliedState?: AppliedState;
  readonly contentPath?: string;
  readonly createdAt: number;
};

export type CreateArtifactInput = {
  readonly workspaceId: string;
  readonly roomId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly messageId?: string;
  readonly type: ArtifactType;
  readonly title: string;
  readonly status?: ArtifactStatus;
  readonly createdBy: string;
  readonly metadata?: Record<string, unknown>;
  readonly files?: readonly Omit<ArtifactFile, "artifactId" | "createdAt">[];
};

export type PermissionCheck = (input: { readonly workspaceId: string; readonly roomId?: string; readonly runId?: string; readonly paths: readonly string[]; readonly reason: string }) => { readonly ok: true } | { readonly ok: false; readonly path?: string; readonly reason: string };
export type FileOps = { readonly read: (path: string) => string; readonly write: (path: string, content: string) => void; readonly rename: (from: string, to: string) => void; readonly remove: (path: string) => void; readonly exists: (path: string) => boolean; readonly mkdirp: (path: string) => void };
export type EventTrace = { readonly traceId?: string; readonly causationId?: string; readonly correlationId?: string };
export type SafeWritePolicy = { readonly workspaceId: string; readonly globs: readonly string[] };
export type ArtifactFSMode = "isolated_worktree" | "isolated_copy" | "shadow_buffer";
export type ArtifactFSSnapshot = Readonly<Record<string, string>>;
export type ArtifactFSOptions = {
  readonly runId: string;
  readonly workspaceId: string;
  readonly roomId?: string;
  readonly taskId?: string;
  readonly messageId?: string;
  readonly createdBy: string;
  readonly mode: ArtifactFSMode;
  readonly terminalEnabled?: boolean;
  readonly workspaceRoot: string;
  readonly isolatedRoot?: string;
  readonly service: ArtifactService;
  readonly eventBus?: EventBus;
  readonly sensitiveGlobs?: readonly string[];
  readonly snapshot?: ArtifactFSSnapshot;
  readonly now?: () => number;
  readonly fileOps?: Partial<FileOps>;
};
export type ArtifactFSRunRegistryBeginInput = {
  readonly runId: string;
  readonly workspaceId: string;
  readonly roomId?: string;
  readonly taskId?: string;
  readonly messageId?: string;
  readonly agentId: string;
  readonly mode?: string;
  readonly terminalEnabled?: boolean;
  readonly workDir?: string;
};

type ArtifactRow = { readonly id: string; readonly workspace_id: string; readonly room_id: string | null; readonly task_id: string | null; readonly run_id: string | null; readonly message_id: string | null; readonly type: string; readonly title: string; readonly status: string; readonly created_by: string | null; readonly metadata: string; readonly created_at: number; readonly updated_at: number; readonly applied_at: number | null };
type ArtifactFileRow = { readonly artifact_id: string; readonly path: string; readonly old_content: string | null; readonly new_content: string | null; readonly patch: string | null; readonly additions: number | null; readonly deletions: number | null; readonly file_status: string; readonly old_sha256: string | null; readonly new_sha256: string | null; readonly applied_state: string | null; readonly content_path: string | null; readonly created_at: number };

const defaultFileOps: FileOps = { read: (path) => readFileSync(path, "utf8"), write: (path, content) => writeFileSync(path, content, "utf8"), rename: (from, to) => renameSync(from, to), remove: (path) => rmSync(path, { force: true }), exists: (path) => existsSync(path), mkdirp: (path) => mkdirSync(path, { recursive: true }) };
const defaultSensitiveGlobs = [".env", ".env.*", "*.pem", "*.key", "id_rsa", "id_ed25519", ".aws/**", ".gcp/**", ".ssh/**", ".netrc", "**/credentials.json", "**/service-account*.json"] as const;

export class ArtifactService {
  private readonly now: () => number;
  private readonly fileOps: FileOps;
  private readonly permissionCheck: PermissionCheck;

  constructor(private readonly options: { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly now?: () => number; readonly fileOps?: Partial<FileOps>; readonly permissionCheck?: PermissionCheck }) {
    this.now = options.now ?? Date.now;
    this.fileOps = { ...defaultFileOps, ...(options.fileOps ?? {}) };
    this.permissionCheck = options.permissionCheck ?? (() => ({ ok: true }));
  }

  create(input: CreateArtifactInput, trace: EventTrace = {}): Artifact {
    validateCreate(input);
    if (input.type === "deployment") throw new ArtifactNotImplementedError("deployment artifact is V1+", { error: "deployment artifact is V1+", capability: "v1-roadmap" });
    const now = this.now();
    const artifact: Artifact = { id: randomUUID(), workspaceId: input.workspaceId, ...(input.roomId !== undefined ? { roomId: input.roomId } : {}), ...(input.taskId !== undefined ? { taskId: input.taskId } : {}), ...(input.runId !== undefined ? { runId: input.runId } : {}), ...(input.messageId !== undefined ? { messageId: input.messageId } : {}), type: input.type, title: input.title, status: input.status ?? "draft", createdBy: input.createdBy, metadata: metadataFor(input, now), createdAt: now, updatedAt: now };
    const files = normalizeFiles(artifact.id, input.files ?? [], now);
    this.options.database.sqlite.transaction(() => {
      this.insertArtifact(artifact);
      for (const file of files) this.insertFile(file);
      this.publishCreated(artifact, files, now, trace);
    })();
    return artifact;
  }

  get(id: string): Artifact | undefined {
    const row = this.options.database.sqlite.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
    return row ? rowToArtifact(row) : undefined;
  }

  list(filter: { readonly roomId?: string; readonly taskId?: string; readonly status?: readonly ArtifactStatus[] } = {}): Artifact[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.roomId !== undefined) { clauses.push("room_id = ?"); params.push(filter.roomId); }
    if (filter.taskId !== undefined) { clauses.push("task_id = ?"); params.push(filter.taskId); }
    if (filter.status !== undefined && filter.status.length > 0) { clauses.push(`status IN (${filter.status.map(() => "?").join(", ")})`); params.push(...filter.status); }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    return (this.options.database.sqlite.prepare(`SELECT * FROM artifacts${where} ORDER BY created_at DESC, id ASC`).all(...params) as ArtifactRow[]).map(rowToArtifact);
  }

  files(artifactId: string): ArtifactFile[] {
    return (this.options.database.sqlite.prepare("SELECT * FROM artifact_files WHERE artifact_id = ? ORDER BY path ASC").all(artifactId) as ArtifactFileRow[]).map(rowToFile);
  }

  fileContent(artifactId: string, path: string): { readonly file: ArtifactFile; readonly content: string | undefined } | undefined {
    const file = this.files(artifactId).find((item) => item.path === path);
    if (!file) return undefined;
    return { file, content: file.newContent ?? file.oldContent };
  }

  review(id: string, trace: EventTrace = {}): Artifact {
    const artifact = requiredArtifact(this.get(id), id);
    if (artifact.type !== "diff") throw new ArtifactConflictError("only diff artifacts can enter review");
    if (artifact.status !== "draft" && artifact.status !== "reviewing") throw new ArtifactConflictError(`cannot review artifact in ${artifact.status}`);
    if (artifact.status === "reviewing") return artifact;
    return this.transition(artifact, "reviewing", "artifact.reviewing", { artifactId: id, status: "reviewing" }, trace);
  }

  reject(id: string, reason: string | undefined, trace: EventTrace = {}): Artifact {
    const artifact = requiredArtifact(this.get(id), id);
    if (artifact.status !== "draft" && artifact.status !== "reviewing") throw new ArtifactConflictError(`cannot reject artifact in ${artifact.status}`);
    return this.transition(artifact, "rejected", "artifact.rejected", { artifactId: id, reason }, trace);
  }

  apply(id: string, trace: EventTrace = {}): Artifact {
    const artifact = requiredArtifact(this.get(id), id);
    if (artifact.type !== "diff") throw new ArtifactConflictError("only diff artifacts can be applied");
    if (artifact.status !== "reviewing" && artifact.status !== "accepted") throw new ArtifactConflictError(`cannot apply artifact in ${artifact.status}`);
    const workspaceRoot = this.workspaceRoot(artifact.workspaceId);
    const accepted = artifact.status === "accepted" ? artifact : this.transition(artifact, "accepted", "artifact.accepted", { artifactId: id, status: "accepted" }, trace);
    const files = this.files(id).sort((a, b) => a.path.localeCompare(b.path));
    const validation = this.prevalidate(accepted, files, workspaceRoot);
    if (!validation.ok) return this.fail(accepted, validation.payload, trace);
    const permission = this.permissionCheck({ workspaceId: accepted.workspaceId, ...(accepted.roomId !== undefined ? { roomId: accepted.roomId } : {}), ...(accepted.runId !== undefined ? { runId: accepted.runId } : {}), paths: files.map((file) => file.path), reason: "artifact_diff_apply" });
    if (!permission.ok) return this.fail(accepted, { artifactId: id, reason: "permission_denied", failedAt: permission.path, path: permission.path, recoveryRequired: false, detail: permission.reason }, trace);
    const applying = this.transition(accepted, "applying", "artifact.applying", { artifactId: id, status: "applying" }, trace);
    return this.writeBestEffort(applying, files, workspaceRoot, trace);
  }

  revert(id: string, trace: EventTrace = {}): Artifact {
    const artifact = requiredArtifact(this.get(id), id);
    if (artifact.type !== "diff" || artifact.status !== "applied") throw new ArtifactConflictError("only applied diff artifacts can be reverted");
    const reverseFiles = this.files(id).map((file) => {
      const oldContent = file.newContent ?? "";
      const newContent = file.oldContent ?? "";
      return { path: file.path, oldContent, newContent, oldSha256: sha256(oldContent), newSha256: sha256(newContent), additions: file.deletions, deletions: file.additions, fileStatus: reverseStatus(file.fileStatus), patch: reversePatch(file.path, oldContent, newContent) };
    });
    return this.create({ workspaceId: artifact.workspaceId, ...(artifact.roomId !== undefined ? { roomId: artifact.roomId } : {}), ...(artifact.taskId !== undefined ? { taskId: artifact.taskId } : {}), ...(artifact.runId !== undefined ? { runId: artifact.runId } : {}), type: "diff", title: `Revert ${artifact.title}`, status: "reviewing", createdBy: "system", metadata: { revertsArtifactId: artifact.id }, files: reverseFiles }, trace);
  }

  private prevalidate(artifact: Artifact, files: readonly ArtifactFile[], workspaceRoot: string): { readonly ok: true } | { readonly ok: false; readonly payload: Record<string, unknown> } {
    for (const file of files) {
      if (file.oldSha256 === undefined) continue;
      const target = resolveWorkspacePath(workspaceRoot, file.path);
      const content = this.fileOps.exists(target) ? this.fileOps.read(target) : "";
      if (sha256(content) !== file.oldSha256) return { ok: false, payload: { artifactId: artifact.id, reason: "stale_base", path: file.path, failedAt: file.path, recoveryRequired: false } };
    }
    return { ok: true };
  }

  private writeBestEffort(artifact: Artifact, files: readonly ArtifactFile[], workspaceRoot: string, trace: EventTrace): Artifact {
    const renamed: ArtifactFile[] = [];
    const tempPaths = new Map<string, string>();
    try {
      for (const file of files) {
        const target = resolveWorkspacePath(workspaceRoot, file.path);
        this.fileOps.mkdirp(dirname(target));
        const temp = `${target}.agenthub-tmp-${artifact.id}`;
        tempPaths.set(file.path, temp);
        this.fileOps.write(temp, file.newContent ?? "");
      }
      for (const file of files) {
        const target = resolveWorkspacePath(workspaceRoot, file.path);
        const temp = tempPaths.get(file.path) as string;
        if (file.fileStatus === "deleted") { this.fileOps.remove(target); this.fileOps.remove(temp); }
        else this.fileOps.rename(temp, target);
        renamed.push(file);
      }
      const now = this.now();
      this.options.database.sqlite.transaction(() => {
        this.options.database.sqlite.prepare("UPDATE artifacts SET status = 'applied', updated_at = ?, applied_at = ? WHERE id = ?").run(now, now, artifact.id);
        for (const file of files) this.options.database.sqlite.prepare("UPDATE artifact_files SET applied_state = 'new' WHERE artifact_id = ? AND path = ?").run(artifact.id, file.path);
        this.publish(artifact, "artifact.applied", { artifactId: artifact.id, status: "applied", files: files.map((file) => file.path) }, now, trace);
      })();
      return requiredArtifact(this.get(artifact.id), artifact.id);
    } catch (error) {
      return this.rollbackPartial(artifact, files, renamed, tempPaths, error, trace);
    }
  }

  private rollbackPartial(artifact: Artifact, files: readonly ArtifactFile[], renamed: readonly ArtifactFile[], tempPaths: ReadonlyMap<string, string>, error: unknown, trace: EventTrace): Artifact {
    for (const file of files) {
      const temp = tempPaths.get(file.path);
      if (temp !== undefined) try { this.fileOps.remove(temp); } catch { /* best effort */ }
    }
    let rolledBack = 0;
    const states = new Map(files.map((file) => [file.path, renamed.includes(file) ? "new" as AppliedState : "original" as AppliedState]));
    try {
      for (const file of [...renamed].reverse()) {
        const target = resolveWorkspacePath(this.workspaceRoot(artifact.workspaceId), file.path);
        if (file.fileStatus === "added") this.fileOps.remove(target);
        else this.fileOps.write(target, file.oldContent ?? "");
        states.set(file.path, "original");
        rolledBack += 1;
      }
      return this.fail(artifact, { artifactId: artifact.id, reason: "apply_partial", failedAt: failurePath(error), rolledBack, recoveryRequired: false }, trace, states);
    } catch (rollbackError) {
      const failedPath = failurePath(rollbackError);
      if (failedPath !== undefined) states.set(failedPath, "unknown");
      for (const file of files) if (!states.has(file.path)) states.set(file.path, "unknown");
      const affectedFiles = files.map((file) => ({ path: file.path, appliedState: states.get(file.path) ?? "unknown" }));
      return this.fail(artifact, { artifactId: artifact.id, reason: "recovery_required", failedAt: failedPath, rolledBack, recoveryRequired: true, affectedFiles }, trace, states);
    }
  }

  private fail(artifact: Artifact, payload: Record<string, unknown>, trace: EventTrace, states?: ReadonlyMap<string, AppliedState>): Artifact {
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("UPDATE artifacts SET status = 'failed', updated_at = ? WHERE id = ?").run(now, artifact.id);
      if (states) for (const [path, state] of states) this.options.database.sqlite.prepare("UPDATE artifact_files SET applied_state = ? WHERE artifact_id = ? AND path = ?").run(state, artifact.id, path);
      this.publish(artifact, "artifact.failed", payload, now, trace);
    })();
    return requiredArtifact(this.get(artifact.id), artifact.id);
  }

  private transition(artifact: Artifact, status: ArtifactStatus, eventType: ArtifactEventType, payload: Record<string, unknown>, trace: EventTrace): Artifact {
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("UPDATE artifacts SET status = ?, updated_at = ? WHERE id = ?").run(status, now, artifact.id);
      this.publish(artifact, eventType, payload, now, trace);
    })();
    return requiredArtifact(this.get(artifact.id), artifact.id);
  }

  private insertArtifact(artifact: Artifact): void {
    this.options.database.sqlite.prepare(`INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, title, status, created_by, metadata, created_at, updated_at, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(artifact.id, artifact.workspaceId, artifact.roomId ?? null, artifact.taskId ?? null, artifact.runId ?? null, artifact.messageId ?? null, artifact.type, artifact.title, artifact.status, artifact.createdBy, JSON.stringify(artifact.metadata), artifact.createdAt, artifact.updatedAt);
  }

  private insertFile(file: ArtifactFile): void {
    this.options.database.sqlite.prepare(`INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(file.artifactId, file.path, file.oldContent ?? null, file.newContent ?? null, file.patch ?? null, file.additions, file.deletions, file.fileStatus, file.oldSha256 ?? null, file.newSha256 ?? null, file.appliedState ?? null, file.contentPath ?? null, file.createdAt);
  }

  private publishCreated(artifact: Artifact, files: readonly ArtifactFile[], createdAt: number, trace: EventTrace): void {
    if (artifact.type === "diff") this.publish(artifact, "artifact.diff.created", { artifactId: artifact.id, status: artifact.status, files: files.map((file) => file.path) }, createdAt, trace);
    else if (artifact.type === "file") this.publish(artifact, "artifact.file.created", { artifactId: artifact.id, fileCount: files.length, files: files.map((file) => file.path) }, createdAt, trace);
    else if (artifact.type === "preview") this.publish(artifact, "artifact.preview.started", { artifactId: artifact.id, tokenExpiresAt: artifact.metadata.tokenExpiresAt }, createdAt, trace);
  }

  private publish(artifact: Artifact, type: ArtifactEventType, payload: Record<string, unknown>, createdAt: number, trace: EventTrace): void {
    this.options.eventBus.publish(artifactEvent(type, artifact, payload, createdAt, trace));
  }

  private workspaceRoot(workspaceId: string): string {
    const row = this.options.database.sqlite.prepare("SELECT root_path FROM workspaces WHERE id = ?").get(workspaceId) as { readonly root_path: string } | undefined;
    if (!row) throw new Error(`workspace '${workspaceId}' not found`);
    return row.root_path;
  }
}

export class SafeWritePolicyMatcher {
  constructor(private readonly policy: SafeWritePolicy) {}
  canBypassDiff(relativePath: string): boolean { return this.policy.globs.some((glob) => globMatch(glob, normalizePath(relativePath))); }
}

export class ArtifactFS {
  private readonly fileOps: FileOps;
  private readonly now: () => number;
  private readonly sensitiveGlobs: readonly string[];
  private readonly shadow = new Map<string, string>();
  private readonly deleted = new Set<string>();
  private readonly touched = new Set<string>();
  private readonly base = new Map<string, string | undefined>();

  constructor(private readonly options: ArtifactFSOptions) {
    if (options.terminalEnabled === true && options.mode === "shadow_buffer") throw new ArtifactFSError("terminal_shadow_buffer_forbidden", "terminal-enabled runs must use isolated worktree/copy mode");
    if (options.mode !== "shadow_buffer" && options.isolatedRoot === undefined) throw new ArtifactFSError("isolated_root_required", "isolated ArtifactFS modes require isolatedRoot");
    this.fileOps = { ...defaultFileOps, ...(options.fileOps ?? {}) };
    this.now = options.now ?? Date.now;
    this.sensitiveGlobs = options.sensitiveGlobs ?? defaultSensitiveGlobs;
    for (const [path, content] of Object.entries(options.snapshot ?? {})) this.base.set(normalizePath(path), content);
  }

  read(path: string): string {
    const normalized = normalizePath(path);
    if (this.deleted.has(normalized)) throw new ArtifactFSError("file_not_found", normalized);
    if (this.shadow.has(normalized)) return this.shadow.get(normalized) as string;
    const root = this.activeRoot();
    const target = resolveWorkspacePath(root, normalized);
    return this.fileOps.exists(target) ? this.fileOps.read(target) : "";
  }

  write(path: string, content: string): void {
    const normalized = this.prepareWrite(path);
    this.captureBase(normalized);
    this.touched.add(normalized);
    this.deleted.delete(normalized);
    if (this.options.mode === "shadow_buffer") {
      this.shadow.set(normalized, content);
      return;
    }
    const target = resolveWorkspacePath(this.activeRoot(), normalized);
    this.fileOps.mkdirp(dirname(target));
    this.fileOps.write(target, content);
  }

  delete(path: string): void {
    const normalized = this.prepareWrite(path);
    this.captureBase(normalized);
    this.touched.add(normalized);
    this.shadow.delete(normalized);
    this.deleted.add(normalized);
    if (this.options.mode !== "shadow_buffer") this.fileOps.remove(resolveWorkspacePath(this.activeRoot(), normalized));
  }

  list(prefix = ""): string[] {
    const normalizedPrefix = normalizePath(prefix);
    const paths = new Set<string>([...this.touched, ...this.shadow.keys(), ...this.base.keys()]);
    if (this.options.mode !== "shadow_buffer") for (const path of listFiles(this.activeRoot())) paths.add(path);
    return [...paths].filter((path) => path.startsWith(normalizedPrefix) && !this.deleted.has(path)).sort();
  }

  buildRunArtifact(title = `Run ${this.options.runId} changes`, trace: EventTrace = {}): Artifact | undefined {
    const files = this.diffFiles();
    if (files.length === 0) return undefined;
    return this.options.service.create({ workspaceId: this.options.workspaceId, ...(this.options.roomId !== undefined ? { roomId: this.options.roomId } : {}), ...(this.options.taskId !== undefined ? { taskId: this.options.taskId } : {}), runId: this.options.runId, ...(this.options.messageId !== undefined ? { messageId: this.options.messageId } : {}), type: "diff", title, status: "draft", createdBy: this.options.createdBy, metadata: { artifactFsMode: this.options.mode, terminalEnabled: this.options.terminalEnabled === true }, files }, trace);
  }

  private diffFiles(): Omit<ArtifactFile, "artifactId" | "createdAt">[] {
    const paths = new Set<string>([...this.touched, ...this.shadow.keys(), ...this.base.keys()]);
    if (this.options.mode !== "shadow_buffer") for (const path of listFiles(this.activeRoot())) paths.add(path);
    const files: Omit<ArtifactFile, "artifactId" | "createdAt">[] = [];
    for (const path of [...paths].sort()) {
      const oldContent = this.baseContent(path);
      const newContent = this.finalContent(path);
      if (oldContent === newContent) continue;
      const fileStatus: ArtifactFileStatus = oldContent === undefined ? "added" : newContent === undefined ? "deleted" : "modified";
      const oldText = oldContent ?? "";
      const newText = newContent ?? "";
      files.push({ path, oldContent: oldText, newContent: newText, patch: simplePatch(path, oldText, newText), additions: lineCount(newText), deletions: lineCount(oldText), fileStatus, oldSha256: sha256(oldText), newSha256: sha256(newText) });
    }
    return files;
  }

  private prepareWrite(path: string): string {
    const normalized = normalizePath(path);
    if (this.isSensitive(normalized)) {
      this.publishSensitiveDeny(normalized);
      throw new ArtifactFSError("sensitive_file_blocked", normalized);
    }
    return normalized;
  }

  private captureBase(path: string): void {
    if (this.base.has(path)) return;
    const target = resolveWorkspacePath(this.options.workspaceRoot, path);
    this.base.set(path, this.fileOps.exists(target) ? this.fileOps.read(target) : undefined);
  }

  private baseContent(path: string): string | undefined {
    if (this.base.has(path)) return this.base.get(path);
    const target = resolveWorkspacePath(this.options.workspaceRoot, path);
    return this.fileOps.exists(target) ? this.fileOps.read(target) : undefined;
  }

  private finalContent(path: string): string | undefined {
    if (this.deleted.has(path)) return undefined;
    if (this.options.mode === "shadow_buffer") return this.shadow.has(path) ? this.shadow.get(path) as string : this.baseContent(path);
    const target = resolveWorkspacePath(this.activeRoot(), path);
    return this.fileOps.exists(target) ? this.fileOps.read(target) : undefined;
  }

  private activeRoot(): string {
    return this.options.mode === "shadow_buffer" ? this.options.workspaceRoot : this.options.isolatedRoot as string;
  }

  private isSensitive(path: string): boolean {
    return this.sensitiveGlobs.some((glob) => globMatch(glob, path));
  }

  private publishSensitiveDeny(path: string): void {
    this.options.eventBus?.publish({ id: randomUUID(), type: "permission.resolved", schemaVersion: 1, workspaceId: this.options.workspaceId, ...(this.options.roomId !== undefined ? { roomId: this.options.roomId } : {}), runId: this.options.runId, payload: { decision: "deny", reason: "sensitive_pattern_match", requested: false, path, resource: { type: "file", path, operation: "write" } }, createdAt: this.now() });
  }
}

export class ArtifactFSRunRegistry {
  private readonly runs = new Map<string, ArtifactFS>();

  constructor(private readonly options: { readonly database: AgentHubDatabase; readonly service: ArtifactService; readonly eventBus: EventBus; readonly now?: () => number; readonly rootForRun?: (input: ArtifactFSRunRegistryBeginInput) => string | undefined }) {}

  beginRun(input: ArtifactFSRunRegistryBeginInput): ArtifactFS {
    const existing = this.runs.get(input.runId);
    if (existing) return existing;
    const workspaceRoot = this.workspaceRoot(input.workspaceId);
    const terminalEnabled = input.terminalEnabled === true;

    // For squad/team rooms, force isolated_worktree mode per spec §file-conflict-isolation.
    const forceRoomIsolation = (() => {
      if (input.roomId === undefined) return false;
      const room = this.options.database.sqlite.prepare("SELECT mode FROM rooms WHERE id = ?").get(input.roomId) as { readonly mode: string } | undefined;
      return room?.mode === "squad" || room?.mode === "team";
    })();
    const requestedMode = forceRoomIsolation ? "isolated_worktree" : input.mode;
    const mode = artifactFsMode(requestedMode, terminalEnabled);

    // For forced room isolation, prefer rootForRun over input.workDir.
    // input.workDir may be process.cwd() (mock adapter default) which is NOT a valid isolated root.
    // Only use input.workDir as isolated root when it is NOT the workspace root and NOT cwd.
    const resolvedWorkspaceRoot = resolve(workspaceRoot);
    const safeInputWorkDir =
      input.workDir !== undefined &&
      resolve(input.workDir) !== resolvedWorkspaceRoot &&
      resolve(input.workDir) !== resolve(".")
        ? input.workDir
        : undefined;

    const isolatedRoot =
      mode === "shadow_buffer"
        ? undefined
        : forceRoomIsolation
          ? (this.options.rootForRun?.(input) ?? safeInputWorkDir)
          : (safeInputWorkDir ?? this.options.rootForRun?.(input));

    // If isolated mode was requested but no valid root is available, fall back to shadow_buffer.
    const effectiveFinalMode: ArtifactFSMode = (mode !== "shadow_buffer" && isolatedRoot === undefined) ? "shadow_buffer" : mode;

    const fs = new ArtifactFS({ runId: input.runId, workspaceId: input.workspaceId, ...(input.roomId !== undefined ? { roomId: input.roomId } : {}), ...(input.taskId !== undefined ? { taskId: input.taskId } : {}), ...(input.messageId !== undefined ? { messageId: input.messageId } : {}), createdBy: input.agentId, mode: effectiveFinalMode, terminalEnabled, workspaceRoot, ...(isolatedRoot !== undefined ? { isolatedRoot } : {}), service: this.options.service, eventBus: this.options.eventBus, ...(this.options.now !== undefined ? { now: this.options.now } : {}) });
    this.runs.set(input.runId, fs);
    return fs;
  }

  writeTextFile(input: { readonly runId: string; readonly path: string; readonly content: string }): void {
    this.requireRun(input.runId).write(input.path, input.content);
  }

  readTextFile(input: { readonly runId: string; readonly path: string }): string | undefined {
    const fs = this.runs.get(input.runId);
    if (!fs) return undefined;
    try {
      return fs.read(input.path);
    } catch {
      return undefined;
    }
  }

  deleteFile(input: { readonly runId: string; readonly path: string }): void {
    this.requireRun(input.runId).delete(input.path);
  }

  buildRunArtifact(input: { readonly runId: string; readonly title?: string }): Artifact | undefined {
    const fs = this.runs.get(input.runId);
    if (!fs) return undefined;
    const artifact = fs.buildRunArtifact(input.title);
    this.runs.delete(input.runId);
    return artifact;
  }

  buildWorktreeDiffArtifact(input: { readonly runId: string; readonly title?: string }): Artifact | undefined {
    const fs = this.runs.get(input.runId);
    if (!fs) return undefined;
    const options = artifactFSOptions(fs);
    // Only handle isolated_worktree runs; for other modes, return undefined WITHOUT deleting
    // the run so the caller can fall back to buildRunArtifact.
    if (options.mode !== "isolated_worktree" || options.isolatedRoot === undefined) {
      return undefined;
    }
    let artifact: Artifact | undefined;
    const now = this.options.now ?? Date.now;
    this.options.database.sqlite.transaction(() => {
      const patch = execFileSync("git", ["diff", "HEAD"], { cwd: options.isolatedRoot as string, encoding: "utf8" }).trim();
      if (patch.length === 0) return;
      const filesChanged = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: options.isolatedRoot as string, encoding: "utf8" }).split(/\r?\n/).map((path) => path.trim()).filter((path) => path.length > 0);
      if (filesChanged.length === 0) return;
      const additions = patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++" )).length;
      const deletions = patch.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---" )).length;
      artifact = this.options.service.create({ workspaceId: options.workspaceId, ...(options.roomId !== undefined ? { roomId: options.roomId } : {}), ...(options.taskId !== undefined ? { taskId: options.taskId } : {}), runId: options.runId, ...(options.messageId !== undefined ? { messageId: options.messageId } : {}), type: "worktree_diff", title: input.title ?? `Run ${options.runId} worktree diff`, status: "ready_for_review", createdBy: options.createdBy, metadata: { filesChanged, artifactFsMode: options.mode }, files: [{ path: "worktree.patch", oldContent: "", newContent: patch, patch, additions, deletions, fileStatus: "modified" as const }] }, {});
      this.options.eventBus.publish({ id: randomUUID(), type: "worktree.diff.ready", schemaVersion: 1, workspaceId: options.workspaceId, ...(options.roomId !== undefined ? { roomId: options.roomId } : {}), ...(options.taskId !== undefined ? { taskId: options.taskId } : {}), runId: options.runId, payload: { runId: options.runId, ...(options.taskId !== undefined ? { taskId: options.taskId } : {}), artifactId: artifact.id, filesChanged }, createdAt: now() });
    })();
    // Only consume the run from registry if we actually created a worktree diff artifact.
    // If patch was empty (no file changes), leave the run in the registry so the caller
    // can fall back to buildRunArtifact for a regular diff artifact.
    if (artifact !== undefined) {
      this.runs.delete(input.runId);
    }
    return artifact;
  }

  private requireRun(runId: string): ArtifactFS {
    const fs = this.runs.get(runId);
    if (!fs) throw new ArtifactFSError("run_not_registered", runId);
    return fs;
  }

  private workspaceRoot(workspaceId: string): string {
    const row = this.options.database.sqlite.prepare("SELECT root_path FROM workspaces WHERE id = ?").get(workspaceId) as { readonly root_path: string } | undefined;
    if (!row) throw new Error(`workspace '${workspaceId}' not found`);
    return row.root_path;
  }
}

export class ArtifactFSError extends Error {
  constructor(readonly code: "terminal_shadow_buffer_forbidden" | "isolated_root_required" | "sensitive_file_blocked" | "file_not_found" | "run_not_registered", message: string) {
    super(message);
    this.name = "ArtifactFSError";
  }
}

export class ArtifactNotImplementedError extends Error { constructor(message: string, readonly details?: unknown) { super(message); this.name = "ArtifactNotImplementedError"; } }
export class ArtifactConflictError extends Error { constructor(message: string) { super(message); this.name = "ArtifactConflictError"; } }

export function createArtifactCommandHandlers(service: ArtifactService): Partial<Record<Command["type"], CommandHandler>> {
  return {
    CreateArtifact: (command, meta) => commandResult(() => service.create(createInput(command, meta), traceFromMeta(meta)), serviceDatabase(service), undefined),
    ReviewArtifact: (command, meta) => commandResult(() => service.review(requiredString(command, "artifactId"), traceFromMeta(meta)), serviceDatabase(service), requiredString(command, "artifactId")),
    ApplyDiff: (command, meta) => commandResult(() => service.apply(requiredString(command, "artifactId"), traceFromMeta(meta)), serviceDatabase(service), requiredString(command, "artifactId")),
    RejectDiff: (command, meta) => commandResult(() => service.reject(requiredString(command, "artifactId"), stringField(command, "reason"), traceFromMeta(meta)), serviceDatabase(service), requiredString(command, "artifactId")),
    RevertArtifact: (command, meta) => commandResult(() => service.revert(requiredString(command, "artifactId"), traceFromMeta(meta)), serviceDatabase(service), requiredString(command, "artifactId"))
  } satisfies Partial<Record<Command["type"], CommandHandler>>;
}

function commandResult(action: () => Artifact, database: AgentHubDatabase, artifactId: string | undefined): CommandResult {
  try {
    const artifact = action();
    return { ok: true, data: artifact, emittedEvents: latestArtifactEvents(database, artifactId ?? artifact.id) };
  } catch (error) {
    if (error instanceof ArtifactNotImplementedError) return { ok: false, error: { code: "not_implemented", message: error.message, details: error.details } };
    if (error instanceof ArtifactConflictError) return { ok: false, error: { code: "conflict", message: error.message } };
    if (error instanceof Error && error.message.includes("required")) return { ok: false, error: { code: "validation_failed", message: error.message } };
    throw error;
  }
}

function createInput(command: Command, meta: CommandMeta): CreateArtifactInput {
  const roomId = stringField(command, "roomId");
  const taskId = stringField(command, "taskId");
  const runId = stringField(command, "runId");
  const messageId = stringField(command, "messageId");
  const status = artifactStatus(stringField(command, "status"));
  return { workspaceId: requiredString(command, "workspaceId"), ...(roomId !== undefined ? { roomId } : {}), ...(taskId !== undefined ? { taskId } : {}), ...(runId !== undefined ? { runId } : {}), ...(messageId !== undefined ? { messageId } : {}), type: artifactType(requiredString(command, "artifactType", "typeName", "kind")), title: requiredString(command, "title"), ...(status !== undefined ? { status } : {}), createdBy: actorId(meta), metadata: isObject(command.metadata) ? command.metadata : {}, files: Array.isArray(command.files) ? command.files.map(fileInput) : [] };
}

function fileInput(value: unknown): Omit<ArtifactFile, "artifactId" | "createdAt"> {
  if (!isObject(value)) throw new Error("artifact file must be an object");
  const oldContent = stringField(value, "oldContent");
  const newContent = stringField(value, "newContent");
  const patch = stringField(value, "patch");
  const oldSha256 = stringField(value, "oldSha256");
  const newSha256 = stringField(value, "newSha256");
  const contentPath = stringField(value, "contentPath");
  return { path: requiredString(value, "path"), ...(oldContent !== undefined ? { oldContent } : {}), ...(newContent !== undefined ? { newContent } : {}), ...(patch !== undefined ? { patch } : {}), additions: numberField(value, "additions") ?? 0, deletions: numberField(value, "deletions") ?? 0, fileStatus: fileStatus(value.fileStatus ?? value.status), ...(oldSha256 !== undefined ? { oldSha256 } : {}), ...(newSha256 !== undefined ? { newSha256 } : {}), ...(contentPath !== undefined ? { contentPath } : {}) };
}

function metadataFor(input: CreateArtifactInput, now: number): Record<string, unknown> {
  const metadata = { ...(input.metadata ?? {}) };
  if (input.type === "preview") { metadata.token = randomBytes(24).toString("base64url"); metadata.tokenExpiresAt = now + 30 * 60 * 1000; metadata.oneTime = true; }
  if (input.type === "terminal") {
    const stdout = typeof metadata.stdout === "string" ? metadata.stdout : "";
    const stderr = typeof metadata.stderr === "string" ? metadata.stderr : "";
    metadata.stdoutPreview = firstLines(stdout, 200);
    metadata.stderrPreview = firstLines(stderr, 200);
  }
  return metadata;
}

function normalizeFiles(artifactId: string, files: readonly Omit<ArtifactFile, "artifactId" | "createdAt">[], createdAt: number): ArtifactFile[] {
  return files.map((file) => ({ ...file, artifactId, additions: file.additions ?? 0, deletions: file.deletions ?? 0, createdAt }));
}

function validateCreate(input: CreateArtifactInput): void {
  if (input.workspaceId.length === 0 || input.title.length === 0) throw new Error("workspaceId and title are required");
}

function artifactEvent(type: ArtifactEventType, artifact: Artifact, payload: Record<string, unknown>, createdAt: number, trace: EventTrace): PublishInput {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId: artifact.workspaceId, ...(artifact.roomId !== undefined ? { roomId: artifact.roomId } : {}), ...(artifact.taskId !== undefined ? { taskId: artifact.taskId } : {}), ...(artifact.runId !== undefined ? { runId: artifact.runId } : {}), ...(trace.traceId !== undefined ? { traceId: trace.traceId } : {}), ...(trace.causationId !== undefined ? { causationId: trace.causationId } : {}), ...(trace.correlationId !== undefined ? { correlationId: trace.correlationId } : {}), payload, createdAt };
}

function rowToArtifact(row: ArtifactRow): Artifact {
  return { id: row.id, workspaceId: row.workspace_id, ...(row.room_id !== null ? { roomId: row.room_id } : {}), ...(row.task_id !== null ? { taskId: row.task_id } : {}), ...(row.run_id !== null ? { runId: row.run_id } : {}), ...(row.message_id !== null ? { messageId: row.message_id } : {}), type: row.type as ArtifactType, title: row.title, status: row.status as ArtifactStatus, createdBy: row.created_by ?? "unknown", metadata: JSON.parse(row.metadata) as Record<string, unknown>, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.applied_at !== null ? { appliedAt: row.applied_at } : {}) };
}

function rowToFile(row: ArtifactFileRow): ArtifactFile {
  return { artifactId: row.artifact_id, path: row.path, ...(row.old_content !== null ? { oldContent: row.old_content } : {}), ...(row.new_content !== null ? { newContent: row.new_content } : {}), ...(row.patch !== null ? { patch: row.patch } : {}), additions: row.additions ?? 0, deletions: row.deletions ?? 0, fileStatus: row.file_status as ArtifactFileStatus, ...(row.old_sha256 !== null ? { oldSha256: row.old_sha256 } : {}), ...(row.new_sha256 !== null ? { newSha256: row.new_sha256 } : {}), ...(row.applied_state !== null ? { appliedState: row.applied_state as AppliedState } : {}), ...(row.content_path !== null ? { contentPath: row.content_path } : {}), createdAt: row.created_at };
}

export function sha256(content: string): string { return createHash("sha256").update(content).digest("hex"); }
function reverseStatus(status: ArtifactFileStatus): ArtifactFileStatus { return status === "added" ? "deleted" : status === "deleted" ? "added" : "modified"; }
function reversePatch(path: string, oldContent: string, newContent: string): string { return `--- a/${path}\n+++ b/${path}\n@@\n-${oldContent}\n+${newContent}\n`; }
function simplePatch(path: string, oldContent: string, newContent: string): string { return `--- a/${path}\n+++ b/${path}\n@@\n-${oldContent}\n+${newContent}\n`; }
function firstLines(value: string, count: number): string { return value.split(/\r?\n/).slice(0, count).join("\n"); }
function lineCount(value: string): number { return value.length === 0 ? 0 : value.split(/\r?\n/).length; }
function requiredArtifact(artifact: Artifact | undefined, id: string): Artifact { if (!artifact) throw new ArtifactConflictError(`artifact '${id}' not found`); return artifact; }
function resolveWorkspacePath(root: string, path: string): string { const resolved = resolve(root, path); const rel = relative(root, resolved); if (rel.startsWith("..") || rel === "" || rel.split(sep).includes("..")) { if (rel === "") return resolved; throw new Error("artifact path escapes workspace"); } return resolved; }
function listFiles(root: string, prefix = ""): string[] {
  const dir = resolve(root, prefix);
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const relativePath = normalizePath(prefix.length > 0 ? `${prefix}/${entry}` : entry);
    const full = resolve(root, relativePath);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...listFiles(root, relativePath));
    else if (stat.isFile()) files.push(relativePath);
  }
  return files;
}
function latestArtifactEvents(database: AgentHubDatabase, artifactId: string): { readonly seq: number; readonly type: string }[] { return database.sqlite.prepare("SELECT seq, type FROM events WHERE type LIKE 'artifact.%' AND payload LIKE ? ORDER BY seq ASC").all(`%${artifactId}%`) as { readonly seq: number; readonly type: string }[]; }
function serviceDatabase(service: ArtifactService): AgentHubDatabase { return (service as unknown as { readonly options: { readonly database: AgentHubDatabase } }).options.database; }
function traceFromMeta(meta: CommandMeta): EventTrace { return { traceId: meta.traceId }; }
function actorId(meta: CommandMeta): string { return meta.actor.type === "system" ? "system" : meta.actor.id; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringField(command: Record<string, unknown>, key: string): string | undefined { const value = command[key]; return typeof value === "string" && value.length > 0 ? value : undefined; }
function numberField(command: Record<string, unknown>, key: string): number | undefined { const value = command[key]; return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function requiredString(command: Record<string, unknown>, ...keys: readonly string[]): string { for (const key of keys) { const value = stringField(command, key); if (value !== undefined) return value; } throw new Error(`${keys.join("/")} is required`); }
function artifactType(value: string): ArtifactType { if (["diff", "file", "preview", "document", "terminal", "deployment", "worktree_diff"].includes(value)) return value as ArtifactType; throw new Error("artifact type is invalid"); }
function artifactStatus(value: string | undefined): ArtifactStatus | undefined { if (value === undefined) return undefined; if (["draft", "reviewing", "accepted", "applying", "applied", "rejected", "failed", "ready_for_review", "conflict", "discarded"].includes(value)) return value as ArtifactStatus; throw new Error("artifact status is invalid"); }
function artifactFsMode(value: string | undefined, terminalEnabled: boolean): ArtifactFSMode { if (value === "isolated_worktree" || value === "isolated_copy" || value === "shadow_buffer") return value; return terminalEnabled ? "isolated_worktree" : "shadow_buffer"; }
function fileStatus(value: unknown): ArtifactFileStatus { if (value === "added" || value === "modified" || value === "deleted") return value; return "modified"; }
function normalizePath(path: string): string { return normalize(path).replaceAll("\\", "/").replace(/^\.\//, ""); }
function globMatch(glob: string, path: string): boolean { return new RegExp(`^${globToRegExp(normalizePath(glob).replace(/^\//, ""))}$`).test(normalizePath(path)); }
function globToRegExp(glob: string): string {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") { pattern += ".*"; index += 1; continue; }
    if (char === "*") { pattern += "[^/]*"; continue; }
    pattern += escapeRegExp(char ?? "");
  }
  return pattern;
}
function escapeRegExp(value: string): string { return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&"); }
function failurePath(error: unknown): string | undefined { return error instanceof Error && error.message.length > 0 ? error.message : undefined; }
function artifactFSOptions(fs: ArtifactFS): ArtifactFSOptions { return (fs as unknown as { readonly options: ArtifactFSOptions }).options; }

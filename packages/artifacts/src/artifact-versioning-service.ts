import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type ArtifactVersionEncoding = "text" | "binary";

export type ArtifactVersionRecord = {
  readonly id: string;
  readonly artifactId: string;
  readonly version: number;
  readonly contentEncoding: ArtifactVersionEncoding;
  readonly createdAt: number;
  readonly createdBy?: string | undefined;
  readonly message?: string | undefined;
};

export type CreateArtifactVersionInput = {
  readonly artifactId: string;
  readonly content?: string | undefined;
  readonly filePath?: string | undefined;
  readonly filename?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly createdBy?: string | undefined;
  readonly message?: string | undefined;
};

export type ArtifactVersioningService = {
  readonly createVersion: (input: CreateArtifactVersionInput) => Promise<ArtifactVersionRecord>;
  readonly createBinaryVersion: (input: CreateArtifactVersionInput) => Promise<ArtifactVersionRecord>;
  readonly createVersionInTransaction: (input: CreateArtifactVersionInput) => ArtifactVersionRecord;
  readonly createBinaryVersionInTransaction: (input: CreateArtifactVersionInput) => ArtifactVersionRecord;
  readonly restoreBinaryVersionInTransaction: (artifactId: string, version: number) => ArtifactVersionRecord;
  readonly listVersions: (artifactId: string) => Promise<readonly ArtifactVersionRecord[]>;
  readonly restoreVersion: (artifactId: string, version: number) => Promise<ArtifactVersionRecord>;
  readonly diffVersions: (artifactId: string, fromVersion: number, toVersion: number) => Promise<string>;
};

export type ArtifactVersioningServiceOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly now?: () => number;
};

type ArtifactRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly room_id: string | null;
  readonly task_id: string | null;
  readonly run_id: string | null;
  readonly metadata: string;
};

type WorkspaceRow = {
  readonly root_path: string;
};

type VersionRow = {
  readonly id: string;
  readonly artifact_id: string;
  readonly version: number;
  readonly content_encoding: ArtifactVersionEncoding;
  readonly created_at: number;
  readonly created_by: string | null;
  readonly message: string | null;
};

export function createArtifactVersioningService(options: ArtifactVersioningServiceOptions): ArtifactVersioningService {
  const now = options.now ?? Date.now;
  const createVersionInTransaction = (input: CreateArtifactVersionInput): ArtifactVersionRecord => {
    if (input.content === undefined) throw new Error("content is required");
    const artifact = requireArtifact(options.database, input.artifactId);
    const createdAt = now();
    const version = nextVersion(options.database, input.artifactId);
    const path = normalizeFilename(input.filename ?? defaultTextFilename(artifact));
    options.database.sqlite
      .prepare(
        `INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at, binary, mime_type, size_bytes)
         VALUES (?, ?, NULL, ?, NULL, 0, 0, 'modified', NULL, ?, NULL, NULL, ?, 0, ?, ?)
         ON CONFLICT(artifact_id, path) DO UPDATE SET
           new_content = excluded.new_content,
           new_sha256 = excluded.new_sha256,
           content_path = NULL,
           binary = 0,
           mime_type = excluded.mime_type,
           size_bytes = excluded.size_bytes`
      )
      .run(input.artifactId, path, input.content, sha256(input.content), createdAt, mimeTypeForPath(path), Buffer.byteLength(input.content, "utf8"));
    return insertVersion(options, artifact, {
      version,
      content: input.content,
      storagePath: null,
      contentEncoding: "text",
      createdAt,
      createdBy: input.createdBy,
      message: input.message
    });
  };
  const createBinaryVersionInTransaction = (input: CreateArtifactVersionInput): ArtifactVersionRecord => {
    if (input.filePath === undefined) throw new Error("filePath is required");
    const artifact = requireArtifact(options.database, input.artifactId);
    const workspaceRoot = workspaceRootFor(options.database, artifact.workspace_id);
    const source = resolveWorkspaceFile(workspaceRoot, input.filePath);
    const createdAt = now();
    const version = nextVersion(options.database, input.artifactId);
    const filename = normalizeFilename(input.filename ?? basename(source));
    const storagePath = join(workspaceRoot, ".agenthub", "artifacts", input.artifactId, `v${version}`, filename);
    mkdirSync(dirname(storagePath), { recursive: true });
    copyFileSync(source, storagePath);
    const stats = statSync(storagePath);
    const digest = fileSha256(storagePath);
    options.database.sqlite
      .prepare(
        `INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at, binary, mime_type, size_bytes)
         VALUES (?, ?, NULL, NULL, NULL, 0, 0, 'modified', NULL, ?, NULL, ?, ?, 1, ?, ?)
         ON CONFLICT(artifact_id, path) DO UPDATE SET
           new_content = NULL,
           new_sha256 = excluded.new_sha256,
           content_path = excluded.content_path,
           binary = 1,
           mime_type = excluded.mime_type,
           size_bytes = excluded.size_bytes`
      )
      .run(input.artifactId, filename, digest, storagePath, createdAt, input.mimeType ?? mimeTypeForPath(filename), stats.size);
    return insertVersion(options, artifact, {
      version,
      content: null,
      storagePath,
      contentEncoding: "binary",
      createdAt,
      createdBy: input.createdBy,
      message: input.message,
      metadata: {
        filename,
        mimeType: input.mimeType ?? mimeTypeForPath(filename),
        sizeBytes: stats.size,
        newSha256: digest
      }
    });
  };
  const restoreBinaryVersionInTransaction = (artifactId: string, sourceVersion: number): ArtifactVersionRecord => {
    const artifact = requireArtifact(options.database, artifactId);
    const workspaceRoot = workspaceRootFor(options.database, artifact.workspace_id);
    const source = options.database.sqlite.prepare("SELECT storage_path FROM artifact_versions WHERE artifact_id = ? AND version = ? AND content_encoding = 'binary'").get(artifactId, sourceVersion) as { readonly storage_path: string | null } | undefined;
    if (source === undefined || source.storage_path === null) throw new Error(`artifact version ${sourceVersion} not found`);
    const sourcePath = resolveControlledStoragePath(workspaceRoot, artifactId, sourceVersion, source.storage_path);
    const createdAt = now();
    const version = nextVersion(options.database, artifactId);
    const filename = normalizeFilename(basename(sourcePath));
    const storagePath = join(workspaceRoot, ".agenthub", "artifacts", artifactId, `v${version}`, filename);
    mkdirSync(dirname(storagePath), { recursive: true });
    copyFileSync(sourcePath, storagePath);
    const stats = statSync(storagePath);
    const digest = fileSha256(storagePath);
    options.database.sqlite
      .prepare(
        `INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at, binary, mime_type, size_bytes)
         VALUES (?, ?, NULL, NULL, NULL, 0, 0, 'modified', NULL, ?, NULL, ?, ?, 1, ?, ?)
         ON CONFLICT(artifact_id, path) DO UPDATE SET
           new_content = NULL,
           new_sha256 = excluded.new_sha256,
           content_path = excluded.content_path,
           binary = 1,
           mime_type = excluded.mime_type,
           size_bytes = excluded.size_bytes`
      )
      .run(artifactId, filename, digest, storagePath, createdAt, mimeTypeForPath(filename), stats.size);
    return insertVersion(options, artifact, {
      version,
      content: null,
      storagePath,
      contentEncoding: "binary",
      createdAt,
      message: `Restore v${sourceVersion}`,
      metadata: {
        filename,
        mimeType: mimeTypeForPath(filename),
        sizeBytes: stats.size,
        newSha256: digest
      }
    });
  };
  const service: ArtifactVersioningService = {
    createVersion: async (input) => {
      let record: ArtifactVersionRecord | undefined;
      options.database.sqlite.transaction(() => {
        record = createVersionInTransaction(input);
      })();
      return record!;
    },
    createBinaryVersion: async (input) => {
      let record: ArtifactVersionRecord | undefined;
      options.database.sqlite.transaction(() => {
        record = createBinaryVersionInTransaction(input);
      })();
      return record!;
    },
    createVersionInTransaction,
    createBinaryVersionInTransaction,
    restoreBinaryVersionInTransaction,
    listVersions: async (artifactId) => {
      return (options.database.sqlite.prepare("SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC").all(artifactId) as VersionRow[]).map(rowToRecord);
    },
    restoreVersion: async (artifactId, version) => {
      const source = options.database.sqlite.prepare("SELECT content, storage_path, content_encoding, message FROM artifact_versions WHERE artifact_id = ? AND version = ?").get(artifactId, version) as { readonly content: string | null; readonly storage_path: string | null; readonly content_encoding: ArtifactVersionEncoding; readonly message: string | null } | undefined;
      if (source === undefined) throw new Error(`artifact version ${version} not found`);
      if (source.content_encoding === "binary") {
        let record: ArtifactVersionRecord | undefined;
        options.database.sqlite.transaction(() => {
          record = restoreBinaryVersionInTransaction(artifactId, version);
        })();
        return record!;
      }
      if (source.content === null) throw new Error("text version is missing content");
      return await service.createVersion({ artifactId, content: source.content, message: `Restore v${version}` });
    },
    diffVersions: async (artifactId, fromVersion, toVersion) => {
      const artifact = requireArtifact(options.database, artifactId);
      const workspaceRoot = workspaceRootFor(options.database, artifact.workspace_id);
      const from = readVersionContent(options.database, workspaceRoot, artifactId, fromVersion);
      const to = readVersionContent(options.database, workspaceRoot, artifactId, toVersion);
      if (from.encoding === "binary" || to.encoding === "binary") {
        return JSON.stringify({ type: "binary", from, to, changed: binaryVersionChanged(from, to) });
      }
      return unifiedDiff(`v${fromVersion}`, from.content ?? "", `v${toVersion}`, to.content ?? "");
    }
  };
  return service;
}

function insertVersion(
  options: ArtifactVersioningServiceOptions,
  artifact: ArtifactRow,
  input: {
    readonly version: number;
    readonly content: string | null;
    readonly storagePath: string | null;
    readonly contentEncoding: ArtifactVersionEncoding;
    readonly createdAt: number;
    readonly createdBy?: string | undefined;
    readonly message?: string | undefined;
    readonly metadata?: Record<string, unknown> | undefined;
  }
): ArtifactVersionRecord {
  const id = randomUUID();
  const metadata = JSON.stringify(input.metadata ?? JSON.parse(artifact.metadata) as Record<string, unknown>);
  options.database.sqlite
    .prepare("INSERT INTO artifact_versions (id, artifact_id, version, content, storage_path, content_encoding, metadata, created_at, created_by, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, artifact.id, input.version, input.content, input.storagePath, input.contentEncoding, metadata, input.createdAt, input.createdBy ?? null, input.message ?? null);
  options.eventBus.publish({
    id: randomUUID(),
    type: "artifact.version.created",
    schemaVersion: 1,
    workspaceId: artifact.workspace_id,
    ...(artifact.room_id !== null ? { roomId: artifact.room_id } : {}),
    ...(artifact.task_id !== null ? { taskId: artifact.task_id } : {}),
    ...(artifact.run_id !== null ? { runId: artifact.run_id } : {}),
    payload: { artifactId: artifact.id, version: input.version, createdBy: input.createdBy ?? "system", ...(input.message !== undefined ? { message: input.message } : {}) },
    createdAt: input.createdAt
  });
  return { id, artifactId: artifact.id, version: input.version, contentEncoding: input.contentEncoding, createdAt: input.createdAt, ...(input.createdBy !== undefined ? { createdBy: input.createdBy } : {}), ...(input.message !== undefined ? { message: input.message } : {}) };
}

function requireArtifact(database: AgentHubDatabase, artifactId: string): ArtifactRow {
  const row = database.sqlite.prepare("SELECT id, workspace_id, room_id, task_id, run_id, metadata FROM artifacts WHERE id = ?").get(artifactId) as ArtifactRow | undefined;
  if (row === undefined) throw new Error(`artifact '${artifactId}' not found`);
  return row;
}

function workspaceRootFor(database: AgentHubDatabase, workspaceId: string): string {
  const row = database.sqlite.prepare("SELECT root_path FROM workspaces WHERE id = ?").get(workspaceId) as WorkspaceRow | undefined;
  if (row === undefined) throw new Error(`workspace '${workspaceId}' not found`);
  return resolve(row.root_path);
}

function nextVersion(database: AgentHubDatabase, artifactId: string): number {
  const row = database.sqlite.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM artifact_versions WHERE artifact_id = ?").get(artifactId) as { readonly version: number };
  return row.version;
}

function rowToRecord(row: VersionRow): ArtifactVersionRecord {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    version: row.version,
    contentEncoding: row.content_encoding,
    createdAt: row.created_at,
    ...(row.created_by !== null ? { createdBy: row.created_by } : {}),
    ...(row.message !== null ? { message: row.message } : {})
  };
}

function normalizeFilename(filename: string): string {
  const normalized = filename.replace(/\\/gu, "/").split("/").filter(Boolean).at(-1);
  if (normalized === undefined || normalized === "." || normalized === "..") throw new Error("filename is invalid");
  return normalized;
}

function defaultTextFilename(artifact: ArtifactRow): string {
  const metadata = JSON.parse(artifact.metadata) as Record<string, unknown>;
  return typeof metadata.filename === "string" ? metadata.filename : "index.html";
}

function resolveWorkspaceFile(workspaceRoot: string, filePath: string): string {
  const root = resolve(workspaceRoot);
  const target = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath);
  const rel = relative(root, target);
  if (target !== root && (rel.startsWith("..") || rel.split(sep).includes("..") || isAbsolute(rel))) throw new Error("filePath must be within workspace");
  return target;
}

function resolveControlledStoragePath(workspaceRoot: string, artifactId: string, version: number, storagePath: string): string {
  const root = resolve(workspaceRoot);
  const controlledRoot = resolve(root, ".agenthub", "artifacts", artifactId, `v${version}`);
  const target = resolve(storagePath);
  const rel = relative(controlledRoot, target);
  if (target !== controlledRoot && (rel.startsWith("..") || rel.split(sep).includes("..") || isAbsolute(rel))) {
    throw new Error("binary version storage_path must be within controlled artifact storage");
  }
  return target;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSyncBinary(path)).digest("hex");
}

function readFileSyncBinary(path: string): Buffer {
  return readFileSync(path);
}

function mimeTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html";
    case ".md": return "text/markdown";
    case ".json": return "application/json";
    case ".pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".ppt": return "application/vnd.ms-powerpoint";
    case ".odp": return "application/vnd.oasis.opendocument.presentation";
    default: return "application/octet-stream";
  }
}

type VersionContent =
  | { readonly encoding: "text"; readonly content: string }
  | { readonly encoding: "binary"; readonly version: number; readonly filename: string; readonly sizeBytes: number; readonly sha256: string };

function readVersionContent(database: AgentHubDatabase, workspaceRoot: string, artifactId: string, version: number): VersionContent {
  const row = database.sqlite.prepare("SELECT content, storage_path, content_encoding FROM artifact_versions WHERE artifact_id = ? AND version = ?").get(artifactId, version) as { readonly content: string | null; readonly storage_path: string | null; readonly content_encoding: ArtifactVersionEncoding } | undefined;
  if (row === undefined) throw new Error(`artifact version ${version} not found`);
  if (row.content_encoding === "binary") {
    if (row.storage_path === null) throw new Error(`binary artifact version ${version} is missing storage_path`);
    const storagePath = resolveControlledStoragePath(workspaceRoot, artifactId, version, row.storage_path);
    const stats = statSync(storagePath);
    return { encoding: "binary", version, filename: basename(storagePath), sizeBytes: stats.size, sha256: fileSha256(storagePath) };
  }
  return { encoding: "text", content: row.content ?? "" };
}

function binaryVersionChanged(from: VersionContent, to: VersionContent): boolean {
  if (from.encoding !== "binary" || to.encoding !== "binary") return true;
  return from.sizeBytes !== to.sizeBytes || from.sha256 !== to.sha256;
}

function unifiedDiff(fromName: string, fromContent: string, toName: string, toContent: string): string {
  if (fromContent === toContent) return `--- ${fromName}\n+++ ${toName}\n`;
  return `--- ${fromName}\n+++ ${toName}\n@@\n-${fromContent}\n+${toContent}\n`;
}

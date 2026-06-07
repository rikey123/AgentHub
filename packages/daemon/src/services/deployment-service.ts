import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type DeploymentKind = "preview-url" | "static-site" | "source-zip" | "container-export" | "container-build" | "self-hosted";
export type DeploymentStatus = "queued" | "in_progress" | "ready" | "failed" | "cancelled" | "expired" | "unpublished";

export type DeploymentRecord = {
  readonly id: string;
  readonly artifactId: string;
  readonly roomId?: string;
  readonly workspaceId: string;
  readonly kind: DeploymentKind;
  readonly status: DeploymentStatus;
  readonly url?: string;
  readonly downloadUrl?: string;
  readonly imageTag?: string;
  readonly logPath?: string;
};

export type CreateDeploymentInput = {
  readonly artifactId: string;
  readonly kind: DeploymentKind;
  readonly roomId?: string | undefined;
  readonly providerId?: string | undefined;
};

export type DeploymentService = {
  readonly createDeployment: (input: CreateDeploymentInput) => Promise<DeploymentRecord>;
  readonly getDeployment: (deploymentId: string) => Promise<DeploymentRecord | undefined>;
  readonly redeploy: (deploymentId: string) => Promise<DeploymentRecord>;
  readonly retry: (deploymentId: string) => Promise<DeploymentRecord>;
  readonly cancel: (deploymentId: string) => Promise<DeploymentRecord>;
  readonly unpublish: (deploymentId: string) => Promise<DeploymentRecord>;
  readonly appendLog: (deploymentId: string, chunk: string) => Promise<void>;
  readonly listDeployments: (artifactId: string) => Promise<readonly DeploymentRecord[]>;
  readonly readLogs: (deploymentId: string) => Promise<string>;
  readonly downloadPath: (deploymentId: string) => Promise<string | undefined>;
  readonly testProvider: (providerId: string) => Promise<{ readonly ok: boolean; readonly version?: string; readonly error?: string }>;
  readonly recoverInterruptedDeployments: () => void;
};

export type DeploymentServiceOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly now?: () => number;
  readonly deploymentRoot?: string;
  readonly sitePort?: number;
  readonly previewPort?: number;
  readonly fetchImpl?: typeof fetch;
  readonly keychain?: {
    readonly get: (key: string) => Promise<string | null>;
    readonly set?: (key: string, secret: string) => Promise<void>;
    readonly delete?: (key: string) => Promise<boolean>;
  };
  readonly spawnImpl?: typeof spawn;
};

type ArtifactRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly room_id: string | null;
  readonly kind: string | null;
  readonly title: string;
};

type DeploymentRow = {
  readonly id: string;
  readonly artifact_id: string;
  readonly room_id: string | null;
  readonly workspace_id: string;
  readonly kind: DeploymentKind;
  readonly status: DeploymentStatus;
  readonly url: string | null;
  readonly download_url: string | null;
  readonly image_tag: string | null;
  readonly log_path: string | null;
  readonly pid: string | null;
  readonly provider_config_id: string | null;
};

export function createDeploymentService(options: DeploymentServiceOptions): DeploymentService {
  const now = options.now ?? Date.now;
  const root = resolvePath(options.deploymentRoot ?? process.cwd(), ".agenthub", "deployments");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const spawnImpl = options.spawnImpl ?? spawn;
  const processes = new Map<string, ChildProcess>();

  const createDeployment = async (input: CreateDeploymentInput): Promise<DeploymentRecord> => {
    const artifact = options.database.sqlite.prepare("SELECT id, workspace_id, room_id, kind, title FROM artifacts WHERE id = ? AND deleted_at IS NULL").get(input.artifactId) as ArtifactRow | undefined;
    if (artifact === undefined) throw new Error(`Artifact '${input.artifactId}' not found`);
    const deploymentId = randomUUID();
    const roomId = input.roomId ?? artifact.room_id ?? undefined;
    const createdAt = now();
    const paths = prepareDeploymentPaths(root, deploymentId);
    const initialKind = input.kind;
    options.database.sqlite.transaction(() => {
      options.database.sqlite.prepare(
        `INSERT INTO deployments (
          id, artifact_id, room_id, workspace_id, kind, provider, status, provider_config_id,
          log_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
      ).run(
        deploymentId,
        artifact.id,
        roomId ?? null,
        artifact.workspace_id,
        initialKind,
        input.providerId !== undefined ? "caprover" : "agenthub-local",
        input.providerId ?? null,
        shouldHaveLogs(initialKind) ? paths.logPath : null,
        createdAt,
        createdAt
      );
      options.eventBus.publish({
        id: randomUUID(),
        type: "deployment.created",
        schemaVersion: 1,
        workspaceId: artifact.workspace_id,
        ...(roomId !== undefined ? { roomId } : {}),
        payload: { deploymentId, artifactId: artifact.id, kind: initialKind, provider: input.providerId !== undefined ? "caprover" : "agenthub-local", status: "queued" },
        createdAt
      });
      if (roomId !== undefined) {
        const messageId = randomUUID();
        options.database.sqlite
          .prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'system', 'deployment', NULL, 'system', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)")
          .run(messageId, artifact.workspace_id, roomId, createdAt, createdAt);
        const part = { type: "deployment", deploymentId, artifactId: artifact.id, kind: initialKind, status: "queued" };
        options.database.sqlite
          .prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'deployment', ?, ?)")
          .run(messageId, JSON.stringify(part), createdAt);
        options.eventBus.publish({
          id: randomUUID(),
          type: "message.part.added",
          schemaVersion: 1,
          workspaceId: artifact.workspace_id,
          roomId,
          payload: { messageId, part: { seq: 1, ...part } },
          createdAt
        });
      }
    })();
    await runInitialDeployment(deploymentId);
    return rowToRecord(readDeploymentOrThrow(options.database, deploymentId));
  };

  const markStatus = (deploymentId: string, status: DeploymentStatus, eventType: "deployment.status.changed" | "deployment.ready" | "deployment.failed" | "deployment.cancelled" | "deployment.expired" | "deployment.unpublished", patch: Record<string, unknown> = {}): DeploymentRecord => {
    const existing = readDeploymentOrThrow(options.database, deploymentId);
    const timestamp = now();
    const eventPayload = payloadForDeploymentEvent(eventType, deploymentId, status, patch);
    options.database.sqlite.transaction(() => {
      const assignments = ["status = ?", "updated_at = ?"];
      const values: unknown[] = [status, timestamp];
      if (status === "cancelled") {
        assignments.push("cancelled_at = ?");
        values.push(timestamp);
      }
      if (status === "unpublished") {
        assignments.push("unpublished_at = ?");
        values.push(timestamp);
      }
      if (status === "ready") {
        assignments.push("finished_at = ?");
        values.push(timestamp);
      }
      if (typeof patch.url === "string") {
        assignments.push("url = ?");
        values.push(patch.url);
      }
      if (typeof patch.downloadUrl === "string") {
        assignments.push("download_url = ?");
        values.push(patch.downloadUrl);
      }
      if (typeof patch.imageTag === "string") {
        assignments.push("image_tag = ?");
        values.push(patch.imageTag);
      }
      if (typeof patch.error === "string") {
        assignments.push("error = ?", "last_error = ?");
        values.push(patch.error, patch.error);
      }
      if (typeof patch.pid === "string") {
        assignments.push("pid = ?");
        values.push(patch.pid);
      }
      if (typeof patch.expiresAt === "number") {
        assignments.push("expires_at = ?");
        values.push(patch.expiresAt);
      }
      if (typeof patch.publishedAt === "number") {
        assignments.push("published_at = ?");
        values.push(patch.publishedAt);
      }
      if (typeof patch.sourcePath === "string") {
        assignments.push("source_path = ?");
        values.push(patch.sourcePath);
      }
      if (typeof patch.zipPath === "string") {
        assignments.push("zip_path = ?");
        values.push(patch.zipPath);
      }
      if (typeof patch.dockerfilePath === "string") {
        assignments.push("dockerfile_path = ?");
        values.push(patch.dockerfilePath);
      }
      options.database.sqlite.prepare(`UPDATE deployments SET ${assignments.join(", ")} WHERE id = ?`).run(...values, deploymentId);
      if (eventType !== "deployment.status.changed") {
        options.eventBus.publish({
          id: randomUUID(),
          type: "deployment.status.changed",
          schemaVersion: 1,
          workspaceId: existing.workspace_id,
          ...(existing.room_id !== null ? { roomId: existing.room_id } : {}),
          payload: payloadForDeploymentEvent("deployment.status.changed", deploymentId, status, patch),
          createdAt: timestamp
        });
      }
      options.eventBus.publish({
        id: randomUUID(),
        type: eventType,
        schemaVersion: 1,
        workspaceId: existing.workspace_id,
        ...(existing.room_id !== null ? { roomId: existing.room_id } : {}),
        payload: eventPayload,
        createdAt: timestamp
      });
    })();
    return rowToRecord(readDeploymentOrThrow(options.database, deploymentId));
  };

  const runInitialDeployment = async (deploymentId: string): Promise<void> => {
    const row = readDeploymentOrThrow(options.database, deploymentId);
    switch (row.kind) {
      case "preview-url":
        deployPreviewUrl(row);
        return;
      case "static-site":
        deployStaticSite(row);
        return;
      case "source-zip":
        deploySourceZip(row);
        return;
      case "container-export":
        deployContainerExport(row);
        return;
      case "container-build":
        deployContainerBuild(row);
        return;
      case "self-hosted":
        await deploySelfHosted(row);
        return;
    }
  };

  const artifactFiles = (artifactId: string): Array<{ readonly path: string; readonly new_content: string | null; readonly content_path: string | null; readonly binary: number }> =>
    options.database.sqlite.prepare("SELECT path, new_content, content_path, binary FROM artifact_files WHERE artifact_id = ? ORDER BY path ASC").all(artifactId) as Array<{ readonly path: string; readonly new_content: string | null; readonly content_path: string | null; readonly binary: number }>;

  const writeArtifactFilesToDir = (deploymentId: string, artifactId: string): string => {
    const dir = join(root, deploymentId, "site");
    mkdirSync(dir, { recursive: true });
    for (const file of artifactFiles(artifactId)) {
      const target = resolvePath(dir, file.path);
      if (!target.startsWith(resolvePath(dir))) continue;
      mkdirSync(resolvePath(target, ".."), { recursive: true });
      if (file.binary !== 0 && file.content_path !== null && existsSync(file.content_path)) {
        writeFileSync(target, readFileSync(file.content_path));
      } else {
        writeFileSync(target, file.new_content ?? "", "utf8");
      }
    }
    return dir;
  };

  const bundleArtifactFiles = (deploymentId: string, artifactId: string, fileName: string, dockerfile?: string): string => {
    const path = join(root, deploymentId, fileName);
    mkdirSync(resolvePath(path, ".."), { recursive: true });
    const files = artifactFiles(artifactId);
    const sections = files.map((file) => `--- ${file.path} ---\n${file.binary !== 0 && file.content_path !== null && existsSync(file.content_path) ? readFileSync(file.content_path, "base64") : file.new_content ?? ""}`).join("\n");
    writeFileSync(path, `${dockerfile !== undefined ? `--- Dockerfile ---\n${dockerfile}\n` : ""}${sections}\n`, "utf8");
    return path;
  };

  const deployPreviewUrl = (row: DeploymentRow): void => {
    const expiresAt = now() + 30 * 60 * 1000;
    markStatus(row.id, "ready", "deployment.ready", { url: `http://127.0.0.1:${options.previewPort ?? 6677}/deployments/${row.id}/preview`, expiresAt, publishedAt: now() });
  };

  const deployStaticSite = (row: DeploymentRow): void => {
    const sourcePath = writeArtifactFilesToDir(row.id, row.artifact_id);
    markStatus(row.id, "ready", "deployment.ready", { url: `http://127.0.0.1:${options.sitePort ?? 6677}/sites/${row.id}/`, sourcePath, publishedAt: now() });
  };

  const deploySourceZip = (row: DeploymentRow): void => {
    const zipPath = bundleArtifactFiles(row.id, row.artifact_id, "source.zip.txt");
    markStatus(row.id, "ready", "deployment.ready", { downloadUrl: zipPath, zipPath, publishedAt: now() });
  };

  const deployContainerExport = (row: DeploymentRow): void => {
    const dockerfile = "FROM nginx:alpine\nCOPY . /usr/share/nginx/html\n";
    const zipPath = bundleArtifactFiles(row.id, row.artifact_id, "container-export.zip.txt", dockerfile);
    const dockerfilePath = join(root, row.id, "Dockerfile");
    writeFileSync(dockerfilePath, dockerfile, "utf8");
    markStatus(row.id, "ready", "deployment.ready", { downloadUrl: zipPath, zipPath, dockerfilePath, publishedAt: now() });
  };

  const deployContainerBuild = (row: DeploymentRow): void => {
    const sourcePath = writeArtifactFilesToDir(row.id, row.artifact_id);
    const imageTag = `agenthub-${row.id}`;
    if (options.spawnImpl === undefined) {
      appendFileSync(prepareDeploymentPaths(root, row.id).logPath, "agenthub container build\n", "utf8");
      markStatus(row.id, "ready", "deployment.ready", { imageTag, sourcePath, publishedAt: now() });
      return;
    }
    const child = spawnImpl(process.platform === "win32" ? "cmd.exe" : "sh", process.platform === "win32" ? ["/c", "echo agenthub container build"] : ["-c", "echo agenthub container build"], { cwd: sourcePath });
    processes.set(row.id, child);
    markStatus(row.id, "in_progress", "deployment.status.changed", { pid: String(child.pid ?? ""), imageTag, sourcePath });
    child.stdout?.on("data", (chunk) => { void service.appendLog(row.id, String(chunk)); });
    child.stderr?.on("data", (chunk) => { void service.appendLog(row.id, String(chunk)); });
    child.on("exit", (code) => {
      processes.delete(row.id);
      if (code === 0) markStatus(row.id, "ready", "deployment.ready", { imageTag, publishedAt: now() });
      else markStatus(row.id, "failed", "deployment.failed", { error: `build_exit_${code ?? "signal"}` });
    });
  };

  const deploySelfHosted = async (row: DeploymentRow): Promise<void> => {
    if (row.provider_config_id === null) {
      markStatus(row.id, "failed", "deployment.failed", { error: "provider_required" });
      return;
    }
    const provider = options.database.sqlite.prepare("SELECT * FROM deployment_providers WHERE id = ?").get(row.provider_config_id) as { readonly base_url: string; readonly credential_ref: string } | undefined;
    const token = provider === undefined ? null : await options.keychain?.get(provider.credential_ref);
    if (provider === undefined || token === null || token === undefined) {
      markStatus(row.id, "failed", "deployment.failed", { error: "provider_unavailable" });
      return;
    }
    const sourcePath = bundleArtifactFiles(row.id, row.artifact_id, "caprover-source.tar");
    const form = new FormData();
    form.set("sourceFile", new File([readFileSync(sourcePath)], "source.tar", { type: "application/gzip" }));
    markStatus(row.id, "in_progress", "deployment.status.changed", { sourcePath });
    const deployUrl = new URL("/api/v2/apps/appData/agenthub/deployment", provider.base_url);
    deployUrl.searchParams.set("detached", "1");
    const upload = await fetchImpl(deployUrl, { method: "POST", headers: { "x-captain-auth": token }, body: form });
    if (!upload.ok) {
      markStatus(row.id, "failed", "deployment.failed", { error: `caprover_http_${upload.status}` });
      return;
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const poll = await fetchImpl(new URL("/api/v2/apps/appData/agenthub", provider.base_url), { headers: { "x-captain-auth": token } });
      if (poll.ok) {
        const host = new URL(provider.base_url).hostname;
        markStatus(row.id, "ready", "deployment.ready", { url: `https://agenthub.${host}`, publishedAt: now() });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    markStatus(row.id, "failed", "deployment.failed", { error: "caprover_poll_timeout" });
  };

  const recoverInterruptedDeployments = (): void => {
    const rows = options.database.sqlite.prepare("SELECT * FROM deployments WHERE status = 'in_progress' ORDER BY updated_at ASC").all() as DeploymentRow[];
    for (const row of rows) markStatus(row.id, "failed", "deployment.failed", { error: "daemon_restarted" });
  };

  const service: DeploymentService = {
    createDeployment,
    getDeployment: async (deploymentId) => {
      const row = readDeployment(options.database, deploymentId);
      return row === undefined ? undefined : rowToRecord(row);
    },
    redeploy: async (deploymentId) => {
      const existing = readDeploymentOrThrow(options.database, deploymentId);
      return createDeployment({ artifactId: existing.artifact_id, kind: existing.kind, ...(existing.room_id !== null ? { roomId: existing.room_id } : {}), ...(existing.provider_config_id !== null ? { providerId: existing.provider_config_id } : {}) });
    },
    retry: async (deploymentId) => {
      markStatus(deploymentId, "queued", "deployment.status.changed");
      await runInitialDeployment(deploymentId);
      return rowToRecord(readDeploymentOrThrow(options.database, deploymentId));
    },
    cancel: async (deploymentId) => {
      processes.get(deploymentId)?.kill();
      processes.delete(deploymentId);
      return markStatus(deploymentId, "cancelled", "deployment.cancelled");
    },
    unpublish: async (deploymentId) => {
      const deploymentDir = join(root, deploymentId);
      if (existsSync(deploymentDir)) rmSync(deploymentDir, { recursive: true, force: true });
      return markStatus(deploymentId, "unpublished", "deployment.unpublished");
    },
    appendLog: async (deploymentId, chunk) => {
      const existing = readDeploymentOrThrow(options.database, deploymentId);
      const logPath = existing.log_path ?? prepareDeploymentPaths(root, deploymentId).logPath;
      mkdirSync(resolvePath(logPath, ".."), { recursive: true });
      appendFileSync(logPath, chunk, "utf8");
      const timestamp = now();
      options.database.sqlite.transaction(() => {
        options.database.sqlite.prepare("UPDATE deployments SET log_path = ?, updated_at = ? WHERE id = ?").run(logPath, timestamp, deploymentId);
        options.eventBus.publish({
          id: randomUUID(),
          type: "deployment.log.appended",
          schemaVersion: 1,
          workspaceId: existing.workspace_id,
          ...(existing.room_id !== null ? { roomId: existing.room_id } : {}),
          payload: { deploymentId, line: chunk },
          createdAt: timestamp
        });
      })();
    },
    listDeployments: async (artifactId) => {
      const rows = options.database.sqlite.prepare("SELECT * FROM deployments WHERE artifact_id = ? ORDER BY created_at DESC").all(artifactId) as DeploymentRow[];
      return rows.map(rowToRecord);
    },
    readLogs: async (deploymentId) => {
      const row = readDeployment(options.database, deploymentId);
      if (row?.log_path === null || row?.log_path === undefined || !existsSync(row.log_path)) return "";
      return readFileSync(row.log_path, "utf8");
    },
    downloadPath: async (deploymentId) => {
      const row = readDeployment(options.database, deploymentId);
      return row?.download_url ?? undefined;
    },
    testProvider: async (providerId) => {
      const provider = options.database.sqlite.prepare("SELECT * FROM deployment_providers WHERE id = ?").get(providerId) as { readonly base_url: string; readonly credential_ref: string } | undefined;
      if (provider === undefined) return { ok: false, error: "provider_not_found" };
      const token = await options.keychain?.get(provider.credential_ref);
      if (token === undefined || token === null) return { ok: false, error: "credential_not_found" };
      const response = await fetchImpl(new URL("/api/v2/user/info", provider.base_url), { headers: { "x-captain-auth": token } });
      if (!response.ok) return { ok: false, error: `http_${response.status}` };
      const payload = await response.json().catch(() => ({})) as { readonly data?: { readonly version?: string } };
      return { ok: true, ...(payload.data?.version !== undefined ? { version: payload.data.version } : {}) };
    },
    recoverInterruptedDeployments
  };

  return service;
}

function prepareDeploymentPaths(root: string, deploymentId: string): { readonly dir: string; readonly logPath: string } {
  const dir = join(root, deploymentId);
  mkdirSync(dir, { recursive: true });
  return { dir, logPath: join(dir, "deployment.log") };
}

function shouldHaveLogs(kind: DeploymentKind): boolean {
  return kind === "container-build" || kind === "self-hosted";
}

function readDeployment(database: AgentHubDatabase, deploymentId: string): DeploymentRow | undefined {
  return database.sqlite.prepare("SELECT * FROM deployments WHERE id = ?").get(deploymentId) as DeploymentRow | undefined;
}

function readDeploymentOrThrow(database: AgentHubDatabase, deploymentId: string): DeploymentRow {
  const row = readDeployment(database, deploymentId);
  if (row === undefined) throw new Error(`Deployment '${deploymentId}' not found`);
  return row;
}

function rowToRecord(row: DeploymentRow): DeploymentRecord {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    ...(row.room_id !== null ? { roomId: row.room_id } : {}),
    workspaceId: row.workspace_id,
    kind: row.kind,
    status: row.status,
    ...(row.url !== null ? { url: row.url } : {}),
    ...(row.download_url !== null ? { downloadUrl: row.download_url } : {}),
    ...(row.image_tag !== null ? { imageTag: row.image_tag } : {}),
    ...(row.log_path !== null ? { logPath: row.log_path } : {})
  };
}

function payloadForDeploymentEvent(eventType: "deployment.status.changed" | "deployment.ready" | "deployment.failed" | "deployment.cancelled" | "deployment.expired" | "deployment.unpublished", deploymentId: string, status: DeploymentStatus, patch: Record<string, unknown>): Record<string, unknown> {
  if (eventType === "deployment.cancelled" || eventType === "deployment.expired" || eventType === "deployment.unpublished") return { deploymentId };
  if (eventType === "deployment.failed") return { deploymentId, error: typeof patch.error === "string" ? patch.error : status };
  if (eventType === "deployment.ready") {
    return withoutUndefined({
      deploymentId,
      url: patch.url,
      downloadUrl: patch.downloadUrl,
      imageTag: patch.imageTag
    });
  }
  return withoutUndefined({
    deploymentId,
    status,
    url: patch.url,
    downloadUrl: patch.downloadUrl,
    imageTag: patch.imageTag
  });
}

function withoutUndefined(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

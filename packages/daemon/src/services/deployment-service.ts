import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { gzipSync } from "node:zlib";

import { ZipArchive } from "archiver";

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
  readonly expirePreviewDeployments: () => void;
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
  readonly commandProbe?: (command: "nixpacks" | "docker") => boolean | Promise<boolean>;
  readonly authorizeBuild?: (input: { readonly deploymentId: string; readonly workspaceId: string; readonly command: string }) => Promise<"allow" | "deny"> | "allow" | "deny";
  readonly capRoverPollIntervalMs?: number;
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
  readonly artifact_version: number | null;
  readonly room_id: string | null;
  readonly workspace_id: string;
  readonly kind: DeploymentKind;
  readonly status: DeploymentStatus;
  readonly url: string | null;
  readonly download_url: string | null;
  readonly image_tag: string | null;
  readonly log_path: string | null;
  readonly pid: string | null;
  readonly zip_path: string | null;
  readonly dockerfile_path: string | null;
  readonly provider_config_id: string | null;
  readonly expires_at?: number | null;
};

type ArtifactFile = { readonly path: string; readonly new_content: string | null; readonly content_path: string | null; readonly binary: number };

export function createDeploymentService(options: DeploymentServiceOptions): DeploymentService {
  const now = options.now ?? Date.now;
  const workspaceRoot = resolvePath(options.deploymentRoot ?? process.cwd());
  const root = join(workspaceRoot, ".agenthub", "deployments");
  const sitesRoot = join(workspaceRoot, ".agenthub", "sites");
  const exportsRoot = join(workspaceRoot, ".agenthub", "exports");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const spawnImpl = options.spawnImpl ?? spawn;
  const capRoverPollIntervalMs = options.capRoverPollIntervalMs ?? 3_000;
  const processes = new Map<string, ChildProcess>();

  const createDeployment = async (input: CreateDeploymentInput): Promise<DeploymentRecord> => {
    const artifact = options.database.sqlite.prepare("SELECT id, workspace_id, room_id, kind, title FROM artifacts WHERE id = ? AND deleted_at IS NULL").get(input.artifactId) as ArtifactRow | undefined;
    if (artifact === undefined) throw new Error(`Artifact '${input.artifactId}' not found`);
    const deploymentId = randomUUID();
    const roomId = input.roomId ?? artifact.room_id ?? undefined;
    const createdAt = now();
    const paths = prepareDeploymentPaths(root, deploymentId);
    const initialKind = input.kind;
    const artifactVersion = latestArtifactVersion(options.database, artifact.id);
    options.database.sqlite.transaction(() => {
      options.database.sqlite.prepare(
        `INSERT INTO deployments (
          id, artifact_id, artifact_version, room_id, workspace_id, kind, provider, status, provider_config_id,
          log_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
      ).run(
        deploymentId,
        artifact.id,
        artifactVersion,
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
        options.database.sqlite.prepare("UPDATE rooms SET last_activity_at = ?, updated_at = ? WHERE id = ?").run(createdAt, createdAt, roomId);
        options.database.sqlite
          .prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'system', 'deployment', NULL, 'system', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)")
          .run(messageId, artifact.workspace_id, roomId, createdAt, createdAt);
        options.eventBus.publish({
          id: randomUUID(),
          type: "message.created",
          schemaVersion: 1,
          workspaceId: artifact.workspace_id,
          roomId,
          payload: { messageId, senderType: "system", senderId: "deployment", role: "system", status: "completed", text: "" },
          createdAt
        });
        const part = {
          type: "card",
          card: {
            type: "deployment",
            deploymentId,
            artifactId: artifact.id,
            kind: initialKind,
            provider: input.providerId !== undefined ? "caprover" : "agenthub-local",
            status: "queued"
          }
        };
        options.database.sqlite
          .prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'card', ?, ?)")
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
    if (existing.status === "cancelled" && status !== "cancelled") return rowToRecord(existing);
    const timestamp = now();
    const nextKind = typeof patch.kind === "string" ? patch.kind as DeploymentKind : existing.kind;
    const eventPayload = payloadForDeploymentEvent(eventType, deploymentId, status, { ...patch, kind: nextKind });
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
      if (typeof patch.kind === "string") {
        assignments.push("kind = ?");
        values.push(patch.kind);
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
      if (typeof patch.providerResourceId === "string") {
        assignments.push("provider_resource_id = ?");
        values.push(patch.providerResourceId);
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
          payload: payloadForDeploymentEvent("deployment.status.changed", deploymentId, status, { ...patch, kind: nextKind }),
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
        await deploySourceZip(row);
        return;
      case "container-export":
        await deployContainerExport(row);
        return;
      case "container-build":
        await deployContainerBuild(row);
        return;
      case "self-hosted":
        await deploySelfHosted(row);
        return;
    }
  };

  const artifactFiles = (artifactId: string): ArtifactFile[] =>
    options.database.sqlite.prepare("SELECT path, new_content, content_path, binary FROM artifact_files WHERE artifact_id = ? ORDER BY path ASC").all(artifactId) as ArtifactFile[];

  const writeArtifactFilesToDir = (deploymentId: string, artifactId: string): string => {
    const dir = join(root, deploymentId, "site");
    return writeArtifactFilesToTargetDir(dir, artifactId);
  };

  const writeStaticSiteFilesToDir = (deploymentId: string, artifactId: string): string => {
    const dir = join(sitesRoot, deploymentId);
    return writeArtifactFilesToTargetDir(dir, artifactId);
  };

  const writeArtifactFilesToTargetDir = (dir: string, artifactId: string): string => {
    mkdirSync(dir, { recursive: true });
    for (const file of artifactFiles(artifactId)) {
      const target = resolvePath(dir, file.path);
      if (!pathInside(target, dir)) continue;
      mkdirSync(resolvePath(target, ".."), { recursive: true });
      if (file.binary !== 0 && file.content_path !== null && existsSync(file.content_path)) {
        writeFileSync(target, readFileSync(file.content_path));
      } else {
        writeFileSync(target, file.new_content ?? "", "utf8");
      }
    }
    return dir;
  };

  const bundleArtifactFiles = async (artifactId: string, zipPath: string, dockerfile?: string): Promise<string> => {
    await writeZipArchive(zipPath, archiveEntries(artifactFiles(artifactId), dockerfile));
    return zipPath;
  };

  const deployPreviewUrl = (row: DeploymentRow): void => {
    const expiresAt = now() + 30 * 60 * 1000;
    const sourcePath = writeArtifactFilesToDir(row.id, row.artifact_id);
    const token = randomUUID();
    markStatus(row.id, "ready", "deployment.ready", { url: `http://127.0.0.1:${options.previewPort ?? 6677}/preview/${token}`, sourcePath, expiresAt, publishedAt: now(), providerResourceId: token });
  };

  const deployStaticSite = (row: DeploymentRow): void => {
    const sourcePath = writeStaticSiteFilesToDir(row.id, row.artifact_id);
    markStatus(row.id, "ready", "deployment.ready", { url: `http://127.0.0.1:${options.sitePort ?? 6677}/sites/${row.id}/`, sourcePath, publishedAt: now() });
  };

  const deploySourceZip = async (row: DeploymentRow): Promise<void> => {
    const artifactVersion = row.artifact_version ?? latestArtifactVersion(options.database, row.artifact_id) ?? 1;
    const zipPath = await bundleArtifactFiles(row.artifact_id, join(exportsRoot, `${row.artifact_id}-v${artifactVersion}.zip`));
    markStatus(row.id, "ready", "deployment.ready", { downloadUrl: deploymentDownloadUrl(row.id), zipPath, publishedAt: now() });
  };

  const deployContainerExport = async (row: DeploymentRow, patch: Record<string, unknown> = {}): Promise<void> => {
    const dockerfile = dockerfileForArtifact(artifactForDeployment(options.database, row.artifact_id)?.kind ?? null, artifactFiles(row.artifact_id));
    const zipPath = await bundleArtifactFiles(row.artifact_id, join(exportsRoot, `${row.artifact_id}-build-context.zip`), dockerfile);
    const dockerfilePath = join(exportsRoot, `${row.artifact_id}-Dockerfile`);
    mkdirSync(resolvePath(dockerfilePath, ".."), { recursive: true });
    writeFileSync(dockerfilePath, dockerfile, "utf8");
    markStatus(row.id, "ready", "deployment.ready", { ...patch, downloadUrl: deploymentDownloadUrl(row.id), zipPath, dockerfilePath, publishedAt: now() });
  };

  const deployContainerBuild = async (row: DeploymentRow): Promise<void> => {
    const sourcePath = writeArtifactFilesToDir(row.id, row.artifact_id);
    const imageTag = `agenthub-${row.id}`;
    const buildTool = await detectBuildTool(options.commandProbe);
    if (buildTool === undefined) {
      await deployContainerExport({ ...row, kind: "container-export" }, { kind: "container-export", error: "container_build_tools_missing" });
      return;
    }
    const command = buildTool === "nixpacks" ? "nixpacks" : "docker";
    const args = buildTool === "nixpacks" ? ["build", sourcePath, "--name", imageTag] : ["build", "-t", imageTag, sourcePath];
    const decision = await options.authorizeBuild?.({ deploymentId: row.id, workspaceId: row.workspace_id, command: `${command} ${args.join(" ")}` });
    if (decision === "deny") {
      markStatus(row.id, "failed", "deployment.failed", { error: "permission_denied" });
      return;
    }
    const child = spawnImpl(command, args, { cwd: sourcePath });
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
    const artifact = artifactForDeployment(options.database, row.artifact_id);
    const appName = appNameFor(artifact?.kind ?? row.kind, row.artifact_id);
    const dockerfile = "FROM nginx:alpine\nCOPY . /usr/share/nginx/html\n";
    const captainDefinition = JSON.stringify({ schemaVersion: 2, dockerfilePath: "./Dockerfile" }, null, 2);
    const sourcePath = join(root, row.id, "caprover-source.tar.gz");
    mkdirSync(resolvePath(sourcePath, ".."), { recursive: true });
    writeFileSync(sourcePath, createTarGz(archiveEntries(artifactFiles(row.artifact_id), dockerfile, captainDefinition)));
    const form = new FormData();
    form.set("sourceFile", new File([readFileSync(sourcePath)], "source.tar.gz", { type: "application/gzip" }));
    markStatus(row.id, "in_progress", "deployment.status.changed", { sourcePath });
    if (isCancelled(options.database, row.id)) return;
    const deployUrl = new URL(`/api/v2/user/apps/appData/${appName}`, provider.base_url);
    deployUrl.searchParams.set("detached", "1");
    const upload = await fetchImpl(deployUrl, { method: "POST", headers: { "x-captain-auth": token }, body: form });
    if (isCancelled(options.database, row.id)) return;
    if (!upload.ok) {
      markStatus(row.id, "failed", "deployment.failed", { error: `caprover_http_${upload.status}` });
      return;
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (isCancelled(options.database, row.id)) return;
      const poll = await fetchImpl(new URL(`/api/v2/user/apps/appData/${appName}`, provider.base_url), { headers: { "x-captain-auth": token } });
      if (isCancelled(options.database, row.id)) return;
      if (poll.ok) {
        const payload = await poll.json().catch(() => ({})) as { readonly data?: { readonly appDefinition?: { readonly customDomain?: unknown; readonly deployedVersion?: unknown }; readonly customDomain?: unknown; readonly appName?: unknown } };
        if (!hasCapRoverDeployedVersion(payload)) {
          await sleep(capRoverPollIntervalMs);
          continue;
        }
        markStatus(row.id, "ready", "deployment.ready", { url: capRoverUrl(provider.base_url, appName, payload), publishedAt: now() });
        return;
      }
      await sleep(capRoverPollIntervalMs);
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
      const existing = readDeploymentOrThrow(options.database, deploymentId);
      if (existing.status !== "failed") throw new Error("retry_requires_failed");
      markStatus(deploymentId, "queued", "deployment.status.changed");
      await runInitialDeployment(deploymentId);
      return rowToRecord(readDeploymentOrThrow(options.database, deploymentId));
    },
    cancel: async (deploymentId) => {
      const existing = readDeploymentOrThrow(options.database, deploymentId);
      if (existing.status !== "queued" && existing.status !== "in_progress") throw new Error("cancel_requires_active");
      const child = processes.get(deploymentId);
      if (child !== undefined) child.kill();
      else killPersistedPid(existing.pid);
      processes.delete(deploymentId);
      return markStatus(deploymentId, "cancelled", "deployment.cancelled");
    },
    unpublish: async (deploymentId) => {
      const existing = readDeploymentOrThrow(options.database, deploymentId);
      if (existing.kind !== "static-site" && existing.kind !== "self-hosted") throw new Error("unpublish_not_supported");
      const publishDir = existing.kind === "static-site" ? join(sitesRoot, deploymentId) : join(root, deploymentId);
      if (existsSync(publishDir)) rmSync(publishDir, { recursive: true, force: true });
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
      return row?.zip_path ?? row?.dockerfile_path ?? undefined;
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
    recoverInterruptedDeployments,
    expirePreviewDeployments: () => {
      const timestamp = now();
      const rows = options.database.sqlite.prepare("SELECT * FROM deployments WHERE kind = 'preview-url' AND status = 'ready' AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at ASC").all(timestamp) as DeploymentRow[];
      for (const row of rows) markStatus(row.id, "expired", "deployment.expired");
    }
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

function artifactForDeployment(database: AgentHubDatabase, artifactId: string): ArtifactRow | undefined {
  return database.sqlite.prepare("SELECT id, workspace_id, room_id, kind, title FROM artifacts WHERE id = ? AND deleted_at IS NULL").get(artifactId) as ArtifactRow | undefined;
}

function latestArtifactVersion(database: AgentHubDatabase, artifactId: string): number | null {
  const row = database.sqlite.prepare("SELECT MAX(version) AS version FROM artifact_versions WHERE artifact_id = ?").get(artifactId) as { readonly version: number | null } | undefined;
  return row?.version ?? null;
}

function killPersistedPid(pid: string | null): void {
  if (pid === null || !/^\d+$/u.test(pid)) return;
  try {
    process.kill(Number(pid));
  } catch {
    // The persisted process may already be gone after daemon restart.
  }
}

function deploymentDownloadUrl(deploymentId: string): string {
  return `/deployments/${deploymentId}/download`;
}

function pathInside(target: string, parent: string): boolean {
  const parentPath = resolvePath(parent);
  const relativePath = relative(parentPath, target);
  return relativePath.length === 0 || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isCancelled(database: AgentHubDatabase, deploymentId: string): boolean {
  const row = database.sqlite.prepare("SELECT status FROM deployments WHERE id = ?").get(deploymentId) as { readonly status: string } | undefined;
  return row?.status === "cancelled";
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
      kind: patch.kind,
      url: patch.url,
      downloadUrl: patch.downloadUrl,
      imageTag: patch.imageTag,
      expiresAt: patch.expiresAt
    });
  }
  return withoutUndefined({
    deploymentId,
    status,
    kind: patch.kind,
    url: patch.url,
    downloadUrl: patch.downloadUrl,
    imageTag: patch.imageTag,
    expiresAt: patch.expiresAt
  });
}

function withoutUndefined(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function archiveEntries(files: readonly ArtifactFile[], dockerfile?: string, captainDefinition?: string): Array<{ readonly name: string; readonly data: Buffer }> {
  const entries = files.map((file) => ({
    name: safeArchiveName(file.path),
    data: file.binary !== 0 && file.content_path !== null && existsSync(file.content_path) ? readFileSync(file.content_path) : Buffer.from(file.new_content ?? "", "utf8")
  }));
  if (dockerfile !== undefined) entries.push({ name: "Dockerfile", data: Buffer.from(dockerfile, "utf8") });
  if (captainDefinition !== undefined) entries.push({ name: "captain-definition.json", data: Buffer.from(captainDefinition, "utf8") });
  return entries;
}

function safeArchiveName(path: string): string {
  const normalized = path.replaceAll("\\", "/").split("/").filter((part) => part.length > 0 && part !== "." && part !== "..").join("/");
  return normalized.length > 0 ? normalized : "index.html";
}

function writeZipArchive(path: string, entries: readonly { readonly name: string; readonly data: Buffer }[]): Promise<void> {
  mkdirSync(resolvePath(path, ".."), { recursive: true });
  return new Promise((resolve, reject) => {
    const output = createWriteStream(path);
    const archive = new ZipArchive({ store: true });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("warning", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const entry of entries) archive.append(entry.data, { name: entry.name });
    void archive.finalize();
  });
}

function dockerfileForArtifact(kind: string | null, files: readonly ArtifactFile[]): string {
  if (kind === "source_code") return sourceCodeDockerfile(primaryExtension(files));
  if (kind === "generic_file") return genericDockerfile();
  if (kind === "document") return documentDockerfile(files);
  return staticDockerfile(files);
}

function primaryExtension(files: readonly ArtifactFile[]): string {
  return extname(files[0]?.path ?? "").toLowerCase();
}

function sourceCodeDockerfile(extension: string): string {
  if (extension === ".py") {
    return [
      "FROM python:3.11-slim",
      "WORKDIR /app",
      "COPY . /app",
      "CMD [\"python\", \"main.py\"]",
      ""
    ].join("\n");
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs" || extension === ".ts") {
    return [
      "FROM node:20-alpine",
      "WORKDIR /app",
      "COPY . /app",
      "CMD [\"node\", \"index.js\"]",
      ""
    ].join("\n");
  }
  return genericDockerfile();
}

function genericDockerfile(): string {
  return [
    "FROM ubuntu:22.04",
    "WORKDIR /app",
    "COPY . /app",
    "CMD [\"bash\", \"-lc\", \"ls -la /app && sleep infinity\"]",
    ""
  ].join("\n");
}

function documentDockerfile(files: readonly ArtifactFile[]): string {
  return [
    "FROM nginx:alpine",
    ...files.map((file) => `COPY ${dockerPath(file.path)} /usr/share/nginx/html/${dockerPath(file.path)}`),
    "RUN printf '<!doctype html><meta charset=\"utf-8\"><pre id=\"content\"></pre><script>fetch(\"README.md\").then(r=>r.text()).then(t=>content.textContent=t)</script>' > /usr/share/nginx/html/index.html",
    "EXPOSE 80",
    ""
  ].join("\n");
}

function staticDockerfile(files: readonly ArtifactFile[]): string {
  return [
    "FROM nginx:alpine",
    ...files.map((file) => `COPY ${dockerPath(file.path)} /usr/share/nginx/html/${dockerPath(file.path)}`),
    "EXPOSE 80",
    ""
  ].join("\n");
}

function dockerPath(path: string): string {
  return safeArchiveName(path).replace(/(["\\$`])/gu, "\\$1");
}

function createTarGz(entries: readonly { readonly name: string; readonly data: Buffer }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name.slice(0, 100), 0, "utf8");
    header.write("0000644\0", 100, "ascii");
    header.write("0000000\0", 108, "ascii");
    header.write("0000000\0", 116, "ascii");
    header.write(entry.data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, "ascii");
    header.fill(0x20, 148, 156);
    header.write("0", 156, "ascii");
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
    blocks.push(header, entry.data);
    const padding = (512 - (entry.data.length % 512)) % 512;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

async function detectBuildTool(probe?: DeploymentServiceOptions["commandProbe"]): Promise<"nixpacks" | "docker" | undefined> {
  if (await commandExists("nixpacks", probe)) return "nixpacks";
  if (await commandExists("docker", probe)) return "docker";
  return undefined;
}

async function commandExists(command: "nixpacks" | "docker", probe?: DeploymentServiceOptions["commandProbe"]): Promise<boolean> {
  if (probe !== undefined) return await probe(command);
  try {
    if (process.platform === "win32") execFileSync("where.exe", [command], { stdio: "ignore", timeout: 2_000 });
    else execFileSync("command", ["-v", command], { stdio: "ignore", timeout: 2_000, shell: true });
    return true;
  } catch {
    return false;
  }
}

function appNameFor(kind: string, artifactId: string): string {
  return `${kind}-${artifactId.slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9-]/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "");
}

function hasCapRoverDeployedVersion(payload: { readonly data?: { readonly appDefinition?: { readonly deployedVersion?: unknown }; readonly deployedVersion?: unknown } }): boolean {
  const deployedVersion = payload.data?.appDefinition?.deployedVersion ?? payload.data?.deployedVersion;
  return typeof deployedVersion === "string" && deployedVersion.length > 0;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function capRoverUrl(baseUrl: string, appName: string, payload: { readonly data?: { readonly appDefinition?: { readonly customDomain?: unknown }; readonly customDomain?: unknown } }): string {
  const domain = firstDomain(payload.data?.appDefinition?.customDomain) ?? firstDomain(payload.data?.customDomain);
  if (domain !== undefined) return domain.startsWith("http://") || domain.startsWith("https://") ? domain : `https://${domain}`;
  return `https://${appName}.${new URL(baseUrl).hostname}`;
}

function firstDomain(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string" && item.length > 0);
  return undefined;
}

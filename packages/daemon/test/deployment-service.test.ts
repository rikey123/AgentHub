import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { EventEmitter } from "node:events";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createDeploymentService } from "../src/services/deployment-service.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let now = 10_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-deployment-service-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  seedArtifact();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  now = 10_000;
});

describe("DeploymentService", () => {
  test("createDeployment writes deployment, deployment.created, message part, and message.part.added in one call", async () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir() });

    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "preview-url", roomId: "room_1" });

    expect(deployment).toMatchObject({ artifactId: "artifact_1", kind: "preview-url", status: "ready" });
    expect(currentDatabase().sqlite.prepare("SELECT artifact_id, artifact_version, kind, status FROM deployments WHERE id = ?").get(deployment.id)).toMatchObject({ artifact_id: "artifact_1", artifact_version: 2, kind: "preview-url", status: "ready" });
    expect(currentDatabase().sqlite.prepare("SELECT last_activity_at FROM rooms WHERE id = 'room_1'").get()).toMatchObject({ last_activity_at: now });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'deployment.created' AND json_extract(payload, '$.deploymentId') = ?").get(deployment.id)).toMatchObject({ count: 1 });
    const createdMessage = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = 'message.created' AND json_extract(payload, '$.senderId') = 'deployment' ORDER BY seq DESC LIMIT 1").get() as { readonly payload: string } | undefined;
    expect(JSON.parse(createdMessage?.payload ?? "{}")).toMatchObject({ senderType: "system", senderId: "deployment", role: "system", status: "completed" });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'message.part.added' AND json_extract(payload, '$.part.card.deploymentId') = ?").get(deployment.id)).toMatchObject({ count: 1 });
    const part = currentDatabase().sqlite.prepare("SELECT part_type, payload FROM message_parts WHERE json_extract(payload, '$.card.deploymentId') = ?").get(deployment.id) as { readonly part_type: string; readonly payload: string } | undefined;
    expect(part).toBeDefined();
    expect(part?.part_type).toBe("card");
    expect(JSON.parse(part?.payload ?? "{}")).toMatchObject({
      type: "card",
      card: { type: "deployment", deploymentId: deployment.id, artifactId: "artifact_1", kind: "preview-url", status: "queued" }
    });
  });

  test("appendLog persists log_path text and publishes ephemeral log lines", async () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir() });
    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "container-build", roomId: "room_1" });
    const seen: string[] = [];
    const unsubscribe = currentBus().subscribe("deployment.log.appended", (event) => {
      if (event.type === "deployment.log.appended") seen.push(String((event.payload as { readonly line?: string }).line ?? ""));
    });

    await service.appendLog(deployment.id, "building\n");
    unsubscribe();

    const row = currentDatabase().sqlite.prepare("SELECT log_path FROM deployments WHERE id = ?").get(deployment.id) as { readonly log_path: string };
    expect(readFileSync(row.log_path, "utf8")).toContain("building\n");
    expect(seen).toEqual(["building\n"]);
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'deployment.log.appended'").get()).toMatchObject({ count: 0 });
  });

  test("CapRover testConnection uses x-captain-auth header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { version: "1.0.0" } }), { status: 200, headers: { "content-type": "application/json" } }));
    const keychain = { get: vi.fn(async () => "captain-token"), set: vi.fn(), delete: vi.fn() };
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, keychain, fetchImpl: fetchMock, deploymentRoot: currentTempDir() });
    currentDatabase().sqlite.prepare("INSERT INTO deployment_providers (id, workspace_id, kind, name, base_url, credential_ref, created_at, updated_at) VALUES ('provider_1', 'ws_1', 'caprover', 'CapRover', 'https://captain.example', 'secret_ref', ?, ?)").run(now, now);

    await expect(service.testProvider("provider_1")).resolves.toMatchObject({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(new URL("https://captain.example/api/v2/user/info"), expect.objectContaining({ headers: expect.objectContaining({ "x-captain-auth": "captain-token" }) }));
  });

  test("preview-url deployment becomes ready with a 30 minute expiry URL", async () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir(), previewPort: 7777 });

    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "preview-url", roomId: "room_1" });

    expect(deployment).toMatchObject({ status: "ready", url: expect.stringContaining("/preview/") });
    expect(deployment.url).not.toContain(deployment.id);
    const row = currentDatabase().sqlite.prepare("SELECT status, url, provider_resource_id, expires_at FROM deployments WHERE id = ?").get(deployment.id);
    expect(row).toMatchObject({ status: "ready", provider_resource_id: expect.any(String), expires_at: now + 30 * 60 * 1000 });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'deployment.ready' AND json_extract(payload, '$.deploymentId') = ?").get(deployment.id)).toMatchObject({ count: 1 });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'deployment.ready' AND json_extract(payload, '$.expiresAt') = ?").get(now + 30 * 60 * 1000)).toMatchObject({ count: 1 });
  });

  test("static-site, source-zip, and container-export write downloadable files", async () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir(), sitePort: 8888 });

    const staticSite = await service.createDeployment({ artifactId: "artifact_1", kind: "static-site", roomId: "room_1" });
    const sourceZip = await service.createDeployment({ artifactId: "artifact_1", kind: "source-zip", roomId: "room_1" });
    const containerExport = await service.createDeployment({ artifactId: "artifact_1", kind: "container-export", roomId: "room_1" });

    expect(staticSite).toMatchObject({ status: "ready", url: expect.stringContaining(`/sites/${staticSite.id}/`) });
    expect(sourceZip.downloadUrl).toBe(`/deployments/${sourceZip.id}/download`);
    expect(containerExport.downloadUrl).toBe(`/deployments/${containerExport.id}/download`);
    expect(readZipEntries(await service.downloadPath(sourceZip.id) ?? "")).toContain("index.html");
    const dockerExport = await service.downloadPath(containerExport.id);
    expect(readZipEntries(dockerExport ?? "")).toEqual(expect.arrayContaining(["index.html", "Dockerfile"]));
    expect(readZipEntry(dockerExport ?? "", "Dockerfile")?.toString("utf8")).toContain("FROM nginx:alpine");
    expect(currentDatabase().sqlite.prepare("SELECT download_url, zip_path FROM deployments WHERE id = ?").get(sourceZip.id)).toMatchObject({
      download_url: `/deployments/${sourceZip.id}/download`,
      zip_path: join(currentTempDir(), ".agenthub", "exports", "artifact_1-v2.zip")
    });
  });

  test("static-site writes artifact files under workspace .agenthub/sites", async () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir(), sitePort: 8888 });

    const staticSite = await service.createDeployment({ artifactId: "artifact_1", kind: "static-site", roomId: "room_1" });

    const expectedSitePath = join(currentTempDir(), ".agenthub", "sites", staticSite.id, "index.html");
    expect(readFileSync(expectedSitePath, "utf8")).toBe("<h1>Hello</h1>");
    expect(existsSync(join(currentTempDir(), ".agenthub", "deployments", staticSite.id, "site", "index.html"))).toBe(false);
    expect(currentDatabase().sqlite.prepare("SELECT source_path FROM deployments WHERE id = ?").get(staticSite.id)).toMatchObject({
      source_path: join(currentTempDir(), ".agenthub", "sites", staticSite.id)
    });
  });

  test("source-zip and container-export produce valid zip archives with artifact entries", async () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir(), sitePort: 8888 });

    const sourceZip = await service.createDeployment({ artifactId: "artifact_1", kind: "source-zip", roomId: "room_1" });
    const containerExport = await service.createDeployment({ artifactId: "artifact_1", kind: "container-export", roomId: "room_1" });

    const sourcePath = await service.downloadPath(sourceZip.id);
    const containerPath = await service.downloadPath(containerExport.id);
    expect(sourcePath).toBeDefined();
    expect(containerPath).toBeDefined();
    expect(readZipEntries(sourcePath ?? "")).toContain("index.html");
    expect(readZipEntries(containerPath ?? "")).toEqual(expect.arrayContaining(["index.html", "Dockerfile"]));
  });

  test("source-zip packages text and content_path artifact files into workspace exports zip", async () => {
    const binaryPath = join(currentTempDir(), "image.bin");
    writeFileSync(binaryPath, Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    currentDatabase().sqlite.prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_path, binary, no_newline_at_end, old_sha256, new_sha256, applied_state, content_path, created_at) VALUES ('artifact_1', 'assets/image.bin', NULL, NULL, NULL, 0, 0, 'added', NULL, 1, 0, NULL, NULL, NULL, ?, 1)").run(binaryPath);
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir() });

    const sourceZip = await service.createDeployment({ artifactId: "artifact_1", kind: "source-zip", roomId: "room_1" });

    const zipPath = await service.downloadPath(sourceZip.id);
    expect(zipPath).toBe(join(currentTempDir(), ".agenthub", "exports", "artifact_1-v2.zip"));
    expect(readZipEntry(zipPath ?? "", "index.html")?.toString("utf8")).toBe("<h1>Hello</h1>");
    expect(readZipEntry(zipPath ?? "", "assets/image.bin")).toEqual(Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    expect(sourceZip.downloadUrl).toBe(`/deployments/${sourceZip.id}/download`);
  });

  test("container-export writes Dockerfile and build context zip into workspace exports", async () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir() });

    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "container-export", roomId: "room_1" });

    const expectedZip = join(currentTempDir(), ".agenthub", "exports", "artifact_1-build-context.zip");
    const expectedDockerfile = join(currentTempDir(), ".agenthub", "exports", "artifact_1-Dockerfile");
    expect(await service.downloadPath(deployment.id)).toBe(expectedZip);
    expect(readZipEntries(expectedZip)).toEqual(expect.arrayContaining(["index.html", "Dockerfile"]));
    expect(readFileSync(expectedDockerfile, "utf8")).toContain("FROM nginx:alpine");
    expect(currentDatabase().sqlite.prepare("SELECT zip_path, dockerfile_path FROM deployments WHERE id = ?").get(deployment.id)).toMatchObject({
      zip_path: expectedZip,
      dockerfile_path: expectedDockerfile
    });
  });

  test("container-export generates artifact-kind-specific Dockerfile templates", async () => {
    currentDatabase().sqlite.prepare("INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES ('artifact_doc', 'ws_1', 'room_1', NULL, NULL, NULL, 'document', 'document', 'Doc', 'ready', 'agent_1', '{}', 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_path, binary, no_newline_at_end, old_sha256, new_sha256, applied_state, content_path, created_at) VALUES ('artifact_doc', 'README.md', NULL, '# Hello', NULL, 1, 0, 'added', NULL, 0, 0, NULL, NULL, NULL, NULL, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO artifact_versions (id, artifact_id, version, content, storage_path, content_encoding, metadata, created_at, created_by, message) VALUES ('artifact_doc_v1', 'artifact_doc', 1, '# Hello', NULL, 'text', '{}', 1, 'agent_1', 'current')").run();
    currentDatabase().sqlite.prepare("INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES ('artifact_py', 'ws_1', 'room_1', NULL, NULL, NULL, 'file', 'source_code', 'Script', 'ready', 'agent_1', '{}', 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_path, binary, no_newline_at_end, old_sha256, new_sha256, applied_state, content_path, created_at) VALUES ('artifact_py', 'main.py', NULL, 'print(\"hello\")', NULL, 1, 0, 'added', NULL, 0, 0, NULL, NULL, NULL, NULL, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO artifact_versions (id, artifact_id, version, content, storage_path, content_encoding, metadata, created_at, created_by, message) VALUES ('artifact_py_v1', 'artifact_py', 1, 'print(\"hello\")', NULL, 'text', '{}', 1, 'agent_1', 'current')").run();
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir(), sitePort: 8888 });

    const documentExport = await service.createDeployment({ artifactId: "artifact_doc", kind: "container-export", roomId: "room_1" });
    const pythonExport = await service.createDeployment({ artifactId: "artifact_py", kind: "container-export", roomId: "room_1" });

    const documentDockerfile = readZipEntry(await service.downloadPath(documentExport.id) ?? "", "Dockerfile")?.toString("utf8");
    const pythonDockerfile = readZipEntry(await service.downloadPath(pythonExport.id) ?? "", "Dockerfile")?.toString("utf8");
    expect(documentDockerfile).toContain("COPY README.md /usr/share/nginx/html/README.md");
    expect(documentDockerfile).toContain("RUN printf");
    expect(pythonDockerfile).toContain("FROM python:3.11-slim");
    expect(pythonDockerfile).toContain("CMD [\"python\", \"main.py\"]");
  });

  test("self-hosted CapRover upload sends spec path, artifact-kind app name, and real tar.gz content", async () => {
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      calls.push({ url, ...(init !== undefined ? { init } : {}) });
      if (url.includes("/api/v2/user/apps/appData/web-page-artifact?detached=1")) return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/api/v2/user/apps/appData/web-page-artifact")) return new Response(JSON.stringify({ data: { appDefinition: { deployedVersion: "v1", customDomain: ["app.example.com"] } } }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    });
    const keychain = { get: vi.fn(async () => "captain-token"), set: vi.fn(), delete: vi.fn() };
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, keychain, fetchImpl: fetchMock, deploymentRoot: currentTempDir() });
    currentDatabase().sqlite.prepare("INSERT INTO deployment_providers (id, workspace_id, kind, name, base_url, credential_ref, created_at, updated_at) VALUES ('provider_1', 'ws_1', 'caprover', 'CapRover', 'https://captain.example', 'secret_ref', ?, ?)").run(now, now);

    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "self-hosted", roomId: "room_1", providerId: "provider_1" });

    expect(deployment).toMatchObject({ status: "ready", url: "https://app.example.com" });
    const upload = calls.find((call) => call.url.includes("?detached=1"));
    expect(upload?.url).toBe("https://captain.example/api/v2/user/apps/appData/web-page-artifact?detached=1");
    expect(upload?.init?.headers).toMatchObject({ "x-captain-auth": "captain-token" });
    const sourceFile = (upload?.init?.body as FormData | undefined)?.get("sourceFile");
    expect(sourceFile).toBeInstanceOf(File);
    const tarball = Buffer.from(await (sourceFile as File).arrayBuffer());
    expect(tarball.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(readTarEntries(gunzipSync(tarball))).toEqual(expect.arrayContaining(["index.html", "Dockerfile", "captain-definition.json"]));
  });

  test("container-build fallback updates kind transactionally and includes final kind in deployment events", async () => {
    const service = createDeploymentService({
      database: currentDatabase(),
      eventBus: currentBus(),
      now: () => now,
      deploymentRoot: currentTempDir(),
      commandProbe: () => false
    });

    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "container-build", roomId: "room_1" });

    expect(deployment).toMatchObject({ kind: "container-export", status: "ready" });
    const fallbackRow = currentDatabase().sqlite.prepare("SELECT kind, status, last_error FROM deployments WHERE id = ?").get(deployment.id);
    expect(fallbackRow).toMatchObject({ kind: "container-export", status: "ready", last_error: "container_build_tools_missing" });
    const statusChanged = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = 'deployment.status.changed' AND json_extract(payload, '$.deploymentId') = ? ORDER BY seq DESC LIMIT 1").get(deployment.id) as { readonly payload: string };
    const ready = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = 'deployment.ready' AND json_extract(payload, '$.deploymentId') = ? ORDER BY seq DESC LIMIT 1").get(deployment.id) as { readonly payload: string };
    expect(JSON.parse(statusChanged.payload)).toMatchObject({ deploymentId: deployment.id, status: "ready", kind: "container-export" });
    expect(JSON.parse(ready.payload)).toMatchObject({ deploymentId: deployment.id, kind: "container-export" });
  });

  test("container-build prefers Nixpacks, falls back to Docker, and falls back to container export when neither exists", async () => {
    const spawned: Array<{ readonly command: string; readonly args: readonly string[] }> = [];
    const service = createDeploymentService({
      database: currentDatabase(),
      eventBus: currentBus(),
      now: () => now,
      deploymentRoot: currentTempDir(),
      commandProbe: (command) => command === "nixpacks",
      spawnImpl: ((command: string, args: readonly string[]) => {
        spawned.push({ command, args });
        return fakeSuccessfulChild(42);
      }) as never
    });

    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "container-build", roomId: "room_1" });

    await eventually(() => expect(currentDatabase().sqlite.prepare("SELECT status, pid FROM deployments WHERE id = ?").get(deployment.id)).toMatchObject({ status: "ready", pid: "42" }));
    expect(spawned[0]).toMatchObject({ command: "nixpacks", args: expect.arrayContaining(["build"]) });

    const dockerOnly = createDeploymentService({
      database: currentDatabase(),
      eventBus: currentBus(),
      now: () => now,
      deploymentRoot: currentTempDir(),
      commandProbe: (command) => command === "docker",
      spawnImpl: ((command: string, args: readonly string[]) => {
        spawned.push({ command, args });
        return fakeSuccessfulChild(43);
      }) as never
    });
    const dockerDeployment = await dockerOnly.createDeployment({ artifactId: "artifact_1", kind: "container-build", roomId: "room_1" });
    await eventually(() => expect(currentDatabase().sqlite.prepare("SELECT status, pid FROM deployments WHERE id = ?").get(dockerDeployment.id)).toMatchObject({ status: "ready", pid: "43" }));
    expect(spawned.at(-1)).toMatchObject({ command: "docker", args: expect.arrayContaining(["build"]) });

    const fallback = createDeploymentService({
      database: currentDatabase(),
      eventBus: currentBus(),
      now: () => now,
      deploymentRoot: currentTempDir(),
      commandProbe: () => false
    });
    const fallbackDeployment = await fallback.createDeployment({ artifactId: "artifact_1", kind: "container-build", roomId: "room_1" });
    const fallbackRow = currentDatabase().sqlite.prepare("SELECT status, kind, zip_path FROM deployments WHERE id = ?").get(fallbackDeployment.id) as { readonly status: string; readonly kind: string; readonly zip_path: string | null };
    expect(fallbackRow).toMatchObject({ status: "ready", kind: "container-export" });
    expect(fallbackRow.zip_path && readZipEntries(fallbackRow.zip_path)).toEqual(expect.arrayContaining(["index.html", "Dockerfile"]));
  });

  test("deployment actions enforce valid transitions and kinds", async () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir() });
    const ready = await service.createDeployment({ artifactId: "artifact_1", kind: "preview-url", roomId: "room_1" });
    const failed = await service.createDeployment({ artifactId: "artifact_1", kind: "container-export", roomId: "room_1" });
    currentDatabase().sqlite.prepare("UPDATE deployments SET status = 'failed' WHERE id = ?").run(failed.id);

    await expect(service.retry(ready.id)).rejects.toThrow("retry_requires_failed");
    await expect(service.cancel(ready.id)).rejects.toThrow("cancel_requires_active");
    await expect(service.unpublish(ready.id)).rejects.toThrow("unpublish_not_supported");
    await expect(service.retry(failed.id)).resolves.toMatchObject({ status: "ready" });
  });

  test("expiry sweeper marks expired preview deployments and publishes deployment.expired transactionally", async () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir(), previewPort: 7777 });
    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "preview-url", roomId: "room_1" });
    now += 30 * 60 * 1000 + 1;

    service.expirePreviewDeployments();

    expect(currentDatabase().sqlite.prepare("SELECT status FROM deployments WHERE id = ?").get(deployment.id)).toMatchObject({ status: "expired" });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'deployment.expired' AND json_extract(payload, '$.deploymentId') = ?").get(deployment.id)).toMatchObject({ count: 1 });
  });

  test("CapRover polling waits for deployedVersion before marking self-hosted deployment ready", async () => {
    let pollCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      if (url.includes("?detached=1")) return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } });
      pollCount += 1;
      if (pollCount === 1) return new Response(JSON.stringify({ data: { appDefinition: { customDomain: ["pending.example.com"] } } }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ data: { appDefinition: { deployedVersion: "v2", customDomain: ["ready.example.com"] } } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const keychain = { get: vi.fn(async () => "captain-token"), set: vi.fn(), delete: vi.fn() };
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, keychain, fetchImpl: fetchMock, deploymentRoot: currentTempDir() });
    currentDatabase().sqlite.prepare("INSERT INTO deployment_providers (id, workspace_id, kind, name, base_url, credential_ref, created_at, updated_at) VALUES ('provider_1', 'ws_1', 'caprover', 'CapRover', 'https://captain.example', 'secret_ref', ?, ?)").run(now, now);

    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "self-hosted", roomId: "room_1", providerId: "provider_1" });

    expect(pollCount).toBe(2);
    expect(deployment).toMatchObject({ status: "ready", url: "https://ready.example.com" });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'deployment.ready' AND json_extract(payload, '$.deploymentId') = ?").get(deployment.id)).toMatchObject({ count: 1 });
  });

  test("cancelled self-hosted deployments ignore later CapRover poll readiness", async () => {
    let deploymentId: string | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      if (url.includes("?detached=1")) return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } });
      if (deploymentId !== undefined) await service.cancel(deploymentId);
      return new Response(JSON.stringify({ data: { appDefinition: { deployedVersion: "v3", customDomain: ["cancel-race.example.com"] } } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const keychain = { get: vi.fn(async () => "captain-token"), set: vi.fn(), delete: vi.fn() };
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, keychain, fetchImpl: fetchMock, deploymentRoot: currentTempDir() });
    currentDatabase().sqlite.prepare("INSERT INTO deployment_providers (id, workspace_id, kind, name, base_url, credential_ref, created_at, updated_at) VALUES ('provider_1', 'ws_1', 'caprover', 'CapRover', 'https://captain.example', 'secret_ref', ?, ?)").run(now, now);

    const pending = service.createDeployment({ artifactId: "artifact_1", kind: "self-hosted", roomId: "room_1", providerId: "provider_1" });
    await eventually(() => {
      const row = currentDatabase().sqlite.prepare("SELECT id FROM deployments WHERE kind = 'self-hosted' ORDER BY created_at DESC LIMIT 1").get() as { readonly id: string } | undefined;
      expect(row).toBeDefined();
      deploymentId = row?.id;
    });
    const deployment = await pending;

    expect(deployment.status).toBe("cancelled");
    expect(currentDatabase().sqlite.prepare("SELECT status, url FROM deployments WHERE id = ?").get(deployment.id)).toMatchObject({ status: "cancelled", url: null });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'deployment.ready' AND json_extract(payload, '$.deploymentId') = ?").get(deployment.id)).toMatchObject({ count: 0 });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'deployment.cancelled' AND json_extract(payload, '$.deploymentId') = ?").get(deployment.id)).toMatchObject({ count: 1 });
  });

  test("terminal status events use registry payload shapes", async () => {
    const service = createDeploymentService({
      database: currentDatabase(),
      eventBus: currentBus(),
      now: () => now,
      deploymentRoot: currentTempDir(),
      commandProbe: () => true,
      spawnImpl: (() => fakeRunningChild(44)) as never
    });
    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "container-build", roomId: "room_1" });

    await service.cancel(deployment.id);
    const staticSite = await service.createDeployment({ artifactId: "artifact_1", kind: "static-site", roomId: "room_1" });
    await service.unpublish(staticSite.id);

    const cancelled = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = 'deployment.cancelled' ORDER BY seq DESC LIMIT 1").get() as { readonly payload: string };
    const unpublished = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = 'deployment.unpublished' ORDER BY seq DESC LIMIT 1").get() as { readonly payload: string };
    expect(Object.keys(JSON.parse(cancelled.payload))).toEqual(["deploymentId"]);
    expect(Object.keys(JSON.parse(unpublished.payload))).toEqual(["deploymentId"]);
  });

  test("cancel kills a persisted deployment pid when no live child is registered", async () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir() });
    currentDatabase().sqlite.prepare("INSERT INTO deployments (id, artifact_id, artifact_version, room_id, workspace_id, kind, provider, status, pid, created_at, updated_at) VALUES ('deployment_pid_cancel', 'artifact_1', 2, 'room_1', 'ws_1', 'container-build', 'agenthub-local', 'in_progress', '4242', ?, ?)").run(now, now);
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    await service.cancel("deployment_pid_cancel");

    expect(killSpy).toHaveBeenCalledWith(4242);
    expect(currentDatabase().sqlite.prepare("SELECT status FROM deployments WHERE id = 'deployment_pid_cancel'").get()).toMatchObject({ status: "cancelled" });
    killSpy.mockRestore();
  });

  test("CapRover self-hosted deployment uploads multipart sourceFile and records external URL", async () => {
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      calls.push({ url, ...(init !== undefined ? { init } : {}) });
      if (url.endsWith("/api/v2/user/info")) return new Response(JSON.stringify({ data: { version: "1.0.0" } }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/api/v2/user/apps/appData/web-page-artifact?detached=1")) return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/api/v2/user/apps/appData/web-page-artifact")) return new Response(JSON.stringify({ data: { appDefinition: { deployedVersion: "caprover-deploy-1" } } }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    const keychain = { get: vi.fn(async () => "captain-token"), set: vi.fn(), delete: vi.fn() };
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, keychain, fetchImpl: fetchMock, deploymentRoot: currentTempDir() });
    currentDatabase().sqlite.prepare("INSERT INTO deployment_providers (id, workspace_id, kind, name, base_url, credential_ref, created_at, updated_at) VALUES ('provider_1', 'ws_1', 'caprover', 'CapRover', 'https://captain.example', 'secret_ref', ?, ?)").run(now, now);

    const deployment = await service.createDeployment({ artifactId: "artifact_1", kind: "self-hosted", roomId: "room_1", providerId: "provider_1" });

    expect(deployment).toMatchObject({ status: "ready", url: "https://web-page-artifact.captain.example" });
    const upload = calls.find((call) => call.url.includes("?detached=1"));
    expect(upload?.init?.headers).toMatchObject({ "x-captain-auth": "captain-token" });
    expect(upload?.init?.body).toBeInstanceOf(FormData);
    expect((upload?.init?.body as FormData).get("sourceFile")).toBeInstanceOf(File);
  });

  test("recovers in-progress deployments as failed on daemon restart", () => {
    const service = createDeploymentService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, deploymentRoot: currentTempDir() });
    currentDatabase().sqlite.prepare("INSERT INTO deployments (id, artifact_id, room_id, workspace_id, kind, provider, status, created_at, updated_at) VALUES ('deployment_stale', 'artifact_1', 'room_1', 'ws_1', 'container-build', 'agenthub-local', 'in_progress', ?, ?)").run(now - 100, now - 100);

    service.recoverInterruptedDeployments();

    expect(currentDatabase().sqlite.prepare("SELECT status, last_error FROM deployments WHERE id = 'deployment_stale'").get()).toMatchObject({ status: "failed", last_error: "daemon_restarted" });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'deployment.failed' AND json_extract(payload, '$.deploymentId') = 'deployment_stale'").get()).toMatchObject({ count: 1 });
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

function currentTempDir(): string {
  expect(tempDir).toBeDefined();
  return tempDir as string;
}

function seedArtifact(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, 1, 1)").run(tempDir);
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'solo', 'conversation', 'agent_1', NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES ('artifact_1', 'ws_1', 'room_1', NULL, NULL, NULL, 'file', 'web_page', 'Index', 'ready', 'agent_1', '{}', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_path, binary, no_newline_at_end, old_sha256, new_sha256, applied_state, content_path, created_at) VALUES ('artifact_1', 'index.html', NULL, '<h1>Hello</h1>', NULL, 1, 0, 'added', NULL, 0, 0, NULL, NULL, NULL, NULL, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO artifact_versions (id, artifact_id, version, content, storage_path, content_encoding, metadata, created_at, created_by, message) VALUES ('artifact_1_v1', 'artifact_1', 1, '<h1>Old</h1>', NULL, 'text', '{}', 1, 'agent_1', 'old')").run();
  currentDatabase().sqlite.prepare("INSERT INTO artifact_versions (id, artifact_id, version, content, storage_path, content_encoding, metadata, created_at, created_by, message) VALUES ('artifact_1_v2', 'artifact_1', 2, '<h1>Hello</h1>', NULL, 'text', '{}', 2, 'agent_1', 'current')").run();
}

function readZipEntries(path: string): string[] {
  expect(existsSync(path)).toBe(true);
  expect(statSync(path).size).toBeGreaterThan(22);
  const buffer = readFileSync(path);
  const entries: string[] = [];
  for (let offset = 0; offset < buffer.length - 4; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    entries.push(buffer.subarray(nameStart, nameStart + nameLength).toString("utf8"));
    offset = nameStart + nameLength + extraLength + commentLength - 1;
  }
  return entries;
}

function readZipEntry(path: string, entryName: string): Buffer | undefined {
  expect(existsSync(path)).toBe(true);
  const buffer = readFileSync(path);
  for (let offset = 0; offset < buffer.length - 4; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) continue;
    const flags = buffer.readUInt16LE(offset + 6);
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    if (name === entryName) {
      expect(flags & 0x08).toBe(0);
      expect(compressionMethod).toBe(0);
      return buffer.subarray(dataStart, dataStart + compressedSize);
    }
    offset = dataStart + compressedSize - 1;
  }
  return undefined;
}

function readTarEntries(buffer: Buffer): string[] {
  const entries: string[] = [];
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const name = buffer.subarray(offset, offset + 100).toString("utf8").replace(/\0.*$/u, "");
    if (name.length === 0) break;
    const sizeText = buffer.subarray(offset + 124, offset + 136).toString("utf8").replace(/\0.*$/u, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    entries.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function fakeSuccessfulChild(pid: number): EventEmitter & { readonly pid: number; readonly stdout: EventEmitter; readonly stderr: EventEmitter; kill: () => boolean } {
  const child = new EventEmitter() as EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  queueMicrotask(() => {
    child.stdout.emit("data", "built\n");
    child.emit("exit", 0);
  });
  return child;
}

function fakeRunningChild(pid: number): EventEmitter & { readonly pid: number; readonly stdout: EventEmitter; readonly stderr: EventEmitter; kill: () => boolean } {
  const child = new EventEmitter() as EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

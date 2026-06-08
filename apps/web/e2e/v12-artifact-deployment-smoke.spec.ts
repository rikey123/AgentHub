import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDaemon, type DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("V1.2 artifact and deployment smoke", () => {
  let daemon: DaemonApp;
  let testUrl: string;
  let closeServer: () => void;
  let databasePath: string;
  let workspaceRoot: string;

  test.beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-v12-artifact-e2e-"));
    databasePath = join(dir, "agenthub.sqlite");
    workspaceRoot = join(dir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    daemon = createDaemon({ databasePath, workspaceRoot, port: 0, deploymentCommandProbe: () => false });
    const result = await startTestServer(daemon);
    testUrl = result.url;
    closeServer = result.close;
  });

  test.afterEach(async () => {
    closeServer();
    await Promise.race([
      daemon.close(),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  });

  test("projects artifact cards, expand preview content, and deployment card readiness without refresh", async ({ page }) => {
    const roomId = await createRoom("V1.2 Artifact Smoke");
    const webArtifactId = seedArtifactMessage(roomId, {
      kind: "web_page",
      title: "landing.html",
      path: "landing.html",
      content: "<main><h1>Artifact smoke page</h1></main>"
    });
    seedArtifactMessage(roomId, {
      kind: "document",
      title: "release-notes.md",
      path: "release-notes.md",
      content: "# Release Notes\n\nDocument smoke coverage."
    });
    seedArtifactMessage(roomId, {
      kind: "presentation",
      title: "deck.html",
      path: "deck.html",
      content: "<section><h1>Slide smoke</h1></section>"
    });

    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room V1.2 Artifact Smoke").click();

    await expect(page.locator('[data-testid="preview-card"]').filter({ hasText: "landing.html" })).toBeVisible();
    await expect(page.locator('[data-testid="document-card"]').filter({ hasText: "release-notes.md" })).toBeVisible();
    await expect(page.locator('[data-testid="presentation-card"]').filter({ hasText: "deck.html" })).toBeVisible();

    await page.locator('[data-testid="preview-card"]').filter({ hasText: "landing.html" }).getByRole("button", { name: "Expand Preview" }).click();
    const artifactStudio = page.getByRole("dialog", { name: "Artifact Studio" });
    await expect(artifactStudio).toBeVisible();
    await expect(artifactStudio.frameLocator('iframe[title="landing.html"]').locator("h1")).toHaveText("Artifact smoke page");
    await page.getByLabel("Close file preview").click();

    const deploymentResponse = await fetch(`${testUrl}/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifactId: webArtifactId, kind: "preview-url", roomId })
    });
    expect(deploymentResponse.ok).toBe(true);
    const deploymentPayload = await deploymentResponse.json() as { readonly deployment?: { readonly id?: string; readonly status?: string; readonly url?: string } };
    const deploymentId = deploymentPayload.deployment?.id;
    expect(deploymentId).toBeTruthy();
    expect(deploymentPayload.deployment?.status).toBe("ready");

    const deploymentCard = page.locator('[data-testid="deployment-card"]').filter({ hasText: deploymentId! });
    await expect(deploymentCard).toBeVisible();
    await expect(deploymentCard).toContainText("ready");
    await expect(deploymentCard).toContainText(/Expires in/u);
    await expect(deploymentCard.getByText("Open Preview")).toBeVisible();
    await expect(deploymentCard.getByText("Redeploy")).toBeVisible();
  });

  test("covers local deployment publish outputs, logs, status actions, and cancel UI", async ({ page }) => {
    const roomId = await createRoom("V1.2 Deployment Publish");
    const webArtifactId = seedArtifactMessage(roomId, {
      kind: "web_page",
      title: "deployable.html",
      path: "index.html",
      content: "<main><h1>Deployment publish smoke</h1></main>"
    });

    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room V1.2 Deployment Publish").click();

    const preview = await createDeployment(webArtifactId, "preview-url", roomId);
    expect(preview.status).toBe("ready");
    expect(await fetchTextThroughTestServer(preview.url)).toContain("Deployment publish smoke");
    await expect(deploymentCard(page, preview.id)).toContainText("ready");
    await expect(deploymentCard(page, preview.id)).toContainText(/Expires in/u);
    await expect(deploymentCard(page, preview.id).getByText("Open Preview")).toBeVisible();

    expireDeployment(preview.id);
    await expect(deploymentCard(page, preview.id)).toContainText("expired");
    await expect(deploymentCard(page, preview.id).getByRole("button", { name: "Redeploy" })).toBeVisible();
    await expect(deploymentCard(page, preview.id).getByText("Open Preview")).toHaveCount(0);

    const staticSite = await createDeployment(webArtifactId, "static-site", roomId);
    expect(staticSite.status).toBe("ready");
    expect(await fetchTextThroughTestServer(staticSite.url)).toContain("Deployment publish smoke");
    const staticCard = deploymentCard(page, staticSite.id);
    await expect(staticCard).toContainText("ready");
    await expect(staticCard.getByText("Unpublish")).toBeVisible();
    await staticCard.getByRole("button", { name: "Unpublish" }).click();
    await expect(staticCard).toContainText("unpublished");
    expect((await fetchThroughTestServer(staticSite.url)).status).toBe(404);

    const sourceZip = await createDeployment(webArtifactId, "source-zip", roomId);
    expect(sourceZip.status).toBe("ready");
    const sourceZipBuffer = await downloadDeployment(sourceZip.downloadUrl);
    expect(readZipEntry(sourceZipBuffer, "index.html")?.toString("utf8")).toContain("Deployment publish smoke");
    await expect(deploymentCard(page, sourceZip.id).getByText("Download ZIP").first()).toBeVisible();

    const containerExport = await createDeployment(webArtifactId, "container-export", roomId);
    expect(containerExport.status).toBe("ready");
    const containerZipBuffer = await downloadDeployment(containerExport.downloadUrl);
    expect(readZipEntries(containerZipBuffer)).toEqual(expect.arrayContaining(["index.html", "Dockerfile"]));
    expect(readZipEntry(containerZipBuffer, "Dockerfile")?.toString("utf8")).toContain("FROM nginx:alpine");
    await expect(deploymentCard(page, containerExport.id).getByText("Download ZIP").first()).toBeVisible();

    const build = await createDeployment(webArtifactId, "container-build", roomId);
    expect(build.status).toBe("ready");
    expect(build.kind).toBe("container-export");
    const buildCard = deploymentCard(page, build.id);
    await expect(buildCard).toContainText("container-export");
    await expect(buildCard).toContainText("ready");
    await expect(buildCard.getByText("Download ZIP").first()).toBeVisible();

    const running = seedRunningDeployment(roomId, webArtifactId);
    await daemon.deploymentService.appendLog(running.id, "booting builder\n");
    const runningCard = deploymentCard(page, running.id);
    await expect(runningCard).toContainText("in_progress");
    await runningCard.getByRole("button", { name: "View Logs" }).click();
    await expect(runningCard.locator("pre")).toContainText("booting builder");
    await runningCard.getByRole("button", { name: "Cancel" }).click();
    await expect(runningCard).toContainText("cancelled");
    expect(daemon.database.sqlite.prepare("SELECT status FROM deployments WHERE id = ?").get(running.id)).toMatchObject({ status: "cancelled" });
  });

  test("keeps static-site URLs available across daemon restart and fails stale in-progress deployments", async ({ page }) => {
    const roomId = await createRoom("V1.2 Deployment Restart Recovery");
    const webArtifactId = seedArtifactMessage(roomId, {
      kind: "web_page",
      title: "restartable.html",
      path: "index.html",
      content: "<main><h1>Static site survives restart</h1></main>"
    });

    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room V1.2 Deployment Restart Recovery").click();
    const staticSite = await createDeployment(webArtifactId, "static-site", roomId);
    expect(await fetchTextThroughTestServer(staticSite.url)).toContain("Static site survives restart");

    const stale = seedRunningDeployment(roomId, webArtifactId);
    await expect(deploymentCard(page, stale.id)).toContainText("in_progress");

    await restartDaemon();

    expect(await fetchTextThroughTestServer(staticSite.url)).toContain("Static site survives restart");
    expect(daemon.database.sqlite.prepare("SELECT status, last_error FROM deployments WHERE id = ?").get(stale.id)).toMatchObject({
      status: "failed",
      last_error: "daemon_restarted"
    });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'deployment.failed' AND json_extract(payload, '$.deploymentId') = ?").get(stale.id)).toMatchObject({ count: 1 });

    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room V1.2 Deployment Restart Recovery").click();
    await expect(deploymentCard(page, staticSite.id)).toContainText("ready");
    await expect(deploymentCard(page, stale.id)).toContainText("failed");
    await expect(deploymentCard(page, stale.id)).toContainText("daemon_restarted");
  });

  async function createRoom(title: string): Promise<string> {
    const response = await fetch(`${testUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, mode: "solo", primaryAgentId: "mock-builder" })
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as { readonly data?: { readonly roomId?: string } };
    const roomId = payload.data?.roomId;
    if (roomId === undefined) throw new Error("room id missing from create room response");
    return roomId;
  }

  async function createDeployment(artifactId: string, kind: "preview-url" | "static-site" | "source-zip" | "container-export" | "container-build", roomId: string): Promise<{ readonly id: string; readonly kind: string; readonly status: string; readonly url?: string; readonly downloadUrl?: string }> {
    const response = await fetch(`${testUrl}/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifactId, kind, roomId })
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as { readonly deployment?: { readonly id?: string; readonly kind?: string; readonly status?: string; readonly url?: string; readonly downloadUrl?: string } };
    const deployment = payload.deployment;
    if (deployment?.id === undefined || deployment.kind === undefined || deployment.status === undefined) throw new Error("deployment response missing fields");
    return {
      id: deployment.id,
      kind: deployment.kind,
      status: deployment.status,
      ...(deployment.url !== undefined ? { url: deployment.url } : {}),
      ...(deployment.downloadUrl !== undefined ? { downloadUrl: deployment.downloadUrl } : {})
    };
  }

  async function restartDaemon(): Promise<void> {
    closeServer();
    await Promise.race([
      daemon.close(),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
    daemon = createDaemon({ databasePath, workspaceRoot, port: 0, deploymentCommandProbe: () => false });
    const result = await startTestServer(daemon);
    testUrl = result.url;
    closeServer = result.close;
  }

  function deploymentCard(page: Page, deploymentId: string): Locator {
    return page.locator('[data-testid="deployment-card"]').filter({ hasText: deploymentId });
  }

  async function fetchThroughTestServer(url: string | undefined): Promise<Response> {
    if (url === undefined) throw new Error("deployment URL missing");
    const target = new URL(url);
    const base = new URL(testUrl);
    return fetch(`${base.origin}${target.pathname}${target.search}`);
  }

  async function fetchTextThroughTestServer(url: string | undefined): Promise<string> {
    const response = await fetchThroughTestServer(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    return response.text();
  }

  async function downloadDeployment(downloadUrl: string | undefined): Promise<Buffer> {
    if (downloadUrl === undefined) throw new Error("download URL missing");
    const response = await fetch(`${testUrl}${downloadUrl}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    return Buffer.from(await response.arrayBuffer());
  }

  function expireDeployment(deploymentId: string): void {
    daemon.database.sqlite.prepare("UPDATE deployments SET expires_at = ? WHERE id = ?").run(Date.now() - 1, deploymentId);
    daemon.deploymentService.expirePreviewDeployments();
  }

  function seedRunningDeployment(roomId: string, artifactId: string): { readonly id: string } {
    const now = Date.now();
    const deploymentId = `deployment-v12-running-${randomUUID()}`;
    const messageId = `message-v12-deployment-${randomUUID()}`;
    const logPath = join(tmpdir(), `${deploymentId}.log`);
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite
        .prepare("INSERT INTO deployments (id, artifact_id, artifact_version, room_id, workspace_id, kind, provider, status, provider_config_id, log_path, pid, created_at, updated_at) VALUES (?, ?, 1, ?, 'default-workspace', 'container-build', 'agenthub-local', 'in_progress', NULL, ?, '999999', ?, ?)")
        .run(deploymentId, artifactId, roomId, logPath, now, now);
      daemon.database.sqlite
        .prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'default-workspace', ?, 'system', 'deployment', NULL, 'system', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)")
        .run(messageId, roomId, now, now);
      const part = {
        type: "card",
        card: {
          type: "deployment",
          deploymentId,
          artifactId,
          kind: "container-build",
          provider: "agenthub-local",
          status: "in_progress"
        }
      };
      daemon.database.sqlite
        .prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'card', ?, ?)")
        .run(messageId, JSON.stringify(part), now);
      daemon.eventBus.publish({
        id: randomUUID(),
        type: "deployment.created",
        schemaVersion: 1,
        workspaceId: "default-workspace",
        roomId,
        payload: { deploymentId, artifactId, kind: "container-build", provider: "agenthub-local", status: "in_progress" },
        createdAt: now
      });
      daemon.eventBus.publish({
        id: randomUUID(),
        type: "message.created",
        schemaVersion: 1,
        workspaceId: "default-workspace",
        roomId,
        payload: { messageId, senderType: "system", senderId: "deployment", role: "system", status: "completed", text: "" },
        createdAt: now
      });
      daemon.eventBus.publish({
        id: randomUUID(),
        type: "message.part.added",
        schemaVersion: 1,
        workspaceId: "default-workspace",
        roomId,
        payload: { messageId, part: { seq: 1, ...part } },
        createdAt: now
      });
    })();
    return { id: deploymentId };
  }

  function seedArtifactMessage(roomId: string, input: { readonly kind: "web_page" | "document" | "presentation"; readonly title: string; readonly path: string; readonly content: string }): string {
    const now = Date.now();
    const artifactId = `artifact-v12-${randomUUID()}`;
    const messageId = `message-v12-artifact-${randomUUID()}`;
    const part = {
      type: "card",
      seq: 1,
      card: {
        type: "artifact",
        artifactId,
        kind: input.kind,
        title: input.title,
        version: 1
      }
    };

    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite
        .prepare("INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES (?, 'default-workspace', ?, NULL, NULL, ?, 'file', ?, ?, 'ready', 'agent_e2e', '{}', ?, ?)")
        .run(artifactId, roomId, messageId, input.kind, input.title, now, now);
      daemon.database.sqlite
        .prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_path, binary, no_newline_at_end, old_sha256, new_sha256, applied_state, content_path, created_at) VALUES (?, ?, NULL, ?, NULL, 1, 0, 'added', NULL, 0, 0, NULL, NULL, NULL, NULL, ?)")
        .run(artifactId, input.path, input.content, now);
      daemon.database.sqlite
        .prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'default-workspace', ?, 'agent', 'agent_e2e', NULL, 'assistant', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)")
        .run(messageId, roomId, now, now);
      daemon.database.sqlite
        .prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'card', ?, ?)")
        .run(messageId, JSON.stringify(part), now);
      daemon.eventBus.publish({
        id: randomUUID(),
        type: "message.created",
        schemaVersion: 1,
        workspaceId: "default-workspace",
        roomId,
        agentId: "agent_e2e",
        payload: { messageId, senderType: "agent", senderId: "agent_e2e", role: "assistant", status: "completed" },
        createdAt: now
      });
      daemon.eventBus.publish({
        id: randomUUID(),
        type: "message.part.added",
        schemaVersion: 1,
        workspaceId: "default-workspace",
        roomId,
        agentId: "agent_e2e",
        payload: { messageId, part },
        createdAt: now
      });
      daemon.eventBus.publish({
        id: randomUUID(),
        type: "message.completed",
        schemaVersion: 1,
        workspaceId: "default-workspace",
        roomId,
        agentId: "agent_e2e",
        payload: { messageId, text: "" },
        createdAt: now
      });
    })();

    return artifactId;
  }

  function readZipEntries(buffer: Buffer): string[] {
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

  function readZipEntry(buffer: Buffer, entryName: string): Buffer | undefined {
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
});

import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDaemon, type DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("V1.2 artifact generation, preview, editing, and history", () => {
  let daemon: DaemonApp;
  let testUrl: string;
  let closeServer: () => void;
  let workspaceRoot: string;
  let activePptPreviewPorts: Set<number>;
  let nextPptPreviewPort: number | undefined;

  test.beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-v12-artifact-studio-e2e-"));
    workspaceRoot = join(dir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    activePptPreviewPorts = new Set();
    nextPptPreviewPort = undefined;
    const fakeAcpRuntime = fileURLToPath(new URL("./fixtures/fake-acp-runtime.mjs", import.meta.url));
    daemon = createDaemon({
      databasePath: join(dir, "agenthub.sqlite"),
      workspaceRoot,
      port: 0,
      adapterCommands: {
        claude: { command: process.execPath, args: [fakeAcpRuntime], env: { AGENTHUB_FAKE_ACP_KIND: "claude-code" } }
      },
      pptPreviewBridge: {
        start: async (filePath) => {
          const port = nextPptPreviewPort ?? 0;
          if (port !== 0) activePptPreviewPorts.add(port);
          return { port, filePath, pid: 0, status: "ready" };
        },
        stop: async (port) => {
          activePptPreviewPorts.delete(port);
        },
        stopAll: async () => {
          activePptPreviewPorts.clear();
        },
        isActivePreviewPort: (port) => activePptPreviewPorts.has(port)
      }
    });
    const result = await startTestServer(daemon);
    testUrl = result.url;
    closeServer = result.close;
    seedAgentRuntimeFixtures();
  });

  test.afterEach(async () => {
    closeServer?.();
    await Promise.race([
      daemon.close(),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  });

  test("covers generated web/document/slides previews and reference pills without refresh", async ({ page }) => {
    const roomId = await createRoom("V1.2 Artifact Generation");

    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room V1.2 Artifact Generation").click();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();

    const webArtifactId = seedTextArtifactMessage(roomId, {
      kind: "web_page",
      title: "landing.html",
      path: "landing.html",
      content: "<main><h1>Artifact Studio smoke page</h1><button>Buy now</button></main>"
    });
    const documentArtifactId = seedTextArtifactMessage(roomId, {
      kind: "document",
      title: "release-notes.md",
      path: "release-notes.md",
      content: "# Release Notes\n\nParagraph for artifact reference coverage.\n\n- Shipped"
    });
    const slidesArtifactId = seedTextArtifactMessage(roomId, {
      kind: "presentation",
      title: "deck.html",
      path: "deck.html",
      content: "<section data-slide=\"1\"><h1>Intro</h1></section><section data-slide=\"2\"><h1>Plan</h1></section>",
      cardExtras: { slideCount: 2 }
    });

    await expect(page.locator('[data-testid="preview-card"]').filter({ hasText: "landing.html" })).toBeVisible();
    await expect(page.locator('[data-testid="document-card"]').filter({ hasText: "release-notes.md" })).toBeVisible();
    await expect(page.locator('[data-testid="presentation-card"]').filter({ hasText: "deck.html" })).toBeVisible();

    await page.locator('[data-testid="preview-card"]').filter({ hasText: "landing.html" }).getByRole("button", { name: "Expand Preview" }).click();
    const artifactStudio = page.getByRole("dialog", { name: "Artifact Studio" });
    await expect(artifactStudio).toBeVisible();
    await expect(artifactStudio.frameLocator('iframe[title="landing.html"]').locator("h1")).toHaveText("Artifact Studio smoke page");
    await expect(artifactStudio.frameLocator('iframe[title="landing.html"]').locator("button")).toHaveText("Buy now");
    await page.getByLabel("Close file preview").click();

    await page.locator('[data-testid="document-card"]').filter({ hasText: "release-notes.md" }).getByRole("button", { name: "Reference" }).click();
    await expect(page.getByTestId("message-input")).toHaveValue(new RegExp(escapeRegExp(`@artifact:${documentArtifactId}#L1-L1`), "u"));

    const presentationCard = page.locator('[data-testid="presentation-card"]').filter({ hasText: "deck.html" });
    await presentationCard.getByRole("button", { name: "Next" }).click();
    await expect(presentationCard).toContainText("Slide 2 thumbnail");
    await presentationCard.getByRole("button", { name: "Reference Slide" }).click();
    await expect(page.getByTestId("message-input")).toHaveValue(new RegExp(escapeRegExp(`@artifact:${slidesArtifactId}#slide=2`), "u"));

    await expect(page.locator('[data-testid="preview-card"]').filter({ hasText: webArtifactId })).toHaveCount(0);
  });

  test("edits HTML in Artifact Studio, records history, diffs versions, and restores prior content", async ({ page }) => {
    const roomId = await createRoom("V1.2 Artifact History");
    const artifactId = seedTextArtifactMessage(roomId, {
      kind: "web_page",
      title: "landing.html",
      path: "landing.html",
      content: "<main><h1>Version one</h1><button class=\"primary\">Start</button></main>"
    });

    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room V1.2 Artifact History").click();
    await page.locator('[data-testid="preview-card"]').filter({ hasText: "landing.html" }).getByRole("button", { name: "Expand Preview" }).click();

    const artifactStudio = page.getByRole("dialog", { name: "Artifact Studio" });
    await expect(artifactStudio).toBeVisible();
    await artifactStudio.getByRole("tab", { name: "Editor" }).click();
    await expect(artifactStudio.getByText("Monaco editor")).toBeVisible();
    await expect(artifactStudio.locator(".monaco-editor")).toBeVisible({ timeout: 20000 });
    await expect(artifactStudio.locator(".monaco-editor")).toContainText("Version one", { timeout: 20000 });
    await artifactStudio.getByLabel("Save message").fill("make button blue");
    const updatedHtml = "<main><h1>Version two</h1><button class=\"primary blue\">Start</button></main>";
    const monacoEditor = artifactStudio.locator(".monaco-editor");
    await monacoEditor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(updatedHtml);
    await expect(monacoEditor).toContainText("Version two");
    await expect(artifactStudio.getByRole("button", { name: "Save" })).toBeEnabled();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
    await expect.poll(() => {
      const row = daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE artifact_id = ?").get(artifactId) as { readonly count: number };
      return row.count;
    }).toBe(2);
    await expect.poll(() => {
      const row = daemon.database.sqlite.prepare("SELECT content, message FROM artifact_versions WHERE artifact_id = ? AND version = 2").get(artifactId) as { readonly content: string; readonly message: string } | undefined;
      return row === undefined ? "" : `${row.message}\n${row.content}`;
    }).toContain(`make button blue\n${updatedHtml}`);

    await artifactStudio.getByRole("tab", { name: "History" }).click();
    await expect(artifactStudio.getByText("v2")).toBeVisible();
    await expect(artifactStudio.getByText("make button blue")).toBeVisible();
    await artifactStudio.locator("li").filter({ hasText: "v1" }).getByRole("button", { name: "Compare" }).click();
    const diffPanel = artifactStudio.getByRole("region", { name: "Version diff" });
    await expect(diffPanel).toContainText("-<main><h1>Version one</h1>");
    await expect(diffPanel).toContainText("+<main><h1>Version two</h1>");

    const diff = await fetch(`${testUrl}/artifacts/${artifactId}/versions/1/diff/2`);
    expect(diff.status).toBe(200);
    await expect(diff.text()).resolves.toContain("-<main><h1>Version one</h1>");

    await artifactStudio.locator("li").filter({ hasText: "v1" }).getByRole("button", { name: "Restore" }).click();
    await expect(artifactStudio.getByText("v3")).toBeVisible();
    await artifactStudio.getByRole("tab", { name: "Preview" }).click();
    await expect(artifactStudio.frameLocator('iframe[title="landing.html"]').locator("h1")).toHaveText("Version one");
  });

  test("projects an agent update to an existing artifact as a new History version", async ({ page }) => {
    const roomId = await createRoom("V1.2 Agent Artifact Update", {
      primaryAgentId: "binding-v12-builder",
      agentBindingId: "binding-v12-builder"
    });
    const artifactId = seedTextArtifactMessage(roomId, {
      kind: "web_page",
      title: "agent-updated.html",
      path: "agent-updated.html",
      content: "<main><h1>Initial agent artifact</h1></main>"
    });

    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room V1.2 Agent Artifact Update").click();
    await expect(page.locator('[data-testid="preview-card"]').filter({ hasText: "agent-updated.html" })).toBeVisible();

    const sent = await fetch(`${testUrl}/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `AGENTHUB_E2E_UPDATE_EXISTING_ARTIFACT @artifact:${artifactId} revise this page`,
        idempotencyKey: `agent-update-${randomUUID()}`
      })
    });
    expect(sent.status).toBe(200);

    const updatedCard = page.locator('[data-testid="preview-card"]').filter({ hasText: "Agent Updated Artifact" });
    await expect(updatedCard).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => latestRunStatus(roomId)).toBe("completed");
    await expect.poll(() => {
      const row = daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE artifact_id = ?").get(artifactId) as { readonly count: number };
      return row.count;
    }).toBe(2);
    await expect.poll(() => {
      const row = daemon.database.sqlite.prepare("SELECT content, message FROM artifact_versions WHERE artifact_id = ? AND version = 2").get(artifactId) as { readonly content: string; readonly message: string } | undefined;
      return row === undefined ? "" : `${row.message}\n${row.content}`;
    }).toContain("agent runtime update\n<main><h1>Agent updated version</h1>");

    await updatedCard.getByRole("button", { name: "Expand Preview" }).click();
    const artifactStudio = page.getByRole("dialog", { name: "Artifact Studio" });
    await artifactStudio.getByRole("tab", { name: "History" }).click();
    await expect(artifactStudio.getByText("v2")).toBeVisible();
    await expect(artifactStudio.getByText("agent runtime update")).toBeVisible();
  });

  test("starts the PPTX preview bridge from PresentationCard and renders the proxied iframe", async ({ page }) => {
    const roomId = await createRoom("V1.2 Real PPTX Card Preview");
    const emptyRoomId = await createRoom("V1.2 Empty PPTX Cleanup Target");
    const upstream = await startPptPreviewUpstream();
    nextPptPreviewPort = upstream.port;
    seedBinaryArtifactMessage(roomId, {
      title: "live-deck.pptx",
      path: "live-deck.pptx",
      firstBytes: Buffer.from("pptx live version one"),
      secondBytes: Buffer.from("pptx live version two"),
      cardExtras: {}
    });

    try {
      await page.goto(testUrl);
      await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room V1.2 Real PPTX Card Preview").click();
      const pptxCard = page.locator('[data-testid="presentation-card"]').filter({ hasText: "live-deck.pptx" });
      await expect(pptxCard).toBeVisible();
      await expect(pptxCard.locator('iframe[title="PPT Preview"]')).toBeVisible({ timeout: 10_000 });
      await expect(pptxCard.frameLocator('iframe[title="PPT Preview"]').locator("body")).toContainText("Next slide");
      await expect(pptxCard.locator('iframe[title="PPT Preview"]')).toHaveAttribute("src", `/api/ppt-proxy/${upstream.port}/`);

      await page.locator(`[data-testid="room-list-item-${emptyRoomId}"]`).getByLabel("Open room V1.2 Empty PPTX Cleanup Target").click();
      await expect.poll(() => activePptPreviewPorts.has(upstream.port)).toBe(false);
    } finally {
      activePptPreviewPorts.delete(upstream.port);
      await upstream.close();
    }
  });

  test("shows binary PPTX history metadata, restores a binary version, and blocks inactive PPT proxy ports", async ({ page }) => {
    const roomId = await createRoom("V1.2 Binary Artifact History");
    const artifactId = seedBinaryArtifactMessage(roomId, {
      title: "deck.pptx",
      path: "deck.pptx",
      firstBytes: Buffer.from("pptx version one"),
      secondBytes: Buffer.from("pptx version two")
    });

    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room V1.2 Binary Artifact History").click();
    const pptxCard = page.locator('[data-testid="presentation-card"]').filter({ hasText: "deck.pptx" });
    await expect(pptxCard).toBeVisible();
    await expect(pptxCard).toContainText("Install failed");
    await pptxCard.getByRole("button", { name: "Expand Preview" }).click();

    const artifactStudio = page.getByRole("dialog", { name: "Artifact Studio" });
    await expect(artifactStudio).toBeVisible();
    await expect(artifactStudio.getByRole("tab", { name: "Editor" })).toHaveCount(0);
    await artifactStudio.getByRole("tab", { name: "History" }).click();
    await expect(artifactStudio.getByText("Binary metadata versions")).toBeVisible();
    await expect(artifactStudio.getByText("Hash").first()).toBeVisible();
    await expect(artifactStudio.getByText("v2")).toBeVisible();

    await artifactStudio.locator("li").filter({ hasText: "v1" }).getByRole("button", { name: "Restore" }).click();
    await expect(artifactStudio.getByText("v3")).toBeVisible();

    const versionRows = daemon.database.sqlite
      .prepare("SELECT version, content_encoding FROM artifact_versions WHERE artifact_id = ? ORDER BY version ASC")
      .all(artifactId) as Array<{ readonly version: number; readonly content_encoding: string }>;
    expect(versionRows.at(-1)).toMatchObject({ version: 3, content_encoding: "binary" });
    const fileRow = daemon.database.sqlite
      .prepare("SELECT content_path, new_sha256, size_bytes FROM artifact_files WHERE artifact_id = ? AND path = 'deck.pptx'")
      .get(artifactId) as { readonly content_path: string; readonly new_sha256: string; readonly size_bytes: number };
    const restoredVersion = daemon.database.sqlite
      .prepare("SELECT storage_path, metadata FROM artifact_versions WHERE artifact_id = ? AND version = 3")
      .get(artifactId) as { readonly storage_path: string; readonly metadata: string };
    const restoredMetadata = JSON.parse(restoredVersion.metadata) as { readonly newSha256?: string; readonly sizeBytes?: number };
    expect(fileRow.content_path).toBe(restoredVersion.storage_path);
    expect(fileRow.new_sha256).toBe(restoredMetadata.newSha256);
    expect(fileRow.size_bytes).toBe(restoredMetadata.sizeBytes);

    const upstream = await startPptPreviewUpstream();
    activePptPreviewPorts.add(upstream.port);
    try {
      const activeProxy = await fetch(`${testUrl}/api/ppt-proxy/${upstream.port}/viewer`);
      expect(activeProxy.status).toBe(200);
      expect(await activeProxy.text()).toContain(`/api/ppt-proxy/${upstream.port}`);

      const inactiveProxy = await fetch(`${testUrl}/api/ppt-proxy/61234/`);
      expect(inactiveProxy.status).toBe(403);
    } finally {
      activePptPreviewPorts.delete(upstream.port);
      await upstream.close();
    }
  });

  async function createRoom(title: string, options: { readonly primaryAgentId?: string; readonly agentBindingId?: string } = {}): Promise<string> {
    const response = await fetch(`${testUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        mode: "solo",
        primaryAgentId: options.primaryAgentId ?? "mock-builder",
        ...(options.agentBindingId !== undefined ? { agentBindingId: options.agentBindingId } : {})
      })
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as { readonly data?: { readonly roomId?: string } };
    const roomId = payload.data?.roomId;
    if (roomId === undefined) throw new Error("room id missing from create room response");
    return roomId;
  }

  function latestRunStatus(roomId: string): string | undefined {
    const row = daemon.database.sqlite.prepare("SELECT status FROM runs WHERE room_id = ? ORDER BY created_at DESC LIMIT 1").get(roomId) as { readonly status: string } | undefined;
    return row?.status;
  }

  function seedAgentRuntimeFixtures(): void {
    const now = Date.now();
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite
        .prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES ('role-v12-builder', 'default-workspace', 'Builder Contact', NULL, 'Builds web artifacts.', 'Build concise artifacts.', '[\"web-page-builder\"]', NULL, NULL, 0, NULL, NULL, ?, ?)")
        .run(now, now);
      daemon.database.sqlite
        .prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES ('runtime-v12-claude', 'default-workspace', 'claude-code', 'Claude Code Runtime', NULL, NULL, NULL, ?, NULL, '2.1.168', '[]', '2.1.168', 'available', '{}', ?, ?)")
        .run(now, now, now);
      daemon.database.sqlite
        .prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, contact_name, contact_description, created_at, updated_at) VALUES ('binding-v12-builder', 'default-workspace', 'role-v12-builder', 'runtime-v12-claude', NULL, NULL, 'Builder Contact', 'Builds web artifacts.', ?, ?)")
        .run(now, now);
    })();
  }

  function seedTextArtifactMessage(roomId: string, input: {
    readonly kind: "web_page" | "document" | "presentation";
    readonly title: string;
    readonly path: string;
    readonly content: string;
    readonly cardExtras?: Record<string, unknown> | undefined;
  }): string {
    const artifactId = `artifact-v12-${randomUUID()}`;
    seedArtifactMessage(roomId, {
      artifactId,
      kind: input.kind,
      title: input.title,
      path: input.path,
      content: input.content,
      isBinary: false,
      metadata: { filename: input.path, mimeType: mimeTypeForPath(input.path), sizeBytes: Buffer.byteLength(input.content) },
      cardExtras: input.cardExtras
    });
    return artifactId;
  }

  function seedBinaryArtifactMessage(roomId: string, input: {
    readonly title: string;
    readonly path: string;
    readonly firstBytes: Buffer;
    readonly secondBytes: Buffer;
    readonly cardExtras?: Record<string, unknown> | undefined;
  }): string {
    const artifactId = `artifact-v12-${randomUUID()}`;
    const now = Date.now();
    const storageRoot = join(workspaceRoot, ".agenthub", "artifacts", artifactId);
    const v1Path = join(storageRoot, "v1", input.path);
    const v2Path = join(storageRoot, "v2", input.path);
    mkdirSync(join(storageRoot, "v1"), { recursive: true });
    mkdirSync(join(storageRoot, "v2"), { recursive: true });
    writeFileSync(v1Path, input.firstBytes);
    writeFileSync(v2Path, input.secondBytes);

    seedArtifactMessage(roomId, {
      artifactId,
      kind: "presentation_pptx",
      title: input.title,
      path: input.path,
      content: undefined,
      isBinary: true,
      contentPath: v2Path,
      metadata: binaryMetadata(input.path, input.secondBytes),
      versions: [
        { version: 1, content: null, storagePath: v1Path, contentEncoding: "binary", metadata: binaryMetadata(input.path, input.firstBytes), message: "initial binary" },
        { version: 2, content: null, storagePath: v2Path, contentEncoding: "binary", metadata: binaryMetadata(input.path, input.secondBytes), message: "agent binary update" }
      ],
      cardExtras: input.cardExtras ?? { pptStatus: "installFailed" }
    });
    daemon.database.sqlite.prepare("UPDATE artifacts SET updated_at = ? WHERE id = ?").run(now + 1, artifactId);
    return artifactId;
  }

  function seedArtifactMessage(roomId: string, input: {
    readonly artifactId: string;
    readonly kind: "web_page" | "document" | "presentation" | "presentation_pptx";
    readonly title: string;
    readonly path: string;
    readonly content: string | undefined;
    readonly isBinary: boolean;
    readonly contentPath?: string | undefined;
    readonly metadata: Record<string, unknown>;
    readonly versions?: ReadonlyArray<{
      readonly version: number;
      readonly content: string | null;
      readonly storagePath: string | null;
      readonly contentEncoding: "text" | "binary";
      readonly metadata: Record<string, unknown>;
      readonly message: string;
    }> | undefined;
    readonly cardExtras?: Record<string, unknown> | undefined;
  }): void {
    const now = Date.now();
    const messageId = `message-v12-artifact-${randomUUID()}`;
    const part = {
      type: "card",
      seq: 1,
      card: {
        type: "artifact",
        artifactId: input.artifactId,
        kind: input.kind,
        title: input.title,
        version: input.versions?.at(-1)?.version ?? 1,
        ...(input.cardExtras ?? {})
      }
    };
    const versions = input.versions ?? [{
      version: 1,
      content: input.content ?? "",
      storagePath: null,
      contentEncoding: "text" as const,
      metadata: input.metadata,
      message: "initial"
    }];

    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite
        .prepare("INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES (?, 'default-workspace', ?, NULL, NULL, ?, 'file', ?, ?, 'ready', 'agent_e2e', ?, ?, ?)")
        .run(input.artifactId, roomId, messageId, input.kind, input.title, JSON.stringify(input.metadata), now, now);
      daemon.database.sqlite
        .prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_path, binary, no_newline_at_end, old_sha256, new_sha256, applied_state, content_path, created_at, mime_type, size_bytes) VALUES (?, ?, NULL, ?, NULL, 1, 0, 'added', NULL, ?, 0, NULL, ?, NULL, ?, ?, ?, ?)")
        .run(
          input.artifactId,
          input.path,
          input.content ?? null,
          input.isBinary ? 1 : 0,
          typeof input.metadata.newSha256 === "string" ? input.metadata.newSha256 : null,
          input.contentPath ?? null,
          now,
          input.metadata.mimeType ?? mimeTypeForPath(input.path),
          input.metadata.sizeBytes ?? (input.content === undefined ? null : Buffer.byteLength(input.content))
        );
      for (const version of versions) {
        daemon.database.sqlite
          .prepare("INSERT INTO artifact_versions (id, artifact_id, version, content, storage_path, content_encoding, metadata, created_at, created_by, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agent_e2e', ?)")
          .run(`${input.artifactId}_v${version.version}`, input.artifactId, version.version, version.content, version.storagePath, version.contentEncoding, JSON.stringify(version.metadata), now + version.version, version.message);
      }
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
  }
});

function mimeTypeForPath(path: string): string {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "text/plain";
}

function binaryMetadata(filename: string, bytes: Buffer): Record<string, unknown> {
  return {
    filename,
    mimeType: mimeTypeForPath(filename),
    sizeBytes: bytes.byteLength,
    newSha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function startPptPreviewUpstream(): Promise<{ readonly port: number; readonly close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end('<html><body><a href="/next">Next slide</a></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("expected upstream TCP address");
  return { port: address.port, close: () => closeServer(server) };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

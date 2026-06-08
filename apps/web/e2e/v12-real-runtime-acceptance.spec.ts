import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDaemon, type DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

const runRealRuntimeAcceptance = process.env.AGENTHUB_REAL_RUNTIME_E2E === "1";

test.describe("V1.2 real Claude Code and OpenCode runtime acceptance", () => {
  test.skip(!runRealRuntimeAcceptance, "Set AGENTHUB_REAL_RUNTIME_E2E=1 to run real local runtime acceptance.");
  test.setTimeout(8 * 60 * 1000);

  let daemon: DaemonApp;
  let closeServer: () => void;
  let root: string;
  let testUrl: string;

  test.beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "agenthub-v12-real-runtime-e2e-"));
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, "README.md"), "# AgentHub real runtime acceptance\n", "utf8");
    writeClaudeCodeE2eSettings(workspaceRoot);
    daemon = createDaemon({ databasePath: join(root, "agenthub.sqlite"), workspaceRoot, port: 0 });
    const result = await startTestServer(daemon);
    testUrl = result.url;
    closeServer = result.close;
  });

  test.afterEach(async () => {
    closeServer();
    await daemon.close({ forceCancelAfterMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {
      // Runtime child processes may briefly hold files on Windows after daemon shutdown.
    }
  });

  test("Claude Code and OpenCode pass health, complete solo runs, and publish visible artifacts", async ({ page }) => {
    await page.goto(testUrl);

    const claude = await createRuntimeContact(testUrl, {
      name: "Real Claude Runtime Contact",
      runtimeId: "runtime-claude-code",
      systemPrompt: [
        "You are validating AgentHub runtime integration.",
        "When asked to create an artifact, call the AgentHub Room MCP tool room.publish_artifact.",
        "Do not merely describe the artifact."
      ].join(" ")
    });
    const opencode = await createRuntimeContact(testUrl, {
      name: "Real OpenCode Runtime Contact",
      runtimeId: "runtime-opencode",
      systemPrompt: [
        "You are validating AgentHub runtime integration.",
        "When asked to create an artifact, call the AgentHub Room MCP tool room.publish_artifact.",
        "Do not merely describe the artifact."
      ].join(" ")
    });

    await expectRuntimeHealth(page, "Real Claude Runtime Contact");
    await expectRuntimeHealth(page, "Real OpenCode Runtime Contact");

    await runRuntimeArtifactAcceptance({
      page,
      daemon,
      testUrl,
      agentBindingId: claude.agentBindingId,
      roomTitle: "Real Claude Runtime Acceptance",
      marker: "REAL_CLAUDE_RUNTIME_ACCEPTANCE",
      expectedCardTestId: "preview-card",
      prompt: [
        "Use the AgentHub Room MCP tool room.publish_artifact now.",
        "Publish kind web_page.",
        "Use filename real-claude-runtime.html and title Real Claude Runtime Page.",
        "The HTML content must include REAL_CLAUDE_RUNTIME_ACCEPTANCE.",
        "Do not just describe it; call the tool."
      ].join(" ")
    });

    await runRuntimeArtifactAcceptance({
      page,
      daemon,
      testUrl,
      agentBindingId: opencode.agentBindingId,
      roomTitle: "Real OpenCode Runtime Acceptance",
      marker: "REAL_OPENCODE_RUNTIME_ACCEPTANCE",
      expectedCardTestId: "document-card",
      prompt: [
        "Use the AgentHub Room MCP tool room.publish_artifact now.",
        "Publish kind document.",
        "Use filename real-opencode-runtime.md and title Real OpenCode Runtime Document.",
        "The Markdown content must include REAL_OPENCODE_RUNTIME_ACCEPTANCE.",
        "Do not just describe it; call the tool."
      ].join(" ")
    });

    await selectRail(page, "Contacts");
    await expect(contactCard(page, "Real Claude Runtime Contact")).toContainText("available");
    await expect(contactCard(page, "Real OpenCode Runtime Contact")).toContainText("available");
  });
});

test("real runtime fixture opts Claude Code into noninteractive permissions", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "agenthub-v12-claude-settings-"));
  try {
    const settingsPath = writeClaudeCodeE2eSettings(tempRoot);
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toMatchObject({
      permissions: { defaultMode: "bypassPermissions" }
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

type CreatedContact = {
  readonly agentBindingId: string;
};

async function createRuntimeContact(testUrl: string, input: { readonly name: string; readonly runtimeId: string; readonly systemPrompt: string }): Promise<CreatedContact> {
  const response = await fetch(`${testUrl}/agents/custom`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      runtimeId: input.runtimeId,
      systemPrompt: input.systemPrompt,
      description: "Real runtime E2E acceptance contact"
    })
  });
  expect(response.status).toBe(201);
  const payload = await response.json() as { readonly agentBindingId?: string; readonly contact?: { readonly agentBindingId?: string } };
  const agentBindingId = payload.agentBindingId ?? payload.contact?.agentBindingId;
  if (agentBindingId === undefined) throw new Error(`agentBindingId missing for ${input.name}`);
  return { agentBindingId };
}

async function runRuntimeArtifactAcceptance(input: {
  readonly page: Page;
  readonly daemon: DaemonApp;
  readonly testUrl: string;
  readonly agentBindingId: string;
  readonly roomTitle: string;
  readonly marker: string;
  readonly expectedCardTestId: "preview-card" | "document-card";
  readonly prompt: string;
}): Promise<void> {
  const roomId = await createRoom(input.testUrl, {
    title: input.roomTitle,
    mode: "solo",
    primaryAgentId: input.agentBindingId,
    agentBindingId: input.agentBindingId
  });
  await selectRail(input.page, "Chat");
  await input.page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel(`Open room ${input.roomTitle}`).click();

  const sent = await fetch(`${input.testUrl}/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: input.prompt, idempotencyKey: `${input.marker.toLowerCase()}-${randomUUID()}` })
  });
  expect(sent.status).toBeGreaterThanOrEqual(200);
  expect(sent.status).toBeLessThanOrEqual(202);

  await expect.poll(() => latestRunStatus(input.daemon, roomId), { timeout: 300_000 }).toBe("completed");
  await expect.poll(() => markerArtifact(input.daemon, roomId, input.marker), { timeout: 30_000 }).not.toBeUndefined();
  const artifact = markerArtifact(input.daemon, roomId, input.marker);
  expect(artifact).toBeDefined();

  await expect(input.page.locator(`[data-testid="${input.expectedCardTestId}"]`).first()).toBeVisible({ timeout: 30_000 });
}

async function createRoom(testUrl: string, body: Record<string, unknown>): Promise<string> {
  const response = await fetch(`${testUrl}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  expect(response.status).toBe(201);
  const payload = await response.json() as { readonly data?: { readonly roomId?: string } };
  const roomId = payload.data?.roomId;
  if (roomId === undefined) throw new Error("room id missing from create room response");
  return roomId;
}

function latestRunStatus(daemon: DaemonApp, roomId: string): string | undefined {
  const row = daemon.database.sqlite.prepare("SELECT status FROM runs WHERE room_id = ? ORDER BY created_at DESC LIMIT 1").get(roomId) as { readonly status: string } | undefined;
  return row?.status;
}

function markerArtifact(daemon: DaemonApp, roomId: string, marker: string): { readonly id: string; readonly title: string | null; readonly path: string | null } | undefined {
  return daemon.database.sqlite
    .prepare(
      `SELECT a.id, a.title, af.path
       FROM artifacts a
       JOIN artifact_files af ON af.artifact_id = a.id
       WHERE a.room_id = ?
         AND af.new_content LIKE ?
       ORDER BY a.created_at DESC
       LIMIT 1`
    )
    .get(roomId, `%${marker}%`) as { readonly id: string; readonly title: string | null; readonly path: string | null } | undefined;
}

async function expectRuntimeHealth(page: Page, displayName: string): Promise<void> {
  await selectRail(page, "Contacts");
  const card = contactCard(page, displayName);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Test Connection" }).click();
  await expect(card).toContainText("green", { timeout: 20_000 });
}

async function selectRail(page: Page, label: "Chat" | "Contacts"): Promise<void> {
  await page.getByRole("navigation", { name: "Workbench navigation" }).getByLabel(label, { exact: true }).click();
}

function contactCard(page: Page, displayName: string) {
  return page
    .getByRole("heading", { name: displayName })
    .locator("xpath=ancestor::div[.//button[normalize-space()='Start Chat'] and .//button[normalize-space()='Test Connection']][1]");
}

function writeClaudeCodeE2eSettings(workspaceRoot: string): string {
  const settingsDir = join(workspaceRoot, ".claude");
  mkdirSync(settingsDir, { recursive: true });
  const settingsPath = join(settingsDir, "settings.local.json");
  writeFileSync(
    settingsPath,
    `${JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }, null, 2)}\n`,
    "utf8"
  );
  return settingsPath;
}

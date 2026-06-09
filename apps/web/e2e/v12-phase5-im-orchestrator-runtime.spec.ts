import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDaemon, type DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("V1.2 Phase 5 IM, group-chat, and runtime acceptance surface", () => {
  let daemon: DaemonApp;
  let testUrl: string;
  let closeServer: () => void;
  let workspaceRoot: string;

  test.beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-v12-phase5-e2e-"));
    workspaceRoot = join(dir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const fakeAcpRuntime = fileURLToPath(new URL("./fixtures/fake-acp-runtime.mjs", import.meta.url));
    daemon = createDaemon({
      databasePath: join(dir, "agenthub.sqlite"),
      workspaceRoot,
      port: 0,
      adapterCommands: {
        claude: { command: process.execPath, args: [fakeAcpRuntime], env: { AGENTHUB_FAKE_ACP_KIND: "claude-code" } },
        opencode: { command: process.execPath, args: [fakeAcpRuntime], env: { AGENTHUB_FAKE_ACP_KIND: "opencode" } }
      }
    });
    const result = await startTestServer(daemon);
    testUrl = result.url;
    closeServer = result.close;
    seedPhase5Fixtures(daemon);
  });

  test.afterEach(async () => {
    closeServer();
    await Promise.race([
      daemon.close(),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  });

  test("exercises FeatureRail entries, contact-first room creation, contact cards, and runtime health badges", async ({ page }) => {
    const roomRequests: unknown[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/rooms" && request.method() === "POST") {
        roomRequests.push(request.postDataJSON() as unknown);
      }
    });

    await page.goto(testUrl);

    await selectRail(page, "Contacts");
    await expect(page.getByRole("heading", { name: "Agent Contacts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Builder Contact" })).toBeVisible();
    await expect(page.getByText("claude-code").first()).toBeVisible();
    await expect(page.getByText("available").first()).toBeVisible();
    await expect(page.getByText("code.edit")).toBeVisible();

    await contactCard(page, "Builder Contact").getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText("green 1.2.3")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Reviewer Contact" })).toBeVisible();
    await contactCard(page, "Reviewer Contact").getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText("green 2.0.0")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Codex Contact" })).toBeVisible();
    await expect(contactCard(page, "Codex Contact")).toContainText("experimental");

    await page.getByRole("button", { name: "New Agent" }).click();
    const newAgentDialog = page.getByRole("dialog", { name: "New agent" });
    await expect(newAgentDialog).toBeVisible();
    await newAgentDialog.getByLabel("Display name").fill("Launch Builder");
    await newAgentDialog.getByLabel("Description").fill("Builds launch assets.");
    await newAgentDialog.getByLabel("System prompt").fill("Build crisp launch pages and explain tradeoffs.");
    await newAgentDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Launch Builder" })).toBeVisible();
    const createdContact = daemon.database.sqlite
      .prepare("SELECT ab.id AS binding_id, r.prompt AS prompt FROM agent_bindings ab JOIN roles r ON r.id = ab.role_id WHERE ab.contact_name = 'Launch Builder'")
      .get() as { readonly binding_id: string; readonly prompt: string } | undefined;
    expect(createdContact).toMatchObject({ prompt: "Build crisp launch pages and explain tradeoffs." });

    await contactCard(page, "Launch Builder").getByRole("button", { name: "Start Chat" }).click();
    await expect(page.getByRole("banner")).toContainText("Chat with Launch Builder");
    await expect(page.getByLabel("Open room Chat with Launch Builder")).toBeVisible();
    expect(roomRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Chat with Launch Builder",
        mode: "assisted",
        primaryAgentId: createdContact?.binding_id,
        agentBindingId: createdContact?.binding_id
      })
    ]));

    await selectRail(page, "Contacts");
    await contactCard(page, "Builder Contact").getByRole("button", { name: "Start Chat" }).click();
    await expect(page.getByRole("banner")).toContainText("Chat with Builder Contact");
    await expect(page.getByLabel("Open room Chat with Builder Contact")).toBeVisible();
    expect(roomRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Chat with Builder Contact",
        mode: "assisted",
        primaryAgentId: "binding-v12-builder",
        agentBindingId: "binding-v12-builder"
      })
    ]));

    await page.locator('[data-testid="room-list-create-room"]').click();
    const newRoomDialog = page.getByRole("dialog").filter({ hasText: "Pick one or more agent contacts first" });
    await expect(newRoomDialog).toBeVisible();
    await expect(newRoomDialog.getByRole("heading", { name: "Contacts" })).toBeVisible();
    await expect(newRoomDialog.getByRole("button", { name: /Builder Contact/u })).toBeVisible();
    await expect(newRoomDialog.locator('[data-testid="new-room-leader-role"]')).toBeVisible();
    const contactsAppearBeforeLegacyRole = await newRoomDialog.evaluate((dialog) => {
      const contactsHeading = Array.from(dialog.querySelectorAll("h3"))
        .find((heading) => heading.textContent?.trim() === "Contacts");
      const legacyRole = dialog.querySelector('[data-testid="new-room-leader-role"]');
      return contactsHeading !== undefined
        && legacyRole !== null
        && (contactsHeading.compareDocumentPosition(legacyRole) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(contactsAppearBeforeLegacyRole).toBe(true);

    await newRoomDialog.getByRole("button", { name: /Builder Contact/u }).click();
    await expect(newRoomDialog.locator('[data-testid="new-room-contact-0-role"]')).toBeVisible();
    await expect(newRoomDialog.locator('[data-testid="new-room-contact-0-runtime"]')).toBeVisible();
    await expect(newRoomDialog.locator('[data-testid="new-room-contact-0-model"]')).toBeVisible();
    await expect(newRoomDialog.getByText("web-page-builder").first()).toBeVisible();

    await newRoomDialog.getByRole("button", { name: "Close" }).click();

    await selectRail(page, "Runs");
    await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
    await expect(page.getByText("Run Activity")).toBeVisible();

    await selectRail(page, "Tasks");
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Task Workbench" })).toBeVisible();

    await selectRail(page, "Artifacts");
    await expect(page.getByRole("heading", { name: "Artifact Library" })).toBeVisible();
    await expect(page.getByText("Phase 5 Artifact")).toBeVisible();

    await selectRail(page, "Chat");
    await expect(page.getByLabel("Open room Chat with Builder Contact")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();

    await selectRail(page, "Settings");
    await expect(page.getByRole("dialog")).toContainText("设置");
  });

  test("projects a mock group-chat orchestration transcript with dispatch, separated artifact card, failure downgrade, and summary", async ({ page }) => {
    const roomId = await createRoom(testUrl, {
      title: "Phase 5 Group Chat",
      mode: "team",
      primaryAgentId: "binding-v12-leader",
      leaderRoleId: "role-v12-leader",
      participants: [
        { type: "agent", agentId: "binding-v12-builder", agentBindingId: "binding-v12-builder", role: "teammate", defaultPresence: "active" },
        { type: "agent", agentId: "binding-v12-reviewer", agentBindingId: "binding-v12-reviewer", role: "teammate", defaultPresence: "active" }
      ]
    });

    const artifactId = seedGroupChatTranscript(daemon, roomId);

    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room Phase 5 Group Chat").click();

    await expect(page.locator('[data-testid="message-bubble-user"]').filter({ hasText: "@builder-contact @reviewer-contact Ship the landing page" })).toBeVisible();
    await expect(page.locator('[data-testid="message-bubble-system"]').filter({ hasText: "Assigned task \"Build landing page\" to Builder Contact" })).toBeVisible();
    await expect(page.locator('[data-testid="message-bubble-system"]').filter({ hasText: "Assigned task \"Review landing page\" to Reviewer Contact" })).toBeVisible();

    const builderMessage = page.locator('[data-testid="message-bubble-agent"]').filter({ hasText: "I published the landing page as" });
    await expect(builderMessage).toBeVisible();
    await expect(builderMessage).toContainText(`@artifact:${artifactId}`);
    await expect(page.locator('[data-testid="preview-card"]').filter({ hasText: "phase5-landing.html" })).toBeVisible();
    await expect(page.locator('[data-testid="message-bubble-agent"]').filter({ hasText: "function giant" })).toHaveCount(0);

    await expect(page.locator('[data-testid="message-bubble-system"]').filter({ hasText: "Reviewer Contact failed: runtime timeout. Decision: skipped" })).toBeVisible();
    await expect(page.locator('[data-testid="message-bubble-agent"]').filter({ hasText: "Summary: Builder completed the landing page" })).toBeVisible();
  });

  test("keeps RoomList, pinned context, and message actions usable without refresh", async ({ page }) => {
    const roomId = await createRoom(testUrl, {
      title: "Phase 5 IM Actions",
      mode: "assisted",
      primaryAgentId: "binding-v12-builder",
      participants: [
        { type: "agent", agentId: "binding-v12-reviewer", agentBindingId: "binding-v12-reviewer", role: "teammate", defaultPresence: "active" }
      ]
    });
    const messageIds = seedMessageActionTranscript(daemon, roomId, workspaceRoot);

    await page.goto(testUrl);
    await expect(page.locator(`[data-testid="room-list-item-${roomId}"]`)).toBeVisible();

    await page.locator('ul[aria-label="Rooms"]').waitFor();
    await page.getByRole("searchbox").first().fill("Reviewer Contact");
    await expect(page.locator(`[data-testid="room-list-item-${roomId}"]`)).toBeVisible();
    await expect(page.getByText("Phase 5 Archived")).toHaveCount(0);

    await page.getByRole("searchbox").first().fill("");
    await page.locator(`[data-testid="room-list-pin-${roomId}"]`).click();
    await expect(page.locator(`[data-testid="room-list-unpin-${roomId}"]`)).toBeVisible();
    await expect(page.locator('[data-testid^="room-list-item-"]').first()).toHaveAttribute("data-testid", `room-list-item-${roomId}`);

    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room Phase 5 IM Actions").click();
    await expect(page.locator('[data-testid="message-bubble-user"]').filter({ hasText: "API base path is /api/v2" })).toBeVisible();
    await expect(page.getByText("Pinned Context")).toHaveCount(0);

    const pinned = await fetch(`${testUrl}/rooms/${roomId}/messages/${messageIds.userContext}/pin`, { method: "POST" });
    expect(pinned.status).toBe(200);
    await expect(page.getByText("Pinned Context")).toBeVisible();
    await page.locator("summary").filter({ hasText: "Pinned Context" }).click();
    await expect(page.locator("details").filter({ hasText: "Pinned Context" }).getByText("API base path is /api/v2")).toBeVisible();

    await openMessageMenu(page, messageIds.userContext);
    await expect(page.getByRole("menuitem", { name: "Reply" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Reply" }).click();
    await expect(page.locator('[data-testid="chat-input-region"]').getByText("API base path is /api/v2")).toBeVisible();

    await openMessageMenu(page, messageIds.userContext);
    await page.getByRole("menuitem", { name: "Quote" }).click();
    await expect(page.locator('[data-testid="message-input"]')).toContainText("> API base path is /api/v2");

    await openMessageMenu(page, messageIds.userContext);
    await expect(page.getByRole("menuitem", { name: "Unpin" })).toBeVisible();
    await page.keyboard.press("Escape");

    await openMessageMenu(page, messageIds.agentEarlier);
    await expect(page.getByRole("menuitem", { name: "Regenerate" })).toHaveCount(0);

    await openMessageMenu(page, messageIds.agentLatest);
    await expect(page.getByRole("menuitem", { name: "Regenerate" })).toBeVisible();
    await page.keyboard.press("Escape");

    const copyButton = page.getByRole("button", { name: "Copy code block" });
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toHaveText("Copy Code");

    const applyDiffMessage = page.locator('[data-message-id="message-v12-action-diff-apply"]');
    const rejectDiffMessage = page.locator('[data-message-id="message-v12-action-diff-reject"]');
    await expect(applyDiffMessage.locator('[data-testid="diff-review-viewer"]')).toBeVisible();
    await expect(rejectDiffMessage.locator('[data-testid="diff-review-viewer"]')).toBeVisible();
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => undefined));
    await applyDiffMessage.getByRole("button", { name: "Apply Diff" }).click();
    await expect.poll(() => daemon.database.sqlite.prepare("SELECT status FROM artifacts WHERE id = 'artifact-v12-diff-apply'").get() as { readonly status: string } | undefined).toMatchObject({ status: "applied" });
    await expect.poll(() => readFileSync(join(workspaceRoot, "src", "phase5-diff-apply.ts"), "utf8")).toBe("export const phase5 = 'applied';\n");

    await rejectDiffMessage.getByRole("button", { name: "Reject", exact: true }).click();
    await expect.poll(() => daemon.database.sqlite.prepare("SELECT status FROM artifacts WHERE id = 'artifact-v12-diff-reject'").get() as { readonly status: string } | undefined).toMatchObject({ status: "rejected" });

    await page.locator('[data-testid="preview-card"]').filter({ hasText: "action-preview.html" }).getByRole("button", { name: "Expand Preview" }).click();
    await expect(page.getByRole("dialog", { name: "Artifact Studio" })).toBeVisible();
  });

  test("passes pinned room context into a subsequent runtime run", async ({ page }) => {
    const roomId = await createRoom(testUrl, {
      title: "Phase 5 Pinned Runtime Context",
      mode: "solo",
      primaryAgentId: "binding-v12-builder",
      agentBindingId: "binding-v12-builder"
    });
    const pinnedMessageId = seedTextMessageWithId(daemon, roomId, "user", "local-user", "user", "PINNED-RUNTIME-CONTEXT-42", Date.now());

    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).getByLabel("Open room Phase 5 Pinned Runtime Context").click();
    const pinned = await fetch(`${testUrl}/rooms/${roomId}/messages/${pinnedMessageId}/pin`, { method: "POST" });
    expect(pinned.status).toBe(200);
    await expect(page.getByText("Pinned Context")).toBeVisible();

    const sent = await fetch(`${testUrl}/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "AGENTHUB_E2E_USE_PINNED_CONTEXT write a short note using the pinned context",
        idempotencyKey: `pinned-runtime-${randomUUID()}`
      })
    });
    expect(sent.status).toBe(200);

    const card = page.locator('[data-testid="document-card"]').filter({ hasText: "pinned-context-result.md" });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => latestRunStatus(daemon, roomId)).toBe("completed");
    await expect.poll(() => {
      const row = daemon.database.sqlite
        .prepare("SELECT af.new_content FROM artifact_files af JOIN artifacts a ON a.id = af.artifact_id WHERE a.room_id = ? AND af.path = 'pinned-context-result.md' ORDER BY a.created_at DESC LIMIT 1")
        .get(roomId) as { readonly new_content: string | null } | undefined;
      return row?.new_content ?? "";
    }).toContain("Used pinned context PINNED-RUNTIME-CONTEXT-42");
  });

  test("drives claude-code and opencode runtime kinds through ACP Room MCP artifact publication", async ({ page }) => {
    await page.goto(testUrl);

    const claudeRoomId = await createRoom(testUrl, {
      title: "Claude Runtime Acceptance",
      mode: "solo",
      primaryAgentId: "binding-v12-builder",
      agentBindingId: "binding-v12-builder"
    });
    await page.locator(`[data-testid="room-list-item-${claudeRoomId}"]`).getByLabel("Open room Claude Runtime Acceptance").click();
    const claudeSent = await fetch(`${testUrl}/rooms/${claudeRoomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Generate a Hello World web page", idempotencyKey: `claude-${randomUUID()}` })
    });
    expect(claudeSent.status).toBe(200);
    await expect(page.locator('[data-testid="preview-card"]').filter({ hasText: "runtime-acceptance.html" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="preview-card"]').filter({ hasText: "Claude Runtime Page" })).toBeVisible();
    await expect.poll(() => latestRunStatus(daemon, claudeRoomId)).toBe("completed");

    await selectRail(page, "Contacts");
    await expect(contactCard(page, "Builder Contact")).toContainText("available");

    const openCodeRoomId = await createRoom(testUrl, {
      title: "OpenCode Runtime Acceptance",
      mode: "solo",
      primaryAgentId: "binding-v12-reviewer",
      agentBindingId: "binding-v12-reviewer"
    });
    await selectRail(page, "Chat");
    await page.locator(`[data-testid="room-list-item-${openCodeRoomId}"]`).getByLabel("Open room OpenCode Runtime Acceptance").click();
    const openCodeSent = await fetch(`${testUrl}/rooms/${openCodeRoomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Generate a Markdown document", idempotencyKey: `opencode-${randomUUID()}` })
    });
    expect(openCodeSent.status).toBe(200);
    await expect(page.locator('[data-testid="document-card"]').filter({ hasText: "runtime-acceptance.md" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="document-card"]').filter({ hasText: "OpenCode Runtime Document" })).toBeVisible();
    await expect.poll(() => latestRunStatus(daemon, openCodeRoomId)).toBe("completed");

    await selectRail(page, "Contacts");
    await expect(contactCard(page, "Reviewer Contact")).toContainText("available");
  });
});

async function selectRail(page: Page, label: "Chat" | "Contacts" | "Runs" | "Tasks" | "Artifacts" | "Settings"): Promise<void> {
  await page.getByRole("navigation", { name: "Workbench navigation" }).getByLabel(label, { exact: true }).click();
}

async function openMessageMenu(page: Page, messageId: string): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.locator(`[data-message-id="${messageId}"]`).hover({ trial: true });
  await page.locator(`[data-message-id="${messageId}"]`).hover();
  await page.locator(`[data-testid="message-menu-${messageId}"]`).click();
}

function contactCard(page: Page, displayName: string) {
  return page
    .getByRole("heading", { name: displayName })
    .locator("xpath=ancestor::div[.//button[normalize-space()='Start Chat'] and .//button[normalize-space()='Test Connection']][1]");
}

function latestRunStatus(daemon: DaemonApp, roomId: string): string | undefined {
  const row = daemon.database.sqlite.prepare("SELECT status FROM runs WHERE room_id = ? ORDER BY created_at DESC LIMIT 1").get(roomId) as { readonly status: string } | undefined;
  return row?.status;
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

function seedPhase5Fixtures(daemon: DaemonApp): void {
  const now = Date.now();
  daemon.database.sqlite.transaction(() => {
    seedSkill(daemon, "skill-v12-web-page", "web-page-builder", now);
    seedRole(daemon, "role-v12-leader", "Leader Contact", ["task.delegate"], now);
    seedRole(daemon, "role-v12-builder", "Builder Contact", ["code.edit", "web-page-builder"], now + 1);
    seedRole(daemon, "role-v12-reviewer", "Reviewer Contact", ["code.review"], now + 2);
    seedRole(daemon, "role-v12-codex", "Codex Contact", ["experimental"], now + 3);
    seedRuntime(daemon, "runtime-v12-claude", "claude-code", "Claude Code Runtime", "available", "1.2.3", now);
    seedRuntime(daemon, "runtime-v12-opencode", "opencode", "OpenCode Runtime", "available", "2.0.0", now + 1);
    seedRuntime(daemon, "runtime-v12-codex", "codex", "Codex Runtime", "ready", "0.9.0", now + 2);
    seedBinding(daemon, "binding-v12-leader", "role-v12-leader", "runtime-v12-claude", "Leader Contact", "Coordinates team rooms.", undefined, now);
    seedBinding(daemon, "binding-v12-builder", "role-v12-builder", "runtime-v12-claude", "Builder Contact", "Builds web artifacts.", "https://example.invalid/avatar-builder.png", now + 1);
    seedBinding(daemon, "binding-v12-reviewer", "role-v12-reviewer", "runtime-v12-opencode", "Reviewer Contact", "Reviews output quality.", undefined, now + 2);
    seedBinding(daemon, "binding-v12-codex", "role-v12-codex", "runtime-v12-codex", "Codex Contact", "Experimental runtime contact.", undefined, now + 3);
    seedArtifactRecord(daemon, {
      roomId: null,
      artifactId: "artifact-v12-library",
      messageId: null,
      title: "Phase 5 Artifact",
      path: "phase5.html",
      content: "<main><h1>Phase 5 Artifact</h1></main>",
      createdAt: now
    });
    daemon.database.sqlite
      .prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room-v12-archived', 'default-workspace', 'Phase 5 Archived', 'solo', 'conversation', 'binding-v12-builder', ?, ?, ?)")
      .run(now, now, now);
  })();
}

function seedSkill(daemon: DaemonApp, id: string, name: string, now: number): void {
  daemon.database.sqlite
    .prepare("INSERT OR IGNORE INTO skills (id, workspace_id, name, description, content, origin, source_url, created_at, updated_at) VALUES (?, 'default-workspace', ?, 'Phase 5 E2E skill', '---', 'builtin', NULL, ?, ?)")
    .run(id, name, now, now);
}

function seedRole(daemon: DaemonApp, id: string, name: string, capabilities: readonly string[], now: number): void {
  daemon.database.sqlite
    .prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, 'default-workspace', ?, NULL, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?)")
    .run(id, name, `${name} description`, `${name} prompt`, JSON.stringify(capabilities), now, now);
}

function seedRuntime(daemon: DaemonApp, id: string, kind: string, name: string, status: string, version: string, now: number): void {
  daemon.database.sqlite
    .prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, 'default-workspace', ?, ?, NULL, NULL, NULL, ?, NULL, ?, '[]', ?, ?, '{}', ?, ?)")
    .run(id, kind, name, now, version, version, status, now, now);
}

function seedBinding(daemon: DaemonApp, id: string, roleId: string, runtimeId: string, contactName: string, description: string, avatarUrl: string | undefined, now: number): void {
  daemon.database.sqlite
    .prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, avatar_url, contact_name, contact_description, created_at, updated_at) VALUES (?, 'default-workspace', ?, ?, NULL, NULL, ?, ?, ?, ?, ?)")
    .run(id, roleId, runtimeId, avatarUrl ?? null, contactName, description, now, now);
}

function seedGroupChatTranscript(daemon: DaemonApp, roomId: string): string {
  const now = Date.now();
  const artifactId = `artifact-v12-group-${randomUUID()}`;
  daemon.database.sqlite.transaction(() => {
    seedTextMessage(daemon, roomId, "message-v12-group-user", "user", "local-user", "user", "@builder-contact @reviewer-contact Ship the landing page", now);
    seedTextMessage(daemon, roomId, "message-v12-dispatch-builder", "system", "orchestrator", "system", "Assigned task \"Build landing page\" to Builder Contact", now + 1);
    seedTextMessage(daemon, roomId, "message-v12-dispatch-reviewer", "system", "orchestrator", "system", "Assigned task \"Review landing page\" to Reviewer Contact", now + 2);
    seedTextMessage(daemon, roomId, "message-v12-builder-summary", "agent", "binding-v12-builder", "assistant", `I published the landing page as @artifact:${artifactId}.`, now + 3);
    seedArtifactRecord(daemon, {
      roomId,
      artifactId,
      messageId: "message-v12-builder-summary",
      title: "phase5-landing.html",
      path: "phase5-landing.html",
      content: "<main><h1>Group chat landing</h1></main>",
      createdAt: now + 3
    });
    seedCardPart(daemon, roomId, "message-v12-builder-summary", {
      type: "card",
      seq: 2,
      card: {
        type: "artifact",
        artifactId,
        kind: "web_page",
        title: "phase5-landing.html",
        version: 1
      }
    }, now + 4);
    seedTextMessage(daemon, roomId, "message-v12-reviewer-failed", "system", "orchestrator", "system", "Reviewer Contact failed: runtime timeout. Decision: skipped", now + 5);
    seedTextMessage(daemon, roomId, "message-v12-leader-summary", "agent", "binding-v12-leader", "assistant", `Summary: Builder completed the landing page at @artifact:${artifactId}; reviewer timed out and was skipped.`, now + 6);
  })();
  return artifactId;
}

function seedMessageActionTranscript(daemon: DaemonApp, roomId: string, workspaceRoot: string): { readonly userContext: string; readonly agentEarlier: string; readonly agentLatest: string } {
  const now = Date.now();
  const artifactId = `artifact-v12-action-${randomUUID()}`;
  const userContext = "message-v12-action-user";
  const agentEarlier = "message-v12-action-agent-earlier";
  const agentLatest = "message-v12-action-agent-latest";
  daemon.database.sqlite.transaction(() => {
    seedTextMessage(daemon, roomId, userContext, "user", "local-user", "user", "API base path is /api/v2", now);
    seedTextMessage(daemon, roomId, agentEarlier, "agent", "binding-v12-builder", "assistant", "Earlier agent answer", now + 1);
    seedTextMessage(daemon, roomId, "message-v12-action-code", "agent", "binding-v12-builder", "assistant", "```ts\nconst apiBase = '/api/v2';\n```", now + 2);
    seedTextMessage(daemon, roomId, "message-v12-action-diff-apply", "agent", "binding-v12-builder", "assistant", "Apply this reviewed diff.", now + 3);
    seedDiffArtifactRecord(daemon, workspaceRoot, {
      roomId,
      artifactId: "artifact-v12-diff-apply",
      messageId: "message-v12-action-diff-apply",
      path: "src/phase5-diff-apply.ts",
      oldContent: "export const phase5 = 'old';\n",
      newContent: "export const phase5 = 'applied';\n",
      createdAt: now + 3
    });
    seedCardPart(daemon, roomId, "message-v12-action-diff-apply", {
      type: "card",
      seq: 2,
      card: {
        type: "diff",
        artifactId: "artifact-v12-diff-apply",
        applyStatus: "reviewing",
        files: [{ path: "src/phase5-diff-apply.ts", additions: 1, deletions: 1, status: "modified" }]
      }
    }, now + 4);
    seedTextMessage(daemon, roomId, "message-v12-action-diff-reject", "agent", "binding-v12-reviewer", "assistant", "Reject this alternate diff.", now + 5);
    seedDiffArtifactRecord(daemon, workspaceRoot, {
      roomId,
      artifactId: "artifact-v12-diff-reject",
      messageId: "message-v12-action-diff-reject",
      path: "src/phase5-diff-reject.ts",
      oldContent: "export const phase5 = 'keep';\n",
      newContent: "export const phase5 = 'reject';\n",
      createdAt: now + 5
    });
    seedCardPart(daemon, roomId, "message-v12-action-diff-reject", {
      type: "card",
      seq: 2,
      card: {
        type: "diff",
        artifactId: "artifact-v12-diff-reject",
        applyStatus: "reviewing",
        files: [{ path: "src/phase5-diff-reject.ts", additions: 1, deletions: 1, status: "modified" }]
      }
    }, now + 6);
    seedTextMessage(daemon, roomId, agentLatest, "agent", "binding-v12-reviewer", "assistant", "Latest agent answer with preview", now + 7);
    seedArtifactRecord(daemon, {
      roomId,
      artifactId,
      messageId: agentLatest,
      title: "action-preview.html",
      path: "action-preview.html",
      content: "<main><h1>Action preview</h1></main>",
      createdAt: now + 7
    });
    seedCardPart(daemon, roomId, agentLatest, {
      type: "card",
      seq: 2,
      card: {
        type: "artifact",
        artifactId,
        kind: "web_page",
        title: "action-preview.html",
        version: 1
      }
    }, now + 8);
  })();
  return { userContext, agentEarlier, agentLatest };
}

function seedTextMessage(daemon: DaemonApp, roomId: string, messageId: string, senderType: "user" | "agent" | "system", senderId: string, role: "user" | "assistant" | "system", text: string, createdAt: number): void {
  daemon.database.sqlite
    .prepare(
      `INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at)
       VALUES (?, 'default-workspace', ?, ?, ?, NULL, ?, 'completed', NULL, 'immediate', NULL, ?, ?, NULL)`
    )
    .run(messageId, roomId, senderType, senderId, role, createdAt, createdAt);
  daemon.database.sqlite
    .prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)")
    .run(messageId, JSON.stringify({ text, mentions: [] }), createdAt);
  daemon.eventBus.publish({
    id: randomUUID(),
    type: "message.created",
    schemaVersion: 1,
    workspaceId: "default-workspace",
    roomId,
    ...(senderType === "agent" ? { agentId: senderId } : {}),
    payload: { roomId, messageId, text, senderId, senderType, role, status: "completed" },
    createdAt
  });
  daemon.eventBus.publish({
    id: randomUUID(),
    type: "message.completed",
    schemaVersion: 1,
    workspaceId: "default-workspace",
    roomId,
    ...(senderType === "agent" ? { agentId: senderId } : {}),
    payload: { roomId, messageId, text },
    createdAt
  });
}

function seedTextMessageWithId(daemon: DaemonApp, roomId: string, senderType: "user" | "agent" | "system", senderId: string, role: "user" | "assistant" | "system", text: string, createdAt: number): string {
  const messageId = `message-v12-${randomUUID()}`;
  daemon.database.sqlite.transaction(() => {
    seedTextMessage(daemon, roomId, messageId, senderType, senderId, role, text, createdAt);
  })();
  return messageId;
}

function seedCardPart(daemon: DaemonApp, roomId: string, messageId: string, part: Record<string, unknown>, createdAt: number): void {
  daemon.database.sqlite
    .prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 2, 'card', ?, ?)")
    .run(messageId, JSON.stringify(part), createdAt);
  daemon.eventBus.publish({
    id: randomUUID(),
    type: "message.part.added",
    schemaVersion: 1,
    workspaceId: "default-workspace",
    roomId,
    payload: { messageId, part },
    createdAt
  });
}

function seedArtifactRecord(daemon: DaemonApp, input: { readonly roomId: string | null; readonly artifactId: string; readonly messageId: string | null; readonly title: string; readonly path: string; readonly content: string; readonly createdAt: number }): void {
  daemon.database.sqlite
    .prepare("INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES (?, 'default-workspace', ?, NULL, NULL, ?, 'file', 'web_page', ?, 'ready', 'phase5_e2e', '{}', ?, ?)")
    .run(input.artifactId, input.roomId, input.messageId, input.title, input.createdAt, input.createdAt);
  daemon.database.sqlite
    .prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_path, binary, no_newline_at_end, old_sha256, new_sha256, applied_state, content_path, created_at) VALUES (?, ?, NULL, ?, NULL, 1, 0, 'added', NULL, 0, 0, NULL, NULL, NULL, NULL, ?)")
    .run(input.artifactId, input.path, input.content, input.createdAt);
}

function seedDiffArtifactRecord(daemon: DaemonApp, workspaceRoot: string, input: { readonly roomId: string; readonly artifactId: string; readonly messageId: string; readonly path: string; readonly oldContent: string; readonly newContent: string; readonly createdAt: number }): void {
  const target = join(workspaceRoot, input.path);
  mkdirSync(join(workspaceRoot, "src"), { recursive: true });
  writeFileSync(target, input.oldContent);
  daemon.database.sqlite
    .prepare("INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES (?, 'default-workspace', ?, NULL, NULL, ?, 'diff', NULL, ?, 'reviewing', 'phase5_e2e', '{}', ?, ?)")
    .run(input.artifactId, input.roomId, input.messageId, input.path, input.createdAt, input.createdAt);
  daemon.database.sqlite
    .prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_path, binary, no_newline_at_end, old_sha256, new_sha256, applied_state, content_path, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, 'modified', NULL, 0, 0, NULL, NULL, NULL, NULL, ?)")
    .run(input.artifactId, input.path, input.oldContent, input.newContent, diffPatch(input.path, input.oldContent, input.newContent), input.createdAt);
}

function diffPatch(path: string, oldContent: string, newContent: string): string {
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${oldContent.trimEnd()}`,
    `+${newContent.trimEnd()}`
  ].join("\n");
}

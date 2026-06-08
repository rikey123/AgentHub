import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon, type DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("V1.2 RoomList and Pinned Context live updates", () => {
  let daemon: DaemonApp;
  let testUrl: string;
  let closeServer: () => void;

  test.beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-web-e2e-"));
    daemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0 });
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

  test("updates RoomList and Pinned Context from live pin events without refresh", async ({ page }) => {
    const contactBindingId = seedContactBinding(daemon, "Builder Contact");
    const contactRoomId = await createRoom(testUrl, {
      title: "Contact Live Room",
      mode: "solo",
      primaryAgentId: contactBindingId
    });
    const contactMessageId = seedCompletedUserMessage(daemon, contactRoomId, "API base path is /api/v2", Date.now());

    const otherRoomId = await createRoom(testUrl, {
      title: "Other Live Room",
      mode: "solo",
      primaryAgentId: "mock-builder"
    });
    seedCompletedUserMessage(daemon, otherRoomId, "A newer room activity entry", Date.now() + 1);

    await page.goto(testUrl);
    await expect(page.locator(`[data-testid="room-list-item-${contactRoomId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="room-list-item-${otherRoomId}"]`)).toBeVisible();
    await expect(page.getByText("Builder Contact")).toBeVisible();

    const search = page.getByLabel("搜索房间");
    await search.fill("Builder Contact");
    await expect(page.locator(`[data-testid="room-list-item-${contactRoomId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="room-list-item-${otherRoomId}"]`)).toHaveCount(0);

    await search.fill("");
    await expect(page.locator(`[data-testid="room-list-item-${otherRoomId}"]`)).toBeVisible();
    await expect(page.locator('[data-testid^="room-list-item-"]').first()).toHaveAttribute("data-testid", `room-list-item-${otherRoomId}`);

    await page.locator(`[data-testid="room-list-pin-${contactRoomId}"]`).click();
    await expect(page.locator(`[data-testid="room-list-unpin-${contactRoomId}"]`)).toBeVisible();
    await expect(page.locator('[data-testid^="room-list-item-"]').first()).toHaveAttribute("data-testid", `room-list-item-${contactRoomId}`);

    await page.locator(`[data-testid="room-list-item-${contactRoomId}"]`).getByLabel("Open room Contact Live Room").click();
    await expect(page.locator('[data-testid="message-bubble-user"]').filter({ hasText: "API base path is /api/v2" })).toBeVisible();
    await expect(page.getByText("Pinned Context")).toHaveCount(0);

    const pinned = await fetch(`${testUrl}/rooms/${contactRoomId}/messages/${contactMessageId}/pin`, { method: "POST" });
    expect(pinned.status).toBe(200);

    await expect(page.getByText("Pinned Context")).toBeVisible();
    await expect(page.getByText("1 pinned")).toBeVisible();
    await page.locator("summary").filter({ hasText: "Pinned Context" }).click();
    await expect(page.locator("details").filter({ hasText: "Pinned Context" }).getByText("API base path is /api/v2")).toBeVisible();

    await page.getByRole("button", { name: `Unpin pinned message ${contactMessageId}` }).click();
    await expect(page.getByText("Pinned Context")).toHaveCount(0);
  });
});

function seedContactBinding(daemon: DaemonApp, contactName: string): string {
  const now = Date.now();
  const suffix = randomUUID();
  const roleId = `role-v12-contact-${suffix}`;
  const runtimeId = `runtime-v12-contact-${suffix}`;
  const bindingId = `binding-v12-contact-${suffix}`;

  daemon.database.sqlite.transaction(() => {
    daemon.database.sqlite
      .prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, 'default-workspace', 'Builder Role', NULL, NULL, 'Build', '[]', NULL, NULL, 0, NULL, NULL, ?, ?)")
      .run(roleId, now, now);
    daemon.database.sqlite
      .prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, 'default-workspace', 'mock', 'Mock Runtime', NULL, NULL, NULL, NULL, NULL, NULL, '[]', NULL, 'ready', '{}', ?, ?)")
      .run(runtimeId, now, now);
    daemon.database.sqlite
      .prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, avatar_url, contact_name, contact_description, created_at, updated_at) VALUES (?, 'default-workspace', ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?)")
      .run(bindingId, roleId, runtimeId, contactName, now, now);
  })();

  return bindingId;
}

async function createRoom(testUrl: string, body: { readonly title: string; readonly mode: string; readonly primaryAgentId: string }): Promise<string> {
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

function seedCompletedUserMessage(daemon: DaemonApp, roomId: string, text: string, createdAt: number): string {
  const messageId = `message-v12-${randomUUID()}`;

  // Leave rooms.last_activity_at untouched so the E2E proves replayed message
  // events can hydrate activity ordering before the live pin events are tested.
  daemon.database.sqlite.transaction(() => {
    daemon.database.sqlite
      .prepare(
        `INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at)
         VALUES (?, 'default-workspace', ?, 'user', 'local-user', NULL, 'user', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)`
      )
      .run(messageId, roomId, createdAt, createdAt);
    daemon.database.sqlite
      .prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)")
      .run(messageId, JSON.stringify({ text, mentions: [] }), createdAt);
    daemon.eventBus.publish({
      id: randomUUID(),
      type: "message.created",
      schemaVersion: 1,
      workspaceId: "default-workspace",
      roomId,
      payload: { roomId, messageId, text, senderId: "local-user", senderType: "user", role: "user" },
      createdAt
    });
    daemon.eventBus.publish({
      id: randomUUID(),
      type: "message.completed",
      schemaVersion: 1,
      workspaceId: "default-workspace",
      roomId,
      payload: { roomId, messageId, text },
      createdAt
    });
  })();

  return messageId;
}

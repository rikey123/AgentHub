import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon, type DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("chat layout", () => {
  let daemon: DaemonApp;
  let testUrl: string;
  let closeServer: () => void;

  test.beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-chat-layout-"));
    daemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0 });
    const result = await startTestServer(daemon);
    testUrl = result.url;
    closeServer = result.close;
    seedBusyRoom(daemon, "room_layout");
  });

  test.afterEach(async () => {
    closeServer();
    await Promise.race([
      daemon.close(),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  });

  test("keeps the composer visible when the conversation is long", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(testUrl);
    await page.locator('[data-testid="room-list-item-room_layout"]').click();

    const input = page.getByRole("textbox", { name: "Message" });
    await expect(input).toBeVisible();

    const inputBox = await input.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(720);

    await input.fill("still usable");
    await expect(input).toHaveValue("still usable");
  });
});

function seedBusyRoom(daemon: DaemonApp, roomId: string): void {
  const db = daemon.database.sqlite;
  const now = Date.now();
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('default-workspace', 'Default', '.', ?, ?)").run(now, now);
    db.prepare("INSERT OR IGNORE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_layout', 'default-workspace', 'Layout Agent', 'mock', 'mock', '', '[]', NULL, 0, NULL, ?, ?)").run(now, now);
    db.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, 'default-workspace', 'Layout Stress Room', 'solo', 'conversation', 'agent_layout', NULL, ?, ?)").run(roomId, now, now);
    db.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, 'agent_layout', 'agent', 'primary', 'mock', NULL, 'active', ?)").run(roomId, now);
    daemon.eventBus.publish({ id: "evt_room_layout", type: "room.created", schemaVersion: 1, workspaceId: "default-workspace", roomId, payload: { roomId, title: "Layout Stress Room", mode: "solo" }, createdAt: now });
    daemon.eventBus.publish({ id: "evt_agent_layout", type: "agent.joined", schemaVersion: 1, workspaceId: "default-workspace", roomId, agentId: "agent_layout", payload: { roomId, agentId: "agent_layout", agentName: "Layout Agent", role: "primary", adapterId: "mock" }, createdAt: now + 1 });
    for (let i = 0; i < 80; i += 1) {
      const messageId = `layout_msg_${i}`;
      const role = i % 2 === 0 ? "user" : "assistant";
      const senderType = role === "user" ? "user" : "agent";
      const senderId = role === "user" ? "local" : "agent_layout";
      const createdAt = now + 10 + i;
      const text = `Message ${i + 1}: this row is intentionally long enough to create a tall transcript and exercise the scroll container.`;
      db.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'default-workspace', ?, ?, ?, NULL, ?, 'completed', NULL, 'immediate', NULL, ?, ?, NULL)").run(messageId, roomId, senderType, senderId, role, createdAt, createdAt);
      db.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(messageId, JSON.stringify({ text }), createdAt);
      daemon.eventBus.publish({ id: `evt_${messageId}_created`, type: "message.created", schemaVersion: 1, workspaceId: "default-workspace", roomId, ...(role === "assistant" ? { agentId: "agent_layout" } : {}), payload: { messageId, role, senderId, text }, createdAt });
      daemon.eventBus.publish({ id: `evt_${messageId}_completed`, type: "message.completed", schemaVersion: 1, workspaceId: "default-workspace", roomId, ...(role === "assistant" ? { agentId: "agent_layout" } : {}), payload: { messageId, text }, createdAt });
    }
  })();
}

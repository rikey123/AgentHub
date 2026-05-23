import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon } from "@agenthub/daemon";
import type { DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("pending turn UI", () => {
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

  test("queue limit banner appears at 20 messages", async ({ page }) => {
    const roomRes = await fetch(`${testUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Limit Room", mode: "solo", primaryAgentId: "mock-builder" })
    });
    const roomData = (await roomRes.json()) as { data: { roomId: string } };
    const roomId = roomData.data.roomId;

    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      const msgId = `msg-limit-${i}`;
      const ptId = `pt-limit-${i}`;
      daemon.database.sqlite
        .prepare(
          `INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at)
           VALUES (?, 'default-workspace', ?, 'user', 'user', NULL, 'user', 'completed', NULL, 'pending', ?, ?, ?, NULL)`
        )
        .run(msgId, roomId, ptId, now + i, now + i);
      daemon.database.sqlite
        .prepare(
          `INSERT INTO pending_turns (id, room_id, user_message_id, primary_agent_id, status, enqueued_at, scheduled_at, cancelled_at, notes)
           VALUES (?, ?, ?, 'mock-builder', 'queued', ?, NULL, NULL, NULL)`
        )
        .run(ptId, roomId, msgId, now + i);
      // Publish events so the web app receives them via SSE replay
      daemon.eventBus.publish({
        id: randomUUID(),
        type: "message.created",
        schemaVersion: 1,
        workspaceId: "default-workspace",
        roomId,
        payload: { messageId: msgId, text: `msg ${i}`, senderId: "user", turnDispatchMode: "pending" },
        createdAt: now + i
      });
      daemon.eventBus.publish({
        id: randomUUID(),
        type: "message.completed",
        schemaVersion: 1,
        workspaceId: "default-workspace",
        roomId,
        payload: { messageId: msgId, text: `msg ${i}` },
        createdAt: now + i
      });
      daemon.eventBus.publish({
        id: randomUUID(),
        type: "pending_turn.created",
        schemaVersion: 1,
        workspaceId: "default-workspace",
        roomId,
        payload: { messageId: msgId, pendingTurnId: ptId },
        createdAt: now + i
      });
    }

    await page.goto(testUrl);
    await page.waitForSelector("text=Limit Room");
    await page.click("text=Limit Room");
    await page.waitForSelector("text=Queue limit reached", { timeout: 5000 });
    await page.waitForSelector("text=queued (1)", { timeout: 5000 });
    await page.waitForSelector("text=Cancel", { timeout: 5000 });
    const textarea = page.locator("textarea");
    await expect(textarea).toHaveAttribute("placeholder", /Queue full/i);
  });
});

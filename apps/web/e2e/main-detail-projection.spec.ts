import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon } from "@agenthub/daemon";
import type { DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("main timeline and run detail projection", () => {
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
    // Force-close daemon with a timeout so afterEach never hangs
    await Promise.race([
      daemon.close(),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  });

  test("main timeline shows messages and hides tool details", async ({ page }) => {
    const roomRes = await fetch(`${testUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Test Room", mode: "solo", primaryAgentId: "mock-builder" })
    });
    const roomData = (await roomRes.json()) as { data: { roomId: string } };
    const roomId = roomData.data.roomId;

    await fetch(`${testUrl}/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello", idempotencyKey: "e2e-1" })
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.goto(testUrl);
    await page.waitForSelector("text=Test Room");
    await page.click("text=Test Room");
    await page.waitForSelector("text=hello");
    const toolCall = await page.locator("text=tool_call").count();
    expect(toolCall).toBe(0);
  });

  test("browser UI bootstraps auth session and sends CSRF on room/message mutations", async ({ page }) => {
    const mutatingRequests: { readonly url: string; readonly method: string; readonly csrf: string | null; readonly contentType: string | null }[] = [];
    page.on("request", (request) => {
      const method = request.method();
      const path = new URL(request.url()).pathname;
      if ((method === "POST" || method === "PATCH" || method === "DELETE") && path !== "/auth/session") {
        mutatingRequests.push({ url: path, method, csrf: request.headers()["x-agenthub-csrf"] ?? null, contentType: request.headers()["content-type"] ?? null });
      }
    });

    await page.goto(testUrl);
    await page.getByRole("button", { name: /new room/i }).click();
    await page.waitForSelector("text=New Room");
    await page.locator("textarea").fill("browser csrf hello");
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForSelector("text=browser csrf hello");

    expect(mutatingRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: "/rooms", method: "POST" }),
      expect.objectContaining({ url: expect.stringMatching(/^\/rooms\/[^/]+\/messages$/u), method: "POST" })
    ]));
    expect(mutatingRequests.every((request) => request.csrf && request.csrf.length > 20)).toBe(true);
    expect(mutatingRequests.every((request) => request.contentType?.includes("application/json"))).toBe(true);
  });

  test("run detail opens from side panel with 7 tabs", async ({ page }) => {
    const roomRes = await fetch(`${testUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Run Room", mode: "solo", primaryAgentId: "mock-builder" })
    });
    const roomData = (await roomRes.json()) as { data: { roomId: string } };
    const roomId = roomData.data.roomId;

    await fetch(`${testUrl}/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "trigger run", idempotencyKey: "e2e-run" })
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.goto(testUrl);
    await page.waitForSelector("text=Run Room");
    await page.click("text=Run Room");
    await page.waitForSelector("text=trigger run");

    // Open Runs tab in side panel
    await page.click("text=Runs");
    await page.waitForSelector("text=completed", { timeout: 5000 });
    await page.click("text=completed");

    // Run detail should open with 7 tabs
    await page.waitForSelector('[data-testid="run-detail-tab-transcript"]');
    await page.waitForSelector('[data-testid="run-detail-tab-tools"]');
    await page.waitForSelector('[data-testid="run-detail-tab-context"]');
    await page.waitForSelector('[data-testid="run-detail-tab-permissions"]');
    await page.waitForSelector('[data-testid="run-detail-tab-artifacts"]');
    await page.waitForSelector('[data-testid="run-detail-tab-raw"]');
    await page.waitForSelector('[data-testid="run-detail-tab-cost"]');

    // Click through tabs
    await page.click('[data-testid="run-detail-tab-tools"]');
    await page.click('[data-testid="run-detail-tab-context"]');
    await page.click('[data-testid="run-detail-tab-permissions"]');
    await page.click('[data-testid="run-detail-tab-artifacts"]');
    await page.click('[data-testid="run-detail-tab-raw"]');
    await page.waitForSelector('[data-testid="raw-stream-content"]');
    const rawText = await page.locator('[data-testid="raw-stream-content"]').textContent();
    expect(rawText).toBe("Raw stream content requires admin scope or debug mode.");
    await page.click('[data-testid="run-detail-tab-cost"]');

    // Close run detail
    await page.click("[aria-label='Close run detail']");
    await expect(page.locator("text=Run Detail")).not.toBeVisible();
  });

  test("raw stream tab renders live adapter raw lines for admin-authorized sessions", async ({ page }) => {
    const { createHash } = await import("node:crypto");
    const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
    daemon.database.sqlite.prepare("INSERT INTO auth_tokens (id, fingerprint, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)").run("e2e_admin", "e2e-admin", sha256("e2e-admin-token"), JSON.stringify(["admin"]), 1);

    const roomRes = await fetch(`${testUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Raw Room", mode: "solo", primaryAgentId: "mock-builder" })
    });
    const roomData = (await roomRes.json()) as { data: { roomId: string } };
    const roomId = roomData.data.roomId;

    await fetch(`${testUrl}/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "trigger raw", idempotencyKey: "e2e-raw" })
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    await page.goto(testUrl);
    await page.waitForSelector("text=Raw Room");
    await page.click("text=Raw Room");
    await page.waitForSelector("text=trigger raw");

    await page.click("text=Runs");
    await page.waitForSelector("text=completed", { timeout: 5000 });
    await page.locator("text=completed").first().click();

    // Set admin bearer token so the raw stream fetch sends Authorization header
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__AGENTHUB_RAW_TOKEN__ = "e2e-admin-token";
    });

    // Observe raw SSE requests to verify auth header and no token leakage
    const rawRequests: { readonly url: string; readonly authorization: string | undefined }[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/event" && url.searchParams.get("view") === "raw") {
        rawRequests.push({ url: request.url(), authorization: request.headers()["authorization"] });
      }
    });

    await page.click('[data-testid="run-detail-tab-raw"]');
    await page.waitForSelector('[data-testid="raw-stream-content"]');

    const runs = daemon.database.sqlite.prepare("SELECT id FROM runs WHERE room_id = ?").all(roomId) as { readonly id: string }[];
    const runId = runs[0]?.id;
    if (!runId) throw new Error("No run found");

    // Give the raw stream fetch time to connect before publishing the live event
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify auth header is sent and token is not leaked in query params
    expect(rawRequests.length).toBeGreaterThanOrEqual(1);
    const firstRaw = rawRequests[0]!;
    expect(firstRaw.authorization).toBe("Bearer e2e-admin-token");
    expect(new URL(firstRaw.url).searchParams.has("token")).toBe(false);

    daemon.eventBus.publish({
      id: "e2e-raw-stdout",
      type: "adapter.raw.stdout",
      schemaVersion: 1,
      workspaceId: "default-workspace",
      roomId,
      runId,
      agentId: "mock-builder",
      payload: { line: "live raw stdout line", stream: "stdout" },
      createdAt: Date.now()
    });

    daemon.eventBus.publish({
      id: "e2e-raw-stderr",
      type: "adapter.raw.stderr",
      schemaVersion: 1,
      workspaceId: "default-workspace",
      roomId,
      runId,
      agentId: "mock-builder",
      payload: { line: "live raw stderr line", stream: "stderr" },
      createdAt: Date.now()
    });

    await page.waitForSelector("text=live raw stdout line", { timeout: 3000 });
    await page.waitForSelector("text=live raw stderr line", { timeout: 3000 });
  });
});

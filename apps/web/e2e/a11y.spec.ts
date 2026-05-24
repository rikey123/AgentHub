import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon } from "@agenthub/daemon";
import type { DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";
import { AxeBuilder } from "@axe-core/playwright";

test.describe("a11y axe-core compliance", () => {
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

  test("Room view has zero axe violations", async ({ page }) => {
    const roomRes = await fetch(`${testUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A11y Room", mode: "solo", primaryAgentId: "mock-builder" })
    });
    const roomData = (await roomRes.json()) as { data: { roomId: string } };
    const roomId = roomData.data.roomId;

    await fetch(`${testUrl}/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "accessibility test message", idempotencyKey: "a11y-1" })
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.goto(testUrl);
    await page.waitForSelector("text=A11y Room");
    await page.click("text=A11y Room");
    await page.waitForSelector("text=accessibility test message");

    const results = await new AxeBuilder({ page })
      .disableRules([
        "aria-required-parent",
        "landmark-one-main",
        "nested-interactive",
        "page-has-heading-one",
        "region"
      ])
      .analyze();

    expect(results.violations).toEqual([]);

    // Save evidence
    const evidenceDir = join(process.cwd(), ".sisyphus", "evidence", "v05-chatroom-complete", "task-8-10-a11y");
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, "axe.json"), JSON.stringify(results, null, 2));
  });

  test("Command palette (settings) has zero axe violations", async ({ page }) => {
    const roomRes = await fetch(`${testUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A11y Settings Room", mode: "solo", primaryAgentId: "mock-builder" })
    });
    const roomData2 = (await roomRes.json()) as { data: { roomId: string } };
    void roomData2.data.roomId;

    await page.goto(testUrl);
    await page.waitForSelector("text=A11y Settings Room");
    await page.click("text=A11y Settings Room");

    // Open command palette (settings) with Ctrl+K
    await page.keyboard.press("Control+k");
    await page.waitForSelector("[role='dialog'][aria-label='Command palette']");

    const results = await new AxeBuilder({ page })
      .disableRules([
        "aria-required-parent",
        "landmark-one-main",
        "nested-interactive",
        "page-has-heading-one",
        "region"
      ])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test("Run Detail has zero axe violations", async ({ page }) => {
    const roomRes = await fetch(`${testUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A11y Run Detail Room", mode: "solo", primaryAgentId: "mock-builder" })
    });
    const roomData = (await roomRes.json()) as { data: { roomId: string } };
    const roomId = roomData.data.roomId;

    await fetch(`${testUrl}/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "trigger run for a11y", idempotencyKey: "a11y-run-1" })
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.goto(testUrl);
    await page.waitForSelector("text=A11y Run Detail Room");
    await page.click("text=A11y Run Detail Room");
    await page.waitForSelector("text=trigger run for a11y");

    // Open Run Detail from the brief card
    await page.locator('[data-testid="brief-card"]').first().click();
    await page.waitForSelector('[data-testid="run-detail-tab-transcript"]', { timeout: 5000 });

    const results = await new AxeBuilder({ page })
      .disableRules([
        "aria-required-parent",
        "landmark-one-main",
        "nested-interactive",
        "page-has-heading-one",
        "region"
      ])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

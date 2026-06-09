import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon, type DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("V1.0 settings connectivity", () => {
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

  test("models and runtimes settings write through CSRF-protected daemon routes", async ({ page }) => {
    const mutatingRequests: Array<{ readonly path: string; readonly method: string; readonly csrf: string | null }> = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      const method = request.method();
      if (path === "/auth/session" || !["POST", "PATCH", "DELETE"].includes(method)) return;
      mutatingRequests.push({ path, method, csrf: request.headers()["x-agenthub-csrf"] ?? null });
    });

    await page.goto(testUrl);
    await page.getByLabel("Settings").click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

    await page.locator('[data-testid="settings-tab-models"]').click();
    await page.locator('[data-testid="models-add-button"]').click();
    await chooseNativeSelect(page, "model-provider-select", "ollama");
    await page.getByLabel("名称").fill("Local Ollama");
    await page.getByLabel("模型 ID").fill("llama3.2");
    await page.getByLabel("Base URL").fill("http://127.0.0.1:11434/v1");
    await page.getByRole("button", { name: "保存模型" }).click();
    await expect(page.locator('[data-testid^="model-config-"]').filter({ hasText: "Local Ollama" })).toBeVisible();

    await page.locator('[data-testid="settings-tab-runtimes"]').click();
    await expect(page.locator('[data-testid="runtime-card-native-default"]')).toContainText("已连接");
    await page.locator('[data-testid="runtime-card-native-default"]').getByRole("button", { name: "测试连接" }).click();
    await expect.poll(
      () => mutatingRequests.some((request) => request.path === "/runtimes/native-default/test" && request.method === "POST")
    ).toBe(true);
    await expect(page.locator('[data-testid="runtime-card-native-default"]')).toContainText("已连接");

    expect(mutatingRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/model-configs", method: "POST" }),
      expect.objectContaining({ path: "/runtimes/native-default/test", method: "POST" })
    ]));
    expect(mutatingRequests.every((request) => request.csrf && request.csrf.length > 20)).toBe(true);
  });
});

async function chooseNativeSelect(page: Page, testId: string, value: string): Promise<void> {
  await page.locator(`[data-testid="${testId}"]`).selectOption(value);
}

import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon, type DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("settings roles layout", () => {
  let daemon: DaemonApp;
  let testUrl: string;
  let closeServer: () => void;

  test.beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-settings-roles-layout-"));
    daemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0 });
    const result = await startTestServer(daemon);
    testUrl = result.url;
    closeServer = result.close;
    seedRole(daemon);
  });

  test.afterEach(async () => {
    closeServer();
    await Promise.race([daemon.close(), new Promise((resolve) => setTimeout(resolve, 2000))]);
  });

  test("keeps the role editor inside the settings viewport on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto(`${testUrl}/?settings=roles`);

    await expect(page.locator('[data-testid="settings-panel-roles"]')).toBeVisible();
    await expect(page.locator('[data-testid="roles-save"]')).toBeVisible();

    const metrics = await page.evaluate(() => {
      const saveButton = document.querySelector('[data-testid="roles-save"]');
      const editorCard = saveButton?.closest(".card");
      const editorContent = editorCard?.querySelector(".card__content");
      const settingsScroll = document
        .querySelector('[data-testid="settings-panel-roles"]')
        ?.closest(".scroll-shadow");
      if (!saveButton || !editorCard || !editorContent || !settingsScroll) {
        throw new Error("missing roles layout elements");
      }
      const editorBox = editorCard.getBoundingClientRect();
      const saveBox = saveButton.getBoundingClientRect();
      const scrollBox = settingsScroll.getBoundingClientRect();
      return {
        editorBottom: editorBox.bottom,
        saveBottom: saveBox.bottom,
        scrollBottom: scrollBox.bottom,
        editorContentClientHeight: editorContent.clientHeight,
        editorContentScrollHeight: editorContent.scrollHeight
      };
    });

    expect(metrics.editorBottom).toBeLessThanOrEqual(metrics.scrollBottom + 1);
    expect(metrics.saveBottom).toBeLessThanOrEqual(metrics.scrollBottom + 1);
    expect(metrics.editorContentScrollHeight).toBeGreaterThan(metrics.editorContentClientHeight);
  });

  test("keeps generated role prompt above the modal footer", async ({ page }) => {
    seedModelConfig(daemon);

    await page.route("**/roles/generate", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "job_role_layout" })
      });
    });
    await page.route("**/roles/generate/jobs/job_role_layout", async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: "job_role_layout",
          status: "completed",
          promptFragment: "长提示词草稿",
          tokenCount: 2048,
          draftJson: {
            name: "长提示词评审员",
            description: "用于验证生成角色弹窗布局。",
            prompt: Array.from(
              { length: 36 },
              (_, index) =>
                `第 ${index + 1} 条：检查设置页布局、长回复、按钮状态和滚动边界，确认内容不会被底部操作栏遮挡。`
            ).join("\n"),
            capabilities: ["chat", "code.review"],
            suggestedPermissionProfileId: "perm_readonly"
          }
        })
      });
    });

    await page.setViewportSize({ width: 1280, height: 760 });
    await page.goto(`${testUrl}/?settings=roles`);
    await page.getByTestId("roles-generate-ai").click();
    await expect(page.getByTestId("role-generator-modal")).toBeVisible();
    await page
      .getByTestId("role-generator-description")
      .fill("生成一个长提示词角色，用于验证弹窗滚动布局。");
    await expect(page.getByTestId("role-generator-generate")).toBeEnabled();
    await page.getByTestId("role-generator-generate").click();
    await expect(page.getByTestId("role-generator-preview-prompt")).toBeVisible();

    await expect
      .poll(
        async () => {
          const metrics = await readRoleGeneratorLayoutMetrics(page);
          return metrics.promptBottom <= metrics.footerTop + 1;
        },
        { timeout: 3000 }
      )
      .toBe(true);

    const metrics = await readRoleGeneratorLayoutMetrics(page);

    expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.modalBottom + 1);
    expect(metrics.bodyBottom).toBeLessThanOrEqual(metrics.footerTop + 1);
    expect(metrics.promptBottom).toBeLessThanOrEqual(metrics.footerTop + 1);
    expect(metrics.bodyCanScroll).toBe(true);
    expect(metrics.bodyScrollTop).toBeGreaterThan(0);
  });
});

async function readRoleGeneratorLayoutMetrics(page: Page) {
  return page.evaluate(() => {
    const modal = document.querySelector('[data-testid="role-generator-modal"]');
    const body = document.querySelector('[data-testid="role-generator-body"]');
    const footer = document.querySelector('[data-testid="role-generator-footer"]');
    const prompt = document.querySelector('[data-testid="role-generator-preview-prompt"]');
    if (!modal || !body || !footer || !prompt)
      throw new Error("missing role generator layout elements");
    const modalBox = modal.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    const footerBox = footer.getBoundingClientRect();
    const promptBox = prompt.getBoundingClientRect();
    return {
      modalBottom: modalBox.bottom,
      bodyBottom: bodyBox.bottom,
      footerTop: footerBox.top,
      footerBottom: footerBox.bottom,
      promptBottom: promptBox.bottom,
      bodyCanScroll: body.scrollHeight > body.clientHeight,
      bodyScrollTop: body.scrollTop
    };
  });
}

function seedRole(daemon: DaemonApp): void {
  const now = Date.now();
  daemon.database.sqlite
    .prepare(
      "INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, 'default-workspace', ?, NULL, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?)"
    )
    .run(
      "role_layout_reviewer",
      "Layout Reviewer",
      "Reviews layout regressions",
      "Keep settings layouts usable.",
      JSON.stringify(["chat", "code.review"]),
      now,
      now
    );
}

function seedModelConfig(daemon: DaemonApp): void {
  const now = Date.now();
  daemon.database.sqlite
    .prepare(
      "INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, 'default-workspace', ?, 'ollama', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)"
    )
    .run("mc_role_layout", "Role Layout Model", "layout-model", now, now);
}

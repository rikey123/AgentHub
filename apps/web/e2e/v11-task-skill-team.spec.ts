import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon, type DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("V1.1 task board, team expansion, and skills UI", () => {
  let daemon: DaemonApp;
  let testUrl: string;
  let closeServer: () => void;

  test.beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-v11-e2e-"));
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

  test("keeps tasks as a clear list by default and moves a card from the Kanban modal", async ({ page }) => {
    const roomId = await createRoom("V1.1 Kanban E2E");
    const taskId = await createTask(roomId, { title: "Draft MVP", description: "Move me to review", priority: "2" });

    await openRoom(page, roomId);
    await page.locator('[data-testid="side-panel-tab-tasks"]').click();

    await expect(page.locator('[data-testid="tasks-panel-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="tasks-panel-kanban"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open task Draft MVP" })).toBeVisible();

    await page.getByRole("button", { name: "Open Kanban" }).click();
    await expect(page.locator('[data-testid="tasks-panel-kanban"]')).toBeVisible();
    await dragTaskToColumn(page, "Draft MVP", "Review");

    await expect.poll(() => {
      const row = daemon.database.sqlite.prepare("SELECT board_column FROM tasks WHERE id = ?").get(taskId) as { readonly board_column: string | null } | undefined;
      return row?.board_column ?? null;
    }).toBe("Review");
  });

  test("adds a teammate from the Members panel and updates the room without refresh", async ({ page }) => {
    seedReviewerBinding();
    const roomId = await createRoom("V1.1 Add Teammate E2E");

    await openRoom(page, roomId);
    await page.locator('[data-testid="side-panel-tab-members"]').click();
    await page.getByRole("button", { name: "Add teammate" }).click();
    await expect(page.getByRole("dialog", { name: "Add teammate" })).toBeVisible();
    await page.getByRole("button", { name: /Reviewer E2E/u }).click();

    await expect(page.getByText("Reviewer E2E")).toBeVisible();
    await expect.poll(() => {
      const row = daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM room_participants WHERE room_id = ? AND agent_binding_id = ?").get(roomId, "binding_e2e_reviewer") as { readonly count: number };
      return row.count;
    }).toBe(1);
  });

  test("creates a workspace skill from Settings -> Skills", async ({ page }) => {
    await page.goto(`${testUrl}/?settings=skills`);
    await expect(page.locator('[data-testid="settings-panel-skills"]')).toBeVisible();
    await page.getByRole("button", { name: "New Skill" }).click();
    await expect(page.getByRole("dialog", { name: "Skill editor" })).toBeVisible();

    await page.locator('[data-testid="skills-name-input"]').fill("e2e-created-skill");
    await page.locator('[data-testid="skills-description-input"]').fill("Created from the V1.1 skills settings E2E test.");
    await page.locator('[data-testid="skills-content-input"]').fill(skillContent("e2e-created-skill", "Created from the V1.1 skills settings E2E test."));
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Skill created.")).toBeVisible();
    await expect(page.locator('[data-testid^="skill-row-"]').filter({ hasText: "e2e-created-skill" })).toBeVisible();
    await expect.poll(() => {
      const row = daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM skills WHERE name = ? AND origin = 'workspace'").get("e2e-created-skill") as { readonly count: number };
      return row.count;
    }).toBe(1);
  });

  test("assigns selected room skills during room creation", async ({ page }) => {
    seedTeamCreationOptions();
    seedWorkspaceSkill("skill_e2e_room", "e2e-room-skill", "Available to the created room.");
    const roomRequests: unknown[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/rooms" && request.method() === "POST") {
        roomRequests.push(request.postDataJSON() as unknown);
      }
    });

    await page.goto(testUrl);
    await page.locator('[data-testid="room-list-create-room"]').click();
    await page.getByLabel("Title").fill("V1.1 Skilled Room");
    await page.getByText("Team", { exact: true }).click();
    await chooseHeroSelect(page, "new-room-leader-role", "Leader E2E");
    await chooseHeroSelect(page, "new-room-leader-runtime", "AgentHub Native");
    await chooseHeroSelect(page, "new-room-leader-model", "Local E2E Model");
    await page.locator("label").filter({ hasText: "e2e-room-skill" }).click();
    await expect(page.getByRole("checkbox", { name: /e2e-room-skill/u })).toBeChecked();
    await page.getByRole("button", { name: "Create room" }).click();

    await expect(page.getByRole("heading", { name: "V1.1 Skilled Room" })).toBeVisible();
    expect(roomRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillIds: ["skill_e2e_room"] })
    ]));
    await expect.poll(() => {
      const row = daemon.database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM room_skills WHERE room_id = (SELECT id FROM rooms WHERE title = ?) AND skill_id = ? AND enabled = 1")
        .get("V1.1 Skilled Room", "skill_e2e_room") as { readonly count: number };
      return row.count;
    }).toBe(1);
  });

  async function createRoom(title: string): Promise<string> {
    const response = await fetch(`${testUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, mode: "solo", primaryAgentId: "mock-builder" })
    });
    expect(response.ok).toBe(true);
    const data = await response.json() as { readonly data?: { readonly roomId?: string } };
    expect(data.data?.roomId).toBeTruthy();
    return data.data!.roomId!;
  }

  async function createTask(roomId: string, input: { readonly title: string; readonly description: string; readonly priority: string }): Promise<string> {
    const response = await fetch(`${testUrl}/rooms/${encodeURIComponent(roomId)}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    expect(response.ok).toBe(true);
    const data = await response.json() as { readonly data?: { readonly taskId?: string } };
    expect(data.data?.taskId).toBeTruthy();
    return data.data!.taskId!;
  }

  async function openRoom(page: Page, roomId: string): Promise<void> {
    await page.goto(testUrl);
    await page.locator(`[data-testid="room-list-item-${roomId}"]`).click();
    await expect(page.locator('[data-testid="chat-room-layout"]')).toBeVisible();
  }

  function seedReviewerBinding(): void {
    const now = Date.now();
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite
        .prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, 'default-workspace', ?, NULL, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?)")
        .run("role_e2e_reviewer", "Reviewer E2E", "Reviews delegated work", "Review delegated work.", JSON.stringify(["chat", "code.review"]), now, now);
      daemon.database.sqlite
        .prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, 'default-workspace', 'custom-acp', ?, NULL, NULL, NULL, NULL, NULL, 'test', '[]', NULL, NULL, ?, ?, ?)")
        .run("runtime_e2e_reviewer", "Reviewer Runtime", JSON.stringify({ runtimeKind: "custom-acp" }), now, now);
      daemon.database.sqlite
        .prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, 'default-workspace', ?, ?, NULL, NULL, ?, ?)")
        .run("binding_e2e_reviewer", "role_e2e_reviewer", "runtime_e2e_reviewer", now, now);
    })();
  }

  function seedTeamCreationOptions(): void {
    const now = Date.now();
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite
        .prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, 'default-workspace', ?, NULL, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?)")
        .run("role_e2e_leader", "Leader E2E", "Coordinates team work", "Lead the team with room.delegate.", JSON.stringify(["chat", "task.delegate"]), now, now);
      daemon.database.sqlite
        .prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, 'default-workspace', ?, 'ollama', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)")
        .run("mc_e2e_native", "Local E2E Model", "local-e2e", now, now);
      daemon.database.sqlite
        .prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, 'default-workspace', ?, ?, ?, NULL, ?, ?)")
        .run("binding_e2e_leader", "role_e2e_leader", "native-default", "mc_e2e_native", now, now);
    })();
  }

  function seedWorkspaceSkill(skillId: string, name: string, description: string): void {
    const now = Date.now();
    daemon.database.sqlite
      .prepare("INSERT INTO skills (id, workspace_id, name, description, content, origin, source_url, created_at, updated_at) VALUES (?, 'default-workspace', ?, ?, ?, 'workspace', NULL, ?, ?)")
      .run(skillId, name, description, skillContent(name, description), now, now);
  }
});

async function chooseHeroSelect(page: Page, testId: string, optionName: string): Promise<void> {
  await page.locator(`[data-testid="${testId}"]`).click();
  await page.getByRole("option", { name: optionName }).click();
}

async function dragTaskToColumn(page: Page, taskTitle: string, columnName: string): Promise<void> {
  const source = page.getByLabel(`Drag task ${taskTitle}`);
  const target = page.getByLabel(`${columnName} tasks`);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Unable to measure Kanban drag target");

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + Math.min(targetBox.height - 20, 140), { steps: 12 });
  await page.mouse.up();
}

function skillContent(name: string, description: string): string {
  return `---
name: ${name}
description: ${description}
---

Use this skill during V1.1 end-to-end tests.
`;
}

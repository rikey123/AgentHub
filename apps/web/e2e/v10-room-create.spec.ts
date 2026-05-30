import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon, type DaemonApp } from "@agenthub/daemon";
import { startTestServer } from "./test-server.ts";

test.describe("V1.0 room creation", () => {
  let daemon: DaemonApp;
  let testUrl: string;
  let closeServer: () => void;

  test.beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-web-e2e-"));
    daemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0 });
    const result = await startTestServer(daemon);
    testUrl = result.url;
    closeServer = result.close;
    seedTeamCreationOptions(daemon);
  });

  test.afterEach(async () => {
    closeServer();
    await Promise.race([
      daemon.close(),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  });

  test("creates a team room from Role/Runtime/Model selections", async ({ page }) => {
    const roomRequests: unknown[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname !== "/rooms" || request.method() !== "POST") return;
      const data = request.postDataJSON() as unknown;
      roomRequests.push(data);
    });

    await page.goto(testUrl);
    await page.locator('[data-testid="room-list-create-room"]').click();
    await expect(page.getByRole("heading", { name: "New room" })).toBeVisible();
    await page.getByLabel("Title").fill("Team E2E Room");
    await page.getByText("Team", { exact: true }).click();
    await expect(page.locator('[data-testid="new-room-leader-role"]')).toBeVisible();
    await chooseHeroSelect(page, "new-room-leader-role", "Leader E2E");
    await chooseHeroSelect(page, "new-room-leader-runtime", "AgentHub Native");
    await chooseHeroSelect(page, "new-room-leader-model", "Local E2E Model");
    await page.getByRole("button", { name: "Add teammate" }).click();
    await expect(page.locator('[data-testid="new-room-participant-0-role"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
    await chooseHeroSelect(page, "new-room-participant-0-role", "Reviewer E2E");
    await chooseHeroSelect(page, "new-room-participant-0-runtime", "Claude E2E ACP");
    await page.getByRole("button", { name: "Create room" }).click();

    await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Team E2E Room" })).toBeVisible();

    expect(roomRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: "team",
        primaryAgentId: "binding_e2e_leader",
        leaderRoleId: "role_e2e_leader",
        participants: [
          { roleId: "role_e2e_leader", runtimeId: "native-default", modelConfigId: "mc_e2e_native", defaultPresence: "active" },
          { roleId: "role_e2e_reviewer", runtimeId: "runtime_e2e_claude", defaultPresence: "active" }
        ]
      })
    ]));

    const room = daemon.database.sqlite.prepare("SELECT id, mode, leader_role_id, primary_agent_id FROM rooms WHERE title = ?").get("Team E2E Room") as { readonly id: string; readonly mode: string; readonly leader_role_id: string; readonly primary_agent_id: string } | undefined;
    expect(room).toMatchObject({ mode: "team", leader_role_id: "role_e2e_leader", primary_agent_id: "binding_e2e_leader" });
    expect(daemon.database.sqlite.prepare("SELECT participant_id, role, agent_binding_id FROM room_participants WHERE room_id = ? ORDER BY joined_at ASC").all(room?.id ?? "")).toMatchObject([
      { participant_id: "binding_e2e_leader", role: "primary", agent_binding_id: "binding_e2e_leader" },
      { participant_id: "binding_e2e_reviewer", role: "teammate", agent_binding_id: "binding_e2e_reviewer" }
    ]);
  });

  test("creates a missing leader binding before creating a team room", async ({ page }) => {
    daemon.database.sqlite.prepare("DELETE FROM agent_bindings WHERE id = ?").run("binding_e2e_leader");
    const bindingRequests: unknown[] = [];
    const roomRequests: unknown[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/agent-bindings" && request.method() === "POST") {
        bindingRequests.push(request.postDataJSON() as unknown);
      }
      if (url.pathname === "/rooms" && request.method() === "POST") {
        roomRequests.push(request.postDataJSON() as unknown);
      }
    });

    await page.goto(testUrl);
    await page.locator('[data-testid="room-list-create-room"]').click();
    await page.getByLabel("Title").fill("Auto Binding Room");
    await page.getByText("Team", { exact: true }).click();
    await chooseHeroSelect(page, "new-room-leader-role", "Leader E2E");
    await chooseHeroSelect(page, "new-room-leader-runtime", "AgentHub Native");
    await chooseHeroSelect(page, "new-room-leader-model", "Local E2E Model");
    await page.getByRole("button", { name: "Create room" }).click();

    await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Auto Binding Room" })).toBeVisible();

    const createdBinding = daemon.database.sqlite
      .prepare("SELECT id FROM agent_bindings WHERE role_id = ? AND runtime_id = ? AND model_config_id = ? ORDER BY created_at DESC LIMIT 1")
      .get("role_e2e_leader", "native-default", "mc_e2e_native") as { readonly id: string } | undefined;
    expect(createdBinding?.id).toBeTruthy();
    expect(bindingRequests).toEqual([
      { roleId: "role_e2e_leader", runtimeId: "native-default", modelConfigId: "mc_e2e_native" }
    ]);
    expect(roomRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: "team",
        primaryAgentId: createdBinding?.id,
        leaderRoleId: "role_e2e_leader",
        participants: [
          { roleId: "role_e2e_leader", runtimeId: "native-default", modelConfigId: "mc_e2e_native", defaultPresence: "active" }
        ]
      })
    ]));
  });

  test("keeps role choices persona-only and routes native leader runs away from mock", async ({ page }) => {
    await page.goto(testUrl);
    await page.locator('[data-testid="room-list-create-room"]').click();
    await page.getByLabel("Title").fill("Native Leader Room");
    await page.getByText("Team", { exact: true }).click();
    await page.locator('[data-testid="new-room-leader-role"]').click();
    await expect(page.getByRole("option", { name: "Leader E2E" })).toBeVisible();
    await expect(page.getByRole("option", { name: /Mock Builder/u })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /Claude Code Builder/u })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await chooseHeroSelect(page, "new-room-leader-role", "Leader E2E");
    await chooseHeroSelect(page, "new-room-leader-runtime", "AgentHub Native");
    await chooseHeroSelect(page, "new-room-leader-model", "Local E2E Model");
    await page.getByRole("button", { name: "Create room" }).click();

    await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
    await page.getByRole("textbox", { name: "Message" }).fill("hello native leader");
    await page.keyboard.press("Enter");

    await expect.poll(() => {
      const row = daemon.database.sqlite.prepare("SELECT adapter_id FROM runs WHERE room_id = (SELECT id FROM rooms WHERE title = ?) ORDER BY created_at DESC LIMIT 1").get("Native Leader Room") as { readonly adapter_id: string | null } | undefined;
      return row?.adapter_id ?? null;
    }).toBe("native");
    await expect(page.getByText("Mock assistant reply")).toHaveCount(0);
  });
});

async function chooseHeroSelect(page: import("@playwright/test").Page, testId: string, optionName: string): Promise<void> {
  await page.locator(`[data-testid="${testId}"]`).click();
  await page.getByRole("option", { name: optionName }).click();
}

function seedTeamCreationOptions(daemon: DaemonApp): void {
  const now = Date.now();
  daemon.database.sqlite.transaction(() => {
    daemon.database.sqlite
      .prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, 'default-workspace', ?, NULL, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?)")
      .run("role_e2e_leader", "Leader E2E", "Coordinates V1.0 team dispatch", "Lead the team with room.delegate.", JSON.stringify(["chat", "task.delegate"]), now, now);
    daemon.database.sqlite
      .prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, 'default-workspace', ?, NULL, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?)")
      .run("role_e2e_reviewer", "Reviewer E2E", "Reviews delegated work", "Review delegated work.", JSON.stringify(["chat", "code.review"]), now + 1, now + 1);
    daemon.database.sqlite
      .prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, 'default-workspace', ?, 'ollama', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)")
      .run("mc_e2e_native", "Local E2E Model", "local-e2e", now, now);
    daemon.database.sqlite
      .prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, 'default-workspace', 'custom-acp', ?, NULL, NULL, NULL, NULL, NULL, 'test', '[]', NULL, NULL, ?, ?, ?)")
      .run("runtime_e2e_claude", "Claude E2E ACP", JSON.stringify({ runtimeKind: "custom-acp" }), now, now);
    daemon.database.sqlite
      .prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, 'default-workspace', ?, ?, ?, NULL, ?, ?)")
      .run("binding_e2e_leader", "role_e2e_leader", "native-default", "mc_e2e_native", now, now);
    daemon.database.sqlite
      .prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, 'default-workspace', ?, ?, NULL, NULL, ?, ?)")
      .run("binding_e2e_reviewer", "role_e2e_reviewer", "runtime_e2e_claude", now + 1, now + 1);
  })();
}

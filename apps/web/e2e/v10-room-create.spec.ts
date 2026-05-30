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
    await page.locator('[data-testid="new-room-leader-role"]').selectOption("role_e2e_leader");
    await page.locator('[data-testid="new-room-participant-role-0"]').selectOption("role_e2e_leader");
    await page.locator('[data-testid="new-room-participant-runtime-0"]').selectOption("native-default");
    await page.locator('[data-testid="new-room-participant-model-0"]').selectOption("mc_e2e_native");
    await page.getByRole("button", { name: "Add participant" }).click();
    await page.locator('[data-testid="new-room-participant-role-1"]').selectOption("role_e2e_reviewer");
    await page.locator('[data-testid="new-room-participant-runtime-1"]').selectOption("runtime_e2e_claude");
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
});

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

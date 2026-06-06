import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { CommandBus, EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { RoomMcpServer, TaskService } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let taskService: TaskService | undefined;
let server: RoomMcpServer | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-room-mcp-mature-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  taskService = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
  server = new RoomMcpServer({
    commandBus: new CommandBus({ database: currentDatabase(), handlers: {} as never }),
    taskService: currentTaskService(),
    database: currentDatabase(),
    eventBus: currentBus(),
    now: () => now
  });
  seedWorkspace();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  taskService = undefined;
  server = undefined;
  now = 1_000;
});

describe("RoomMcpServer mature tool handlers", () => {
  test("lists, greps, edits, and applies patches inside the workspace", async () => {
    mkdirSync(join(tempDir!, "src"), { recursive: true });
    writeFileSync(join(tempDir!, "src", "app.ts"), "export const value = 'old';\n", "utf8");
    writeFileSync(join(tempDir!, "README.md"), "AgentHub mature tools\n", "utf8");

    await expect(call("file.list", { path: ".", recursive: true })).resolves.toMatchObject({
      ok: true,
      data: { entries: expect.arrayContaining([expect.objectContaining({ path: "src/app.ts", type: "file" })]) }
    });
    await expect(call("file.glob", { pattern: "src/*.ts" })).resolves.toMatchObject({
      ok: true,
      data: { matches: ["src/app.ts"] }
    });
    await expect(call("file.grep", { pattern: "old", path: "src" })).resolves.toMatchObject({
      ok: true,
      data: { matches: [expect.objectContaining({ path: "src/app.ts", line: 1, text: "export const value = 'old';" })] }
    });

    await expect(call("file.edit", { path: "src/app.ts", oldText: "'old'", newText: "'new'" })).resolves.toMatchObject({
      ok: true,
      data: { path: "src/app.ts", replacements: 1, file: { path: "src/app.ts", status: "modified", additions: 1, deletions: 1, patch: expect.stringContaining("-'old'") } }
    });
    expect(readFileSync(join(tempDir!, "src", "app.ts"), "utf8")).toContain("'new'");

    await expect(call("file.apply_patch", { patch: "diff --git a/src/app.ts b/src/app.ts\nindex 0000000..1111111 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-export const value = 'new';\n+export const value = 'patched';\n" })).resolves.toMatchObject({
      ok: true,
      data: { applied: true, files: [expect.objectContaining({ path: "src/app.ts", status: "modified", additions: 1, deletions: 1 })] }
    });
    expect(readFileSync(join(tempDir!, "src", "app.ts"), "utf8")).toContain("'patched'");
  });

  test("routes file.edit through ArtifactFS when the run has isolated artifact storage", async () => {
    mkdirSync(join(tempDir!, "src"), { recursive: true });
    writeFileSync(join(tempDir!, "src", "shadow.ts"), "export const value = 'old';\n", "utf8");
    const writes: Array<{ readonly runId: string; readonly path: string; readonly content: string }> = [];
    server = new RoomMcpServer({
      commandBus: new CommandBus({ database: currentDatabase(), handlers: {} as never }),
      taskService: currentTaskService(),
      database: currentDatabase(),
      eventBus: currentBus(),
      artifactFs: {
        readTextFile: ({ path }) => path === "src/shadow.ts" ? "export const value = 'old';\n" : undefined,
        writeTextFile: (input) => { writes.push(input); }
      },
      now: () => now
    });

    await expect(call("file.edit", { path: "src/shadow.ts", oldText: "'old'", newText: "'new'" })).resolves.toMatchObject({
      ok: true,
      data: { path: "src/shadow.ts", replacements: 1 }
    });
    expect(writes).toEqual([{ runId: "run_1", path: "src/shadow.ts", content: "export const value = 'new';\n" }]);
    expect(readFileSync(join(tempDir!, "src", "shadow.ts"), "utf8")).toContain("'old'");
  });

  test("returns structured file metadata for added and deleted apply_patch files", async () => {
    mkdirSync(join(tempDir!, "docs"), { recursive: true });
    writeFileSync(join(tempDir!, "docs", "old.md"), "Remove me\n", "utf8");

    await expect(call("file.apply_patch", {
      patch: [
        "diff --git a/docs/new.md b/docs/new.md",
        "new file mode 100644",
        "index 0000000..1111111",
        "--- /dev/null",
        "+++ b/docs/new.md",
        "@@ -0,0 +1 @@",
        "+Add me",
        "diff --git a/docs/old.md b/docs/old.md",
        "deleted file mode 100644",
        "index 1111111..0000000",
        "--- a/docs/old.md",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-Remove me",
        ""
      ].join("\n")
    })).resolves.toMatchObject({
      ok: true,
      data: {
        applied: true,
        files: [
          expect.objectContaining({ path: "docs/new.md", status: "added", additions: 1, deletions: 0 }),
          expect.objectContaining({ path: "docs/old.md", status: "deleted", additions: 0, deletions: 1 })
        ]
      }
    });
    expect(readFileSync(join(tempDir!, "docs", "new.md"), "utf8").replace(/\r\n/gu, "\n")).toBe("Add me\n");
  });

  test("applies multiple file.edit patches atomically and reports line numbers", async () => {
    mkdirSync(join(tempDir!, "src"), { recursive: true });
    writeFileSync(join(tempDir!, "src", "multi.ts"), "const first = 'old';\nconst second = 'old';\n", "utf8");

    await expect(call("file.edit", {
      path: "src/multi.ts",
      patches: [
        { oldText: "const first = 'old';", newText: "const first = 'new';" },
        { oldText: "const second = 'old';", newText: "const second = 'new';" }
      ]
    })).resolves.toMatchObject({
      ok: true,
      data: {
        path: "src/multi.ts",
        replacements: 2,
        patches: [
          expect.objectContaining({ index: 1, line: 1 }),
          expect.objectContaining({ index: 2, line: 2 })
        ]
      }
    });
    expect(readFileSync(join(tempDir!, "src", "multi.ts"), "utf8")).toBe("const first = 'new';\nconst second = 'new';\n");
  });

  test("creates missing files with file.edit createIfMissing", async () => {
    await expect(call("file.edit", {
      path: "docs/new.md",
      patches: [{ oldText: "", newText: "# New document\n" }],
      createIfMissing: true
    })).resolves.toMatchObject({
      ok: true,
      data: { path: "docs/new.md", created: true, replacements: 1 }
    });
    expect(readFileSync(join(tempDir!, "docs", "new.md"), "utf8")).toBe("# New document\n");
  });

  test("returns a nearby-match hint when file.edit oldText is missing", async () => {
    mkdirSync(join(tempDir!, "src"), { recursive: true });
    writeFileSync(join(tempDir!, "src", "hint.ts"), "function greet() {\n  return 'hello';\n}\n", "utf8");

    await expect(call("file.edit", {
      path: "src/hint.ts",
      oldText: "function greet() {\n  return 'hi';\n}",
      newText: "function greet() {\n  return 'hello world';\n}"
    })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "not_found",
        details: expect.objectContaining({ line: 1, preview: expect.stringContaining("function greet()") })
      }
    });
    expect(readFileSync(join(tempDir!, "src", "hint.ts"), "utf8")).toContain("return 'hello';");
  });

  test("supports board query, blocker, review, and todo tools using task events", async () => {
    const taskId = createTask("Design kanban parity", { status: "in_progress", priority: "2" });

    await expect(call("room.get_board", {})).resolves.toMatchObject({
      ok: true,
      data: { columns: expect.arrayContaining([expect.objectContaining({ name: "In Progress", tasks: [expect.objectContaining({ id: taskId })] })]) }
    });
    await expect(call("room.query_tasks", { query: "kanban", status: "in_progress" })).resolves.toMatchObject({
      ok: true,
      data: { tasks: [expect.objectContaining({ id: taskId })] }
    });
    await expect(call("room.set_blocker", { taskId, blockerReason: "Waiting for reference screenshots" })).resolves.toMatchObject({
      ok: true,
      data: { task: expect.objectContaining({ status: "blocked", blockerReason: "Waiting for reference screenshots" }) }
    });
    await expect(call("room.list_blockers", {})).resolves.toMatchObject({
      ok: true,
      data: { tasks: [expect.objectContaining({ id: taskId, blockerReason: "Waiting for reference screenshots" })] }
    });
    await expect(call("room.clear_blocker", { taskId, nextStatus: "in_progress" })).resolves.toMatchObject({
      ok: true,
      data: { task: expect.objectContaining({ status: "in_progress" }) }
    });
    await expect(call("room.move_task", { taskId, column: "Review" })).resolves.toMatchObject({
      ok: true,
      data: { task: expect.objectContaining({ boardColumn: "Review" }) }
    });
    await expect(call("room.review", { taskId })).resolves.toMatchObject({
      ok: true,
      data: { task: expect.objectContaining({ status: "review" }) }
    });
    await expect(call("todo.write", { taskId, todos: [{ id: "todo_1", content: "Check tools", status: "done" }] })).resolves.toMatchObject({
      ok: true,
      data: { activity: expect.objectContaining({ taskId, kind: "comment" }) }
    });
    await expect(call("room.standup", {})).resolves.toMatchObject({
      ok: true,
      data: { counts: expect.objectContaining({ review: 1 }), review: [expect.objectContaining({ id: taskId })] }
    });
  });

  test("lists runtime, model, role, and active skill metadata without exposing secrets", async () => {
    await expect(call("room.list_runtimes", {})).resolves.toMatchObject({
      ok: true,
      data: { runtimes: [expect.objectContaining({ id: "runtime_native", kind: "native", name: "Native Runtime" })] }
    });
    await expect(call("room.list_models", {})).resolves.toMatchObject({
      ok: true,
      data: { models: [expect.objectContaining({ id: "model_openai", provider: "openai", model: "gpt-4.1", apiKeyFingerprint: "test...key" })] }
    });
    const modelResult = await call("room.list_models", {});
    expect(JSON.stringify(modelResult)).not.toContain("secret_ref");

    await expect(call("room.describe_role", { roleId: "role_builder" })).resolves.toMatchObject({
      ok: true,
      data: { role: expect.objectContaining({ id: "role_builder", name: "Builder", prompt: "Build things." }) }
    });
    await expect(call("room.list_skills", { scope: "effective" })).resolves.toMatchObject({
      ok: true,
      data: { skills: [expect.objectContaining({ id: "skill_review", name: "review-helper" })] }
    });
    await expect(call("room.load_skill", { name: "review-helper", includeFiles: true })).resolves.toMatchObject({
      ok: true,
      data: { skill: expect.objectContaining({ id: "skill_review", content: expect.stringContaining("name: review-helper") }), files: [expect.objectContaining({ path: "docs/checklist.md" })] }
    });
  });
});

async function call(name: string, input: unknown) {
  return currentServer().callTool(name, input, { roomId: "room_1", agentId: "agent_1", runId: "run_1" });
}

function createTask(title: string, input: { readonly status: "pending" | "in_progress"; readonly priority?: string }): string {
  const result = currentTaskService().create({ roomId: "room_1", title, assigneeAgentId: "agent_1", ...(input.priority !== undefined ? { priority: input.priority } : {}), createdBy: "agent_1" });
  if (!result.ok) throw new Error(result.error.message);
  if (input.status !== "pending") currentDatabase().sqlite.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(input.status, result.data.taskId);
  return result.data.taskId;
}

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, ?, ?)").run(tempDir, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES ('role_builder', 'ws_1', 'Builder', NULL, 'Builds software', 'Build things.', '[\"code.edit\"]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES ('runtime_native', 'ws_1', 'native', 'Native Runtime', NULL, NULL, NULL, NULL, NULL, 'native', '[\"chat\"]', NULL, 'connected', '{\"runtimeKind\":\"native\"}', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES ('model_openai', 'ws_1', 'OpenAI Main', 'openai', 'gpt-4.1', NULL, 'secret_ref', 'test...key', NULL, NULL, NULL, NULL, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_1', 'ws_1', 'Builder', 'native', NULL, 'Build things.', '[\"code.edit\"]', NULL, 0, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_builder', 'ws_1', 'role_builder', 'runtime_native', 'model_openai', NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, leader_role_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'solo', 'conversation', 'agent_1', 'role_builder', NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, agent_binding_id, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', 'native', NULL, 'active', 'binding_builder', ?)").run(now);
  currentDatabase().sqlite.prepare("INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES ('run_1', 'ws_1', NULL, 'room_1', 'agent_1', 'native', NULL, NULL, NULL, 'running', 'primary_turn', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(now, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO skills (id, workspace_id, name, description, content, origin, source_url, created_at, updated_at) VALUES ('skill_review', 'ws_1', 'review-helper', 'Helps review work', ?, 'workspace', NULL, ?, ?)").run("---\nname: review-helper\ndescription: Helps review work\n---\nReview carefully.\n", now, now);
  currentDatabase().sqlite.prepare("INSERT INTO skill_files (id, skill_id, path, content) VALUES ('skill_file_review', 'skill_review', 'docs/checklist.md', 'Check tests')").run();
  currentDatabase().sqlite.prepare("INSERT INTO room_skills (room_id, skill_id, enabled) VALUES ('room_1', 'skill_review', 1)").run();
}

function currentServer(): RoomMcpServer {
  expect(server).toBeDefined();
  return server as RoomMcpServer;
}

function currentTaskService(): TaskService {
  expect(taskService).toBeDefined();
  return taskService as TaskService;
}

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

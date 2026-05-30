/**
 * Symlink/junction escape tests for RoomMcpServer.
 * These tests require real fs operations (no node:fs mock) so they live in a separate file.
 * On Windows, junction creation may require elevated privileges or Developer Mode.
 * Tests that cannot create junctions are skipped gracefully.
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CommandBus, EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import type { PermissionEngine } from "../../permissions/src/index.ts";

import { RoomMcpServer, TaskService, type RoomMcpCallContext, type RoomMcpSessionContext } from "../src/index.ts";
type PermissionCheckResult =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly reason: string }
  | { readonly status: "ask"; readonly requestId: string; readonly promise: Promise<{ readonly decision: "allowed" | "denied" | "expired"; readonly reason: string; readonly requestId: string }> };

let tempDir: string | undefined;
let externalDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-room-mcp-sym-"));
  externalDir = mkdtempSync(join(tmpdir(), "agenthub-external-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  if (externalDir) rmSync(externalDir, { recursive: true, force: true });
  tempDir = undefined;
  externalDir = undefined;
  database = undefined;
  eventBus = undefined;
  now = 1_000;
});

describe("RoomMcpServer symlink/junction escape safeguards", () => {
  it("file.read blocks junction pointing outside workspace", async () => {
    // Create a secret file in the external directory.
    writeFileSync(join(externalDir!, "secret.txt"), "external-secret", "utf8");

    // Try to create a junction inside the workspace pointing to the external dir.
    const junctionPath = join(tempDir!, "secrets");
    try {
      symlinkSync(externalDir!, junctionPath, "junction");
    } catch {
      // Junction creation requires elevated privileges on Windows without Developer Mode.
      // Skip gracefully.
      return;
    }

    seedRoom("room_1", "agent_1");
    const server = createServer(createPermissionEngine({ file: () => ({ status: "allow" }) }));

    // Reading through the junction should be blocked by the realpath check.
    const result = await server.callTool("file.read", { path: "secrets/secret.txt" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
  });

  it("file.write blocks junction pointing outside workspace", async () => {
    // Try to create a junction inside the workspace pointing to the external dir.
    const junctionPath = join(tempDir!, "secrets");
    try {
      symlinkSync(externalDir!, junctionPath, "junction");
    } catch {
      return; // Skip if junction creation not available.
    }

    seedRoom("room_1", "agent_1");
    const server = createServer(createPermissionEngine({ file: () => ({ status: "allow" }) }));

    // Writing through the junction should be blocked by the realpath check.
    const result = await server.callTool("file.write", { path: "secrets/evil.txt", content: "pwned" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
  });

  it("shell blocks junction cwd pointing outside workspace", async () => {
    // Create the junction directory (cwd must exist for shell to use it).
    const junctionPath = join(tempDir!, "secrets");
    try {
      symlinkSync(externalDir!, junctionPath, "junction");
    } catch {
      return; // Skip if junction creation not available.
    }

    seedRoom("room_1", "agent_1");
    // Permission engine allows the shell command — the cwd escape should still be blocked.
    const server = createServer(createPermissionEngine({ shell: () => ({ status: "allow" }) }));

    // Running shell with cwd pointing through the junction should be blocked.
    const result = await server.callTool("shell", { command: "echo hi", cwd: "secrets" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied", message: "cwd must be within workspace" } });
  });
});

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function seedRoom(roomId: string, agentId: string): void {
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, ?, ?)").run(tempDir, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, 'ws_1', 'Room', 'solo', 'conversation', ?, NULL, ?, ?)").run(roomId, agentId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', 'mock', NULL, 'active', ?)").run(roomId, agentId, now);
}

function session(extra: Partial<RoomMcpSessionContext> = {}): RoomMcpSessionContext {
  return { roomId: "room_1", agentId: "agent_1", runId: "run_1", ...extra };
}

function context(): RoomMcpCallContext {
  return {};
}

function createPermissionEngine(handlers: {
  readonly file?: (resource: { readonly type: string; readonly path?: string; readonly operation?: string }) => PermissionCheckResult;
  readonly shell?: (resource: { readonly type: string; readonly command?: string }) => PermissionCheckResult;
}): { readonly check: (input: { readonly workspaceId: string; readonly roomId: string; readonly agentId: string; readonly runId: string; readonly resource: { readonly type: string; readonly path?: string; readonly operation?: string; readonly command?: string } }) => PermissionCheckResult } {
  return {
    check(input) {
      if (input.resource.type === "file") return handlers.file?.(input.resource) ?? { status: "allow" };
      if (input.resource.type === "shell") return handlers.shell?.(input.resource) ?? { status: "allow" };
      return { status: "allow" };
    }
  };
}

type FakePermissionEngine = ReturnType<typeof createPermissionEngine>;

function createServer(permissionEngine: FakePermissionEngine): RoomMcpServer {
  return new RoomMcpServer({
    commandBus: new CommandBus({ database: currentDatabase(), handlers: {} as never }),
    taskService: new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now }),
    database: currentDatabase(),
    eventBus: currentBus(),
    permissionEngine: permissionEngine as unknown as PermissionEngine,
  });
}

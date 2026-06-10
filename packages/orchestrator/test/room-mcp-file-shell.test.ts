import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CommandBus, EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import type { PermissionEngine } from "../../permissions/src/index.ts";

import { RoomMcpServer, TaskService, type RoomMcpCallContext, type RoomMcpSessionContext } from "../src/index.ts";

// Use vi.hoisted so these mocks are available inside vi.mock factories (which are hoisted).
const { execFileMock, mkdirSyncMock, writeFileSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => {
  // Attach the custom promisify symbol so promisify(execFile) resolves with { stdout, stderr }.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { promisify } = require("node:util") as typeof import("node:util");
  const mockFn = execFileMock as typeof execFileMock & { [key: symbol]: unknown };
  mockFn[promisify.custom] = (...args: unknown[]) => (execFileMock as (...a: unknown[]) => unknown)(...args);
  return { execFile: mockFn };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdirSync: (...args: Parameters<typeof actual.mkdirSync>) => mkdirSyncMock(...args),
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => writeFileSyncMock(...args),
    // readFileSyncMock tracks calls; actual implementation is used for non-test paths (e.g. migrations).
    // Tests that need to assert "not called" check readFileSyncMock.mock.calls.
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      readFileSyncMock(...args);
      return actual.readFileSync(...args);
    },
    // Explicitly preserve realpathSync with its .native sub-function so symlink escape tests work.
    realpathSync: Object.assign(actual.realpathSync.bind(actual), { native: actual.realpathSync.native.bind(actual) }),
  };
});

type PermissionCheckResult =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly reason: string }
  | { readonly status: "ask"; readonly requestId: string; readonly promise: Promise<{ readonly decision: "allowed" | "denied" | "expired"; readonly reason: string; readonly requestId: string }> };

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let server: RoomMcpServer | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-room-mcp-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  server = new RoomMcpServer({
    commandBus: new CommandBus({ database: currentDatabase(), handlers: {} as never }),
    taskService: new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now }),
    database: currentDatabase(),
    eventBus: currentBus(),
    ...(permissionEngine !== undefined ? { permissionEngine: permissionEngine as PermissionEngine } : {}),
    ...(artifactFs !== undefined ? { artifactFs } : {}),
  });
  // Reset fs mocks after setup so tests start with a clean call history.
  readFileSyncMock.mockReset();
  mkdirSyncMock.mockReset();
  writeFileSyncMock.mockReset();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  server = undefined;
  now = 1_000;
  permissionEngine = undefined;
  artifactFs = undefined;
  vi.restoreAllMocks();
  execFileMock.mockReset();
  mkdirSyncMock.mockReset();
  writeFileSyncMock.mockReset();
  readFileSyncMock.mockReset();
});

describe("RoomMcpServer file and shell safeguards", () => {
  test("file.read denies sensitive files", async () => {
    seedRoom("room_1", "agent_1");
    permissionEngine = createPermissionEngine({
      file: (resource) => resource.path === ".env" ? { status: "deny", reason: "sensitive" } : { status: "allow" }
    });
    server = createServer();

    const result = await currentServer().callTool("file.read", { path: ".env" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
  });

  test("file.read denies external paths via permission engine", async () => {
    seedRoom("room_1", "agent_1");
    permissionEngine = createPermissionEngine({
      file: (resource) => (resource.path ?? "").includes("..") ? { status: "deny", reason: "outside workspace" } : { status: "allow" }
    });
    server = createServer();

    const result = await currentServer().callTool("file.read", { path: "../../secret" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
  });

  test("file.read blocks path escape before permission check", async () => {
    seedRoom("room_1", "agent_1");
    // Even if permission engine would allow it, the path escape guard fires first.
    permissionEngine = createPermissionEngine({ file: () => ({ status: "allow" }) });
    server = createServer();

    const result = await currentServer().callTool("file.read", { path: "../../etc/passwd" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied", message: "path_traversal_denied" } });
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  test("file.write blocks path escape before permission check", async () => {
    seedRoom("room_1", "agent_1");
    permissionEngine = createPermissionEngine({ file: () => ({ status: "allow" }) });
    server = createServer();

    const result = await currentServer().callTool("file.write", { path: "../../evil.txt", content: "pwned" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied", message: "path_traversal_denied" } });
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(mkdirSyncMock).not.toHaveBeenCalled();
  });

  test("file.write waits for ask resolution and writes on allow", async () => {
    seedRoom("room_1", "agent_1");
    const deferred = createDeferredResolution();
    permissionEngine = createPermissionEngine({
      file: () => ({ status: "ask", requestId: "req_write_allow", promise: deferred.promise })
    });
    server = createServer();

    const resultPromise = currentServer().callTool("file.write", { path: "allowed.txt", content: "hello" }, session(), context());
    deferred.resolve({ decision: "allowed", reason: "approved", requestId: "req_write_allow" });
    const result = await resultPromise;

    expect(result).toEqual({ ok: true, data: { path: "allowed.txt", written: true } });
    expect(writeFileSyncMock).toHaveBeenCalledWith(expect.stringMatching(/[\\/]allowed\.txt$/u), "hello", "utf8");
  });

  test("file.write with ArtifactFS avoids real filesystem writes", async () => {
    seedRoom("room_1", "agent_1");
    const artifactCalls: Array<{ readonly runId: string; readonly path: string; readonly content: string }> = [];
    permissionEngine = createPermissionEngine({ file: () => ({ status: "allow" }) });
    artifactFs = { writeTextFile: (input) => { artifactCalls.push(input); } };
    server = createServer();

    const result = await currentServer().callTool("file.write", { path: "artifact.txt", content: "artifact" }, session({ runId: "run_1" }), context());

    expect(result).toEqual({ ok: true, data: { path: "artifact.txt", written: true } });
    expect(artifactCalls).toEqual([{ runId: "run_1", path: "artifact.txt", content: "artifact" }]);
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  test("shell denies cwd escapes workspace", async () => {
    seedRoom("room_1", "agent_1");
    permissionEngine = createPermissionEngine({ shell: () => ({ status: "allow" }) });
    server = createServer();

    const result = await currentServer().callTool("shell", { command: "echo hi", cwd: "../../" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied", message: "cwd must be within workspace" } });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test("shell denies agents without terminal.run before requesting permission", async () => {
    seedRoom("room_1", "agent_1");
    bindRoleCapabilities("room_1", "agent_1", ["chat", "context.read"]);
    const check = vi.fn(() => ({ status: "allow" as const }));
    permissionEngine = { check };
    server = createServer();

    const result = await currentServer().callTool("shell", { command: "python --version" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "tool_not_permitted", message: "shell requires the terminal.run capability" } });
    expect(check).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test("stdio config includes agent capabilities so the bridge can hide shell", () => {
    seedRoom("room_1", "agent_1");
    bindRoleCapabilities("room_1", "agent_1", ["chat", "context.read"]);

    const config = currentServer().getRegisteredStdioConfig({ roomId: "room_1", agentId: "agent_1", runId: "run_1", adapterSessionId: "adapter_1" });

    expect(config.env).toEqual(expect.arrayContaining([
      { name: "ROOM_MCP_AGENT_CAPABILITIES", value: JSON.stringify(["chat", "context.read"]) }
    ]));
  });

  test("shell permits agents with terminal.run to reach permission checks", async () => {
    seedRoom("room_1", "agent_1");
    bindRoleCapabilities("room_1", "agent_1", ["chat", "terminal.run"]);
    const check = vi.fn(() => ({ status: "deny" as const, reason: "blocked" }));
    permissionEngine = { check };
    server = createServer();

    const result = await currentServer().callTool("shell", { command: "echo hi" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied", message: "blocked" } });
    expect(check).toHaveBeenCalledTimes(1);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test("shell waits for ask resolution and executes on allow", async () => {
    seedRoom("room_1", "agent_1");
    const deferred = createDeferredResolution();
    permissionEngine = createPermissionEngine({
      shell: () => ({ status: "ask", requestId: "req_shell_allow", promise: deferred.promise })
    });
    execFileMock.mockResolvedValue({ stdout: "stdout", stderr: "stderr" } as never);
    server = createServer();

    const resultPromise = currentServer().callTool("shell", { command: "echo hi" }, session(), context());
    deferred.resolve({ decision: "allowed", reason: "approved", requestId: "req_shell_allow" });
    const result = await resultPromise;

    expect(result).toEqual({ ok: true, data: { stdout: "stdout", stderr: "stderr", code: 0 } });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  test("shell executes inside the active run workDir when one is recorded", async () => {
    seedRoom("room_1", "agent_1");
    const workDir = join(tempDir!, ".agenthub", "worktrees", "run_1");
    seedRunWorkDir(workDir);
    permissionEngine = createPermissionEngine({ shell: () => ({ status: "allow" }) });
    execFileMock.mockResolvedValue({ stdout: "stdout", stderr: "" } as never);
    server = createServer();

    const result = await currentServer().callTool("shell", { command: "echo hi" }, session({ runId: "run_1" }), context());

    expect(result).toEqual({ ok: true, data: { stdout: "stdout", stderr: "", code: 0 } });
    expect(execFileMock).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: workDir }));
  });

  test("shell waits for ask resolution and denies on rejection", async () => {
    seedRoom("room_1", "agent_1");
    const deferred = createDeferredResolution();
    permissionEngine = createPermissionEngine({
      shell: () => ({ status: "ask", requestId: "req_shell_deny", promise: deferred.promise })
    });
    server = createServer();

    const resultPromise = currentServer().callTool("shell", { command: "echo hi" }, session(), context());
    deferred.resolve({ decision: "denied", reason: "blocked", requestId: "req_shell_deny" });
    const result = await resultPromise;

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied", message: "blocked" } });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test("file.read routes through ArtifactFS for read-your-writes consistency", async () => {
    seedRoom("room_1", "agent_1");
    permissionEngine = createPermissionEngine({ file: () => ({ status: "allow" }) });
    const shadowContent = "shadow-content";
    artifactFs = {
      readTextFile: ({ path }) => path === "shadow.txt" ? shadowContent : undefined,
      writeTextFile: () => { /* no-op */ },
    };
    server = createServer();

    const result = await currentServer().callTool("file.read", { path: "shadow.txt" }, session({ runId: "run_1" }), context());

    expect(result).toEqual({ ok: true, data: { path: "shadow.txt", content: shadowContent } });
    // readFileSyncMock should NOT have been called — content came from ArtifactFS.
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  test("file.list does not expose uploaded attachments as a virtual attachments directory", async () => {
    seedRoom("room_1", "agent_1");
    seedUploadedAttachment("file_pdf", "course.pdf", "application/pdf", 4096);

    const root = await currentServer().callTool("file.list", { path: ".", recursive: false, limit: 100 }, session(), context());
    const attachments = await currentServer().callTool("file.list", { path: "attachments", recursive: false, limit: 100 }, session(), context());

    expect(root).toMatchObject({ ok: true, data: { entries: expect.not.arrayContaining([{ path: "attachments", type: "directory", size: 0 }]) } });
    expect(attachments).toMatchObject({ ok: false, error: { code: "uploaded_attachment_not_tool_readable" } });
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  test("file.glob does not include uploaded attachments", async () => {
    seedRoom("room_1", "agent_1");
    seedUploadedAttachment("file_pdf", "course.pdf", "application/pdf", 4096);

    const result = await currentServer().callTool("file.glob", { pattern: "**/*.pdf", limit: 50 }, session(), context());

    expect(result).toEqual({ ok: true, data: { pattern: "**/*.pdf", matches: [] } });
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  test("file.read rejects uploaded attachment virtual paths before permission checks", async () => {
    seedRoom("room_1", "agent_1");
    seedUploadedAttachment("file_pdf", "course.pdf", "application/pdf", 4096);
    const check = vi.fn(() => ({ status: "allow" as const }));
    permissionEngine = { check };
    server = createServer();

    const result = await currentServer().callTool("file.read", { path: "attachments/file_pdf/course.pdf" }, session(), context());

    expect(result).toMatchObject({ ok: false, error: { code: "uploaded_attachment_not_tool_readable" } });
    expect(check).not.toHaveBeenCalled();
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  test("permission check passes idempotency key from MCP request id", async () => {
    seedRoom("room_1", "agent_1");
    const checkCalls: Array<{ idempotencyKey: string | undefined }> = [];
    permissionEngine = {
      check(input: { idempotencyKey?: string }) {
        checkCalls.push({ idempotencyKey: input.idempotencyKey });
        return { status: "allow" as const };
      }
    } as unknown as typeof permissionEngine;
    server = createServer();

    // Seed a real file so readFileSync succeeds.
    writeFileSync(join(tempDir!, "test.txt"), "hello", "utf8");
    readFileSyncMock.mockReset(); // reset after the writeFileSync call above

    await currentServer().callTool("file.read", { path: "test.txt" }, session(), { requestId: "mcp-req-123" });

    expect(checkCalls[0]?.idempotencyKey).toBe("mcp:mcp-req-123:file");
  });
});

let permissionEngine: {
  readonly check: (input: { readonly workspaceId: string; readonly roomId: string; readonly agentId: string; readonly runId: string; readonly resource: { readonly type: string; readonly path?: string; readonly operation?: string; readonly command?: string } }) => PermissionCheckResult;
} | undefined;

let artifactFs: { readonly readTextFile?: (input: { readonly runId: string; readonly path: string }) => string | undefined; readonly writeTextFile: (input: { readonly runId: string; readonly path: string; readonly content: string }) => void } | undefined;

function createServer(): RoomMcpServer {
  return new RoomMcpServer({
    commandBus: new CommandBus({ database: currentDatabase(), handlers: {} as never }),
    taskService: new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now }),
    database: currentDatabase(),
    eventBus: currentBus(),
    ...(permissionEngine !== undefined ? { permissionEngine: permissionEngine as PermissionEngine } : {}),
    ...(artifactFs !== undefined ? { artifactFs } : {}),
  });
}

function currentServer(): RoomMcpServer {
  expect(server).toBeDefined();
  return server as RoomMcpServer;
}

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

function seedRunWorkDir(workDir: string): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES ('run_1', 'ws_1', NULL, 'room_1', 'agent_1', 'mock', NULL, NULL, NULL, 'running', 'primary_turn', NULL, NULL, ?, 'isolated_worktree', NULL, '[]', 0, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)"
  ).run(workDir, now, now, now, now);
}

function bindRoleCapabilities(roomId: string, agentId: string, capabilities: readonly string[]): void {
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_agent_1', 'ws_1', 'Agent Role', '', ?, 0, ?, ?)").run(JSON.stringify(capabilities), now, now);
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_agent_1', 'ws_1', 'role_agent_1', 'runtime_1', NULL, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("UPDATE room_participants SET agent_binding_id = 'binding_agent_1' WHERE room_id = ? AND participant_id = ? AND participant_type = 'agent'").run(roomId, agentId);
}

function seedUploadedAttachment(fileId: string, fileName: string, mimeType: string, byteSize: number): void {
  const messageId = `msg_${fileId}`;
  const storagePath = `.agenthub/attachments/2026/06/${fileId}`;
  currentDatabase().sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'ws_1', 'room_1', 'user', 'u_1', NULL, 'user', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)").run(messageId, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO attachments (id, message_id, file_id, file_name, mime_type, byte_size, sha256, storage_path, created_at) VALUES (?, ?, ?, ?, ?, ?, 'sha', ?, ?)").run(`att_${fileId}`, messageId, fileId, fileName, mimeType, byteSize, storagePath, now);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'attachment', ?, ?)").run(messageId, JSON.stringify({
    type: "attachment",
    fileId,
    name: fileName,
    mimeType,
    sizeBytes: byteSize,
    previewKind: "download"
  }), now);
}

function session(extra: Partial<RoomMcpSessionContext> = {}): RoomMcpSessionContext {
  return { roomId: "room_1", agentId: "agent_1", runId: "run_1", ...extra };
}

function context(): RoomMcpCallContext {
  return {};
}

function createPermissionEngine(handlers: {
  readonly file?: (resource: { readonly type: string; readonly path?: string; readonly operation?: string; readonly command?: string }) => PermissionCheckResult;
  readonly shell?: (resource: { readonly type: string; readonly path?: string; readonly operation?: string; readonly command?: string }) => PermissionCheckResult;
}): NonNullable<typeof permissionEngine> {
  return {
    check(input) {
      if (input.resource.type === "file") return handlers.file?.(input.resource) ?? { status: "allow" };
      if (input.resource.type === "shell") return handlers.shell?.(input.resource) ?? { status: "allow" };
      return { status: "allow" };
    }
  };
}

function createDeferredResolution() {
  let resolve!: (value: { readonly decision: "allowed" | "denied" | "expired"; readonly reason: string; readonly requestId: string }) => void;
  const promise = new Promise<{ readonly decision: "allowed" | "denied" | "expired"; readonly reason: string; readonly requestId: string }>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

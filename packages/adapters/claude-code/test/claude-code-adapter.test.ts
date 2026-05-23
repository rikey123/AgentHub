import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArtifactFSRunRegistry, ArtifactService } from "@agenthub/artifacts";
import { ACPAdapterError } from "@agenthub/adapter-acp-base";
import { CommandBus, createEventBus } from "@agenthub/bus";
import { createDatabase } from "@agenthub/db";
import { RoomMcpServer, RunLifecycleService, TaskService } from "@agenthub/orchestrator";
import { PermissionEngine, seedBuiltInPermissionProfiles } from "@agenthub/permissions";
import type { CreateSessionInput } from "@agenthub/protocol";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ClaudeCodeACPAdapter, claudeCodeManifest } from "../src/index.ts";

describe("ClaudeCodeACPAdapter", () => {
  it("reports explicit not_found/auth_required style absence instead of hiding detection failure", () => {
    const adapter = new ClaudeCodeACPAdapter({ command: "agenthub-claude-missing-for-test" });
    expect(() => Effect.runSync(adapter.detect())).toThrow(/not found|not_found/iu);
  });

  it("manifest is resumable and attachSession restores a persisted session", () => {
    const adapter = new ClaudeCodeACPAdapter({ command: "" });
    const session = Effect.runSync(adapter.attachSession({ runId: "run", adapterSessionId: "claude-session", workDir: ".", providerConversationId: "conv" }));
    expect(claudeCodeManifest.reliability.crashRecovery).toBe("resumable");
    expect(claudeCodeManifest.capabilities.canRestoreSession).toBe(true);
    expect(session).toMatchObject({ id: "claude-session", runId: "run", providerConversationId: "conv" });
  });

  it("maps structured file events through AdapterBridge and ArtifactFS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-claude-artifactfs-"));
    const workspace = join(dir, "workspace");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src", "a.ts"), "old", "utf8");
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('w', 'w', ?, 1, 1)").run(workspace);
    database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('r', 'w', 'r', 'solo', 'conversation', 'a', NULL, 1, 1)").run();
    seedBuiltInPermissionProfiles(database, 1);
    const eventBus = createEventBus({ database });
    const lifecycle = new RunLifecycleService(database, eventBus);
    const artifacts = new ArtifactService({ database, eventBus });
    const artifactFs = new ArtifactFSRunRegistry({ database, service: artifacts, eventBus });
    const permissions = new PermissionEngine({ database, eventBus });
    lifecycle.create(null, { runId: "run", workspaceId: "w", roomId: "r", agentId: "a", wakeReason: "primary_turn", workspaceMode: "shadow_buffer", messageId: "m" });
    lifecycle.markClaimed(null, "run");
    lifecycle.markStarting(null, "run", 123);
    const taskService = new TaskService({ database, eventBus });
    const mcpServer = new RoomMcpServer({ commandBus: new CommandBus({ database }), taskService });
    const adapter = new ClaudeCodeACPAdapter({ command: "", services: { database, eventBus, permissionEngine: permissions, artifactFs }, lifecycle, workspaceId: "w", permissionEngine: permissions, mcpServer });

    await adapter.runManaged(lifecycle.read("run"));
    expect(adapter.debugSession("acp-claude-code-run")?.mcpServer).toBe(mcpServer);
    adapter.mapToBridgeEvent("run", { type: "fs/write", payload: { path: "src/a.ts", content: "new" } });
    adapter.mapToBridgeEvent("run", { type: "session/end", payload: { sessionId: "acp-claude-code-run", reason: "completed" } });

    expect(readFileSync(join(workspace, "src", "a.ts"), "utf8")).toBe("old");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE run_id = 'run'").get()).toMatchObject({ count: 1 });
    database.sqlite.close();
  });

  it("bridges provider stdout events automatically through AdapterBridge and RunLifecycleService", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-claude-stdout-bridge-"));
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('w', 'w', ?, 1, 1)").run(dir);
    database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('r', 'w', 'r', 'solo', 'conversation', 'a', NULL, 1, 1)").run();
    const eventBus = createEventBus({ database });
    const lifecycle = new RunLifecycleService(database, eventBus);
    lifecycle.create(null, { runId: "run", workspaceId: "w", roomId: "r", agentId: "a", wakeReason: "primary_turn" });
    lifecycle.markClaimed(null, "run");
    lifecycle.markStarting(null, "run", 123);
    const adapter = new ClaudeCodeACPAdapter({ command: "", services: { database, eventBus }, lifecycle, workspaceId: "w" });

    await adapter.runManaged(lifecycle.read("run"));
    const session = adapter.debugSession("acp-claude-code-run");
    expect(session).toBeDefined();
    adapter.feedProviderLineForTest("acp-claude-code-run", JSON.stringify({ jsonrpc: "2.0", method: "tool/pre_use", params: { toolCallId: "tool_1", name: "Read", input: { path: "a.ts" } } }));
    adapter.feedProviderLineForTest("acp-claude-code-run", JSON.stringify({ jsonrpc: "2.0", method: "session/end", params: { sessionId: "acp-claude-code-run", reason: "completed", modelId: "claude-test" } }));

    expect(database.sqlite.prepare("SELECT status FROM runs WHERE id = 'run'").get()).toMatchObject({ status: "completed" });
    expect(database.sqlite.prepare("SELECT type FROM events WHERE type = 'tool.call.requested' AND run_id = 'run'").get()).toMatchObject({ type: "tool.call.requested" });
    expect(database.sqlite.prepare("SELECT type FROM events WHERE type = 'agent.run.completed' AND run_id = 'run'").get()).toMatchObject({ type: "agent.run.completed" });
    database.sqlite.close();
  });

  it("bridges managed ACP supervision failure to RunLifecycleService as session.crashed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-claude-crash-bridge-"));
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('w', 'w', ?, 1, 1)").run(dir);
    database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('r', 'w', 'r', 'solo', 'conversation', 'a', NULL, 1, 1)").run();
    const eventBus = createEventBus({ database });
    const lifecycle = new RunLifecycleService(database, eventBus);
    lifecycle.create(null, { runId: "run", workspaceId: "w", roomId: "r", agentId: "a", wakeReason: "primary_turn" });
    lifecycle.markClaimed(null, "run");
    lifecycle.markStarting(null, "run", 123);
    const adapter = new ClaudeCodeACPAdapter({ command: process.execPath, args: ["-e", "process.stdin.setEncoding('utf8');let buffer='';process.stdin.on('data',(chunk)=>{buffer+=chunk;for(;;){const index=buffer.indexOf('\\n');if(index<0)break;const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(line.includes('\\\"method\\\":\\\"session/prompt\\\"')) process.exit(7);}});"], services: { database, eventBus }, lifecycle, workspaceId: "w" });

    await adapter.runManaged(lifecycle.read("run"));
    await waitFor(() => database.sqlite.prepare("SELECT status FROM runs WHERE id = 'run'").get() as { readonly status: string }, (row) => row.status === "failed");

    expect(adapter.debugSession("acp-claude-code-run")?.state).toBe("failed");
    expect(database.sqlite.prepare("SELECT status, failure_class, error FROM runs WHERE id = 'run'").get()).toMatchObject({ status: "failed", failure_class: "retryable_visible", error: "ACP process exited with exit code 7" });
    expect(database.sqlite.prepare("SELECT type FROM events WHERE type = 'agent.run.failed' AND run_id = 'run'").get()).toMatchObject({ type: "agent.run.failed" });
    database.sqlite.close();
  });

  it("bridges ACP failure even when it happens before session.opened is handled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-claude-early-crash-"));
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('w', 'w', ?, 1, 1)").run(dir);
    database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('r', 'w', 'r', 'solo', 'conversation', 'a', NULL, 1, 1)").run();
    const eventBus = createEventBus({ database });
    const lifecycle = new RunLifecycleService(database, eventBus);
    lifecycle.create(null, { runId: "run", workspaceId: "w", roomId: "r", agentId: "a", wakeReason: "primary_turn" });
    lifecycle.markClaimed(null, "run");
    lifecycle.markStarting(null, "run", 123);
    const adapter = new EarlyFailClaudeCodeACPAdapter({ command: "", services: { database, eventBus }, lifecycle, workspaceId: "w" });

    await adapter.runManaged(lifecycle.read("run"));

    expect(database.sqlite.prepare("SELECT status, failure_class, error FROM runs WHERE id = 'run'").get()).toMatchObject({ status: "failed", failure_class: "retryable_visible", error: "early failure" });
    expect(database.sqlite.prepare("SELECT type FROM events WHERE type = 'agent.run.failed' AND run_id = 'run'").get()).toMatchObject({ type: "agent.run.failed" });
    database.sqlite.close();
  });
});

class EarlyFailClaudeCodeACPAdapter extends ClaudeCodeACPAdapter {
  protected override spawnArgs() { return { command: "", args: [] as const }; }
  protected override createSessionSync(input: CreateSessionInput) {
    const session = super.createSessionSync(input);
    const debug = this.debugSession(session.id);
    if (debug === undefined) throw new Error("missing test session");
    debug.state = "failed";
    this.onSessionFailed(debug, new ACPAdapterError("process_exit", "early failure"));
    return session;
  }
}

async function waitFor<T>(read: () => T, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 2_000;
  let value = read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = read();
  }
  if (!done(value)) throw new Error(`Timed out waiting for condition: ${JSON.stringify(value)}`);
  return value;
}

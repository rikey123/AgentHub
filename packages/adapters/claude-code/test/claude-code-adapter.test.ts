import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { ArtifactFSRunRegistry, ArtifactService } from "@agenthub/artifacts";
import { ACPAdapterError } from "@agenthub/adapter-acp-base";
import { CommandBus, createEventBus } from "@agenthub/bus";
import { createDatabase } from "@agenthub/db";
import { RoomMcpServer, RunLifecycleService, TaskService } from "@agenthub/orchestrator";
import { PermissionEngine, seedBuiltInPermissionProfiles } from "@agenthub/permissions";
import type { AdapterMessage, CreateSessionInput } from "@agenthub/protocol";
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
    const mcpServer = new RoomMcpServer({ commandBus: new CommandBus({ database }), taskService, database, eventBus });
    const adapter = new ClaudeCodeACPAdapter({ command: "", services: { database, eventBus, permissionEngine: permissions, artifactFs }, lifecycle, workspaceId: "w", permissionEngine: permissions, mcpServer });

    await adapter.runManaged(lifecycle.read("run"));
    // mcpServer in the ACP session is now the stdio config (not the RoomMcpServer instance)
    const sessionMcp = adapter.debugSession("acp-claude-code-run")?.mcpServer;
    expect(sessionMcp).toMatchObject({ name: "agenthub-room", command: "node" });
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

  it("maps Claude hook completions to snapshot, subagent, and diff marker events", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-claude-hooks-"));
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('w', 'w', ?, 1, 1)").run(dir);
    database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('r', 'w', 'r', 'solo', 'conversation', 'a', NULL, 1, 1)").run();
    const eventBus = createEventBus({ database });
    let diffDetected: unknown;
    eventBus.subscribe("artifact.diff.detected", (event) => { diffDetected = event.payload; });
    const lifecycle = new RunLifecycleService(database, eventBus);
    lifecycle.create(null, { runId: "run", workspaceId: "w", roomId: "r", agentId: "a", wakeReason: "primary_turn", taskId: "task_1" });
    lifecycle.markClaimed(null, "run");
    lifecycle.markStarting(null, "run", 123);
    const adapter = new ClaudeCodeACPAdapter({ command: "", services: { database, eventBus }, lifecycle, workspaceId: "w", now: () => 1234 });

    await adapter.runManaged(lifecycle.read("run"));
    adapter.mapToBridgeEvent("run", { type: "pre_compact", payload: { text: "compacted summary" } });
    adapter.mapToBridgeEvent("run", { type: "subagent_start", payload: { subagentId: "sub_1", role: "reviewer" } });
    adapter.mapToBridgeEvent("run", { type: "subagent_stop", payload: { subagentId: "sub_1", durationMs: 42, cost: { inputTokens: 1, outputTokens: 2, cachedTokens: 3, costUsd: 0.04, modelId: "claude-test" } } });
    adapter.mapToBridgeEvent("run", { type: "tool/post_use", payload: { toolCallId: "tool_1", name: "Write", input: { file_path: "src/a.ts" }, output: { ok: true } } });

    expect(eventPayload(database, "context.snapshot")).toMatchObject({ runId: "run", idempotencyKey: "claude_compact:run", snapshot: { kind: "claude_compact", text: "compacted summary" } });
    expect(eventPayload(database, "subagent.started")).toMatchObject({ runId: "run", subagentId: "sub_1", role: "reviewer" });
    expect(eventPayload(database, "subagent.completed")).toMatchObject({ runId: "run", subagentId: "sub_1", durationMs: 42, cost: { inputTokens: 1, outputTokens: 2, cachedTokens: 3, costUsd: 0.04, modelId: "claude-test" } });
    expect(diffDetected).toMatchObject({ runId: "run", path: "src/a.ts" });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'artifact.diff.detected'").get()).toMatchObject({ count: 0 });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE run_id = 'run'").get()).toMatchObject({ count: 0 });
    expect(database.sqlite.prepare("SELECT type FROM events WHERE type = 'file.changed' AND run_id = 'run'").get()).toMatchObject({ type: "file.changed" });
    database.sqlite.close();
  });

  it("@integration:claude-code skips real claude smoke coverage when the binary is absent", () => {
    if (process.env.AGENTHUB_RUN_REAL_CLAUDE_SMOKE !== "1") return;
    const detected = spawnSync(process.platform === "win32" ? "where.exe" : "command", process.platform === "win32" ? ["claude"] : ["-v", "claude"], { stdio: "ignore", shell: false });
    if (detected.status !== 0) return;
    const adapter = new ClaudeCodeACPAdapter({ command: "claude" });
    expect(() => Effect.runSync(adapter.detect())).not.toThrow();
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
    // Child replies to the ACP handshake (initialize + session/new), then exits when it
    // receives the managed session/prompt request. This proves the post-session.opened prompt
    // path while keeping the crash in a real child process.
    const crashAfterPromptScript = `
      let buffer = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\\r?\\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
            continue;
          }
          if (msg.method === "session/new") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "test-session" } }) + "\\n");
            continue;
          }
          if (msg.method === "session/prompt") process.exit(7);
        }
      });
    `;
    const adapter = new ClaudeCodeACPAdapter({ command: process.execPath, args: ["-e", crashAfterPromptScript], services: { database, eventBus }, lifecycle, workspaceId: "w" });

    try {
      await adapter.runManaged(lifecycle.read("run"));
      await waitFor(
        () => ({
          sessionReleased: adapter.debugSession("acp-claude-code-run") === undefined,
          run: database.sqlite.prepare("SELECT status, failure_class, error FROM runs WHERE id = 'run'").get() as { readonly status: string; readonly failure_class: string | null; readonly error: string | null },
          failedEvent: database.sqlite.prepare("SELECT type FROM events WHERE type = 'agent.run.failed' AND run_id = 'run'").get() as { readonly type: string } | undefined
        }),
        (value) => value.sessionReleased && value.run.status === "failed" && value.failedEvent?.type === "agent.run.failed",
        { timeoutMs: 10_000 }
      );

      expect(adapter.debugSession("acp-claude-code-run")).toBeUndefined();
      expect(database.sqlite.prepare("SELECT status, failure_class, error FROM runs WHERE id = 'run'").get()).toMatchObject({ status: "failed", failure_class: "retryable_visible", error: "ACP process exited with exit code 7" });
      expect(database.sqlite.prepare("SELECT type FROM events WHERE type = 'agent.run.failed' AND run_id = 'run'").get()).toMatchObject({ type: "agent.run.failed" });
    } finally {
      const session = adapter.debugSession("acp-claude-code-run");
      if (session !== undefined && session.state !== "disposed") Effect.runSync(adapter.dispose("acp-claude-code-run"));
      database.sqlite.close();
    }
  }, 15_000);

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

  it("builds managed prompts from the run-bound mailbox instead of the latest room user message", async () => {
    const fixture = createPromptFixture("claude-code");
    try {
      const adapter = new CapturingClaudeCodeACPAdapter({ command: "", services: { database: fixture.database, eventBus: fixture.eventBus }, lifecycle: fixture.lifecycle, workspaceId: "ws_1" });

      await adapter.runManaged(fixture.lifecycle.read("run_mailbox"));

      expect(adapter.capturedPrompt).toContain("mailbox task from teammate");
      expect(adapter.capturedPrompt).not.toContain("WRONG latest user message");
    } finally {
      fixture.close();
    }
  });
});

class CapturingClaudeCodeACPAdapter extends ClaudeCodeACPAdapter {
  capturedPrompt = "";

  protected override sendPrompt(_sessionId: string, message: AdapterMessage): string {
    this.capturedPrompt = message.content;
    return "captured";
  }
}

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

function createPromptFixture(adapterId: string): { readonly database: ReturnType<typeof createDatabase>; readonly eventBus: ReturnType<typeof createEventBus>; readonly lifecycle: RunLifecycleService; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), "agenthub-claude-prompt-"));
  const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_1', 'ws_1', 'Agent One', ?, NULL, '', '{}', NULL, 0, NULL, 1, 1)").run(adapterId);
  database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_2', 'ws_1', 'Teammate', 'mock', NULL, '', '{}', NULL, 0, NULL, 1, 1)").run();
  database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'assisted', 'conversation', 'agent_1', NULL, 1, 1)").run();
  database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', ?, NULL, 'active', 1)").run(adapterId);
  database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'agent_2', 'agent', 'observer', 'mock', NULL, 'active', 1)").run();
  database.sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES ('msg_latest', 'ws_1', 'room_1', 'user', 'u_1', NULL, 'user', 'completed', NULL, 'immediate', NULL, 2, 2, NULL)").run();
  database.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES ('msg_latest', 1, 'text', ?, 2)").run(JSON.stringify({ text: "WRONG latest user message" }));
  database.sqlite.prepare("INSERT INTO mailbox_messages (id, workspace_id, room_id, from_type, from_id, to_agent_id, kind, content, files, read, claimed_run_id, claimed_at, delivery_batch_id, delivery_failure_reason, attempt_count, created_at, consumed_at) VALUES ('mb_1', 'ws_1', 'room_1', 'agent', 'agent_2', 'agent_1', 'message', ?, '[]', 1, 'run_mailbox', 1, NULL, NULL, 0, 1, NULL)").run(JSON.stringify({ text: "mailbox task from teammate" }));
  const eventBus = createEventBus({ database });
  const lifecycle = new RunLifecycleService(database, eventBus, { now: () => 1 });
  lifecycle.create(null, { runId: "run_mailbox", workspaceId: "ws_1", roomId: "room_1", agentId: "agent_1", wakeReason: "mailbox_message" });
  lifecycle.markClaimed(null, "run_mailbox");
  lifecycle.markStarting(null, "run_mailbox", 123);

  return {
    database,
    eventBus,
    lifecycle,
    close: () => {
      eventBus.close();
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function eventPayload(database: ReturnType<typeof createDatabase>, type: string): unknown {
  const row = database.sqlite.prepare("SELECT payload FROM events WHERE type = ? ORDER BY seq DESC LIMIT 1").get(type) as { readonly payload: string } | undefined;
  if (row !== undefined) return JSON.parse(row.payload) as unknown;
  throw new Error(`Missing event '${type}'`);
}

async function waitFor<T>(read: () => T, done: (value: T) => boolean, options: { readonly timeoutMs?: number } = {}): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 2_000);
  let value = read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = read();
  }
  if (!done(value)) throw new Error(`Timed out waiting for condition: ${JSON.stringify(value)}`);
  return value;
}

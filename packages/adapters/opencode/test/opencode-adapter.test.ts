import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { RunLifecycleService } from "@agenthub/orchestrator";
import type { AdapterMessage } from "@agenthub/protocol";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { OpenCodeACPAdapter, opencodeManifest } from "../src/index.ts";

describe("OpenCodeACPAdapter", () => {
  it("declares the required ACP manifest contract", () => {
    expect(opencodeManifest).toMatchObject({
      id: "opencode",
      runtimeKind: "acp",
      reliability: { crashRecovery: "resumable", parseFailure: "skip_event" },
      context: { injectionMode: "immediate" },
      workspace: { mode: "worktree" }
    });
    expect(opencodeManifest.capabilities.canRestoreSession).toBe(true);
    expect(opencodeManifest.capabilities.canEmitSubagentEvents).toBe(true);
  });

  it("detect returns [] instead of throwing when OpenCode is missing", () => {
    const adapter = new OpenCodeACPAdapter({ command: "agenthub-opencode-missing-for-test" });

    expect(Effect.runSync(adapter.detect())).toEqual([]);
  });

  it("attachSession restores a persisted resumable ACP session", () => {
    const adapter = new OpenCodeACPAdapter({ command: "" });

    const session = Effect.runSync(adapter.attachSession({ runId: "run", adapterSessionId: "opencode-session", workDir: ".", providerConversationId: "conv" }));

    expect(session).toMatchObject({ id: "opencode-session", runId: "run", workDir: ".", providerConversationId: "conv" });
    expect(adapter.debugSession("opencode-session")?.state).toBe("ready");
  });

  it("maps native ACP prompt/tool/permission/subagent/context/cancel/error events", () => {
    const adapter = new OpenCodeACPAdapter({ command: "" });
    const session = Effect.runSync(adapter.createSession({ runId: "run-events", roomId: "room", agentId: "agent" }));

    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "prompt_started", params: { id: "prompt" } }))).toMatchObject({ type: "prompt.started" });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "tool/pre_use", params: { id: "tool_1", tool: "Bash", arguments: { command: "pwd" } } }))).toMatchObject({ type: "tool.call.requested", payload: { toolCallId: "tool_1", name: "Bash", input: { command: "pwd" } } });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "permission/request", params: { id: "perm_1", reason: "write file" } }))).toMatchObject({ type: "permission.requested", payload: { permissionId: "perm_1" } });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "subagent_start", params: { id: "sub_1", role: "reviewer" } }))).toMatchObject({ type: "subagent.started", payload: { subRunId: "sub_1", profileRef: "reviewer" } });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "context_snapshot", params: { text: "summary" } }))).toEqual({ type: "context.snapshot", payload: { kind: "opencode_context", text: "summary", metadata: { adapterId: "opencode" } } });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "session/cancelled", params: { sessionId: session.id } }))).toMatchObject({ type: "session.ended", payload: { reason: "cancelled" } });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "session/error", params: { message: "boom" } }))).toMatchObject({ type: "session.crashed", payload: { error: "boom" } });
  });

  it("skips unknown provider events for parseFailure skip_event behavior", () => {
    const adapter = new OpenCodeACPAdapter({ command: "" });
    const session = Effect.runSync(adapter.createSession({ runId: "run-unknown", roomId: "room", agentId: "agent" }));

    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "opencode/unknown", params: { value: true } }))).toBeUndefined();
  });

  it("uses OPENCODE_BIN integration detection only when explicitly available", () => {
    const opencodeBin = process.env.OPENCODE_BIN;
    if (opencodeBin === undefined || opencodeBin.length === 0) {
      return;
    }
    const adapter = new OpenCodeACPAdapter({ command: opencodeBin });

    const detected = Effect.runSync(adapter.detect());

    expect(detected[0]).toMatchObject({ id: "opencode", executablePath: opencodeBin });
  });

  it("builds managed prompts from the run-bound mailbox instead of the latest room user message", async () => {
    const fixture = createPromptFixture("opencode");
    try {
      const adapter = new CapturingOpenCodeACPAdapter({ command: "", services: { database: fixture.database, eventBus: fixture.eventBus }, lifecycle: fixture.lifecycle, workspaceId: "ws_1" });

      await adapter.runManaged(fixture.lifecycle.read("run_mailbox"));

      expect(adapter.capturedPrompt).toContain("mailbox task from teammate");
      expect(adapter.capturedPrompt).not.toContain("WRONG latest user message");
    } finally {
      fixture.close();
    }
  });
});

class CapturingOpenCodeACPAdapter extends OpenCodeACPAdapter {
  capturedPrompt = "";

  protected override sendPrompt(_sessionId: string, message: AdapterMessage): string {
    this.capturedPrompt = message.content;
    return "captured";
  }
}

function createPromptFixture(adapterId: string): { readonly database: AgentHubDatabase; readonly eventBus: ReturnType<typeof createEventBus>; readonly lifecycle: RunLifecycleService; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), "agenthub-opencode-prompt-"));
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

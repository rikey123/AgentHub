import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { RunLifecycleService } from "@agenthub/orchestrator";
import type { AdapterMessage } from "@agenthub/protocol";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

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

  it("finalizes managed cancellation without waiting for a provider session/end event", async () => {
    const fixture = createPromptFixture("opencode");
    try {
      const adapter = new OpenCodeACPAdapter({ command: "", services: { database: fixture.database, eventBus: fixture.eventBus }, lifecycle: fixture.lifecycle, workspaceId: "ws_1" });

      await adapter.runManaged(fixture.lifecycle.read("run_mailbox"));
      fixture.lifecycle.markCancelling(null, "run_mailbox");
      await adapter.cancelManagedRun("run_mailbox");

      expect(fixture.database.sqlite.prepare("SELECT status, failure_class FROM runs WHERE id = 'run_mailbox'").get()).toMatchObject({
        status: "cancelled",
        failure_class: "user_cancelled"
      });
      expect(fixture.database.sqlite.prepare("SELECT type FROM events WHERE type = 'agent.run.cancelled' AND run_id = 'run_mailbox'").get()).toMatchObject({ type: "agent.run.cancelled" });
    } finally {
      fixture.close();
    }
  });

  it("creates managed sessions in the ArtifactFS prepared workDir", async () => {
    const fixture = createPromptFixture("opencode");
    try {
      const preparedRoot = join("prepared", "opencode-run");
      const artifactFs = {
        beginRun: vi.fn(() => ({ workDir: preparedRoot })),
        writeTextFile: vi.fn(),
        deleteFile: vi.fn(),
        buildRunArtifact: vi.fn(),
        buildWorktreeDiffArtifact: vi.fn()
      };
      const adapter = new CapturingOpenCodeACPAdapter({ command: "", services: { database: fixture.database, eventBus: fixture.eventBus }, lifecycle: fixture.lifecycle, workspaceId: "ws_1", artifactFs });

      await adapter.runManaged(fixture.lifecycle.read("run_mailbox"));

      expect(artifactFs.beginRun).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_mailbox", messageId: "msg_run_mailbox", terminalEnabled: false }));
      expect(adapter.debugSession("acp-opencode-run_mailbox")).toMatchObject({ workDir: preparedRoot });
    } finally {
      fixture.close();
    }
  });

  it("turns long assisted public replies into a short chat message plus a file card", async () => {
    const fixture = createPromptFixture("opencode");
    try {
      const createdFiles: Array<{ readonly title: string; readonly content: string; readonly messageId: string }> = [];
      const adapter = new OpenCodeACPAdapter({
        command: "",
        services: {
          database: fixture.database,
          eventBus: fixture.eventBus,
          fileMessageService: {
            createFromContent(input) {
              createdFiles.push({ title: input.title, content: input.content, messageId: input.messageId });
              return {
                artifactId: "artifact-opencode-long-reply",
                path: "opencode-reply.md",
                name: "opencode-reply.md",
                mimeType: "text/markdown",
                sizeBytes: Buffer.byteLength(input.content, "utf8"),
                previewKind: "markdown"
              };
            }
          }
        },
        lifecycle: fixture.lifecycle,
        workspaceId: "ws_1",
        now: () => 1234
      });
      const run = fixture.lifecycle.read("run_mailbox");
      const longText = [
        "我先抛一个框架，方便大家接着补充：",
        "",
        "开发一个多-agent交互助手，核心不是多接几个模型，而是先设计协作机制。",
        "",
        "1. 角色层：定义有哪些agent、每个agent负责什么、什么时候发言。",
        "2. 调度层：决定谁先说、谁补充、谁总结，避免所有人同时长篇输出。",
        "3. 产物层：把详细方案、表格和文档放入文件，聊天里只保留短观点。",
        "4. 审计层：保留每次任务、工具调用和决策记录。",
        "5. 前端层：让用户看到群聊过程、任务进度和可点击文件。"
      ].join("\n");

      await adapter.runManaged(run);
      adapter.feedProviderLineForTest("acp-opencode-run_mailbox", JSON.stringify({ jsonrpc: "2.0", method: "message/delta", params: { delta: longText } }));
      adapter.feedProviderLineForTest("acp-opencode-run_mailbox", JSON.stringify({ jsonrpc: "2.0", method: "session/end", params: { sessionId: "acp-opencode-run_mailbox", reason: "completed", modelId: "opencode-test" } }));

      expect(assistantMessageText(fixture.database, "run_mailbox")).toBe("我先抛一个框架，方便大家接着补充： 详细内容见文件。");
      expect(createdFiles).toEqual([{ title: "Agent One reply", content: longText, messageId: "msg_run_mailbox" }]);
      expect(messagePartTypes(fixture.database, "msg_run_mailbox")).toEqual(["text", "attachment"]);
      expect(eventPayload(fixture.database, "message.part.added", "run_mailbox")).toMatchObject({
        messageId: "msg_run_mailbox",
        part: {
          type: "attachment",
          artifactId: "artifact-opencode-long-reply",
          path: "opencode-reply.md",
          previewKind: "markdown"
        }
      });
      expect(eventPayload(fixture.database, "message.completed", "run_mailbox")).toMatchObject({ messageId: "msg_run_mailbox", text: "我先抛一个框架，方便大家接着补充： 详细内容见文件。" });
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

function assistantMessageText(database: AgentHubDatabase, runId: string): string {
  const messageId = `msg_${runId}`;
  const payload = database.sqlite.prepare("SELECT payload FROM message_parts WHERE message_id = ? AND part_type = 'text' ORDER BY seq DESC LIMIT 1").pluck().get(messageId) as string | undefined;
  if (payload === undefined) return "";
  return (JSON.parse(payload) as { readonly text?: string }).text ?? "";
}

function messagePartTypes(database: AgentHubDatabase, messageId: string): string[] {
  return database.sqlite.prepare("SELECT part_type FROM message_parts WHERE message_id = ? ORDER BY seq ASC").all(messageId).map((row) => (row as { readonly part_type: string }).part_type);
}

function eventPayload(database: AgentHubDatabase, type: string, runId: string): Record<string, unknown> {
  const row = database.sqlite.prepare("SELECT payload FROM events WHERE type = ? AND run_id = ? ORDER BY seq DESC LIMIT 1").get(type, runId);
  expect(row).toBeDefined();
  return JSON.parse((row as { readonly payload: string }).payload) as Record<string, unknown>;
}

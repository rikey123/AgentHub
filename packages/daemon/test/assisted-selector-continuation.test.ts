import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus, type CommandBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { RunLifecycleService, type AgentPromptDelta } from "@agenthub/orchestrator";

import { continueAssistedSelectorAfterRun } from "../src/assisted-selector-continuation.ts";

type WakeDispatch = {
  readonly type: string;
  readonly agentId: string;
  readonly messageId?: string;
  readonly idempotencyKey?: string;
  readonly promptDelta?: AgentPromptDelta;
};

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let dispatches: WakeDispatch[] = [];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-assisted-selector-continuation-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  dispatches = [];
  seedRun();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  dispatches = [];
});

describe("continueAssistedSelectorAfterRun", () => {
  test("continues an assisted group turn when a selected run completes", async () => {
    const selector = {
      continueTurn: vi.fn(async () => ({
        agentId: "agent_reviewer",
        reason: "selector" as const,
        turnIndex: 2,
        userMessageId: "msg_user"
      }))
    };

    await continueAssistedSelectorAfterRun({
      database: currentDatabase(),
      getCommandBus: () => currentCommandBus(),
      assistedSelector: selector
    }, "run_builder");

    expect(selector.continueTurn).toHaveBeenCalledWith({
      userMessageId: "msg_user",
      completedRunId: "run_builder",
      completedAgentId: "agent_builder",
      completedText: "Builder says to use selector group chat.",
      history: expect.stringContaining("Builder: Builder says to use selector group chat.")
    });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      type: "WakeAgent",
      agentId: "agent_reviewer",
      messageId: "msg_user",
      idempotencyKey: "assisted-selector:msg_user:2:agent_reviewer"
    });
  });

  test("passes closing synthesis prompt delta into the follow-up wake", async () => {
    const promptDelta: AgentPromptDelta = {
      kind: "delta_only",
      instructions: "This is the final closing synthesis for the current assisted group turn."
    };
    const selector = {
      continueTurn: vi.fn(async () => ({
        agentId: "agent_pm",
        reason: "closing_synthesis" as const,
        turnIndex: 3,
        userMessageId: "msg_user",
        promptDelta
      }))
    };

    await continueAssistedSelectorAfterRun({
      database: currentDatabase(),
      getCommandBus: () => currentCommandBus(),
      assistedSelector: selector
    }, "run_builder");

    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({
      type: "WakeAgent",
      agentId: "agent_pm",
      messageId: "msg_user",
      idempotencyKey: "assisted-selector:msg_user:3:agent_pm",
      promptDelta
    });
  });

  test("passes role names and file-backed reply excerpts to the selector thread", async () => {
    seedFileAttachment("msg_builder", "artifact_builder", "agent-replies/builder.md", "# Builder notes\n\nUse a selector group chat with shared file context.");
    const selector = {
      continueTurn: vi.fn(async () => ({
        agentId: "agent_reviewer",
        reason: "selector" as const,
        turnIndex: 2,
        userMessageId: "msg_user"
      }))
    };

    await continueAssistedSelectorAfterRun({
      database: currentDatabase(),
      getCommandBus: () => currentCommandBus(),
      assistedSelector: selector
    }, "run_builder");

    expect(selector.continueTurn).toHaveBeenCalledWith(expect.objectContaining({
      completedText: expect.stringContaining("Use a selector group chat with shared file context."),
      history: expect.stringContaining("Builder: Builder says to use selector group chat.")
    }));
    expect(selector.continueTurn).toHaveBeenCalledWith(expect.objectContaining({
      history: expect.stringContaining("[File: agent-replies/builder.md]")
    }));
    expect(selector.continueTurn).toHaveBeenCalledWith(expect.objectContaining({
      history: expect.stringContaining("Use a selector group chat with shared file context.")
    }));
    expect(selector.continueTurn).toHaveBeenCalledWith(expect.objectContaining({
      history: expect.not.stringContaining("agent_builder:")
    }));
  });

  test("passes uploaded file attachment names to the selector thread without reading file contents", async () => {
    seedUploadedAttachment("msg_user", "123e4567-e89b-12d3-a456-426614174301", "issue.md", "# Issue\n\nUploaded selector context.");
    const selector = {
      continueTurn: vi.fn(async () => ({
        agentId: "agent_reviewer",
        reason: "selector" as const,
        turnIndex: 2,
        userMessageId: "msg_user"
      }))
    };

    await continueAssistedSelectorAfterRun({
      database: currentDatabase(),
      getCommandBus: () => currentCommandBus(),
      assistedSelector: selector
    }, "run_builder");

    expect(selector.continueTurn).toHaveBeenCalledWith(expect.objectContaining({
      history: expect.stringContaining("[Attachment: issue.md (text/markdown)]")
    }));
    expect(selector.continueTurn).toHaveBeenCalledWith(expect.objectContaining({
      history: expect.not.stringContaining("Uploaded selector context.")
    }));
  });
});

function currentCommandBus(): CommandBus {
  return {
    dispatch(command: { readonly type: string; readonly agentId?: string; readonly messageId?: string; readonly idempotencyKey?: string; readonly promptDelta?: AgentPromptDelta }) {
      dispatches.push({
        type: command.type,
        agentId: command.agentId ?? "",
        ...(command.messageId !== undefined ? { messageId: command.messageId } : {}),
        ...(command.idempotencyKey !== undefined ? { idempotencyKey: command.idempotencyKey } : {}),
        ...(command.promptDelta !== undefined ? { promptDelta: command.promptDelta } : {})
      });
      return { ok: true, data: {}, emittedEvents: [] };
    }
  } as unknown as CommandBus;
}

function seedRun(): void {
  const db = currentDatabase();
  db.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  db.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_builder', 'ws_1', 'Builder', '', '[]', 0, 1, 1)").run();
  db.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_reviewer', 'ws_1', 'Reviewer', '', '[]', 0, 1, 1)").run();
  db.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_builder', 'ws_1', 'role_builder', 'runtime_1', NULL, NULL, 1, 1)").run();
  db.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_reviewer', 'ws_1', 'role_reviewer', 'runtime_1', NULL, NULL, 1, 1)").run();
  db.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_builder', 'ws_1', 'Runtime Builder', 'mock', NULL, '', '{}', NULL, 0, NULL, 1, 1)").run();
  db.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_reviewer', 'ws_1', 'Runtime Reviewer', 'mock', NULL, '', '{}', NULL, 0, NULL, 1, 1)").run();
  db.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_assisted', 'ws_1', 'Assisted Room', 'assisted', 'conversation', 'agent_pm', NULL, 1, 1)").run();
  db.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_assisted', 'agent_builder', 'agent', 'teammate', 'mock', NULL, 'binding_builder', 'active', 1)").run();
  db.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_assisted', 'agent_reviewer', 'agent', 'teammate', 'mock', NULL, 'binding_reviewer', 'active', 2)").run();
  db.sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES ('msg_user', 'ws_1', 'room_assisted', 'user', 'u_1', NULL, 'user', 'completed', NULL, 'immediate', NULL, 1, 1, NULL)").run();
  db.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES ('msg_user', 1, 'text', ?, 1)").run(JSON.stringify({ text: "Discuss this" }));
  const lifecycle = new RunLifecycleService(db, currentBus(), { now: () => 2 });
  lifecycle.create(null, {
    runId: "run_builder",
    agentId: "agent_builder",
    roomId: "room_assisted",
    workspaceId: "ws_1",
    wakeReason: "primary_turn",
    messageId: "msg_user"
  });
  db.sqlite.prepare("UPDATE runs SET status = 'completed', ended_at = 3 WHERE id = 'run_builder'").run();
  db.sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES ('msg_builder', 'ws_1', 'room_assisted', 'agent', 'agent_builder', 'run_builder', 'assistant', 'completed', NULL, 'immediate', NULL, 3, 3, NULL)").run();
  db.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES ('msg_builder', 1, 'text', ?, 3)").run(JSON.stringify({ text: "Builder says to use selector group chat." }));
}

function seedFileAttachment(messageId: string, artifactId: string, path: string, content: string): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, title, status, created_by, metadata, created_at, updated_at, applied_at) VALUES (?, 'ws_1', 'room_assisted', NULL, 'run_builder', ?, 'file', ?, 'draft', 'agent_builder', '{}', 4, 4, NULL)"
  ).run(artifactId, messageId, path);
  currentDatabase().sqlite.prepare(
    "INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at) VALUES (?, ?, '', ?, NULL, 1, 0, 'added', NULL, NULL, NULL, NULL, 4)"
  ).run(artifactId, path, content);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 2, 'attachment', ?, 4)").run(messageId, JSON.stringify({
    fileId: artifactId,
    artifactId,
    path,
    name: path.split("/").at(-1) ?? path,
    mimeType: "text/markdown",
    sizeBytes: Buffer.byteLength(content, "utf8"),
    previewKind: "markdown"
  }));
}

function seedUploadedAttachment(messageId: string, fileId: string, name: string, content: string): void {
  if (tempDir === undefined) throw new Error("missing temp dir");
  currentDatabase().sqlite.prepare("UPDATE workspaces SET root_path = ? WHERE id = 'ws_1'").run(tempDir);
  const relativeStoragePath = `.agenthub/attachments/2026/06/${fileId}`;
  const storagePath = join(tempDir, ...relativeStoragePath.split("/"));
  mkdirSync(join(tempDir, ".agenthub", "attachments", "2026", "06"), { recursive: true });
  writeFileSync(storagePath, content, "utf8");
  currentDatabase().sqlite.prepare("INSERT INTO attachments (id, message_id, file_id, file_name, mime_type, byte_size, sha256, storage_path, created_at) VALUES (?, ?, ?, ?, 'text/markdown', ?, 'sha', ?, 4)").run(`att_${fileId}`, messageId, fileId, name, Buffer.byteLength(content, "utf8"), relativeStoragePath);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 2, 'attachment', ?, 4)").run(messageId, JSON.stringify({
    fileId,
    name,
    mimeType: "text/markdown",
    sizeBytes: Buffer.byteLength(content, "utf8"),
    previewKind: "markdown"
  }));
}

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

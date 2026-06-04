import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus, type CommandBus, type CommandResult } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { createDaemonCommandHandlers } from "../../daemon/src/commands.ts";
import type { PendingTurnService } from "../src/pending-turn.ts";

type WakeDispatch = {
  readonly type: string;
  readonly reason: string;
  readonly agentId: string;
  readonly messageId?: string;
};

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let dispatches: WakeDispatch[] = [];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-assisted-selector-routing-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  dispatches = [];
  seedWorkspace();
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

describe("assisted selector routing", () => {
  test("assisted messages wake the speaker selected by the selector manager", async () => {
    insertAssistedRoom();
    insertAgent("agent_pm", "Project Manager");
    insertAgent("agent_builder", "Builder");
    insertAgent("agent_reviewer", "Reviewer");
    insertParticipant("agent_pm", "primary", "active", 1);
    insertParticipant("agent_builder", "teammate", "active", 2);
    insertParticipant("agent_reviewer", "observer", "observing", 3);
    const selector = {
      forgetRoomTurns: vi.fn(),
      startTurn: vi.fn(async (input: { readonly userMessageId: string }) => ({
        agentId: "agent_builder",
        reason: "selector" as const,
        turnIndex: 1,
        userMessageId: input.userMessageId
      }))
    };

    const result = await sendMessage({ roomId: "room_assisted", text: "Discuss the platform design" }, selector);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    await waitForDispatches(1);
    expect(selector.forgetRoomTurns).toHaveBeenCalledWith("room_assisted");
    expect(selector.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "room_assisted",
      workspaceId: "ws_1",
      text: "Discuss the platform design",
      primaryAgentId: "agent_pm",
      participants: expect.arrayContaining([
        expect.objectContaining({ agentId: "agent_pm", role: "primary", presence: "active" }),
        expect.objectContaining({ agentId: "agent_builder", role: "teammate", presence: "active" }),
        expect.objectContaining({ agentId: "agent_reviewer", role: "observer", presence: "observing" })
      ])
    }));
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({ type: "WakeAgent", agentId: "agent_builder", reason: "primary_turn" });
    expect(dispatches[0]?.messageId).toBe((result.data as { readonly messageId: string }).messageId);
  });

  test("assisted rooms created from V1 bindings do not duplicate the primary participant", async () => {
    currentDatabase().sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES ('role_pm', 'ws_1', 'Project Manager', NULL, 'Coordinates.', 'PM prompt', '[]', NULL, NULL, 0, NULL, NULL, 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES ('role_builder', 'ws_1', 'Builder', NULL, 'Builds.', 'Builder prompt', '[]', NULL, NULL, 0, NULL, NULL, 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES ('runtime_native', 'ws_1', 'native', 'Native', NULL, NULL, NULL, NULL, NULL, NULL, '[]', NULL, NULL, '{}', 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_pm', 'ws_1', 'role_pm', 'runtime_native', NULL, NULL, 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_builder', 'ws_1', 'role_builder', 'runtime_native', NULL, NULL, 1, 1)").run();
    const handlers = createDaemonCommandHandlers({
      database: currentDatabase(),
      eventBus: currentBus(),
      getCommandBus: () => currentCommandBus(),
      pendingTurns: { cancel: vi.fn(() => ({ ok: true, data: {}, emittedEvents: [] })) } as unknown as PendingTurnService,
      now: () => 1_000
    });
    const handler = handlers.CreateRoom;
    if (handler === undefined) throw new Error("CreateRoom handler missing");

    const result = await Promise.resolve(handler({
      type: "CreateRoom",
      title: "V1 Assisted",
      mode: "assisted",
      primaryAgentId: "binding_pm",
      participants: [
        { roleId: "role_pm", runtimeId: "runtime_native", role: "primary", defaultPresence: "active" },
        { roleId: "role_builder", runtimeId: "runtime_native", role: "teammate", defaultPresence: "active" }
      ]
    }, { actor: { type: "user", id: "u_1" }, traceId: "trace_create", idempotencyKey: "create_v1_assisted", origin: "mcp_tool" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const roomId = (result.data as { readonly roomId: string }).roomId;
    expect(currentDatabase().sqlite.prepare("SELECT participant_id, role FROM room_participants WHERE room_id = ? ORDER BY role ASC").all(roomId)).toEqual([
      { participant_id: "binding_pm", role: "primary" },
      { participant_id: "binding_builder", role: "teammate" }
    ]);
  });

  test("assisted selector participants use live presence over default presence", async () => {
    insertAssistedRoom();
    insertAgent("agent_pm", "Project Manager");
    insertAgent("agent_builder", "Builder");
    insertAgent("agent_reviewer", "Reviewer");
    insertParticipant("agent_pm", "primary", "active", 1);
    insertParticipant("agent_builder", "teammate", "active", 2);
    insertParticipant("agent_reviewer", "teammate", "active", 3);
    insertPresence("agent_builder", "offline");
    insertPresence("agent_reviewer", "active");
    const selector = {
      startTurn: vi.fn(async (input: { readonly userMessageId: string }) => ({
        stopReason: "no_candidates" as const,
        userMessageId: input.userMessageId
      }))
    };

    const result = await sendMessage({ roomId: "room_assisted", text: "Who is available?" }, selector);

    expect(result.ok).toBe(true);
    await waitForCondition(() => selector.startTurn.mock.calls.length > 0);
    expect(selector.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      participants: expect.arrayContaining([
        expect.objectContaining({ agentId: "agent_builder", presence: "offline" }),
        expect.objectContaining({ agentId: "agent_reviewer", presence: "active" })
      ])
    }));
  });

  test("assisted selector participants include role capabilities and effective skill descriptions", async () => {
    currentDatabase().sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES ('role_pm', 'ws_1', 'Project Manager', NULL, 'Coordinates the conversation.', 'PM prompt', ?, NULL, NULL, 0, NULL, NULL, 1, 1)").run(JSON.stringify(["chat", "task.delegate"]));
    currentDatabase().sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES ('role_builder', 'ws_1', 'Builder', NULL, 'Builds implementation plans.', 'Builder prompt', ?, NULL, NULL, 0, NULL, NULL, 1, 1)").run(JSON.stringify(["chat", "code.edit", "file.write"]));
    currentDatabase().sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES ('runtime_native', 'ws_1', 'native', 'Native', NULL, NULL, NULL, NULL, NULL, NULL, '[]', NULL, NULL, '{}', 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_pm', 'ws_1', 'role_pm', 'runtime_native', NULL, NULL, 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_builder', 'ws_1', 'role_builder', 'runtime_native', NULL, NULL, 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_assisted', 'ws_1', 'Assisted Room', 'assisted', 'conversation', 'binding_pm', NULL, 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_assisted', 'binding_pm', 'agent', 'primary', 'native', NULL, 'binding_pm', 'active', 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_assisted', 'binding_builder', 'agent', 'teammate', 'native', NULL, 'binding_builder', 'active', 2)").run();
    currentDatabase().sqlite.prepare("INSERT INTO skills (id, workspace_id, name, description, content, origin, source_url, created_at, updated_at) VALUES ('skill_arch', 'ws_1', 'architecture-review', 'Review architecture tradeoffs.', '---\\nname: architecture-review\\n---\\n', 'workspace', NULL, 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO skills (id, workspace_id, name, description, content, origin, source_url, created_at, updated_at) VALUES ('skill_impl', 'ws_1', 'implementation-kit', 'Prepare concrete implementation steps.', '---\\nname: implementation-kit\\n---\\n', 'workspace', NULL, 1, 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO room_skills (room_id, skill_id, enabled) VALUES ('room_assisted', 'skill_arch', 1)").run();
    currentDatabase().sqlite.prepare("INSERT INTO agent_skills (room_participant_id, skill_id, mode) VALUES ('room_assisted:binding_builder', 'skill_impl', 'add')").run();
    const selector = {
      startTurn: vi.fn(async (input: { readonly userMessageId: string }) => ({
        stopReason: "no_candidates" as const,
        userMessageId: input.userMessageId
      }))
    };

    const result = await sendMessage({ roomId: "room_assisted", text: "Who should speak next?" }, selector);

    expect(result.ok).toBe(true);
    await waitForCondition(() => selector.startTurn.mock.calls.length > 0);
    const call = selector.startTurn.mock.calls[0]?.[0] as unknown as { readonly participants: readonly { readonly agentId: string; readonly description?: string }[] };
    const builder = call.participants.find((participant) => participant.agentId === "binding_builder");
    expect(builder?.description).toEqual(expect.stringContaining("Builds implementation plans."));
    expect(builder?.description).toEqual(expect.stringContaining("Capabilities: chat, code.edit, file.write"));
    expect(builder?.description).toEqual(expect.stringContaining("Skills: architecture-review - Review architecture tradeoffs.; implementation-kit - Prepare concrete implementation steps."));
  });
});

async function sendMessage(command: { readonly roomId: string; readonly text: string }, assistedSelector: unknown): Promise<CommandResult> {
  const handlers = createDaemonCommandHandlers({
    database: currentDatabase(),
    eventBus: currentBus(),
    getCommandBus: () => currentCommandBus(),
    pendingTurns: { cancel: vi.fn(() => ({ ok: true, data: {}, emittedEvents: [] })) } as unknown as PendingTurnService,
    assistedSelector,
    now: () => 1_000
  } as never);
  const handler = handlers.SendMessage;
  if (handler === undefined) throw new Error("SendMessage handler missing");
  return Promise.resolve(handler({ type: "SendMessage", ...command }, { actor: { type: "user", id: "u_1" }, traceId: "trace_1", idempotencyKey: `idem_${command.roomId}`, origin: "mcp_tool" }));
}

function currentCommandBus(): CommandBus {
  return {
    dispatch(command: { readonly type: string; readonly reason?: string; readonly agentId?: string; readonly messageId?: string }) {
      dispatches.push({ type: command.type, reason: command.reason ?? "", agentId: command.agentId ?? "", ...(command.messageId !== undefined ? { messageId: command.messageId } : {}) });
      return { ok: true, data: {}, emittedEvents: [] };
    }
  } as unknown as CommandBus;
}

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
}

function insertAssistedRoom(): void {
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_assisted', 'ws_1', 'Assisted Room', 'assisted', 'conversation', 'agent_pm', NULL, 1, 1)").run();
}

function insertAgent(agentId: string, name: string): void {
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, 'ws_1', ?, 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run(agentId, name);
}

function insertParticipant(agentId: string, role: "primary" | "teammate" | "observer", presence: "active" | "observing", joinedAt: number): void {
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_assisted', ?, 'agent', ?, 'mock', NULL, ?, ?)").run(agentId, role, presence, joinedAt);
}

function insertPresence(agentId: string, state: "active" | "observing" | "offline"): void {
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES ('room_assisted', ?, ?, NULL, NULL, 1)").run(agentId, state);
}

async function waitForDispatches(count: number): Promise<void> {
  await waitForCondition(() => dispatches.length >= count);
}

async function waitForCondition(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!done() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

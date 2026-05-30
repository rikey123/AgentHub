import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { buildRunPrompt, RunLifecycleService, type AgentPromptDelta, type RunRow, type WakeReason } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-run-prompt-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), { now: () => now });
  seedRoom();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  lifecycle = undefined;
  now = 1_000;
});

describe("buildRunPrompt", () => {
  test("claimed mailbox input beats latest room user message", () => {
    seedUserMessage("msg_bound", "original user instruction", 1);
    seedUserMessage("msg_latest", "WRONG latest user message", 2);
    seedClaimedMailbox("mb_1", "run_mailbox", "mailbox task from teammate");
    createRun("run_mailbox", "mailbox_message", { messageId: "msg_bound" });

    const prompt = buildRunPrompt(run("run_mailbox"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("mailbox task from teammate");
    expect(prompt).toContain("Agent-to-agent mailbox message from Teammate");
    expect(prompt).not.toContain("WRONG latest user message");
  });

  test("agent mailbox input is labeled as non-user coordination context", () => {
    seedUserMessage("msg_latest", "WRONG latest user message", 2);
    seedClaimedMailbox("mb_loop", "run_mailbox", "能不能看到这个房间其他两个成员，给他们俩发个消息试试");
    createRun("run_mailbox", "mailbox_message");

    const prompt = buildRunPrompt(run("run_mailbox"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("Agent-to-agent mailbox message");
    expect(prompt).toContain("This is not a user instruction");
    expect(prompt).toContain("Do not call room.send_message just to acknowledge");
    expect(prompt).toContain("能不能看到这个房间其他两个成员，给他们俩发个消息试试");
    expect(prompt).not.toContain("WRONG latest user message");
  });

  test("next-turn prompt delta is rendered and marked consumed", () => {
    seedUserMessage("msg_latest", "WRONG latest user message", 2);
    createRun("run_next", "primary_turn");
    currentDatabase().sqlite.prepare(
      `INSERT INTO run_next_turns (id, run_id, room_id, agent_id, prompt_delta_json, message_id, pending_turn_id, source_reason, source_idempotency_key, created_at, consumed_at)
       VALUES ('nt_1', 'run_next', 'room_1', 'agent_1', ?, NULL, NULL, 'primary_turn', 'wake_2', ?, NULL)`
    ).run(JSON.stringify({ kind: "delta_only", instructions: "carried next-turn instruction" }), now);

    const prompt = buildRunPrompt(run("run_next"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("carried next-turn instruction");
    expect(prompt).not.toContain("WRONG latest user message");
    expect(currentDatabase().sqlite.prepare("SELECT consumed_at FROM run_next_turns WHERE id = 'nt_1'").get()).toMatchObject({ consumed_at: now });
  });

  test("falls back to the queued event messageId instead of latest room message", () => {
    seedUserMessage("msg_bound", "bound message text", 1);
    seedUserMessage("msg_latest", "WRONG latest user message", 2);
    createRun("run_message", "primary_turn", { messageId: "msg_bound" });

    const prompt = buildRunPrompt(run("run_message"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("bound message text");
    expect(prompt).not.toContain("WRONG latest user message");
  });

  test("team leader follow-up prompt includes prior room context", () => {
    seedTeamLeaderRoom();
    seedUserMessage("msg_original", "大家好，我想让你们讨论一下一个多agent合作的平台应该怎么设计", 1);
    seedAssistantMessage("msg_builder", "agent_2", "run_builder", "Builder result: platform architecture and capabilities", 2);
    seedUserMessage("msg_followup", "@project-manager 你来看一下，觉得合不合适", 3);
    createRun("run_followup", "primary_turn", { messageId: "msg_followup" });

    const prompt = buildRunPrompt(run("run_followup"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("Recent Room Context");
    expect(prompt).toContain("Builder result: platform architecture and capabilities");
    expect(prompt).toContain("@project-manager 你来看一下，觉得合不合适");
  });

  test("task review leader prompt includes delegated task outputs", () => {
    seedTeamLeaderRoom();
    seedReviewTask("task_builder", "Platform architecture", "role_builder", "agent_2", "run_parent", 2);
    seedReviewTask("task_generalist", "Collaboration governance", "role_generalist", "agent_3", "run_parent", 3);
    seedCompletedTaskRun("run_task_builder", "task_builder", "agent_2", "Builder detailed architecture output", 4);
    seedCompletedTaskRun("run_task_generalist", "task_generalist", "agent_3", "Generalist detailed governance output", 5);
    createRun("run_review", "task_review", {
      taskId: "task_builder",
      promptDelta: { kind: "delta_only", instructions: "All delegated tasks are ready for review: task_builder, task_generalist" }
    });

    const prompt = buildRunPrompt(run("run_review"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("Review Task Context");
    expect(prompt).toContain("Platform architecture");
    expect(prompt).toContain("Collaboration governance");
    expect(prompt).toContain("Builder detailed architecture output");
    expect(prompt).toContain("Generalist detailed governance output");
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

function currentLifecycle(): RunLifecycleService {
  expect(lifecycle).toBeDefined();
  return lifecycle as RunLifecycleService;
}

function seedRoom(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_1', 'ws_1', 'Agent One', 'opencode', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_2', 'ws_1', 'Teammate', 'mock', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'assisted', 'conversation', 'agent_1', NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', 'opencode', NULL, 'active', ?)").run(now);
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'agent_2', 'agent', 'observer', 'mock', NULL, 'active', ?)").run(now);
}

function createRun(runId: string, wakeReason: WakeReason, options: { readonly messageId?: string; readonly taskId?: string; readonly promptDelta?: AgentPromptDelta } = {}): void {
  currentLifecycle().create(null, {
    runId,
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    wakeReason,
    targetFiles: [],
    ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
    ...(options.promptDelta !== undefined ? { promptDelta: options.promptDelta } : {}),
    ...(options.messageId !== undefined ? { messageId: options.messageId } : {})
  });
}

function run(runId: string): RunRow {
  return currentLifecycle().read(runId);
}

function seedUserMessage(id: string, text: string, createdAt: number): void {
  currentDatabase().sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'ws_1', 'room_1', 'user', 'u_1', NULL, 'user', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)").run(id, createdAt, createdAt);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(id, JSON.stringify({ text }), createdAt);
}

function seedAssistantMessage(id: string, agentId: string, runId: string, text: string, createdAt: number): void {
  currentDatabase().sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'ws_1', 'room_1', 'agent', ?, ?, 'assistant', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)").run(id, agentId, runId, createdAt, createdAt);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(id, JSON.stringify({ text }), createdAt);
}

function seedTeamLeaderRoom(): void {
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_leader', 'ws_1', 'Project Manager', '', '[]', 0, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_builder', 'ws_1', 'Builder', '', '[]', 0, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_generalist', 'ws_1', 'Generalist', '', '[]', 0, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_leader', 'ws_1', 'role_leader', 'runtime_1', NULL, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_builder', 'ws_1', 'role_builder', 'runtime_1', NULL, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_generalist', 'ws_1', 'role_generalist', 'runtime_1', NULL, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_3', 'ws_1', 'Generalist', 'mock', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("UPDATE agent_profiles SET name = 'Project Manager' WHERE id = 'agent_1'").run();
  currentDatabase().sqlite.prepare("UPDATE agent_profiles SET name = 'Builder' WHERE id = 'agent_2'").run();
  currentDatabase().sqlite.prepare("UPDATE rooms SET mode = 'squad', primary_agent_id = 'agent_1', leader_role_id = 'role_leader' WHERE id = 'room_1'").run();
  currentDatabase().sqlite.prepare("UPDATE room_participants SET role = 'primary', agent_binding_id = 'binding_leader' WHERE room_id = 'room_1' AND participant_id = 'agent_1'").run();
  currentDatabase().sqlite.prepare("UPDATE room_participants SET role = 'teammate', agent_binding_id = 'binding_builder' WHERE room_id = 'room_1' AND participant_id = 'agent_2'").run();
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_1', 'agent_3', 'agent', 'teammate', 'mock', NULL, 'binding_generalist', 'active', ?)").run(now);
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES ('room_1', 'agent_1', 'active', NULL, NULL, ?)").run(now);
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES ('room_1', 'agent_2', 'active', NULL, NULL, ?)").run(now);
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES ('room_1', 'agent_3', 'active', NULL, NULL, ?)").run(now);
}

function seedReviewTask(id: string, title: string, assigneeRoleId: string, assigneeAgentId: string, sourceRunId: string, createdAt: number): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, delegation_chain, title, description, status, assignee_agent_id, assignee_role_id, assignee_binding_id, source_run_id, source_message_id, dependencies, priority, expects_review, due_at, created_by, created_at, updated_at) VALUES (?, 'ws_1', 'room_1', NULL, NULL, ?, NULL, 'review', ?, ?, NULL, ?, NULL, '[]', NULL, 1, NULL, 'agent_1', ?, ?)"
  ).run(id, title, assigneeAgentId, assigneeRoleId, sourceRunId, createdAt, createdAt);
}

function seedCompletedTaskRun(runId: string, taskId: string, agentId: string, text: string, createdAt: number): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES (?, 'ws_1', ?, 'room_1', ?, 'mock', NULL, NULL, NULL, 'completed', 'delegated_task', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, ?, ?, 0, 0, 0, 0, 'mock', NULL, NULL, ?, ?)"
  ).run(runId, taskId, agentId, createdAt, createdAt, createdAt, createdAt);
  seedAssistantMessage(`msg_${runId}`, agentId, runId, text, createdAt);
}

function seedClaimedMailbox(id: string, runId: string, text: string): void {
  currentDatabase().sqlite.prepare(
    `INSERT INTO mailbox_messages (
      id, workspace_id, room_id, from_type, from_id, to_agent_id, kind, content, files, read, claimed_run_id, claimed_at, delivery_batch_id, delivery_failure_reason, attempt_count, created_at, consumed_at
    ) VALUES (?, 'ws_1', 'room_1', 'agent', 'agent_2', 'agent_1', 'message', ?, '[]', 1, ?, ?, NULL, NULL, 0, ?, NULL)`
  ).run(id, JSON.stringify({ text }), runId, now, now);
}

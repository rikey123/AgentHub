import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  test("injects context refs from the real queued message into the run prompt", () => {
    expect(tempDir).toBeDefined();
    currentDatabase().sqlite.prepare("UPDATE workspaces SET root_path = ? WHERE id = 'ws_1'").run(tempDir as string);
    mkdirSync(join(tempDir as string, "src"), { recursive: true });
    writeFileSync(join(tempDir as string, "src", "app.ts"), ["workspace one", "workspace two"].join("\n"));
    seedTextArtifact("artifact_prompt", "doc one\ndoc two\ndoc three", "doc.md");
    seedUserMessage("msg_context_refs", "Use @artifact:artifact_prompt#L2-L2 and @workspace:src/app.ts#L1-L1", 1);
    createRun("run_context_refs", "primary_turn", { messageId: "msg_context_refs" });

    const prompt = buildRunPrompt(run("run_context_refs"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("## Context References");
    expect(prompt).toContain('<context-ref type="artifact" id="artifact_prompt" lines="2-2"');
    expect(prompt).toContain("doc two");
    expect(prompt).toContain('<context-ref type="workspace" path="src/app.ts" lines="1-1"');
    expect(prompt).toContain("workspace one");
  });

  test("injects room pinned messages and compact artifact refs for assisted runs", () => {
    seedPinnedUserMessage("msg_pinned_text", "API base path is /api/v2", 1);
    seedPinnedArtifactMessage("msg_pinned_artifact", "artifact_pinned", 2);
    seedUserMessage("msg_followup_pin", "What base path should I use?", 3);
    createRun("run_pinned_context", "primary_turn", { messageId: "msg_followup_pin" });

    const prompt = buildRunPrompt(run("run_pinned_context"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("## Pinned Room Context");
    expect(prompt).toContain("API base path is /api/v2");
    expect(prompt).toContain("@artifact:artifact_pinned");
    expect(prompt.indexOf("## Pinned Room Context")).toBeLessThan(prompt.indexOf("## Assisted Group Chat"));
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

  test("assisted first-wake prompt frames the run as selector group chat", () => {
    seedUserMessage("msg_assisted", "What should we discuss?", 1);
    createRun("run_assisted", "primary_turn", { messageId: "msg_assisted" });

    const prompt = buildRunPrompt(run("run_assisted"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("Assisted Group Chat");
    expect(prompt).toContain("selector chooses the next speaker");
    expect(prompt).toContain("Speak to the room");
    expect(prompt).toContain("Roleplay as your room role");
    expect(prompt).toContain("sound like a real person in a group chat");
    expect(prompt).toContain("Do not sound like a generic assistant writing a report");
    expect(prompt).toContain("Public Turn Style");
    expect(prompt).toContain("When another agent spoke immediately before you");
    expect(prompt).toContain("reference the concrete point you are responding to");
    expect(prompt).toContain("agree and extend");
    expect(prompt).toContain("challenge with a reason");
    expect(prompt).toContain("clarify a missing detail");
    expect(prompt).toContain("synthesize");
    expect(prompt).toContain("Do not restate the previous speaker's whole answer");
    expect(prompt).toContain("If the discussion is repeating itself or already feels complete");
    expect(prompt).toContain("Avoid mechanical openings");
    expect(prompt).toContain("Do not use a fixed opener every turn");
    expect(prompt).toContain("If the discussion is repeating itself");
    expect(prompt).toContain("room.send_file_message");
    expect(prompt).toContain("Documents are optional");
    expect(prompt).toContain("Do not create a file just because your message has a few bullets");
    expect(prompt).toContain("Only create a file for a substantial deliverable");
  });

  test("assisted first-wake prompt reserves room.send_message for private mailbox coordination", () => {
    seedUserMessage("msg_assisted", "@teammate what do you think?", 1);
    createRun("run_assisted", "user_mention", { messageId: "msg_assisted" });

    const prompt = buildRunPrompt(run("run_assisted"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("When the user directly @mentions you");
    expect(prompt).toContain("answer in your normal model text");
    expect(prompt).toContain("Do not call `room.send_message` to answer the user");
    expect(prompt).toContain("Use `room.send_message` only for private agent-to-agent mailbox coordination");
    expect(prompt).not.toContain("Example: `room.send_message");
  });

  test("assisted selected speaker prompt includes shared group transcript with prior agent output", () => {
    seedUserMessage("msg_assisted", "Design a multi-agent platform", 1);
    seedAssistantMessage("msg_builder", "agent_2", "run_builder", "Builder: use an event bus plus a task board.", 2);
    createRun("run_assisted_followup", "primary_turn", { messageId: "msg_assisted" });

    const prompt = buildRunPrompt(run("run_assisted_followup"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("Assisted Shared Conversation");
    expect(prompt).toContain("AutoGen-style shared message thread");
    expect(prompt).toContain("User: Design a multi-agent platform");
    expect(prompt).toContain("Teammate: Builder: use an event bus plus a task board.");
    expect(prompt).toContain("respond naturally to the shared thread");
    expect(prompt).toContain("do not mechanically prefix your message");
    expect(prompt).toContain("If the thread is repeating itself");
    expect(prompt).toContain("Do not restart the discussion from the original user prompt");
  });

  test("assisted opening speaker prompt does not ask the first agent to continue a prior teammate", () => {
    seedUserMessage("msg_assisted", "Design a multi-agent platform", 1);
    createRun("run_assisted_opening", "primary_turn", { messageId: "msg_assisted" });

    const prompt = buildRunPrompt(run("run_assisted_opening"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("You are the first agent speaker for this user message");
    expect(prompt).toContain("open the discussion naturally");
    expect(prompt).toContain("Do not say you are adding to, continuing, or building on a teammate");
    expect(prompt).not.toContain("respond to one concrete prior point");
  });

  test("assisted prompt uses role binding persona when agent profile is only a runtime identity", () => {
    seedRoleBoundAssistedRoom();
    seedUserMessage("msg_assisted", "Brainstorm a launch plan", 1);
    createRun("run_role_bound", "primary_turn", { messageId: "msg_assisted" });

    const prompt = buildRunPrompt(run("run_role_bound"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("头脑风暴引导助手");
    expect(prompt).toContain("帮助用户快速产生更多更好的想法");
    expect(prompt).toContain("Project Manager");
    expect(prompt).not.toContain("Runtime Shell");
  });

  test("assisted shared transcript includes markdown attachment excerpts from prior file-backed replies", () => {
    seedUserMessage("msg_assisted", "Discuss this design", 1);
    seedAssistantMessage("msg_builder", "agent_2", "run_builder", "I put the detailed architecture in a file.", 2);
    seedFileAttachment("msg_builder", "artifact_builder", "agent-replies/builder.md", "# Architecture\n\nDetailed architecture section from the file.", 2);
    createRun("run_assisted_followup", "primary_turn", { messageId: "msg_assisted" });

    const prompt = buildRunPrompt(run("run_assisted_followup"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("[File: agent-replies/builder.md]");
    expect(prompt).toContain("Detailed architecture section from the file.");
  });

  test("assisted shared transcript uses role binding names for prior speakers", () => {
    seedRoleBoundAssistedRoom();
    seedUserMessage("msg_assisted", "Design a multi-agent platform", 1);
    seedAssistantMessage("msg_pm", "agent_2", "run_pm", "Project Manager: start from clear coordination boundaries.", 2);
    createRun("run_role_bound_followup", "primary_turn", { messageId: "msg_assisted" });

    const prompt = buildRunPrompt(run("run_role_bound_followup"), currentDatabase(), { now: () => now });

    expect(prompt).toContain("- Project Manager: Project Manager: start from clear coordination boundaries.");
    expect(prompt).not.toContain("Runtime Teammate: Project Manager: start from clear coordination boundaries.");
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

function seedFileAttachment(messageId: string, artifactId: string, path: string, content: string, createdAt: number): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, title, status, created_by, metadata, created_at, updated_at, applied_at) VALUES (?, 'ws_1', 'room_1', NULL, 'run_builder', ?, 'file', ?, 'draft', 'agent_2', '{}', ?, ?, NULL)"
  ).run(artifactId, messageId, path, createdAt, createdAt);
  currentDatabase().sqlite.prepare(
    "INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at) VALUES (?, ?, '', ?, NULL, 1, 0, 'added', NULL, NULL, NULL, NULL, ?)"
  ).run(artifactId, path, content, createdAt);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 2, 'attachment', ?, ?)").run(messageId, JSON.stringify({
    type: "attachment",
    fileId: artifactId,
    artifactId,
    name: path.split("/").at(-1) ?? path,
    mimeType: "text/markdown",
    sizeBytes: Buffer.byteLength(content, "utf8"),
    path,
    previewKind: "markdown"
  }), createdAt);
}

function seedTextArtifact(artifactId: string, content: string, path: string): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO artifacts (id, workspace_id, room_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES (?, 'ws_1', 'room_1', 'file', 'document', ?, 'draft', 'agent_1', ?, 1, 1)"
  ).run(artifactId, path, JSON.stringify({ filename: path }));
  currentDatabase().sqlite.prepare(
    "INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at, binary, mime_type, size_bytes) VALUES (?, ?, '', ?, NULL, 0, 0, 'modified', NULL, NULL, NULL, NULL, 1, 0, 'text/markdown', ?)"
  ).run(artifactId, path, content, Buffer.byteLength(content, "utf8"));
}

function seedPinnedUserMessage(messageId: string, text: string, createdAt: number): void {
  seedUserMessage(messageId, text, createdAt);
  currentDatabase().sqlite.prepare("UPDATE messages SET pinned_at = ? WHERE id = ?").run(createdAt + 100, messageId);
}

function seedPinnedArtifactMessage(messageId: string, artifactId: string, createdAt: number): void {
  currentDatabase().sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at, pinned_at) VALUES (?, 'ws_1', 'room_1', 'agent', 'agent_2', NULL, 'assistant', 'completed', NULL, 'immediate', NULL, ?, ?, NULL, ?)").run(messageId, createdAt, createdAt, createdAt + 100);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'artifact', ?, ?)").run(messageId, JSON.stringify({
    type: "artifact",
    artifactId,
    kind: "document",
    title: "Pinned artifact",
    filename: "pinned.md",
    version: 1
  }), createdAt);
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

function seedRoleBoundAssistedRoom(): void {
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_brainstorm', 'ws_1', '头脑风暴引导助手', '你是一名头脑风暴引导助手，帮助用户快速产生更多更好的想法。', '[\"chat\"]', 0, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_pm', 'ws_1', 'Project Manager', 'You coordinate the room.', '[\"chat\"]', 0, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_brainstorm', 'ws_1', 'role_brainstorm', 'runtime_1', NULL, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_pm', 'ws_1', 'role_pm', 'runtime_1', NULL, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("UPDATE agent_profiles SET name = 'Runtime Shell', role_prompt = '' WHERE id = 'agent_1'").run();
  currentDatabase().sqlite.prepare("UPDATE agent_profiles SET name = 'Runtime Teammate', role_prompt = '' WHERE id = 'agent_2'").run();
  currentDatabase().sqlite.prepare("UPDATE room_participants SET role = 'primary', agent_binding_id = 'binding_brainstorm' WHERE room_id = 'room_1' AND participant_id = 'agent_1'").run();
  currentDatabase().sqlite.prepare("UPDATE room_participants SET role = 'teammate', agent_binding_id = 'binding_pm' WHERE room_id = 'room_1' AND participant_id = 'agent_2'").run();
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

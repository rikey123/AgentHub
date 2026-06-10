import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { CommandBus, EventBus, type CommandHandler } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { ActiveWakesRegistry, AdapterBridge, MailboxService, RunLifecycleService, createWakeAgentHandler } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let activeWakes: ActiveWakesRegistry | undefined;
let mailbox: MailboxService | undefined;
let commandBus: CommandBus | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-adapter-bridge-auto-continue-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  activeWakes = new ActiveWakesRegistry(() => now);
  mailbox = new MailboxService(currentDatabase(), () => now);
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), {
    now: () => now,
    sideEffects: {
      onTerminal: (runId) => currentActiveWakes().releaseRun(runId)
    }
  });
  commandBus = new CommandBus({
    database: currentDatabase(),
    handlers: {
      WakeAgent: createWakeAgentHandler({ database: currentDatabase(), activeWakes: currentActiveWakes(), mailbox: currentMailbox(), lifecycle: currentLifecycle() }) as CommandHandler
    }
  });
  seedWorkspace();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  lifecycle = undefined;
  activeWakes = undefined;
  mailbox = undefined;
  commandBus = undefined;
  now = 1_000;
});

describe("AdapterBridge auto continuation", () => {
  test("queues a follow-up run when the final assistant text only promises to inspect an attachment", () => {
    seedUserMessage("msg_pdf", "Read this PDF and tell me what the beginner class learns.");
    createRunningRun("run_auto", { messageId: "msg_pdf" });
    seedAssistantMessage(
      "msg_run_auto",
      "run_auto",
      "\u6211\u5df2\u7ecf\u627e\u5230 PDF \u6587\u4ef6\u3002\u63a5\u4e0b\u6765\u6211\u4f1a\u5c1d\u8bd5\u76f4\u63a5\u62bd\u53d6 PDF \u6587\u672c\u3002"
    );

    bridgeFor("run_auto").handle({ type: "session.ended", sessionId: "session_run_auto", reason: "completed", cost: zeroCost() });

    const child = childRunOf("run_auto");
    expect(child).toMatchObject({ parent_run_id: "run_auto", status: "queued", wake_reason: "primary_turn" });
    const payload = eventPayload("agent.run.queued", child.id);
    expect(payload.promptDelta).toMatchObject({ kind: "delta_only", instructions: expect.stringContaining("Continue the previous run") });
    expect(payload.messageId).toBe("msg_pdf");
  });

  test("does not continue after a concrete final answer", () => {
    createRunningRun("run_final");
    seedAssistantMessage("msg_run_final", "run_final", "\u521d\u7ea7\u73ed\u5b66\u4e60\u5185\u5bb9\u5305\u62ec\u8bed\u6587\u3001\u6570\u5b66\u548c\u82f1\u8bed\u3002");

    bridgeFor("run_final").handle({ type: "session.ended", sessionId: "session_run_final", reason: "completed", cost: zeroCost() });

    expect(childRunCount("run_final")).toBe(0);
  });

  test("caps repeated auto continuations", () => {
    createCompletedRun("run_root");
    createCompletedRun("run_auto_1", { parentRunId: "run_root" });
    createCompletedRun("run_auto_2", { parentRunId: "run_auto_1" });
    createCompletedRun("run_auto_3", { parentRunId: "run_auto_2" });
    createRunningRun("run_auto_4", { parentRunId: "run_auto_3" });
    seedAssistantMessage(
      "msg_run_auto_4",
      "run_auto_4",
      "\u63a5\u4e0b\u6765\u6211\u4f1a\u5c1d\u8bd5\u8bfb\u53d6\u8fd9\u4e2a\u6587\u4ef6\u5e76\u7ee7\u7eed\u5206\u6790\u3002"
    );

    bridgeFor("run_auto_4").handle({ type: "session.ended", sessionId: "session_run_auto_4", reason: "completed", cost: zeroCost() });

    expect(childRunCount("run_auto_4")).toBe(0);
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

function currentActiveWakes(): ActiveWakesRegistry {
  expect(activeWakes).toBeDefined();
  return activeWakes as ActiveWakesRegistry;
}

function currentMailbox(): MailboxService {
  expect(mailbox).toBeDefined();
  return mailbox as MailboxService;
}

function currentCommandBus(): CommandBus {
  expect(commandBus).toBeDefined();
  return commandBus as CommandBus;
}

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_1', 'ws_1', 'Agent', 'mock', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'solo', 'conversation', 'agent_1', NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', 'mock', NULL, 'active', ?)").run(now);
}

function seedUserMessage(messageId: string, text: string): void {
  currentDatabase().sqlite
    .prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'ws_1', 'room_1', 'user', 'local', NULL, 'user', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)")
    .run(messageId, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(messageId, JSON.stringify({ text }), now);
}

function seedAssistantMessage(messageId: string, runId: string, text: string): void {
  currentDatabase().sqlite
    .prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'ws_1', 'room_1', 'agent', 'agent_1', ?, 'assistant', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)")
    .run(messageId, runId, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(messageId, JSON.stringify({ text }), now);
}

function createRunningRun(runId: string, options: { readonly parentRunId?: string; readonly messageId?: string } = {}): void {
  currentLifecycle().create(null, {
    runId,
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    wakeReason: "primary_turn",
    targetFiles: [],
    ...(options.parentRunId !== undefined ? { parentRunId: options.parentRunId } : {}),
    ...(options.messageId !== undefined ? { messageId: options.messageId } : {})
  });
  currentLifecycle().markClaimed(null, runId);
  currentLifecycle().markStarting(null, runId, 123);
  currentLifecycle().markRunning(null, runId, `session_${runId}`);
}

function createCompletedRun(runId: string, options: { readonly parentRunId?: string } = {}): void {
  createRunningRun(runId, options);
  currentLifecycle().complete(null, runId, zeroCost());
}

function bridgeFor(runId: string): AdapterBridge {
  return new AdapterBridge({
    runId,
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    lifecycle: currentLifecycle(),
    eventBus: currentBus(),
    database: currentDatabase(),
    getCommandBus: () => currentCommandBus(),
    now: () => now
  });
}

function childRunOf(parentRunId: string): { readonly id: string; readonly parent_run_id: string; readonly status: string; readonly wake_reason: string } {
  const row = currentDatabase().sqlite.prepare("SELECT id, parent_run_id, status, wake_reason FROM runs WHERE parent_run_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").get(parentRunId) as { readonly id: string; readonly parent_run_id: string; readonly status: string; readonly wake_reason: string } | undefined;
  expect(row).toBeDefined();
  return row as { readonly id: string; readonly parent_run_id: string; readonly status: string; readonly wake_reason: string };
}

function childRunCount(parentRunId: string): number {
  return (currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM runs WHERE parent_run_id = ?").get(parentRunId) as { readonly count: number }).count;
}

function eventPayload(type: string, runId: string): Record<string, unknown> {
  const row = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = ? AND run_id = ? ORDER BY seq DESC LIMIT 1").get(type, runId) as { readonly payload: string } | undefined;
  expect(row).toBeDefined();
  return JSON.parse((row as { readonly payload: string }).payload) as Record<string, unknown>;
}

function zeroCost() {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId: "mock" };
}

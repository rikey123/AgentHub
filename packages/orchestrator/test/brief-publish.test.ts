import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { RunLifecycleService } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-run-lifecycle-brief-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), { now: () => now });
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

describe("RunLifecycleService brief publishing", () => {
  test("complete publishes the terminal run event and brief event atomically in sequence", () => {
    createRunningRun("run_complete");
    seedAssistantMessage("msg_complete", "run_complete");
    now = 2_000;

    currentLifecycle().complete(null, "run_complete", zeroCost(), "Brief text");

    expect(eventTypes("run_complete")).toEqual(["agent.run.queued", "agent.run.started", "agent.run.completed", "message.brief.published"]);
    expect(eventPayload("message.brief.published", "run_complete")).toEqual({ text: "Brief text" });
    expect(assistantBriefPublishedAt("msg_complete")).toBe(2_000);
    expect(outboxTypes()).toEqual(["agent.run.queued", "agent.run.started", "agent.run.completed", "message.brief.published"]);
  });

  test("rollback removes both terminal events and leaves the run and assistant message unchanged", () => {
    createRunningRun("run_rollback");
    seedAssistantMessage("msg_rollback", "run_rollback");
    currentDatabase().sqlite.exec(
      `CREATE TRIGGER fail_after_completed_event
       AFTER INSERT ON events
       WHEN NEW.type = 'agent.run.completed'
       BEGIN
         SELECT RAISE(FAIL, 'forced event failure');
       END`
    );

    expect(() => currentLifecycle().complete(null, "run_rollback", zeroCost(), "Brief that rolls back")).toThrow("forced event failure");

    expect(statusOf("run_rollback")).toBe("running");
    expect(eventTypes("run_rollback")).toEqual(["agent.run.queued", "agent.run.started"]);
    expect(outboxTypes()).toEqual(["agent.run.queued", "agent.run.started"]);
    expect(assistantBriefPublishedAt("msg_rollback")).toBeNull();
  });

  test("fail and cancelFinalized accept brief text and publish brief events", () => {
    createRun("run_fail");
    currentLifecycle().fail(null, "run_fail", "fatal error", "fatal", undefined, "Failure brief");

    createRunningRun("run_cancel");
    currentLifecycle().markCancelling(null, "run_cancel");
    currentLifecycle().cancelFinalized(null, "run_cancel", "Cancel brief");

    expect(eventPayload("message.brief.published", "run_fail")).toEqual({ text: "Failure brief" });
    expect(eventPayload("message.brief.published", "run_cancel")).toEqual({ text: "Cancel brief" });
    expect(eventTypes("run_fail")).toEqual(["agent.run.queued", "agent.run.failed", "message.brief.published"]);
    expect(eventTypes("run_cancel")).toEqual(["agent.run.queued", "agent.run.started", "agent.run.cancelled", "message.brief.published"]);
  });

  test("missing completed assistant message does not prevent brief publication", () => {
    createRunningRun("run_no_message");

    expect(() => currentLifecycle().complete(null, "run_no_message", zeroCost())).not.toThrow();

    expect(eventPayload("message.brief.published", "run_no_message")).toEqual({ text: "" });
    expect(eventTypes("run_no_message")).toEqual(["agent.run.queued", "agent.run.started", "agent.run.completed", "message.brief.published"]);
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

function createRun(runId: string): void {
  currentLifecycle().create(null, {
    runId,
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_1",
    wakeReason: "primary_turn",
    targetFiles: [],
    messageId: `msg_${runId}`
  });
}

function createRunningRun(runId: string): void {
  createRun(runId);
  currentLifecycle().markClaimed(null, runId);
  currentLifecycle().markStarting(null, runId, 123);
  currentLifecycle().markRunning(null, runId, `session_${runId}`);
}

function seedAssistantMessage(messageId: string, runId: string): void {
  currentDatabase().sqlite
    .prepare(
      `INSERT INTO messages (
        id, workspace_id, room_id, sender_type, sender_id, run_id, role, status,
        quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at
      ) VALUES (?, 'ws_1', 'room_1', 'agent', 'agent_1', ?, 'assistant', 'completed', NULL, 'none', NULL, ?, ?, NULL)`
    )
    .run(messageId, runId, now, now);
}

function zeroCost() {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId: "mock" };
}

function statusOf(runId: string): string {
  return currentLifecycle().read(runId).status;
}

function eventTypes(runId: string): string[] {
  return currentDatabase().sqlite
    .prepare("SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC")
    .all(runId)
    .map((row) => (row as { readonly type: string }).type);
}

function outboxTypes(): string[] {
  return currentDatabase().sqlite
    .prepare("SELECT e.type FROM outbox o JOIN events e ON e.id = o.event_id ORDER BY o.seq ASC")
    .all()
    .map((row) => (row as { readonly type: string }).type);
}

function eventPayload(type: string, runId: string): unknown {
  const row = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = ? AND run_id = ? ORDER BY seq DESC LIMIT 1").get(type, runId) as { readonly payload: string };
  return JSON.parse(row.payload) as unknown;
}

function assistantBriefPublishedAt(messageId: string): number | null {
  return (currentDatabase().sqlite.prepare("SELECT brief_published_at FROM messages WHERE id = ?").get(messageId) as { readonly brief_published_at: number | null }).brief_published_at;
}

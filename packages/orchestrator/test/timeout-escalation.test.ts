/**
 * Tests for two-level timeout escalation (spec §timeout-escalation, tasks.md 2.5).
 *
 * Level-1 (existing watchdog): 90s silence → mailbox message + WakeAgent(reason: "agent_stalled")
 * Level-2 (new): 5 min after Level-1, if no leader run reached running → room.stalled + rooms.stalled_at
 *
 * These tests use fake timers to avoid real 90s / 5min waits.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { AdapterBridge, RunLifecycleService } from "../src/index.ts";

let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let publishSpy: ReturnType<typeof vi.spyOn> | undefined;
let dispatchSpy: ReturnType<typeof vi.fn> | undefined;
let bridge: AdapterBridge | undefined;
let lifecycle: RunLifecycleService | undefined;
let nowMs = 1_000;

beforeEach(() => {
  vi.useFakeTimers();
  database = createDatabase({ path: ":memory:", applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), { now: () => nowMs });
  publishSpy = vi.spyOn(currentBus(), "publish");
  // dispatchSpy returns a leader runId so Level-2 can track it
  dispatchSpy = vi.fn(() => ({ ok: true, data: { runId: "leader_run_1" }, emittedEvents: [] }));

  seedWorkspaceRoom();

  // Create the teammate run so lifecycle methods work
  currentLifecycle().create(null, {
    runId: "run_1",
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_teammate",
    wakeReason: "primary_turn",
    targetFiles: []
  });
  currentLifecycle().markClaimed(null, "run_1");
  currentLifecycle().markStarting(null, "run_1", 1234);

  bridge = new AdapterBridge({
    runId: "run_1",
    workspaceId: "ws_1",
    roomId: "room_1",
    agentId: "agent_teammate",
    lifecycle: currentLifecycle(),
    eventBus: currentBus(),
    now: () => nowMs,
    getCommandBus: () => ({ dispatch: (...args: [unknown, unknown]) => (dispatchSpy as (...a: unknown[]) => unknown)(...args) } as never),
    database: currentDatabase()
  });

  publishSpy.mockClear();
  dispatchSpy.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  currentBus().close();
  currentDatabase().sqlite.close();
  database = undefined;
  eventBus = undefined;
  publishSpy = undefined;
  dispatchSpy = undefined;
  bridge = undefined;
  lifecycle = undefined;
  nowMs = 1_000;
  vi.restoreAllMocks();
});

describe("AdapterBridge Level-1 watchdog", () => {
  test("90s silence triggers mailbox message and WakeAgent(agent_stalled) for leader", async () => {
    // Start a session so the watchdog is armed
    currentBridge().handle({ type: "session.opened", sessionId: "sess_1" });
    publishSpy!.mockClear();
    dispatchSpy!.mockClear();

    // Advance 90s — Level-1 should fire
    await vi.advanceTimersByTimeAsync(90_000);

    // Mailbox message should have been inserted
    const mailboxRow = currentDatabase().sqlite
      .prepare("SELECT id FROM mailbox_messages WHERE room_id = ? AND to_agent_id = ?")
      .get("room_1", "agent_leader") as { id: string } | undefined;
    expect(mailboxRow).toBeDefined();

    // WakeAgent dispatched with reason "agent_stalled"
    const wakeCall = (dispatchSpy!.mock.calls as Array<[{ type: string; reason?: string }]>)
      .find(([cmd]) => cmd.type === "WakeAgent");
    expect(wakeCall).toBeDefined();
    expect(wakeCall![0]).toMatchObject({ type: "WakeAgent", reason: "agent_stalled" });
  });

  test("activity before 90s resets watchdog — no Level-1 fires at 89s", async () => {
    currentBridge().handle({ type: "session.opened", sessionId: "sess_1" });
    dispatchSpy!.mockClear();

    // Activity at 80s resets the timer
    await vi.advanceTimersByTimeAsync(80_000);
    currentBridge().handle({ type: "message.part.delta", messageId: "msg_1", delta: "hello" });

    // Advance another 89s (total 169s, but only 89s since last activity)
    await vi.advanceTimersByTimeAsync(89_000);

    const wakeCall = (dispatchSpy!.mock.calls as Array<[{ type: string; reason?: string }]>)
      .find(([cmd]) => cmd.type === "WakeAgent" && cmd.reason === "agent_stalled");
    expect(wakeCall).toBeUndefined();
  });

  test("terminal session clears watchdog and does not notify after completion", async () => {
    currentBridge().handle({ type: "session.opened", sessionId: "sess_1" });
    dispatchSpy!.mockClear();
    publishSpy!.mockClear();

    await vi.advanceTimersByTimeAsync(10_000);
    currentBridge().handle({ type: "session.ended", sessionId: "sess_1", reason: "completed" });
    await vi.advanceTimersByTimeAsync(90_000);

    const mailboxRow = currentDatabase().sqlite
      .prepare("SELECT id FROM mailbox_messages WHERE room_id = ? AND to_agent_id = ?")
      .get("room_1", "agent_leader") as { id: string } | undefined;
    expect(mailboxRow).toBeUndefined();

    const wakeCall = (dispatchSpy!.mock.calls as Array<[{ type: string; reason?: string }]>)
      .find(([cmd]) => cmd.type === "WakeAgent" && cmd.reason === "agent_stalled");
    expect(wakeCall).toBeUndefined();

    const stalledEvents = (publishSpy!.mock.calls as Array<[{ type: string }]>)
      .filter(([e]) => e.type === "room.stalled");
    expect(stalledEvents).toHaveLength(0);
  });
});

describe("AdapterBridge Level-2 stall escalation", () => {
  test("leader run never reaches running → room.stalled published after 5 minutes", async () => {
    // Leader run exists but stays in 'queued' (never reaches 'running')
    currentDatabase().sqlite.prepare(
      "INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, status, wake_reason, target_files, mailbox_claim_count, created_at, updated_at) VALUES (?, 'ws_1', NULL, 'room_1', 'agent_leader', 'queued', 'agent_stalled', '[]', 0, ?, ?)"
    ).run("leader_run_1", nowMs, nowMs);

    currentBridge().handle({ type: "session.opened", sessionId: "sess_1" });
    dispatchSpy!.mockClear();
    publishSpy!.mockClear();

    // Level-1 fires at 90s
    await vi.advanceTimersByTimeAsync(90_000);

    // Level-2 fires at 90s + 5min = 390s
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // room.stalled should be published
    const stalledEvents = (publishSpy!.mock.calls as Array<[{ type: string; payload?: { reason?: string } }]>)
      .filter(([e]) => e.type === "room.stalled");
    expect(stalledEvents.length).toBeGreaterThanOrEqual(1);
    expect(stalledEvents[0]![0].payload?.reason).toBe("leader_unavailable");

    // rooms.stalled_at should be set
    const room = currentDatabase().sqlite
      .prepare("SELECT stalled_at FROM rooms WHERE id = ?")
      .get("room_1") as { stalled_at: number | null } | undefined;
    expect(room?.stalled_at).not.toBeNull();
  });

  test("leader run reaches running → Level-2 does NOT fire room.stalled", async () => {
    // Leader run starts queued, then transitions to running before 5 min
    currentDatabase().sqlite.prepare(
      "INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, status, wake_reason, target_files, mailbox_claim_count, created_at, updated_at) VALUES (?, 'ws_1', NULL, 'room_1', 'agent_leader', 'queued', 'agent_stalled', '[]', 0, ?, ?)"
    ).run("leader_run_1", nowMs, nowMs);

    currentBridge().handle({ type: "session.opened", sessionId: "sess_1" });
    publishSpy!.mockClear();

    // Level-1 fires at 90s
    await vi.advanceTimersByTimeAsync(90_000);

    // Leader run reaches 'running' before Level-2 fires
    currentDatabase().sqlite.prepare("UPDATE runs SET status = 'running', updated_at = ? WHERE id = ?").run(nowMs + 91_000, "leader_run_1");

    // Level-2 timer fires at 5 min
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // room.stalled should NOT be published
    const stalledEvents = (publishSpy!.mock.calls as Array<[{ type: string }]>)
      .filter(([e]) => e.type === "room.stalled");
    expect(stalledEvents).toHaveLength(0);

    // rooms.stalled_at should remain null
    const room = currentDatabase().sqlite
      .prepare("SELECT stalled_at FROM rooms WHERE id = ?")
      .get("room_1") as { stalled_at: number | null } | undefined;
    expect(room?.stalled_at).toBeNull();
  });

  test("leader run fails → Level-2 fires with reason leader_failed", async () => {
    currentDatabase().sqlite.prepare(
      "INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, status, wake_reason, target_files, mailbox_claim_count, created_at, updated_at) VALUES (?, 'ws_1', NULL, 'room_1', 'agent_leader', 'failed', 'agent_stalled', '[]', 0, ?, ?)"
    ).run("leader_run_1", nowMs, nowMs);

    currentBridge().handle({ type: "session.opened", sessionId: "sess_1" });
    publishSpy!.mockClear();

    await vi.advanceTimersByTimeAsync(90_000);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const stalledEvents = (publishSpy!.mock.calls as Array<[{ type: string; payload?: { reason?: string } }]>)
      .filter(([e]) => e.type === "room.stalled");
    expect(stalledEvents.length).toBeGreaterThanOrEqual(1);
    expect(stalledEvents[0]![0].payload?.reason).toBe("leader_failed");
  });

  test("WakeAgent dispatch fails → Level-2 still fires room.stalled", async () => {
    // WakeAgent returns no runId (dispatch failed)
    dispatchSpy!.mockReturnValue({ ok: false, error: { code: "internal_error", message: "no leader" } });

    currentBridge().handle({ type: "session.opened", sessionId: "sess_1" });
    publishSpy!.mockClear();

    await vi.advanceTimersByTimeAsync(90_000);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // Level-2 should still fire because no leader run reached running
    const stalledEvents = (publishSpy!.mock.calls as Array<[{ type: string }]>)
      .filter(([e]) => e.type === "room.stalled");
    expect(stalledEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function currentBridge(): AdapterBridge {
  expect(bridge).toBeDefined();
  return bridge as AdapterBridge;
}

function seedWorkspaceRoom(): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)"
  ).run();
  currentDatabase().sqlite.prepare(
    "INSERT INTO agent_profiles (id, name, adapter_id, role_prompt, capabilities, hidden, created_at, updated_at) VALUES ('agent_leader', 'Leader', 'mock', '', '[]', 0, 1, 1)"
  ).run();
  currentDatabase().sqlite.prepare(
    "INSERT INTO agent_profiles (id, name, adapter_id, role_prompt, capabilities, hidden, created_at, updated_at) VALUES ('agent_teammate', 'Teammate', 'mock', '', '[]', 0, 1, 1)"
  ).run();
  currentDatabase().sqlite.prepare(
    "INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'team', 'conversation', 'agent_leader', NULL, 1, 1)"
  ).run();
}

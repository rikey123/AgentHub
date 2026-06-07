import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createWakeOutboxDispatcher } from "../src/wake-outbox-dispatcher.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-wake-outbox-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  seedRoom();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  database = undefined;
  eventBus = undefined;
  tempDir = undefined;
  now = 1_000;
});

describe("WakeOutboxDispatcher", () => {
  test("resets pending and dispatching rows on startup", () => {
    insertWake("wake_pending", "pending");
    insertWake("wake_dispatching", "dispatching");
    insertWake("wake_failed", "failed");

    const dispatcher = createWakeOutboxDispatcher({
      database: currentDatabase(),
      eventBus: currentBus(),
      now: () => now,
      dispatchWake: vi.fn()
    });

    dispatcher.start();
    dispatcher.stop();

    expect(statusOf("wake_pending")).toBe("pending");
    expect(statusOf("wake_dispatching")).toBe("pending");
    expect(statusOf("wake_failed")).toBe("failed");
  });

  test("atomically claims a due pending wake, dispatches it, and publishes wake_outbox.dispatched", async () => {
    insertWake("wake_1", "pending");
    const dispatchWake = vi.fn(async () => ({ runId: "run_1" }));
    const dispatcher = createWakeOutboxDispatcher({ database: currentDatabase(), eventBus: currentBus(), now: () => now, dispatchWake });

    const dispatched = await dispatcher.dispatchPending();

    expect(dispatched).toEqual([{ id: "wake_1", roomId: "room_1", agentId: "agent_1", reason: "aggregate", payload: "{\"ok\":true}" }]);
    expect(dispatchWake).toHaveBeenCalledWith({ id: "wake_1", roomId: "room_1", agentId: "agent_1", reason: "aggregate", payload: "{\"ok\":true}" });
    expect(currentDatabase().sqlite.prepare("SELECT status, dispatched_at FROM wake_outbox WHERE id = ?").get("wake_1")).toMatchObject({ status: "dispatched", dispatched_at: now });
    const event = currentDatabase().sqlite.prepare("SELECT type, payload FROM events WHERE type = 'wake_outbox.dispatched'").get() as { readonly type: string; readonly payload: string };
    expect(event.type).toBe("wake_outbox.dispatched");
    expect(JSON.parse(event.payload)).toMatchObject({ outboxId: "wake_1", runId: "run_1" });
  });

  test("backs off failed dispatches and marks the row failed after max attempts", async () => {
    insertWake("wake_1", "pending", { attemptCount: 2 });
    const dispatcher = createWakeOutboxDispatcher({
      database: currentDatabase(),
      eventBus: currentBus(),
      now: () => now,
      dispatchWake: vi.fn(async () => {
        throw new Error("adapter offline");
      })
    });

    await expect(dispatcher.dispatchPending()).resolves.toEqual([]);

    expect(currentDatabase().sqlite.prepare("SELECT status, attempt_count, last_error FROM wake_outbox WHERE id = ?").get("wake_1")).toMatchObject({
      status: "failed",
      attempt_count: 3,
      last_error: "adapter offline"
    });
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

function seedRoom(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_1', 'ws_1', 'Agent', 'mock', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'solo', 'conversation', 'agent_1', NULL, 1, 1)").run();
}

function insertWake(id: string, status: string, options: { readonly attemptCount?: number } = {}): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO wake_outbox (id, room_id, agent_id, reason, payload, status, attempt_count, max_attempts, created_at, dispatch_after) VALUES (?, 'room_1', 'agent_1', 'aggregate', ?, ?, ?, 3, ?, NULL)"
  ).run(id, JSON.stringify({ ok: true }), status, options.attemptCount ?? 0, now);
}

function statusOf(id: string): string {
  return (currentDatabase().sqlite.prepare("SELECT status FROM wake_outbox WHERE id = ?").get(id) as { readonly status: string }).status;
}

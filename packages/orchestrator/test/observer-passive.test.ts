import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { MockAdapterManager } from "../../adapters/mock/src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let bus: EventBus | undefined;
let adapter: MockAdapterManager | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-observer-passive-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  bus = new EventBus({ database: currentDatabase() });
  seedObserverRoom();
  adapter = new MockAdapterManager({
    database: currentDatabase(),
    eventBus: currentBus(),
    lifecycle: createLifecycleStub() as never,
    script: { steps: [] }
  });
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  bus = undefined;
  adapter = undefined;
  database = undefined;
  vi.restoreAllMocks();
});

describe("observer passive", () => {
  test("100 message.created events do not trigger an observer LLM call", () => {
    const runAgentSpy = vi.spyOn(currentAdapter(), "runAgent");

    for (let index = 0; index < 100; index += 1) {
      currentBus().publish(messageCreated(`evt_${index}`, `msg_${index}`, index));
    }

    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'message.created'").get()).toMatchObject({ count: 100 });
    expect(runAgentSpy).not.toHaveBeenCalled();
    expect(currentAdapter().llmCallsFor("mock-observer")).toBe(0);
  });
});

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(bus).toBeDefined();
  return bus as EventBus;
}

function currentAdapter(): MockAdapterManager {
  expect(adapter).toBeDefined();
  return adapter as MockAdapterManager;
}

function seedObserverRoom(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Observer Room', 'assisted', 'conversation', 'mock-builder', NULL, 1, 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'mock-builder', 'agent', 'primary', 'mock', NULL, 'active', 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'mock-observer', 'agent', 'observer', 'mock', NULL, 'observing', 1)").run();
  currentDatabase().sqlite.prepare("INSERT INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES ('room_1', 'mock-observer', 'observing', NULL, NULL, 1)").run();
}

function createLifecycleStub(): { readonly markRunning: () => void } {
  return { markRunning: (): void => undefined };
}

function messageCreated(id: string, messageId: string, createdAt: number) {
  return {
    id,
    type: "message.created" as const,
    schemaVersion: 1,
    workspaceId: "ws_1",
    roomId: "room_1",
    runId: "run_primary",
    agentId: "mock-observer",
    payload: { messageId, text: `message ${createdAt}` },
    createdAt
  };
}

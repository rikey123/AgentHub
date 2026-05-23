import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InterventionEngine } from "../src/index.ts";

let dir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let engine: InterventionEngine | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agenthub-intervention-flow-"));
  database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDb() });
  engine = new InterventionEngine({ database: currentDb(), eventBus: currentEventBus(), now: () => 10_000 });
  currentDb().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, 1, 1)").run(join(dir, "workspace"));
  currentDb().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'assisted', 'conversation', 'builder', NULL, 1, 1)").run();
});

afterEach(() => {
  eventBus?.close();
  database?.sqlite.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  database = undefined;
  eventBus = undefined;
  engine = undefined;
});

describe("InterventionEngine full flow", () => {
  it("creates a knock intervention and resolves it through approve", () => {
    const workspaceId = "ws_1";
    const roomId = "room_1";
    const sourceAgentId = "reviewer";

    const requested = currentEngine().request({ type: "knock", reason: "need approval for X", workspaceId, roomId, sourceAgentId });

    expect(currentEngine().get(requested.interventionId)).toMatchObject({ status: "pending_user_decision", type: "knock" });

    const approved = currentEngine().approve(requested.interventionId);

    expect(approved?.status === "resolved" || approved?.status === "closed").toBe(true);
    expect(currentEngine().get(requested.interventionId)?.status).toBe("closed");
  });
});

function currentDb(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentEventBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function currentEngine(): InterventionEngine {
  expect(engine).toBeDefined();
  return engine as InterventionEngine;
}

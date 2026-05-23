import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { EventBus } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let bus: EventBus | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-bus-isolation-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  bus = new EventBus({ database: currentDatabase() });
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  bus = undefined;
});

describe("bounded pubsub isolation", () => {
  test("adapter_raw flood does not drop message_delta", async () => {
    const published = [] as string[];
    currentBus().subscribe("message.part.delta", (event) => {
      published.push((event.payload as { readonly delta: string }).delta);
    });

    for (let index = 0; index < 10_000; index += 1) {
      currentBus().publish(rawEvent(index));
    }

    for (let index = 0; index < 100; index += 1) {
      currentBus().publish(messageDelta(index));
    }

    currentBus().flushDeltas();

    expect(published).toHaveLength(100);
    expect(published[0]).toBe("d0");
    expect(published[99]).toBe("d99");
    expect(currentBus().pubSubStats().find((item) => item.channel === "message_delta")).toMatchObject({ dropped: 0 });
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

function rawEvent(index: number) {
  return {
    id: `raw_${index}`,
    type: "adapter.raw.stdout" as const,
    schemaVersion: 1,
    workspaceId: "ws_1",
    agentId: "adapter",
    payload: { line: `raw-${index}` },
    createdAt: index
  };
}

function messageDelta(index: number) {
  return {
    id: `delta_${index}`,
    type: "message.part.delta" as const,
    schemaVersion: 1,
    workspaceId: "ws_1",
    roomId: "room_1",
    runId: "run_1",
    payload: { messageId: `msg_${index}`, delta: `d${index}` },
    createdAt: index
  };
}

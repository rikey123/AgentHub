import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCommandBus, EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInterventionCommandHandlers, InterventionEngine } from "../src/index.ts";

let dir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let engine: InterventionEngine | undefined;
let now = 10_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agenthub-interventions-"));
  database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database });
  engine = new InterventionEngine({ database, eventBus, now: () => now });
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
  now = 10_000;
});

describe("InterventionEngine", () => {
  it("validates reason length and rejects V1-only emergency and rollback types through CommandBus", () => {
    const bus = createCommandBus({ database: currentDb(), handlers: createInterventionCommandHandlers(currentEngine()) });
    const meta = { actor: { type: "agent" as const, id: "reviewer" }, traceId: "trace_1", origin: "mcp_tool" as const };

    expect(bus.dispatch({ type: "RequestIntervention", workspaceId: "ws_1", roomId: "room_1", sourceAgentId: "reviewer", reason: "too short" }, meta)).toMatchObject({ ok: false, error: { code: "validation_failed", message: "intervention.reason must be at least 10 characters" } });
    expect(bus.dispatch({ type: "RequestIntervention", workspaceId: "ws_1", roomId: "room_1", sourceAgentId: "reviewer", interventionType: "emergency", reason: "stop everything immediately" }, meta)).toMatchObject({ ok: false, error: { code: "not_implemented", message: "emergency intervention is V1" } });
    expect(bus.dispatch({ type: "RequestIntervention", workspaceId: "ws_1", roomId: "room_1", sourceAgentId: "reviewer", interventionType: "rollback", reason: "rollback artifact immediately" }, meta)).toMatchObject({ ok: false, error: { code: "not_implemented", message: "rollback intervention is V1" } });
    expect(currentDb().sqlite.prepare("SELECT COUNT(*) AS count FROM interventions").get()).toMatchObject({ count: 0 });
  });

  it("creates a pending intervention, deduplicates same source and target, and marks source presence knocking", () => {
    const first = currentEngine().request(baseRequest({ targetRunId: "run_1" }), { traceId: "trace_dedupe" });
    const second = currentEngine().request(baseRequest({ targetRunId: "run_1", reason: "same run duplicate reason" }));

    expect(first.deduplicated).toBe(false);
    expect(second).toEqual({ interventionId: first.interventionId, existingId: first.interventionId, deduplicated: true });
    expect(currentEngine().get(first.interventionId)).toMatchObject({ status: "pending_user_decision", reason: "review auth hardcoding now" });
    expect(currentDb().sqlite.prepare("SELECT COUNT(*) AS count FROM interventions").get()).toMatchObject({ count: 1 });
    expect(presence()).toMatchObject({ state: "knocking", reason: "intervention_state" });
    expect(interventionEvents()).toEqual(["intervention.requested"]);
    expect(agentStateEvents()).toEqual(["knocking"]);
  });

  it("approves with effective text and emits approved/injected/resolved/closed with observing presence", () => {
    const created = currentEngine().request(baseRequest({ preview: "use env var" }));
    now += 1;
    const approved = currentEngine().approve(created.interventionId, "use JWT_SECRET env and add tests");

    expect(approved).toMatchObject({ status: "closed", resolvedAt: now });
    expect(interventionEvents()).toEqual(["intervention.requested", "intervention.approved", "intervention.injected", "intervention.resolved", "intervention.closed"]);
    expect(lastPayload("intervention.injected")).toMatchObject({ effectiveText: "use JWT_SECRET env and add tests", injectionMode: "immediate" });
    expect(presence()).toMatchObject({ state: "observing" });
    expect(agentStateEvents()).toEqual(["knocking", "active", "observing"]);
  });

  it("ignores and rejects pending interventions by closing them without injection", () => {
    const ignored = currentEngine().request(baseRequest({ targetRunId: "run_ignore" }));
    currentEngine().ignore(ignored.interventionId);
    const rejected = currentEngine().request(baseRequest({ targetRunId: "run_reject" }));
    currentEngine().reject(rejected.interventionId, "not useful");

    expect(currentEngine().get(ignored.interventionId)).toMatchObject({ status: "closed" });
    expect(currentEngine().get(rejected.interventionId)).toMatchObject({ status: "closed" });
    expect(interventionEvents()).toEqual(["intervention.requested", "intervention.ignored", "intervention.closed", "intervention.requested", "intervention.rejected", "intervention.closed"]);
    expect(currentDb().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'intervention.injected'").get()).toMatchObject({ count: 0 });
  });

  it("snoozes and reactivates due interventions while preserving newer pending precedence", () => {
    const snoozed = currentEngine().request(baseRequest({ targetRunId: "run_snooze" }));
    currentEngine().snooze(snoozed.interventionId, 5);
    expect(currentEngine().get(snoozed.interventionId)).toMatchObject({ status: "snoozed", snoozedUntil: 15_000 });
    expect(presence()).toMatchObject({ state: "observing" });

    const pending = currentEngine().request(baseRequest({ targetRunId: "run_pending" }));
    now = 15_000;
    const reactivated = currentEngine().reactivateDueSnoozes(now);

    expect(reactivated.map((item) => item.id)).toEqual([snoozed.interventionId]);
    expect(currentEngine().get(snoozed.interventionId)).toMatchObject({ status: "pending_user_decision" });
    expect(currentEngine().get(pending.interventionId)).toMatchObject({ status: "pending_user_decision" });
    expect(presence()).toMatchObject({ state: "knocking" });
    expect(interventionEvents()).toEqual(["intervention.requested", "intervention.snoozed", "intervention.requested", "intervention.requested"]);
    expect((lastPayload("intervention.requested") as { reactivated?: boolean }).reactivated).toBe(true);
  });

  it("audits invalid transitions without mutating state", () => {
    const created = currentEngine().request(baseRequest({ targetRunId: "run_invalid" }));
    currentEngine().approve(created.interventionId);
    const before = currentEngine().get(created.interventionId);
    currentEngine().ignore(created.interventionId);

    expect(currentEngine().get(created.interventionId)).toEqual(before);
    expect(interventionEvents().at(-1)).toBe("intervention.invalid_transition");
    expect(lastPayload("intervention.invalid_transition")).toMatchObject({ action: "ignore", fromStatus: "closed", stateMutated: false });
  });
});

function currentDb(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentEngine(): InterventionEngine {
  expect(engine).toBeDefined();
  return engine as InterventionEngine;
}

function baseRequest(overrides: Partial<Parameters<InterventionEngine["request"]>[0]> = {}): Parameters<InterventionEngine["request"]>[0] {
  return { workspaceId: "ws_1", roomId: "room_1", sourceAgentId: "reviewer", reason: "review auth hardcoding now", priority: "high", ...overrides };
}

function presence(): { readonly state: string; readonly reason: string | null } {
  return currentDb().sqlite.prepare("SELECT state, reason FROM agent_presence WHERE room_id = 'room_1' AND agent_id = 'reviewer'").get() as { readonly state: string; readonly reason: string | null };
}

function interventionEvents(): string[] {
  return currentDb().sqlite.prepare("SELECT type FROM events WHERE type LIKE 'intervention.%' ORDER BY seq ASC").all().map((row) => (row as { type: string }).type);
}

function agentStateEvents(): string[] {
  return currentDb().sqlite.prepare("SELECT payload FROM events WHERE type = 'agent.state.changed' ORDER BY seq ASC").all().map((row) => JSON.parse((row as { payload: string }).payload) as { state: string }).map((payload) => payload.state);
}

function lastPayload(type: string): unknown {
  const row = currentDb().sqlite.prepare("SELECT payload FROM events WHERE type = ? ORDER BY seq DESC LIMIT 1").get(type) as { readonly payload: string };
  return JSON.parse(row.payload) as unknown;
}

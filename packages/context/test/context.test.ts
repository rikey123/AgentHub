import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContextLedger, createContextCommandHandlers, isVisible, MemoryError, NoopHybridMemoryRouter, NoopMemoryAdapter, NoopVectorIndex, roomSearchMemoryTool, type ContextItem } from "../src/index.ts";

let dir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let ledger: ContextLedger | undefined;
let now = 10_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agenthub-context-"));
  database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database });
  ledger = new ContextLedger({ database, eventBus, now: () => now });
  database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, 1, 1)").run(join(dir, "workspace"));
  database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'solo', 'conversation', 'builder', NULL, 1, 1)").run();
});

afterEach(() => {
  eventBus?.close();
  database?.sqlite.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  database = undefined;
  eventBus = undefined;
  ledger = undefined;
  now = 10_000;
});

describe("ContextLedger", () => {
  it("creates agent proposals as draft and lets a user confirm with version history", () => {
    const proposed = currentLedger().propose(baseCreate({ source: { type: "agent", id: "builder" }, createdBy: "builder", content: "API base path is /api/v2" }));

    expect(proposed).toMatchObject({ ok: true, downgraded: false, item: { status: "draft", confidence: "inferred", version: 1 } });
    expect(contextEvents()).toEqual(["context.item.created", "context.item.proposed"]);

    now += 1;
    const confirmed = currentLedger().confirm(proposed.item.id, "user_1", proposed.item.version);

    expect(confirmed).toMatchObject({ ok: true, item: { status: "confirmed", version: 2 } });
    expect(versionRows(proposed.item.id)).toEqual([1, 2]);
    expect(contextEvents()).toEqual(["context.item.created", "context.item.proposed", "context.item.confirmed"]);
  });

  it("accepts confirmed writes only for verified trusted system tool kinds", () => {
    const trusted = currentLedger().create(baseCreate({ source: { type: "tool", id: "git", kind: "git-blame" }, createdBy: "system", status: "confirmed", confidence: "verified", content: "auth.ts last touched by alice" }));

    expect(trusted).toMatchObject({ ok: true, downgraded: false, item: { status: "confirmed" } });
    expect(contextEvents()).toEqual(["context.item.created", "context.item.confirmed"]);
  });

  it("downgrades untrusted tool confirmed writes and emits proposed audit-style event", () => {
    const result = currentLedger().create(baseCreate({ source: { type: "tool", id: "agent-tool", kind: "my-claim-verifier" }, createdBy: "agent_1", status: "confirmed", confidence: "verified", content: "claimed verified fact" }));

    expect(result).toMatchObject({ ok: false, downgraded: true, reason: "untrusted_tool_kind", item: { status: "draft" } });
    expect(contextEvents()).toEqual(["context.item.created", "context.item.proposed"]);
    expect(lastPayload()).toMatchObject({ downgraded: true, reason: "untrusted_tool_kind" });
  });

  it("closes agent confirmed bypass attempts by downgrading to draft", () => {
    const result = currentLedger().create(baseCreate({ source: { type: "agent", id: "builder" }, createdBy: "builder", status: "confirmed", confidence: "verified", content: "agent says confirmed" }));

    expect(result).toMatchObject({ ok: false, downgraded: true, reason: "agent_confirmed_write_forbidden", item: { status: "draft" } });
  });

  it("rejects stale updates, emits conflict, and preserves current version", () => {
    const item = confirmedItem({ content: "old" });
    now += 1;
    const updated = currentLedger().update({ id: item.id, baseVersion: item.version, patch: { content: "new" } }, "builder");
    expect(updated).toMatchObject({ ok: true, item: { version: 2, content: "new" } });

    const stale = currentLedger().update({ id: item.id, baseVersion: 1, patch: { content: "reviewer" } }, "reviewer");

    expect(stale).toEqual({ ok: false, conflict: { contextId: item.id, baseVersion: 1, currentVersion: 2 } });
    expect(currentLedger().get(item.id)).toMatchObject({ content: "new", version: 2 });
    expect(contextEvents()).toContain("context.item.conflict_created");
  });

  it("pins task context to workspace scope and emits visibility change", () => {
    const item = confirmedItem({ scope: "task", taskId: "task_1", content: "task decision" });
    const pinned = currentLedger().pin(item.id, item.version, "user_1");

    expect(pinned).toMatchObject({ ok: true, item: { scope: "workspace", pinned: true, version: 2 } });
    expect(contextEvents()).toContain("context.item.visibility.changed");
  });

  it("filters prompt visibility by agent allowlist and role capabilities", () => {
    const securityOnly = confirmedItem({ visibility: { agents: ["security-reviewer"] }, content: "security detail" });
    const reviewerRole = confirmedItem({ visibility: { roles: ["code.review"] }, content: "review detail" });

    expect(isVisible(securityOnly, { id: "builder", capabilities: ["code.edit"] })).toBe(false);
    expect(isVisible(securityOnly, { id: "security-reviewer", capabilities: ["code.review"] })).toBe(true);
    expect(isVisible(reviewerRole, { id: "builder", capabilities: ["code.edit"] })).toBe(false);
    expect(isVisible(reviewerRole, { id: "reviewer", capabilities: ["code.review"] })).toBe(true);
  });

  it("assembles deterministic sections in priority order with budget truncation", () => {
    confirmedItem({ scope: "workspace", pinned: true, content: "pinned workspace" });
    now += 1;
    confirmedItem({ taskId: "task_1", content: "task confirmed" });
    now += 1;
    confirmedItem({ roomId: "room_1", content: "room confirmed" });
    now += 1;
    currentLedger().propose(baseCreate({ taskId: "task_1", content: "task draft" }));

    const assembled = currentLedger().assemble({ workspaceId: "ws_1", roomId: "room_1", taskId: "task_1", agentProfile: { id: "builder", capabilities: ["code.edit"] }, budget: { totalTokens: 100, safetyMarginPct: 0 } });
    const tiny = currentLedger().assemble({ workspaceId: "ws_1", roomId: "room_1", taskId: "task_1", agentProfile: { id: "builder", capabilities: ["code.edit"] }, budget: { totalTokens: 8, safetyMarginPct: 0 } });

    expect(assembled.sections.map((section) => section.kind)).toEqual(["pinned_confirmed", "task_confirmed", "room_confirmed", "task_draft"]);
    expect(assembled.text).toContain("Pinned workspace context");
    expect(tiny.truncated).toBe(true);
  });

  it("classifies context injection modes without provider injection side effects", () => {
    expect(currentLedger().classifyInjection("immediate", true)).toEqual({ mode: "immediate", applied: true, effectiveAt: "now" });
    expect(currentLedger().classifyInjection("immediate", false)).toEqual({ mode: "immediate", applied: false, effectiveAt: "next_turn", reason: "no active run" });
    expect(currentLedger().classifyInjection("next_turn", true)).toEqual({ mode: "next_turn", applied: false, effectiveAt: "next_turn", reason: "pending_inject" });
    expect(currentLedger().classifyInjection("next_session", true)).toEqual({ mode: "next_session", applied: false, effectiveAt: "next_session", reason: "requires_restart" });
  });

  it("keeps InjectContext available for internal command usage", () => {
    const handlers = createContextCommandHandlers(currentLedger());
    const result = handlers.InjectContext?.({ type: "InjectContext", mode: "next_turn", activeRun: true }, { actor: { type: "system" }, traceId: "trace_1", origin: "internal" });

    expect(result).toEqual({ ok: true, data: { mode: "next_turn", applied: false, effectiveAt: "next_turn", reason: "pending_inject" }, emittedEvents: [] });
  });

  it("provides a no-op vector index for future vector search", async () => {
    const index = new NoopVectorIndex();
    await expect(index.search("auth.ts changes", 8, { workspaceId: "ws_1" })).resolves.toEqual([]);
    await expect(index.upsert(confirmedItem({ content: "vector item" }))).resolves.toBeUndefined();
    await expect(index.remove("ctx_missing")).resolves.toBeUndefined();
  });

  it("provides deterministic V1 memory gateway stubs without real memory behavior", async () => {
    const adapter = new NoopMemoryAdapter();
    const router = new NoopHybridMemoryRouter(adapter);
    const entry = { id: "mem_1", workspaceId: "ws_1", type: "decision" as const, content: "Use SQLite", status: "confirmed" as const, visibility: "workspace" as const, createdAt: 1, updatedAt: 1 };

    await expect(adapter.upsert(entry)).resolves.toBeUndefined();
    await expect(adapter.search("sqlite", { workspaceId: "ws_1" })).resolves.toEqual([]);
    expect(router.route(entry)).toEqual([adapter]);
    expect(router.merge([[entry], [entry]])).toEqual([entry]);
    expect(() => roomSearchMemoryTool()).toThrow(MemoryError);
  });
});

function currentDb(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentLedger(): ContextLedger {
  expect(ledger).toBeDefined();
  return ledger as ContextLedger;
}

function baseCreate(overrides: Partial<Parameters<ContextLedger["create"]>[0]> = {}): Parameters<ContextLedger["create"]>[0] {
  return { workspaceId: "ws_1", roomId: "room_1", type: "fact", scope: "conversation", content: "fact", source: { type: "agent", id: "builder" }, visibility: {}, createdBy: "builder", ...overrides };
}

function confirmedItem(overrides: Partial<Parameters<ContextLedger["create"]>[0]> = {}): ContextItem {
  return currentLedger().create(baseCreate({ source: { type: "tool", id: "git", kind: "git-log" }, createdBy: "system", status: "confirmed", confidence: "verified", ...overrides })).item;
}

function contextEvents(): string[] {
  return currentDb().sqlite.prepare("SELECT type FROM events WHERE type LIKE 'context.%' ORDER BY seq ASC").all().map((row) => (row as { type: string }).type);
}

function versionRows(contextId: string): number[] {
  return currentDb().sqlite.prepare("SELECT version FROM context_versions WHERE context_id = ? ORDER BY version ASC").all(contextId).map((row) => (row as { version: number }).version);
}

function lastPayload(): unknown {
  const row = currentDb().sqlite.prepare("SELECT payload FROM events WHERE type LIKE 'context.%' ORDER BY seq DESC LIMIT 1").get() as { payload: string };
  return JSON.parse(row.payload) as unknown;
}

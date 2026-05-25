import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionEngine, seedBuiltInPermissionProfiles } from "../src/index.ts";

let dir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let engine: PermissionEngine | undefined;
let now = 1_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agenthub-permissions-"));
  database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database });
  seedBuiltInPermissionProfiles(database, now);
  database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, 1, 1)").run(join(dir, "workspace"));
  engine = new PermissionEngine({ database, eventBus, now: () => now, timeoutMs: 100, maxWaitMs: 1_000 });
});

afterEach(() => {
  vi.useRealTimers();
  engine?.close();
  eventBus?.close();
  database?.sqlite.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  database = undefined;
  eventBus = undefined;
  engine = undefined;
  now = 1_000;
});

describe("PermissionEngine", () => {
  it("seeds built-in templates and allows read-only reads while denying writes", () => {
    expect(currentDb().sqlite.prepare("SELECT id FROM permission_profiles ORDER BY id ASC").all().map((row) => (row as { id: string }).id)).toEqual(["builder-loose", "builder-strict", "read-only"]);

    expect(currentEngine().check({ workspaceId: "ws_1", profileId: "read-only", resource: { type: "file", path: "README.md", operation: "read" } })).toMatchObject({ status: "allow" });
    expect(currentEngine().check({ workspaceId: "ws_1", profileId: "read-only", resource: { type: "file", path: "src/a.ts", operation: "write" } })).toMatchObject({ status: "deny", reason: "file.write" });
  });

  it("denies sensitive files before ask and asks for external directories", () => {
    expect(currentEngine().check({ workspaceId: "ws_1", profileId: "builder-loose", resource: { type: "file", path: ".env", operation: "read" } })).toMatchObject({ status: "deny", reason: "Sensitive file pattern matched: .env" });
    expect(currentEngine().check({ workspaceId: "ws_1", profileId: "builder-loose", resource: { type: "file", path: join(dir ?? "", "outside.txt"), operation: "write" } })).toMatchObject({ status: "ask" });
  });

  it("uses longest shell glob and pipeline deny precedence", () => {
    expect(currentEngine().check({ workspaceId: "ws_1", profileId: "builder-loose", resource: { type: "shell", command: "git status" } })).toMatchObject({ status: "allow", reason: "shell.git *" });
    const push = currentEngine().check({ workspaceId: "ws_1", profileId: "builder-loose", resource: { type: "shell", command: "git push origin main" } });
    expect(push).toMatchObject({ status: "ask" });
    expect(currentDb().sqlite.prepare("SELECT reason FROM permission_requests WHERE id = ?").get((push as { requestId: string }).requestId)).toMatchObject({ reason: "shell.git push *" });
    currentDb().sqlite.prepare("INSERT INTO permission_profiles (id, name, payload, created_at, updated_at) VALUES ('custom', 'Custom', ?, 1, 1)").run(JSON.stringify({ file: { read: "allow", write: "ask", delete: "ask", externalDirectory: "ask" }, shell: { "cat *": "allow", "rm *": "deny", "*": "ask" }, tool: { "*": "ask" }, context: { read: "allow", write: "ask", share: "ask", memoryWrite: "deny" }, agent: { mention: "allow", invoke: "ask", interrupt: "deny", control: "deny" } }));
    expect(currentEngine().check({ workspaceId: "ws_1", profileId: "custom", resource: { type: "shell", command: "cat README.md | rm -rf dist" } })).toMatchObject({ status: "deny", reason: "shell.rm *" });
  });

  it("creates deferred asks, resolves them, remembers workspace rules, and audits events", async () => {
    const result = currentEngine().check({ workspaceId: "ws_1", roomId: "room_1", agentId: "agent_1", profileId: "builder-strict", resource: { type: "file", path: "src/a.ts", operation: "write" } });
    expect(result.status).toBe("ask");
    if (result.status !== "ask") throw new Error("expected ask");
    expect(currentDb().sqlite.prepare("SELECT status FROM permission_requests WHERE id = ?").get(result.requestId)).toMatchObject({ status: "pending" });
    currentEngine().resolve(result.requestId, "allow", true, "this_workspace");
    await expect(result.promise).resolves.toMatchObject({ decision: "allowed" });
    expect(currentDb().sqlite.prepare("SELECT action, remember FROM permission_rules").get()).toMatchObject({ action: "allow", remember: 1 });
    expect(currentEngine().check({ workspaceId: "ws_1", roomId: "room_1", agentId: "agent_1", profileId: "builder-strict", resource: { type: "file", path: "src/a.ts", operation: "write" } })).toMatchObject({ status: "allow", reason: "matched stored rule" });
    expect(currentDb().sqlite.prepare("SELECT type FROM events WHERE type LIKE 'permission.%' ORDER BY seq ASC").all().map((row) => (row as { type: string }).type)).toEqual(["permission.requested", "permission.resolved", "permission.resolved"]);
    expect(currentDb().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'permission.resolved' AND payload LIKE '%\"audit\":true%' ").get()).toMatchObject({ count: 2 });
  });

  it("records an audit event for sensitive file denies", () => {
    const result = currentEngine().check({ workspaceId: "ws_1", profileId: "builder-loose", resource: { type: "file", path: ".env", operation: "read" } });
    expect(result).toMatchObject({ status: "deny", reason: "Sensitive file pattern matched: .env" });
    expect(currentDb().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'permission.resolved' AND payload LIKE '%\"audit\":true%' ").get()).toMatchObject({ count: 1 });
  });

  it("serializes per-session requests and deduplicates pending idempotency keys", () => {
    const first = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_1", idempotencyKey: "tc_1", profileId: "builder-strict", resource: { type: "shell", command: "npm install" } });
    const duplicate = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_1", idempotencyKey: "tc_1", profileId: "builder-strict", resource: { type: "shell", command: "npm install" } });
    const second = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_1", idempotencyKey: "tc_2", profileId: "builder-strict", resource: { type: "shell", command: "git push origin main" } });
    expect(first.status).toBe("ask");
    expect(duplicate.status).toBe("ask");
    expect(second.status).toBe("ask");
    expect((duplicate as { requestId: string }).requestId).toBe((first as { requestId: string }).requestId);
    expect((duplicate as { promise: Promise<unknown> }).promise).toBe((first as { promise: Promise<unknown> }).promise);
    expect(currentDb().sqlite.prepare("SELECT COUNT(*) AS count FROM permission_requests").get()).toMatchObject({ count: 2 });
    expect(currentDb().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'permission.requested'").get()).toMatchObject({ count: 1 });
    currentEngine().resolve((first as { requestId: string }).requestId, "deny");
    expect(currentDb().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'permission.requested'").get()).toMatchObject({ count: 2 });
  });

  it("does not start normal timeout for queued requests until they are presented", () => {
    const first = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_queue", idempotencyKey: "tc_first", profileId: "builder-strict", resource: { type: "shell", command: "npm install" } });
    const second = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_queue", idempotencyKey: "tc_second", profileId: "builder-strict", resource: { type: "shell", command: "git push origin main" } });
    const firstId = (first as { requestId: string }).requestId;
    const secondId = (second as { requestId: string }).requestId;

    expect(rowFor(secondId)).toMatchObject({ status: "pending", expires_at: null });
    expect(requestedIds()).toEqual([firstId]);

    now += 101;
    currentEngine().expireDueRequests(now);

    expect(rowFor(firstId)).toMatchObject({ status: "expired", decision: "deny" });
    expect(rowFor(secondId)).toMatchObject({ status: "pending", expires_at: now + 100 });
    expect(requestedIds()).toEqual([firstId, secondId]);

    now += 99;
    currentEngine().expireDueRequests(now);
    expect(rowFor(secondId)).toMatchObject({ status: "pending" });

    now += 1;
    currentEngine().expireDueRequests(now);
    expect(rowFor(secondId)).toMatchObject({ status: "expired", decision: "deny" });
  });

  it("starts a fresh active timeout for queued requests promoted by explicit resolution", () => {
    const first = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_resolve", idempotencyKey: "tc_first", profileId: "builder-strict", resource: { type: "shell", command: "npm install" } });
    const second = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_resolve", idempotencyKey: "tc_second", profileId: "builder-strict", resource: { type: "shell", command: "git push origin main" } });
    const firstId = (first as { requestId: string }).requestId;
    const secondId = (second as { requestId: string }).requestId;

    now += 101;
    expect(rowFor(secondId)).toMatchObject({ status: "pending", expires_at: null });
    currentEngine().resolve(firstId, "deny");

    expect(rowFor(secondId)).toMatchObject({ status: "pending", expires_at: now + 100 });
    expect(requestedIds()).toEqual([firstId, secondId]);
  });

  it("presents concurrent permissions immediately", () => {
    const first = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_concurrent", idempotencyKey: "tc_first", profileId: "builder-strict", resource: { type: "shell", command: "npm install" } });
    const second = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_concurrent", idempotencyKey: "tc_second", profileId: "builder-strict", concurrentPermission: true, resource: { type: "shell", command: "git push origin main" } });
    const firstId = (first as { requestId: string }).requestId;
    const secondId = (second as { requestId: string }).requestId;

    expect(rowFor(secondId)).toMatchObject({ status: "pending", expires_at: now + 100 });
    expect(requestedIds()).toEqual([firstId, secondId]);
  });

  it("expires pending asks as deny and short-circuits recent allow retries", () => {
    vi.useFakeTimers();
    const expiring = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_2", idempotencyKey: "tc_expire", profileId: "builder-strict", resource: { type: "shell", command: "npm install" } });
    expect(expiring.status).toBe("ask");
    now += 101;
    currentEngine().expireDueRequests(now);
    expect(currentDb().sqlite.prepare("SELECT status, decision FROM permission_requests WHERE id = ?").get((expiring as { requestId: string }).requestId)).toMatchObject({ status: "expired", decision: "deny" });

    const allowed = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_3", idempotencyKey: "tc_allow", profileId: "builder-strict", resource: { type: "shell", command: "npm install" } });
    currentEngine().resolve((allowed as { requestId: string }).requestId, "allow");
    const retry = currentEngine().check({ workspaceId: "ws_1", adapterSessionId: "sess_3", idempotencyKey: "tc_allow", profileId: "builder-strict", resource: { type: "shell", command: "npm install" } });
    expect(retry).toMatchObject({ status: "allow", reason: "short_circuit_repeat" });
  });
});

function currentDb(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentEngine(): PermissionEngine {
  expect(engine).toBeDefined();
  return engine as PermissionEngine;
}

function rowFor(requestId: string): { readonly status: string; readonly decision: string | null; readonly expires_at: number | null } {
  return currentDb().sqlite.prepare("SELECT status, decision, expires_at FROM permission_requests WHERE id = ?").get(requestId) as { readonly status: string; readonly decision: string | null; readonly expires_at: number | null };
}

function requestedIds(): string[] {
  return currentDb().sqlite
    .prepare("SELECT payload FROM events WHERE type = 'permission.requested' ORDER BY seq ASC")
    .all()
    .map((row) => JSON.parse((row as { payload: string }).payload) as { requestId: string })
    .map((payload) => payload.requestId);
}

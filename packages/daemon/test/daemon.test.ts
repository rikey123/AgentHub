import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentHubClient } from "@agenthub/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDaemon, type DaemonApp } from "../src/index.ts";

describe("daemon M1.4 composition", () => {
  let daemon: DaemonApp;
  let baseUrl: string;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-test-"));
    daemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0 });
    const server = await daemon.start();
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("expected TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await daemon.close();
  });

  it("serves OpenAPI and runs Mock Solo through SDK", async () => {
    const client = new AgentHubClient({ baseUrl });
    await expect(client.health()).resolves.toEqual({ ok: true });
    const openapi = await client.openApi() as { readonly openapi?: string };
    expect(openapi.openapi).toBe("3.1.0");
    const room = await client.createRoom({ title: "Golden", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    const sent = await client.sendMessage(room.data.roomId, { text: "hello", idempotencyKey: "hello-1" }) as { readonly ok: boolean };
    expect(sent.ok).toBe(true);

    const runs = daemon.database.sqlite.prepare("SELECT status FROM runs ORDER BY created_at ASC").all() as { status: string }[];
    expect(runs.map((run) => run.status)).toEqual(["completed"]);
    const messages = await client.listMessages(room.data.roomId) as { readonly messages: readonly { readonly role: string; readonly status: string }[] };
    expect(messages.messages.some((message) => message.role === "assistant" && message.status === "completed")).toBe(true);
  });

  it("streams durable replay plus live events with main/detail visibility", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "SSE", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    await client.sendMessage(room.data.roomId, { text: "sse", idempotencyKey: "sse-1" });
    const replay = daemon.eventBus.replayDurableSinceSeq(0, { view: "main", roomId: room.data.roomId });
    expect(replay.every((event) => event.visibility === "main" || event.visibility === "both")).toBe(true);
    expect(replay.some((event) => event.type === "tool.call.requested")).toBe(false);
    const detail = daemon.eventBus.replayDurableSinceSeq(0, { view: "detail", roomId: room.data.roomId });
    expect(detail.some((event) => event.type === "tool.call.requested")).toBe(true);
  });

  it("enforces browser auth bootstrap, GET/SSE session auth, CSRF, and bearer-origin rules", async () => {
    const originHeaders = { origin: baseUrl, "content-type": "application/json" };
    const bootstrap = await fetch(`${baseUrl}/auth/session`, { method: "POST", headers: originHeaders });
    const sessionPayload = await bootstrap.json() as { readonly csrfToken: string };
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(bootstrap.status).toBe(200);
    expect(cookie).toContain("agenthub_session=");

    const noCsrf = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { ...originHeaders, cookie }, body: JSON.stringify({ title: "Blocked" }) });
    expect(await noCsrf.json()).toMatchObject({ error: "csrf_token_mismatch" });
    expect(noCsrf.status).toBe(403);

    const created = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { ...originHeaders, cookie, "x-agenthub-csrf": sessionPayload.csrfToken }, body: JSON.stringify({ title: "Browser", mode: "solo", primaryAgentId: "mock-builder" }) });
    expect(created.status).toBe(200);

    const sse = await fetch(`${baseUrl}/event`, { headers: { origin: baseUrl, cookie } });
    expect(sse.status).toBe(200);
    await sse.body?.cancel();

    const attacker = await fetch(`${baseUrl}/rooms`, { method: "GET", headers: { origin: "http://attacker.example.com", authorization: "Bearer bad" } });
    expect(attacker.status).toBe(403);
  });

  it("requires admin for raw SSE and streams live adapter raw events only", async () => {
    daemon.database.sqlite.prepare("INSERT INTO auth_tokens (id, fingerprint, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)").run("token_raw_admin", "raw-admin", sha256("raw-admin"), JSON.stringify(["admin"]), 1);
    const bootstrap = await fetch(`${baseUrl}/auth/session`, { method: "POST", headers: { origin: baseUrl, "content-type": "application/json" } });
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0] ?? "";
    const browserRaw = await fetch(`${baseUrl}/event?view=raw`, { headers: { origin: baseUrl, cookie } });
    expect(browserRaw.status).toBe(403);
    expect(await browserRaw.json()).toMatchObject({ error: "requires_admin_scope" });

    const adminRaw = await fetch(`${baseUrl}/event?view=raw&runId=run_raw`, { headers: { authorization: "Bearer raw-admin" } });
    expect(adminRaw.status).toBe(200);
    expect(daemon.eventBus.replayDurableSinceSeq(0, { view: "raw", runId: "run_raw" })).toEqual([]);

    const rawFrame = readSseEvent(adminRaw.body, "adapter.raw.stdout");
    daemon.eventBus.publish({ id: "evt_raw_stdout", type: "adapter.raw.stdout", schemaVersion: 1, workspaceId: "default-workspace", runId: "run_raw", agentId: "mock-builder", payload: { line: "AGENTHUB_TOKEN=super-secret-token", stream: "stdout" }, createdAt: 10 });
    daemon.eventBus.publish({ id: "evt_raw_other", type: "adapter.raw.stderr", schemaVersion: 1, workspaceId: "default-workspace", runId: "run_other", agentId: "mock-builder", payload: { line: "hidden" }, createdAt: 11 });

    const frame = await rawFrame;
    expect(frame).toContain("event: adapter.raw.stdout");
    expect(frame).toContain("«REDACTED:agenthub-token»");
    expect(frame).not.toContain("super-secret-token");
    expect(frame).not.toContain("evt_raw_other");
  });

  it("keeps observers passive without explicit wake", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Assisted", mode: "assisted", primaryAgentId: "mock-builder", participants: [{ type: "agent", agentId: "mock-observer", role: "observer", defaultPresence: "observing" }] }) as { readonly data: { readonly roomId: string } };
    await client.sendMessage(room.data.roomId, { text: "observer should not run", idempotencyKey: "observer-1" });
    expect(daemon.mockAdapter.llmCallsFor("mock-builder")).toBe(1);
    expect(daemon.mockAdapter.llmCallsFor("mock-observer")).toBe(0);
  });

  it("exposes permission APIs and resolves requests through CommandBus", async () => {
    const client = new AgentHubClient({ baseUrl });
    const profiles = await client.listPermissionProfiles() as { readonly profiles: readonly { readonly id: string }[] };
    expect(profiles.profiles.map((profile) => profile.id)).toEqual(expect.arrayContaining(["builder-strict", "builder-loose", "read-only"]));
    daemon.database.sqlite.prepare("INSERT INTO permission_requests (id, workspace_id, room_id, agent_id, resource, reason, status, remember_decision, created_at, expires_at) VALUES ('preq_api', 'default-workspace', 'room_api', 'agent_api', ?, 'test', 'pending', 0, 1, 60000)").run(JSON.stringify({ type: "shell", command: "npm install" }));

    const pending = await client.listPermissionRequests({ status: "pending", roomId: "room_api" }) as { readonly requests: readonly { readonly id: string }[] };
    expect(pending.requests.map((request) => request.id)).toEqual(["preq_api"]);
    const resolved = await client.resolvePermission("preq_api", { decision: "allow", remember: true, scope: "this_workspace" }) as { readonly ok: boolean };
    expect(resolved.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT status, decision FROM permission_requests WHERE id = 'preq_api'").get()).toMatchObject({ status: "allowed", decision: "allow" });
    expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE type = 'permission.resolved'").get()).toMatchObject({ type: "permission.resolved" });
  });

  it("does not expose internal-only context injection over HTTP", async () => {
    const response = await fetch(`${baseUrl}/context/inject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "immediate", activeRun: true }) });
    const payload = await response.json() as { readonly error?: string; readonly message?: string };

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: "not_found" });
    expect(JSON.stringify(payload)).not.toContain("internal_command_via_http");
  });

  it("exposes intervention APIs through CommandBus and debug basics", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Interventions", mode: "assisted", primaryAgentId: "mock-builder", participants: [{ type: "agent", agentId: "mock-reviewer", role: "observer", defaultPresence: "observing" }] }) as { readonly data: { readonly roomId: string } };
    const requested = await client.requestIntervention({ workspaceId: "default-workspace", roomId: room.data.roomId, sourceAgentId: "mock-reviewer", targetRunId: "run_api", reason: "review hardcoded secret usage", preview: "use env", priority: "high" }) as { readonly ok: boolean; readonly data: { readonly interventionId: string; readonly deduplicated: boolean } };

    expect(requested.ok).toBe(true);
    expect(requested.data.deduplicated).toBe(false);
    expect(daemon.database.sqlite.prepare("SELECT state FROM agent_presence WHERE room_id = ? AND agent_id = 'mock-reviewer'").get(room.data.roomId)).toMatchObject({ state: "knocking" });

    const list = await client.listInterventions({ roomId: room.data.roomId, status: "pending_user_decision" }) as { readonly interventions: readonly { readonly id: string }[] };
    expect(list.interventions.map((item) => item.id)).toEqual([requested.data.interventionId]);
    const approved = await client.approveIntervention(requested.data.interventionId, { effectiveText: "use env var" }) as { readonly ok: boolean };
    expect(approved.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT status FROM interventions WHERE id = ?").get(requested.data.interventionId)).toMatchObject({ status: "closed" });

    const debug = await client.debugEvents({ roomId: room.data.roomId, type: "intervention.approved", limit: "10" }) as { readonly events: readonly { readonly type: string }[] };
    expect(debug.events.map((event) => event.type)).toEqual(["intervention.approved"]);
    const stats = await client.debugStats() as { readonly pendingPermissionCount: number; readonly pendingInterventionCount: number; readonly activeRunCount: number; readonly roomCount: number; readonly eventsLast5min: number; readonly uptimeMs: number; readonly sseClientCount: number; readonly pubsub: readonly { readonly channel: string }[] };
    expect(stats).toMatchObject({ pendingPermissionCount: 0, pendingInterventionCount: 0, activeRunCount: 0, roomCount: 1, sseClientCount: 0 });
    expect(stats.pubsub.map((item) => item.channel)).toContain("adapter_raw");
    expect(stats.eventsLast5min).toBeGreaterThan(0);
    expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readSseEvent(body: ReadableStream<Uint8Array> | null, eventName: string): Promise<string> {
  if (body === null) throw new Error("expected SSE body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeout = Date.now() + 2_000;
  try {
    while (Date.now() < timeout) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const frame of buffer.split("\n\n")) {
        if (frame.includes(`event: ${eventName}`)) {
          await reader.cancel();
          return frame;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(`Timed out waiting for SSE event ${eventName}: ${buffer}`);
}

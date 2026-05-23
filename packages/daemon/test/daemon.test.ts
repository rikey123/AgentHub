import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentHubClient } from "@agenthub/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDaemon, type DaemonApp, type DaemonStartupPhase } from "../src/index.ts";

let currentDaemon: DaemonApp | undefined;

describe("daemon M1.4 composition", () => {
  let daemon: DaemonApp;
  let baseUrl: string;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-test-"));
    daemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0 });
    currentDaemon = daemon;
    const server = await daemon.start();
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("expected TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await daemon.close();
    currentDaemon = undefined;
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

  it("starts and shuts down daemon phases in spec order", async () => {
    await daemon.close();
    currentDaemon = undefined;
    const phases: { readonly direction: "startup" | "shutdown"; readonly phase: DaemonStartupPhase }[] = [];
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-phases-"));
    const phasedDaemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0, onLifecyclePhase: (event) => phases.push(event) });

    await phasedDaemon.start();
    await phasedDaemon.close();

    const expectedStartup: readonly DaemonStartupPhase[] = [
      "SQLite open + pragma + migrate",
      "EventStore readiness check",
      "EventBus (PubSub + per-type)",
      "Outbox Dispatcher start",
      "Durable Handler Registry (register all, catch-up, realtime)",
      "RunQueue Worker start",
      "AdapterManager detect + register",
      "CommandBus open",
      "HTTP server bind + SSE accept"
    ];
    const expectedShutdown: readonly DaemonStartupPhase[] = [
      "HTTP server bind + SSE accept",
      "CommandBus open",
      "RunQueue Worker start",
      "AdapterManager detect + register",
      "Outbox Dispatcher start",
      "Durable Handler Registry (register all, catch-up, realtime)",
      "EventBus (PubSub + per-type)",
      "EventStore readiness check",
      "SQLite open + pragma + migrate"
    ];
    expect(phases.filter((event) => event.direction === "startup").map((event) => event.phase)).toEqual(expectedStartup);
    expect(phases.filter((event) => event.direction === "shutdown").map((event) => event.phase)).toEqual(expectedShutdown);
  });

  it("returns healthz during startup and gates other routes with service_starting", async () => {
    await daemon.close();
    currentDaemon = undefined;
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-starting-"));
    const startingDaemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0 });

    const health = await invokeHandler(startingDaemon, "GET", "/healthz");
    const rooms = await invokeHandler(startingDaemon, "GET", "/rooms");

    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });
    expect(rooms.status).toBe(503);
    expect(rooms.body).toEqual({ error: "service_starting", retryAfterMs: 500 });
    await startingDaemon.close();
  });

  it("selects ClaudeCodeAdapter when the primary profile requests claude-code", async () => {
    daemon.database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('claude-agent', NULL, 'Claude Agent', 'claude-code', 'claude', 'Claude test profile', ?, NULL, 0, NULL, 1, 1)").run(JSON.stringify(["chat", "code.edit"]));
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Claude", mode: "solo", primaryAgentId: "claude-agent" }) as { readonly data: { readonly roomId: string } };

    const sent = await client.sendMessage(room.data.roomId, { text: "use claude", idempotencyKey: "claude-select-1" }) as { readonly ok: boolean };

    expect(sent.ok).toBe(true);
    expect(daemon.mockAdapter.llmCallsFor("claude-agent")).toBe(0);
    const run = daemon.database.sqlite.prepare("SELECT id, adapter_session_id FROM runs WHERE agent_id = 'claude-agent'").get() as { readonly id: string; readonly adapter_session_id: string };
    expect(run).toMatchObject({ adapter_session_id: `acp-claude-code-${run.id}` });
    expect(daemon.adapterRegistry.getClaudeAdapterForTest()?.debugSession(run.adapter_session_id)).toBeDefined();
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

    const noOriginRaw = await fetch(`${baseUrl}/event?view=raw`);
    expect(noOriginRaw.status).toBe(403);
    expect(await noOriginRaw.json()).toMatchObject({ error: "requires_admin_scope" });

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

  it("queues pending turns while primary is busy and preserves immediate wake when idle", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Pending", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    seedBusyRun(room.data.roomId, "mock-builder", "run_busy");

    const queued = await client.sendMessage(room.data.roomId, { text: "queued", idempotencyKey: "queued-1" }) as { readonly ok: boolean; readonly data: { readonly messageId: string } };

    expect(queued.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT status, user_message_id FROM pending_turns WHERE id = ?").get(queued.data.messageId)).toMatchObject({ status: "queued", user_message_id: queued.data.messageId });
    expect(daemon.database.sqlite.prepare("SELECT turn_dispatch_mode, pending_turn_id FROM messages WHERE id = ?").get(queued.data.messageId)).toMatchObject({ turn_dispatch_mode: "pending", pending_turn_id: queued.data.messageId });
    expect(messagePayload(daemon, queued.data.messageId, "message.created")).toMatchObject({ messageId: queued.data.messageId, pendingTurnId: queued.data.messageId, turnDispatchMode: "pending" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM runs WHERE wake_reason = 'primary_turn'").get()).toMatchObject({ count: 1 });

    daemon.database.sqlite.prepare("UPDATE runs SET status = 'completed', ended_at = ? WHERE id = 'run_busy'").run(Date.now());
    const immediate = await client.sendMessage(room.data.roomId, { text: "immediate", idempotencyKey: "immediate-1" }) as { readonly ok: boolean; readonly data: { readonly messageId: string } };
    expect(immediate.ok).toBe(true);
    expect(messagePayload(daemon, immediate.data.messageId, "message.created")).toMatchObject({ messageId: immediate.data.messageId, turnDispatchMode: "immediate" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM runs WHERE wake_reason = 'primary_turn'").get()).toMatchObject({ count: 2 });
  });

  it("queues pending turns while primary run is waiting", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Waiting Pending", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    seedBusyRun(room.data.roomId, "mock-builder", "run_waiting", "waiting");

    const queued = await client.sendMessage(room.data.roomId, { text: "queued while waiting", idempotencyKey: "queued-waiting-1" }) as { readonly ok: boolean; readonly data: { readonly messageId: string } };

    expect(queued.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT turn_dispatch_mode, pending_turn_id FROM messages WHERE id = ?").get(queued.data.messageId)).toMatchObject({ turn_dispatch_mode: "pending", pending_turn_id: queued.data.messageId });
    expect(daemon.database.sqlite.prepare("SELECT status, user_message_id FROM pending_turns WHERE id = ?").get(queued.data.messageId)).toMatchObject({ status: "queued", user_message_id: queued.data.messageId });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM runs WHERE room_id = ? AND agent_id = 'mock-builder' AND wake_reason = 'primary_turn'").get(room.data.roomId)).toMatchObject({ count: 1 });
  });

  it("caps queued pending turns at 20 and returns 429 for the 21st", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Cap", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    seedBusyRun(room.data.roomId, "mock-builder", "run_cap");
    for (let index = 0; index < 20; index += 1) {
      const sent = await client.sendMessage(room.data.roomId, { text: `queued ${index}`, idempotencyKey: `cap-${index}` }) as { readonly ok: boolean };
      expect(sent.ok).toBe(true);
    }

    const rejected = await fetch(`${baseUrl}/rooms/${room.data.roomId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "too many", idempotencyKey: "cap-21" }) });
    const payload = await rejected.json() as { readonly ok: boolean; readonly error: { readonly message: string; readonly details?: unknown } };

    expect(rejected.status).toBe(429);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toBe("pending_turn_quota_exceeded");
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM pending_turns WHERE room_id = ? AND status = 'queued'").get(room.data.roomId)).toMatchObject({ count: 20 });
  });

  it("cancels queued pending turns and rejects non-queued states", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Cancel Pending", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    seedBusyRun(room.data.roomId, "mock-builder", "run_cancel_pending");
    const sent = await client.sendMessage(room.data.roomId, { text: "cancel me", idempotencyKey: "cancel-pending-1" }) as { readonly data: { readonly messageId: string } };

    const cancelled = await fetch(`${baseUrl}/pending-turns/${sent.data.messageId}`, { method: "DELETE" });
    expect(cancelled.status).toBe(200);
    expect(daemon.database.sqlite.prepare("SELECT status FROM pending_turns WHERE id = ?").get(sent.data.messageId)).toMatchObject({ status: "cancelled" });

    const conflict = await fetch(`${baseUrl}/pending-turns/${sent.data.messageId}`, { method: "DELETE" });
    expect(conflict.status).toBe(409);
  });

  it("edits queued pending message as cancel plus new queued or immediate message", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Edit Pending", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    seedBusyRun(room.data.roomId, "mock-builder", "run_edit_pending");
    const sent = await client.sendMessage(room.data.roomId, { text: "old", idempotencyKey: "edit-pending-1" }) as { readonly data: { readonly messageId: string } };

    const editedQueued = await fetch(`${baseUrl}/messages/${sent.data.messageId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "new queued" }) });
    const queuedPayload = await editedQueued.json() as { readonly ok: boolean; readonly data: { readonly messageId: string } };
    expect(editedQueued.status).toBe(200);
    expect(queuedPayload.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT status FROM pending_turns WHERE id = ?").get(sent.data.messageId)).toMatchObject({ status: "cancelled" });
    expect(daemon.database.sqlite.prepare("SELECT turn_dispatch_mode FROM messages WHERE id = ?").get(queuedPayload.data.messageId)).toMatchObject({ turn_dispatch_mode: "pending" });

    daemon.database.sqlite.prepare("UPDATE runs SET status = 'completed', ended_at = ? WHERE id = 'run_edit_pending'").run(Date.now());
    const seededMessageId = "msg_seeded_edit_immediate";
    seedPendingMessage(room.data.roomId, "mock-builder", seededMessageId, "old immediate");
    const editedImmediate = await fetch(`${baseUrl}/messages/${seededMessageId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "new immediate" }) });
    const immediatePayload = await editedImmediate.json() as { readonly ok: boolean; readonly data: { readonly messageId: string } };

    expect(editedImmediate.status).toBe(200);
    expect(immediatePayload.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT turn_dispatch_mode FROM messages WHERE id = ?").get(immediatePayload.data.messageId)).toMatchObject({ turn_dispatch_mode: "immediate" });
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

    // Browser session (Origin present, no admin scope) must be denied /debug/events per spec.
    const bootstrap = await fetch(`${baseUrl}/auth/session`, { method: "POST", headers: { origin: baseUrl, "content-type": "application/json" } });
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0] ?? "";
    const browserDebug = await fetch(`${baseUrl}/debug/events`, { headers: { origin: baseUrl, cookie } });
    expect(browserDebug.status).toBe(403);
    expect(await browserDebug.json()).toMatchObject({ error: "debug_disabled" });

    // Admin bearer must be allowed /debug/events.
    daemon.database.sqlite.prepare("INSERT INTO auth_tokens (id, fingerprint, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)").run("token_debug_admin", "debug-admin", sha256("debug-admin"), JSON.stringify(["admin"]), 1);
    const adminDebug = await fetch(`${baseUrl}/debug/events`, { headers: { authorization: "Bearer debug-admin" } });
    expect(adminDebug.status).toBe(200);
  });

  it("exposes task HTTP routes through CommandBus and returns conflicts for invalid completion", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Tasks", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };

    const created = await fetch(`${baseUrl}/rooms/${room.data.roomId}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "HTTP task", assigneeAgentId: "mock-builder", idempotencyKey: "task-http-1" }) });
    const payload = await created.json() as { readonly ok: boolean; readonly data: { readonly taskId: string; readonly task: { readonly status: string } } };
    expect(created.status).toBe(201);
    expect(payload).toMatchObject({ ok: true, data: { task: { status: "pending" } } });

    const pendingConflict = await fetch(`${baseUrl}/tasks/${payload.data.taskId}/complete`, { method: "POST" });
    expect(pendingConflict.status).toBe(409);

    daemon.database.sqlite.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(payload.data.taskId);
    const completed = await fetch(`${baseUrl}/tasks/${payload.data.taskId}/complete`, { method: "POST" });
    expect(completed.status).toBe(200);
    const doneConflict = await fetch(`${baseUrl}/tasks/${payload.data.taskId}/complete`, { method: "POST" });
    expect(doneConflict.status).toBe(409);

    const listed = await fetch(`${baseUrl}/rooms/${room.data.roomId}/tasks`);
    const listedPayload = await listed.json() as { readonly tasks: readonly { readonly id: string; readonly status: string }[] };
    expect(listedPayload.tasks).toEqual([expect.objectContaining({ id: payload.data.taskId, status: "completed" })]);
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function seedBusyRun(roomId: string, agentId: string, runId: string, status = "running"): void {
  activeDaemon().database.sqlite.prepare(
    `INSERT INTO runs (
      id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id,
      parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version,
      target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens,
      cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at
    ) VALUES (?, 'default-workspace', NULL, ?, ?, NULL, NULL, NULL, NULL, ?, 'primary_turn', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
  ).run(runId, roomId, agentId, status, Date.now(), Date.now());
}

function seedPendingMessage(roomId: string, agentId: string, messageId: string, text: string): void {
  activeDaemon().database.sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'default-workspace', ?, 'user', 'local', NULL, 'user', 'completed', NULL, 'pending', ?, ?, ?, NULL)").run(messageId, roomId, messageId, Date.now(), Date.now());
  activeDaemon().database.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(messageId, JSON.stringify({ text }), Date.now());
  activeDaemon().database.sqlite.prepare("INSERT INTO pending_turns (id, room_id, user_message_id, primary_agent_id, status, enqueued_at, scheduled_at, cancelled_at, notes) VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL)").run(messageId, roomId, messageId, agentId, Date.now());
}

function activeDaemon(): DaemonApp {
  if (!currentDaemon) throw new Error("daemon is not initialized");
  return currentDaemon;
}

function messagePayload(daemon: DaemonApp, messageId: string, type: string): unknown {
  const row = daemon.database.sqlite.prepare("SELECT payload FROM events WHERE type = ? AND json_extract(payload, '$.messageId') = ? ORDER BY seq DESC LIMIT 1").get(type, messageId) as { readonly payload: string } | undefined;
  if (!row) throw new Error(`event ${type} for message ${messageId} not found`);
  return JSON.parse(row.payload) as unknown;
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

async function invokeHandler(daemon: DaemonApp, method: string, url: string): Promise<{ readonly status: number; readonly body: unknown }> {
  const { EventEmitter } = await import("node:events");
  const req = new EventEmitter() as Parameters<DaemonApp["handle"]>[0];
  req.method = method;
  req.url = url;
  req.headers = {};
  const chunks: Buffer[] = [];
  const res = new EventEmitter() as Parameters<DaemonApp["handle"]>[1] & { statusCode?: number; capturedHeaders?: unknown };
  res.writeHead = ((status: number, statusMessageOrHeaders?: unknown, headers?: unknown) => {
    res.statusCode = status;
    res.capturedHeaders = headers ?? statusMessageOrHeaders;
    return res;
  }) as typeof res.writeHead;
  res.write = (chunk: string | Buffer) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  };
  const ended = new Promise<void>((resolve) => {
    res.end = ((chunk?: unknown) => {
      if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      resolve();
      return res;
    }) as typeof res.end;
  });
  daemon.handle(req, res);
  await ended;
  return { status: res.statusCode ?? 200, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
}

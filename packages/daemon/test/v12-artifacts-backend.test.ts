import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDaemon, type DaemonApp } from "../src/index.ts";

let daemon: DaemonApp | undefined;
let baseUrl = "";
let workspaceRoot = "";

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "agenthub-v12-backend-"));
  workspaceRoot = join(dir, "workspace");
  mkdirSync(workspaceRoot, { recursive: true });
  daemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), workspaceRoot, port: 0, adapterCommands: { claude: { command: "" }, opencode: { command: "" } }, modelTestFetch: vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch });
  const server = await currentDaemon().start();
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("expected TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
  baseUrl = "";
  workspaceRoot = "";
});

describe("V1.2 artifact backend routes", () => {
  it("lists, diffs, restores, patches, and downloads artifact versions", async () => {
    const artifactId = seedTextArtifact("artifact_versions_route", "v1");

    const patched = await fetch(`${baseUrl}/artifacts/${artifactId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "v2", message: "second" }) });
    expect(patched.status).toBe(200);

    const versions = await (await fetch(`${baseUrl}/artifacts/${artifactId}/versions`)).json() as { readonly versions: readonly { readonly version: number }[] };
    expect(versions.versions.map((version) => version.version)).toEqual([2, 1]);

    const diff = await fetch(`${baseUrl}/artifacts/${artifactId}/versions/1/diff/2`);
    expect(diff.status).toBe(200);
    expect(await diff.text()).toContain("-v1");

    const restored = await fetch(`${baseUrl}/artifacts/${artifactId}/versions/1/restore`, { method: "POST" });
    expect(restored.status).toBe(200);
    expect(currentDaemon().database.sqlite.prepare("SELECT new_content FROM artifact_files WHERE artifact_id = ?").get(artifactId)).toMatchObject({ new_content: "v1" });

    const download = await fetch(`${baseUrl}/artifacts/${artifactId}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(await download.text()).toBe("v1");
  });

  it("pins and unpins messages with durable events in the same write path", async () => {
    const messageId = seedMessage("room_pin", "message_pin");

    const pinned = await fetch(`${baseUrl}/rooms/room_pin/messages/${messageId}/pin`, { method: "POST" });
    expect(pinned.status).toBe(200);
    expect(currentDaemon().database.sqlite.prepare("SELECT pinned_at FROM messages WHERE id = ?").get(messageId)).toMatchObject({ pinned_at: expect.any(Number) });
    expect(currentDaemon().database.sqlite.prepare("SELECT scope, pinned, content FROM context_items WHERE source_message_id = ?").get(messageId)).toMatchObject({ scope: "workspace", pinned: 1, content: "Pin this" });
    expect(currentDaemon().database.sqlite.prepare("SELECT type FROM events WHERE type = 'context.item.created' AND json_extract(payload, '$.contextId') IN (SELECT id FROM context_items WHERE source_message_id = ?)").get(messageId)).toBeDefined();
    expect(currentDaemon().database.sqlite.prepare("SELECT type FROM events WHERE type = 'message.pinned' AND json_extract(payload, '$.messageId') = ?").get(messageId)).toBeDefined();

    const unpinned = await fetch(`${baseUrl}/rooms/room_pin/messages/${messageId}/pin`, { method: "DELETE" });
    expect(unpinned.status).toBe(200);
    expect(currentDaemon().database.sqlite.prepare("SELECT pinned_at FROM messages WHERE id = ?").get(messageId)).toMatchObject({ pinned_at: null });
    expect(currentDaemon().database.sqlite.prepare("SELECT type FROM events WHERE type = 'message.unpinned' AND json_extract(payload, '$.messageId') = ?").get(messageId)).toBeDefined();
  });

  it("rejects room-scoped pin requests when the message belongs to a different room", async () => {
    const messageId = seedMessage("room_pin_owner", "message_pin_owner");
    currentDaemon().database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_pin_other', 'default-workspace', 'Other Room', 'assisted', 'conversation', 'agent', NULL, 1, 1)").run();

    const pinned = await fetch(`${baseUrl}/rooms/room_pin_other/messages/${messageId}/pin`, { method: "POST" });

    expect(pinned.status).toBe(404);
    expect(currentDaemon().database.sqlite.prepare("SELECT pinned_at FROM messages WHERE id = ?").get(messageId)).toMatchObject({ pinned_at: null });
  });

  it("filters the artifact library by room, kind, search text, and recent limit with metadata", async () => {
    seedTextArtifact("artifact_old_doc", "old", { roomId: "room_library", kind: "document", title: "Older doc", createdAt: 10, updatedAt: 10, metadata: { filename: "old.md", tag: "skip" } });
    seedTextArtifact("artifact_latest_doc", "latest", { roomId: "room_library", kind: "document", title: "Launch Plan", createdAt: 20, updatedAt: 30, metadata: { filename: "launch.md", tag: "release" } });
    seedTextArtifact("artifact_web", "<html></html>", { roomId: "room_library", kind: "web_page", title: "Launch Page", createdAt: 25, updatedAt: 25, metadata: { filename: "index.html" } });
    seedTextArtifact("artifact_other_room", "other", { roomId: "room_other", kind: "document", title: "Launch Other", createdAt: 40, updatedAt: 40, metadata: { filename: "other.md" } });

    const response = await fetch(`${baseUrl}/artifacts?roomId=room_library&kind=document&q=launch&limit=1`);
    const payload = await response.json() as { readonly artifacts: readonly { readonly id: string; readonly kind: string; readonly metadata: Record<string, unknown> }[] };

    expect(response.status).toBe(200);
    expect(payload.artifacts).toEqual([expect.objectContaining({ id: "artifact_latest_doc", kind: "document", metadata: expect.objectContaining({ filename: "launch.md", tag: "release" }) })]);
  });

  it("rejects inactive ppt proxy ports", async () => {
    const inactive = await fetch(`${baseUrl}/api/ppt-proxy/61234/`);
    expect(inactive.status).toBe(403);
  });

  it("proxies active ppt preview ports with navigation guard and Location rewrite", async () => {
    await currentDaemon().close();
    daemon = undefined;
    const upstream = await startPptPreviewUpstream();
    const dir = mkdtempSync(join(tmpdir(), "agenthub-v12-ppt-proxy-"));
    daemon = createDaemon({
      databasePath: join(dir, "agenthub.sqlite"),
      workspaceRoot: join(dir, "workspace"),
      port: 0,
      adapterCommands: { claude: { command: "" }, opencode: { command: "" } },
      modelTestFetch: vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch,
      pptPreviewBridge: {
        start: async () => ({ port: upstream.port, filePath: "deck.pptx", pid: 1, status: "ready" }),
        stop: async () => undefined,
        stopAll: async () => undefined,
        isActivePreviewPort: (port) => port === upstream.port
      }
    });
    const server = await currentDaemon().start();
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("expected TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const html = await fetch(`${baseUrl}/api/ppt-proxy/${upstream.port}/viewer`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain(`/api/ppt-proxy/${upstream.port}`);

    const redirect = await fetch(`${baseUrl}/api/ppt-proxy/${upstream.port}/redirect`, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`/api/ppt-proxy/${upstream.port}/next`);
    await upstream.close();
  });

  it("lists contacts and creates custom agents on roles plus agent_bindings", async () => {
    const runtimeId = seedRuntime("runtime_contacts", "opencode");

    const created = await fetch(`${baseUrl}/agents/custom`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Frontend Expert", runtimeId, systemPrompt: "Build web artifacts.", capabilities: ["chat"], description: "UI specialist" })
    });
    expect(created.status).toBe(201);
    const payload = await created.json() as { readonly agentBindingId: string };

    const contacts = await (await fetch(`${baseUrl}/agents/contacts`)).json() as { readonly contacts: readonly { readonly agentBindingId: string; readonly displayName: string; readonly runtimeKind: string; readonly status: string }[] };
    expect(contacts.contacts).toContainEqual(expect.objectContaining({ agentBindingId: payload.agentBindingId, displayName: "Frontend Expert", runtimeKind: "opencode", status: "available" }));

    const duplicate = await fetch(`${baseUrl}/agents/custom`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Frontend Expert", runtimeId, systemPrompt: "Again" }) });
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({ error: "agent_name_conflict" });
  });

  it("reports contacts offline when runtime health/status is unavailable unless the agent is busy", async () => {
    const offlineRuntimeId = seedRuntime("runtime_contacts_offline", "opencode", "unavailable");
    const busyRuntimeId = seedRuntime("runtime_contacts_busy", "opencode", "unavailable");
    const offline = await createCustomAgent("Offline Expert", offlineRuntimeId);
    const busy = await createCustomAgent("Busy Expert", busyRuntimeId);
    currentDaemon().database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_busy_contact', 'default-workspace', 'Busy Contact', 'assisted', 'conversation', 'agent', NULL, 1, 1)").run();
    currentDaemon().database.sqlite.prepare("INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES ('run_busy_contact', 'default-workspace', NULL, 'room_busy_contact', ?, 'opencode', NULL, NULL, NULL, 'running', 'manual', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 5, 5)").run(busy.agentBindingId);

    const health = await fetch(`${baseUrl}/runtimes/${offlineRuntimeId}/health`);
    const contacts = await (await fetch(`${baseUrl}/agents/contacts`)).json() as { readonly contacts: readonly { readonly agentBindingId: string; readonly status: string }[] };

    expect(health.status).toBe(503);
    expect(contacts.contacts).toContainEqual(expect.objectContaining({ agentBindingId: offline.agentBindingId, status: "offline" }));
    expect(contacts.contacts).toContainEqual(expect.objectContaining({ agentBindingId: busy.agentBindingId, status: "busy" }));
  });

  it("parses /create-agent prefill hints", async () => {
    seedRuntime("runtime_create_agent", "opencode");
    currentDaemon().database.sqlite.prepare("INSERT OR IGNORE INTO skills (id, workspace_id, name, description, content, origin, source_url, created_at, updated_at) VALUES ('skill_web_page', 'default-workspace', 'web-page-builder', 'Web pages', '---', 'builtin', NULL, 1, 1)").run();
    const skill = currentDaemon().database.sqlite.prepare("SELECT id FROM skills WHERE name = 'web-page-builder' LIMIT 1").get() as { readonly id: string };

    const response = await fetch(`${baseUrl}/create-agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "/create-agent create a frontend expert agent using OpenCode with web-page-builder skill" })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ draft: { name: "Frontend Expert Agent", runtimeId: "runtime_create_agent", skillIds: [skill.id] } });
  });
});

function currentDaemon(): DaemonApp {
  if (daemon === undefined) throw new Error("daemon missing");
  return daemon;
}

function seedTextArtifact(artifactId: string, content: string, options: { readonly roomId?: string; readonly kind?: string; readonly title?: string; readonly createdAt?: number; readonly updatedAt?: number; readonly metadata?: Record<string, unknown> } = {}): string {
  const db = currentDaemon().database.sqlite;
  const metadata = options.metadata ?? { filename: "doc.md" };
  const createdAt = options.createdAt ?? 1;
  const updatedAt = options.updatedAt ?? createdAt;
  if (options.roomId !== undefined) {
    db.prepare("INSERT OR IGNORE INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, 'default-workspace', 'Artifact Room', 'assisted', 'conversation', 'agent', NULL, 1, 1)").run(options.roomId);
  }
  db.prepare("INSERT INTO artifacts (id, workspace_id, room_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES (?, 'default-workspace', ?, 'file', ?, ?, 'draft', 'agent', ?, ?, ?)").run(artifactId, options.roomId ?? null, options.kind ?? "document", options.title ?? "Doc", JSON.stringify(metadata), createdAt, updatedAt);
  db.prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at, binary, mime_type, size_bytes) VALUES (?, ?, NULL, ?, NULL, 0, 0, 'modified', NULL, NULL, NULL, NULL, ?, 0, 'text/markdown', ?)").run(artifactId, typeof metadata.filename === "string" ? metadata.filename : "doc.md", content, createdAt, Buffer.byteLength(content));
  db.prepare("INSERT INTO artifact_versions (id, artifact_id, version, content, storage_path, content_encoding, metadata, created_at, created_by, message) VALUES (?, ?, 1, ?, NULL, 'text', ?, ?, 'agent', 'initial')").run(`${artifactId}_v1`, artifactId, content, JSON.stringify(metadata), createdAt);
  return artifactId;
}

function seedMessage(roomId: string, messageId: string): string {
  const db = currentDaemon().database.sqlite;
  db.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, 'default-workspace', 'Pinned Room', 'assisted', 'conversation', 'agent', NULL, 1, 1)").run(roomId);
  db.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'default-workspace', ?, 'user', 'local', NULL, 'user', 'completed', NULL, 'immediate', NULL, 1, 1, NULL)").run(messageId, roomId);
  db.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, 1)").run(messageId, JSON.stringify({ text: "Pin this" }));
  return messageId;
}

async function createCustomAgent(name: string, runtimeId: string): Promise<{ readonly agentBindingId: string; readonly roleId: string }> {
  const response = await fetch(`${baseUrl}/agents/custom`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, runtimeId, systemPrompt: "Build web artifacts.", capabilities: ["chat"] })
  });
  expect(response.status).toBe(201);
  return await response.json() as { readonly agentBindingId: string; readonly roleId: string };
}

function seedRuntime(runtimeId: string, kind: string, status = "available"): string {
  currentDaemon().database.sqlite.prepare("INSERT OR IGNORE INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, 'default-workspace', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, '[]', NULL, ?, '{}', 1, 1)").run(runtimeId, kind, kind, status);
  return runtimeId;
}

async function startPptPreviewUpstream(): Promise<{ readonly port: number; readonly close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/next" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body><a href=\"/next\">Next</a></body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("expected upstream TCP address");
  return { port: address.port, close: () => closeServer(server) };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

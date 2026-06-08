import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDaemon, type DaemonApp, type DaemonOptions } from "../src/index.ts";

let daemon: DaemonApp | undefined;
let baseUrl = "";

beforeEach(async () => {
  await startTestDaemon("agenthub-v12-backend-");
});

afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
  baseUrl = "";
});

describe("V1.2 artifact backend routes", () => {
  it("recognizes fetch-forbidden ports before creating test base URLs", () => {
    expect(isFetchForbiddenPort(21)).toBe(true);
    expect(isFetchForbiddenPort(6000)).toBe(true);
    expect(isFetchForbiddenPort(49152)).toBe(false);
  });

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
    expect(currentDaemon().database.sqlite.prepare("SELECT COUNT(*) AS count FROM context_items WHERE source_message_id = ? AND pinned = 1").get(messageId)).toMatchObject({ count: 0 });
    expect(currentDaemon().database.sqlite.prepare("SELECT type FROM events WHERE type = 'message.pinned' AND json_extract(payload, '$.messageId') = ?").get(messageId)).toBeDefined();

    const unpinned = await fetch(`${baseUrl}/rooms/room_pin/messages/${messageId}/pin`, { method: "DELETE" });
    expect(unpinned.status).toBe(200);
    expect(currentDaemon().database.sqlite.prepare("SELECT pinned_at FROM messages WHERE id = ?").get(messageId)).toMatchObject({ pinned_at: null });
    expect(currentDaemon().database.sqlite.prepare("SELECT COUNT(*) AS count FROM context_items WHERE source_message_id = ? AND pinned = 1").get(messageId)).toMatchObject({ count: 0 });
    expect(currentDaemon().database.sqlite.prepare("SELECT type FROM events WHERE type = 'message.unpinned' AND json_extract(payload, '$.messageId') = ?").get(messageId)).toBeDefined();
  });

  it("keeps legacy PinMessage command publishing the message.pinned event contract", async () => {
    const messageId = seedMessage("room_pin_command", "message_pin_command");

    const result = await currentDaemon().commandBus.dispatch(
      { type: "PinMessage", messageId, idempotencyKey: "pin-command-v12" },
      { actor: { type: "user", id: "local" }, traceId: "trace-pin-command-v12", origin: "http" }
    );

    expect(result).toMatchObject({ ok: true });
    expect(currentDaemon().database.sqlite.prepare("SELECT pinned_at FROM messages WHERE id = ?").get(messageId)).toMatchObject({ pinned_at: expect.any(Number) });
    expect(currentDaemon().database.sqlite.prepare("SELECT type FROM events WHERE type = 'message.pinned' AND json_extract(payload, '$.messageId') = ?").get(messageId)).toBeDefined();
  });

  it("emits structured mention objects in message.created while preserving routing by binding id", async () => {
    const runtimeId = seedRuntime("runtime_mentions", "opencode");
    const created = await createCustomAgent("Mention Expert", runtimeId);
    currentDaemon().database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_mentions', 'default-workspace', 'Mention Room', 'assisted', ?, ?, NULL, 1, 1)").run("conversation", created.agentBindingId);
    currentDaemon().database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_mentions', ?, 'agent', 'primary', 'opencode', NULL, ?, 'active', 1)").run(created.agentBindingId, created.agentBindingId);

    const response = await fetch(`${baseUrl}/rooms/room_mentions/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `@"Mention Expert" please inspect this`, mentions: [created.agentBindingId] })
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { readonly data?: { readonly messageId?: string } };
    const event = currentDaemon().database.sqlite.prepare("SELECT payload FROM events WHERE type = 'message.created' AND json_extract(payload, '$.messageId') = ?").get(payload.data?.messageId) as { readonly payload: string } | undefined;

    expect(event).toBeDefined();
    expect(JSON.parse(event?.payload ?? "{}")).toMatchObject({
      messageId: payload.data?.messageId,
      mentions: [{ agentBindingId: created.agentBindingId }]
    });
  });

  it("preserves structured context refs in message parts and durable message events", async () => {
    currentDaemon().database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_refs', 'default-workspace', 'Refs Room', 'assisted', 'conversation', 'agent', NULL, 1, 1)").run();

    const refs = [
      { type: "artifact", artifactId: "artifact_1", lineStart: 2, lineEnd: 3 },
      { type: "workspace", path: "src/app.ts", lineStart: 10, lineEnd: 12 }
    ] as const;
    const response = await fetch(`${baseUrl}/rooms/room_refs/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Fix @artifact:artifact_1#L2-L3 and @workspace:src/app.ts#L10-L12", refs })
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { readonly data?: { readonly messageId?: string } };
    const messageId = payload.data?.messageId ?? "";
    const part = currentDaemon().database.sqlite.prepare("SELECT payload FROM message_parts WHERE message_id = ? AND part_type = 'text'").get(messageId) as { readonly payload: string } | undefined;
    const createdEvent = currentDaemon().database.sqlite.prepare("SELECT payload FROM events WHERE type = 'message.created' AND json_extract(payload, '$.messageId') = ?").get(messageId) as { readonly payload: string } | undefined;
    const completedEvent = currentDaemon().database.sqlite.prepare("SELECT payload FROM events WHERE type = 'message.completed' AND json_extract(payload, '$.messageId') = ?").get(messageId) as { readonly payload: string } | undefined;

    expect(JSON.parse(part?.payload ?? "{}")).toMatchObject({ refs });
    expect(JSON.parse(createdEvent?.payload ?? "{}")).toMatchObject({ refs });
    expect(JSON.parse(completedEvent?.payload ?? "{}")).toMatchObject({ refs });
  });

  it("preserves quotedMessageId for reply actions in storage and message.created replay payload", async () => {
    const quotedMessageId = seedMessage("room_reply_action", "message_reply_source");

    const response = await fetch(`${baseUrl}/rooms/room_reply_action/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Replying with context", quotedMessageId })
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { readonly data?: { readonly messageId?: string } };
    const messageId = payload.data?.messageId ?? "";
    expect(currentDaemon().database.sqlite.prepare("SELECT quoted_message_id FROM messages WHERE id = ?").get(messageId)).toMatchObject({ quoted_message_id: quotedMessageId });
    const event = currentDaemon().database.sqlite.prepare("SELECT payload FROM events WHERE type = 'message.created' AND json_extract(payload, '$.messageId') = ?").get(messageId) as { readonly payload: string } | undefined;
    expect(JSON.parse(event?.payload ?? "{}")).toMatchObject({ messageId, quotedMessageId });
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

  it("returns the expanded artifact library shape for recent artifacts without query filters", async () => {
    seedTextArtifact("artifact_recent_shape", "recent", { roomId: "room_library_shape", kind: "document", title: "Shape Doc", createdAt: 30, updatedAt: 50, metadata: { filename: "shape.md" } });

    const response = await fetch(`${baseUrl}/artifacts?roomId=room_library_shape`);
    const payload = await response.json() as { readonly artifacts: readonly Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(payload.artifacts).toEqual([
      expect.objectContaining({
        id: "artifact_recent_shape",
        kind: "document",
        title: "Shape Doc",
        filename: "shape.md",
        latestVersion: 1,
        updatedAt: 50,
        roomId: "room_library_shape",
        createdBy: "agent",
        mimeType: "text/markdown",
        sizeBytes: Buffer.byteLength("recent")
      })
    ]);
  });

  it("returns deterministic primary file metadata for multi-file artifact library rows", async () => {
    seedTextArtifact("artifact_multi_file_shape", "secondary", { roomId: "room_multi_file_shape", kind: "document", title: "Multi File Doc", createdAt: 30, updatedAt: 50, metadata: { filename: "z-secondary.md" } });
    const db = currentDaemon().database.sqlite;
    db.prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at, binary, mime_type, size_bytes) VALUES ('artifact_multi_file_shape', 'a-primary.md', NULL, 'primary', NULL, 0, 0, 'modified', NULL, NULL, NULL, NULL, 31, 0, 'text/markdown', 7)").run();

    const response = await fetch(`${baseUrl}/artifacts?roomId=room_multi_file_shape`);
    const payload = await response.json() as { readonly artifacts: readonly Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(payload.artifacts).toEqual([
      expect.objectContaining({
        id: "artifact_multi_file_shape",
        filename: "a-primary.md",
        mimeType: "text/markdown",
        sizeBytes: 7
      })
    ]);
  });

  it("returns room list rows with camelCase pin/activity fields and contact names", async () => {
    const db = currentDaemon().database.sqlite;
    seedRuntime("runtime_room_list", "opencode");
    db.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES ('role_room_list', 'default-workspace', 'Room Specialist', NULL, NULL, 'Prompt', '[]', NULL, NULL, 0, NULL, NULL, 1, 1)").run();
    db.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, avatar_url, contact_name, contact_description, created_at, updated_at) VALUES ('binding_room_list', 'default-workspace', 'role_room_list', 'runtime_room_list', NULL, NULL, NULL, 'Contact Name', NULL, 1, 1)").run();
    db.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, pinned_at, last_activity_at, created_at, updated_at) VALUES ('room_list_shape', 'default-workspace', 'Pinned Room', 'assisted', 'conversation', 'binding_room_list', NULL, 123, 456, 1, 2)").run();
    db.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_list_shape', 'binding_room_list', 'agent', 'primary', 'opencode', NULL, 'binding_room_list', 'active', 1)").run();

    const response = await fetch(`${baseUrl}/rooms?q=Contact`);
    const payload = await response.json() as { readonly rooms: readonly Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(payload.rooms).toContainEqual(expect.objectContaining({
      id: "room_list_shape",
      workspaceId: "default-workspace",
      pinnedAt: 123,
      lastActivityAt: 456,
      participantContactNames: ["Contact Name"]
    }));
    const room = payload.rooms.find((item) => item.id === "room_list_shape");
    expect(room).not.toHaveProperty("pinned_at");
    expect(room).not.toHaveProperty("last_activity_at");
  });

  it("rejects inactive ppt proxy ports", async () => {
    const inactive = await fetch(`${baseUrl}/api/ppt-proxy/61234/`);
    expect(inactive.status).toBe(403);
  });

  it("proxies active ppt preview ports with navigation guard and Location rewrite", async () => {
    await currentDaemon().close();
    daemon = undefined;
    const upstream = await startPptPreviewUpstream();
    await startTestDaemon("agenthub-v12-ppt-proxy-", {
      pptPreviewBridge: {
        start: async () => ({ port: upstream.port, filePath: "deck.pptx", pid: 1, status: "ready" }),
        stop: async () => undefined,
        stopAll: async () => undefined,
        isActivePreviewPort: (port) => port === upstream.port
      }
    });

    const html = await fetch(`${baseUrl}/api/ppt-proxy/${upstream.port}/viewer`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain(`/api/ppt-proxy/${upstream.port}`);

    const redirect = await fetch(`${baseUrl}/api/ppt-proxy/${upstream.port}/redirect`, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`/api/ppt-proxy/${upstream.port}/next`);
    await upstream.close();
  });

  it("starts an active ppt preview session for binary PPTX artifacts", async () => {
    await currentDaemon().close();
    daemon = undefined;
    const startedFiles: string[] = [];
    const stoppedPorts: number[] = [];
    await startTestDaemon("agenthub-v12-ppt-preview-start-", {
      pptPreviewBridge: {
        start: async (filePath) => {
          startedFiles.push(filePath);
          return { port: 61241, filePath, pid: 1, status: "ready" };
        },
        stop: async (port) => {
          stoppedPorts.push(port);
        },
        stopAll: async () => undefined,
        isActivePreviewPort: (port) => port === 61241
      }
    });
    const artifactId = seedBinaryArtifact("artifact_ppt_preview_start", "deck.pptx", "pptx-bytes");

    const response = await fetch(`${baseUrl}/artifacts/${artifactId}/ppt-preview`, { method: "POST" });
    const payload = await response.json() as { readonly port?: number; readonly previewUrl?: string };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ port: 61241, previewUrl: "/api/ppt-proxy/61241/" });
    expect(startedFiles).toEqual([expect.stringContaining("deck.pptx")]);

    const stopped = await fetch(`${baseUrl}/artifacts/${artifactId}/ppt-preview/61241`, { method: "DELETE" });
    expect(stopped.status).toBe(200);
    expect(stoppedPorts).toEqual([61241]);
  });

  it("rejects ppt preview startup for text artifacts", async () => {
    const artifactId = seedTextArtifact("artifact_text_preview_rejected", "not binary", { kind: "document" });

    const response = await fetch(`${baseUrl}/artifacts/${artifactId}/ppt-preview`, { method: "POST" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "artifact_not_pptx" });
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

    const contacts = await (await fetch(`${baseUrl}/agents/contacts`)).json() as { readonly contacts: readonly { readonly agentBindingId: string; readonly displayName: string; readonly runtimeId: string; readonly modelConfigId?: string; readonly runtimeKind: string; readonly status: string }[] };
    expect(contacts.contacts).toContainEqual(expect.objectContaining({ agentBindingId: payload.agentBindingId, displayName: "Frontend Expert", runtimeId, runtimeKind: "opencode", status: "available" }));

    const duplicate = await fetch(`${baseUrl}/agents/custom`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Frontend Expert", runtimeId, systemPrompt: "Again" }) });
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({ error: "agent_name_conflict" });
  });

  it("updates and disables contacts through /agents/contacts routes with persistent disabled_at state", async () => {
    const runtimeId = seedRuntime("runtime_contact_update", "opencode");
    const created = await createCustomAgent("Editable Expert", runtimeId);

    const updated = await fetch(`${baseUrl}/agents/contacts/${created.agentBindingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed Expert", description: "Updated contact", avatarUrl: "agenthub://avatar/renamed" })
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ agentBindingId: created.agentBindingId });

    let contacts = await (await fetch(`${baseUrl}/agents/contacts`)).json() as { readonly contacts: readonly Record<string, unknown>[] };
    expect(contacts.contacts).toContainEqual(expect.objectContaining({
      agentBindingId: created.agentBindingId,
      displayName: "Renamed Expert",
      description: "Updated contact",
      avatarUrl: "agenthub://avatar/renamed"
    }));

    const deleted = await fetch(`${baseUrl}/agents/contacts/${created.agentBindingId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(currentDaemon().database.sqlite.prepare("SELECT disabled_at, contact_description FROM agent_bindings WHERE id = ?").get(created.agentBindingId)).toMatchObject({ disabled_at: expect.any(Number), contact_description: "Updated contact" });
    expect(currentDaemon().database.sqlite.prepare("SELECT type FROM events WHERE type = 'agent.contact.updated' AND json_extract(payload, '$.agentBindingId') = ? AND json_extract(payload, '$.disabledAt') IS NOT NULL").get(created.agentBindingId)).toBeDefined();

    contacts = await (await fetch(`${baseUrl}/agents/contacts`)).json() as { readonly contacts: readonly Record<string, unknown>[] };
    expect(contacts.contacts.some((contact) => contact.agentBindingId === created.agentBindingId)).toBe(false);
  });

  it("publishes explicit nulls when clearing contact avatar and description", async () => {
    const runtimeId = seedRuntime("runtime_contact_clear", "opencode");
    const created = await createCustomAgent("Clearable Expert", runtimeId);

    const populated = await fetch(`${baseUrl}/agents/contacts/${created.agentBindingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Has description", avatarUrl: "agenthub://avatar/clearable" })
    });
    expect(populated.status).toBe(200);

    const cleared = await fetch(`${baseUrl}/agents/contacts/${created.agentBindingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: null, avatarUrl: null })
    });
    expect(cleared.status).toBe(200);

    const event = currentDaemon().database.sqlite.prepare("SELECT payload FROM events WHERE type = 'agent.contact.updated' AND json_extract(payload, '$.agentBindingId') = ? ORDER BY seq DESC LIMIT 1").get(created.agentBindingId) as { readonly payload: string } | undefined;
    expect(JSON.parse(event?.payload ?? "{}")).toMatchObject({
      agentBindingId: created.agentBindingId,
      avatarUrl: null,
      description: null
    });
  });

  it("allows recreating a disabled contact name and rejects disabled bindings as new room participants", async () => {
    const runtimeId = seedRuntime("runtime_disabled_contact", "opencode");
    const disabled = await createCustomAgent("Reusable Expert", runtimeId);

    const deleted = await fetch(`${baseUrl}/agents/contacts/${disabled.agentBindingId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);

    const recreated = await fetch(`${baseUrl}/agents/custom`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Reusable Expert", runtimeId, systemPrompt: "Build again." })
    });
    expect(recreated.status).toBe(201);

    const db = currentDaemon().database.sqlite;
    db.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_disabled_participant', 'default-workspace', 'Disabled Participant', 'assisted', 'conversation', 'agent', NULL, 1, 1)").run();
    const added = await fetch(`${baseUrl}/rooms/room_disabled_participant/participants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentBindingId: disabled.agentBindingId })
    });

    expect(added.status).toBe(400);
    await expect(added.json()).resolves.toMatchObject({ error: { code: "validation_failed" } });
  });

  it("rejects disabled contact bindings during room creation", async () => {
    const runtimeId = seedRuntime("runtime_disabled_room_primary", "opencode");
    const disabled = await createCustomAgent("Disabled Primary", runtimeId);
    const deleted = await fetch(`${baseUrl}/agents/contacts/${disabled.agentBindingId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const title = "Disabled Primary Room";

    const byPrimaryId = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, mode: "assisted", primaryAgentId: disabled.agentBindingId })
    });

    expect(byPrimaryId.status).toBe(400);
    await expect(byPrimaryId.json()).resolves.toMatchObject({ error: { code: "validation_failed", message: "agent_binding_disabled" } });
    expect(currentDaemon().database.sqlite.prepare("SELECT id FROM rooms WHERE title = ?").get(title)).toBeUndefined();
    expect(currentDaemon().database.sqlite.prepare("SELECT id FROM events WHERE type = 'room.created' AND json_extract(payload, '$.title') = ?").get(title)).toBeUndefined();
  });

  it("uses the contact binding runtime when creating a room from an agentBindingId", async () => {
    const runtimeId = seedRuntime("runtime_contact_start_chat", "opencode");
    const created = await createCustomAgent("Contact Starter", runtimeId);

    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Contact Start Chat",
        mode: "assisted",
        primaryAgentId: created.agentBindingId,
        agentBindingId: created.agentBindingId
      })
    });
    const payload = await response.json() as { readonly data?: { readonly roomId?: string } };

    expect(response.status).toBe(201);
    expect(currentDaemon().database.sqlite.prepare("SELECT primary_agent_id FROM rooms WHERE id = ?").get(payload.data?.roomId)).toMatchObject({ primary_agent_id: created.agentBindingId });
    expect(currentDaemon().database.sqlite.prepare("SELECT participant_id, agent_binding_id, adapter_id, default_presence FROM room_participants WHERE room_id = ? AND role = 'primary'").get(payload.data?.roomId)).toMatchObject({
      participant_id: created.agentBindingId,
      agent_binding_id: created.agentBindingId,
      adapter_id: "opencode",
      default_presence: "active"
    });
    const joinedEvent = currentDaemon().database.sqlite.prepare("SELECT payload FROM events WHERE room_id = ? AND type = 'agent.joined' AND json_extract(payload, '$.agentId') = ?").get(payload.data?.roomId, created.agentBindingId) as { readonly payload: string } | undefined;
    expect(JSON.parse(joinedEvent?.payload ?? "{}")).toMatchObject({
      agentId: created.agentBindingId,
      adapterId: "opencode"
    });
  });

  it("keeps the explicit contact primary when creating a team room with contact teammates", async () => {
    const runtimeId = seedRuntime("runtime_contact_team", "opencode");
    const leader = await createCustomAgent("Contact Team Lead", runtimeId);
    const teammate = await createCustomAgent("Contact Teammate", runtimeId);

    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Contact Team Room",
        mode: "team",
        primaryAgentId: leader.agentBindingId,
        agentBindingId: leader.agentBindingId,
        leaderRoleId: leader.roleId,
        participants: [{
          type: "agent",
          agentId: teammate.agentBindingId,
          agentBindingId: teammate.agentBindingId,
          role: "teammate",
          defaultPresence: "active"
        }]
      })
    });
    const payload = await response.json() as { readonly data?: { readonly roomId?: string; readonly agentBindingId?: string } };

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({ agentBindingId: leader.agentBindingId });
    expect(currentDaemon().database.sqlite.prepare("SELECT primary_agent_id, leader_role_id FROM rooms WHERE id = ?").get(payload.data?.roomId)).toMatchObject({
      primary_agent_id: leader.agentBindingId,
      leader_role_id: leader.roleId
    });
    expect(currentDaemon().database.sqlite.prepare("SELECT agent_binding_id, role FROM room_participants WHERE room_id = ? ORDER BY role").all(payload.data?.roomId)).toEqual([
      { agent_binding_id: leader.agentBindingId, role: "primary" },
      { agent_binding_id: teammate.agentBindingId, role: "teammate" }
    ]);
  });

  it("honors contact-first presence and participant skill assignments during room creation", async () => {
    const runtimeId = seedRuntime("runtime_contact_config", "opencode");
    const leader = await createCustomAgent("Configurable Lead", runtimeId);
    const teammate = await createCustomAgent("Configurable Teammate", runtimeId);
    const db = currentDaemon().database.sqlite;
    db.prepare("INSERT OR IGNORE INTO skills (id, workspace_id, name, description, content, origin, source_url, created_at, updated_at) VALUES ('skill_contact_review', 'default-workspace', 'contact-review', 'Review contact output', '---', 'workspace', NULL, 1, 1)").run();

    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Configured Contact Room",
        mode: "team",
        primaryAgentId: leader.agentBindingId,
        agentBindingId: leader.agentBindingId,
        leaderRoleId: leader.roleId,
        participants: [
          {
            type: "agent",
            agentId: leader.agentBindingId,
            agentBindingId: leader.agentBindingId,
            role: "primary",
            defaultPresence: "observing"
          },
          {
            type: "agent",
            agentId: teammate.agentBindingId,
            agentBindingId: teammate.agentBindingId,
            role: "teammate",
            defaultPresence: "observing"
          }
        ],
        participantSkillAssignments: [
          {
            participantId: teammate.agentBindingId,
            skillIds: ["skill_contact_review"],
            mode: "add"
          }
        ]
      })
    });
    const payload = await response.json() as { readonly data?: { readonly roomId?: string } };

    expect(response.status).toBe(201);
    expect(db.prepare("SELECT default_presence FROM room_participants WHERE room_id = ? AND participant_id = ?").get(payload.data?.roomId, leader.agentBindingId)).toMatchObject({ default_presence: "observing" });
    expect(db.prepare("SELECT default_presence FROM room_participants WHERE room_id = ? AND participant_id = ?").get(payload.data?.roomId, teammate.agentBindingId)).toMatchObject({ default_presence: "observing" });
    expect(db.prepare("SELECT mode FROM agent_skills WHERE room_participant_id = ? AND skill_id = 'skill_contact_review'").get(`${payload.data?.roomId}:${teammate.agentBindingId}`)).toMatchObject({ mode: "add" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = ? AND type = 'skill.activated' AND json_extract(payload, '$.participantId') = ?").get(payload.data?.roomId, teammate.agentBindingId)).toMatchObject({ count: 1 });
  });

  it("rejects disabled role/runtime bindings as initial room participants", async () => {
    const runtimeId = seedRuntime("runtime_disabled_room_participant", "opencode");
    const disabled = await createCustomAgent("Disabled Participant", runtimeId);
    const binding = currentDaemon().database.sqlite.prepare("SELECT role_id FROM agent_bindings WHERE id = ?").get(disabled.agentBindingId) as { readonly role_id: string };
    const deleted = await fetch(`${baseUrl}/agents/contacts/${disabled.agentBindingId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const title = "Disabled Role Runtime Room";

    const byRoleRuntime = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        mode: "assisted",
        primaryAgentId: "mock-builder",
        participants: [{ roleId: binding.role_id, runtimeId, role: "teammate", defaultPresence: "active" }]
      })
    });

    expect(byRoleRuntime.status).toBe(400);
    await expect(byRoleRuntime.json()).resolves.toMatchObject({ error: { code: "validation_failed", message: "agent_binding_disabled" } });
    expect(currentDaemon().database.sqlite.prepare("SELECT id FROM rooms WHERE title = ?").get(title)).toBeUndefined();
    expect(currentDaemon().database.sqlite.prepare("SELECT id FROM events WHERE type = 'room.created' AND json_extract(payload, '$.title') = ?").get(title)).toBeUndefined();
  });

  it("does not reject an unused disabled mock-builder fallback when role/runtime participants choose the primary", async () => {
    const db = currentDaemon().database.sqlite;
    const disabledRuntimeId = seedRuntime("runtime_disabled_mock_builder", "opencode");
    const disabledMockBuilder = await createCustomAgent("Disabled Mock Builder", disabledRuntimeId);
    db.prepare("UPDATE agent_bindings SET id = 'mock-builder' WHERE id = ?").run(disabledMockBuilder.agentBindingId);
    const deleted = await fetch(`${baseUrl}/agents/contacts/mock-builder`, { method: "DELETE" });
    expect(deleted.status).toBe(200);

    const activeRuntimeId = seedRuntime("runtime_active_team_leader", "opencode");
    const active = await createCustomAgent("Active Team Leader", activeRuntimeId);
    const activeBinding = db.prepare("SELECT role_id FROM agent_bindings WHERE id = ?").get(active.agentBindingId) as { readonly role_id: string };

    const created = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Active Leader Ignores Disabled Fallback",
        mode: "team",
        leaderRoleId: activeBinding.role_id,
        participants: [{ roleId: activeBinding.role_id, runtimeId: activeRuntimeId, role: "primary", defaultPresence: "active" }]
      })
    });
    const payload = await created.json() as { readonly data?: { readonly roomId?: string }; readonly error?: unknown };

    expect(created.status).toBe(201);
    expect(payload.data?.roomId).toEqual(expect.any(String));
    expect(db.prepare("SELECT primary_agent_id FROM rooms WHERE id = ?").get(payload.data?.roomId)).toMatchObject({ primary_agent_id: active.agentBindingId });
  });

  it("accepts POST runtime health checks for contact connection tests", async () => {
    const runtimeId = seedRuntime("runtime_post_health", "opencode");

    const response = await fetch(`${baseUrl}/runtimes/${runtimeId}/health`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, runtimeId, status: "available" });
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

async function startTestDaemon(prefix: string, overrides: Partial<DaemonOptions> = {}): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    const nextWorkspaceRoot = join(dir, "workspace");
    mkdirSync(nextWorkspaceRoot, { recursive: true });
    const nextDaemon = createDaemon({
      databasePath: join(dir, "agenthub.sqlite"),
      workspaceRoot: nextWorkspaceRoot,
      port: 0,
      adapterCommands: { claude: { command: "" }, opencode: { command: "" } },
      modelTestFetch: vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch,
      ...overrides
    });
    const server = await nextDaemon.start();
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      await nextDaemon.close();
      throw new Error("expected TCP address");
    }
    if (isFetchForbiddenPort(address.port)) {
      await nextDaemon.close();
      continue;
    }
    daemon = nextDaemon;
    baseUrl = `http://127.0.0.1:${address.port}`;
    return;
  }
  throw new Error("failed to start daemon on a fetch-safe port");
}

function isFetchForbiddenPort(port: number): boolean {
  if (port >= 6665 && port <= 6669) return true;
  return FETCH_FORBIDDEN_PORTS.has(port);
}

const FETCH_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6697, 10080
]);

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

function seedBinaryArtifact(artifactId: string, filename: string, content: string): string {
  const db = currentDaemon().database.sqlite;
  const createdAt = 100;
  const bytes = Buffer.from(content);
  mkdirSync(join(tmpdir(), "agenthub-v12-binary-artifacts"), { recursive: true });
  const controlledPath = join(tmpdir(), "agenthub-v12-binary-artifacts", `${artifactId}-${filename}`);
  writeFileSync(controlledPath, bytes);
  db.prepare("INSERT OR IGNORE INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_binary_artifact', 'default-workspace', 'Binary Artifact Room', 'solo', 'conversation', 'agent', NULL, 1, 1)").run();
  db.prepare("INSERT INTO artifacts (id, workspace_id, room_id, task_id, run_id, message_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES (?, 'default-workspace', 'room_binary_artifact', NULL, NULL, NULL, 'file', 'presentation_pptx', ?, 'ready', 'agent', ?, ?, ?)").run(artifactId, filename, JSON.stringify({ filename }), createdAt, createdAt);
  db.prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at, binary, mime_type, size_bytes) VALUES (?, ?, NULL, NULL, NULL, 0, 0, 'modified', NULL, NULL, NULL, ?, ?, 1, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ?)").run(artifactId, filename, controlledPath, createdAt, bytes.byteLength);
  db.prepare("INSERT INTO artifact_versions (id, artifact_id, version, content, storage_path, content_encoding, metadata, created_at, created_by, message) VALUES (?, ?, 1, NULL, ?, 'binary', ?, ?, 'agent', 'initial binary')").run(`${artifactId}_v1`, artifactId, controlledPath, JSON.stringify({ filename, sizeBytes: bytes.byteLength }), createdAt);
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

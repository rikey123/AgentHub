import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CommandBus, EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { RoomMcpServer, TaskService } from "../src/index.ts";
import { ArtifactService, createArtifactVersioningService } from "../../artifacts/src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let artifactService: ArtifactService | undefined;
let server: RoomMcpServer | undefined;
let now = 10_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-room-file-message-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  artifactService = new ArtifactService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
  server = createServer();
  seedWorkspace();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  artifactService = undefined;
  server = undefined;
  now = 10_000;
});

describe("RoomMcpServer room.send_file_message", () => {
  test("publishes text artifacts with an initial version and message part", async () => {
    const result = await currentServer().callTool("room.publish_artifact", {
      kind: "document",
      filename: "brief.md",
      title: "Brief",
      content: "# Brief"
    }, session());

    expect(result).toMatchObject({ ok: true, data: { kind: "document", version: 1, messageId: "msg_run_1" } });
    const artifactId = result.ok && typeof result.data === "object" && result.data !== null ? (result.data as { artifactId: string }).artifactId : "";
    expect(currentDatabase().sqlite.prepare("SELECT kind FROM artifacts WHERE id = ?").get(artifactId)).toMatchObject({ kind: "document" });
    expect(currentDatabase().sqlite.prepare("SELECT version, content FROM artifact_versions WHERE artifact_id = ?").get(artifactId)).toMatchObject({ version: 1, content: "# Brief" });
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'artifact.version.created' AND json_extract(payload, '$.artifactId') = ?").get(artifactId)).toBeDefined();
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'message.part.added' AND json_extract(payload, '$.part.artifactId') = ?").get(artifactId)).toBeDefined();
  });

  test("updates an existing artifact through publish_artifact when artifactId is provided", async () => {
    const first = await currentServer().callTool("room.publish_artifact", {
      kind: "document",
      filename: "brief.md",
      title: "Brief",
      content: "# Brief v1"
    }, session());
    expect(first).toMatchObject({ ok: true });
    const artifactId = first.ok && typeof first.data === "object" && first.data !== null ? (first.data as { artifactId: string }).artifactId : "";
    now += 1;

    const updated = await currentServer().callTool("room.publish_artifact", {
      artifactId,
      kind: "document",
      filename: "brief.md",
      title: "Brief",
      content: "# Brief v2",
      message: "revise existing"
    }, session());

    expect(updated).toMatchObject({ ok: true, data: { artifactId, kind: "document", version: 2, messageId: "msg_run_1" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE id = ?").get(artifactId)).toMatchObject({ count: 1 });
    expect(currentDatabase().sqlite.prepare("SELECT version, content, message FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC LIMIT 1").get(artifactId)).toMatchObject({ version: 2, content: "# Brief v2", message: "revise existing" });
    const parts = currentDatabase().sqlite.prepare("SELECT payload FROM message_parts WHERE part_type = 'artifact' ORDER BY seq ASC").all() as Array<{ readonly payload: string }>;
    expect(parts.map((part) => JSON.parse(part.payload).artifactId as string)).toEqual([artifactId, artifactId]);
  });

  test("rejects publish_artifact input that includes both content and filePath", async () => {
    const result = await currentServer().callTool("room.publish_artifact", {
      kind: "presentation_pptx",
      filename: "deck.pptx",
      content: "not binary",
      filePath: "deck.pptx"
    }, session());

    expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toMatchObject({ count: 0 });
  });

  test("rejects publish_artifact filePath traversal before creating artifacts", async () => {
    const result = await currentServer().callTool("room.publish_artifact", {
      kind: "presentation_pptx",
      filename: "deck.pptx",
      filePath: "../deck.pptx"
    }, session());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toMatchObject({ count: 0 });
  });

  test("rolls back publish_artifact artifact version when message part publish fails", async () => {
    const throwingBus = currentBus();
    const originalPublish = throwingBus.publish.bind(throwingBus);
    throwingBus.publish = ((input) => {
      if (input.type === "message.part.added") throw new Error("message part failed");
      return originalPublish(input);
    }) as EventBus["publish"];

    await expect(currentServer().callTool("room.publish_artifact", {
      kind: "document",
      filename: "brief.md",
      title: "Brief",
      content: "# Brief"
    }, session())).rejects.toThrow("message part failed");

    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toMatchObject({ count: 0 });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get()).toMatchObject({ count: 0 });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM message_parts WHERE part_type = 'artifact'").get()).toMatchObject({ count: 0 });
  });

  test("creates an artifact-backed attachment message part from content", async () => {
    const content = "# Architecture\n\nSplit the platform into three planes.\n";
    const result = await currentServer().callTool("room.send_file_message", {
      fileName: "multi-agent-platform-architecture.md",
      title: "Multi-agent platform architecture",
      mimeType: "text/markdown",
      summary: "Control plane, execution plane, and data plane.",
      content
    }, session());

    expect(result).toMatchObject({
      ok: true,
      data: {
        messageId: "msg_run_1",
        fileName: "multi-agent-platform-architecture.md",
        path: "multi-agent-platform-architecture.md",
        mimeType: "text/markdown",
        sizeBytes: Buffer.byteLength(content, "utf8")
      }
    });
    expect(currentDatabase().sqlite.prepare("SELECT last_activity_at FROM rooms WHERE id = 'room_1'").get()).toMatchObject({ last_activity_at: now });
    const artifactId = result.ok && typeof result.data === "object" && result.data !== null ? (result.data as { artifactId: string }).artifactId : "";
    expect(artifactId).toMatch(/[0-9a-f-]{36}/);

    expect(currentArtifactService().fileContent(artifactId, "multi-agent-platform-architecture.md")?.content).toBe(content);

    const parts = currentDatabase().sqlite.prepare("SELECT seq, part_type, payload FROM message_parts WHERE message_id = 'msg_run_1' ORDER BY seq").all() as Array<{ readonly seq: number; readonly part_type: string; readonly payload: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0]?.part_type).toBe("attachment");
    expect(JSON.parse(parts[0]?.payload ?? "{}")).toMatchObject({
      fileId: artifactId,
      name: "multi-agent-platform-architecture.md",
      mimeType: "text/markdown",
      sizeBytes: Buffer.byteLength(content, "utf8"),
      artifactId,
      path: "multi-agent-platform-architecture.md",
      previewKind: "markdown"
    });

    const events = currentDatabase().sqlite.prepare("SELECT type, payload FROM events WHERE type IN ('artifact.file.created', 'message.part.added') ORDER BY seq ASC").all() as Array<{ readonly type: string; readonly payload: string }>;
    expect(events.map((event) => event.type)).toEqual(["artifact.file.created", "message.part.added"]);
    expect(JSON.parse(events[1]?.payload ?? "{}")).toMatchObject({
      messageId: "msg_run_1",
      part: {
        type: "attachment",
        fileId: artifactId,
        artifactId,
        path: "multi-agent-platform-architecture.md",
        previewKind: "markdown"
      }
    });
  });

  test("rejects missing path input without creating artifacts", async () => {
    const result = await currentServer().callTool("room.send_file_message", { path: "missing.md" }, session());

    expect(result).toMatchObject({ ok: false, error: { code: "file_not_found" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toMatchObject({ count: 0 });
  });

  test("rejects sensitive path input before creating artifacts", async () => {
    writeFileSync(join(tempDir!, ".env"), "SECRET=1", "utf8");

    const result = await currentServer().callTool("room.send_file_message", { path: ".env" }, session());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toMatchObject({ count: 0 });
  });

  test("rejects traversal fileName in content mode before creating artifacts", async () => {
    const result = await currentServer().callTool("room.send_file_message", { fileName: "../secret.md", content: "secret" }, session());

    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toMatchObject({ count: 0 });
  });
});

function createServer(): RoomMcpServer {
  return new RoomMcpServer({
    commandBus: new CommandBus({ database: currentDatabase(), handlers: {} as never }),
    taskService: new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now }),
    database: currentDatabase(),
    eventBus: currentBus(),
    artifactService: currentArtifactService(),
    artifactVersioningService: createArtifactVersioningService({ database: currentDatabase(), eventBus: currentBus(), now: () => now }),
    now: () => now
  });
}

function seedWorkspace(): void {
  mkdirSync(join(tempDir!, "src"), { recursive: true });
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, ?, ?)").run(tempDir, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'assisted', 'conversation', 'agent_1', NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_1', 'ws_1', 'Builder', 'native', NULL, 'Build things.', '[\"file.write\"]', NULL, 0, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, agent_binding_id, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', 'native', NULL, 'active', NULL, ?)").run(now);
  currentDatabase().sqlite.prepare("INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES ('run_1', 'ws_1', NULL, 'room_1', 'agent_1', 'native', NULL, NULL, NULL, 'running', 'primary_turn', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(now, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES ('msg_run_1', 'ws_1', 'room_1', 'agent', 'agent_1', 'run_1', 'assistant', 'streaming', NULL, 'immediate', NULL, ?, ?, NULL)").run(now, now);
}

function session() {
  return { roomId: "room_1", agentId: "agent_1", runId: "run_1" };
}

function currentServer(): RoomMcpServer {
  expect(server).toBeDefined();
  return server as RoomMcpServer;
}

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function currentArtifactService(): ArtifactService {
  expect(artifactService).toBeDefined();
  return artifactService as ArtifactService;
}

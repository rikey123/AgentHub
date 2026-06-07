import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createArtifactVersioningService } from "../src/artifact-versioning-service.ts";

let dir: string | undefined;
let workspaceRoot: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let now = 100_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agenthub-artifact-versions-"));
  workspaceRoot = join(dir, "workspace");
  mkdirSync(workspaceRoot, { recursive: true });
  database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDb() });
  currentDb().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, 1, 1)").run(currentRoot());
  currentDb().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'assisted', 'conversation', 'agent_1', NULL, 1, 1)").run();
  currentDb().sqlite.prepare("INSERT INTO artifacts (id, workspace_id, room_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES ('artifact_1', 'ws_1', 'room_1', 'file', 'web_page', 'Landing', 'draft', 'agent_1', '{}', 1, 1)").run();
});

afterEach(() => {
  eventBus?.close();
  database?.sqlite.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  workspaceRoot = undefined;
  database = undefined;
  eventBus = undefined;
  now = 100_000;
});

describe("ArtifactVersioningService", () => {
  it("creates text versions by updating artifact_files and publishing artifact.version.created", async () => {
    const service = createArtifactVersioningService({ database: currentDb(), eventBus: currentBus(), now: () => now });

    const first = await service.createVersion({ artifactId: "artifact_1", content: "<html>v1</html>", filename: "index.html", createdBy: "agent_1", message: "initial" });
    now += 1;
    const second = await service.createVersion({ artifactId: "artifact_1", content: "<html>v2</html>", filename: "index.html", createdBy: "agent_1", message: "revise" });

    expect(first).toMatchObject({ artifactId: "artifact_1", version: 1, contentEncoding: "text", createdAt: 100_000, createdBy: "agent_1", message: "initial" });
    expect(second).toMatchObject({ artifactId: "artifact_1", version: 2, contentEncoding: "text", createdAt: 100_001 });
    expect(currentDb().sqlite.prepare("SELECT path, new_content, binary FROM artifact_files WHERE artifact_id = ?").get("artifact_1")).toMatchObject({ path: "index.html", new_content: "<html>v2</html>", binary: 0 });
    expect(await service.listVersions("artifact_1")).toEqual([
      expect.objectContaining({ version: 2, message: "revise" }),
      expect.objectContaining({ version: 1, message: "initial" })
    ]);
    expect(artifactVersionEvents()).toEqual([
      { type: "artifact.version.created", version: 1 },
      { type: "artifact.version.created", version: 2 }
    ]);
  });

  it("creates binary versions by copying files into controlled artifact storage", async () => {
    const source = join(currentRoot(), "output", "deck.pptx");
    mkdirSync(join(currentRoot(), "output"), { recursive: true });
    writeFileSync(source, Buffer.from("pptx bytes"));
    const service = createArtifactVersioningService({ database: currentDb(), eventBus: currentBus(), now: () => now });

    const version = await service.createBinaryVersion({
      artifactId: "artifact_1",
      filePath: source,
      filename: "deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      createdBy: "agent_1",
      message: "pptx"
    });

    const row = currentDb().sqlite.prepare("SELECT path, new_content, content_path, binary, new_sha256, mime_type, size_bytes FROM artifact_files WHERE artifact_id = ?").get("artifact_1") as Record<string, unknown>;
    const versionRow = currentDb().sqlite.prepare("SELECT content, storage_path, content_encoding FROM artifact_versions WHERE artifact_id = ? AND version = 1").get("artifact_1") as Record<string, unknown>;
    expect(version).toMatchObject({ version: 1, contentEncoding: "binary" });
    expect(row).toMatchObject({ path: "deck.pptx", new_content: null, binary: 1, mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size_bytes: 10 });
    expect(String(row.content_path)).toContain(join(".agenthub", "artifacts", "artifact_1", "v1", "deck.pptx"));
    expect(readFileSync(String(row.content_path), "utf8")).toBe("pptx bytes");
    expect(versionRow).toMatchObject({ content: null, storage_path: row.content_path, content_encoding: "binary" });
  });

  it("restores binary versions from controlled storage without resolving through workspace public paths", async () => {
    const source = join(currentRoot(), "output", "deck.pptx");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, Buffer.from("original deck"));
    const service = createArtifactVersioningService({ database: currentDb(), eventBus: currentBus(), now: () => now });
    await service.createBinaryVersion({ artifactId: "artifact_1", filePath: "output/deck.pptx", filename: "deck.pptx", createdBy: "agent_1", message: "initial" });
    const firstStorage = currentDb().sqlite.prepare("SELECT storage_path FROM artifact_versions WHERE artifact_id = ? AND version = 1").get("artifact_1") as { readonly storage_path: string };
    writeFileSync(join(currentRoot(), ".agenthub", "artifacts", "artifact_1", "v1", basename(firstStorage.storage_path)), Buffer.from("restored deck"));

    const restored = await service.restoreVersion("artifact_1", 1);

    const row = currentDb().sqlite.prepare("SELECT content_path, new_sha256, size_bytes FROM artifact_files WHERE artifact_id = ?").get("artifact_1") as { readonly content_path: string; readonly new_sha256: string; readonly size_bytes: number };
    const versionRow = currentDb().sqlite.prepare("SELECT storage_path, content_encoding FROM artifact_versions WHERE artifact_id = ? AND version = 2").get("artifact_1") as { readonly storage_path: string; readonly content_encoding: string };
    expect(restored).toMatchObject({ version: 2, contentEncoding: "binary", message: "Restore v1" });
    expect(versionRow).toMatchObject({ content_encoding: "binary", storage_path: row.content_path });
    expect(row.content_path).toContain(join(".agenthub", "artifacts", "artifact_1", "v2", "deck.pptx"));
    expect(readFileSync(row.content_path, "utf8")).toBe("restored deck");
    expect(row.size_bytes).toBe(Buffer.byteLength("restored deck"));
    expect(row.new_sha256).toHaveLength(64);
  });

  it("rejects binary restore when the selected version points outside controlled artifact storage", async () => {
    const source = join(currentRoot(), "output", "deck.pptx");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, Buffer.from("original deck"));
    const tampered = join(currentRoot(), "output", "tampered.pptx");
    writeFileSync(tampered, Buffer.from("tampered deck"));
    const service = createArtifactVersioningService({ database: currentDb(), eventBus: currentBus(), now: () => now });
    await service.createBinaryVersion({ artifactId: "artifact_1", filePath: "output/deck.pptx", filename: "deck.pptx", createdBy: "agent_1", message: "initial" });
    currentDb().sqlite.prepare("UPDATE artifact_versions SET storage_path = ? WHERE artifact_id = ? AND version = 1").run(tampered, "artifact_1");

    await expect(service.restoreVersion("artifact_1", 1)).rejects.toThrow("controlled artifact storage");

    expect(currentDb().sqlite.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE artifact_id = ?").get("artifact_1")).toMatchObject({ count: 1 });
  });
});

function currentDb(): AgentHubDatabase { expect(database).toBeDefined(); return database as AgentHubDatabase; }
function currentBus(): EventBus { expect(eventBus).toBeDefined(); return eventBus as EventBus; }
function currentRoot(): string { expect(workspaceRoot).toBeDefined(); return workspaceRoot as string; }
function artifactVersionEvents(): Array<{ readonly type: string; readonly version: number }> {
  return currentDb().sqlite
    .prepare("SELECT type, payload FROM events WHERE type = 'artifact.version.created' ORDER BY seq ASC")
    .all()
    .map((row) => ({ type: (row as { readonly type: string }).type, version: JSON.parse((row as { readonly payload: string }).payload).version as number }));
}

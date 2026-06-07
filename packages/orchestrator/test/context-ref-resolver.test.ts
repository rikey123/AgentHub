import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { resolveContextRefs } from "../src/context-ref-resolver.ts";

let dir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agenthub-context-ref-"));
  database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDb() });
  currentDb().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, 1, 1)").run(currentDir());
  currentDb().sqlite.prepare("INSERT INTO artifacts (id, workspace_id, room_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES ('artifact_1', 'ws_1', NULL, 'file', 'document', 'Doc', 'draft', 'agent', '{}', 1, 1)").run();
  currentDb().sqlite.prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at, binary) VALUES ('artifact_1', 'doc.md', NULL, ?, NULL, 0, 0, 'modified', NULL, NULL, NULL, NULL, 1, 0)").run(["one", "two", "three"].join("\n"));
});

afterEach(() => {
  eventBus?.close();
  database?.sqlite.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  database = undefined;
  eventBus = undefined;
});

describe("resolveContextRefs", () => {
  it("resolves artifact and workspace line ranges into XML context-ref blocks", async () => {
    mkdirSync(join(currentDir(), "src"), { recursive: true });
    writeFileSync(join(currentDir(), "src", "app.ts"), ["a", "b", "c"].join("\n"));

    const xml = await resolveContextRefs({ database: currentDb(), workspaceRoot: currentDir(), text: "Use @artifact:artifact_1#L2-L3 and @workspace:src/app.ts#L1-L2" });

    expect(xml).toContain('<context-ref type="artifact" id="artifact_1" lines="2-3"');
    expect(xml).toContain("two\nthree");
    expect(xml).toContain('<context-ref type="workspace" path="src/app.ts" lines="1-2"');
    expect(xml).toContain("a\nb");
  });

  it("resolves pptx slide refs through officecli text extraction", async () => {
    const officecli = vi.fn(async () => "Slide 2 text");
    currentDb().sqlite.prepare("INSERT INTO artifacts (id, workspace_id, room_id, type, kind, title, status, created_by, metadata, created_at, updated_at) VALUES ('artifact_ppt', 'ws_1', NULL, 'file', 'presentation_pptx', 'Deck', 'draft', 'agent', '{}', 1, 1)").run();
    currentDb().sqlite.prepare("INSERT INTO artifact_files (artifact_id, path, old_content, new_content, patch, additions, deletions, file_status, old_sha256, new_sha256, applied_state, content_path, created_at, binary) VALUES ('artifact_ppt', 'deck.pptx', NULL, NULL, NULL, 0, 0, 'modified', NULL, NULL, NULL, ?, 1, 1)").run(join(currentDir(), "deck.pptx"));

    const xml = await resolveContextRefs({ database: currentDb(), workspaceRoot: currentDir(), text: "@artifact:artifact_ppt#slide=2", officecliText: officecli });

    expect(officecli).toHaveBeenCalledWith(join(currentDir(), "deck.pptx"), 2);
    expect(xml).toContain('<context-ref type="artifact" id="artifact_ppt" slide="2"');
    expect(xml).toContain("Slide 2 text");
  });
});

function currentDb(): AgentHubDatabase { expect(database).toBeDefined(); return database as AgentHubDatabase; }
function currentDir(): string { expect(dir).toBeDefined(); return dir as string; }

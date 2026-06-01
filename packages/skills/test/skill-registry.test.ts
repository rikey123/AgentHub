import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { SkillRegistry } from "../src/index.ts";

const writeFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  writeFileSyncMock.mockImplementation(actual.writeFileSync);
  return { ...actual, writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => writeFileSyncMock(...args) };
});

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let registry: SkillRegistry | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = fs.mkdtempSync(join(tmpdir(), "agenthub-skills-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  registry = new SkillRegistry({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
  seedWorkspace();
});

afterEach(() => {
  eventBus?.close();
  database?.sqlite.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  registry = undefined;
  now = 1_000;
});

describe("SkillRegistry", () => {
  test("create stores a skill and publishes skill.created", () => {
    const skillId = currentRegistry().create({
      workspaceId: "ws_1",
      name: "review-helper",
      description: "Helps reviewers",
      content: skillContent("review-helper", "Helps reviewers"),
      origin: "workspace"
    }).skillId;

    expect(currentDatabase().sqlite.prepare("SELECT name, description, origin FROM skills WHERE id = ?").get(skillId)).toMatchObject({ name: "review-helper", description: "Helps reviewers", origin: "workspace" });
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'skill.created' AND json_extract(payload, '$.skillId') = ?").get(skillId)).toBeDefined();
  });

  test("seedBuiltins is idempotent and seeds both builtins", () => {
    currentRegistry().seedBuiltins("ws_1");
    currentRegistry().seedBuiltins("ws_1");

    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM skills WHERE workspace_id = 'ws_1' AND origin = 'builtin'").get()).toMatchObject({ count: 2 });
    expect(currentDatabase().sqlite.prepare("SELECT name FROM skills WHERE workspace_id = 'ws_1' AND origin = 'builtin' ORDER BY name ASC").all().map((row) => (row as { readonly name: string }).name)).toEqual(["skill-creator", "task-planner"]);
  });

  test("resolveSkills returns room pool and applies add and restrict overrides", () => {
    const roomSkill = createSkill("room-skill");
    const addedSkill = createSkill("added-skill");
    const restrictedSkill = createSkill("restricted-skill");
    const ignoredSkill = createSkill("ignored-skill");
    insertRoom("room_1", "agent_1");
    insertRoomSkill("room_1", roomSkill, 1);
    insertAgentSkill("room_1", "agent_1", addedSkill, "add");
    insertAgentSkill("room_1", "agent_1", restrictedSkill, "restrict");
    insertRoomSkill("room_1", ignoredSkill, 1);

    expect(currentRegistry().resolveSkills("room_1", "agent_1").map((skill) => skill.name)).toEqual(["added-skill", "restricted-skill"]);
  });

  test("materializeForRun writes skill files and cleanupRun removes them", () => {
    const skillId = createSkill("tooling-skill", [
      { path: "docs/README.md", content: "details" }
    ]);
    insertRoom("room_1", "agent_1");
    insertRoomSkill("room_1", skillId, 1);

    currentRegistry().materializeForRun({ runId: "run_1", roomId: "room_1", participantId: "agent_1", workspaceRoot: tempWorkspaceRoot(), runtimeId: "native" });

    expect(fs.existsSync(join(tempWorkspaceRoot(), ".agenthub", "skill-overlays", "run_1", ".agenthub", "skills", "tooling-skill", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(join(tempWorkspaceRoot(), ".agenthub", "skill-overlays", "run_1", ".agenthub", "skills", "tooling-skill", "docs", "README.md"))).toBe(true);

    currentRegistry().cleanupRun("run_1");

    expect(fs.existsSync(join(tempWorkspaceRoot(), ".agenthub", "skill-overlays", "run_1", ".agenthub", "skills", "tooling-skill"))).toBe(false);
  });

  test("materialization failures publish skill.materialization_failed", () => {
    const skillId = createSkill("broken-skill");
    insertRoom("room_1", "agent_1");
    insertRoomSkill("room_1", skillId, 1);
    writeFileSyncMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    expect(() => currentRegistry().materializeForRun({ runId: "run_error", roomId: "room_1", participantId: "agent_1", workspaceRoot: tempWorkspaceRoot(), runtimeId: "native" })).toThrow("disk full");
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'skill.materialization_failed' AND run_id = 'run_error'").get()).toBeDefined();

    writeFileSyncMock.mockReset();
  });
});

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function currentRegistry(): SkillRegistry {
  expect(registry).toBeDefined();
  return registry as SkillRegistry;
}

function seedWorkspace(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
}

function skillContent(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}`;
}

function createSkill(name: string, files: ReadonlyArray<{ readonly path: string; readonly content: string }> = []): string {
  return currentRegistry().create({ workspaceId: "ws_1", name, description: `Desc for ${name}`, content: skillContent(name, `Desc for ${name}`), origin: "workspace", files }).skillId;
}

function insertRoom(roomId: string, agentId: string): void {
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, 'ws_1', 'Room', 'squad', 'conversation', ?, NULL, ?, ?)").run(roomId, agentId, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', 'mock', NULL, 'active', ?)").run(roomId, agentId, now);
}

function insertRoomSkill(roomId: string, skillId: string, enabled: 0 | 1): void {
  currentDatabase().sqlite.prepare("INSERT INTO room_skills (room_id, skill_id, enabled) VALUES (?, ?, ?)").run(roomId, skillId, enabled);
}

function insertAgentSkill(roomId: string, participantId: string, skillId: string, mode: "add" | "restrict"): void {
  currentDatabase().sqlite.prepare("INSERT INTO agent_skills (room_participant_id, skill_id, mode) VALUES (?, ?, ?)").run(`${roomId}:${participantId}`, skillId, mode);
}

function tempWorkspaceRoot(): string {
  if (tempDir === undefined) throw new Error("missing temp dir");
  return join(tempDir, "workspace");
}

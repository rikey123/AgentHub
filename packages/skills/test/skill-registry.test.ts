import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import { SkillMaterializationError, SkillRegistry, listRuntimeLocalSkills, loadRuntimeLocalSkillBundle } from "../src/index.ts";

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

beforeEach(async () => {
  const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
  writeFileSyncMock.mockImplementation(actualFs.writeFileSync);
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

  test("resolveSkills returns room pool, adds extras, and excludes restricted room skills", () => {
    const roomSkill = createSkill("room-skill");
    const terminalAccess = createSkill("terminal-access");
    const agentExtra = createSkill("agent-extra");
    insertRoom("room_1", "agent_1");
    insertRoomSkill("room_1", roomSkill, 1);
    insertRoomSkill("room_1", terminalAccess, 1);
    insertAgentSkill("room_1", "agent_1", agentExtra, "add");
    insertAgentSkill("room_1", "agent_1", terminalAccess, "restrict");

    expect(currentRegistry().resolveSkills("room_1", "agent_1").map((skill) => skill.name)).toEqual(["agent-extra", "room-skill"]);
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

  test("update replaces supporting files as one skill package", () => {
    const skillId = createSkill("tooling-skill", [
      { path: "docs/README.md", content: "old details" },
      { path: "scripts/old.sh", content: "legacy" }
    ]);

    currentRegistry().update({
      skillId,
      files: [
        { path: "docs/README.md", content: "new details" },
        { path: "scripts/run.sh", content: "echo ok" }
      ]
    });

    const rows = currentDatabase().sqlite.prepare("SELECT path, content FROM skill_files WHERE skill_id = ? ORDER BY path ASC").all(skillId);
    expect(rows).toEqual([
      { path: "docs/README.md", content: "new details" },
      { path: "scripts/run.sh", content: "echo ok" }
    ]);
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'skill.updated' AND json_extract(payload, '$.skillId') = ?").get(skillId)).toBeDefined();
  });

  test("create rejects supporting files that escape the skill package", () => {
    expect(() => currentRegistry().create({
      workspaceId: "ws_1",
      name: "unsafe-skill",
      description: "Unsafe package",
      content: skillContent("unsafe-skill", "Unsafe package"),
      origin: "workspace",
      files: [{ path: "../secret.txt", content: "nope" }]
    })).toThrow("skill file path escapes skill package");
  });

  test("fallback prompt lists supporting files for runtimes without native skill loading", () => {
    const skillId = createSkill("tooling-skill", [
      { path: "docs/README.md", content: "details" },
      { path: "scripts/run.sh", content: "echo ok" }
    ]);
    insertRoom("room_1", "agent_1");
    insertRoomSkill("room_1", skillId, 1);

    const block = currentRegistry().buildSkillsPromptBlock("room_1", "agent_1");

    expect(block).toContain("<skill_files>");
    expect(block).toContain("<file>docs/README.md</file>");
    expect(block).toContain("<file>scripts/run.sh</file>");
  });

  test("materialization failures throw structured SkillMaterializationError for daemon handling", () => {
    const skillId = createSkill("broken-skill");
    insertRoom("room_1", "agent_1");
    insertRoomSkill("room_1", skillId, 1);
    writeFileSyncMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    expect(() => currentRegistry().materializeForRun({ runId: "run_error", roomId: "room_1", participantId: "agent_1", workspaceRoot: tempWorkspaceRoot(), runtimeId: "native" })).toThrow(SkillMaterializationError);
    try {
      currentRegistry().materializeForRun({ runId: "run_error", roomId: "room_1", participantId: "agent_1", workspaceRoot: tempWorkspaceRoot(), runtimeId: "native" });
    } catch (error) {
      expect(error).toBeInstanceOf(SkillMaterializationError);
      const structured = error as SkillMaterializationError;
      expect(structured.details).toMatchObject({ skillId, skillName: "broken-skill", workspaceId: "ws_1", runId: "run_error", error: "disk full" });
    }
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'skill.materialization_failed' AND run_id = 'run_error'").get()).toBeUndefined();

    writeFileSyncMock.mockReset();
  });
});

describe("runtime local skill import helpers", () => {
  test("lists nested opencode skills and loads supporting files", () => {
    const home = tempHomeRoot();
    const skillDir = join(home, ".config", "opencode", "skills", "release", "reporter");
    fs.mkdirSync(join(skillDir, "references"), { recursive: true });
    fs.writeFileSync(join(skillDir, "SKILL.md"), skillContent("release-reporter", "Writes release reports"), "utf8");
    fs.writeFileSync(join(skillDir, "references", "template.md"), "release template", "utf8");

    const listed = listRuntimeLocalSkills("opencode", { homeDir: home });

    expect(listed.supported).toBe(true);
    expect(listed.skills).toEqual([
      expect.objectContaining({
        key: "release/reporter",
        name: "release-reporter",
        description: "Writes release reports",
        provider: "opencode",
        fileCount: 2
      })
    ]);

    const bundle = loadRuntimeLocalSkillBundle("opencode", "release/reporter", { homeDir: home });

    expect(bundle.supported).toBe(true);
    expect(bundle.skill).toMatchObject({
      name: "release-reporter",
      description: "Writes release reports",
      provider: "opencode",
      content: skillContent("release-reporter", "Writes release reports")
    });
    expect(bundle.skill?.files).toEqual([{ path: "references/template.md", content: "release template" }]);
  });

  test("keeps opencode local skill discovery isolated from other runtime roots", () => {
    const home = tempHomeRoot();
    const opencodeSkillDir = join(home, ".config", "opencode", "skills", "opencode-reviewer");
    const claudeSkillDir = join(home, ".claude", "skills", "claude-reviewer");
    const sharedSkillDir = join(home, ".agents", "skills", "shared-reviewer");
    fs.mkdirSync(opencodeSkillDir, { recursive: true });
    fs.mkdirSync(claudeSkillDir, { recursive: true });
    fs.mkdirSync(sharedSkillDir, { recursive: true });
    fs.writeFileSync(join(opencodeSkillDir, "SKILL.md"), skillContent("opencode-reviewer", "Reviews from OpenCode"), "utf8");
    fs.writeFileSync(join(claudeSkillDir, "SKILL.md"), skillContent("claude-reviewer", "Reviews from Claude"), "utf8");
    fs.writeFileSync(join(sharedSkillDir, "SKILL.md"), skillContent("shared-reviewer", "Reviews from shared installer"), "utf8");

    const listed = listRuntimeLocalSkills("opencode", { homeDir: home });
    const bundle = loadRuntimeLocalSkillBundle("opencode", "opencode-reviewer", { homeDir: home });

    expect(listed.skills).toEqual([
      expect.objectContaining({ key: "opencode-reviewer", name: "opencode-reviewer", provider: "opencode" })
    ]);
    expect(listed.skills.map((skill) => skill.key)).not.toContain("claude/claude-reviewer");
    expect(listed.skills.map((skill) => skill.key)).not.toContain("shared/shared-reviewer");
    expect(loadRuntimeLocalSkillBundle("opencode", "claude/claude-reviewer", { homeDir: home }).skill).toBeNull();
    expect(loadRuntimeLocalSkillBundle("opencode", "shared/shared-reviewer", { homeDir: home }).skill).toBeNull();
    expect(bundle.skill).toMatchObject({ key: "opencode-reviewer", content: skillContent("opencode-reviewer", "Reviews from OpenCode") });
  });

  test("follows symlinked skill directories without looping", () => {
    if (process.platform === "win32") {
      // Windows symlink creation often requires elevated privileges on CI.
      return;
    }
    const home = tempHomeRoot();
    const sharedSkill = join(home, "shared-skills", "reviewer");
    const linkDir = join(home, ".claude", "skills", "reviewer");
    fs.mkdirSync(sharedSkill, { recursive: true });
    fs.mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    fs.writeFileSync(join(sharedSkill, "SKILL.md"), skillContent("reviewer", "Reviews work"), "utf8");
    fs.symlinkSync(sharedSkill, linkDir, "dir");

    const listed = listRuntimeLocalSkills("claude-code", { homeDir: home });

    expect(listed.skills).toEqual([
      expect.objectContaining({ key: "reviewer", name: "reviewer", provider: "claude" })
    ]);
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

function tempHomeRoot(): string {
  if (tempDir === undefined) throw new Error("missing temp dir");
  return join(tempDir, "home");
}

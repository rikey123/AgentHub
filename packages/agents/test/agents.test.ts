import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrapBuiltInAgents, builtInAgentTemplates, parseAgentProfileFile, resetBuiltInAgentTemplate, watchAgentProfiles } from "../src/index.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("built-in agent templates", () => {
  it("ships seven parseable templates with required OpenCode defaults", () => {
    const templates = builtInAgentTemplates();

    expect(templates.map((template) => template.fileName)).toEqual([
      "mock-builder.md",
      "mock-reviewer.md",
      "claude-code-builder.md",
      "claude-code-reviewer.md",
      "builder-opencode.md",
      "reviewer.md",
      "archivist.md"
    ]);
    for (const template of templates) expect(template.version).toBe("1.0.0");

    const builderOpenCode = parseAgentProfileFile(templates.find((template) => template.id === "builder-opencode")?.path ?? "");
    expect(builderOpenCode).toMatchObject({ provider: "opencode", adapterId: "opencode-default", model: "opencode/big-pickle", defaultPresence: "active" });
    expect(builderOpenCode.capabilities).toContain("terminal.run");
  });

  it("writes missing built-ins on first launch", () => {
    const agentsDir = tempDir("agenthub-agents-first-launch-");

    bootstrapBuiltInAgents({ agentsDir });

    for (const template of builtInAgentTemplates()) {
      expect(existsSync(join(agentsDir, template.fileName))).toBe(true);
    }
  });

  it("skips an existing same-name user file", () => {
    const agentsDir = tempDir("agenthub-agents-skip-");
    mkdirSync(agentsDir, { recursive: true });
    const targetPath = join(agentsDir, "mock-builder.md");
    writeFileSync(targetPath, "---\nid: mock-builder\nversion: 1.0.0\n---\nuser edit\n", "utf8");

    bootstrapBuiltInAgents({ agentsDir });

    expect(readFileSync(targetPath, "utf8")).toContain("user edit");
  });

  it("warns when an existing built-in is older without overwriting it", () => {
    const agentsDir = tempDir("agenthub-agents-version-");
    mkdirSync(agentsDir, { recursive: true });
    const targetPath = join(agentsDir, "builder-opencode.md");
    writeFileSync(targetPath, "---\nid: builder-opencode\nversion: 0.9.0\n---\nold user edit\n", "utf8");
    const stderr = { write: vi.fn(() => true) };

    bootstrapBuiltInAgents({ agentsDir, stderr });

    expect(stderr.write).toHaveBeenCalledWith("Builtin agent 'builder-opencode' has an update; run `agenthub agents reset --id=builder-opencode` to overwrite\n");
    expect(readFileSync(targetPath, "utf8")).toContain("old user edit");
  });

  it("resets a built-in template explicitly", () => {
    const agentsDir = tempDir("agenthub-agents-reset-");
    mkdirSync(agentsDir, { recursive: true });
    const targetPath = join(agentsDir, "reviewer.md");
    writeFileSync(targetPath, "user edit", "utf8");

    expect(resetBuiltInAgentTemplate("reviewer", agentsDir)).toBe(targetPath);

    expect(readFileSync(targetPath, "utf8")).toContain("id: reviewer");
  });
});

describe("agent profile watcher", () => {
  it("upserts profiles on chokidar add/change and removes on unlink", async () => {
    const database = testDatabase();
    const eventBus = createEventBus({ database });
    const agentsDir = tempDir("agenthub-agents-watch-");
    const profilePath = join(agentsDir, "security.md");
    const watcher = watchAgentProfiles({ database, eventBus, userAgentsDir: agentsDir, now: () => 1000 });
    try {
      await watcher.ready;

      writeFileSync(profilePath, profileMarkdown({ id: "security", name: "Security", prompt: "review security" }), "utf8");
      await waitFor(() => profileName(database, "security") === "Security");
      await waitFor(() => eventCount(database, "agent.profile.updated") === 1);
      writeFileSync(profilePath, profileMarkdown({ id: "security", name: "Security Updated", prompt: "review again" }), "utf8");
      await waitFor(() => profileName(database, "security") === "Security Updated");
      await waitFor(() => eventCount(database, "agent.profile.updated") === 2);
      rmSync(profilePath);
      await waitFor(() => profileName(database, "security") === undefined);
      await waitFor(() => eventCount(database, "agent.profile.removed") === 1);
    } finally {
      await watcher.close();
      eventBus.close();
      database.sqlite.close();
    }
  });

  it("emits parse failures without deleting the old profile row", async () => {
    const database = testDatabase();
    const eventBus = createEventBus({ database });
    const agentsDir = tempDir("agenthub-agents-parse-error-");
    const stderr = { write: vi.fn(() => true) };
    const events: string[] = [];
    eventBus.subscribeAll((event) => { events.push(event.type); });
    const profilePath = join(agentsDir, "broken.md");
    const watcher = watchAgentProfiles({ database, eventBus, userAgentsDir: agentsDir, stderr, now: () => 2000 });
    try {
      await watcher.ready;

      writeFileSync(profilePath, profileMarkdown({ id: "broken", name: "Valid", prompt: "valid" }), "utf8");
      await waitFor(() => profileName(database, "broken") === "Valid");
      writeFileSync(profilePath, "---\nname: Missing Id\nprovider: native\nadapterId: mock\ndefaultPresence: active\ncapabilities: [chat]\n---\ninvalid\n", "utf8");
      await waitFor(() => events.includes("agent.profile.error"));

      expect(profileName(database, "broken")).toBe("Valid");
      expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining(`agent profile parse failed at ${profilePath}: missing id`));
    } finally {
      await watcher.close();
      eventBus.close();
      database.sqlite.close();
    }
  });
});

function testDatabase(): AgentHubDatabase {
  const dir = tempDir("agenthub-agents-db-");
  const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('default-workspace', 'Default', ?, 1, 1)").run(dir);
  return database;
}

function tempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function profileMarkdown(input: { readonly id: string; readonly name: string; readonly prompt: string }): string {
  return `---\nid: ${input.id}\nname: ${input.name}\nversion: 1.0.0\nprovider: native\nadapterId: mock\nmodel: mock\ndefaultPresence: active\ncapabilities: [chat, code.edit]\nhidden: false\n---\n${input.prompt}\n`;
}

function profileName(database: AgentHubDatabase, id: string): string | undefined {
  const row = database.sqlite.prepare("SELECT name FROM agent_profiles WHERE id = ?").get(id) as { readonly name: string } | undefined;
  return row?.name;
}

function eventCount(database: AgentHubDatabase, type: string): number {
  return (database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = ?").get(type) as { readonly count: number }).count;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 5_000) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

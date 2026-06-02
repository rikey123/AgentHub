import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";

import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

import { BUILTIN_SKILLS } from "./builtin-skills.ts";

export type SkillRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly origin: "builtin" | "workspace" | "imported";
  readonly source_url: string | null;
  readonly created_at: number;
  readonly updated_at: number;
};

export type SkillFileRow = {
  readonly id: string;
  readonly skill_id: string;
  readonly path: string;
  readonly content: string;
};

export type CreateSkillInput = {
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly origin: "builtin" | "workspace" | "imported";
  readonly sourceUrl?: string;
  readonly files?: ReadonlyArray<{ readonly path: string; readonly content: string }>;
};

export type UpdateSkillInput = {
  readonly skillId: string;
  readonly name?: string;
  readonly description?: string;
  readonly content?: string;
  readonly files?: ReadonlyArray<{ readonly path: string; readonly content: string }>;
};

export type RoomSkillAssignmentInput = {
  readonly skillId: string;
  readonly roomId: string;
  readonly workspaceId: string;
};

export type ParticipantSkillAssignmentInput = {
  readonly skillId: string;
  readonly roomId: string;
  readonly participantId: string;
  readonly workspaceId: string;
  readonly mode: "add" | "restrict";
};

type SkillFrontmatter = { readonly name: string; readonly description: string };
type SkillDirent = { readonly name: string; isDirectory(): boolean; isFile(): boolean };

export type RuntimeLocalSkillSummary = {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly sourcePath: string;
  readonly provider: string;
  readonly fileCount: number;
};

export type RuntimeLocalSkillBundle = RuntimeLocalSkillSummary & {
  readonly content: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>;
};

export type RuntimeLocalSkillOptions = {
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
};

export class SkillMaterializationError extends Error {
  constructor(
    readonly details: {
      readonly skillId: string;
      readonly skillName: string;
      readonly workspaceId: string;
      readonly runId: string;
      readonly error: string;
    }
  ) {
    super(details.error);
    this.name = "SkillMaterializationError";
  }
}

const RUNTIME_SKILL_DIRS: Record<string, string> = {
  "claude-code": ".claude/skills",
  codex: ".codex/skills",
  opencode: ".opencode/skills",
  qwen: ".qwen/skills",
  cursor: ".cursor/skills",
  goose: ".goose/skills",
  kimi: ".kimi/skills",
  kiro: ".kiro/skills",
  native: ".agenthub/skills",
  mock: ".agenthub/skills"
};

const LOCAL_SKILL_MAX_FILE_BYTES = 1024 * 1024;
const LOCAL_SKILL_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const LOCAL_SKILL_MAX_FILE_COUNT = 128;
const LOCAL_SKILL_MAX_DIR_DEPTH = 4;

export class SkillRegistry {
  private readonly now: () => number;
  private readonly materializedRuns = new Map<string, Set<string>>();

  constructor(private readonly options: { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly now?: () => number }) {
    this.now = options.now ?? Date.now;
  }

  create(input: CreateSkillInput): { readonly skillId: string } {
    validateSkillPackage(input.name, input.description, input.content);
    const now = this.now();
    const skillId = randomUUID();
    const files = normalizeFiles(input.files ?? []);
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("INSERT INTO skills (id, workspace_id, name, description, content, origin, source_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(skillId, input.workspaceId, input.name, input.description, input.content, input.origin, input.sourceUrl ?? null, now, now);
      for (const file of files) this.options.database.sqlite.prepare("INSERT INTO skill_files (id, skill_id, path, content) VALUES (?, ?, ?, ?)").run(randomUUID(), skillId, file.path, file.content);
      this.options.eventBus.publish({ id: randomUUID(), type: "skill.created", schemaVersion: 1, workspaceId: input.workspaceId, payload: { skillId, workspaceId: input.workspaceId, name: input.name, origin: input.origin }, createdAt: now });
      if (input.origin === "imported" && input.sourceUrl !== undefined) this.options.eventBus.publish({ id: randomUUID(), type: "skill.imported", schemaVersion: 1, workspaceId: input.workspaceId, payload: { skillId, workspaceId: input.workspaceId, sourceUrl: input.sourceUrl }, createdAt: now });
    })();
    return { skillId };
  }

  update(input: UpdateSkillInput): void {
    const skill = this.getSkill(input.skillId);
    if (skill === undefined) throw new Error(`skill '${input.skillId}' not found`);
    const name = input.name ?? skill.name;
    const description = input.description ?? skill.description;
    const content = input.content ?? skill.content;
    validateSkillPackage(name, description, content);
    const files = input.files === undefined ? undefined : normalizeFiles(input.files);
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("UPDATE skills SET name = ?, description = ?, content = ?, updated_at = ? WHERE id = ?").run(name, description, content, now, input.skillId);
      if (files !== undefined) {
        this.options.database.sqlite.prepare("DELETE FROM skill_files WHERE skill_id = ?").run(input.skillId);
        for (const file of files) this.options.database.sqlite.prepare("INSERT INTO skill_files (id, skill_id, path, content) VALUES (?, ?, ?, ?)").run(randomUUID(), input.skillId, file.path, file.content);
      }
      this.options.eventBus.publish({ id: randomUUID(), type: "skill.updated", schemaVersion: 1, workspaceId: skill.workspace_id, payload: { skillId: input.skillId, workspaceId: skill.workspace_id }, createdAt: now });
    })();
  }

  delete(skillId: string): void {
    const skill = this.getSkill(skillId);
    if (skill === undefined) return;
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("DELETE FROM skill_files WHERE skill_id = ?").run(skillId);
      this.options.database.sqlite.prepare("DELETE FROM room_skills WHERE skill_id = ?").run(skillId);
      this.options.database.sqlite.prepare("DELETE FROM agent_skills WHERE skill_id = ?").run(skillId);
      this.options.database.sqlite.prepare("DELETE FROM skills WHERE id = ?").run(skillId);
      this.options.eventBus.publish({ id: randomUUID(), type: "skill.deleted", schemaVersion: 1, workspaceId: skill.workspace_id, payload: { skillId, workspaceId: skill.workspace_id }, createdAt: now });
    })();
  }

  activateForRoom(input: RoomSkillAssignmentInput): void {
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("INSERT INTO room_skills (room_id, skill_id, enabled) VALUES (?, ?, 1) ON CONFLICT(room_id, skill_id) DO UPDATE SET enabled = 1").run(input.roomId, input.skillId);
      this.options.eventBus.publish({ id: randomUUID(), type: "skill.activated", schemaVersion: 1, workspaceId: input.workspaceId, roomId: input.roomId, payload: { skillId: input.skillId, roomId: input.roomId }, createdAt: now });
    })();
  }

  deactivateForRoom(input: RoomSkillAssignmentInput): void {
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("DELETE FROM room_skills WHERE room_id = ? AND skill_id = ?").run(input.roomId, input.skillId);
      this.options.eventBus.publish({ id: randomUUID(), type: "skill.deactivated", schemaVersion: 1, workspaceId: input.workspaceId, roomId: input.roomId, payload: { skillId: input.skillId, roomId: input.roomId }, createdAt: now });
    })();
  }

  activateForParticipant(input: ParticipantSkillAssignmentInput): void {
    const now = this.now();
    const roomParticipantId = compositeRoomParticipantId(input.roomId, input.participantId);
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("INSERT INTO agent_skills (room_participant_id, skill_id, mode) VALUES (?, ?, ?) ON CONFLICT(room_participant_id, skill_id) DO UPDATE SET mode = excluded.mode").run(roomParticipantId, input.skillId, input.mode);
      this.options.eventBus.publish({ id: randomUUID(), type: "skill.activated", schemaVersion: 1, workspaceId: input.workspaceId, roomId: input.roomId, payload: { skillId: input.skillId, participantId: input.participantId }, createdAt: now });
    })();
  }

  deactivateForParticipant(input: Pick<ParticipantSkillAssignmentInput, "skillId" | "roomId" | "participantId" | "workspaceId">): void {
    const now = this.now();
    const roomParticipantId = compositeRoomParticipantId(input.roomId, input.participantId);
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("DELETE FROM agent_skills WHERE room_participant_id = ? AND skill_id = ?").run(roomParticipantId, input.skillId);
      this.options.eventBus.publish({ id: randomUUID(), type: "skill.deactivated", schemaVersion: 1, workspaceId: input.workspaceId, roomId: input.roomId, payload: { skillId: input.skillId, participantId: input.participantId }, createdAt: now });
    })();
  }

  resolveSkills(roomId: string, participantId: string): readonly SkillRow[] {
    const roomSkills = this.options.database.sqlite.prepare(`SELECT s.id, s.workspace_id, s.name, s.description, s.content, s.origin, s.source_url, s.created_at, s.updated_at FROM room_skills rs INNER JOIN skills s ON s.id = rs.skill_id WHERE rs.room_id = ? AND rs.enabled = 1 ORDER BY s.name ASC`).all(roomId) as SkillRow[];
    const participant = this.options.database.sqlite.prepare("SELECT participant_id FROM room_participants WHERE room_id = ? AND participant_id = ? AND participant_type = 'agent' LIMIT 1").get(roomId, participantId) as { readonly participant_id: string } | undefined;
    if (participant === undefined) return roomSkills;
    const overrides = this.options.database.sqlite.prepare("SELECT skill_id, mode FROM agent_skills WHERE room_participant_id = ?").all(compositeRoomParticipantId(roomId, participant.participant_id)) as { readonly skill_id: string; readonly mode: "add" | "restrict" }[];
    const pool = new Map(roomSkills.map((skill) => [skill.id, skill] as const));
    const addIds = new Set<string>();
    const restrictIds = new Set<string>();
    for (const override of overrides) {
      if (override.mode === "add") addIds.add(override.skill_id);
      else restrictIds.add(override.skill_id);
    }
    if (restrictIds.size > 0) {
      // `restrict` means exclude these skills from the room pool for this participant.
      for (const skillId of restrictIds) pool.delete(skillId);
    }
    for (const skillId of addIds) {
      const row = this.getSkill(skillId);
      if (row !== undefined) pool.set(row.id, row);
    }
    return Array.from(pool.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  materializeForRun(input: { readonly runId: string; readonly roomId: string; readonly participantId: string; readonly workspaceRoot: string; readonly runtimeId: string; readonly taskId?: string; readonly mode?: "isolated_worktree" | "shared" }): void {
    const skills = this.resolveSkills(input.roomId, input.participantId);
    if (skills.length === 0) return;
    const skillDir = RUNTIME_SKILL_DIRS[input.runtimeId] ?? ".agenthub/skills";
    const runPaths = new Set<string>();
    const workspaceId = this.roomWorkspaceId(input.roomId);
    const materializedRoot = input.mode === "isolated_worktree"
      ? resolve(input.workspaceRoot, skillDir)
      : resolve(input.workspaceRoot, ".agenthub", "skill-overlays", input.runId, skillDir);
    try {
      for (const skill of skills) {
        const packageRoot = resolve(materializedRoot, skill.name);
        mkdirSync(packageRoot, { recursive: true });
        runPaths.add(packageRoot);
        writeFileSync(resolve(packageRoot, "SKILL.md"), skill.content, "utf8");
        for (const file of this.skillFiles(skill.id)) {
          const target = resolveWithinRoot(packageRoot, file.path);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, file.content, "utf8");
        }
      }
      this.materializedRuns.set(input.runId, runPaths);
    } catch (error) {
      this.cleanupPaths(runPaths);
      const failedSkill = skills[0];
      throw new SkillMaterializationError({
        skillId: failedSkill?.id ?? "unknown",
        skillName: failedSkill?.name ?? "unknown",
        workspaceId,
        runId: input.runId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  cleanupRun(runId: string): void {
    const paths = this.materializedRuns.get(runId);
    if (paths === undefined) return;
    this.cleanupPaths(paths);
    this.materializedRuns.delete(runId);
  }

  /**
   * Build a prompt block listing all active skills for a (room, participant) pair.
   * Used as a fallback for shared-mode runs where the runtime cannot natively scan
   * the skill overlay directory. Per spec D9: inject skill index + full SKILL.md content.
   * Returns undefined if no skills are active.
   */
  buildSkillsPromptBlock(roomId: string, participantId: string): string | undefined {
    const skills = this.resolveSkills(roomId, participantId);
    if (skills.length === 0) return undefined;
    const lines: string[] = [
      "<active-skills>",
      `<!-- ${skills.length} skill(s) are active for this run. Read and apply them. -->`
    ];
    for (const skill of skills) {
      lines.push(`\n## Skill: ${skill.name}`);
      lines.push(`Description: ${skill.description}`);
      const files = this.skillFiles(skill.id);
      if (files.length > 0) {
        lines.push("<skill_files>");
        lines.push("<!-- Supporting files are relative to this skill package. Native runtimes can read them from the materialized skill directory. -->");
        for (const file of files) lines.push(`<file>${file.path}</file>`);
        lines.push("</skill_files>");
      }
      lines.push("```");
      lines.push(skill.content);
      lines.push("```");
    }
    lines.push("</active-skills>");
    return lines.join("\n");
  }

  seedBuiltins(workspaceId: string): void {
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      for (const builtin of BUILTIN_SKILLS) {
        this.options.database.sqlite.prepare("INSERT OR IGNORE INTO skills (id, workspace_id, name, description, content, origin, source_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'builtin', NULL, ?, ?)").run(randomUUID(), workspaceId, builtin.name, builtin.description, builtin.content, now, now);
      }
    })();
  }

  private getSkill(skillId: string): SkillRow | undefined {
    return this.options.database.sqlite.prepare("SELECT * FROM skills WHERE id = ?").get(skillId) as SkillRow | undefined;
  }

  private skillFiles(skillId: string): readonly SkillFileRow[] {
    return this.options.database.sqlite.prepare("SELECT * FROM skill_files WHERE skill_id = ? ORDER BY path ASC").all(skillId) as SkillFileRow[];
  }

  private roomWorkspaceId(roomId: string): string {
    const row = this.options.database.sqlite.prepare("SELECT workspace_id FROM rooms WHERE id = ?").get(roomId) as { readonly workspace_id: string } | undefined;
    return row?.workspace_id ?? "default-workspace";
  }

  private cleanupPaths(paths: ReadonlySet<string>): void {
    for (const path of paths) rmSync(path, { recursive: true, force: true });
  }
}

function normalizeFiles(files: ReadonlyArray<{ readonly path: string; readonly content: string }>): ReadonlyArray<{ readonly path: string; readonly content: string }> {
  const normalizedFiles: Array<{ readonly path: string; readonly content: string }> = [];
  const seen = new Set<string>();
  for (const file of files) {
    const normalizedPath = normalizeSkillFilePath(file.path);
    if (normalizedPath.length === 0) continue;
    if (seen.has(normalizedPath)) throw new Error(`duplicate skill file path '${normalizedPath}'`);
    seen.add(normalizedPath);
    normalizedFiles.push({ path: normalizedPath, content: file.content });
  }
  return normalizedFiles;
}

function validateSkillPackage(name: string, description: string, content: string): void {
  if (name.length === 0 || description.length === 0 || content.length === 0) throw new Error("skill name, description, and content are required");
  const frontmatter = parseFrontmatter(content);
  if (frontmatter === undefined) throw new Error("skill content must include YAML frontmatter");
  if (frontmatter.name !== name) throw new Error(`skill frontmatter name '${frontmatter.name}' does not match '${name}'`);
  if (frontmatter.description !== description) throw new Error(`skill frontmatter description does not match '${name}'`);
}

function parseFrontmatter(content: string): SkillFrontmatter | undefined {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return undefined;
  let index = 1;
  const values: { name?: string; description?: string } = {};
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line === "---") break;
    const separator = line.indexOf(":");
    if (separator > 0) {
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (key === "name") values.name = value;
      if (key === "description") values.description = value;
    }
    index += 1;
  }
  if (lines[index] !== "---") return undefined;
  if (typeof values.name !== "string" || typeof values.description !== "string") return undefined;
  return { name: values.name, description: values.description };
}

function resolveWithinRoot(root: string, path: string): string {
  const normalizedPath = normalizeSkillFilePath(path);
  const resolved = resolve(root, normalizedPath);
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) throw new Error("skill file path escapes skill package");
  return resolved;
}

function normalizeSkillFilePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (normalized.length === 0) return "";
  if (isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) throw new Error("skill file path escapes skill package");
  const segments = normalized.split("/");
  if (segments.includes("..")) throw new Error("skill file path escapes skill package");
  if (segments.some((segment) => segment.length === 0 || segment === ".")) throw new Error(`invalid skill file path '${path}'`);
  if (normalized.toLowerCase() === "skill.md") throw new Error("skill file path 'SKILL.md' is reserved");
  return normalized;
}

function compositeRoomParticipantId(roomId: string, participantId: string): string {
  return `${roomId}:${participantId}`;
}

export function listRuntimeLocalSkills(provider: string, options: RuntimeLocalSkillOptions = {}): { readonly supported: boolean; readonly provider: string; readonly roots: readonly string[]; readonly skills: readonly RuntimeLocalSkillSummary[] } {
  const normalizedProvider = normalizeRuntimeProvider(provider);
  const roots = localSkillRootsForProvider(normalizedProvider, options);
  if (roots.length === 0) return { supported: false, provider: normalizedProvider, roots: [], skills: [] };

  const skillsByKey = new Map<string, RuntimeLocalSkillSummary>();
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    const visited = new Set<string>();
    const skills: RuntimeLocalSkillSummary[] = [];
    enumerateLocalSkillDirs(normalizedProvider, root.path, root.path, root.keyPrefix, 0, visited, options.homeDir, skills);
    for (const skill of skills) if (!skillsByKey.has(skill.key)) skillsByKey.set(skill.key, skill);
  }
  return {
    supported: true,
    provider: normalizedProvider,
    roots: roots.map((root) => root.path),
    skills: Array.from(skillsByKey.values()).sort((a, b) => a.key.localeCompare(b.key))
  };
}

export function loadRuntimeLocalSkillBundle(provider: string, skillKey: string, options: RuntimeLocalSkillOptions = {}): { readonly supported: boolean; readonly provider: string; readonly skill: RuntimeLocalSkillBundle | null } {
  const normalizedProvider = normalizeRuntimeProvider(provider);
  const roots = localSkillRootsForProvider(normalizedProvider, options);
  if (roots.length === 0) return { supported: false, provider: normalizedProvider, skill: null };

  const key = normalizeLocalSkillKey(skillKey);
  for (const root of roots) {
    const rel = root.keyPrefix.length > 0 && key.startsWith(`${root.keyPrefix}/`)
      ? key.slice(root.keyPrefix.length + 1)
      : root.keyPrefix.length === 0
        ? key
        : undefined;
    if (rel === undefined) continue;
    const skillDir = resolveWithinLocalRoot(root.path, rel);
    if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) continue;
    const content = readLocalSkillMainFile(skillDir);
    const frontmatter = parseLocalSkillFrontmatter(content);
    const files = collectLocalSkillFiles(skillDir, true);
    return {
      supported: true,
      provider: normalizedProvider,
      skill: {
        key,
        name: frontmatter.name || basename(skillDir),
        ...(frontmatter.description.length > 0 ? { description: frontmatter.description } : {}),
        sourcePath: relativizeHomePath(skillDir, options.homeDir),
        provider: normalizedProvider,
        fileCount: files.length + 1,
        content,
        files
      }
    };
  }
  return { supported: true, provider: normalizedProvider, skill: null };
}

function localSkillRootsForProvider(provider: string, options: RuntimeLocalSkillOptions): ReadonlyArray<{ readonly path: string; readonly keyPrefix: string }> {
  const home = options.homeDir ?? process.env.USERPROFILE ?? process.env.HOME ?? "";
  if (home.length === 0) return [];
  const env = options.env ?? process.env;
  if (provider === "claude") return [{ path: join(home, ".claude", "skills"), keyPrefix: "" }];
  if (provider === "codex") return [{ path: join((env.CODEX_HOME?.trim() || join(home, ".codex")), "skills"), keyPrefix: "" }];
  if (provider === "opencode") return [
    { path: join(home, ".config", "opencode", "skills"), keyPrefix: "" },
    { path: join(home, ".opencode", "skills"), keyPrefix: "opencode" },
    { path: join(home, ".opencode", "skill"), keyPrefix: "opencode-legacy" }
  ];
  if (provider === "qwen") return [{ path: join(home, ".qwen", "skills"), keyPrefix: "" }];
  if (provider === "goose") return [{ path: join(home, ".goose", "skills"), keyPrefix: "" }];
  if (provider === "cursor") return [{ path: join(home, ".cursor", "skills"), keyPrefix: "" }];
  if (provider === "kiro") return [{ path: join(home, ".kiro", "skills"), keyPrefix: "" }];
  return [];
}

function normalizeRuntimeProvider(provider: string): string {
  if (provider === "claude-code") return "claude";
  return provider;
}

function enumerateLocalSkillDirs(provider: string, walkRoot: string, currentDir: string, keyPrefix: string, depth: number, visited: Set<string>, homeDir: string | undefined, skills: RuntimeLocalSkillSummary[]): void {
  if (depth > LOCAL_SKILL_MAX_DIR_DEPTH) return;
  let resolved: string;
  try {
    resolved = realpathSync(currentDir);
  } catch {
    return;
  }
  if (visited.has(resolved)) return;
  visited.add(resolved);

  let entries: SkillDirent[];
  try {
    entries = readdirSync(currentDir, { withFileTypes: true }) as SkillDirent[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (isIgnoredLocalSkillEntry(entry.name)) continue;
    const entryPath = join(currentDir, entry.name);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(entryPath);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    const mainPath = join(entryPath, "SKILL.md");
    if (existsSync(mainPath)) {
      try {
        const rel = normalizeLocalSkillKey(relative(walkRoot, entryPath));
        const key = keyPrefix.length > 0 ? `${keyPrefix}/${rel}` : rel;
        const content = readLocalSkillMainFile(entryPath);
        const frontmatter = parseLocalSkillFrontmatter(content);
        const files = collectLocalSkillFiles(entryPath, false);
        skills.push({
          key,
          name: frontmatter.name || basename(entryPath),
          ...(frontmatter.description.length > 0 ? { description: frontmatter.description } : {}),
          sourcePath: relativizeHomePath(entryPath, homeDir),
          provider,
          fileCount: files.length + 1
        });
      } catch {
        // Ignore malformed or oversized local skills; the runtime may have stricter rules too.
      }
      continue;
    }
    enumerateLocalSkillDirs(provider, walkRoot, entryPath, keyPrefix, depth + 1, visited, homeDir, skills);
  }
}

function collectLocalSkillFiles(skillDir: string, includeContent: boolean): ReadonlyArray<{ readonly path: string; readonly content: string }> {
  const files: Array<{ readonly path: string; readonly content: string }> = [];
  const state = { totalBytes: 0 };
  const walkRoot = safeRealpath(skillDir) ?? skillDir;
  collectLocalSkillFilesInto(walkRoot, walkRoot, includeContent, state, files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function collectLocalSkillFilesInto(walkRoot: string, currentDir: string, includeContent: boolean, state: { totalBytes: number }, files: Array<{ readonly path: string; readonly content: string }>): void {
  const entries = readdirSync(currentDir, { withFileTypes: true }) as SkillDirent[];
  for (const entry of entries) {
    if (isIgnoredLocalSkillEntry(entry.name) || entry.name.toLowerCase() === "skill.md") continue;
    const entryPath = join(currentDir, entry.name);
    const linkStats = lstatSync(entryPath);
    if (linkStats.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      collectLocalSkillFilesInto(walkRoot, entryPath, includeContent, state, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = statSync(entryPath);
    if (stats.size > LOCAL_SKILL_MAX_FILE_BYTES) continue;
    if (files.length >= LOCAL_SKILL_MAX_FILE_COUNT) throw new Error(`local skill exceeds ${LOCAL_SKILL_MAX_FILE_COUNT} files`);
    state.totalBytes += stats.size;
    if (state.totalBytes > LOCAL_SKILL_MAX_TOTAL_BYTES) throw new Error(`local skill exceeds ${LOCAL_SKILL_MAX_TOTAL_BYTES} bytes in total`);
    const rel = normalizeSkillFilePath(toPosix(relative(walkRoot, entryPath)));
    files.push({ path: rel, content: includeContent ? readFileSync(entryPath, "utf8") : "" });
  }
}

function readLocalSkillMainFile(skillDir: string): string {
  const mainPath = join(skillDir, "SKILL.md");
  const stats = statSync(mainPath);
  if (stats.size > LOCAL_SKILL_MAX_FILE_BYTES) throw new Error(`SKILL.md exceeds ${LOCAL_SKILL_MAX_FILE_BYTES} bytes`);
  return readFileSync(mainPath, "utf8");
}

function parseLocalSkillFrontmatter(content: string): { readonly name: string; readonly description: string } {
  const lines = content.split(/\r?\n/u);
  if (lines[0] !== "---") return { name: "", description: "" };
  const values: { name?: string; description?: string } = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line === "---") break;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, "");
    if (key === "name") values.name = value;
    if (key === "description") values.description = value;
  }
  return { name: values.name ?? "", description: values.description ?? "" };
}

function resolveWithinLocalRoot(root: string, path: string): string {
  const normalizedPath = normalizeLocalSkillKey(path);
  const resolved = resolve(root, normalizedPath);
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) throw new Error("local skill key escapes runtime skill root");
  return resolved;
}

function normalizeLocalSkillKey(key: string): string {
  const normalized = toPosix(key.trim()).replace(/\/+/gu, "/");
  if (normalized.length === 0 || normalized === ".") throw new Error("skill key is required");
  if (isAbsolute(normalized) || /^[A-Za-z]:\//u.test(normalized) || normalized.startsWith("/") || normalized.startsWith("..")) throw new Error("invalid skill key");
  if (normalized.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) throw new Error("invalid skill key");
  return normalized;
}

function isIgnoredLocalSkillEntry(name: string): boolean {
  if (name.length === 0 || name.startsWith(".")) return true;
  return ["license", "license.md", "license.txt"].includes(name.toLowerCase());
}

function relativizeHomePath(path: string, homeDir: string | undefined): string {
  const home = homeDir ?? process.env.USERPROFILE ?? process.env.HOME;
  if (home === undefined || home.length === 0) return toPosix(path);
  const rel = relative(home, path);
  if (!rel.startsWith("..") && !rel.split(sep).includes("..")) return `~/${toPosix(rel)}`;
  return toPosix(path);
}

function safeRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function toPosix(path: string): string {
  return path.replace(/\\/gu, "/");
}

import { randomUUID } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

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

const RUNTIME_SKILL_DIRS: Record<string, string> = {
  "claude-code": ".claude/skills",
  codex: ".codex/skills",
  opencode: ".opencode/skills",
  qwen: ".qwen/skills",
  cursor: ".cursor/skills",
  native: ".agenthub/skills",
  mock: ".agenthub/skills"
};

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
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("UPDATE skills SET name = ?, description = ?, content = ?, updated_at = ? WHERE id = ?").run(name, description, content, now, input.skillId);
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
      for (const skillId of Array.from(pool.keys())) if (!restrictIds.has(skillId)) pool.delete(skillId);
      for (const skillId of restrictIds) {
        const row = this.getSkill(skillId);
        if (row !== undefined) pool.set(row.id, row);
      }
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
      this.options.eventBus.publish({ id: randomUUID(), type: "skill.materialization_failed", schemaVersion: 1, workspaceId, runId: input.runId, payload: { skillId: skills[0]?.id ?? "unknown", runId: input.runId, error: error instanceof Error ? error.message : String(error) }, createdAt: this.now() });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  cleanupRun(runId: string): void {
    const paths = this.materializedRuns.get(runId);
    if (paths === undefined) return;
    this.cleanupPaths(paths);
    this.materializedRuns.delete(runId);
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
  return files.filter((file) => file.path.length > 0);
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
  const resolved = resolve(root, path);
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) throw new Error("skill file path escapes skill package");
  return resolved;
}

function compositeRoomParticipantId(roomId: string, participantId: string): string {
  return `${roomId}:${participantId}`;
}

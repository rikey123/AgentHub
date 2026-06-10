import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import { defaultRoleAvatarUrl, dicebearAvatarUrl } from "@agenthub/protocol/avatars";

type BuiltinRoleTemplate = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly prompt: string;
};

const BUILTIN_ROLE_VERSION = "1.0.0";
const DEFAULT_WORKSPACE_ID = "default-workspace";

export const BUILTIN_ROLE_TEMPLATES: readonly BuiltinRoleTemplate[] = [
  {
    id: "project-manager",
    name: "Project Manager",
    description: "Breaks work into tasks and routes execution to the right agents.",
    version: BUILTIN_ROLE_VERSION,
    capabilities: ["chat", "task.delegate", "context.read", "context.write"],
    prompt: "You are the project manager. Break requests into clear tasks, route work to suitable teammates, track progress, and keep the user informed with concise status updates."
  },
  {
    id: "builder",
    name: "Builder",
    description: "General-purpose code builder.",
    version: BUILTIN_ROLE_VERSION,
    capabilities: ["chat", "code.edit", "file.read", "file.write", "terminal.run", "context.read", "context.write"],
    prompt: "You are the builder. Implement scoped code changes, follow existing project conventions, verify your work with tests or builds, and report concrete results."
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description: "Reviews code and can knock with intervention feedback.",
    version: BUILTIN_ROLE_VERSION,
    capabilities: ["chat", "code.review", "context.read", "context.write", "intervention.knock"],
    prompt: "You are the reviewer. Inspect changes for correctness, maintainability, security, and test coverage. Raise focused intervention feedback when a risk needs attention."
  },
  {
    id: "archivist",
    name: "Archivist",
    description: "Archives context and produces confirmed summaries.",
    version: BUILTIN_ROLE_VERSION,
    capabilities: ["chat", "context.read", "context.write"],
    prompt: "You are the archivist. Read the current context, identify durable facts, and write concise confirmed summaries that future agents can rely on."
  },
  {
    id: "generalist",
    name: "Generalist",
    description: "General assistant without a specialized focus.",
    version: BUILTIN_ROLE_VERSION,
    capabilities: ["chat", "context.read"],
    prompt: "You are a generalist assistant. Help with a broad range of tasks, ask only when necessary, and keep responses clear and practical."
  }
];

export function defaultBuiltinRolesDir(): string {
  return join(homedir(), ".agenthub", "roles");
}

export function seedBuiltinRoles(database: AgentHubDatabase, rolesDir: string, eventBus: EventBus, now: number): void {
  mkdirSync(rolesDir, { recursive: true });
  const roleFiles = readdirSync(rolesDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  const shouldWriteTemplates = roleFiles.length === 0;

  database.sqlite.transaction(() => {
    for (const template of BUILTIN_ROLE_TEMPLATES) {
      const sourcePath = join(rolesDir, `${template.id}.md`);
      seedBuiltinRoleFile(template, sourcePath, shouldWriteTemplates);
      const inserted = insertBuiltinRole(database, template, sourcePath, now);
      if (inserted) {
        eventBus.publish({
          id: randomUUID(),
          type: "role.created",
          schemaVersion: 1,
          workspaceId: DEFAULT_WORKSPACE_ID,
          payload: { roleId: template.id, isBuiltin: true },
          createdAt: now
        });
      }
    }
  })();
}

function seedBuiltinRoleFile(template: BuiltinRoleTemplate, sourcePath: string, shouldWriteTemplates: boolean): void {
  if (existsSync(sourcePath)) {
    const existingVersion = readFrontmatterVersion(readFileSync(sourcePath, "utf8"));
    if (existingVersion !== undefined && compareVersions(existingVersion, template.version) < 0) {
      process.stderr.write(`Builtin role '${template.id}' has an update; run \`agenthub roles reset --id=${template.id}\` to overwrite\n`);
    }
    return;
  }
  if (!shouldWriteTemplates) return;
  writeFileSync(sourcePath, renderBuiltinRoleMarkdown(template), "utf8");
}

function insertBuiltinRole(database: AgentHubDatabase, template: BuiltinRoleTemplate, sourcePath: string, now: number): boolean {
  const existing = database.sqlite.prepare("SELECT 1 FROM roles WHERE id = ?").get(template.id);
  const legacyAvatar = legacyBuiltinRoleAvatar(template.id);
  const result = database.sqlite.prepare(
    `INSERT INTO roles (
      id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id,
      tags, is_builtin, source_path, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      name = excluded.name,
      avatar = CASE
        WHEN roles.avatar IS NULL
          OR roles.avatar = ''
          OR (
            roles.avatar NOT LIKE '/avatars/%'
            AND roles.avatar NOT LIKE 'http://%'
            AND roles.avatar NOT LIKE 'https://%'
            AND roles.avatar NOT LIKE 'data:image/%'
          )
          OR roles.avatar = ?
        THEN excluded.avatar
        ELSE roles.avatar
      END,
      description = excluded.description,
      prompt = excluded.prompt,
      capabilities = excluded.capabilities,
      tags = excluded.tags,
      is_builtin = 1,
      source_path = excluded.source_path,
      version = excluded.version,
      updated_at = excluded.updated_at
    WHERE roles.is_builtin = 1`
  ).run(
    template.id,
    DEFAULT_WORKSPACE_ID,
    template.name,
    defaultRoleAvatarUrl(template.id),
    template.description,
    template.prompt,
    JSON.stringify(template.capabilities),
    JSON.stringify(["builtin"]),
    sourcePath,
    template.version,
    now,
    now,
    legacyAvatar
  );
  void result;
  return existing === undefined;
}

function legacyBuiltinRoleAvatar(roleId: string): string | null {
  if (roleId === "project-manager") return dicebearAvatarUrl("personas", "role:project-manager");
  return null;
}

function renderBuiltinRoleMarkdown(template: BuiltinRoleTemplate): string {
  return `---\nname: ${template.name}\navatar: ${defaultRoleAvatarUrl(template.id)}\nversion: ${template.version}\ncapabilities:\n${template.capabilities.map((capability) => `  - ${capability}`).join("\n")}\n---\n\n${template.prompt}\n`;
}

function readFrontmatterVersion(markdown: string): string | undefined {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return undefined;
  const version = frontmatter[1]?.match(/^version:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim();
  return version === "" ? undefined : version;
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function versionParts(version: string): readonly number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10)).map((part) => Number.isFinite(part) ? part : 0);
}

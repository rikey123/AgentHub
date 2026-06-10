import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import chokidar, { type FSWatcher } from "chokidar";
import matter from "gray-matter";

export type AgentProvider = "native" | "claude-code" | "opencode" | "codex" | "langgraph" | "a2a";
export type AgentPresence = "offline" | "observing" | "active";
export type AgentCapability =
  | "chat"
  | "code.edit"
  | "code.review"
  | "terminal.run"
  | "file.read"
  | "file.write"
  | "web.search"
  | "web.fetch"
  | "context.read"
  | "context.write"
  | "intervention.knock"
  | "task.delegate";

export type AgentProfile = {
  readonly id: string;
  readonly workspaceId?: string;
  readonly name: string;
  readonly description?: string;
  readonly avatar?: string;
  readonly version?: string;
  readonly provider: AgentProvider;
  readonly adapterId: string;
  readonly model?: string;
  readonly prompt: string;
  readonly defaultPresence: AgentPresence;
  readonly capabilities: readonly AgentCapability[];
  readonly permissionProfileId?: string;
  readonly hidden: boolean;
  readonly sourcePath: string;
};

export type BootstrapBuiltInAgentsOptions = {
  readonly agentsDir?: string;
  readonly templatesDir?: string;
  readonly stderr?: Pick<NodeJS.WriteStream, "write">;
};

export type WatchAgentProfilesOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly userAgentsDir?: string;
  readonly stderr?: Pick<NodeJS.WriteStream, "write">;
  readonly now?: () => number;
};

export type AgentProfileWatcher = { readonly watcher: FSWatcher; readonly ready: Promise<void>; close(): Promise<void> };

type BuiltInTemplate = { readonly id: string; readonly fileName: string; readonly path: string; readonly content: string; readonly version: string };
type WatchSource = { readonly dir: string; readonly workspaceId?: string };
type AgentProfileRow = { readonly id: string; readonly workspace_id: string | null; readonly source_path: string | null };

const sourceDir = dirname(fileURLToPath(import.meta.url));
const defaultTemplatesDir = resolve(sourceDir, "..", "templates");
const builtInTemplateIds = ["mock-builder", "mock-reviewer", "claude-code-builder", "claude-code-reviewer", "builder-opencode", "reviewer", "archivist"] as const;
const agentProviders = new Set<AgentProvider>(["native", "claude-code", "opencode", "codex", "langgraph", "a2a"]);
const agentPresences = new Set<AgentPresence>(["offline", "observing", "active"]);
const agentCapabilities = new Set<AgentCapability>(["chat", "code.edit", "code.review", "terminal.run", "file.read", "file.write", "web.search", "web.fetch", "context.read", "context.write", "intervention.knock", "task.delegate"]);

export function defaultUserAgentsDir(home = homedir()): string {
  return join(home, ".agenthub", "agents");
}

export function builtInAgentTemplates(templatesDir = defaultTemplatesDir): readonly BuiltInTemplate[] {
  return builtInTemplateIds.map((id) => {
    const path = join(templatesDir, `${id}.md`);
    const content = readFileSync(path, "utf8");
    const parsed = parseAgentProfileMarkdown(path, content);
    return { id, fileName: `${id}.md`, path, content, version: parsed.version ?? "0.0.0" };
  });
}

export function bootstrapBuiltInAgents(options: BootstrapBuiltInAgentsOptions = {}): void {
  const agentsDir = options.agentsDir ?? defaultUserAgentsDir();
  const stderr = options.stderr ?? process.stderr;
  mkdirSync(agentsDir, { recursive: true });
  for (const template of builtInAgentTemplates(options.templatesDir)) {
    const targetPath = join(agentsDir, template.fileName);
    if (!existsSync(targetPath)) {
      writeFileSync(targetPath, template.content, { encoding: "utf8", flag: "wx" });
      continue;
    }
    const existingVersion = versionFromMarkdown(targetPath);
    if (existingVersion !== undefined && compareSemver(existingVersion, template.version) < 0) {
      stderr.write(`Builtin agent '${template.id}' has an update; run \`agenthub agents reset --id=${template.id}\` to overwrite\n`);
    }
  }
}

export function resetBuiltInAgentTemplate(agentId: string, agentsDir = defaultUserAgentsDir(), templatesDir = defaultTemplatesDir): string {
  const template = builtInAgentTemplates(templatesDir).find((candidate) => candidate.id === agentId);
  if (template === undefined) throw new Error(`Unknown built-in agent '${agentId}'`);
  mkdirSync(agentsDir, { recursive: true });
  const targetPath = join(agentsDir, template.fileName);
  writeFileSync(targetPath, template.content, "utf8");
  return targetPath;
}

export function parseAgentProfileFile(path: string, workspaceId?: string): AgentProfile {
  return parseAgentProfileMarkdown(path, readFileSync(path, "utf8"), workspaceId);
}

export function parseAgentProfileMarkdown(path: string, markdown: string, workspaceId?: string): AgentProfile {
  const parsed = matter(markdown);
  const data = parsed.data as Record<string, unknown>;
  const id = requiredString(data, "id");
  const name = requiredString(data, "name");
  const provider = enumString(data, "provider", agentProviders);
  const adapterId = requiredString(data, "adapterId");
  const defaultPresence = enumString(data, "defaultPresence", agentPresences);
  const capabilities = capabilitiesField(data.capabilities);
  return {
    id,
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    name,
    ...optionalString(data, "description"),
    ...optionalString(data, "avatar"),
    ...optionalString(data, "version"),
    provider,
    adapterId,
    ...optionalString(data, "model"),
    prompt: parsed.content.trim(),
    defaultPresence,
    capabilities,
    ...optionalString(data, "permissionProfileId"),
    hidden: data.hidden === true,
    sourcePath: path
  };
}

export function upsertAgentProfile(database: AgentHubDatabase, profile: AgentProfile, now = Date.now()): void {
  const existing = database.sqlite.prepare("SELECT created_at FROM agent_profiles WHERE id = ? AND workspace_id IS ?").get(profile.id, profile.workspaceId ?? null) as { readonly created_at: number } | undefined;
  database.sqlite.prepare(
    `INSERT INTO agent_profiles (
      id, workspace_id, name, description, avatar, version, provider, default_presence, adapter_id, model,
      role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      name = excluded.name,
      description = excluded.description,
      avatar = excluded.avatar,
      version = excluded.version,
      provider = excluded.provider,
      default_presence = excluded.default_presence,
      adapter_id = excluded.adapter_id,
      model = excluded.model,
      role_prompt = excluded.role_prompt,
      capabilities = excluded.capabilities,
      permission_profile_id = excluded.permission_profile_id,
      hidden = excluded.hidden,
      source_path = excluded.source_path,
      updated_at = excluded.updated_at`
  ).run(profile.id, profile.workspaceId ?? null, profile.name, profile.description ?? null, profile.avatar ?? null, profile.version ?? null, profile.provider, profile.defaultPresence, profile.adapterId, profile.model ?? null, profile.prompt, JSON.stringify(profile.capabilities), profile.permissionProfileId ?? null, profile.hidden ? 1 : 0, profile.sourcePath, existing?.created_at ?? now, now);
}

export function removeAgentProfile(database: AgentHubDatabase, sourcePath: string, now = Date.now()): AgentProfileRow | undefined {
  const row = database.sqlite.prepare("SELECT id, workspace_id, source_path FROM agent_profiles WHERE source_path = ?").get(sourcePath) as AgentProfileRow | undefined;
  if (row === undefined) return undefined;
  const activeRun = database.sqlite.prepare("SELECT id FROM runs WHERE agent_id = ? AND status IN ('queued', 'waiting', 'claimed', 'starting', 'running', 'waiting_permission', 'cancelling') LIMIT 1").get(row.id);
  if (activeRun === undefined) {
    database.sqlite.prepare("DELETE FROM agent_profiles WHERE id = ? AND workspace_id IS ?").run(row.id, row.workspace_id);
  } else {
    database.sqlite.prepare("UPDATE agent_profiles SET hidden = 1, updated_at = ? WHERE id = ? AND workspace_id IS ?").run(now, row.id, row.workspace_id);
  }
  return row;
}

export function watchAgentProfiles(options: WatchAgentProfilesOptions): AgentProfileWatcher {
  const sources = agentWatchSources(options.database, options.userAgentsDir ?? defaultUserAgentsDir());
  for (const source of sources) mkdirSync(source.dir, { recursive: true });
  const byDir = new Map(sources.map((source) => [resolve(source.dir), source]));
  const watcher = chokidar.watch(sources.map((source) => source.dir), {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 200 }
  });
  const ready = new Promise<void>((resolveReady) => { watcher.on("ready", resolveReady); });
  watcher.on("add", (path) => { if (path.endsWith(".md")) handleProfileUpsert(path, byDir, options); });
  watcher.on("change", (path) => { if (path.endsWith(".md")) handleProfileUpsert(path, byDir, options); });
  watcher.on("unlink", (path) => { if (path.endsWith(".md")) handleProfileUnlink(path, options); });
  return { watcher, ready, close: () => watcher.close() };
}

function agentWatchSources(database: AgentHubDatabase, userAgentsDir: string): readonly WatchSource[] {
  const workspaceRows = database.sqlite.prepare("SELECT id, root_path FROM workspaces WHERE root_path IS NOT NULL").all() as { readonly id: string; readonly root_path: string }[];
  return [
    { dir: userAgentsDir },
    ...workspaceRows.map((row) => ({ dir: join(row.root_path, ".agenthub", "agents"), workspaceId: row.id }))
  ];
}

function handleProfileUpsert(path: string, byDir: ReadonlyMap<string, WatchSource>, options: WatchAgentProfilesOptions): void {
  try {
    const source = byDir.get(resolve(dirname(path)));
    const profile = parseAgentProfileFile(path, source?.workspaceId);
    const now = options.now?.() ?? Date.now();
    upsertAgentProfile(options.database, profile, now);
    options.eventBus.publish({ id: randomUUID(), type: "agent.profile.updated", schemaVersion: 1, workspaceId: profile.workspaceId ?? "default-workspace", agentId: profile.id, payload: { agentId: profile.id, workspaceId: profile.workspaceId ?? null, sourcePath: path }, createdAt: now });
  } catch (error) {
    emitProfileError(path, error, options);
  }
}

function handleProfileUnlink(path: string, options: WatchAgentProfilesOptions): void {
  const now = options.now?.() ?? Date.now();
  const removed = removeAgentProfile(options.database, path, now);
  if (removed === undefined) return;
  options.eventBus.publish({ id: randomUUID(), type: "agent.profile.removed", schemaVersion: 1, workspaceId: removed.workspace_id ?? "default-workspace", agentId: removed.id, payload: { agentId: removed.id, workspaceId: removed.workspace_id }, createdAt: now });
}

function emitProfileError(path: string, error: unknown, options: WatchAgentProfilesOptions): void {
  const reason = error instanceof Error ? error.message : String(error);
  const now = options.now?.() ?? Date.now();
  (options.stderr ?? process.stderr).write(`agent profile parse failed at ${path}: ${reason}\n`);
  options.eventBus.publish({ id: randomUUID(), type: "agent.profile.error", schemaVersion: 1, workspaceId: "default-workspace", payload: { path, reason }, createdAt: now });
}

function versionFromMarkdown(path: string): string | undefined {
  try {
    const version = matter(readFileSync(path, "utf8")).data.version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

function compareSemver(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function requiredString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`missing ${key}`);
  return value;
}

function optionalString(data: Record<string, unknown>, key: string): Record<string, string> {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? { [key]: value } : {};
}

function enumString<T extends string>(data: Record<string, unknown>, key: string, values: ReadonlySet<T>): T {
  const value = requiredString(data, key);
  if (!values.has(value as T)) throw new Error(`invalid ${key}`);
  return value as T;
}

function capabilitiesField(value: unknown): readonly AgentCapability[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("missing capabilities");
  return value.map((capability) => {
    if (typeof capability !== "string" || !agentCapabilities.has(capability as AgentCapability)) throw new Error(`invalid capability ${String(capability)}`);
    return capability as AgentCapability;
  });
}

export function agentIdFromTemplatePath(path: string): string {
  return basename(path, ".md");
}

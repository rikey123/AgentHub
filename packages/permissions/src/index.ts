import { randomUUID } from "node:crypto";
import { relative, resolve, sep } from "node:path";

import type { Command, CommandHandler, CommandMeta, CommandResult, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type PermissionAction = "allow" | "ask" | "deny";
export type PermissionDecision = "allowed" | "denied" | "expired";
export type PermissionResource =
  | { readonly type: "file"; readonly path: string; readonly operation: "read" | "write" | "delete" }
  | { readonly type: "shell"; readonly command: string }
  | { readonly type: "tool"; readonly toolName: string; readonly input?: unknown }
  | { readonly type: "context"; readonly contextId?: string; readonly operation: "read" | "write" | "share" | "memoryWrite" }
  | { readonly type: "agent"; readonly targetAgentId: string; readonly operation: "mention" | "invoke" | "interrupt" | "control" };

export type PermissionProfile = {
  readonly id: string;
  readonly name: string;
  readonly file: { readonly read: PermissionAction; readonly write: PermissionAction; readonly delete: PermissionAction; readonly externalDirectory: PermissionAction };
  readonly shell: Readonly<Record<string, PermissionAction>>;
  readonly tool: Readonly<Record<string, PermissionAction>>;
  readonly context: { readonly read: PermissionAction; readonly write: PermissionAction; readonly share: PermissionAction; readonly memoryWrite: PermissionAction };
  readonly agent: { readonly mention: PermissionAction; readonly invoke: PermissionAction; readonly interrupt: PermissionAction; readonly control: PermissionAction };
  readonly sensitiveFileWhitelist?: readonly string[];
};

export type PermissionCheckInput = {
  readonly workspaceId: string;
  readonly roomId?: string;
  readonly agentId?: string;
  readonly runId?: string;
  readonly adapterSessionId?: string;
  readonly idempotencyKey?: string;
  readonly profileId?: string;
  readonly workspaceRoot?: string;
  readonly resource: PermissionResource;
  readonly reason?: string;
  readonly concurrentPermission?: boolean;
};

export type PermissionCheckResult =
  | { readonly status: "allow"; readonly reason: string; readonly requestId?: string; readonly matchedRuleId?: string }
  | { readonly status: "deny"; readonly reason: string; readonly requestId?: string; readonly matchedRuleId?: string }
  | { readonly status: "ask"; readonly requestId: string; readonly promise: Promise<PermissionResolution> };

export type PermissionResolution = { readonly decision: PermissionDecision; readonly reason: string; readonly requestId: string };

type PermissionRequestRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly room_id: string | null;
  readonly agent_id: string | null;
  readonly run_id: string | null;
  readonly adapter_session_id: string | null;
  readonly idempotency_key: string | null;
  readonly resource: string;
  readonly reason: string | null;
  readonly status: string;
  readonly remember_decision: number;
  readonly scope: string | null;
  readonly decision: string | null;
  readonly created_at: number;
  readonly resolved_at: number | null;
  readonly expires_at: number | null;
};

type RuleRow = { readonly id: string; readonly action: PermissionAction; readonly resource_match: string; readonly resource_type: string };
type ProfileRow = { readonly id: string; readonly name: string; readonly payload: string };
type Deferred = { readonly promise: Promise<PermissionResolution>; readonly resolve: (value: PermissionResolution) => void; readonly timer?: ReturnType<typeof setTimeout> };

const sensitiveFileGlobs = [".env", ".env.*", "*.pem", "*.key", "id_rsa", "id_ed25519", ".aws/**", ".gcp/**", ".ssh/**", ".netrc", "**/credentials.json", "**/service-account*.json"];
const defaultTimeoutMs = 60_000;
const defaultMaxWaitMs = 600_000;

export const builtInPermissionProfiles: readonly PermissionProfile[] = [
  { id: "builder-strict", name: "Builder Strict", file: { read: "allow", write: "ask", delete: "ask", externalDirectory: "ask" }, shell: { "*": "ask" }, tool: { "*": "ask" }, context: { read: "allow", write: "ask", share: "ask", memoryWrite: "deny" }, agent: { mention: "allow", invoke: "ask", interrupt: "deny", control: "deny" }, sensitiveFileWhitelist: sensitiveFileGlobs },
  { id: "builder-loose", name: "Builder Loose", file: { read: "allow", write: "allow", delete: "ask", externalDirectory: "ask" }, shell: { "git *": "allow", "git push *": "ask", "npm test*": "allow", "pnpm test*": "allow", "pnpm.cmd test*": "allow", "*": "ask" }, tool: { "*": "ask" }, context: { read: "allow", write: "allow", share: "ask", memoryWrite: "deny" }, agent: { mention: "allow", invoke: "ask", interrupt: "ask", control: "deny" }, sensitiveFileWhitelist: sensitiveFileGlobs },
  { id: "read-only", name: "Read Only", file: { read: "allow", write: "deny", delete: "deny", externalDirectory: "deny" }, shell: { "*": "deny" }, tool: { "*": "ask" }, context: { read: "allow", write: "deny", share: "deny", memoryWrite: "deny" }, agent: { mention: "allow", invoke: "deny", interrupt: "deny", control: "deny" }, sensitiveFileWhitelist: sensitiveFileGlobs }
];

export class PermissionEngine {
  private readonly deferreds = new Map<string, Deferred>();
  private readonly sessionQueues = new Map<string, string[]>();
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxWaitMs: number;

  constructor(private readonly options: { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly now?: () => number; readonly timeoutMs?: number; readonly maxWaitMs?: number }) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.maxWaitMs = options.maxWaitMs ?? defaultMaxWaitMs;
  }

  seedBuiltInProfiles(): void {
    seedBuiltInPermissionProfiles(this.options.database, this.now());
  }

  close(): void {
    for (const deferred of this.deferreds.values()) {
      if (deferred.timer) clearTimeout(deferred.timer);
    }
    this.deferreds.clear();
    this.sessionQueues.clear();
  }

  check(input: PermissionCheckInput): PermissionCheckResult {
    this.expireDueRequests();
    const idem = this.findIdempotent(input);
    if (idem?.status === "pending") return this.pendingResult(idem);
    if (idem?.status === "allowed" && idem.resolved_at !== null && this.now() - idem.resolved_at <= 5_000) {
      this.publishResolved(input, { decision: "allow", reason: "short_circuit_repeat", requested: false, requestId: idem.id });
      return { status: "allow", reason: "short_circuit_repeat", requestId: idem.id };
    }

    const profile = this.profileFor(input.profileId);
    const resourceType = resourceTypeFor(input.resource);
    const stored = this.matchStoredRule(input, resourceType);
    if (stored) {
      this.publishResolved(input, { decision: stored.action, reason: `matched stored rule ${stored.id}`, requested: false, matchedRuleId: stored.id });
      return stored.action === "allow" ? { status: "allow", reason: "matched stored rule", matchedRuleId: stored.id } : { status: "deny", reason: "matched stored rule", matchedRuleId: stored.id };
    }

    const evaluated = this.evaluate(profile, input);
    if (evaluated.action === "allow") {
      this.publishResolved(input, { decision: "allow", reason: evaluated.reason, requested: false });
      return { status: "allow", reason: evaluated.reason };
    }
    if (evaluated.action === "deny") {
      this.publishResolved(input, { decision: "deny", reason: evaluated.reason, requested: false });
      return { status: "deny", reason: evaluated.reason };
    }

    return this.createAsk(input, evaluated.reason);
  }

  resolve(requestId: string, decision: "allow" | "deny", remember = false, scope = "once", reason?: string): PermissionResolution | undefined {
    const row = this.requestById(requestId);
    if (!row || row.status !== "pending") return undefined;
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("UPDATE permission_requests SET status = ?, decision = ?, remember_decision = ?, scope = ?, resolved_at = ? WHERE id = ?").run(decision === "allow" ? "allowed" : "denied", decision, remember ? 1 : 0, scope, now, requestId);
      if (decision === "allow" && remember && scope === "this_workspace") {
        const resource = JSON.parse(row.resource) as PermissionResource;
        this.options.database.sqlite.prepare("INSERT INTO permission_rules (id, workspace_id, agent_id, profile_id, resource_type, resource_match, action, remember, created_at) VALUES (?, ?, ?, NULL, ?, ?, 'allow', 1, ?)").run(randomUUID(), row.workspace_id, row.agent_id, resourceTypeFor(resource), resourceMatchFor(resource), now);
      }
      this.options.eventBus.publish(permissionEvent("permission.resolved", row.workspace_id, row.room_id ?? undefined, row.run_id ?? undefined, row.agent_id ?? undefined, { audit: true, actor: { type: row.agent_id ? "agent" : "user", id: row.agent_id ?? "local" }, action: "resolve", target: `permission-request:${requestId}`, outcome: decision, requestId, resource: JSON.parse(row.resource) as unknown, decision, reason: reason ?? "user_resolved", remembered: remember, requested: true }, now));
    })();
    const resolved: PermissionResolution = { requestId, decision: decision === "allow" ? "allowed" : "denied", reason: reason ?? "user_resolved" };
    this.releaseRequest(row, resolved);
    return resolved;
  }

  expireDueRequests(now = this.now()): void {
    const rows = this.options.database.sqlite.prepare("SELECT * FROM permission_requests WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY created_at ASC").all(now) as PermissionRequestRow[];
    for (const row of rows) this.expireRow(row, "timeout");
    const maxRows = this.options.database.sqlite.prepare("SELECT * FROM permission_requests WHERE status = 'pending' AND created_at <= ? ORDER BY created_at ASC").all(now - this.maxWaitMs) as PermissionRequestRow[];
    for (const row of maxRows) this.expireRow(row, "expired_max_wait");
  }

  private createAsk(input: PermissionCheckInput, reason: string): PermissionCheckResult {
    const requestId = randomUUID();
    const now = this.now();
    this.options.database.sqlite.prepare(`INSERT INTO permission_requests (id, workspace_id, room_id, agent_id, run_id, adapter_session_id, idempotency_key, resource, reason, status, remember_decision, scope, decision, created_at, resolved_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, NULL, NULL)`).run(requestId, input.workspaceId, input.roomId ?? null, input.agentId ?? null, input.runId ?? null, input.adapterSessionId ?? null, input.idempotencyKey ?? null, JSON.stringify(input.resource), reason, now);
    let resolvePromise: (value: PermissionResolution) => void = () => undefined;
    const promise = new Promise<PermissionResolution>((resolveDeferred) => {
      resolvePromise = resolveDeferred;
    });
    this.deferreds.set(requestId, { promise, resolve: resolvePromise });
    if (input.adapterSessionId && !input.concurrentPermission) {
      const queue = this.sessionQueues.get(input.adapterSessionId) ?? [];
      queue.push(requestId);
      this.sessionQueues.set(input.adapterSessionId, queue);
      if (queue.length === 1) this.presentRequest(requestId, input, reason);
    } else {
      this.presentRequest(requestId, input, reason);
    }
    return { status: "ask", requestId, promise };
  }

  private presentRequest(requestId: string, input: PermissionCheckInput, reason: string): void {
    const row = this.requestById(requestId);
    if (!row || row.status !== "pending") return;
    if (row.expires_at !== null) return;
    const now = this.now();
    const maxDeadline = row.created_at + this.maxWaitMs;
    if (maxDeadline <= now) {
      this.expireRow(row, "expired_max_wait");
      return;
    }
    const expiresAt = Math.min(now + this.timeoutMs, maxDeadline);
    this.options.database.sqlite.prepare("UPDATE permission_requests SET expires_at = ? WHERE id = ? AND status = 'pending' AND expires_at IS NULL").run(expiresAt, requestId);
    const existing = this.deferreds.get(requestId);
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      const delay = Math.max(0, expiresAt - now);
      const timer = setTimeout(() => {
        const active = this.requestById(requestId);
        if (active?.status === "pending" && active.expires_at !== null && active.expires_at <= this.now()) this.expireRow(active, "timeout");
      }, delay);
      timer.unref?.();
      this.deferreds.set(requestId, { ...existing, timer });
    }
    this.publishRequested(requestId, input, reason, now, expiresAt);
  }

  private pendingResult(row: PermissionRequestRow): PermissionCheckResult {
    const existing = this.deferreds.get(row.id);
    if (existing) {
      return { status: "ask", requestId: row.id, promise: existing.promise };
    }
    return { status: "ask", requestId: row.id, promise: Promise.resolve({ requestId: row.id, decision: "expired", reason: "pending_request_recovered_without_deferred" }) };
  }

  private releaseRequest(row: PermissionRequestRow, resolution: PermissionResolution): void {
    const deferred = this.deferreds.get(row.id);
    if (deferred) {
      if (deferred.timer) clearTimeout(deferred.timer);
      deferred.resolve(resolution);
      this.deferreds.delete(row.id);
    }
    if (row.adapter_session_id) {
      const queue = (this.sessionQueues.get(row.adapter_session_id) ?? []).filter((id) => id !== row.id);
      if (queue.length === 0) this.sessionQueues.delete(row.adapter_session_id);
      else {
        this.sessionQueues.set(row.adapter_session_id, queue);
        const nextId = queue[0];
        const next = nextId === undefined ? undefined : this.requestById(nextId);
        if (next && next.status === "pending") this.presentRequest(next.id, rowToInput(next), next.reason ?? "queued permission");
      }
    }
  }

  private expireRow(row: PermissionRequestRow, reason: string): void {
    const now = this.now();
    const changed = this.options.database.sqlite.prepare("UPDATE permission_requests SET status = 'expired', decision = 'deny', resolved_at = ? WHERE id = ? AND status = 'pending'").run(now, row.id).changes;
    if (changed === 0) return;
    this.options.eventBus.publish(permissionEvent("permission.resolved", row.workspace_id, row.room_id ?? undefined, row.run_id ?? undefined, row.agent_id ?? undefined, { requestId: row.id, resource: JSON.parse(row.resource) as unknown, decision: "deny", reason, remembered: false, requested: true }, now));
    publishAuditEvent(this.options.eventBus, {
      type: "permission.resolved",
      workspaceId: row.workspace_id,
      ...(row.room_id !== null ? { roomId: row.room_id } : {}),
      ...(row.run_id !== null ? { runId: row.run_id } : {}),
      ...(row.agent_id !== null ? { agentId: row.agent_id } : {}),
      actor: { type: row.agent_id ? "agent" : "user", id: row.agent_id ?? "local" },
      action: "resolve",
      target: `permission-request:${row.id}`,
      outcome: "deny",
      createdAt: now,
      payload: { requestId: row.id, reason }
    });
    this.releaseRequest(row, { requestId: row.id, decision: "expired", reason });
  }

  private evaluate(profile: PermissionProfile, input: PermissionCheckInput): { readonly action: PermissionAction; readonly reason: string } {
    const resource = input.resource;
    if (resource.type === "file") return evaluateFile(profile, input.workspaceRoot ?? this.workspaceRoot(input.workspaceId), resource);
    if (resource.type === "shell") return evaluateShell(profile, resource.command);
    if (resource.type === "tool") return { action: profile.tool[resource.toolName] ?? profile.tool["*"] ?? "ask", reason: `tool.${resource.toolName}` };
    if (resource.type === "context") return { action: profile.context[resource.operation], reason: `context.${resource.operation}` };
    return { action: profile.agent[resource.operation], reason: `agent.${resource.operation}` };
  }

  private matchStoredRule(input: PermissionCheckInput, resourceType: string): RuleRow | undefined {
    const rows = this.options.database.sqlite.prepare("SELECT id, action, resource_match, resource_type FROM permission_rules WHERE workspace_id = ? AND resource_type = ? AND (agent_id IS NULL OR agent_id = ?) ORDER BY agent_id DESC, created_at DESC").all(input.workspaceId, resourceType, input.agentId ?? null) as RuleRow[];
    return rows.find((row) => globMatch(row.resource_match, resourceMatchFor(input.resource)) || globMatch(row.resource_match, resourceValueFor(input.resource)));
  }

  private findIdempotent(input: PermissionCheckInput): PermissionRequestRow | undefined {
    if (!input.adapterSessionId || !input.idempotencyKey) return undefined;
    return this.options.database.sqlite.prepare("SELECT * FROM permission_requests WHERE adapter_session_id = ? AND idempotency_key = ? ORDER BY created_at DESC LIMIT 1").get(input.adapterSessionId, input.idempotencyKey) as PermissionRequestRow | undefined;
  }

  private profileFor(profileId?: string): PermissionProfile {
    const id = profileId ?? "builder-strict";
    const row = this.options.database.sqlite.prepare("SELECT id, name, payload FROM permission_profiles WHERE id = ?").get(id) as ProfileRow | undefined;
    if (!row) return builtInPermissionProfiles.find((profile) => profile.id === "builder-strict") as PermissionProfile;
    return { id: row.id, name: row.name, ...(JSON.parse(row.payload) as Omit<PermissionProfile, "id" | "name">) };
  }

  private workspaceRoot(workspaceId: string): string {
    const row = this.options.database.sqlite.prepare("SELECT root_path FROM workspaces WHERE id = ?").get(workspaceId) as { readonly root_path: string } | undefined;
    return row?.root_path ?? process.cwd();
  }

  private requestById(id: string): PermissionRequestRow | undefined {
    return this.options.database.sqlite.prepare("SELECT * FROM permission_requests WHERE id = ?").get(id) as PermissionRequestRow | undefined;
  }

  private publishRequested(requestId: string, input: PermissionCheckInput, reason: string, createdAt: number, expiresAt: number): void {
    this.options.eventBus.publish(permissionEvent("permission.requested", input.workspaceId, input.roomId, input.runId, input.agentId, { requestId, resource: input.resource, reason, status: "pending", expiresAt, adapterSessionId: input.adapterSessionId }, createdAt));
  }

  private publishResolved(input: PermissionCheckInput, data: { readonly decision: PermissionAction; readonly reason: string; readonly requested: boolean; readonly requestId?: string; readonly matchedRuleId?: string }): void {
    this.options.eventBus.publish(permissionEvent("permission.resolved", input.workspaceId, input.roomId, input.runId, input.agentId, { audit: true, actor: { type: input.agentId ? "agent" : "user", id: input.agentId ?? "local" }, action: "resolve", target: `permission-${data.requested ? "request" : "rule"}:${data.requestId ?? data.matchedRuleId ?? "direct"}`, outcome: data.decision, requestId: data.requestId, resource: input.resource, decision: data.decision, reason: data.reason, remembered: false, requested: data.requested, matchedRuleId: data.matchedRuleId }, this.now()));
  }
}

export function seedBuiltInPermissionProfiles(database: AgentHubDatabase, now = Date.now()): void {
  const insert = database.sqlite.prepare("INSERT OR IGNORE INTO permission_profiles (id, workspace_id, name, payload, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)");
  for (const profile of builtInPermissionProfiles) {
    const { id, name, ...payload } = profile;
    insert.run(id, name, JSON.stringify(payload), now, now);
  }
}

export function createPermissionCommandHandlers(engine: PermissionEngine, database: AgentHubDatabase, eventBus: EventBus, now: () => number = Date.now): Partial<Record<Command["type"], CommandHandler>> {
  return {
    ResolvePermission: (command) => resolvePermission(engine, command),
    CreatePermissionProfile: (command, meta) => writeProfile(database, eventBus, command, meta, now, false),
    PatchPermissionProfile: (command, meta) => writeProfile(database, eventBus, command, meta, now, true),
    DeletePermissionRule: (command, meta) => deleteRule(database, eventBus, command, meta, now)
  };
}

function resolvePermission(engine: PermissionEngine, command: Command): CommandResult {
  const requestId = stringField(command, "requestId") ?? stringField(command, "permissionId") ?? stringField(command, "id");
  const decision = stringField(command, "decision");
  if (!requestId || (decision !== "allow" && decision !== "deny")) return failed("validation_failed", "requestId and decision=allow|deny are required");
  const resolved = engine.resolve(requestId, decision, command.remember === true, stringField(command, "scope") ?? "once");
  if (!resolved) return failed("conflict", "permission request is not pending");
  return { ok: true, data: resolved, emittedEvents: latestPermissionEvents(engineDatabase(engine), requestId) };
}

function writeProfile(database: AgentHubDatabase, eventBus: EventBus, command: Command, meta: CommandMeta, now: () => number, patch: boolean): CommandResult {
  const id = stringField(command, "profileId") ?? stringField(command, "id") ?? (patch ? undefined : randomUUID());
  const name = stringField(command, "name");
  const payload = isObject(command.payload) ? command.payload : command;
  if (!id || !name) return failed("validation_failed", "profile id/name are required");
  const timestamp = now();
  if (patch) {
    const existing = database.sqlite.prepare("SELECT payload FROM permission_profiles WHERE id = ?").get(id) as { readonly payload: string } | undefined;
    if (!existing) return failed("not_found", `Permission profile '${id}' not found`);
    database.sqlite.prepare("UPDATE permission_profiles SET name = ?, payload = ?, updated_at = ? WHERE id = ?").run(name, JSON.stringify(payload), timestamp, id);
  } else {
    database.sqlite.prepare("INSERT INTO permission_profiles (id, workspace_id, name, payload, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)").run(id, name, JSON.stringify(payload), timestamp, timestamp);
  }
  eventBus.publish(permissionEvent("permission.resolved", "default-workspace", undefined, undefined, undefined, { audit: true, actor: meta.actor, action: patch ? "update" : "create", target: `permission-profile:${id}`, outcome: "saved", profileId: id, patch }, timestamp));
  return { ok: true, data: { profileId: id }, emittedEvents: [] };
}

function deleteRule(database: AgentHubDatabase, eventBus: EventBus, command: Command, meta: CommandMeta, now: () => number): CommandResult {
  const ruleId = stringField(command, "ruleId") ?? stringField(command, "id");
  if (!ruleId) return failed("validation_failed", "ruleId is required");
  const row = database.sqlite.prepare("SELECT workspace_id FROM permission_rules WHERE id = ?").get(ruleId) as { readonly workspace_id: string } | undefined;
  if (!row) return failed("not_found", `Permission rule '${ruleId}' not found`);
  database.sqlite.prepare("DELETE FROM permission_rules WHERE id = ?").run(ruleId);
  eventBus.publish(permissionEvent("permission.resolved", row.workspace_id, undefined, undefined, undefined, { ruleId, decision: "deny", reason: "stored rule deleted", requested: false, actor: meta.actor }, now()));
  return { ok: true, data: { ruleId }, emittedEvents: [] };
}

function engineDatabase(engine: PermissionEngine): AgentHubDatabase {
  return (engine as unknown as { readonly options: { readonly database: AgentHubDatabase } }).options.database;
}

function evaluateFile(profile: PermissionProfile, workspaceRoot: string, resource: Extract<PermissionResource, { type: "file" }>): { readonly action: PermissionAction; readonly reason: string } {
  const root = resolve(workspaceRoot);
  const target = resolve(root, resource.path);
  const rel = slash(relative(root, target));
  const inWorkspace = rel.length === 0 || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
  const matchPath = inWorkspace ? rel : slash(resource.path);
  const sensitive = (profile.sensitiveFileWhitelist ?? sensitiveFileGlobs).find((pattern) => globMatch(pattern, matchPath));
  if (sensitive) return { action: "deny", reason: `Sensitive file pattern matched: ${sensitive}` };
  if (!inWorkspace) return { action: profile.file.externalDirectory === "deny" ? "deny" : "ask", reason: "external_directory" };
  return { action: profile.file[resource.operation], reason: `file.${resource.operation}` };
}

function evaluateShell(profile: PermissionProfile, command: string): { readonly action: PermissionAction; readonly reason: string } {
  const parts = command.split(/\s*(?:\||&&|\|\|)\s*/).filter(Boolean);
  const decisions = parts.map((part) => matchShell(profile.shell, part));
  const denied = decisions.find((decision) => decision.action === "deny");
  if (denied) return denied;
  const ask = decisions.find((decision) => decision.action === "ask");
  return ask ?? decisions[0] ?? { action: "allow", reason: "shell.allow" };
}

function matchShell(rules: Readonly<Record<string, PermissionAction>>, command: string): { readonly action: PermissionAction; readonly reason: string } {
  const matches = Object.entries(rules).filter(([pattern]) => globMatch(pattern, command)).sort((a, b) => b[0].length - a[0].length);
  const [pattern, action] = matches[0] ?? ["*", "ask" as PermissionAction];
  return { action, reason: `shell.${pattern}` };
}

function resourceTypeFor(resource: PermissionResource): string {
  if (resource.type === "file") return `file.${resource.operation}`;
  if (resource.type === "context") return `context.${resource.operation}`;
  if (resource.type === "agent") return `agent.${resource.operation}`;
  if (resource.type === "tool") return `tool.${resource.toolName}`;
  return "shell";
}

function resourceMatchFor(resource: PermissionResource): string {
  if (resource.type === "file") return slash(resource.path);
  if (resource.type === "shell") return resource.command;
  if (resource.type === "tool") return resource.toolName;
  if (resource.type === "context") return resource.contextId ?? resource.operation;
  return resource.targetAgentId;
}

function resourceValueFor(resource: PermissionResource): string {
  return resource.type === "shell" ? resource.command : resourceMatchFor(resource);
}

function rowToInput(row: PermissionRequestRow): PermissionCheckInput {
  return { workspaceId: row.workspace_id, ...(row.room_id ? { roomId: row.room_id } : {}), ...(row.agent_id ? { agentId: row.agent_id } : {}), ...(row.run_id ? { runId: row.run_id } : {}), ...(row.adapter_session_id ? { adapterSessionId: row.adapter_session_id } : {}), ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}), resource: JSON.parse(row.resource) as PermissionResource };
}

function permissionEvent(type: "permission.requested" | "permission.resolved", workspaceId: string, roomId: string | undefined, runId: string | undefined, agentId: string | undefined, payload: Record<string, unknown>, createdAt: number): PublishInput {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId, ...(roomId !== undefined ? { roomId } : {}), ...(runId !== undefined ? { runId } : {}), ...(agentId !== undefined ? { agentId } : {}), payload, createdAt };
}

function latestPermissionEvents(database: AgentHubDatabase, requestId: string): { readonly seq: number; readonly type: string }[] {
  return database.sqlite.prepare("SELECT seq, type FROM events WHERE type LIKE 'permission.%' AND payload LIKE ? ORDER BY seq ASC").all(`%${requestId}%`) as { readonly seq: number; readonly type: string }[];
}

function globMatch(pattern: string, value: string): boolean {
  const normalized = slash(value);
  const regex = new RegExp(`^${slash(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**", "::DOUBLE_STAR::").replaceAll("*", "[^/]*").replaceAll("::DOUBLE_STAR::", ".*")}$`);
  return regex.test(normalized);
}

function slash(value: string): string {
  return value.replaceAll("\\", "/");
}

function stringField(command: Command, key: string): string | undefined {
  const value = command[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failed(code: "validation_failed" | "not_found" | "conflict", message: string): CommandResult {
  return { ok: false, error: { code, message } };
}

function publishAuditEvent(eventBus: EventBus, input: {
  readonly type: string;
  readonly workspaceId: string;
  readonly roomId?: string;
  readonly runId?: string;
  readonly agentId?: string;
  readonly actor: { readonly type: string; readonly id: string };
  readonly action: string;
  readonly target: string;
  readonly outcome: string;
  readonly createdAt: number;
  readonly payload?: Record<string, unknown>;
}): void {
  eventBus.publish({
    id: randomUUID(),
    type: input.type as Parameters<EventBus["publish"]>[0]["type"],
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    payload: {
      audit: true,
      actor: input.actor,
      action: input.action,
      target: input.target,
      outcome: input.outcome,
      ...(input.payload ?? {})
    },
    createdAt: input.createdAt
  });
}

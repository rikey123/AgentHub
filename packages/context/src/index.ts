import { randomUUID } from "node:crypto";

import type { Command, CommandHandler, CommandMeta, CommandResult, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type ContextItemType = "fact" | "decision" | "constraint" | "issue" | "artifact" | "preference" | "summary";
export type ContextScope = "conversation" | "task" | "workspace" | "user";
export type ContextStatus = "draft" | "confirmed" | "deprecated" | "disputed";
export type ContextConfidence = "verified" | "inferred" | "unverified";
export type ContextSource = { readonly type: "user" | "agent" | "tool" | "file" | "system"; readonly id?: string; readonly kind?: string };
export type ContextVisibility = { readonly agents?: readonly string[]; readonly roles?: readonly string[]; readonly users?: readonly string[] };

export type ContextItem = {
  readonly id: string;
  readonly workspaceId: string;
  readonly roomId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly sourceMessageId?: string;
  readonly type: ContextItemType;
  readonly scope: ContextScope;
  readonly content: string;
  readonly source: ContextSource;
  readonly visibility: ContextVisibility;
  readonly status: ContextStatus;
  readonly confidence: ContextConfidence;
  readonly version: number;
  readonly ownerId?: string;
  readonly ownerType?: "user" | "agent" | "system";
  readonly createdBy: string;
  readonly pinned: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deprecatedAt?: number;
};

export type AgentProfile = { readonly id: string; readonly capabilities: readonly string[] };
export type ContextFilter = { readonly workspaceId?: string; readonly roomId?: string; readonly taskId?: string; readonly status?: ContextStatus };
export type ContextHit = { readonly item: ContextItem; readonly score: number };
export type VectorIndex = { search(query: string, k: number, filter?: ContextFilter): Promise<ContextHit[]>; upsert(item: ContextItem): Promise<void>; remove(id: string): Promise<void> };
export type MemoryEntry = { readonly id: string; readonly workspaceId?: string; readonly agentId?: string; readonly type: "user_preference" | "project_fact" | "decision" | "agent_experience" | "tool_experience"; readonly content: string; readonly status: "candidate" | "confirmed" | "deprecated" | "forgotten"; readonly visibility: "private" | "workspace" | "agent" | "global"; readonly createdAt: number; readonly updatedAt: number };
export type MemoryFilter = { readonly workspaceId?: string; readonly agentId?: string; readonly visibility?: MemoryEntry["visibility"] };
export class MemoryError extends Error { constructor(readonly code: "not_implemented" | "tool_not_found", message: string) { super(message); this.name = "MemoryError"; } }
export type MemoryAdapter = { readonly id: string; upsert(entry: MemoryEntry): Promise<void>; search(query: string, filter?: MemoryFilter): Promise<MemoryEntry[]>; list(filter?: MemoryFilter): Promise<MemoryEntry[]>; remove(id: string): Promise<void> };
export type HybridMemoryRouter = { route(entry: MemoryEntry): readonly MemoryAdapter[]; merge(results: readonly MemoryEntry[][]): MemoryEntry[] };
export type ContextBudget = { readonly totalTokens: number; readonly safetyMarginPct?: number };
export type ContextSection = { readonly kind: "pinned_confirmed" | "task_confirmed" | "room_confirmed" | "task_draft" | "recent_messages" | "attachments"; readonly title: string; readonly items: readonly string[]; readonly tokenEstimate: number; readonly truncated: boolean };
export type AssembledContext = { readonly sections: readonly ContextSection[]; readonly text: string; readonly tokenEstimate: number; readonly truncated: boolean };
export type ContextInjectionMode = "immediate" | "next_turn" | "next_session";
export type ContextInjectionResult = { readonly mode: ContextInjectionMode; readonly applied: boolean; readonly effectiveAt?: "now" | "next_turn" | "next_session"; readonly reason?: string };

export const trustedSystemToolKinds = ["git-blame", "git-log", "filesystem-watch", "lsp-definition", "package-manifest-parse"] as const;

type ContextRow = {
  readonly id: string; readonly workspace_id: string; readonly room_id: string | null; readonly task_id: string | null; readonly run_id: string | null; readonly source_message_id: string | null; readonly type: string; readonly scope: string; readonly content: string; readonly source: string; readonly visibility: string; readonly status: string; readonly confidence: unknown; readonly version: number; readonly owner_id: string | null; readonly owner_type: string | null; readonly created_by: string; readonly pinned: number; readonly created_at: number; readonly updated_at: number; readonly deprecated_at: number | null;
};

export type CreateContextItemInput = {
  readonly workspaceId: string;
  readonly roomId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly sourceMessageId?: string;
  readonly type: ContextItemType;
  readonly scope?: ContextScope;
  readonly content: string;
  readonly source: ContextSource;
  readonly visibility?: ContextVisibility;
  readonly status?: ContextStatus;
  readonly confidence?: ContextConfidence;
  readonly ownerId?: string;
  readonly ownerType?: "user" | "agent" | "system";
  readonly createdBy: string;
  readonly pinned?: boolean;
};

export type UpdateContextItemInput = {
  readonly id: string;
  readonly baseVersion: number;
  readonly patch: Partial<Pick<ContextItem, "content" | "scope" | "visibility" | "status" | "type" | "pinned">>;
};

export type ContextWriteResult = { readonly ok: boolean; readonly item: ContextItem; readonly downgraded: boolean; readonly reason?: string };
export type ContextUpdateResult = { readonly ok: true; readonly item: ContextItem } | { readonly ok: false; readonly conflict: { readonly contextId: string; readonly baseVersion: number; readonly currentVersion: number } };

export class NoopVectorIndex implements VectorIndex {
  async search(query: string, k: number, filter?: ContextFilter): Promise<ContextHit[]> { void query; void k; void filter; return []; }
  async upsert(item: ContextItem): Promise<void> { void item; return undefined; }
  async remove(id: string): Promise<void> { void id; return undefined; }
}

export class NoopMemoryAdapter implements MemoryAdapter {
  readonly id = "noop-memory";
  async upsert(entry: MemoryEntry): Promise<void> { void entry; return undefined; }
  async search(query: string, filter?: MemoryFilter): Promise<MemoryEntry[]> { void query; void filter; return []; }
  async list(filter?: MemoryFilter): Promise<MemoryEntry[]> { void filter; return []; }
  async remove(id: string): Promise<void> { void id; return undefined; }
}

export class NoopHybridMemoryRouter implements HybridMemoryRouter {
  constructor(private readonly adapter: MemoryAdapter = new NoopMemoryAdapter()) {}
  route(entry: MemoryEntry): readonly MemoryAdapter[] { void entry; return [this.adapter]; }
  merge(results: readonly MemoryEntry[][]): MemoryEntry[] { return [...new Map(results.flat().map((entry) => [entry.id, entry])).values()]; }
}

export function roomSearchMemoryTool(): never {
  throw new MemoryError("tool_not_found", "room.search_memory is V1.2 and is not exposed in MVP");
}

export class ContextLedger {
  private readonly now: () => number;
  private readonly trustedTools: ReadonlySet<string>;

  constructor(private readonly options: { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly now?: () => number; readonly trustedToolKinds?: readonly string[] }) {
    this.now = options.now ?? Date.now;
    this.trustedTools = new Set([...(trustedSystemToolKinds as readonly string[]), ...(options.trustedToolKinds ?? [])]);
  }

  propose(input: Omit<CreateContextItemInput, "status" | "confidence"> & { readonly confidence?: ContextConfidence }): ContextWriteResult {
    return this.create({ ...input, status: "draft", confidence: input.confidence ?? "inferred" });
  }

  create(input: CreateContextItemInput): ContextWriteResult {
    validateCreate(input);
    const now = this.now();
    const trust = this.classifyWrite(input);
    const item: ContextItem = {
      id: randomUUID(), workspaceId: input.workspaceId, ...(input.roomId !== undefined ? { roomId: input.roomId } : {}), ...(input.taskId !== undefined ? { taskId: input.taskId } : {}), ...(input.runId !== undefined ? { runId: input.runId } : {}), ...(input.sourceMessageId !== undefined ? { sourceMessageId: input.sourceMessageId } : {}), type: input.type, scope: input.scope ?? "conversation", content: input.content, source: input.source, visibility: input.visibility ?? {}, status: trust.status, confidence: input.confidence ?? (input.source.type === "agent" ? "inferred" : "unverified"), version: 1, ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}), ...(input.ownerType !== undefined ? { ownerType: input.ownerType } : {}), createdBy: input.createdBy, pinned: input.pinned ?? false, createdAt: now, updatedAt: now
    };
    this.options.database.sqlite.transaction(() => {
      this.insertItem(item);
      this.writeVersion(item, item.createdBy, now);
      this.options.eventBus.publish(contextEvent("context.item.created", item, { contextId: item.id, status: item.status, source: item.source }, now));
      this.options.eventBus.publish(contextEvent(item.status === "confirmed" ? "context.item.confirmed" : "context.item.proposed", item, { contextId: item.id, byUserId: null, source: item.source.kind ?? item.source.type, downgraded: trust.downgraded, reason: trust.reason }, now));
    })();
    return { ok: !trust.downgraded, item, downgraded: trust.downgraded, ...(trust.reason !== undefined ? { reason: trust.reason } : {}) };
  }

  get(id: string): ContextItem | undefined {
    const row = this.options.database.sqlite.prepare("SELECT * FROM context_items WHERE id = ?").get(id) as ContextRow | undefined;
    return row ? rowToItem(row) : undefined;
  }

  list(filter: ContextFilter = {}): ContextItem[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.workspaceId !== undefined) { clauses.push("workspace_id = ?"); params.push(filter.workspaceId); }
    if (filter.roomId !== undefined) { clauses.push("room_id = ?"); params.push(filter.roomId); }
    if (filter.taskId !== undefined) { clauses.push("task_id = ?"); params.push(filter.taskId); }
    if (filter.status !== undefined) { clauses.push("status = ?"); params.push(filter.status); }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    return (this.options.database.sqlite.prepare(`SELECT * FROM context_items${where} ORDER BY updated_at DESC, id ASC`).all(...params) as ContextRow[]).map(rowToItem);
  }

  confirm(id: string, byUserId: string, baseVersion?: number): ContextUpdateResult {
    const item = this.get(id);
    if (!item) throw new Error(`ContextItem '${id}' not found`);
    return this.update({ id, baseVersion: baseVersion ?? item.version, patch: { status: "confirmed" } }, byUserId, "context.item.confirmed");
  }

  update(input: UpdateContextItemInput, changedBy: string, eventType: "context.item.update_requested" | "context.item.confirmed" = "context.item.update_requested"): ContextUpdateResult {
    const current = this.get(input.id);
    if (!current) throw new Error(`ContextItem '${input.id}' not found`);
    const now = this.now();
    if (current.version !== input.baseVersion) {
      this.options.eventBus.publish(contextEvent("context.item.conflict_created", current, { contextId: current.id, baseVersion: input.baseVersion, currentVersion: current.version, attemptedPatch: input.patch }, now));
      return { ok: false, conflict: { contextId: current.id, baseVersion: input.baseVersion, currentVersion: current.version } };
    }
    const next = { ...current, ...input.patch, version: current.version + 1, updatedAt: now };
    this.options.database.sqlite.transaction(() => {
      this.updateItem(next);
      this.writeVersion(next, changedBy, now);
      this.options.eventBus.publish(contextEvent(eventType, next, { contextId: next.id, baseVersion: current.version, version: next.version, patch: input.patch, changedBy }, now));
      if (input.patch.visibility !== undefined || input.patch.scope !== undefined || input.patch.pinned !== undefined) this.options.eventBus.publish(contextEvent("context.item.visibility.changed", next, { contextId: next.id, scope: next.scope, pinned: next.pinned, visibility: next.visibility }, now));
    })();
    return { ok: true, item: next };
  }

  deprecate(id: string, baseVersion: number, changedBy: string, reason?: string): ContextUpdateResult {
    const current = this.get(id);
    if (!current) throw new Error(`ContextItem '${id}' not found`);
    const result = this.update({ id, baseVersion, patch: { status: "deprecated" } }, changedBy, "context.item.update_requested");
    if (result.ok) {
      const now = this.now();
      this.options.database.sqlite.prepare("UPDATE context_items SET deprecated_at = ? WHERE id = ?").run(now, id);
      this.options.eventBus.publish(contextEvent("context.item.deprecated", result.item, { contextId: id, reason, changedBy }, now));
      return { ok: true, item: { ...result.item, deprecatedAt: now } };
    }
    return result;
  }

  pin(id: string, baseVersion: number, changedBy: string): ContextUpdateResult {
    return this.update({ id, baseVersion, patch: { scope: "workspace", pinned: true } }, changedBy);
  }

  assemble(input: { readonly workspaceId: string; readonly roomId?: string; readonly taskId?: string; readonly agentProfile: AgentProfile; readonly budget?: Partial<ContextBudget>; readonly roomLimit?: number; readonly messageLimit?: number }): AssembledContext {
    const allItems = this.list({ workspaceId: input.workspaceId }).filter((item) => isVisible(item, input.agentProfile));
    const roomLimit = input.roomLimit ?? 20;
    const messageLimit = input.messageLimit ?? 30;
    const sections: ContextSection[] = [];
    const pinned = allItems.filter((item) => item.status === "confirmed" && item.scope === "workspace" && item.pinned).sort(contextOrder).map(formatItem);
    pushSection(sections, "pinned_confirmed", "Pinned workspace context", pinned);
    const taskConfirmed = allItems.filter((item) => item.status === "confirmed" && item.taskId === input.taskId && !item.pinned).sort(contextOrder).map(formatItem);
    pushSection(sections, "task_confirmed", "Task confirmed context", taskConfirmed);
    const roomConfirmed = allItems.filter((item) => item.status === "confirmed" && item.roomId === input.roomId && item.taskId !== input.taskId && !item.pinned).sort(contextOrder).slice(0, roomLimit).map(formatItem);
    pushSection(sections, "room_confirmed", "Recent room context", roomConfirmed);
    const taskDraft = allItems.filter((item) => item.status === "draft" && item.taskId === input.taskId).sort(contextOrder).map((item) => `[unconfirmed] ${formatItem(item)}`);
    pushSection(sections, "task_draft", "Unconfirmed task context", taskDraft);
    pushSection(sections, "recent_messages", "Recent messages", this.recentMessages(input.workspaceId, input.roomId, messageLimit));
    pushSection(sections, "attachments", "Attachments", this.attachments(input.roomId));
    return fitBudget(sections, input.budget);
  }

  classifyInjection(mode: ContextInjectionMode, activeRun = false): ContextInjectionResult {
    if (mode === "immediate") return { mode, applied: activeRun, effectiveAt: activeRun ? "now" : "next_turn", ...(activeRun ? {} : { reason: "no active run" }) };
    if (mode === "next_turn") return { mode, applied: false, effectiveAt: "next_turn", reason: "pending_inject" };
    return { mode, applied: false, effectiveAt: "next_session", reason: "requires_restart" };
  }

  private classifyWrite(input: CreateContextItemInput): { readonly status: ContextStatus; readonly downgraded: boolean; readonly reason?: string } {
    if (input.status !== "confirmed") return { status: input.status ?? "draft", downgraded: false };
    if (input.source.type === "tool" && input.confidence === "verified" && input.source.kind !== undefined && this.trustedTools.has(input.source.kind)) return { status: "confirmed", downgraded: false };
    return { status: "draft", downgraded: true, reason: input.source.type === "tool" ? "untrusted_tool_kind" : "agent_confirmed_write_forbidden" };
  }

  private insertItem(item: ContextItem): void {
    this.options.database.sqlite.prepare(`INSERT INTO context_items (id, workspace_id, room_id, task_id, run_id, source_message_id, type, scope, content, source, visibility, status, confidence, version, owner_id, owner_type, created_by, pinned, created_at, updated_at, deprecated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(item.id, item.workspaceId, item.roomId ?? null, item.taskId ?? null, item.runId ?? null, item.sourceMessageId ?? null, item.type, item.scope, item.content, JSON.stringify(item.source), JSON.stringify(item.visibility), item.status, item.confidence, item.version, item.ownerId ?? null, item.ownerType ?? null, item.createdBy, item.pinned ? 1 : 0, item.createdAt, item.updatedAt);
  }

  private updateItem(item: ContextItem): void {
    this.options.database.sqlite.prepare(`UPDATE context_items SET type = ?, scope = ?, content = ?, visibility = ?, status = ?, version = ?, pinned = ?, updated_at = ? WHERE id = ?`).run(item.type, item.scope, item.content, JSON.stringify(item.visibility), item.status, item.version, item.pinned ? 1 : 0, item.updatedAt, item.id);
  }

  private writeVersion(item: ContextItem, changedBy: string, changedAt: number): void {
    this.options.database.sqlite.prepare("INSERT INTO context_versions (context_id, version, payload, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)").run(item.id, item.version, JSON.stringify(item), changedBy, changedAt);
  }

  private recentMessages(workspaceId: string, roomId: string | undefined, limit: number): string[] {
    if (roomId === undefined) return [];
    const rows = this.options.database.sqlite.prepare("SELECT id, sender_type, sender_id, role, created_at FROM messages WHERE workspace_id = ? AND room_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?").all(workspaceId, roomId, limit) as { readonly id: string; readonly sender_type: string; readonly sender_id: string | null; readonly role: string; readonly created_at: number }[];
    return rows.map((row) => `${row.role}:${row.sender_id ?? row.sender_type}@${row.created_at} (${row.id})`);
  }

  private attachments(roomId: string | undefined): string[] {
    if (roomId === undefined) return [];
    const rows = this.options.database.sqlite.prepare("SELECT a.file_name, a.byte_size FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.room_id = ? ORDER BY a.created_at DESC").all(roomId) as { readonly file_name: string; readonly byte_size: number }[];
    return rows.map((row) => `${row.file_name} (${row.byte_size} bytes)`);
  }
}

export function isVisible(item: ContextItem, agent: AgentProfile): boolean {
  const agents = item.visibility.agents ?? [];
  if (agents.length > 0 && !agents.includes(agent.id)) return false;
  const roles = item.visibility.roles ?? [];
  if (roles.length > 0 && !roles.some((role) => agent.capabilities.includes(role))) return false;
  return true;
}

export function createContextCommandHandlers(ledger: ContextLedger, now: () => number = Date.now): Partial<Record<Command["type"], CommandHandler>> {
  return {
    ProposeContextItem: (command, meta) => commandResult(() => ledger.propose(createInput(command, meta, false))),
    WriteContextItem: (command, meta) => commandResult(() => ledger.create(createInput(command, meta, true))),
    UpdateContextItem: (command, meta) => updateResult(() => ledger.update(updateInput(command), actorId(meta))),
    ConfirmContextItem: (command, meta) => updateResult(() => ledger.confirm(requiredString(command, "contextId"), actorId(meta), numberField(command, "baseVersion"))),
    DeprecateContextItem: (command, meta) => updateResult(() => ledger.deprecate(requiredString(command, "contextId"), requiredNumber(command, "baseVersion"), actorId(meta), stringField(command, "reason"))),
    PinContextItem: (command, meta) => updateResult(() => ledger.pin(requiredString(command, "contextId"), requiredNumber(command, "baseVersion"), actorId(meta))),
    InjectContext: (command) => ({ ok: true, data: ledger.classifyInjection(injectionMode(command), command.activeRun === true), emittedEvents: [] })
  } satisfies Partial<Record<Command["type"], CommandHandler>>;

  function commandResult(action: () => ContextWriteResult): CommandResult {
    const result = action();
    return { ok: true, data: result, emittedEvents: latestContextEvents(ledgerDatabase(ledger), result.item.id) };
  }
  function updateResult(action: () => ContextUpdateResult): CommandResult {
    const result = action();
    if (!result.ok) return { ok: false, error: { code: "conflict", message: "context version conflict", details: result.conflict } };
    return { ok: true, data: result.item, emittedEvents: latestContextEvents(ledgerDatabase(ledger), result.item.id) };
  }
  void now;
}

function createInput(command: Command, meta: CommandMeta, write: boolean): CreateContextItemInput {
  const source = isObject(command.source) ? command.source as ContextSource : sourceFromMeta(meta);
  const roomId = stringField(command, "roomId");
  const taskId = stringField(command, "taskId");
  const runId = stringField(command, "runId");
  return { workspaceId: requiredString(command, "workspaceId"), ...(roomId !== undefined ? { roomId } : {}), ...(taskId !== undefined ? { taskId } : {}), ...(runId !== undefined ? { runId } : {}), type: contextType(command.typeName ?? command.itemType ?? command.contextType ?? command.kind ?? command.contextItemType), scope: scopeField(command.scope) ?? "conversation", content: requiredString(command, "content"), source, visibility: isObject(command.visibility) ? command.visibility as ContextVisibility : {}, status: write ? statusField(command.status) ?? "confirmed" : "draft", confidence: confidenceField(command.confidence) ?? (write ? "verified" : "inferred"), createdBy: actorId(meta), pinned: command.pinned === true };
}

function sourceFromMeta(meta: CommandMeta): ContextSource {
  if (meta.actor.type === "system") return { type: "system" };
  return { type: meta.actor.type, id: meta.actor.id };
}

function updateInput(command: Command): UpdateContextItemInput {
  return { id: requiredString(command, "contextId"), baseVersion: requiredNumber(command, "baseVersion"), patch: isObject(command.patch) ? command.patch as UpdateContextItemInput["patch"] : {} };
}

function contextEvent(type: "context.item.created" | "context.item.proposed" | "context.item.confirmed" | "context.item.update_requested" | "context.item.conflict_created" | "context.item.deprecated" | "context.item.visibility.changed", item: ContextItem, payload: Record<string, unknown>, createdAt: number): PublishInput {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId: item.workspaceId, ...(item.roomId !== undefined ? { roomId: item.roomId } : {}), ...(item.taskId !== undefined ? { taskId: item.taskId } : {}), ...(item.runId !== undefined ? { runId: item.runId } : {}), payload, createdAt };
}

function rowToItem(row: ContextRow): ContextItem {
  return { id: row.id, workspaceId: row.workspace_id, ...(row.room_id !== null ? { roomId: row.room_id } : {}), ...(row.task_id !== null ? { taskId: row.task_id } : {}), ...(row.run_id !== null ? { runId: row.run_id } : {}), ...(row.source_message_id !== null ? { sourceMessageId: row.source_message_id } : {}), type: row.type as ContextItemType, scope: row.scope as ContextScope, content: row.content, source: JSON.parse(row.source) as ContextSource, visibility: JSON.parse(row.visibility) as ContextVisibility, status: row.status as ContextStatus, confidence: String(row.confidence ?? "unverified") as ContextConfidence, version: row.version, ...(row.owner_id !== null ? { ownerId: row.owner_id } : {}), ...(row.owner_type !== null ? { ownerType: row.owner_type as "user" | "agent" | "system" } : {}), createdBy: row.created_by, pinned: row.pinned === 1, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.deprecated_at !== null ? { deprecatedAt: row.deprecated_at } : {}) };
}

function validateCreate(input: CreateContextItemInput): void {
  if (input.workspaceId.length === 0 || input.content.length === 0) throw new Error("workspaceId and content are required");
}

function contextOrder(a: ContextItem, b: ContextItem): number { return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id); }
function formatItem(item: ContextItem): string { return `${item.type}:${item.content}`; }
function estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
function pushSection(sections: ContextSection[], kind: ContextSection["kind"], title: string, items: readonly string[]): void { if (items.length > 0) sections.push({ kind, title, items, tokenEstimate: estimateTokens(items.join("\n")), truncated: false }); }

function fitBudget(sections: ContextSection[], budget: Partial<ContextBudget> | undefined): AssembledContext {
  const total = budget?.totalTokens ?? 16_000;
  const maxTokens = Math.max(1, Math.floor(total * (1 - (budget?.safetyMarginPct ?? 0.1))));
  let used = 0;
  let truncated = false;
  const fitted = sections.map((section) => {
    const kept: string[] = [];
    for (const item of section.items) {
      const cost = estimateTokens(item);
      if (used + cost > maxTokens) { truncated = true; continue; }
      kept.push(item); used += cost;
    }
    return { ...section, items: kept, tokenEstimate: estimateTokens(kept.join("\n")), truncated: kept.length !== section.items.length };
  }).filter((section) => section.items.length > 0);
  const text = fitted.map((section) => `## ${section.title}\n${section.items.join("\n")}`).join("\n\n");
  return { sections: fitted, text, tokenEstimate: estimateTokens(text), truncated };
}

function latestContextEvents(database: AgentHubDatabase, contextId: string): { readonly seq: number; readonly type: string }[] { return database.sqlite.prepare("SELECT seq, type FROM events WHERE type LIKE 'context.%' AND payload LIKE ? ORDER BY seq ASC").all(`%${contextId}%`) as { readonly seq: number; readonly type: string }[]; }
function ledgerDatabase(ledger: ContextLedger): AgentHubDatabase { return (ledger as unknown as { readonly options: { readonly database: AgentHubDatabase } }).options.database; }
function actorId(meta: CommandMeta): string { return meta.actor.type === "system" ? "system" : meta.actor.id; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringField(command: Command, key: string): string | undefined { const value = command[key]; return typeof value === "string" && value.length > 0 ? value : undefined; }
function numberField(command: Command, key: string): number | undefined { const value = command[key]; return typeof value === "number" && Number.isInteger(value) ? value : undefined; }
function requiredString(command: Command, key: string): string { const value = stringField(command, key); if (value === undefined) throw new Error(`${key} is required`); return value; }
function requiredNumber(command: Command, key: string): number { const value = numberField(command, key); if (value === undefined) throw new Error(`${key} is required`); return value; }
function contextType(value: unknown): ContextItemType { const allowed = ["fact", "decision", "constraint", "issue", "artifact", "preference", "summary"]; return typeof value === "string" && allowed.includes(value) ? value as ContextItemType : "fact"; }
function scopeField(value: unknown): ContextScope | undefined { return value === "conversation" || value === "task" || value === "workspace" || value === "user" ? value : undefined; }
function statusField(value: unknown): ContextStatus | undefined { return value === "draft" || value === "confirmed" || value === "deprecated" || value === "disputed" ? value : undefined; }
function confidenceField(value: unknown): ContextConfidence | undefined { return value === "verified" || value === "inferred" || value === "unverified" ? value : undefined; }
function injectionMode(command: Command): ContextInjectionMode { return command.mode === "immediate" || command.mode === "next_session" || command.mode === "next_turn" ? command.mode : "next_turn"; }

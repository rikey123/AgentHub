import { randomUUID } from "node:crypto";

import type { Command, CommandHandler, CommandMeta, CommandResult, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type InterventionType = "knock" | "tag" | "rule" | "emergency" | "rollback";
export type InterventionPriority = "low" | "medium" | "high";
export type InterventionStatus = "requested" | "pending_user_decision" | "approved" | "ignored" | "rejected" | "snoozed" | "injected" | "resolved" | "closed";
export type InterventionAction = "approve" | "ignore" | "reject" | "later" | "reactivate";

export type Intervention = {
  readonly id: string;
  readonly workspaceId: string;
  readonly roomId: string;
  readonly sourceAgentId: string;
  readonly targetRunId?: string;
  readonly targetMessageId?: string;
  readonly targetContextId?: string;
  readonly targetArtifactId?: string;
  readonly type: InterventionType;
  readonly reason: string;
  readonly preview?: string;
  readonly priority: InterventionPriority;
  readonly status: InterventionStatus;
  readonly snoozedUntil?: number;
  readonly createdAt: number;
  readonly resolvedAt?: number;
};

export type RequestInterventionInput = {
  readonly workspaceId: string;
  readonly roomId: string;
  readonly sourceAgentId: string;
  readonly targetRunId?: string;
  readonly targetMessageId?: string;
  readonly targetContextId?: string;
  readonly targetArtifactId?: string;
  readonly type?: InterventionType;
  readonly reason: string;
  readonly preview?: string;
  readonly priority?: InterventionPriority;
};

type InterventionRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly room_id: string;
  readonly source_agent_id: string;
  readonly target_run_id: string | null;
  readonly target_message_id: string | null;
  readonly target_context_id: string | null;
  readonly target_artifact_id: string | null;
  readonly type: string;
  readonly reason: string;
  readonly preview: string | null;
  readonly priority: string;
  readonly status: string;
  readonly snoozed_until: number | null;
  readonly created_at: number;
  readonly resolved_at: number | null;
};

type EventTrace = { readonly traceId?: string; readonly causationId?: string; readonly correlationId?: string };

const reasonMinLength = 10;
export class InterventionEngine {
  private readonly now: () => number;

  constructor(private readonly options: { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly now?: () => number }) {
    this.now = options.now ?? Date.now;
  }

  request(input: RequestInterventionInput, trace: EventTrace = {}): { readonly interventionId: string; readonly deduplicated: boolean; readonly existingId?: string } {
    validateRequest(input);
    if (input.type === "emergency" || input.type === "rollback") {
      throw new InterventionNotImplementedError(`${input.type} intervention is V1`);
    }

    const existing = this.findDuplicate(input);
    if (existing) return { interventionId: existing.id, existingId: existing.id, deduplicated: true };

    const now = this.now();
    const intervention: Intervention = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      roomId: input.roomId,
      sourceAgentId: input.sourceAgentId,
      ...(input.targetRunId !== undefined ? { targetRunId: input.targetRunId } : {}),
      ...(input.targetMessageId !== undefined ? { targetMessageId: input.targetMessageId } : {}),
      ...(input.targetContextId !== undefined ? { targetContextId: input.targetContextId } : {}),
      ...(input.targetArtifactId !== undefined ? { targetArtifactId: input.targetArtifactId } : {}),
      type: input.type ?? "knock",
      reason: input.reason,
      ...(input.preview !== undefined ? { preview: input.preview } : {}),
      priority: input.priority ?? "medium",
      status: "pending_user_decision",
      createdAt: now
    };

    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite
        .prepare(
          `INSERT INTO interventions (
            id, workspace_id, room_id, source_agent_id, target_run_id, target_message_id, target_context_id,
            target_artifact_id, type, reason, preview, priority, status, snoozed_until, created_at, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', NULL, ?, NULL)`
        )
        .run(intervention.id, intervention.workspaceId, intervention.roomId, intervention.sourceAgentId, intervention.targetRunId ?? null, intervention.targetMessageId ?? null, intervention.targetContextId ?? null, intervention.targetArtifactId ?? null, intervention.type, intervention.reason, intervention.preview ?? null, intervention.priority, intervention.createdAt);
      this.publish(intervention, "intervention.requested", { interventionId: intervention.id, status: "requested", nextStatus: "pending_user_decision", reason: intervention.reason, priority: intervention.priority, preview: intervention.preview, type: intervention.type }, now, trace);
      this.options.database.sqlite.prepare("UPDATE interventions SET status = 'pending_user_decision' WHERE id = ?").run(intervention.id);
      this.syncPresence(intervention.roomId, intervention.sourceAgentId, now, trace);
    })();

    return { interventionId: intervention.id, deduplicated: false };
  }

  approve(interventionId: string, effectiveText?: string, trace: EventTrace = {}): Intervention | undefined {
    const current = this.get(interventionId);
    if (!current) return undefined;
    if (current.status !== "pending_user_decision") {
      this.invalid(current, "approve", "pending_user_decision", trace);
      return current;
    }

    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.setStatus(interventionId, "approved", null, null);
      this.publish(current, "intervention.approved", { interventionId, status: "approved", effectiveText, originalPreview: current.preview, audit: true, actor: { type: "user", id: "local" }, action: "approve", outcome: "approved" }, now, trace);
      this.syncPresence(current.roomId, current.sourceAgentId, now, trace);
      this.setStatus(interventionId, "injected", null, null);
      this.publish(current, "intervention.injected", { interventionId, status: "injected", injectionMode: "immediate", effectiveText: effectiveText ?? current.preview ?? current.reason }, now, trace);
      this.setStatus(interventionId, "resolved", null, now);
      this.publish(current, "intervention.resolved", { interventionId, status: "resolved", classification: "immediate_mvp" }, now, trace);
      this.setStatus(interventionId, "closed", null, now);
      this.publish(current, "intervention.closed", { interventionId, status: "closed" }, now, trace);
      this.syncPresence(current.roomId, current.sourceAgentId, now, trace);
    })();
    return this.get(interventionId);
  }

  ignore(interventionId: string, trace: EventTrace = {}): Intervention | undefined {
    return this.closeWithDecision(interventionId, "ignore", "ignored", "intervention.ignored", {}, trace);
  }

  reject(interventionId: string, reason?: string, trace: EventTrace = {}): Intervention | undefined {
    return this.closeWithDecision(interventionId, "reject", "rejected", "intervention.rejected", { reason }, trace);
  }

  snooze(interventionId: string, snoozeSeconds = 300, trace: EventTrace = {}): Intervention | undefined {
    const current = this.get(interventionId);
    if (!current) return undefined;
    if (current.status !== "pending_user_decision") {
      this.invalid(current, "later", "pending_user_decision", trace);
      return current;
    }
    const now = this.now();
    const snoozedUntil = now + Math.max(1, snoozeSeconds) * 1000;
    this.options.database.sqlite.transaction(() => {
      this.setStatus(interventionId, "snoozed", snoozedUntil, null);
      this.publish(current, "intervention.snoozed", { interventionId, status: "snoozed", snoozedUntil }, now, trace);
      this.syncPresence(current.roomId, current.sourceAgentId, now, trace);
    })();
    return this.get(interventionId);
  }

  reactivateDueSnoozes(now = this.now(), trace: EventTrace = {}): Intervention[] {
    const rows = this.options.database.sqlite.prepare("SELECT * FROM interventions WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ? ORDER BY snoozed_until ASC, created_at ASC").all(now) as InterventionRow[];
    const reactivated: Intervention[] = [];
    for (const row of rows) {
      const intervention = rowToIntervention(row);
      this.options.database.sqlite.transaction(() => {
        this.setStatus(intervention.id, "pending_user_decision", null, null);
        this.publish(intervention, "intervention.requested", { interventionId: intervention.id, status: "pending_user_decision", reactivated: true, reason: intervention.reason }, now, trace);
        this.syncPresence(intervention.roomId, intervention.sourceAgentId, now, trace);
      })();
      const next = this.get(intervention.id);
      if (next) reactivated.push(next);
    }
    return reactivated;
  }

  get(interventionId: string): Intervention | undefined {
    const row = this.options.database.sqlite.prepare("SELECT * FROM interventions WHERE id = ?").get(interventionId) as InterventionRow | undefined;
    return row ? rowToIntervention(row) : undefined;
  }

  list(filters: { readonly roomId?: string; readonly status?: string } = {}): Intervention[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.roomId !== undefined) { clauses.push("room_id = ?"); params.push(filters.roomId); }
    if (filters.status !== undefined) { clauses.push("status = ?"); params.push(filters.status); }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    return (this.options.database.sqlite.prepare(`SELECT * FROM interventions${where} ORDER BY created_at ASC, id ASC`).all(...params) as InterventionRow[]).map(rowToIntervention);
  }

  private closeWithDecision(interventionId: string, action: InterventionAction, decisionStatus: "ignored" | "rejected", eventType: "intervention.ignored" | "intervention.rejected", payload: Record<string, unknown>, trace: EventTrace): Intervention | undefined {
    const current = this.get(interventionId);
    if (!current) return undefined;
    if (current.status !== "pending_user_decision") {
      this.invalid(current, action, "pending_user_decision", trace);
      return current;
    }
    const now = this.now();
    this.options.database.sqlite.transaction(() => {
      this.setStatus(interventionId, decisionStatus, null, now);
      this.publish(current, eventType, { interventionId, status: decisionStatus, ...payload, audit: true, actor: { type: "user", id: "local" }, action: action, outcome: decisionStatus }, now, trace);
      this.setStatus(interventionId, "closed", null, now);
      this.publish(current, "intervention.closed", { interventionId, status: "closed", fromStatus: decisionStatus }, now, trace);
      this.syncPresence(current.roomId, current.sourceAgentId, now, trace);
    })();
    return this.get(interventionId);
  }

  private invalid(current: Intervention, action: InterventionAction, expected: InterventionStatus, trace: EventTrace): void {
    const now = this.now();
    this.publish(current, "intervention.invalid_transition", { interventionId: current.id, action, fromStatus: current.status, expectedStatus: expected, stateMutated: false }, now, trace);
  }

  private findDuplicate(input: RequestInterventionInput): Intervention | undefined {
    const row = this.options.database.sqlite
      .prepare(
        `SELECT * FROM interventions
         WHERE room_id = ? AND source_agent_id = ? AND status = 'pending_user_decision'
           AND COALESCE(target_run_id, '') = COALESCE(?, '')
           AND COALESCE(target_artifact_id, '') = COALESCE(?, '')
           AND COALESCE(target_context_id, '') = COALESCE(?, '')
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(input.roomId, input.sourceAgentId, input.targetRunId ?? null, input.targetArtifactId ?? null, input.targetContextId ?? null) as InterventionRow | undefined;
    return row ? rowToIntervention(row) : undefined;
  }

  private setStatus(interventionId: string, status: InterventionStatus, snoozedUntil: number | null, resolvedAt: number | null): void {
    this.options.database.sqlite.prepare("UPDATE interventions SET status = ?, snoozed_until = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?").run(status, snoozedUntil, resolvedAt, interventionId);
  }

  private syncPresence(roomId: string, agentId: string, now: number, trace: EventTrace): void {
    const row = this.options.database.sqlite.prepare("SELECT status FROM interventions WHERE room_id = ? AND source_agent_id = ? AND status != 'closed'").all(roomId, agentId) as { readonly status: InterventionStatus }[];
    const state = row.some((item) => item.status === "requested" || item.status === "pending_user_decision") ? "knocking" : row.some((item) => item.status === "approved" || item.status === "injected") ? "active" : "observing";
    const existing = this.options.database.sqlite.prepare("SELECT state FROM agent_presence WHERE room_id = ? AND agent_id = ?").get(roomId, agentId) as { readonly state: string } | undefined;
    if (existing?.state === state) return;
    this.options.database.sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, ?, ?, NULL, ?)").run(roomId, agentId, state, "intervention_state", now);
    const workspace = this.options.database.sqlite.prepare("SELECT workspace_id FROM rooms WHERE id = ?").get(roomId) as { readonly workspace_id: string } | undefined;
    this.options.eventBus.publish({ id: randomUUID(), type: "agent.state.changed", schemaVersion: 1, workspaceId: workspace?.workspace_id ?? "default-workspace", roomId, agentId, traceId: trace.traceId, causationId: trace.causationId, correlationId: trace.correlationId, payload: { roomId, agentId, state, reason: "intervention_state" }, createdAt: now });
  }

  private publish(intervention: Intervention, type: InterventionEventType, payload: Record<string, unknown>, createdAt: number, trace: EventTrace): void {
    this.options.eventBus.publish(interventionEvent(type, intervention, payload, createdAt, trace));
  }
}

export function createInterventionCommandHandlers(engine: InterventionEngine): Partial<Record<Command["type"], CommandHandler>> {
  return {
    RequestIntervention: (command, meta) => commandResult(() => engine.request(inputFromCommand(command), traceFromMeta(meta)), engineDatabase(engine), stringField(command, "roomId")),
    ApproveIntervention: (command, meta) => mutateResult(() => engine.approve(requiredString(command, "interventionId"), stringField(command, "effectiveText"), traceFromMeta(meta)), engineDatabase(engine), requiredString(command, "interventionId")),
    IgnoreIntervention: (command, meta) => mutateResult(() => engine.ignore(requiredString(command, "interventionId"), traceFromMeta(meta)), engineDatabase(engine), requiredString(command, "interventionId")),
    RejectIntervention: (command, meta) => mutateResult(() => engine.reject(requiredString(command, "interventionId"), stringField(command, "reason"), traceFromMeta(meta)), engineDatabase(engine), requiredString(command, "interventionId")),
    SnoozeIntervention: (command, meta) => mutateResult(() => engine.snooze(requiredString(command, "interventionId"), numberField(command, "snoozeSeconds") ?? 300, traceFromMeta(meta)), engineDatabase(engine), requiredString(command, "interventionId"))
  } satisfies Partial<Record<Command["type"], CommandHandler>>;
}

export class InterventionNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterventionNotImplementedError";
  }
}

type InterventionEventType = "intervention.requested" | "intervention.approved" | "intervention.ignored" | "intervention.rejected" | "intervention.snoozed" | "intervention.injected" | "intervention.resolved" | "intervention.closed" | "intervention.invalid_transition";

function validateRequest(input: RequestInterventionInput): void {
  if (input.workspaceId.length === 0 || input.roomId.length === 0 || input.sourceAgentId.length === 0) throw new Error("workspaceId, roomId, and sourceAgentId are required");
  if (input.reason.length < reasonMinLength) throw new Error("intervention.reason must be at least 10 characters");
  if (input.priority !== undefined && !["low", "medium", "high"].includes(input.priority)) throw new Error("intervention.priority must be low|medium|high");
}

function inputFromCommand(command: Command): RequestInterventionInput {
  return {
    workspaceId: requiredString(command, "workspaceId"),
    roomId: requiredString(command, "roomId"),
    sourceAgentId: requiredString(command, "sourceAgentId"),
    ...(stringField(command, "targetRunId") !== undefined ? { targetRunId: stringField(command, "targetRunId") as string } : {}),
    ...(stringField(command, "targetMessageId") !== undefined ? { targetMessageId: stringField(command, "targetMessageId") as string } : {}),
    ...(stringField(command, "targetContextId") !== undefined ? { targetContextId: stringField(command, "targetContextId") as string } : {}),
    ...(stringField(command, "targetArtifactId") !== undefined ? { targetArtifactId: stringField(command, "targetArtifactId") as string } : {}),
    type: interventionType(command.typeName ?? command.interventionType ?? command.kind) ?? "knock",
    reason: requiredString(command, "reason"),
    ...(stringField(command, "preview") !== undefined ? { preview: stringField(command, "preview") as string } : {}),
    priority: priority(command.priority) ?? "medium"
  };
}

function commandResult(action: () => { readonly interventionId: string; readonly deduplicated: boolean; readonly existingId?: string }, database: AgentHubDatabase, roomId?: string): CommandResult {
  try {
    const data = action();
    return { ok: true, data, emittedEvents: latestInterventionEvents(database, data.interventionId, roomId) };
  } catch (error) {
    return errorToCommand(error);
  }
}

function mutateResult(action: () => Intervention | undefined, database: AgentHubDatabase, interventionId: string): CommandResult {
  try {
    const data = action();
    if (!data) return { ok: false, error: { code: "not_found", message: `Intervention '${interventionId}' not found` } };
    const emittedEvents = latestInterventionEvents(database, interventionId, data.roomId);
    const invalid = emittedEvents.at(-1)?.type === "intervention.invalid_transition";
    if (invalid) return { ok: false, error: { code: "conflict", message: "invalid intervention transition", details: { interventionId, status: data.status } } };
    return { ok: true, data, emittedEvents };
  } catch (error) {
    return errorToCommand(error);
  }
}

function errorToCommand(error: unknown): CommandResult {
  if (error instanceof InterventionNotImplementedError) return { ok: false, error: { code: "not_implemented", message: error.message } };
  if (error instanceof Error) return { ok: false, error: { code: "validation_failed", message: error.message } };
  return { ok: false, error: { code: "internal_error", message: String(error) } };
}

function interventionEvent(type: InterventionEventType, intervention: Intervention, payload: Record<string, unknown>, createdAt: number, trace: EventTrace): PublishInput {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId: intervention.workspaceId, roomId: intervention.roomId, ...(intervention.targetRunId !== undefined ? { runId: intervention.targetRunId } : {}), agentId: intervention.sourceAgentId, traceId: trace.traceId, causationId: trace.causationId, correlationId: trace.correlationId ?? intervention.targetRunId, payload: { interventionId: intervention.id, sourceAgentId: intervention.sourceAgentId, targetRunId: intervention.targetRunId, targetMessageId: intervention.targetMessageId, targetContextId: intervention.targetContextId, targetArtifactId: intervention.targetArtifactId, ...payload }, createdAt };
}

function rowToIntervention(row: InterventionRow): Intervention {
  return { id: row.id, workspaceId: row.workspace_id, roomId: row.room_id, sourceAgentId: row.source_agent_id, ...(row.target_run_id !== null ? { targetRunId: row.target_run_id } : {}), ...(row.target_message_id !== null ? { targetMessageId: row.target_message_id } : {}), ...(row.target_context_id !== null ? { targetContextId: row.target_context_id } : {}), ...(row.target_artifact_id !== null ? { targetArtifactId: row.target_artifact_id } : {}), type: row.type as InterventionType, reason: row.reason, ...(row.preview !== null ? { preview: row.preview } : {}), priority: row.priority as InterventionPriority, status: row.status as InterventionStatus, ...(row.snoozed_until !== null ? { snoozedUntil: row.snoozed_until } : {}), createdAt: row.created_at, ...(row.resolved_at !== null ? { resolvedAt: row.resolved_at } : {}) };
}

function latestInterventionEvents(database: AgentHubDatabase, interventionId: string, roomId?: string): { readonly seq: number; readonly type: string }[] {
  void roomId;
  return database.sqlite.prepare("SELECT seq, type FROM events WHERE type LIKE 'intervention.%' AND payload LIKE ? ORDER BY seq ASC").all(`%${interventionId}%`) as { readonly seq: number; readonly type: string }[];
}

function engineDatabase(engine: InterventionEngine): AgentHubDatabase {
  return (engine as unknown as { readonly options: { readonly database: AgentHubDatabase } }).options.database;
}

function traceFromMeta(meta: CommandMeta): EventTrace {
  return { traceId: meta.traceId };
}

function stringField(command: Command, key: string): string | undefined { const value = command[key]; return typeof value === "string" && value.length > 0 ? value : undefined; }
function numberField(command: Command, key: string): number | undefined { const value = command[key]; return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function requiredString(command: Command, key: string): string { const value = stringField(command, key); if (value === undefined) throw new Error(`${key} is required`); return value; }
function interventionType(value: unknown): InterventionType | undefined { return value === "knock" || value === "tag" || value === "rule" || value === "emergency" || value === "rollback" ? value : undefined; }
function priority(value: unknown): InterventionPriority | undefined { return value === "low" || value === "medium" || value === "high" ? value : undefined; }

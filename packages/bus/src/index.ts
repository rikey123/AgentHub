import { createHash, randomUUID } from "node:crypto";

import { Schema } from "effect";

import type { AgentHubDatabase } from "@agenthub/db";
import {
  EVENT_REGISTRY_BY_TYPE,
  EventEnvelopeSchema,
  EventMigrator,
  getEventRegistryEntry,
  isRegisteredEventType,
  type EventEnvelope,
  type EventType
} from "@agenthub/protocol/events";
import type { EventVisibility } from "@agenthub/protocol";

export type PublishInput = Omit<EventEnvelope, "seq" | "durability" | "visibility"> & {
  readonly seq?: number;
  readonly durability?: EventEnvelope["durability"];
  readonly visibility?: EventVisibility;
};

export type PublishResult =
  | { readonly durability: "durable"; readonly seq: number; readonly event: EventEnvelope }
  | { readonly durability: "ephemeral"; readonly event: EventEnvelope };

export type EventBusSubscriber = (event: EventEnvelope) => void | Promise<void>;
export type Unsubscribe = () => void;

export type ReplayView = "main" | "detail" | "raw" | "mobile";

export type ReplayFilters = {
  readonly workspaceId?: string;
  readonly roomId?: string;
  readonly runId?: string;
  readonly type?: EventType;
  readonly visibility?: EventVisibility | readonly EventVisibility[];
  readonly view?: ReplayView;
};

export type PubSubChannelName = "durable" | "message_delta" | "tool_update" | "status_line" | "adapter_raw" | "system_notice";
export type PubSubChannelStats = { readonly channel: PubSubChannelName; readonly capacity: number; readonly size: number; readonly dropped: number; readonly highWatermark: number };
export type PubSubCapacityConfig = Partial<Record<PubSubChannelName, number>>;

export type EventTraceContext = {
  readonly traceId?: string;
  readonly causationId?: string;
  readonly correlationId?: string;
};

export type EventBusOptions = {
  readonly database: AgentHubDatabase;
  readonly deltaCoalesceMs?: number;
  readonly pubsubCapacities?: PubSubCapacityConfig;
  readonly now?: () => number;
  readonly onSubscriberError?: (error: unknown, event: EventEnvelope) => void;
};

type SqliteRow = {
  readonly id: string;
  readonly seq: number;
  readonly type: string;
  readonly schema_version: number;
  readonly visibility: EventVisibility;
  readonly workspace_id: string | null;
  readonly room_id: string | null;
  readonly task_id: string | null;
  readonly run_id: string | null;
  readonly agent_id: string | null;
  readonly trace_id: string | null;
  readonly causation_id: string | null;
  readonly correlation_id: string | null;
  readonly payload: string;
  readonly created_at: number;
};

type DeltaBuffer = {
  envelope: EventEnvelope;
  timer: ReturnType<typeof setTimeout>;
};

export type CommandType =
  | "SendMessage"
  | "RegenerateMessage"
  | "DeleteMessage"
  | "PinMessage"
  | "EditMessage"
  | "CancelPendingTurn"
  | "CreateArtifact"
  | "ReviewArtifact"
  | "ApplyDiff"
  | "RejectDiff"
  | "RevertArtifact"
  | "ResolvePermission"
  | "RequestIntervention"
  | "CreatePermissionProfile"
  | "PatchPermissionProfile"
  | "DeletePermissionRule"
  | "ApproveIntervention"
  | "IgnoreIntervention"
  | "RejectIntervention"
  | "SnoozeIntervention"
  | "ConfirmContextItem"
  | "ProposeContextItem"
  | "WriteContextItem"
  | "UpdateContextItem"
  | "DeprecateContextItem"
  | "PinContextItem"
  | "CancelRun"
  | "CreateTask"
  | "UpdateTask"
  | "CompleteTask"
  | "CreateRoom"
  | "ArchiveRoom"
  | "UnarchiveRoom"
  | "ReloadAgentProfile"
  | "WakeAgent"
  | "RetryRun"
  | "InjectContext"
  | "ConsumePendingTurn"
  // V1.1 additions
  | "AddParticipant"    // POST /rooms/:id/participants — user-initiated team expansion (D10)
  | "ApplyWorktree"     // POST /rooms/:id/worktrees/:runId/apply — apply worktree diff (D3)
  | "DiscardWorktree";  // POST /rooms/:id/worktrees/:runId/discard — discard worktree (D3)

export type Command = {
  readonly type: CommandType;
  readonly idempotencyKey?: string;
  readonly [key: string]: unknown;
};

export type CommandErrorCode =
  | "validation_failed"
  | "not_found"
  | "conflict"
  | "permission_denied"
  | "duplicate"
  | "delegation_too_deep"
  | "delegation_duplicate"
  | "not_implemented"
  | "internal_error"
  | "transaction_rollback"
  | "crash"
  | "rate_limited"
  | "lock_timeout";

export type CommandResult<T = unknown> =
  | { readonly ok: true; readonly data: T; readonly emittedEvents: readonly { readonly seq: number; readonly type: string }[] }
  | { readonly ok: false; readonly error: { readonly code: CommandErrorCode; readonly message: string; readonly details?: unknown } };

export type CommandMeta = {
  readonly actor: { readonly type: "user"; readonly id: string } | { readonly type: "agent"; readonly id: string } | { readonly type: "system" };
  readonly traceId: string;
  readonly idempotencyKey?: string;
  readonly origin: "http" | "internal" | "mcp_tool";
};

export type CommandHandler<C extends Command = Command> = (command: C, meta: CommandMeta) => CommandResult | Promise<CommandResult>;

export type CommandBusOptions = {
  readonly database: AgentHubDatabase;
  readonly handlers?: Partial<Record<CommandType, CommandHandler>>;
  readonly now?: () => number;
};

export type RetryMetadata = {
  readonly attempt: number;
  readonly maxAttempts: number;
};

export type DurableHandler = {
  readonly name: string;
  readonly subscribes: readonly EventType[];
  readonly handle: (event: EventEnvelope, retry: RetryMetadata) => void | Promise<void>;
};

export type DurableHandlerRegistryOptions = {
  readonly database: AgentHubDatabase;
  readonly now?: () => number;
  readonly retryDelaysMs?: readonly number[];
};

export type OutboxDispatcherOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly handlers?: DurableHandlerRegistry;
  readonly maxAttempts?: number;
  readonly now?: () => number;
};

type CommandRecordRow = {
  readonly command_hash: string;
  readonly status: string;
  readonly result_json: string | null;
  readonly created_at: number;
};

type OutboxRow = {
  readonly event_id: string;
  readonly attempts: number;
};

const canonicalCommandTypes = new Set<CommandType>([
  "SendMessage",
  "RegenerateMessage",
  "DeleteMessage",
  "PinMessage",
  "EditMessage",
  "CancelPendingTurn",
  "CreateArtifact",
  "ReviewArtifact",
  "ApplyDiff",
  "RejectDiff",
  "RevertArtifact",
  "ResolvePermission",
  "RequestIntervention",
  "CreatePermissionProfile",
  "PatchPermissionProfile",
  "DeletePermissionRule",
  "ApproveIntervention",
  "IgnoreIntervention",
  "RejectIntervention",
  "SnoozeIntervention",
  "ConfirmContextItem",
  "ProposeContextItem",
  "WriteContextItem",
  "UpdateContextItem",
  "DeprecateContextItem",
  "PinContextItem",
  "CancelRun",
  "CreateTask",
  "UpdateTask",
  "CompleteTask",
  "CreateRoom",
  "ArchiveRoom",
  "UnarchiveRoom",
  "ReloadAgentProfile",
  "WakeAgent",
  "RetryRun",
  "InjectContext",
  "ConsumePendingTurn",
  // V1.1 additions
  "AddParticipant",
  "ApplyWorktree",
  "DiscardWorktree"
]);

const internalOnlyCommandTypes = new Set<CommandType>(["WakeAgent", "RetryRun", "InjectContext", "ConsumePendingTurn"]);
const forbiddenCommandTypes = new Set([`${"Start"}Run`, `${"ApplyMailboxClaim"}Rollback`]);
const deterministicErrorCodes = new Set<CommandErrorCode>([
  "validation_failed",
  "permission_denied",
  "conflict",
  "duplicate",
  "not_found",
  "not_implemented"
]);

export class InvalidEventEnvelopeError extends Error {
  constructor(readonly reason: string) {
    super(`InvalidEventEnvelope: ${reason}`);
    this.name = "InvalidEventEnvelopeError";
  }
}

export class EventBus {
  private readonly allSubscribers = new Set<EventBusSubscriber>();
  private readonly typeSubscribers = new Map<EventType, Set<EventBusSubscriber>>();
  private readonly migrator = new EventMigrator();
  private readonly deltaBuffers = new Map<string, DeltaBuffer>();
  private readonly deltaCoalesceMs: number;
  private readonly boundedPubSub: BoundedPubSub;
  private readonly now: () => number;
  private readonly onSubscriberError: ((error: unknown, event: EventEnvelope) => void) | undefined;
  // Optional bridge to a DurableHandlerRegistry. Set by the orchestrator
  // wiring layer so that `publish()` can immediately notify durable handlers
  // (run-queue, status-line flush) for events that come from the in-process
  // event loop, instead of relying on the outbox drain at the next HTTP
  // dispatch boundary.
  private durableNotifier: ((event: EventEnvelope) => Promise<void> | void) | undefined;

  constructor(private readonly options: EventBusOptions) {
    this.deltaCoalesceMs = options.deltaCoalesceMs ?? 40;
    this.boundedPubSub = new BoundedPubSub(options.pubsubCapacities);
    this.now = options.now ?? Date.now;
    this.onSubscriberError = options.onSubscriberError;
  }

  publish(input: PublishInput): PublishResult {
    const envelope = this.prepareEnvelope(input);

    if (envelope.durability === "durable") {
      const persisted = this.persistDurable(envelope);
      // Deliver durable events to in-process subscribers (e.g. SSE clients)
      // and durable handlers (e.g. run-queue) immediately, then mark the
      // outbox row as dispatched. Without this, subscribers and handlers only
      // see new events when something else triggers `OutboxDispatcher.drainPending`
      // (e.g. the next HTTP command), so a long-running agent run that emits
      // events between user commands appears frozen until the next click.
      // The outbox row stays as a crash-recovery / retry log; on daemon
      // restart, any rows still 'pending' get redelivered by the startup drain.
      this.deliver(persisted);
      if (this.durableNotifier) {
        const result = this.durableNotifier(persisted);
        if (result && typeof result === "object" && "catch" in result && typeof result.catch === "function") {
          result.catch((error: unknown) => this.onSubscriberError?.(error, persisted));
        }
      }
      this.markOutboxDispatched(persisted.id);
      return { durability: "durable", seq: persisted.seq as number, event: persisted };
    }

    if (isCoalescableDelta(envelope)) {
      this.enqueueDelta(envelope);
      return { durability: "ephemeral", event: envelope };
    }

    this.deliver(envelope);
    return { durability: "ephemeral", event: envelope };
  }

  setDurableNotifier(notifier: ((event: EventEnvelope) => Promise<void> | void) | undefined): void {
    this.durableNotifier = notifier;
  }

  private markOutboxDispatched(eventId: string): void {
    try {
      this.options.database.sqlite
        .prepare("UPDATE outbox SET status = 'dispatched', dispatched_at = ?, last_error = NULL WHERE event_id = ? AND status = 'pending'")
        .run(this.now(), eventId);
    } catch {
      // ignore — outbox is best-effort here; if the update fails the row
      // remains 'pending' and will be picked up on the next drain.
    }
  }

  subscribeAll(subscriber: EventBusSubscriber): Unsubscribe {
    this.allSubscribers.add(subscriber);
    return () => {
      this.allSubscribers.delete(subscriber);
    };
  }

  subscribe(type: EventType, subscriber: EventBusSubscriber): Unsubscribe {
    const subscribers = this.typeSubscribers.get(type) ?? new Set<EventBusSubscriber>();
    subscribers.add(subscriber);
    this.typeSubscribers.set(type, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        this.typeSubscribers.delete(type);
      }
    };
  }

  replayDurableSinceSeq(seq: number, filters: ReplayFilters = {}): EventEnvelope[] {
    if (filters.view === "raw") {
      return [];
    }

    const clauses = ["seq > ?"];
    const params: unknown[] = [seq];

    if (filters.workspaceId !== undefined) {
      clauses.push("workspace_id = ?");
      params.push(filters.workspaceId);
    }
    if (filters.roomId !== undefined) {
      clauses.push("room_id = ?");
      params.push(filters.roomId);
    }
    if (filters.runId !== undefined) {
      clauses.push("run_id = ?");
      params.push(filters.runId);
    }
    if (filters.type !== undefined) {
      clauses.push("type = ?");
      params.push(filters.type);
    }

    const visibilityFilter = visibilityValuesFor(filters);
    if (visibilityFilter.length > 0) {
      clauses.push(`visibility IN (${visibilityFilter.map(() => "?").join(", ")})`);
      params.push(...visibilityFilter);
    }

    const rows = this.options.database.sqlite
      .prepare(`SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY seq ASC`)
      .all(...params) as SqliteRow[];

    return rows.map((row) => this.migrator.migrate(rowToEnvelope(row)));
  }

  flushDeltas(): void {
    for (const [key, buffer] of this.deltaBuffers) {
      clearTimeout(buffer.timer);
      this.deltaBuffers.delete(key);
      this.deliver(buffer.envelope);
    }
  }

  pubSubStats(): PubSubChannelStats[] {
    return this.boundedPubSub.stats();
  }

  close(): void {
    for (const buffer of this.deltaBuffers.values()) {
      clearTimeout(buffer.timer);
    }
    this.deltaBuffers.clear();
    this.allSubscribers.clear();
    this.typeSubscribers.clear();
  }

  eventById(eventId: string): EventEnvelope | undefined {
    const row = this.options.database.sqlite.prepare("SELECT * FROM events WHERE id = ?").get(eventId) as SqliteRow | undefined;
    return row ? this.migrator.migrate(rowToEnvelope(row)) : undefined;
  }

  deliverPersisted(event: EventEnvelope): void {
    if (event.durability !== "durable" || event.seq === undefined) {
      throw new InvalidEventEnvelopeError("persisted delivery requires durable event with seq");
    }
    this.deliver(event);
  }

  private prepareEnvelope(input: PublishInput): EventEnvelope {
    if (!isRegisteredEventType(input.type)) {
      throw new InvalidEventEnvelopeError(`event type '${input.type}' not found in canonical registry`);
    }

    const registryEntry = getEventRegistryEntry(input.type);
    if (input.schemaVersion !== registryEntry.schemaVersion) {
      throw new InvalidEventEnvelopeError(
        `schemaVersion_mismatch expected ${registryEntry.schemaVersion} got ${input.schemaVersion}`
      );
    }
    if (input.durability !== undefined && input.durability !== registryEntry.durability) {
      throw new InvalidEventEnvelopeError(
        `durability_mismatch expected ${registryEntry.durability} got ${input.durability}`
      );
    }
    if (input.visibility !== undefined && input.visibility !== registryEntry.visibility) {
      throw new InvalidEventEnvelopeError(
        `visibility_mismatch expected ${registryEntry.visibility} got ${input.visibility}`
      );
    }
    if (registryEntry.durability === "ephemeral" && input.seq !== undefined) {
      throw new InvalidEventEnvelopeError(`ephemeral event '${input.type}' must not carry seq`);
    }

    const candidate = {
      ...input,
      durability: registryEntry.durability,
      visibility: registryEntry.visibility
    };

    if (registryEntry.durability === "durable" && candidate.seq === undefined) {
      return Schema.decodeUnknownSync(EventEnvelopeSchema)(candidate);
    }

    const decoded = Schema.decodeUnknownSync(EventEnvelopeSchema)(candidate);
    if (decoded.durability === "durable" && decoded.seq !== undefined) {
      throw new InvalidEventEnvelopeError(`durable event '${decoded.type}' seq is assigned by EventBus persistence`);
    }
    return decoded;
  }

  private persistDurable(envelope: EventEnvelope): EventEnvelope {
    const insertDurable = this.options.database.sqlite.transaction(() => {
      const nextSeq = ((this.options.database.sqlite.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events").get() as { seq: number }).seq);
      const persisted = { ...envelope, seq: nextSeq };
       this.options.database.sqlite
        .prepare(
          `INSERT INTO events (
            id, seq, type, schema_version, visibility, workspace_id, room_id, task_id, run_id, agent_id,
            trace_id, causation_id, correlation_id, payload, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          persisted.id,
          persisted.seq,
          persisted.type,
          persisted.schemaVersion,
          persisted.visibility,
          persisted.workspaceId,
          persisted.roomId ?? null,
          persisted.taskId ?? null,
          persisted.runId ?? null,
          persisted.agentId ?? null,
          persisted.traceId ?? null,
          persisted.causationId ?? null,
          persisted.correlationId ?? null,
          JSON.stringify(persisted.payload),
          persisted.createdAt
        );
      this.options.database.sqlite
        .prepare(
          `INSERT INTO outbox (event_id, seq, status, attempts, last_error, enqueued_at, dispatched_at)
           VALUES (?, ?, 'pending', 0, NULL, ?, NULL)`
        )
        .run(persisted.id, persisted.seq, this.now());
      return persisted;
    });

    return this.migrator.migrate(insertDurable());
  }

  private enqueueDelta(envelope: EventEnvelope): void {
    const key = deltaCoalesceKey(envelope);
    const existing = this.deltaBuffers.get(key);
    if (existing) {
      existing.envelope = mergeDeltaEnvelope(existing.envelope, envelope);
      return;
    }

    const timer = setTimeout(() => {
      const buffered = this.deltaBuffers.get(key);
      if (!buffered) {
        return;
      }
      this.deltaBuffers.delete(key);
      this.deliver(buffered.envelope);
    }, this.deltaCoalesceMs);
    timer.unref?.();
    this.deltaBuffers.set(key, { envelope, timer });
  }

  private deliver(event: EventEnvelope): void {
    const accepted = this.boundedPubSub.record(eventChannel(event));
    if (!accepted) return;
    const subscribers = [
      ...this.allSubscribers,
      ...(this.typeSubscribers.get(event.type as EventType) ?? [])
    ];

    for (const subscriber of subscribers) {
      try {
        const result = subscriber(event);
        if (result && typeof result === "object" && "catch" in result && typeof result.catch === "function") {
          result.catch((error: unknown) => this.onSubscriberError?.(error, event));
        }
      } catch (error) {
        this.onSubscriberError?.(error, event);
      }
    }
  }
}

class BoundedPubSub {
  private readonly capacities: Record<PubSubChannelName, number>;
  private readonly state = new Map<PubSubChannelName, { size: number; dropped: number; highWatermark: number }>();
  private readonly drainScheduled = new Set<PubSubChannelName>();
  constructor(config: PubSubCapacityConfig = {}) {
    this.capacities = { durable: config.durable ?? 4096, message_delta: config.message_delta ?? 1024, tool_update: config.tool_update ?? 512, status_line: config.status_line ?? 64, adapter_raw: config.adapter_raw ?? 256, system_notice: config.system_notice ?? 128 };
    for (const [channel, capacity] of Object.entries(this.capacities) as [PubSubChannelName, number][]) {
      if ((channel === "durable" && capacity < 1024) || (channel !== "durable" && capacity < 64)) throw new Error(`pubsub capacity for ${channel} is below minimum`);
      this.state.set(channel, { size: 0, dropped: 0, highWatermark: 0 });
    }
  }
  record(channel: PubSubChannelName): boolean {
    const state = this.state.get(channel) as { size: number; dropped: number; highWatermark: number };
    const capacity = this.capacities[channel];
    if (state.size >= capacity) {
      if (channel === "durable") return false;
      state.dropped += 1;
      state.size = capacity - 1;
    }
    state.size += 1;
    state.highWatermark = Math.max(state.highWatermark, state.size);
    this.scheduleDrain(channel);
    return true;
  }
  stats(): PubSubChannelStats[] {
    return (["durable", "message_delta", "tool_update", "status_line", "adapter_raw", "system_notice"] as const).map((channel) => ({ channel, capacity: this.capacities[channel], size: this.state.get(channel)?.size ?? 0, dropped: this.state.get(channel)?.dropped ?? 0, highWatermark: this.state.get(channel)?.highWatermark ?? 0 }));
  }

  private scheduleDrain(channel: PubSubChannelName): void {
    if (this.drainScheduled.has(channel)) return;
    this.drainScheduled.add(channel);
    queueMicrotask(() => {
      const state = this.state.get(channel);
      if (state !== undefined) state.size = 0;
      this.drainScheduled.delete(channel);
    });
  }
}

export class CommandBus {
  private readonly handlers: Partial<Record<CommandType, CommandHandler>>;
  private readonly now: () => number;

  constructor(private readonly options: CommandBusOptions) {
    this.handlers = options.handlers ?? {};
    this.now = options.now ?? Date.now;
  }

  dispatch<C extends Command>(command: C, meta: CommandMeta): CommandResult | Promise<CommandResult> {
    const validation = this.validateCommand(command, meta);
    if (validation !== undefined) {
      return validation;
    }

    const idempotencyKey = meta.idempotencyKey ?? command.idempotencyKey;
    if (idempotencyKey === undefined || idempotencyKey.length === 0) {
      return this.execute(command, meta);
    }

    this.reapExpiredCommandRecords();
    return this.dispatchIdempotent(command, meta, idempotencyKey);
  }

  private dispatchIdempotent<C extends Command>(command: C, meta: CommandMeta, idempotencyKey: string): CommandResult | Promise<CommandResult> {
    // Reject async handlers before touching the DB: an async handler can produce side effects
    // after its first await even if we rollback the savepoint, so we must never invoke one in
    // the idempotent path.
    const handler = this.handlers[command.type];
    if (handler !== undefined && isAsyncFunction(handler)) {
      return failedCommand("internal_error", "idempotent command handlers must be synchronous to preserve transaction atomicity");
    }
    const actor = actorIdentity(meta);
    const commandHash = hashCommand(command);
    const now = this.now();
    const expiresAt = now + 24 * 60 * 60 * 1000;
    return this.options.database.sqlite.transaction(() => {
      const existing = this.options.database.sqlite
        .prepare(
          `SELECT command_hash, status, result_json, created_at
           FROM command_records
           WHERE actor_type = ? AND actor_id = ? AND idempotency_key = ?`
        )
        .get(actor.type, actor.id, idempotencyKey) as CommandRecordRow | undefined;

      if (existing) {
        if (existing.status === "in_flight" && now - existing.created_at <= 60_000) {
          return duplicateResult("command in flight");
        }
        if ((existing.status === "succeeded" || existing.status === "failed") && existing.command_hash === commandHash) {
          return parseCachedResult(existing.result_json);
        }
        if ((existing.status === "succeeded" || existing.status === "failed") && existing.command_hash !== commandHash) {
          return duplicateResult("idempotencyKey reused with different body");
        }
        this.options.database.sqlite
          .prepare(
            `UPDATE command_records
             SET command_type = ?, command_hash = ?, status = 'in_flight', result_json = NULL, trace_id = ?, created_at = ?, expires_at = ?
             WHERE actor_type = ? AND actor_id = ? AND idempotency_key = ?`
          )
          .run(command.type, commandHash, meta.traceId, now, expiresAt, actor.type, actor.id, idempotencyKey);
      }

      if (!existing) {
        this.options.database.sqlite
          .prepare(
            `INSERT INTO command_records (
              actor_type, actor_id, idempotency_key, command_type, command_hash, status, result_json, trace_id, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, 'in_flight', NULL, ?, ?, ?)`
          )
          .run(actor.type, actor.id, idempotencyKey, command.type, commandHash, meta.traceId, now, expiresAt);
      }

      return this.executeAndFinalizeIdempotent(command, meta, actor, idempotencyKey);
    })();
  }

  private executeAndFinalizeIdempotent<C extends Command>(command: C, meta: CommandMeta, actor: { type: string; id: string }, idempotencyKey: string): CommandResult {
    const savepointName = `command_handler_${randomUUID().replace(/-/gu, "_")}`;
    this.options.database.sqlite.exec(`SAVEPOINT ${savepointName}`);
    try {
      const result = this.execute(command, meta);
      if (isPromiseLike(result)) {
        this.rollbackAndReleaseSavepoint(savepointName);
        this.deleteCommandRecord(actor, idempotencyKey);
        // SPEC RECONCILIATION (bus-runtime §3.9 / tasks.md §3.9):
        // Idempotent handlers MUST be synchronous. Native async functions are pre-rejected by
        // isAsyncFunction() before invocation. For non-async functions that return a Promise,
        // we can only detect the violation after invocation: the savepoint rollback covers any
        // synchronous DB writes made before the first await, but post-await side effects cannot
        // be prevented by a synchronous SQLite transaction. This is a known limitation of the
        // SQLite sync transaction model. The command record is deleted so the key can retry, and
        // the caller receives internal_error. All real-world idempotent handlers in this codebase
        // are synchronous; this path is a safety net, not a guarantee.
        result.catch(() => undefined);
        return failedCommand("internal_error", "idempotent command handlers must complete synchronously to preserve transaction atomicity");
      }

      if (result.ok) {
        this.options.database.sqlite.exec(`RELEASE SAVEPOINT ${savepointName}`);
        this.persistCommandRecordResult(actor, idempotencyKey, "succeeded", result);
        return result;
      }

      if (shouldPersistFailedRecord(result.error.code)) {
        this.rollbackAndReleaseSavepoint(savepointName);
        this.persistCommandRecordResult(actor, idempotencyKey, "failed", result);
        return result;
      }

      this.rollbackAndReleaseSavepoint(savepointName);
      this.deleteCommandRecord(actor, idempotencyKey);
      return result;
    } catch (error) {
      this.rollbackAndReleaseSavepoint(savepointName);
      this.deleteCommandRecord(actor, idempotencyKey);
      throw error;
    }
  }

  private persistCommandRecordResult(actor: { type: string; id: string }, idempotencyKey: string, status: "succeeded" | "failed", result: CommandResult): void {
    this.options.database.sqlite
      .prepare(
        `UPDATE command_records
         SET status = ?, result_json = ?
         WHERE actor_type = ? AND actor_id = ? AND idempotency_key = ?`
      )
      .run(status, JSON.stringify(result), actor.type, actor.id, idempotencyKey);
  }

  private deleteCommandRecord(actor: { type: string; id: string }, idempotencyKey: string): void {
    this.options.database.sqlite
      .prepare("DELETE FROM command_records WHERE actor_type = ? AND actor_id = ? AND idempotency_key = ?")
      .run(actor.type, actor.id, idempotencyKey);
  }

  private rollbackAndReleaseSavepoint(savepointName: string): void {
    this.options.database.sqlite.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
    this.options.database.sqlite.exec(`RELEASE SAVEPOINT ${savepointName}`);
  }

  private execute<C extends Command>(command: C, meta: CommandMeta): CommandResult | Promise<CommandResult> {
    const handler = this.handlers[command.type];
    if (!handler) {
      return failedCommand("not_implemented", `Command '${command.type}' has no registered handler`);
    }
    return handler(command, meta);
  }

  private validateCommand(command: Command, meta: CommandMeta): CommandResult | undefined {
    if (forbiddenCommandTypes.has(command.type)) {
      return failedCommand("validation_failed", `Command '${command.type}' is forbidden`);
    }
    if (!canonicalCommandTypes.has(command.type)) {
      return failedCommand("validation_failed", `Unknown Command '${command.type}'`);
    }
    if ((meta.origin === "http" || meta.origin === "mcp_tool") && internalOnlyCommandTypes.has(command.type)) {
      return failedCommand("validation_failed", "internal_command_via_http", { commandType: command.type });
    }
    return undefined;
  }

  private reapExpiredCommandRecords(): void {
    const now = this.now();
    this.options.database.sqlite
      .prepare("UPDATE command_records SET status = 'expired' WHERE status = 'in_flight' AND created_at < ?")
      .run(now - 60_000);
    this.options.database.sqlite.prepare("DELETE FROM command_records WHERE expires_at < ?").run(now);
  }
}

export class DurableHandlerRegistry {
  private readonly handlers = new Map<string, DurableHandler>();
  // `draining` guards `drainHandler` from running concurrently for the same
  // handler — it iterates the persisted event log and would conflict with
  // itself. `inHandle` is finer-grained: it's true only while a handler's
  // `handle()` is awaited, so reentrant `notify()` calls (caused by handlers
  // that publish events from inside `handle`) are deferred via `pendingDrains`
  // instead of racing with the in-flight call.
  private readonly draining = new Set<string>();
  private readonly inHandle = new Set<string>();
  // Tracks handler names whose handle() invocation tried to publish-and-deliver
  // a new event while still in-flight. After the outer handle() finishes, we
  // drain again so the deferred events get processed in order.
  private readonly pendingDrains = new Set<string>();
  private readonly retryDelaysMs: readonly number[];
  private readonly now: () => number;

  constructor(private readonly options: DurableHandlerRegistryOptions) {
    this.retryDelaysMs = options.retryDelaysMs ?? [1000, 4000, 16000, 60000, 300000];
    this.now = options.now ?? Date.now;
  }

  register(handler: DurableHandler): void {
    this.handlers.set(handler.name, handler);
    this.options.database.sqlite
      .prepare("INSERT OR IGNORE INTO handler_cursors (handler_name, last_seq, updated_at) VALUES (?, 0, ?)")
      .run(handler.name, this.now());
  }

  catchUp(): Promise<void> {
    return this.drainAll();
  }

  notify(event: EventEnvelope): Promise<void> {
    const tasks = [...this.handlers.values()].map((handler) => this.processHandler(handler, event));
    return Promise.all(tasks).then(() => undefined);
  }

  private async drainAll(): Promise<void> {
    for (const handler of this.handlers.values()) {
      await this.drainHandler(handler);
    }
  }

  private async drainHandler(handler: DurableHandler): Promise<void> {
    if (this.draining.has(handler.name)) {
      return;
    }
    this.draining.add(handler.name);
    try {
      const cursor = this.cursorFor(handler.name);
      const events = this.options.database.sqlite
        .prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq ASC")
        .all(cursor) as SqliteRow[];
      for (const row of events) {
        const event = this.eventFromRow(row);
        const ok = await this.processHandler(handler, event);
        if (!ok) {
          break;
        }
      }
    } finally {
      this.draining.delete(handler.name);
    }
  }

  private async processHandler(handler: DurableHandler, event: EventEnvelope): Promise<boolean> {
    if (event.seq === undefined) {
      return true;
    }
    // Reentrancy guard: with in-process delivery via `setDurableNotifier`, a
    // handler's `handle()` can publish new events (e.g. run-queue's
    // `markStarting` publishes `agent.run.started` while handling
    // `agent.run.queued`). Re-entering `processHandler` from inside the await
    // would race with the outer call and could spawn duplicate adapter
    // sessions for the same run. We defer the reentrant call by recording a
    // pending drain; the outer `processHandler` will run `drainHandler` once
    // its `handle()` finishes, picking up the queued events in seq order.
    if (this.inHandle.has(handler.name)) {
      this.pendingDrains.add(handler.name);
      return true;
    }
    const currentCursor = this.cursorFor(handler.name);
    if (event.seq <= currentCursor) {
      return true;
    }
    if (event.seq !== currentCursor + 1) {
      await this.drainHandler(handler);
      return this.cursorFor(handler.name) >= event.seq;
    }

    if (!handler.subscribes.includes(event.type as EventType)) {
      this.advanceCursor(handler.name, event.seq);
      return true;
    }

    this.inHandle.add(handler.name);
    try {
      for (let attempt = 1; attempt <= this.retryDelaysMs.length; attempt += 1) {
        try {
          await handler.handle(event, { attempt, maxAttempts: this.retryDelaysMs.length });
          this.advanceCursor(handler.name, event.seq);
          return true;
        } catch (error) {
          if (attempt === this.retryDelaysMs.length) {
            this.writeDeadLetter(handler.name, event, attempt, error);
            return false;
          }
          await sleep(this.retryDelaysMs[attempt - 1] ?? 0);
        }
      }

      return false;
    } finally {
      this.inHandle.delete(handler.name);
      // If notify() was called for this handler while we were awaiting handle(),
      // drain the deferred events now (in order, via the persisted event log).
      if (this.pendingDrains.delete(handler.name)) {
        await this.drainHandler(handler);
      }
    }
  }

  private cursorFor(handlerName: string): number {
    const row = this.options.database.sqlite
      .prepare("SELECT last_seq FROM handler_cursors WHERE handler_name = ?")
      .get(handlerName) as { last_seq: number } | undefined;
    if (row) {
      return row.last_seq;
    }
    this.options.database.sqlite
      .prepare("INSERT INTO handler_cursors (handler_name, last_seq, updated_at) VALUES (?, 0, ?)")
      .run(handlerName, this.now());
    return 0;
  }

  private advanceCursor(handlerName: string, seq: number): void {
    this.options.database.sqlite
      .prepare("UPDATE handler_cursors SET last_seq = ?, updated_at = ? WHERE handler_name = ?")
      .run(seq, this.now(), handlerName);
  }

  private writeDeadLetter(handlerName: string, event: EventEnvelope, attempts: number, error: unknown): void {
    this.options.database.sqlite
      .prepare(
        `INSERT INTO dead_letter_events (id, handler_name, event_id, event_seq, attempts, last_error, failed_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unresolved')`
      )
      .run(randomUUID(), handlerName, event.id, event.seq, attempts, errorMessage(error), this.now());
  }

  private eventFromRow(row: SqliteRow): EventEnvelope {
    return this.options.database === undefined ? rowToEnvelope(row) : this.eventMigrator().migrate(rowToEnvelope(row));
  }

  private eventMigrator(): EventMigrator {
    return new EventMigrator();
  }
}

export class OutboxDispatcher {
  private readonly maxAttempts: number;
  private readonly now: () => number;

  constructor(private readonly options: OutboxDispatcherOptions) {
    this.maxAttempts = options.maxAttempts ?? 10;
    this.now = options.now ?? Date.now;
  }

  async drainPending(): Promise<void> {
    const rows = this.options.database.sqlite
      .prepare("SELECT event_id, attempts FROM outbox WHERE status = 'pending' ORDER BY seq ASC")
      .all() as OutboxRow[];
    for (const row of rows) {
      await this.dispatchOne(row);
    }
  }

  private async dispatchOne(row: OutboxRow): Promise<void> {
    const event = this.options.eventBus.eventById(row.event_id);
    if (!event) {
      this.markFailed(row, new Error(`outbox event '${row.event_id}' not found`));
      return;
    }

    try {
      this.options.eventBus.deliverPersisted(event);
      await this.options.handlers?.notify(event);
      this.options.database.sqlite
        .prepare("UPDATE outbox SET status = 'dispatched', dispatched_at = ?, last_error = NULL WHERE event_id = ?")
        .run(this.now(), row.event_id);
    } catch (error) {
      this.markFailed(row, error);
    }
  }

  private markFailed(row: OutboxRow, error: unknown): void {
    const attempts = row.attempts + 1;
    const status = attempts >= this.maxAttempts ? "failed" : "pending";
    this.options.database.sqlite
      .prepare("UPDATE outbox SET attempts = ?, status = ?, last_error = ? WHERE event_id = ?")
      .run(attempts, status, errorMessage(error), row.event_id);
  }
}

export function createEventBus(options: EventBusOptions): EventBus {
  return new EventBus(options);
}

export function createCommandBus(options: CommandBusOptions): CommandBus {
  return new CommandBus(options);
}

export function createDurableHandlerRegistry(options: DurableHandlerRegistryOptions): DurableHandlerRegistry {
  return new DurableHandlerRegistry(options);
}

export function createOutboxDispatcher(options: OutboxDispatcherOptions): OutboxDispatcher {
  return new OutboxDispatcher(options);
}

export function traceFromEvent(event: Pick<EventEnvelope, "id" | "traceId" | "correlationId">): EventTraceContext {
  return {
    ...(event.traceId !== undefined ? { traceId: event.traceId } : {}),
    causationId: event.id,
    ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {})
  };
}

export function applyTraceContext<T extends PublishInput>(event: T, trace: EventTraceContext): T {
  return {
    ...event,
    ...(trace.traceId !== undefined ? { traceId: trace.traceId } : {}),
    ...(trace.causationId !== undefined ? { causationId: trace.causationId } : {}),
    ...(trace.correlationId !== undefined ? { correlationId: trace.correlationId } : {})
  };
}

export function eventRegistryEntryFor(type: EventType) {
  return EVENT_REGISTRY_BY_TYPE.get(type);
}

function visibilityValuesFor(filters: ReplayFilters): readonly EventVisibility[] {
  if (filters.visibility !== undefined) {
    return typeof filters.visibility === "string" ? [filters.visibility] : filters.visibility;
  }
  if (filters.view === "main" || filters.view === "mobile") {
    return ["main", "both"];
  }
  if (filters.view === "detail") {
    return ["detail", "both"];
  }
  return [];
}

function eventChannel(event: EventEnvelope): PubSubChannelName {
  if (event.durability === "durable") return "durable";
  if (event.type === "message.part.delta" || event.type === "agent.token.delta") return "message_delta";
  if (event.type === "tool.output.delta" || event.type === "tool.update.diverted") return "tool_update";
  if (event.type === "agent.status_line.updated") return "status_line";
  if (event.type === "adapter.raw.stdout" || event.type === "adapter.raw.stderr") return "adapter_raw";
  return "system_notice";
}

function rowToEnvelope(row: SqliteRow): EventEnvelope {
  return {
    id: row.id,
    seq: row.seq,
    type: row.type as EventType,
    schemaVersion: row.schema_version,
    durability: "durable",
    visibility: row.visibility,
    workspaceId: row.workspace_id ?? "",
    ...(row.room_id !== null ? { roomId: row.room_id } : {}),
    ...(row.task_id !== null ? { taskId: row.task_id } : {}),
    ...(row.run_id !== null ? { runId: row.run_id } : {}),
    ...(row.agent_id !== null ? { agentId: row.agent_id } : {}),
    ...(row.trace_id !== null ? { traceId: row.trace_id } : {}),
    ...(row.causation_id !== null ? { causationId: row.causation_id } : {}),
    ...(row.correlation_id !== null ? { correlationId: row.correlation_id } : {}),
    payload: JSON.parse(row.payload) as unknown,
    createdAt: row.created_at
  };
}

function isCoalescableDelta(envelope: EventEnvelope): boolean {
  return envelope.type === "message.part.delta";
}

function deltaCoalesceKey(envelope: EventEnvelope): string {
  const payload = envelope.payload;
  if (isObject(payload) && typeof payload.messageId === "string") {
    return `${envelope.workspaceId}:${payload.messageId}`;
  }
  return `${envelope.workspaceId}:${envelope.roomId ?? ""}:${envelope.runId ?? ""}:${envelope.agentId ?? ""}`;
}

function mergeDeltaEnvelope(first: EventEnvelope, next: EventEnvelope): EventEnvelope {
  const firstPayload = isObject(first.payload) ? first.payload : {};
  const nextPayload = isObject(next.payload) ? next.payload : {};
  const delta = `${typeof firstPayload.delta === "string" ? firstPayload.delta : ""}${typeof nextPayload.delta === "string" ? nextPayload.delta : ""}`;
  return {
    ...next,
    id: first.id,
    createdAt: first.createdAt,
    payload: {
      ...firstPayload,
      ...nextPayload,
      delta
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actorIdentity(meta: CommandMeta): { type: string; id: string } {
  if (meta.actor.type === "system") {
    return { type: "system", id: "system" };
  }
  return { type: meta.actor.type, id: meta.actor.id };
}

function failedCommand(code: CommandErrorCode, message: string, details?: unknown): CommandResult {
  return details === undefined ? { ok: false, error: { code, message } } : { ok: false, error: { code, message, details } };
}

function duplicateResult(message: string): CommandResult {
  return failedCommand("duplicate", message);
}

function parseCachedResult(resultJson: string | null): CommandResult {
  if (resultJson === null) {
    return failedCommand("duplicate", "cached command record is missing result");
  }
  return JSON.parse(resultJson) as CommandResult;
}

export function shouldPersistFailedRecord(error: CommandErrorCode): boolean {
  return deterministicErrorCodes.has(error);
}

function hashCommand(command: Command): string {
  return createHash("sha256").update(stableStringify(command)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

function isAsyncFunction(fn: unknown): boolean {
  // Detect native async functions by constructor name; covers async () => {} and async function f() {}.
  return typeof fn === "function" && fn.constructor?.name === "AsyncFunction";
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

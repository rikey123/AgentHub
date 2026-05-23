import { randomUUID } from "node:crypto";

import type { Command, CommandBus, CommandErrorCode, CommandHandler, CommandMeta, CommandResult, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import type { PendingTurnService } from "@agenthub/orchestrator";

export type DaemonCommandHandlersOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly getCommandBus: () => CommandBus;
  readonly pendingTurns: PendingTurnService;
  readonly now?: () => number;
};

export function createDaemonCommandHandlers(options: DaemonCommandHandlersOptions): Partial<Record<Command["type"], CommandHandler>> {
  return {
    CreateRoom: (command, meta) => createRoom(options, command, meta),
    ArchiveRoom: (command) => setRoomArchived(options, command, true),
    UnarchiveRoom: (command) => setRoomArchived(options, command, false),
    SendMessage: (command, meta) => sendMessage(options, command, meta),
    CancelPendingTurn: (command) => cancelPendingTurn(options, command),
    DeleteMessage: (command) => deleteMessage(options, command),
    PinMessage: () => notImplemented("PinMessage is reserved for the context-ledger slice"),
    RegenerateMessage: () => notImplemented("RegenerateMessage is reserved for a later messaging slice"),
    EditMessage: (command, meta) => editMessage(options, command, meta),
    ReloadAgentProfile: () => notImplemented("Agent profile hot reload is not implemented in M1.4")
  };
}

function createRoom(options: DaemonCommandHandlersOptions, command: Command, meta: CommandMeta): CommandResult {
  const title = stringField(command, "title") ?? "New room";
  const mode = stringField(command, "mode") ?? "solo";
  if (mode === "squad" || mode === "team") return failed("not_implemented", `${mode} mode is V1.0`);
  if (mode !== "solo" && mode !== "assisted") return failed("validation_failed", `unknown room mode '${mode}'`);
  const workspaceId = stringField(command, "workspaceId") ?? "default-workspace";
  const primaryAgentId = stringField(command, "primaryAgentId") ?? "mock-builder";
  const participants = Array.isArray(command.participants) ? command.participants : [];
  if (mode === "solo" && participants.filter((item) => isObject(item) && item.type === "agent").length > 1) {
    return failed("validation_failed", "Solo rooms cannot contain multiple agents");
  }

  const roomId = randomUUID();
  const now = options.now?.() ?? Date.now();
  options.database.sqlite.transaction(() => {
    ensureWorkspace(options.database, workspaceId, now);
    options.database.sqlite
      .prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'conversation', ?, NULL, ?, ?)")
      .run(roomId, workspaceId, title, mode, primaryAgentId, now, now);
    options.database.sqlite
      .prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', 'mock', NULL, 'active', ?)")
      .run(roomId, primaryAgentId, now);
    options.database.sqlite
      .prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, 'active', NULL, NULL, ?)")
      .run(roomId, primaryAgentId, now);
    for (const participant of participants) {
      if (isObject(participant) && participant.type === "agent" && typeof participant.agentId === "string" && participant.agentId !== primaryAgentId) {
        options.database.sqlite
          .prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', ?, 'mock', NULL, ?, ?)")
          .run(roomId, participant.agentId, typeof participant.role === "string" ? participant.role : "observer", participant.defaultPresence === "active" ? "active" : "observing", now);
        options.database.sqlite
          .prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)")
          .run(roomId, participant.agentId, participant.defaultPresence === "active" ? "active" : "observing", now);
      }
    }
    options.eventBus.publish(roomEvent("room.created", workspaceId, roomId, { roomId, title, mode, primaryAgentId }, now));
  })();

  const emittedEvents = latestEvents(options.database, roomId);
  void meta;
  return { ok: true, data: { roomId }, emittedEvents };
}

function setRoomArchived(options: DaemonCommandHandlersOptions, command: Command, archived: boolean): CommandResult {
  const roomId = stringField(command, "roomId");
  if (!roomId) return failed("validation_failed", "roomId is required");
  const now = options.now?.() ?? Date.now();
  const room = getRoom(options.database, roomId);
  if (!room) return failed("not_found", `Room '${roomId}' not found`);
  options.database.sqlite.transaction(() => {
    options.database.sqlite.prepare("UPDATE rooms SET archived_at = ?, updated_at = ? WHERE id = ?").run(archived ? now : null, now, roomId);
    options.eventBus.publish(roomEvent(archived ? "room.closed" : "room.opened", room.workspace_id, roomId, { roomId }, now));
  })();
  return { ok: true, data: { roomId, archived }, emittedEvents: latestEvents(options.database, roomId) };
}

function sendMessage(options: DaemonCommandHandlersOptions, command: Command, meta: CommandMeta): CommandResult | Promise<CommandResult> {
  const roomId = stringField(command, "roomId");
  const text = stringField(command, "text");
  if (!roomId || !text) return failed("validation_failed", "roomId and text are required");
  const room = getRoom(options.database, roomId);
  if (!room) return failed("not_found", `Room '${roomId}' not found`);
  const now = options.now?.() ?? Date.now();
  const messageId = randomUUID();
  const busy = room.primary_agent_id !== null && primaryBusy(options.database, roomId, room.primary_agent_id);
  const pendingTurnId = busy ? messageId : undefined;

  if (busy && queuedPendingCount(options.database, roomId) >= 20) {
    return failed("rate_limited", "pending_turn_quota_exceeded", { limit: 20 });
  }

  options.database.sqlite.transaction(() => {
    options.database.sqlite
      .prepare(
        `INSERT INTO messages (
          id, workspace_id, room_id, sender_type, sender_id, run_id, role, status,
          quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, 'user', ?, NULL, 'user', 'completed', NULL, ?, ?, ?, ?, NULL)`
      )
      .run(messageId, room.workspace_id, roomId, actorId(meta), busy ? "pending" : "immediate", pendingTurnId ?? null, now, now);
    options.database.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(messageId, JSON.stringify({ text }), now);
    options.eventBus.publish(messageEvent("message.created", room.workspace_id, roomId, messageId, { text, senderId: actorId(meta), role: "user", turnDispatchMode: busy ? "pending" : "immediate", ...(pendingTurnId !== undefined ? { pendingTurnId } : {}) }, now));
    options.eventBus.publish(messageEvent("message.completed", room.workspace_id, roomId, messageId, { text }, now));
    if (pendingTurnId && room.primary_agent_id) {
      options.database.sqlite.prepare("INSERT INTO pending_turns (id, room_id, user_message_id, primary_agent_id, status, enqueued_at, scheduled_at, cancelled_at, notes) VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL)").run(pendingTurnId, roomId, messageId, room.primary_agent_id, now);
      options.eventBus.publish(pendingTurnEvent("pending_turn.created", room.workspace_id, roomId, room.primary_agent_id, pendingTurnId, messageId, "queued", now));
    }
  })();

  if (room.primary_agent_id && !busy) {
    const wake = options.getCommandBus().dispatch(
      {
        type: "WakeAgent",
        roomId,
        agentId: room.primary_agent_id,
        workspaceId: room.workspace_id,
        reason: "primary_turn",
        messageId,
        promptDelta: { kind: "delta_only", instructions: text },
        idempotencyKey: `message:${messageId}`
      },
      { actor: { type: "system" }, traceId: meta.traceId, idempotencyKey: `wake:${messageId}`, origin: "internal" }
    );
    if (isPromiseLike(wake)) {
      return wake.then((result) => (result.ok ? successMessage(options, roomId, messageId) : result));
    }
    if (!wake.ok) return wake;
  }

  return successMessage(options, roomId, messageId);
}

function cancelPendingTurn(options: DaemonCommandHandlersOptions, command: Command): CommandResult {
  const pendingTurnId = stringField(command, "pendingTurnId");
  if (!pendingTurnId) return failed("validation_failed", "pendingTurnId is required");
  return options.pendingTurns.cancel(pendingTurnId, typeof command.notes === "string" ? command.notes : undefined);
}

function editMessage(options: DaemonCommandHandlersOptions, command: Command, meta: CommandMeta): CommandResult | Promise<CommandResult> {
  const messageId = stringField(command, "messageId");
  const text = stringField(command, "text");
  if (!messageId || !text) return failed("validation_failed", "messageId and text are required");
  const row = options.database.sqlite.prepare("SELECT workspace_id, room_id, pending_turn_id FROM messages WHERE id = ? AND role = 'user'").get(messageId) as { readonly workspace_id: string; readonly room_id: string; readonly pending_turn_id: string | null } | undefined;
  if (!row) return failed("not_found", `Message '${messageId}' not found`);
  if (!row.pending_turn_id) return failed("conflict", "Only queued pending-turn messages can be edited");
  const cancel = options.pendingTurns.cancel(row.pending_turn_id, "edited");
  if (!cancel.ok) return cancel;
  const now = options.now?.() ?? Date.now();
  options.database.sqlite.transaction(() => {
    options.database.sqlite.prepare("UPDATE messages SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, messageId);
    options.eventBus.publish(messageEvent("message.updated", row.workspace_id, row.room_id, messageId, { text, replacement: true }, now));
  })();
  return sendMessage(options, { type: "SendMessage", roomId: row.room_id, text, idempotencyKey: `edit:${messageId}:${now}` }, meta);
}

function deleteMessage(options: DaemonCommandHandlersOptions, command: Command): CommandResult {
  const messageId = stringField(command, "messageId");
  if (!messageId) return failed("validation_failed", "messageId is required");
  const row = options.database.sqlite.prepare("SELECT workspace_id, room_id FROM messages WHERE id = ?").get(messageId) as { workspace_id: string; room_id: string } | undefined;
  if (!row) return failed("not_found", `Message '${messageId}' not found`);
  const now = options.now?.() ?? Date.now();
  options.database.sqlite.transaction(() => {
    options.database.sqlite.prepare("UPDATE messages SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, messageId);
    options.eventBus.publish(messageEvent("message.deleted", row.workspace_id, row.room_id, messageId, {}, now));
  })();
  return { ok: true, data: { messageId }, emittedEvents: latestEvents(options.database, row.room_id) };
}

export function seedDefaultData(database: AgentHubDatabase, now = Date.now()): void {
  database.sqlite.transaction(() => {
    ensureWorkspace(database, "default-workspace", now);
    const insert = database.sqlite.prepare(
      `INSERT OR IGNORE INTO agent_profiles (
        id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at
      ) VALUES (?, NULL, ?, 'mock', 'mock', ?, ?, NULL, 0, NULL, ?, ?)`
    );
    insert.run("mock-builder", "Mock Builder", "Deterministic builder for M1 golden path", JSON.stringify(["chat", "code.edit", "file.read", "file.write"]), now, now);
    insert.run("mock-observer", "Mock Observer", "Passive observer; never wakes without explicit WakeAgent", JSON.stringify(["chat", "context.read"]), now, now);
    insert.run("mock-reviewer", "Mock Reviewer", "Deterministic reviewer template", JSON.stringify(["chat", "code.review"]), now, now);
    insert.run("mock-specialist", "Mock Specialist", "Deterministic specialist template", JSON.stringify(["chat", "task.delegate"]), now, now);
  })();
}

function ensureWorkspace(database: AgentHubDatabase, workspaceId: string, now: number): void {
  database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, "Default Workspace", process.cwd(), now, now);
}

function getRoom(database: AgentHubDatabase, roomId: string): { readonly id: string; readonly workspace_id: string; readonly primary_agent_id: string | null } | undefined {
  return database.sqlite.prepare("SELECT id, workspace_id, primary_agent_id FROM rooms WHERE id = ? AND archived_at IS NULL").get(roomId) as { readonly id: string; readonly workspace_id: string; readonly primary_agent_id: string | null } | undefined;
}

function roomEvent(type: "room.created" | "room.opened" | "room.closed", workspaceId: string, roomId: string, payload: Record<string, unknown>, createdAt: number): PublishInput {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId, roomId, payload, createdAt };
}

function messageEvent(type: "message.created" | "message.completed" | "message.deleted" | "message.updated", workspaceId: string, roomId: string, messageId: string, payload: Record<string, unknown>, createdAt: number): PublishInput {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId, roomId, payload: { messageId, roomId, ...payload }, createdAt };
}

function pendingTurnEvent(type: "pending_turn.created", workspaceId: string, roomId: string, agentId: string, pendingTurnId: string, messageId: string, status: string, createdAt: number): PublishInput {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId, roomId, agentId, payload: { roomId, pendingTurnId, messageId, status }, createdAt };
}

function latestEvents(database: AgentHubDatabase, roomId: string): { readonly seq: number; readonly type: string }[] {
  return database.sqlite.prepare("SELECT seq, type FROM events WHERE room_id = ? ORDER BY seq ASC").all(roomId) as { readonly seq: number; readonly type: string }[];
}

function successMessage(options: DaemonCommandHandlersOptions, roomId: string, messageId: string): CommandResult {
  return { ok: true, data: { messageId }, emittedEvents: latestEvents(options.database, roomId) };
}

function actorId(meta: CommandMeta): string {
  return meta.actor.type === "system" ? "system" : meta.actor.id;
}

function stringField(command: Command, key: string): string | undefined {
  const value = command[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

function primaryBusy(database: AgentHubDatabase, roomId: string, agentId: string): boolean {
  return database.sqlite.prepare("SELECT id FROM runs WHERE room_id = ? AND agent_id = ? AND status IN ('queued', 'waiting', 'claimed', 'starting', 'running', 'waiting_permission', 'cancelling') LIMIT 1").get(roomId, agentId) !== undefined;
}

function queuedPendingCount(database: AgentHubDatabase, roomId: string): number {
  return (database.sqlite.prepare("SELECT COUNT(*) AS count FROM pending_turns WHERE room_id = ? AND status = 'queued'").get(roomId) as { readonly count: number }).count;
}

function failed(code: CommandErrorCode, message: string, details?: unknown): CommandResult {
  return { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

function notImplemented(message: string): CommandResult {
  return failed("not_implemented", message);
}

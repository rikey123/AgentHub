import { randomUUID } from "node:crypto";

import type { Command, CommandBus, CommandErrorCode, CommandHandler, CommandMeta, CommandResult, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import { parseMentions, type PendingTurnService } from "@agenthub/orchestrator";

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
    PinMessage: (command, meta) => pinMessage(options, command, meta),
    RegenerateMessage: (command, meta) => regenerateMessage(options, command, meta),
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
  const lookupAgent = (agentId: string): { adapterId: string; name: string } => {
    const row = options.database.sqlite
      .prepare("SELECT adapter_id, name FROM agent_profiles WHERE id = ?")
      .get(agentId) as { adapter_id?: string; name?: string } | undefined;
    return { adapterId: row?.adapter_id ?? "mock", name: row?.name ?? agentId };
  };
  options.database.sqlite.transaction(() => {
    ensureWorkspace(options.database, workspaceId, now);
    options.database.sqlite
      .prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'conversation', ?, NULL, ?, ?)")
      .run(roomId, workspaceId, title, mode, primaryAgentId, now, now);
    const primary = lookupAgent(primaryAgentId);
    options.database.sqlite
      .prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', ?, NULL, 'active', ?)")
      .run(roomId, primaryAgentId, primary.adapterId, now);
    options.database.sqlite
      .prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, 'active', NULL, NULL, ?)")
      .run(roomId, primaryAgentId, now);
    for (const participant of participants) {
      if (isObject(participant) && participant.type === "agent" && typeof participant.agentId === "string" && participant.agentId !== primaryAgentId) {
        const info = lookupAgent(participant.agentId);
        const role = typeof participant.role === "string" ? participant.role : "observer";
        const presence = participant.defaultPresence === "active" ? "active" : "observing";
        options.database.sqlite
          .prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', ?, ?, NULL, ?, ?)")
          .run(roomId, participant.agentId, role, info.adapterId, presence, now);
        options.database.sqlite
          .prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)")
          .run(roomId, participant.agentId, presence, now);
      }
    }
    options.eventBus.publish(roomEvent("room.created", workspaceId, roomId, { roomId, title, mode, primaryAgentId }, now));
    // Emit agent.joined + agent.state.changed for each participant so SSE consumers (and SSE
    // replay after a refresh) can rebuild the member roster without needing a separate API.
    // Without these events, refreshing the page lost all members until the daemon happened to
    // re-emit presence elsewhere.
    const publishParticipantEvents = (agentId: string, agentName: string, adapterId: string, role: string, presence: string): void => {
      options.eventBus.publish({ id: randomUUID(), type: "agent.joined", schemaVersion: 1, workspaceId, roomId, agentId, payload: { agentId, agentName, role, adapterId }, createdAt: now });
      options.eventBus.publish({ id: randomUUID(), type: "agent.state.changed", schemaVersion: 1, workspaceId, roomId, agentId, payload: { agentId, state: presence }, createdAt: now });
    };
    publishParticipantEvents(primaryAgentId, primary.name, primary.adapterId, "primary", "active");
    for (const participant of participants) {
      if (isObject(participant) && participant.type === "agent" && typeof participant.agentId === "string" && participant.agentId !== primaryAgentId) {
        const info = lookupAgent(participant.agentId);
        publishParticipantEvents(
          participant.agentId,
          info.name,
          info.adapterId,
          typeof participant.role === "string" ? participant.role : "observer",
          participant.defaultPresence === "active" ? "active" : "observing"
        );
      }
    }
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
  const members = roomMembers(options.database, roomId);
  const mentions = room.mode === "assisted" ? parseMentions(text, members) : [];
  const quotedMessageId = stringField(command, "quotedMessageId") ?? stringField(command, "quoted_message_id");
  const attachmentFileIds = stringArrayField(command, "attachmentFileIds", "attachments");
  const wakeTargets = wakeTargetsForMessage(room, mentions);
  const primaryTargeted = room.primary_agent_id !== null && wakeTargets.includes(room.primary_agent_id);
  const busy = primaryTargeted && room.primary_agent_id !== null && primaryBusy(options.database, roomId, room.primary_agent_id);
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
        ) VALUES (?, ?, ?, 'user', ?, NULL, 'user', 'completed', ?, ?, ?, ?, ?, NULL)`
      )
      .run(messageId, room.workspace_id, roomId, actorId(meta), quotedMessageId ?? null, busy ? "pending" : "immediate", pendingTurnId ?? null, now, now);
    options.database.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(messageId, JSON.stringify({ text, mentions }), now);
    if (attachmentFileIds.length > 0) {
      const placeholders = attachmentFileIds.map(() => "?").join(", ");
      options.database.sqlite.prepare(`UPDATE attachments SET message_id = ? WHERE file_id IN (${placeholders})`).run(messageId, ...attachmentFileIds);
    }
    options.eventBus.publish(messageEvent("message.created", room.workspace_id, roomId, messageId, { text, senderId: actorId(meta), role: "user", turnDispatchMode: busy ? "pending" : "immediate", mentions, attachmentFileIds, ...(quotedMessageId !== undefined ? { quotedMessageId } : {}), ...(pendingTurnId !== undefined ? { pendingTurnId } : {}) }, now));
    options.eventBus.publish(messageEvent("message.completed", room.workspace_id, roomId, messageId, { text }, now));
    if (pendingTurnId && room.primary_agent_id) {
      options.database.sqlite.prepare("INSERT INTO pending_turns (id, room_id, user_message_id, primary_agent_id, status, enqueued_at, scheduled_at, cancelled_at, notes) VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL)").run(pendingTurnId, roomId, messageId, room.primary_agent_id, now);
      options.eventBus.publish(pendingTurnEvent("pending_turn.created", room.workspace_id, roomId, room.primary_agent_id, pendingTurnId, messageId, "queued", now));
    }
  })();

  // Per-agent wake reason: the primary always gets `primary_turn` (it owns the conversation
  // turn even when @-mentioned alongside others); explicitly mentioned non-primary agents get
  // `user_mention`; an agent woken without mentions gets `primary_turn` by default.
  const wakeReasonFor = (agentId: string): "primary_turn" | "user_mention" => {
    if (agentId === room.primary_agent_id) return "primary_turn";
    return mentions.includes(agentId) ? "user_mention" : "primary_turn";
  };
  const wakeResult = wakeAgents(options, meta, room, roomId, messageId, text, wakeTargets.filter((agentId) => !(busy && agentId === room.primary_agent_id)), wakeReasonFor);
  if (isPromiseLike(wakeResult)) return wakeResult.then((result) => (result.ok ? successMessage(options, roomId, messageId) : result));
  if (!wakeResult.ok) return wakeResult;

  return successMessage(options, roomId, messageId);
}

function wakeAgents(options: DaemonCommandHandlersOptions, meta: CommandMeta, room: RoomRow, roomId: string, messageId: string, text: string, agentIds: readonly string[], reason: "primary_turn" | "user_mention" | ((agentId: string) => "primary_turn" | "user_mention")): CommandResult | Promise<CommandResult> {
  const reasonFor = typeof reason === "function" ? reason : () => reason;
  let chain: Promise<CommandResult> | undefined;
  for (const agentId of agentIds) {
    const dispatchWake = () => options.getCommandBus().dispatch(
      { type: "WakeAgent", roomId, agentId, workspaceId: room.workspace_id, reason: reasonFor(agentId), messageId, promptDelta: { kind: "delta_only", instructions: text }, idempotencyKey: `wake:${messageId}:${agentId}` },
      { actor: { type: "system" }, traceId: meta.traceId, idempotencyKey: `wake:${messageId}:${agentId}`, origin: "internal" }
    );
    if (chain) chain = chain.then((result) => result.ok ? Promise.resolve(dispatchWake()) : result);
    else {
      const result = dispatchWake();
      if (isPromiseLike(result)) chain = result;
      else if (!result.ok) return result;
    }
  }
  return chain ?? { ok: true, data: {}, emittedEvents: [] };
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

function regenerateMessage(options: DaemonCommandHandlersOptions, command: Command, meta: CommandMeta): CommandResult | Promise<CommandResult> {
  const messageId = stringField(command, "messageId");
  if (!messageId) return failed("validation_failed", "messageId is required");
  const row = options.database.sqlite.prepare("SELECT m.workspace_id, m.room_id, m.run_id, r.agent_id FROM messages m LEFT JOIN runs r ON r.id = m.run_id WHERE m.id = ? AND m.role = 'assistant'").get(messageId) as { readonly workspace_id: string; readonly room_id: string; readonly run_id: string | null; readonly agent_id: string | null } | undefined;
  if (!row) return failed("not_found", `Assistant message '${messageId}' not found`);
  if (row.run_id) options.getCommandBus().dispatch({ type: "CancelRun", runId: row.run_id, idempotencyKey: `cancel-regenerate:${messageId}` }, { actor: { type: "system" }, traceId: meta.traceId, origin: "internal" });
  const agentId = row.agent_id ?? getRoom(options.database, row.room_id)?.primary_agent_id;
  if (!agentId) return failed("validation_failed", "regenerate target agent not found");
  return options.getCommandBus().dispatch({ type: "WakeAgent", roomId: row.room_id, agentId, workspaceId: row.workspace_id, reason: "primary_turn", messageId, idempotencyKey: `wake:${messageId}:${agentId}` }, { actor: { type: "system" }, traceId: meta.traceId, idempotencyKey: `wake:${messageId}:${agentId}`, origin: "internal" });
}

function pinMessage(options: DaemonCommandHandlersOptions, command: Command, meta: CommandMeta): CommandResult | Promise<CommandResult> {
  const messageId = stringField(command, "messageId");
  if (!messageId) return failed("validation_failed", "messageId is required");
  const row = options.database.sqlite.prepare("SELECT workspace_id, room_id FROM messages WHERE id = ? AND deleted_at IS NULL").get(messageId) as { readonly workspace_id: string; readonly room_id: string } | undefined;
  if (!row) return failed("not_found", `Message '${messageId}' not found`);
  const text = messageText(options.database, messageId);
  const now = options.now?.() ?? Date.now();
  const contextId = randomUUID();
  const source = JSON.stringify({ type: "user", id: actorId(meta) });
  const visibility = JSON.stringify({});
  const item = { id: contextId, workspaceId: row.workspace_id, roomId: row.room_id, sourceMessageId: messageId, type: "fact", scope: "workspace", content: text, source: JSON.parse(source), visibility: {}, status: "confirmed", confidence: "verified", version: 1, createdBy: actorId(meta), pinned: true, createdAt: now, updatedAt: now };
  options.database.sqlite.transaction(() => {
    options.database.sqlite.prepare("INSERT INTO context_items (id, workspace_id, room_id, task_id, run_id, source_message_id, type, scope, content, source, visibility, status, confidence, version, owner_id, owner_type, created_by, pinned, created_at, updated_at, deprecated_at) VALUES (?, ?, ?, NULL, NULL, ?, 'fact', 'workspace', ?, ?, ?, 'confirmed', 'verified', 1, NULL, NULL, ?, 1, ?, ?, NULL)").run(contextId, row.workspace_id, row.room_id, messageId, text, source, visibility, actorId(meta), now, now);
    options.database.sqlite.prepare("INSERT INTO context_versions (context_id, version, payload, changed_by, changed_at) VALUES (?, 1, ?, ?, ?)").run(contextId, JSON.stringify(item), actorId(meta), now);
    // Mark the message row itself so consumers (frontend list view, message kebab state) can show
    // a pin glyph without a separate join. The context-item is still the source of truth for the
    // pinned-fact semantics; this is a denormalized flag for fast rendering.
    options.database.sqlite.prepare("UPDATE messages SET pinned_at = ?, updated_at = ? WHERE id = ?").run(now, now, messageId);
    options.eventBus.publish({ id: randomUUID(), type: "context.item.created", schemaVersion: 1, workspaceId: row.workspace_id, roomId: row.room_id, payload: { contextId, status: "confirmed", source: item.source }, createdAt: now });
    options.eventBus.publish({ id: randomUUID(), type: "context.item.confirmed", schemaVersion: 1, workspaceId: row.workspace_id, roomId: row.room_id, payload: { contextId, byUserId: null, source: "user", downgraded: false }, createdAt: now });
    options.eventBus.publish({ id: randomUUID(), type: "context.item.visibility.changed", schemaVersion: 1, workspaceId: row.workspace_id, roomId: row.room_id, payload: { contextId, scope: "workspace", pinned: true, visibility: {} }, createdAt: now });
    // Echo the pin onto the originating message so SSE consumers can update the kebab state.
    options.eventBus.publish({ id: randomUUID(), type: "message.updated", schemaVersion: 1, workspaceId: row.workspace_id, roomId: row.room_id, payload: { messageId, pinnedAt: now, contextId }, createdAt: now });
  })();
  return { ok: true, data: item, emittedEvents: latestContextEvents(options.database, contextId) };
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

type RoomRow = { readonly id: string; readonly workspace_id: string; readonly primary_agent_id: string | null; readonly mode: string };

function getRoom(database: AgentHubDatabase, roomId: string): RoomRow | undefined {
  return database.sqlite.prepare("SELECT id, workspace_id, primary_agent_id, mode FROM rooms WHERE id = ? AND archived_at IS NULL").get(roomId) as RoomRow | undefined;
}

function roomMembers(database: AgentHubDatabase, roomId: string): { readonly agentId: string }[] {
  return (database.sqlite.prepare("SELECT participant_id FROM room_participants WHERE room_id = ? AND participant_type = 'agent' ORDER BY joined_at ASC").all(roomId) as { readonly participant_id: string }[]).map((row) => ({ agentId: row.participant_id }));
}

function wakeTargetsForMessage(room: RoomRow, mentions: readonly string[]): string[] {
  if (room.mode !== "assisted") return room.primary_agent_id ? [room.primary_agent_id] : [];
  if (mentions.length === 0) return room.primary_agent_id ? [room.primary_agent_id] : [];
  return [...mentions];
}

function messageText(database: AgentHubDatabase, messageId: string): string {
  const rows = database.sqlite.prepare("SELECT payload FROM message_parts WHERE message_id = ? ORDER BY seq ASC").all(messageId) as { readonly payload: string }[];
  return rows.map((row) => {
    try { const parsed = JSON.parse(row.payload) as { readonly text?: unknown }; return typeof parsed.text === "string" ? parsed.text : ""; } catch { return ""; }
  }).filter((text) => text.length > 0).join("\n");
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

function latestContextEvents(database: AgentHubDatabase, contextId: string): { readonly seq: number; readonly type: string }[] {
  return database.sqlite.prepare("SELECT seq, type FROM events WHERE type LIKE 'context.%' AND payload LIKE ? ORDER BY seq ASC").all(`%${contextId}%`) as { readonly seq: number; readonly type: string }[];
}

function actorId(meta: CommandMeta): string {
  return meta.actor.type === "system" ? "system" : meta.actor.id;
}

function stringField(command: Command, key: string): string | undefined {
  const value = command[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayField(command: Command, ...keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = command[key];
    if (!Array.isArray(value)) continue;
    return value
      .map((item) => typeof item === "string" ? item : isObject(item) && typeof item.fileId === "string" ? item.fileId : undefined)
      .filter((item): item is string => item !== undefined && item.length > 0);
  }
  return [];
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

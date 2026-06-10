import { randomUUID } from "node:crypto";

import type { Command, CommandBus, CommandErrorCode, CommandHandler, CommandMeta, CommandResult, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";
import { parseMentions, nameToSlug, type AssistedSelectorInput, type AssistedSelectorParticipant, type AssistedSelectorResult, type PendingTurnService } from "@agenthub/orchestrator";
import { defaultAgentAvatarUrl, isAvatarImageUrl } from "@agenthub/protocol/avatars";
import type { MessageContextRef } from "@agenthub/protocol/domains";
import { normalizePreviewKind, type PreviewKind } from "@agenthub/protocol/preview";

export type AssistedSelectorRouter = {
  readonly startTurn: (input: AssistedSelectorInput) => Promise<AssistedSelectorResult>;
  readonly forgetRoomTurns?: (roomId: string) => void;
};

export type DaemonCommandHandlersOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly getCommandBus: () => CommandBus;
  readonly pendingTurns: PendingTurnService;
  readonly workspaceRoot?: string;
  readonly assistedSelector?: AssistedSelectorRouter;
  readonly prewarmRoomAgents?: (roomId: string) => void | Promise<void>;
  readonly disposeRoomAgents?: (roomId: string) => void;
  readonly now?: () => number;
};

export function createDaemonCommandHandlers(options: DaemonCommandHandlersOptions): Partial<Record<Command["type"], CommandHandler>> {
  return {
    CreateRoom: (command, meta) => createRoom(options, command, meta),
    AddParticipant: (command, meta) => addParticipant(options, command, meta),
    ArchiveRoom: (command) => setRoomArchived(options, command, true),
    UnarchiveRoom: (command) => setRoomArchived(options, command, false),
    DeleteRoom: (command) => deleteRoom(options, command),
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
  if (mode !== "solo" && mode !== "assisted" && mode !== "team" && mode !== "squad") {
    return failed("validation_failed", `unknown room mode '${mode}' (supported: solo, assisted, team, squad)`);
  }
  const workspaceId = stringField(command, "workspaceId") ?? "default-workspace";
  const explicitPrimaryAgentId = stringField(command, "primaryAgentId");
  const explicitAgentBindingId = stringField(command, "agentBindingId");
  let primaryAgentId = explicitPrimaryAgentId ?? explicitAgentBindingId ?? "mock-builder";
  const leaderRoleId = stringField(command, "leaderRoleId");
  const legacyAgentProfileId = stringField(command, "agentProfileId");
  const participants = Array.isArray(command.participants) ? command.participants : [];
  const skillIds = [...new Set(stringArrayField(command, "skillIds"))];
  const participantSkillAssignments = participantSkillAssignmentField(command);
  const allSkillIds = [...new Set([...skillIds, ...participantSkillAssignments.flatMap((assignment) => assignment.skillIds)])];
  const isTeamMode = mode === "team" || mode === "squad";
  if (isTeamMode && leaderRoleId === undefined) {
    return failed("validation_failed", "squad_mode_requires_leader_role_id");
  }
  if (mode === "solo" && participants.filter((item) => isObject(item) && (item.type === "agent" || (typeof item.roleId === "string" && typeof item.runtimeId === "string"))).length > 1) {
    return failed("validation_failed", "Solo rooms cannot contain multiple agents");
  }
  if (allSkillIds.length > 0) {
    const placeholders = allSkillIds.map(() => "?").join(", ");
    const rows = options.database.sqlite.prepare(`SELECT id FROM skills WHERE workspace_id = ? AND id IN (${placeholders})`).all(workspaceId, ...allSkillIds) as { readonly id: string }[];
    const found = new Set(rows.map((row) => row.id));
    const missing = allSkillIds.find((skillId) => !found.has(skillId));
    if (missing !== undefined) return failed("not_found", `skill_not_found:${missing}`);
  }

  const roomId = randomUUID();
  const now = options.now?.() ?? Date.now();
  const lookupAgent = (agentId: string): { adapterId: string; name: string; avatarUrl: string } => {
    const binding = options.database.sqlite
      .prepare(
        `SELECT
          COALESCE(agent_bindings.contact_name, roles.name, runtimes.name, agent_bindings.id) AS name,
          agent_bindings.id AS binding_id,
          agent_bindings.avatar_url AS avatar_url,
          roles.avatar AS role_avatar,
          runtimes.kind AS runtime_kind
         FROM agent_bindings
         LEFT JOIN roles ON roles.id = agent_bindings.role_id
         LEFT JOIN runtimes ON runtimes.id = agent_bindings.runtime_id
         WHERE agent_bindings.id = ?
         LIMIT 1`
      )
      .get(agentId) as { readonly binding_id?: string | null; readonly avatar_url?: string | null; readonly role_avatar?: string | null; readonly runtime_kind?: string | null; readonly name?: string | null } | undefined;
    if (binding !== undefined) return { adapterId: binding.runtime_kind ?? "mock", name: binding.name ?? agentId, avatarUrl: effectiveAvatarUrl(binding.avatar_url, binding.role_avatar, binding.binding_id ?? agentId) };
    const row = options.database.sqlite
      .prepare("SELECT adapter_id, name, avatar FROM agent_profiles WHERE id = ?")
      .get(agentId) as { adapter_id?: string; name?: string; avatar?: string | null } | undefined;
    return { adapterId: row?.adapter_id ?? "mock", name: row?.name ?? agentId, avatarUrl: effectiveAvatarUrl(row?.avatar ?? null, null, agentId) };
  };
  const bindingStatus = (agentBindingId: string): "active" | "disabled" | "missing" => {
    const row = options.database.sqlite
      .prepare("SELECT disabled_at FROM agent_bindings WHERE id = ?")
      .get(agentBindingId) as { readonly disabled_at: number | null } | undefined;
    if (row === undefined) return "missing";
    return row.disabled_at === null ? "active" : "disabled";
  };
  const rejectIfDisabledBinding = (agentBindingId: string): CommandResult | undefined => {
    const status = bindingStatus(agentBindingId);
    return status === "disabled" ? failed("validation_failed", "agent_binding_disabled") : undefined;
  };

  const lookupBinding = (roleId: string, runtimeId: string, modelConfigId: string | null | undefined): { readonly bindingId: string; readonly adapterId: string; readonly name: string; readonly avatarUrl: string } | undefined => {
    const row = options.database.sqlite
      .prepare(
        `SELECT
          agent_bindings.id AS binding_id,
          agent_bindings.avatar_url AS avatar_url,
          agent_bindings.role_id,
          agent_bindings.runtime_id,
          agent_bindings.model_config_id,
          roles.name AS role_name,
          roles.avatar AS role_avatar,
          runtimes.kind AS runtime_kind,
          runtimes.name AS runtime_name
         FROM agent_bindings
         LEFT JOIN roles ON roles.id = agent_bindings.role_id
         LEFT JOIN runtimes ON runtimes.id = agent_bindings.runtime_id
         WHERE agent_bindings.role_id = ? AND agent_bindings.runtime_id = ? AND ${modelConfigId === undefined ? "agent_bindings.model_config_id IS NULL" : "agent_bindings.model_config_id = ?"}
           AND agent_bindings.disabled_at IS NULL
         LIMIT 1`
      )
      .get(...(modelConfigId === undefined ? [roleId, runtimeId] : [roleId, runtimeId, modelConfigId])) as
      | { readonly binding_id?: string; readonly avatar_url?: string | null; readonly role_avatar?: string | null; readonly role_name?: string | null; readonly runtime_kind?: string | null; readonly runtime_name?: string | null }
      | undefined;
    if (row?.binding_id === undefined) return undefined;
    return { bindingId: row.binding_id, adapterId: row.runtime_kind ?? "mock", name: row.role_name ?? row.runtime_name ?? row.binding_id, avatarUrl: effectiveAvatarUrl(row.avatar_url ?? null, row.role_avatar ?? null, row.binding_id) };
  };

  type RoomParticipantRecord = {
    readonly participantId: string;
    readonly agentBindingId: string;
    readonly adapterId: string;
    readonly name: string;
    readonly avatarUrl: string;
    readonly role: string;
    readonly presence: string;
  };

  const resolvedParticipants: RoomParticipantRecord[] = [];
  let primaryParticipant: RoomParticipantRecord | undefined;

  const primaryBindingError = (explicitPrimaryAgentId !== undefined ? rejectIfDisabledBinding(explicitPrimaryAgentId) : undefined)
    ?? (explicitAgentBindingId !== undefined ? rejectIfDisabledBinding(explicitAgentBindingId) : undefined);
  if (primaryBindingError !== undefined) return primaryBindingError;

  // In team/squad mode the primary agent is the leader; all other participants are teammates.
  // In assisted mode participants keep whatever role is specified (default: observer).
  for (const participant of participants) {
    if (!isObject(participant)) continue;
    if (participant.type === "agent" && typeof participant.agentId === "string") {
      const participantBindingId = typeof participant.agentBindingId === "string" ? participant.agentBindingId : participant.agentId;
      const participantBindingError = rejectIfDisabledBinding(participantBindingId);
      if (participantBindingError !== undefined) return participantBindingError;
      const info = lookupAgent(participant.agentId);
      const role = participantRole(participant, isTeamMode);
      const presence = participantPresence(participant, isTeamMode, role);
      const record: RoomParticipantRecord = { participantId: participant.agentId, agentBindingId: participantBindingId, adapterId: info.adapterId, name: info.name, avatarUrl: info.avatarUrl, role, presence };
      resolvedParticipants.push(record);
      if (participant.agentId === primaryAgentId || participantBindingId === primaryAgentId || role === "primary") {
        primaryParticipant = record;
      }
      continue;
    }
    if (typeof participant.roleId === "string" && typeof participant.runtimeId === "string") {
      const modelConfigId = stringField(participant as Record<string, unknown>, "modelConfigId");
      const binding = lookupBinding(participant.roleId, participant.runtimeId, modelConfigId);
      if (binding === undefined) {
        const disabled = options.database.sqlite
          .prepare(`SELECT 1 FROM agent_bindings WHERE role_id = ? AND runtime_id = ? AND ${modelConfigId === undefined ? "model_config_id IS NULL" : "model_config_id = ?"} AND disabled_at IS NOT NULL LIMIT 1`)
          .get(...(modelConfigId === undefined ? [participant.roleId, participant.runtimeId] : [participant.roleId, participant.runtimeId, modelConfigId]));
        return disabled !== undefined ? failed("validation_failed", "agent_binding_disabled") : failed("not_found", "agent_binding_not_found");
      }
      const role = participantRole(participant, isTeamMode);
      const presence = participantPresence(participant, isTeamMode, role);
      const record: RoomParticipantRecord = { participantId: binding.bindingId, agentBindingId: binding.bindingId, adapterId: binding.adapterId, name: binding.name, avatarUrl: binding.avatarUrl, role, presence };
      resolvedParticipants.push(record);
      if (
        (isTeamMode && leaderRoleId !== undefined && participant.roleId === leaderRoleId)
        || (!isTeamMode && (role === "primary" || binding.bindingId === primaryAgentId))
      ) {
        primaryParticipant = record;
      }
    }
  }

  if (primaryParticipant === undefined && isTeamMode && explicitPrimaryAgentId === undefined && explicitAgentBindingId === undefined && resolvedParticipants.length > 0) {
    primaryParticipant = resolvedParticipants[0];
  }
  if (primaryParticipant !== undefined) {
    primaryAgentId = primaryParticipant.participantId;
  }
  if (primaryParticipant === undefined) {
    const selectedPrimaryBindingError = rejectIfDisabledBinding(explicitAgentBindingId ?? primaryAgentId);
    if (selectedPrimaryBindingError !== undefined) return selectedPrimaryBindingError;
  }
  const primary = primaryParticipant ?? (() => {
    const info = lookupAgent(primaryAgentId);
    return { participantId: primaryAgentId, agentBindingId: explicitAgentBindingId ?? primaryAgentId, adapterId: info.adapterId, name: info.name, avatarUrl: info.avatarUrl, role: "primary", presence: "active" } satisfies RoomParticipantRecord;
  })();
  const roomParticipantIds = new Set([primary.participantId, ...resolvedParticipants.map((participant) => participant.participantId)]);
  const missingParticipantAssignment = participantSkillAssignments.find((assignment) => !roomParticipantIds.has(assignment.participantId));
  if (missingParticipantAssignment !== undefined) return failed("not_found", `participant_not_found:${missingParticipantAssignment.participantId}`);
  const leaderPayload = leaderRoleId !== undefined ? { leaderRoleId } : {};

  options.database.sqlite.transaction(() => {
    ensureWorkspace(options.database, workspaceId, now, options.workspaceRoot);
    options.database.sqlite
      .prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, leader_role_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'conversation', ?, ?, NULL, ?, ?)")
      .run(roomId, workspaceId, title, mode, primaryAgentId, leaderRoleId ?? null, now, now);
    options.database.sqlite
      .prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', ?, NULL, ?, ?, ?)")
      .run(roomId, primary.participantId, primary.adapterId, primary.agentBindingId, primary.presence, now);
    options.database.sqlite
      .prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)")
      .run(roomId, primary.participantId, primary.presence, now);
    for (const participant of resolvedParticipants) {
      if (participant.participantId !== primary.participantId) {
        options.database.sqlite
          .prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, 'agent', ?, ?, NULL, ?, ?, ?)")
          .run(roomId, participant.participantId, participant.role, participant.adapterId, participant.agentBindingId, participant.presence, now);
        options.database.sqlite
          .prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)")
          .run(roomId, participant.participantId, participant.presence, now);
      }
    }
    options.eventBus.publish(roomEvent("room.created", workspaceId, roomId, { roomId, title, mode, primaryAgentId, ...leaderPayload }, now));
    for (const skillId of skillIds) {
      options.database.sqlite.prepare("INSERT INTO room_skills (room_id, skill_id, enabled) VALUES (?, ?, 1) ON CONFLICT(room_id, skill_id) DO UPDATE SET enabled = 1").run(roomId, skillId);
      options.eventBus.publish({ id: randomUUID(), type: "skill.activated", schemaVersion: 1, workspaceId, roomId, payload: { skillId, roomId }, createdAt: now });
    }
    for (const assignment of participantSkillAssignments) {
      for (const skillId of assignment.skillIds) {
        options.database.sqlite
          .prepare("INSERT INTO agent_skills (room_participant_id, skill_id, mode) VALUES (?, ?, ?) ON CONFLICT(room_participant_id, skill_id) DO UPDATE SET mode = excluded.mode")
          .run(`${roomId}:${assignment.participantId}`, skillId, assignment.mode);
        options.eventBus.publish({ id: randomUUID(), type: "skill.activated", schemaVersion: 1, workspaceId, roomId, payload: { skillId, participantId: assignment.participantId }, createdAt: now });
      }
    }
    // Emit agent.joined + agent.state.changed for each participant so SSE consumers (and SSE
    // replay after a refresh) can rebuild the member roster without needing a separate API.
    // Without these events, refreshing the page lost all members until the daemon happened to
    // re-emit presence elsewhere.
    const publishParticipantEvents = (participant: RoomParticipantRecord, role: string): void => {
      const agentId = participant.participantId;
      options.eventBus.publish({ id: randomUUID(), type: "agent.joined", schemaVersion: 1, workspaceId, roomId, agentId, payload: { agentId, agentName: participant.name, role, adapterId: participant.adapterId, agentBindingId: participant.agentBindingId, avatarUrl: participant.avatarUrl }, createdAt: now });
      options.eventBus.publish({ id: randomUUID(), type: "agent.state.changed", schemaVersion: 1, workspaceId, roomId, agentId, payload: { agentId, state: participant.presence }, createdAt: now });
    };
    publishParticipantEvents(primary, "primary");
    for (const participant of resolvedParticipants) {
      if (participant.participantId !== primary.participantId) {
        publishParticipantEvents(participant, participant.role);
      }
    }
  })();

  const emittedEvents = latestEvents(options.database, roomId);
  void Promise.resolve().then(() => options.prewarmRoomAgents?.(roomId)).catch(() => undefined);
  void meta;
  return { ok: true, data: { roomId, agentBindingId: primaryAgentId, ...(leaderRoleId !== undefined ? { leaderRoleId } : {}), ...(legacyAgentProfileId !== undefined ? { agentProfileId: legacyAgentProfileId } : {}) }, emittedEvents };
}

function addParticipant(options: DaemonCommandHandlersOptions, command: Command, meta: CommandMeta): CommandResult {
  const roomId = stringField(command, "roomId");
  const agentBindingId = stringField(command, "agentBindingId");
  const displayNameOverride = stringField(command, "displayNameOverride");
  if (roomId === undefined || agentBindingId === undefined) return failed("validation_failed", "roomId and agentBindingId are required");

  const room = options.database.sqlite
    .prepare("SELECT id, workspace_id, mode, primary_agent_id FROM rooms WHERE id = ? AND archived_at IS NULL")
    .get(roomId) as { readonly id: string; readonly workspace_id: string; readonly mode: string; readonly primary_agent_id: string | null } | undefined;
  if (room === undefined) return failed("not_found", `Room '${roomId}' not found`);
  if (room.mode === "war_room") return failed("not_implemented", "war_room mode is V1.5");

  const binding = options.database.sqlite
    .prepare(
      `SELECT
        agent_bindings.id AS binding_id,
        agent_bindings.workspace_id AS workspace_id,
        roles.id AS role_id,
        roles.name AS role_name,
        roles.avatar AS role_avatar,
        roles.capabilities AS role_capabilities,
        agent_bindings.avatar_url AS avatar_url,
        runtimes.kind AS runtime_kind,
        agent_bindings.disabled_at AS disabled_at
       FROM agent_bindings
       LEFT JOIN roles ON roles.id = agent_bindings.role_id
       LEFT JOIN runtimes ON runtimes.id = agent_bindings.runtime_id
       WHERE agent_bindings.id = ?
       LIMIT 1`
    )
    .get(agentBindingId) as
    | { readonly binding_id: string; readonly workspace_id: string; readonly role_id: string | null; readonly role_name: string | null; readonly role_avatar: string | null; readonly role_capabilities: string | null; readonly avatar_url: string | null; readonly runtime_kind: string | null; readonly disabled_at: number | null }
    | undefined;
  if (binding === undefined) return failed("not_found", "agent_binding_not_found");
  if (binding.disabled_at !== null) return failed("validation_failed", "agent_binding_disabled");
  if (binding.workspace_id !== room.workspace_id) return failed("validation_failed", "agent_binding_workspace_mismatch");

  const duplicate = options.database.sqlite
    .prepare("SELECT 1 FROM room_participants WHERE room_id = ? AND (participant_id = ? OR agent_binding_id = ?) LIMIT 1")
    .get(roomId, agentBindingId, agentBindingId);
  if (duplicate !== undefined) return failed("conflict", "participant_already_in_room");

  const now = options.now?.() ?? Date.now();
  const role = room.mode === "team" || room.mode === "squad" ? "teammate" : "observer";
  const presence = room.mode === "team" || room.mode === "squad" ? "active" : "observing";
  const adapterId = binding.runtime_kind ?? "mock";
  const name = displayNameOverride ?? binding.role_name ?? binding.binding_id;
  const avatarUrl = effectiveAvatarUrl(binding.avatar_url, binding.role_avatar, binding.binding_id);
  const capabilities = parseCapabilities(binding.role_capabilities);
  const mailboxMessageId = randomUUID();

  options.database.sqlite.transaction(() => {
    options.database.sqlite.prepare("UPDATE rooms SET last_activity_at = ?, updated_at = ? WHERE id = ?").run(now, now, roomId);
    options.database.sqlite
      .prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, 'agent', ?, ?, NULL, ?, ?, ?)")
      .run(roomId, agentBindingId, role, adapterId, agentBindingId, presence, now);
    options.database.sqlite
      .prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)")
      .run(roomId, agentBindingId, presence, now);
    options.eventBus.publish({ id: randomUUID(), type: "agent.joined", schemaVersion: 1, workspaceId: room.workspace_id, roomId, agentId: agentBindingId, payload: { agentId: agentBindingId, agentName: name, role, adapterId, agentBindingId, roleId: binding.role_id, avatarUrl, capabilities }, createdAt: now });
    options.eventBus.publish({ id: randomUUID(), type: "agent.state.changed", schemaVersion: 1, workspaceId: room.workspace_id, roomId, agentId: agentBindingId, payload: { agentId: agentBindingId, state: presence }, createdAt: now });

    if (room.primary_agent_id !== null) {
      options.database.sqlite
        .prepare("INSERT INTO mailbox_messages (id, workspace_id, room_id, from_type, from_id, to_agent_id, kind, content, files, read, claimed_run_id, claimed_at, delivery_batch_id, delivery_failure_reason, attempt_count, created_at, consumed_at) VALUES (?, ?, ?, 'system', 'room.add_participant', ?, 'message', ?, '[]', 0, NULL, NULL, NULL, NULL, 0, ?, NULL)")
        .run(mailboxMessageId, room.workspace_id, roomId, room.primary_agent_id, JSON.stringify({ text: `${name} joined this room as ${role}.`, agentBindingId, participantId: agentBindingId }), now);
      options.eventBus.publish({ id: randomUUID(), type: "mailbox.message.created", schemaVersion: 1, workspaceId: room.workspace_id, roomId, agentId: room.primary_agent_id, payload: { mailboxMessageId, roomId, fromAgentId: "room.add_participant", targetAgentId: room.primary_agent_id, reason: "participant_added", participantId: agentBindingId, agentBindingId }, createdAt: now });
    }
  })();

  void meta;
  return {
    ok: true,
    data: { participantId: agentBindingId, agentBindingId, agentId: agentBindingId, name, avatarUrl, role, capabilities },
    emittedEvents: latestEvents(options.database, roomId)
  };
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
  if (archived) options.disposeRoomAgents?.(roomId);
  return { ok: true, data: { roomId, archived }, emittedEvents: latestEvents(options.database, roomId) };
}

function deleteRoom(options: DaemonCommandHandlersOptions, command: Command): CommandResult {
  const roomId = stringField(command, "roomId");
  if (!roomId) return failed("validation_failed", "roomId is required");
  const now = options.now?.() ?? Date.now();
  const room = options.database.sqlite
    .prepare("SELECT id, workspace_id FROM rooms WHERE id = ? AND deleted_at IS NULL")
    .get(roomId) as { readonly id: string; readonly workspace_id: string } | undefined;
  if (!room) return failed("not_found", `Room '${roomId}' not found`);
  options.database.sqlite.transaction(() => {
    options.database.sqlite.prepare("UPDATE rooms SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, roomId);
    options.eventBus.publish(roomEvent("room.deleted", room.workspace_id, roomId, { roomId }, now));
  })();
  options.disposeRoomAgents?.(roomId);
  return { ok: true, data: { roomId, deleted: true }, emittedEvents: latestEvents(options.database, roomId) };
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
  // Parse @mentions in assisted mode; in team/squad mode the leader handles routing via MCP
  const mentions = (room.mode === "assisted") ? resolveMessageMentions(command, text, members) : [];
  const mentionPayloads = mentions.map((agentBindingId) => ({ agentBindingId }));
  const contextRefs = contextRefsFromCommand(command);
  const quotedMessageId = stringField(command, "quotedMessageId") ?? stringField(command, "quoted_message_id");
  const attachmentFileIds = Array.from(new Set(stringArrayField(command, "attachmentFileIds", "attachmentIds", "attachments")));
  const attachmentRows = attachmentRowsForFileIds(options.database, attachmentFileIds);
  if (attachmentRows.length !== attachmentFileIds.length) {
    const found = new Set(attachmentRows.map((row) => row.fileId));
    return failed("validation_failed", "attachment_not_found", { missingFileIds: attachmentFileIds.filter((fileId) => !found.has(fileId)) });
  }
  const attachmentParts = attachmentFileIds.map((fileId, index) => {
    const row = attachmentRows.find((item) => item.fileId === fileId);
    if (row === undefined) throw new Error(`missing attachment row ${fileId}`);
    return {
      type: "attachment" as const,
      seq: index + 2,
      fileId: row.fileId,
      name: row.fileName,
      mimeType: row.mimeType ?? "",
      sizeBytes: row.byteSize,
      previewKind: previewKindForAttachment(row.fileName, row.mimeType ?? "")
    };
  });
  const useAssistedSelector = room.mode === "assisted" && options.assistedSelector !== undefined;
  const wakeTargets = useAssistedSelector ? [] : wakeTargetsForMessage(room, mentions);
  const primaryTargeted = room.primary_agent_id !== null && wakeTargets.includes(room.primary_agent_id);
  const busy = primaryTargeted && room.primary_agent_id !== null && primaryBusy(options.database, roomId, room.primary_agent_id);
  const pendingTurnId = busy ? messageId : undefined;

  if (busy && queuedPendingCount(options.database, roomId) >= 20) {
    return failed("rate_limited", "pending_turn_quota_exceeded", { limit: 20 });
  }

  options.database.sqlite.transaction(() => {
    options.database.sqlite.prepare("UPDATE rooms SET last_activity_at = ?, updated_at = ? WHERE id = ?").run(now, now, roomId);
    options.database.sqlite
      .prepare(
        `INSERT INTO messages (
          id, workspace_id, room_id, sender_type, sender_id, run_id, role, status,
          quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, 'user', ?, NULL, 'user', 'completed', ?, ?, ?, ?, ?, NULL)`
      )
      .run(messageId, room.workspace_id, roomId, actorId(meta), quotedMessageId ?? null, busy ? "pending" : "immediate", pendingTurnId ?? null, now, now);
    const textPayload = { text, mentions: mentionPayloads, ...(contextRefs.length > 0 ? { refs: contextRefs } : {}) };
    options.database.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(messageId, JSON.stringify(textPayload), now);
    for (const part of attachmentParts) {
      const { type: _type, seq: _seq, ...payload } = part;
      options.database.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, ?, 'attachment', ?, ?)").run(messageId, part.seq, JSON.stringify(payload), now);
    }
    if (attachmentFileIds.length > 0) {
      const placeholders = attachmentFileIds.map(() => "?").join(", ");
      options.database.sqlite.prepare(`UPDATE attachments SET message_id = ? WHERE file_id IN (${placeholders})`).run(messageId, ...attachmentFileIds);
    }
    const parts = [{ type: "text" as const, seq: 1, ...textPayload }, ...attachmentParts];
    options.eventBus.publish(messageEvent("message.created", room.workspace_id, roomId, messageId, { text, senderId: actorId(meta), role: "user", turnDispatchMode: busy ? "pending" : "immediate", mentions: mentionPayloads, attachmentFileIds, attachmentIds: attachmentFileIds, parts, ...(contextRefs.length > 0 ? { refs: contextRefs } : {}), ...(quotedMessageId !== undefined ? { quotedMessageId } : {}), ...(pendingTurnId !== undefined ? { pendingTurnId } : {}) }, now));
    options.eventBus.publish(messageEvent("message.completed", room.workspace_id, roomId, messageId, { text, mentions: mentionPayloads, attachmentFileIds, attachmentIds: attachmentFileIds, parts, ...(contextRefs.length > 0 ? { refs: contextRefs } : {}) }, now));
    if (pendingTurnId && room.primary_agent_id) {
      options.database.sqlite.prepare("INSERT INTO pending_turns (id, room_id, user_message_id, primary_agent_id, status, enqueued_at, scheduled_at, cancelled_at, notes) VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL)").run(pendingTurnId, roomId, messageId, room.primary_agent_id, now);
      options.eventBus.publish(pendingTurnEvent("pending_turn.created", room.workspace_id, roomId, room.primary_agent_id, pendingTurnId, messageId, "queued", now));
    }
  })();

  if (useAssistedSelector) {
    void routeAssistedSelectorTurn(options, meta, room, roomId, messageId, text, mentions).catch(() => undefined);
    return successMessage(options, roomId, messageId);
  }

  // Per-agent wake reason: the primary always gets `primary_turn` (it owns the conversation
  // turn even when @-mentioned alongside others); explicitly mentioned non-primary agents get
  // `user_mention`; an agent woken without mentions gets `primary_turn` by default.
  const hasExistingPlan = room.mode === "team" || room.mode === "squad"
    ? options.database.sqlite.prepare("SELECT 1 FROM task_plans WHERE room_id = ? LIMIT 1").get(roomId) !== undefined
    : true;
  const wakeReasonFor = (agentId: string): "primary_turn" | "user_mention" | "plan" => {
    if (agentId === room.primary_agent_id) {
      if ((room.mode === "team" || room.mode === "squad") && !hasExistingPlan) return "plan";
      return "primary_turn";
    }
    return mentions.includes(agentId) ? "user_mention" : "primary_turn";
  };
  const wakeResult = wakeAgents(options, meta, room, roomId, messageId, text, wakeTargets.filter((agentId) => !(busy && agentId === room.primary_agent_id)), wakeReasonFor);
  if (isPromiseLike(wakeResult)) return wakeResult.then((result) => (result.ok ? successMessage(options, roomId, messageId) : result));
  if (!wakeResult.ok) return wakeResult;

  return successMessage(options, roomId, messageId);
}

async function routeAssistedSelectorTurn(options: DaemonCommandHandlersOptions, meta: CommandMeta, room: RoomRow, roomId: string, messageId: string, text: string, mentions: readonly string[]): Promise<CommandResult> {
  const selector = options.assistedSelector;
  if (selector === undefined) return successMessage(options, roomId, messageId);
  selector.forgetRoomTurns?.(roomId);
  const result = await selector.startTurn({
    roomId,
    workspaceId: room.workspace_id,
    userMessageId: messageId,
    text,
    participants: assistedSelectorParticipants(options.database, roomId),
    primaryAgentId: room.primary_agent_id,
    mentions,
    history: recentRoomHistory(options.database, roomId)
  });
  if (!("agentId" in result)) return successMessage(options, roomId, messageId);
  const wakeResult = wakeAgents(
    options,
    meta,
    room,
    roomId,
    messageId,
    text,
    [result.agentId],
    mentions.includes(result.agentId) ? "user_mention" : "primary_turn"
  );
  if (isPromiseLike(wakeResult)) return wakeResult.then((woken) => (woken.ok ? successMessage(options, roomId, messageId) : woken));
  return wakeResult.ok ? successMessage(options, roomId, messageId) : wakeResult;
}

function wakeAgents(options: DaemonCommandHandlersOptions, meta: CommandMeta, room: RoomRow, roomId: string, messageId: string, text: string, agentIds: readonly string[], reason: "primary_turn" | "user_mention" | "plan" | ((agentId: string) => "primary_turn" | "user_mention" | "plan")): CommandResult | Promise<CommandResult> {
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
  return sendMessage(options, { type: "SendMessage", roomId: row.room_id, text, mentions: mentionInputsFromCommand(command), refs: contextRefInputsFromCommand(command), idempotencyKey: `edit:${messageId}:${now}` }, meta);
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
    options.eventBus.publish({ id: randomUUID(), type: "message.pinned", schemaVersion: 1, workspaceId: row.workspace_id, roomId: row.room_id, payload: { roomId: row.room_id, messageId, pinnedAt: now }, createdAt: now });
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

export function seedDefaultData(database: AgentHubDatabase, now = Date.now(), workspaceRoot = process.cwd()): void {
  database.sqlite.transaction(() => {
    ensureDefaultWorkspace(database, now, workspaceRoot);
    const insert = database.sqlite.prepare(
      `INSERT OR IGNORE INTO agent_profiles (
        id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at
      ) VALUES (?, NULL, ?, 'mock', 'mock', ?, ?, NULL, 0, NULL, ?, ?)`
    );
    insert.run(
      "mock-builder",
      "Mock Builder",
      `You are Mock Builder, a deterministic software engineer agent.

Your responsibilities:
- Read and write files, implement features, fix bugs
- Write clean, well-structured code following the project's conventions
- Report your progress and results clearly

When you complete a task, summarize what you did and any important decisions you made.`,
      JSON.stringify(["chat", "code.edit", "file.read", "file.write"]),
      now, now
    );
    insert.run(
      "mock-observer",
      "Mock Observer",
      `You are Mock Observer, a passive monitoring agent.

Your responsibilities:
- Monitor conversations and context without actively participating
- Provide analysis or summaries when explicitly asked
- Never initiate actions unless directly addressed

You only respond when explicitly mentioned or assigned a task.`,
      JSON.stringify(["chat", "context.read"]),
      now, now
    );
    insert.run(
      "mock-reviewer",
      "Mock Reviewer",
      `You are Mock Reviewer, a code and content review specialist.

Your responsibilities:
- Review code, documents, or plans assigned to you
- Provide clear, actionable feedback with specific suggestions
- Identify bugs, security issues, style violations, and logic errors
- Approve or request changes with clear reasoning

When reviewing, structure your feedback as: Summary → Issues (critical/minor) → Suggestions → Verdict (approved/changes requested).`,
      JSON.stringify(["chat", "code.review"]),
      now, now
    );
    insert.run(
      "mock-specialist",
      "Mock Specialist",
      `You are Mock Specialist, a task delegation and coordination agent.

Your responsibilities:
- Break down complex tasks into smaller, assignable subtasks
- Coordinate work between multiple agents
- Track task dependencies and ensure correct sequencing
- Report overall progress to the team leader

When delegating, always specify: what needs to be done, what the expected output is, and any dependencies or constraints.`,
      JSON.stringify(["chat", "task.delegate"]),
      now, now
    );
  })();
}

function ensureWorkspace(database: AgentHubDatabase, workspaceId: string, now: number, workspaceRoot = process.cwd()): void {
  if (workspaceId === "default-workspace") {
    ensureDefaultWorkspace(database, now, workspaceRoot);
    return;
  }
  database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, "Workspace", workspaceRoot, now, now);
}

function ensureDefaultWorkspace(database: AgentHubDatabase, now: number, workspaceRoot: string): void {
  database.sqlite
    .prepare(
      `INSERT INTO workspaces (id, name, root_path, created_at, updated_at)
       VALUES ('default-workspace', 'Default Workspace', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET root_path = excluded.root_path, updated_at = excluded.updated_at`
    )
    .run(workspaceRoot, now, now);
}

type RoomRow = { readonly id: string; readonly workspace_id: string; readonly primary_agent_id: string | null; readonly mode: string };

function getRoom(database: AgentHubDatabase, roomId: string): RoomRow | undefined {
  return database.sqlite.prepare("SELECT id, workspace_id, primary_agent_id, mode FROM rooms WHERE id = ? AND archived_at IS NULL").get(roomId) as RoomRow | undefined;
}

function roomMembers(database: AgentHubDatabase, roomId: string): { readonly agentId: string; readonly slug?: string; readonly name?: string }[] {
  const rows = database.sqlite
    .prepare(
      `SELECT rp.participant_id, COALESCE(roles.name, ap.name) AS name
       FROM room_participants rp
       LEFT JOIN agent_profiles ap ON ap.id = rp.participant_id
       LEFT JOIN agent_bindings bindings ON bindings.id = rp.agent_binding_id
       LEFT JOIN roles ON roles.id = bindings.role_id
       WHERE rp.room_id = ? AND rp.participant_type = 'agent'
       ORDER BY rp.joined_at ASC`
    )
    .all(roomId) as { readonly participant_id: string; readonly name: string | null }[];
  return rows.map((row) => {
    const slug = row.name ? nameToSlug(row.name) : undefined;
    const member: { agentId: string; name?: string; slug?: string } = { agentId: row.participant_id };
    if (row.name !== null) member.name = row.name;
    if (slug !== undefined) member.slug = slug;
    return member;
  });
}

function assistedSelectorParticipants(database: AgentHubDatabase, roomId: string): AssistedSelectorParticipant[] {
  const rows = database.sqlite
    .prepare(
      `SELECT
         rp.participant_id,
         rp.role,
         COALESCE(apres.state, rp.default_presence) AS presence,
         rp.joined_at,
         COALESCE(roles.name, ap.name, rp.participant_id) AS name,
         COALESCE(roles.description, ap.role_prompt, '') AS description,
         COALESCE(roles.capabilities, ap.capabilities, '[]') AS capabilities
       FROM room_participants rp
       LEFT JOIN agent_profiles ap ON ap.id = rp.participant_id
       LEFT JOIN agent_presence apres ON apres.room_id = rp.room_id AND apres.agent_id = rp.participant_id
       LEFT JOIN agent_bindings bindings ON bindings.id = rp.agent_binding_id
       LEFT JOIN roles ON roles.id = bindings.role_id
       WHERE rp.room_id = ? AND rp.participant_type = 'agent'
       ORDER BY rp.joined_at ASC`
    )
    .all(roomId) as {
      readonly participant_id: string;
      readonly role: string;
      readonly presence: string | null;
      readonly joined_at: number | null;
      readonly name: string;
      readonly description: string | null;
      readonly capabilities: string | null;
    }[];
  return rows.map((row) => ({
    agentId: row.participant_id,
    name: row.name,
    role: row.role,
    description: selectorParticipantDescription(row.description, parseCapabilities(row.capabilities), effectiveSkillSummaries(database, roomId, row.participant_id)),
    ...(row.presence !== null ? { presence: row.presence } : {}),
    ...(row.joined_at !== null ? { joinedAt: row.joined_at } : {})
  }));
}

function selectorParticipantDescription(base: string | null, capabilities: readonly string[], skills: readonly string[]): string {
  return [
    base?.trim() ?? "",
    capabilities.length > 0 ? `Capabilities: ${capabilities.join(", ")}` : "",
    skills.length > 0 ? `Skills: ${skills.join("; ")}` : ""
  ].filter((line) => line.length > 0).join("\n");
}

function effectiveSkillSummaries(database: AgentHubDatabase, roomId: string, participantId: string): string[] {
  const roomRows = database.sqlite
    .prepare(
      `SELECT s.id, s.name, s.description
       FROM room_skills rs
       INNER JOIN skills s ON s.id = rs.skill_id
       WHERE rs.room_id = ? AND rs.enabled = 1
       ORDER BY s.name ASC`
    )
    .all(roomId) as { readonly id: string; readonly name: string; readonly description: string }[];
  const overrides = database.sqlite
    .prepare("SELECT skill_id, mode FROM agent_skills WHERE room_participant_id = ?")
    .all(`${roomId}:${participantId}`) as { readonly skill_id: string; readonly mode: "add" | "restrict" }[];
  const pool = new Map(roomRows.map((skill) => [skill.id, skill] as const));
  for (const override of overrides) {
    if (override.mode === "restrict") pool.delete(override.skill_id);
  }
  const addIds = overrides.filter((override) => override.mode === "add" && !pool.has(override.skill_id)).map((override) => override.skill_id);
  if (addIds.length > 0) {
    const placeholders = addIds.map(() => "?").join(", ");
    const addRows = database.sqlite
      .prepare(`SELECT id, name, description FROM skills WHERE id IN (${placeholders}) ORDER BY name ASC`)
      .all(...addIds) as { readonly id: string; readonly name: string; readonly description: string }[];
    for (const skill of addRows) pool.set(skill.id, skill);
  }
  return Array.from(pool.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => `${skill.name} - ${skill.description}`);
}

function recentRoomHistory(database: AgentHubDatabase, roomId: string): string {
  const rows = database.sqlite
    .prepare(
      `SELECT id, role, sender_id
       FROM messages
       WHERE room_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 12`
    )
    .all(roomId) as { readonly id: string; readonly role: string; readonly sender_id: string }[];
  return [...rows].reverse().map((row) => `${row.role === "assistant" ? row.sender_id : "user"}: ${messageText(database, row.id)}`).filter((line) => line.trim().length > 2).join("\n");
}

function wakeTargetsForMessage(room: RoomRow, mentions: readonly string[]): string[] {
  // team/squad: leader always handles user messages; teammates are woken by the leader via MCP
  if (room.mode === "team" || room.mode === "squad") return room.primary_agent_id ? [room.primary_agent_id] : [];
  if (room.mode !== "assisted") return room.primary_agent_id ? [room.primary_agent_id] : [];
  if (mentions.length === 0) return room.primary_agent_id ? [room.primary_agent_id] : [];
  return [...mentions];
}

function resolveMessageMentions(command: Command, text: string, members: readonly { readonly agentId: string; readonly slug?: string; readonly name?: string }[]): string[] {
  const memberIds = new Set(members.map((member) => member.agentId));
  const seen = new Set<string>();
  const mentions: string[] = [];
  const add = (agentId: string): void => {
    if (!memberIds.has(agentId) || seen.has(agentId)) return;
    seen.add(agentId);
    mentions.push(agentId);
  };
  for (const agentId of parseMentions(text, members)) add(agentId);
  for (const agentId of mentionAgentIdsFromCommand(command)) add(agentId);
  return mentions;
}

function mentionInputsFromCommand(command: Command): readonly unknown[] {
  const value = command.mentions ?? command.mentionAgentIds ?? command.mention_agent_ids;
  return Array.isArray(value) ? value : [];
}

function contextRefInputsFromCommand(command: Command): readonly unknown[] {
  return Array.isArray(command.refs) ? command.refs : [];
}

function contextRefsFromCommand(command: Command): MessageContextRef[] {
  return contextRefInputsFromCommand(command)
    .map((item) => normalizeContextRef(item))
    .filter((item): item is MessageContextRef => item !== undefined);
}

function normalizeContextRef(item: unknown): MessageContextRef | undefined {
  if (!isObject(item)) return undefined;
  if (item.type === "artifact" && typeof item.artifactId === "string" && item.artifactId.length > 0) {
    const range = lineRangeFromRef(item);
    const slide = positiveIntegerField(item.slide);
    return {
      type: "artifact",
      artifactId: item.artifactId,
      ...(range !== undefined ? { lineStart: range.lineStart, lineEnd: range.lineEnd } : {}),
      ...(slide !== undefined ? { slide } : {})
    };
  }
  if (item.type === "workspace" && typeof item.path === "string" && item.path.length > 0) {
    const range = lineRangeFromRef(item);
    return {
      type: "workspace",
      path: item.path,
      ...(range !== undefined ? { lineStart: range.lineStart, lineEnd: range.lineEnd } : {})
    };
  }
  return undefined;
}

function lineRangeFromRef(item: Record<string, unknown>): { readonly lineStart: number; readonly lineEnd: number } | undefined {
  const directStart = positiveIntegerField(item.lineStart);
  const directEnd = positiveIntegerField(item.lineEnd);
  if (directStart !== undefined && directEnd !== undefined) return { lineStart: directStart, lineEnd: directEnd };
  const lines = item.lines;
  if (Array.isArray(lines) && lines.length === 2) {
    const tupleStart = positiveIntegerField(lines[0]);
    const tupleEnd = positiveIntegerField(lines[1]);
    if (tupleStart !== undefined && tupleEnd !== undefined) return { lineStart: tupleStart, lineEnd: tupleEnd };
  }
  return undefined;
}

function positiveIntegerField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function mentionAgentIdsFromCommand(command: Command): string[] {
  return mentionInputsFromCommand(command)
    .map((item) => typeof item === "string" ? item : isObject(item) && typeof item.agentBindingId === "string" ? item.agentBindingId : undefined)
    .filter((item): item is string => item !== undefined && item.length > 0);
}

type UploadedAttachmentRow = {
  readonly fileId: string;
  readonly fileName: string;
  readonly mimeType: string | null;
  readonly byteSize: number;
};

function attachmentRowsForFileIds(database: AgentHubDatabase, fileIds: readonly string[]): UploadedAttachmentRow[] {
  if (fileIds.length === 0) return [];
  const placeholders = fileIds.map(() => "?").join(", ");
  const rows = database.sqlite
    .prepare(`SELECT file_id AS fileId, file_name AS fileName, mime_type AS mimeType, byte_size AS byteSize FROM attachments WHERE file_id IN (${placeholders})`)
    .all(...fileIds) as UploadedAttachmentRow[];
  const byId = new Map(rows.map((row) => [row.fileId, row]));
  return fileIds.map((fileId) => byId.get(fileId)).filter((row): row is UploadedAttachmentRow => row !== undefined);
}

function previewKindForAttachment(fileName: string, mimeType: string): PreviewKind {
  return normalizePreviewKind(undefined, mimeType, fileName);
}

function messageText(database: AgentHubDatabase, messageId: string): string {
  const rows = database.sqlite.prepare("SELECT payload FROM message_parts WHERE message_id = ? ORDER BY seq ASC").all(messageId) as { readonly payload: string }[];
  return rows.map((row) => {
    try { const parsed = JSON.parse(row.payload) as { readonly text?: unknown }; return typeof parsed.text === "string" ? parsed.text : ""; } catch { return ""; }
  }).filter((text) => text.length > 0).join("\n");
}

function roomEvent(type: "room.created" | "room.opened" | "room.closed" | "room.deleted", workspaceId: string, roomId: string, payload: Record<string, unknown>, createdAt: number): PublishInput {
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

function stringField(command: Record<string, unknown>, key: string): string | undefined {
  const value = command[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayField(command: Record<string, unknown>, ...keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = command[key];
    if (!Array.isArray(value)) continue;
    return value
      .map((item) => typeof item === "string" ? item : isObject(item) && typeof item.fileId === "string" ? item.fileId : undefined)
      .filter((item): item is string => item !== undefined && item.length > 0);
  }
  return [];
}

type ParticipantSkillAssignmentRecord = {
  readonly participantId: string;
  readonly skillIds: string[];
  readonly mode: "add" | "restrict";
};

function participantSkillAssignmentField(command: Record<string, unknown>): ParticipantSkillAssignmentRecord[] {
  const value = command.participantSkillAssignments;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ParticipantSkillAssignmentRecord[] => {
    if (!isObject(item)) return [];
    const participantId = stringField(item, "participantId");
    const skillIds = [...new Set(stringArrayField(item, "skillIds"))];
    if (participantId === undefined || skillIds.length === 0) return [];
    return [{
      participantId,
      skillIds,
      mode: item.mode === "restrict" ? "restrict" : "add"
    }];
  });
}

function participantRole(participant: Record<string, unknown>, isTeamMode: boolean): string {
  if (isTeamMode) return "teammate";
  return participant.role === "teammate" || participant.role === "primary" ? participant.role : "observer";
}

function participantPresence(participant: Record<string, unknown>, isTeamMode: boolean, role: string): string {
  void isTeamMode;
  void role;
  return participant.defaultPresence === "observing" ? "observing" : "active";
}

function parseCapabilities(value: string | null): string[] {
  if (value === null || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function effectiveAvatarUrl(avatarUrl: unknown, roleAvatar: unknown, agentId: string): string {
  if (isAvatarImageUrl(avatarUrl)) return avatarUrl;
  if (isAvatarImageUrl(roleAvatar)) return roleAvatar;
  return defaultAgentAvatarUrl(agentId);
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

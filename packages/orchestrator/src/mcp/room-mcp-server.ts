import { randomUUID } from "node:crypto";

import type { CommandBus, CommandResult, EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

import { nameToSlug } from "../mention-parser.ts";
import { TaskService, normalizeStatus } from "../task-service.ts";

export type RoomMcpToolName = "room.create_task" | "room.update_task" | "room.list_tasks" | "room.send_message" | "room.list_members" | string;

export type RoomMcpSessionContext = {
  readonly roomId: string;
  readonly runId: string;
  readonly agentId: string;
};

export type RoomMcpToolResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };

export class RoomMcpServer {
  constructor(private readonly options: { readonly commandBus: CommandBus; readonly taskService: TaskService; readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly now?: () => number }) {}

  async callTool(name: RoomMcpToolName, input: unknown, session: RoomMcpSessionContext): Promise<RoomMcpToolResult> {
    if (name === "room.create_task") return this.createTask(input, session);
    if (name === "room.update_task") return this.updateTask(input, session);
    if (name === "room.list_tasks") return { ok: true, data: { tasks: this.options.taskService.list({ roomId: session.roomId }) } };
    if (name === "room.send_message") return this.handleSendMessage(input, session);
    if (name === "room.list_members") return this.handleListMembers(session);
    return toolNotFound(name);
  }

  // ---------------------------------------------------------------------------
  // room.list_members
  // ---------------------------------------------------------------------------

  private handleListMembers(session: RoomMcpSessionContext): RoomMcpToolResult {
    const rows = this.options.database.sqlite
      .prepare(
        `SELECT rp.participant_id AS agentId, rp.role, ap.name, ap.adapter_id AS adapterId,
                COALESCE(ap2.state, 'offline') AS presence
         FROM room_participants rp
         LEFT JOIN agent_profiles ap ON ap.id = rp.participant_id
         LEFT JOIN agent_presence ap2 ON ap2.room_id = rp.room_id AND ap2.agent_id = rp.participant_id
         WHERE rp.room_id = ? AND rp.participant_type = 'agent'
         ORDER BY rp.joined_at ASC`
      )
      .all(session.roomId) as {
        readonly agentId: string;
        readonly role: string;
        readonly name: string | null;
        readonly adapterId: string | null;
        readonly presence: string;
      }[];

    const members = rows.map((row) => ({
      agentId: row.agentId,
      name: row.name ?? row.agentId,
      slug: row.name ? nameToSlug(row.name) : row.agentId,
      role: row.role,
      adapterId: row.adapterId ?? "unknown",
      presence: row.presence,
      isSelf: row.agentId === session.agentId,
    }));

    return { ok: true, data: { members } };
  }

  // ---------------------------------------------------------------------------
  // room.send_message
  // ---------------------------------------------------------------------------

  async handleSendMessage(input: unknown, session: RoomMcpSessionContext): Promise<RoomMcpToolResult> {
    if (!isRecord(input) || typeof input.text !== "string" || input.text.length === 0) return failure("validation_failed", "text is required");
    const participant = this.options.database.sqlite.prepare("SELECT role FROM room_participants WHERE room_id = ? AND participant_id = ? AND participant_type = 'agent'").get(session.roomId, session.agentId) as { readonly role: string } | undefined;
    if (!participant) return failure("permission_denied", "agent is not a room participant");
    const room = this.options.database.sqlite.prepare("SELECT workspace_id, primary_agent_id, mode FROM rooms WHERE id = ? AND archived_at IS NULL").get(session.roomId) as { readonly workspace_id: string; readonly primary_agent_id: string | null; readonly mode: string } | undefined;
    if (!room) return failure("not_found", `Room '${session.roomId}' not found`);

    const text = input.text;
    const now = this.options.now?.() ?? Date.now();

    // In assisted mode, an agent calling room.send_message routes the message
    // directly to the mentioned agents via mailbox + WakeAgent, bypassing the
    // user-message path. This is the agent-to-agent coordination channel.
    if (room.mode === "assisted") {
      return this.handleAgentSendMessage(text, room.workspace_id, room.primary_agent_id, session, now);
    }

    // Solo mode: fall back to the original behaviour (dispatch SendMessage as if user sent it).
    if (participant.role === "observer") {
      const presence = this.options.database.sqlite.prepare("SELECT state FROM agent_presence WHERE room_id = ? AND agent_id = ?").get(session.roomId, session.agentId) as { readonly state: string } | undefined;
      if (presence?.state !== "active") {
        const mailboxMessageId = room.primary_agent_id !== null
          ? this.appendMailbox(room.workspace_id, session.roomId, session.agentId, room.primary_agent_id, text, now)
          : null;
        return { ok: true, data: { degraded: true, reason: "observer_must_knock_or_mailbox", ...(mailboxMessageId !== null ? { mailboxMessageId } : {}) } };
      }
      this.options.eventBus.publish({ id: randomUUID(), type: "server.connected", schemaVersion: 1, workspaceId: room.workspace_id, roomId: session.roomId, runId: session.runId, agentId: session.agentId, payload: { audit: true, actor: { type: "agent", id: session.agentId }, action: "room.send_message", target: `room:${session.roomId}`, outcome: "allowed", observer: true }, createdAt: now });
    }
    const result = await this.dispatch({ type: "SendMessage", roomId: session.roomId, text, idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey : `mcp:send-message:${session.runId}:${randomUUID()}` }, session);
    return commandResult(result);
  }

  // ---------------------------------------------------------------------------
  // Agent-to-agent message routing (assisted mode)
  // ---------------------------------------------------------------------------

  private async handleAgentSendMessage(
    text: string,
    workspaceId: string,
    primaryAgentId: string | null,
    session: RoomMcpSessionContext,
    now: number
  ): Promise<RoomMcpToolResult> {
    // Resolve mention targets from the message text.
    const allMembers = this.options.database.sqlite
      .prepare(
        `SELECT rp.participant_id AS agentId, ap.name
         FROM room_participants rp
         LEFT JOIN agent_profiles ap ON ap.id = rp.participant_id
         WHERE rp.room_id = ? AND rp.participant_type = 'agent' AND rp.participant_id != ?
         ORDER BY rp.joined_at ASC`
      )
      .all(session.roomId, session.agentId) as { readonly agentId: string; readonly name: string | null }[];

    const members = allMembers.map((r) => {
      const slug = r.name ? nameToSlug(r.name) : undefined;
      const member: { agentId: string; name?: string; slug?: string } = { agentId: r.agentId };
      if (r.name !== null) member.name = r.name;
      if (slug !== undefined) member.slug = slug;
      return member;
    });

    // Parse @mentions from the text. If no mentions, broadcast to all non-self members.
    const { parseMentions } = await import("../mention-parser.ts");
    const mentioned = parseMentions(text, members);
    const targets = mentioned.length > 0 ? mentioned : members.map((m) => m.agentId);

    if (targets.length === 0) {
      return { ok: true, data: { delivered: 0, reason: "no_targets" } };
    }

    const deliveries: { agentId: string; mailboxMessageId: string }[] = [];
    for (const targetAgentId of targets) {
      const mailboxMessageId = this.appendMailbox(workspaceId, session.roomId, session.agentId, targetAgentId, text, now);
      deliveries.push({ agentId: targetAgentId, mailboxMessageId });

      // Wake the target agent via WakeAgent command (best-effort, non-fatal).
      try {
        const wakeResult = await this.options.commandBus.dispatch(
          {
            type: "WakeAgent",
            roomId: session.roomId,
            agentId: targetAgentId,
            workspaceId,
            reason: "mailbox_message",
            messageId: undefined,
            promptDelta: { kind: "delta_only", instructions: text },
            idempotencyKey: `mcp:agent-msg:${session.runId}:${targetAgentId}:${mailboxMessageId}`,
          },
          { actor: { type: "agent", id: session.agentId }, traceId: `mcp:${session.runId}`, origin: "mcp_tool" }
        );
        if (!wakeResult.ok) {
          console.warn(`[RoomMcpServer] WakeAgent for ${targetAgentId} returned error: ${wakeResult.error.message}`);
        }
      } catch (err) {
        console.warn(`[RoomMcpServer] WakeAgent for ${targetAgentId} threw:`, err);
      }
    }

    return { ok: true, data: { delivered: deliveries.length, deliveries } };
  }

  // ---------------------------------------------------------------------------
  // Task tools
  // ---------------------------------------------------------------------------

  private async createTask(input: unknown, session: RoomMcpSessionContext): Promise<RoomMcpToolResult> {
    if (!isRecord(input) || typeof input.title !== "string" || input.title.length === 0) return failure("validation_failed", "title is required");
    const result = await this.dispatch({
      type: "CreateTask",
      roomId: session.roomId,
      title: input.title,
      ...(typeof input.parentTaskId === "string" ? { parentTaskId: input.parentTaskId } : {}),
      ...(typeof input.description === "string" ? { description: input.description } : {}),
      ...(typeof input.assigneeAgentId === "string" ? { assigneeAgentId: input.assigneeAgentId } : {}),
      sourceRunId: session.runId,
      ...(Array.isArray(input.dependencies) ? { dependencies: input.dependencies.filter((item): item is string => typeof item === "string") } : {}),
      ...(typeof input.priority === "string" ? { priority: input.priority } : {}),
      ...(typeof input.dueAt === "number" ? { dueAt: input.dueAt } : {}),
      idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey : `mcp:create-task:${session.runId}:${randomUUID()}`
    }, session);
    return commandResult(result);
  }

  private async updateTask(input: unknown, session: RoomMcpSessionContext): Promise<RoomMcpToolResult> {
    if (!isRecord(input) || typeof input.taskId !== "string" || normalizeStatus(input.status) === undefined) return failure("validation_failed", "taskId and valid status are required");
    const result = await this.dispatch({
      type: "UpdateTask",
      taskId: input.taskId,
      status: input.status,
      reason: typeof input.reason === "string" ? input.reason : "mcp_update",
      idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey : `mcp:update-task:${session.runId}:${input.taskId}:${input.status}:${randomUUID()}`
    }, session);
    return commandResult(result);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private dispatch(command: Parameters<CommandBus["dispatch"]>[0], session: RoomMcpSessionContext): CommandResult | Promise<CommandResult> {
    return this.options.commandBus.dispatch(command, { actor: { type: "agent", id: session.agentId }, traceId: `mcp:${session.runId}:${randomUUID()}`, ...(command.idempotencyKey !== undefined ? { idempotencyKey: command.idempotencyKey } : {}), origin: "mcp_tool" });
  }

  private appendMailbox(workspaceId: string, roomId: string, fromAgentId: string, toAgentId: string, text: string, now: number): string {
    const mailboxMessageId = randomUUID();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite
        .prepare(
          "INSERT INTO mailbox_messages (id, workspace_id, room_id, from_type, from_id, to_agent_id, kind, content, files, read, claimed_run_id, claimed_at, delivery_batch_id, delivery_failure_reason, attempt_count, created_at, consumed_at) VALUES (?, ?, ?, 'agent', ?, ?, 'message', ?, '[]', 0, NULL, NULL, NULL, NULL, 0, ?, NULL)"
        )
        .run(mailboxMessageId, workspaceId, roomId, fromAgentId, toAgentId, JSON.stringify({ text }), now);
      this.options.eventBus.publish({ id: randomUUID(), type: "mailbox.message.created", schemaVersion: 1, workspaceId, roomId, agentId: toAgentId, payload: { mailboxMessageId, roomId, fromAgentId, targetAgentId: toAgentId }, createdAt: now });
    })();
    return mailboxMessageId;
  }
}

function commandResult(result: CommandResult): RoomMcpToolResult {
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: result.data };
}

function toolNotFound(name: string): RoomMcpToolResult {
  return { ok: false, error: { code: "tool_not_found", message: `Tool '${name}' is not implemented in this MCP slice` } };
}

function failure(code: string, message: string): RoomMcpToolResult {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

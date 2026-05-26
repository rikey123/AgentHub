import { randomUUID } from "node:crypto";

import type { CommandBus, CommandResult, EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

import { TaskService, normalizeStatus } from "../task-service.ts";

export type RoomMcpToolName = "room.create_task" | "room.update_task" | "room.list_tasks" | "room.send_message" | string;

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
    return toolNotFound(name);
  }

  async handleSendMessage(input: unknown, session: RoomMcpSessionContext): Promise<RoomMcpToolResult> {
    if (!isRecord(input) || typeof input.text !== "string" || input.text.length === 0) return failure("validation_failed", "text is required");
    const participant = this.options.database.sqlite.prepare("SELECT role FROM room_participants WHERE room_id = ? AND participant_id = ? AND participant_type = 'agent'").get(session.roomId, session.agentId) as { readonly role: string } | undefined;
    if (!participant) return failure("permission_denied", "agent is not a room participant");
    const room = this.options.database.sqlite.prepare("SELECT workspace_id, primary_agent_id FROM rooms WHERE id = ? AND archived_at IS NULL").get(session.roomId) as { readonly workspace_id: string; readonly primary_agent_id: string | null } | undefined;
    if (!room) return failure("not_found", `Room '${session.roomId}' not found`);
    if (participant.role === "observer") {
      const presence = this.options.database.sqlite.prepare("SELECT state FROM agent_presence WHERE room_id = ? AND agent_id = ?").get(session.roomId, session.agentId) as { readonly state: string } | undefined;
      if (presence?.state !== "active") {
        // Observer cannot speak directly when not active. Append to the primary's mailbox so
        // the message is delivered next time the primary wakes. Return the mailbox row id so
        // the caller can correlate / cancel / retry.
        const mailboxMessageId = room.primary_agent_id !== null
          ? this.appendMailbox(room.workspace_id, session.roomId, session.agentId, room.primary_agent_id, input.text)
          : null;
        return {
          ok: true,
          data: {
            degraded: true,
            reason: "observer_must_knock_or_mailbox",
            ...(mailboxMessageId !== null ? { mailboxMessageId } : {})
          }
        };
      }
      this.options.eventBus.publish({ id: randomUUID(), type: "server.connected", schemaVersion: 1, workspaceId: room.workspace_id, roomId: session.roomId, runId: session.runId, agentId: session.agentId, payload: { audit: true, actor: { type: "agent", id: session.agentId }, action: "room.send_message", target: `room:${session.roomId}`, outcome: "allowed", observer: true }, createdAt: this.options.now?.() ?? Date.now() });
    }
    const result = await this.dispatch({ type: "SendMessage", roomId: session.roomId, text: input.text, idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey : `mcp:send-message:${session.runId}:${randomUUID()}` }, session);
    return commandResult(result);
  }

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

  private dispatch(command: Parameters<CommandBus["dispatch"]>[0], session: RoomMcpSessionContext): CommandResult | Promise<CommandResult> {
    return this.options.commandBus.dispatch(command, { actor: { type: "agent", id: session.agentId }, traceId: `mcp:${session.runId}:${randomUUID()}`, ...(command.idempotencyKey !== undefined ? { idempotencyKey: command.idempotencyKey } : {}), origin: "mcp_tool" });
  }

  private appendMailbox(workspaceId: string, roomId: string, fromAgentId: string, toAgentId: string, text: string): string {
    const now = this.options.now?.() ?? Date.now();
    const mailboxMessageId = randomUUID();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("INSERT INTO mailbox_messages (id, workspace_id, room_id, from_type, from_id, to_agent_id, kind, content, files, read, claimed_run_id, claimed_at, delivery_batch_id, delivery_failure_reason, attempt_count, created_at, consumed_at) VALUES (?, ?, ?, 'agent', ?, ?, 'message', ?, '[]', 0, NULL, NULL, NULL, NULL, 0, ?, NULL)").run(mailboxMessageId, workspaceId, roomId, fromAgentId, toAgentId, JSON.stringify({ text }), now);
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

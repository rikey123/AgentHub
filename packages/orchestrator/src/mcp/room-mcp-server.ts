import { randomUUID } from "node:crypto";

import type { CommandBus, CommandResult } from "@agenthub/bus";

import { TaskService, normalizeStatus } from "../task-service.ts";

export type RoomMcpToolName = "room.create_task" | "room.update_task" | "room.list_tasks" | string;

export type RoomMcpSessionContext = {
  readonly roomId: string;
  readonly runId: string;
  readonly agentId: string;
};

export type RoomMcpToolResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };

export class RoomMcpServer {
  constructor(private readonly options: { readonly commandBus: CommandBus; readonly taskService: TaskService }) {}

  async callTool(name: RoomMcpToolName, input: unknown, session: RoomMcpSessionContext): Promise<RoomMcpToolResult> {
    if (name === "room.create_task") return this.createTask(input, session);
    if (name === "room.update_task") return this.updateTask(input, session);
    if (name === "room.list_tasks") return { ok: true, data: { tasks: this.options.taskService.list({ roomId: session.roomId }) } };
    return toolNotFound(name);
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

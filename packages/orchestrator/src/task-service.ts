import { randomUUID } from "node:crypto";

import type { Command, CommandErrorCode, CommandHandler, CommandMeta, CommandResult, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type TaskStatus = "pending" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";

export type TaskRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly room_id: string | null;
  readonly parent_task_id: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly assignee_agent_id: string | null;
  readonly source_run_id: string | null;
  readonly source_message_id: string | null;
  readonly dependencies: string;
  readonly priority: string | null;
  readonly due_at: number | null;
  readonly created_by: string | null;
  readonly created_at: number;
  readonly updated_at: number;
};

export type TaskView = {
  readonly id: string;
  readonly workspaceId: string;
  readonly roomId: string;
  readonly parentTaskId?: string;
  readonly title: string;
  readonly description?: string;
  readonly status: TaskStatus;
  readonly assigneeAgentId?: string;
  readonly sourceRunId?: string;
  readonly sourceMessageId?: string;
  readonly dependencies: readonly string[];
  readonly priority?: string;
  readonly dueAt?: number;
  readonly createdBy?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type CreateTaskInput = {
  readonly roomId: string;
  readonly title: string;
  readonly parentTaskId?: string;
  readonly description?: string;
  readonly assigneeAgentId?: string;
  readonly sourceRunId?: string;
  readonly sourceMessageId?: string;
  readonly dependencies?: readonly string[];
  readonly priority?: string;
  readonly dueAt?: number;
  readonly createdBy: string;
};

export type UpdateTaskStatusInput = {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly reason?: string;
};

export class TaskService {
  constructor(private readonly options: { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly now?: () => number }) {}

  create(input: CreateTaskInput): CommandResult<{ readonly task: TaskView; readonly taskId: string }> {
    if (input.title.trim().length === 0) return failed("validation_failed", "title is required");
    const room = this.room(input.roomId);
    if (!room) return failed("not_found", `Room '${input.roomId}' not found`);
    if (input.assigneeAgentId !== undefined && !this.roomAgent(input.roomId, input.assigneeAgentId)) return failed("validation_failed", `Agent '${input.assigneeAgentId}' is not a room participant`);
    if (input.parentTaskId !== undefined && !this.task(input.parentTaskId)) return failed("not_found", `Task '${input.parentTaskId}' not found`);
    const now = this.options.now?.() ?? Date.now();
    const taskId = randomUUID();
    const dependencies = JSON.stringify(input.dependencies ?? []);
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite
        .prepare(
          `INSERT INTO tasks (
            id, workspace_id, room_id, parent_task_id, title, description, status, assignee_agent_id,
            source_run_id, source_message_id, dependencies, priority, due_at, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          taskId,
          room.workspace_id,
          input.roomId,
          input.parentTaskId ?? null,
          input.title,
          input.description ?? null,
          input.assigneeAgentId ?? null,
          input.sourceRunId ?? null,
          input.sourceMessageId ?? null,
          dependencies,
          input.priority ?? null,
          input.dueAt ?? null,
          input.createdBy,
          now,
          now
        );
      this.options.eventBus.publish(taskEvent("task.created", room.workspace_id, input.roomId, taskId, { taskId, roomId: input.roomId, title: input.title, parentTaskId: input.parentTaskId, assigneeAgentId: input.assigneeAgentId, sourceRunId: input.sourceRunId, createdBy: input.createdBy }, now));
      if (input.assigneeAgentId !== undefined) {
        this.options.eventBus.publish(taskEvent("task.assigned", room.workspace_id, input.roomId, taskId, { taskId, prevAssignee: null, newAssignee: input.assigneeAgentId }, now));
      }
    })();
    const task = this.task(taskId);
    if (!task) return failed("internal_error", `Task '${taskId}' was not persisted`);
    return { ok: true, data: { task: taskView(task), taskId }, emittedEvents: latestTaskEvents(this.options.database, taskId) };
  }

  updateStatus(input: UpdateTaskStatusInput): CommandResult<{ readonly task: TaskView; readonly taskId: string }> {
    const nextStatus = normalizeStatus(input.status);
    if (nextStatus === undefined) return failed("validation_failed", "invalid task status");
    const existing = this.task(input.taskId);
    if (!existing) return failed("not_found", `Task '${input.taskId}' not found`);
    if (!canTransition(existing.status, nextStatus)) return this.rejectTransition(existing, nextStatus, input.reason);
    const now = this.options.now?.() ?? Date.now();
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(nextStatus, now, input.taskId);
      this.options.eventBus.publish(taskEvent("task.status.changed", existing.workspace_id, existing.room_id ?? "", input.taskId, { taskId: input.taskId, prevStatus: existing.status, nextStatus, ...(input.reason !== undefined ? { reason: input.reason } : {}) }, now));
    })();
    const task = this.task(input.taskId);
    if (!task) return failed("internal_error", `Task '${input.taskId}' was not persisted`);
    return { ok: true, data: { task: taskView(task), taskId: input.taskId }, emittedEvents: latestTaskEvents(this.options.database, input.taskId) };
  }

  complete(taskId: string, reason = "user_marked"): CommandResult<{ readonly task: TaskView; readonly taskId: string }> {
    const existing = this.task(taskId);
    if (!existing) return failed("not_found", `Task '${taskId}' not found`);
    if (existing.status !== "in_progress" && existing.status !== "review") return this.rejectTransition(existing, "completed", reason);
    return this.updateStatus({ taskId, status: "completed", reason });
  }

  list(input: { readonly roomId: string; readonly runId?: string }): TaskView[] {
    const clauses = ["room_id = ?"];
    const params: unknown[] = [input.roomId];
    if (input.runId !== undefined) {
      clauses.push("(source_run_id = ? OR id IN (SELECT task_id FROM task_runs WHERE run_id = ?))");
      params.push(input.runId, input.runId);
    }
    return (this.options.database.sqlite.prepare(`SELECT * FROM tasks WHERE ${clauses.join(" AND ")} ORDER BY created_at ASC, id ASC`).all(...params) as TaskRow[]).map(taskView);
  }

  private task(taskId: string): TaskRow | undefined {
    return this.options.database.sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
  }

  private room(roomId: string): { readonly workspace_id: string } | undefined {
    return this.options.database.sqlite.prepare("SELECT workspace_id FROM rooms WHERE id = ? AND archived_at IS NULL").get(roomId) as { readonly workspace_id: string } | undefined;
  }

  private roomAgent(roomId: string, agentId: string): boolean {
    return this.options.database.sqlite.prepare("SELECT 1 FROM room_participants WHERE room_id = ? AND participant_id = ? AND participant_type = 'agent'").get(roomId, agentId) !== undefined;
  }

  private rejectTransition<T = { readonly task: TaskView; readonly taskId: string }>(existing: TaskRow, nextStatus: TaskStatus, reason?: string): CommandResult<T> {
    const now = this.options.now?.() ?? Date.now();
    this.options.eventBus.publish(taskEvent("task.status.changed.rejected", existing.workspace_id, existing.room_id ?? "", existing.id, { taskId: existing.id, prevStatus: existing.status, nextStatus, ...(reason !== undefined ? { reason } : {}) }, now));
    return failed("conflict", "invalid_task_transition", { from: existing.status, to: nextStatus });
  }
}

export function createCreateTaskHandler(service: TaskService): CommandHandler {
  return (command: Command, meta: CommandMeta) => {
    const roomId = stringField(command, "roomId");
    const title = stringField(command, "title");
    if (!roomId || !title) return failed("validation_failed", "roomId and title are required");
    return service.create({
      roomId,
      title,
      ...(stringField(command, "parentTaskId") !== undefined ? { parentTaskId: stringField(command, "parentTaskId") as string } : {}),
      ...(stringField(command, "description") !== undefined ? { description: stringField(command, "description") as string } : {}),
      ...(stringField(command, "assigneeAgentId") !== undefined ? { assigneeAgentId: stringField(command, "assigneeAgentId") as string } : {}),
      ...(stringField(command, "sourceRunId") !== undefined ? { sourceRunId: stringField(command, "sourceRunId") as string } : {}),
      ...(stringField(command, "sourceMessageId") !== undefined ? { sourceMessageId: stringField(command, "sourceMessageId") as string } : {}),
      ...(dependenciesField(command) !== undefined ? { dependencies: dependenciesField(command) as readonly string[] } : {}),
      ...(stringField(command, "priority") !== undefined ? { priority: stringField(command, "priority") as string } : {}),
      ...(numberField(command, "dueAt") !== undefined ? { dueAt: numberField(command, "dueAt") as number } : {}),
      createdBy: meta.actor.type === "agent" ? meta.actor.id : "user"
    });
  };
}

export function createUpdateTaskHandler(service: TaskService): CommandHandler {
  return (command: Command) => {
    const taskId = stringField(command, "taskId");
    const status = normalizeStatus(stringField(command, "status"));
    if (!taskId || status === undefined) return failed("validation_failed", "taskId and valid status are required");
    return service.updateStatus({ taskId, status, ...(stringField(command, "reason") !== undefined ? { reason: stringField(command, "reason") as string } : {}) });
  };
}

export function createCompleteTaskHandler(service: TaskService): CommandHandler {
  return (command: Command) => {
    const taskId = stringField(command, "taskId");
    if (!taskId) return failed("validation_failed", "taskId is required");
    return service.complete(taskId);
  };
}

export function normalizeStatus(value: unknown): TaskStatus | undefined {
  if (value === "open") return "pending";
  if (value === "done") return "completed";
  if (value === "pending" || value === "in_progress" || value === "blocked" || value === "review" || value === "completed" || value === "cancelled") return value;
  return undefined;
}

function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  const allowed: Record<TaskStatus, readonly TaskStatus[]> = {
    pending: ["in_progress", "blocked", "cancelled"],
    in_progress: ["blocked", "review", "completed", "cancelled"],
    blocked: ["pending", "in_progress", "cancelled"],
    review: ["in_progress", "completed", "cancelled"],
    completed: [],
    cancelled: []
  };
  return allowed[from].includes(to);
}

function taskView(row: TaskRow): TaskView {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    roomId: row.room_id ?? "",
    ...(row.parent_task_id !== null ? { parentTaskId: row.parent_task_id } : {}),
    title: row.title,
    ...(row.description !== null ? { description: row.description } : {}),
    status: row.status,
    ...(row.assignee_agent_id !== null ? { assigneeAgentId: row.assignee_agent_id } : {}),
    ...(row.source_run_id !== null ? { sourceRunId: row.source_run_id } : {}),
    ...(row.source_message_id !== null ? { sourceMessageId: row.source_message_id } : {}),
    dependencies: parseDependencies(row.dependencies),
    ...(row.priority !== null ? { priority: row.priority } : {}),
    ...(row.due_at !== null ? { dueAt: row.due_at } : {}),
    ...(row.created_by !== null ? { createdBy: row.created_by } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function taskEvent(type: "task.created" | "task.assigned" | "task.status.changed" | "task.status.changed.rejected", workspaceId: string, roomId: string, taskId: string, payload: Record<string, unknown>, createdAt: number): PublishInput {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId, roomId, taskId, payload: withoutUndefined(payload), createdAt };
}

function latestTaskEvents(database: AgentHubDatabase, taskId: string): { readonly seq: number; readonly type: string }[] {
  return database.sqlite.prepare("SELECT seq, type FROM events WHERE task_id = ? ORDER BY seq ASC").all(taskId) as { readonly seq: number; readonly type: string }[];
}

function parseDependencies(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function dependenciesField(command: Command): readonly string[] | undefined {
  return Array.isArray(command.dependencies) && command.dependencies.every((item) => typeof item === "string") ? command.dependencies : undefined;
}

function stringField(command: Command, key: string): string | undefined {
  const value = command[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(command: Command, key: string): number | undefined {
  const value = command[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function withoutUndefined(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function failed<T = unknown>(code: CommandErrorCode, message: string, details?: unknown): CommandResult<T> {
  return { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

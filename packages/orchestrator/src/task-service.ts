import { randomUUID } from "node:crypto";

import type { Command, CommandErrorCode, CommandHandler, CommandMeta, CommandResult, EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type TaskStatus = "pending" | "in_progress" | "blocked" | "review" | "completed" | "cancelled";

export type TaskTimeoutWake = {
  readonly taskId: string;
  readonly roomId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly mailboxMessageId: string;
};

export type DelegationStep = {
  readonly byRoleId: string;
  readonly atRunId: string;
  readonly atTimestamp: number;
};

export type TeamDispatchScope =
  | { readonly kind: "source_run_id"; readonly value: string }
  | { readonly kind: "parent_task_id"; readonly value: string };

type ResolvedRoleBinding = {
  readonly id: string;
  readonly role_id: string;
  readonly participant_id: string;
  readonly room_id: string;
};

export type TaskRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly room_id: string | null;
  readonly parent_task_id: string | null;
  readonly delegation_chain: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly blocker_reason: string | null;
  readonly assignee_agent_id: string | null;
  readonly assignee_role_id: string | null;
  readonly assignee_binding_id: string | null;
  readonly source_run_id: string | null;
  readonly source_message_id: string | null;
  readonly dependencies: string;
  readonly priority: string | null;
  readonly expects_review: number;
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
  readonly delegationChain?: readonly DelegationStep[];
  readonly title: string;
  readonly description?: string;
  readonly status: TaskStatus;
  readonly blockerReason?: string;
  readonly assigneeAgentId?: string;
  readonly assigneeRoleId?: string;
  readonly assigneeBindingId?: string;
  readonly sourceRunId?: string;
  readonly sourceMessageId?: string;
  readonly dependencies: readonly string[];
  readonly priority?: string;
  readonly expectsReview: boolean;
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
  readonly assigneeRoleId?: string;
  readonly assigneeBindingId?: string;
  readonly expectsReview?: boolean;
  readonly delegationChain?: readonly DelegationStep[];
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
  readonly blockerReason?: string;
};

export type TaskActivityKind = "comment" | "artifact_linked" | "blocker_set" | "priority_change" | "status_change";

export type TaskActivityByKind = "user" | "role" | "system";

export type AddTaskActivityInput = {
  readonly taskId: string;
  readonly kind: TaskActivityKind;
  readonly byKind: TaskActivityByKind;
  readonly by: string;
  readonly payload?: unknown;
  readonly nextPriority?: string;
};

export class TaskService {
  constructor(private readonly options: { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly now?: () => number; readonly onTaskCompleted?: (task: TaskRow) => void }) {}

  create(input: CreateTaskInput): CommandResult<{ readonly task: TaskView; readonly taskId: string }> {
    return this.options.database.sqlite.transaction(() => this.createInTransaction(input))();
  }

  createInTransaction(input: CreateTaskInput): CommandResult<{ readonly task: TaskView; readonly taskId: string }> {
    if (input.title.trim().length === 0) return failed("validation_failed", "title is required");
    const room = this.room(input.roomId);
    if (!room) return failed("not_found", `Room '${input.roomId}' not found`);
    if (input.assigneeAgentId !== undefined && !this.roomAgent(input.roomId, input.assigneeAgentId)) return failed("validation_failed", `Agent '${input.assigneeAgentId}' is not a room participant`);
    const resolvedAssignee = input.assigneeRoleId !== undefined ? resolveRoleToBinding(this.options.database, input.roomId, input.assigneeRoleId) : undefined;
    if (input.assigneeRoleId !== undefined && resolvedAssignee === null) return failed("validation_failed", `Role '${input.assigneeRoleId}' is not bound in room '${input.roomId}'`);
    const assigneeBinding = resolvedAssignee ?? (input.assigneeBindingId !== undefined ? this.bindingInRoom(input.roomId, input.assigneeBindingId) : undefined);
    if (input.assigneeBindingId !== undefined && assigneeBinding === undefined) return failed("validation_failed", `Binding '${input.assigneeBindingId}' is not a room participant in room '${input.roomId}'`);
    if (resolvedAssignee !== undefined && resolvedAssignee !== null && input.assigneeBindingId !== undefined && resolvedAssignee.id !== input.assigneeBindingId) {
      return failed("validation_failed", `Role '${input.assigneeRoleId}' is bound to '${resolvedAssignee.id}', not '${input.assigneeBindingId}'`);
    }
    const assigneeAgentId = input.assigneeAgentId ?? assigneeBinding?.participant_id ?? null;
    if (input.parentTaskId !== undefined && !this.task(input.parentTaskId)) return failed("not_found", `Task '${input.parentTaskId}' not found`);
    const now = this.options.now?.() ?? Date.now();
    if (input.parentTaskId !== undefined && this.delegationDepth(input.parentTaskId) >= 5) return failed("delegation_too_deep", "delegation_too_deep", { maxDepth: 5 });
    const duplicateTask = this.findDuplicateTask(input.roomId, input.title, input.description ?? null, now);
    if (duplicateTask !== undefined) return failed("delegation_duplicate", "delegation_duplicate", { taskId: duplicateTask.id });
    const taskId = randomUUID();
    const dependencies = JSON.stringify(input.dependencies ?? []);
    const delegationChain = input.delegationChain !== undefined ? JSON.stringify(input.delegationChain) : null;
    const expectsReview = input.expectsReview ?? false;
    this.options.database.sqlite
      .prepare(
        `INSERT INTO tasks (
          id, workspace_id, room_id, parent_task_id, delegation_chain, title, description, status, assignee_agent_id,
          assignee_role_id, assignee_binding_id, source_run_id, source_message_id, dependencies, priority, expects_review,
          due_at, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        taskId,
        room.workspace_id,
        input.roomId,
        input.parentTaskId ?? null,
        delegationChain,
        input.title,
        input.description ?? null,
        "pending",
        assigneeAgentId,
        input.assigneeRoleId ?? null,
        assigneeBinding?.id ?? input.assigneeBindingId ?? null,
        input.sourceRunId ?? null,
        input.sourceMessageId ?? null,
        dependencies,
        input.priority ?? null,
        expectsReview ? 1 : 0,
        input.dueAt ?? null,
        input.createdBy,
        now,
        now
      );
    this.options.eventBus.publish(taskEvent("task.created", room.workspace_id, input.roomId, taskId, { taskId, roomId: input.roomId, title: input.title, parentTaskId: input.parentTaskId, assigneeRoleId: input.assigneeRoleId, assigneeBindingId: assigneeBinding?.id ?? input.assigneeBindingId, assigneeAgentId, expectsReview, sourceRunId: input.sourceRunId, createdBy: input.createdBy }, now));
    if (assigneeAgentId !== null) {
      this.options.eventBus.publish(taskEvent("task.assigned", room.workspace_id, input.roomId, taskId, { taskId, prevAssignee: null, newAssignee: assigneeAgentId }, now));
    }
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
      if (nextStatus === "blocked") {
        this.options.database.sqlite.prepare("UPDATE tasks SET status = 'blocked', blocker_reason = ?, updated_at = ? WHERE id = ?").run(input.blockerReason ?? null, now, input.taskId);
      } else {
        this.options.database.sqlite.prepare("UPDATE tasks SET status = ?, blocker_reason = NULL, updated_at = ? WHERE id = ?").run(nextStatus, now, input.taskId);
      }
      this.options.eventBus.publish(taskEvent("task.status.changed", existing.workspace_id, existing.room_id ?? "", input.taskId, { taskId: input.taskId, prevStatus: existing.status, nextStatus, ...(input.reason !== undefined ? { reason: input.reason } : {}), ...(input.blockerReason !== undefined ? { blockerReason: input.blockerReason } : {}) }, now));
    })();
    if (nextStatus === "completed") {
      const completedTask = this.task(input.taskId);
      if (completedTask) this.options.onTaskCompleted?.(completedTask);
    }
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

  review(taskId: string): CommandResult<{ readonly task: TaskView; readonly taskId: string }> {
    const existing = this.task(taskId);
    if (!existing) return failed("not_found", `Task '${taskId}' not found`);
    if (existing.status !== "pending" && existing.status !== "in_progress") return this.rejectTransition(existing, "review", "task_review");
    return this.updateStatus({ taskId, status: "review", reason: "task_review" });
  }

  startDelegatedRun(taskId: string, byRunId: string): CommandResult<{ readonly task: TaskView; readonly taskId: string }> {
    return this.transitionDelegatedTask(taskId, "in_progress", { reason: "delegated_run_started", byRunId, activityKind: "status_change", activityPayload: { fromStatus: "pending", nextStatus: "in_progress", byRunId } });
  }

  completeDelegatedRun(taskId: string, byRunId: string): CommandResult<{ readonly task: TaskView; readonly taskId: string }> {
    const existing = this.task(taskId);
    if (!existing) return failed("not_found", `Task '${taskId}' not found`);
    if (existing.expects_review !== 0) return failed("conflict", `Task '${taskId}' is not a squad task`);
    if (existing.status !== "pending" && existing.status !== "in_progress" && existing.status !== "completed") return this.rejectTransition(existing, "completed", "delegated_run_completed");
    if (existing.status === "completed") return { ok: true, data: { task: taskView(existing), taskId }, emittedEvents: latestTaskEvents(this.options.database, taskId) };

    const now = this.options.now?.() ?? Date.now();
    this.options.database.sqlite.transaction(() => {
      if (existing.status === "pending") {
        this.options.database.sqlite.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run("in_progress", now, taskId);
        this.options.eventBus.publish(taskEvent("task.status.changed", existing.workspace_id, existing.room_id ?? "", taskId, { taskId, prevStatus: "pending", nextStatus: "in_progress", reason: "delegated_run_started", byRunId }, now));
      }
      this.options.database.sqlite.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run("completed", now, taskId);
      this.options.eventBus.publish(taskEvent("task.status.changed", existing.workspace_id, existing.room_id ?? "", taskId, { taskId, prevStatus: existing.status === "pending" ? "in_progress" : existing.status, nextStatus: "completed", reason: "delegated_run_completed" }, now));
      this.options.eventBus.publish(taskEvent("task.delegation.completed", existing.workspace_id, existing.room_id ?? "", taskId, { taskId, delegationId: taskId, byTeammateRunId: byRunId }, now));
    })();

    const task = this.task(taskId);
    if (!task) return failed("internal_error", `Task '${taskId}' was not persisted`);
    return { ok: true, data: { task: taskView(task), taskId }, emittedEvents: latestTaskEvents(this.options.database, taskId) };
  }

  blockDelegatedRun(taskId: string, byRunId: string, blockerReason?: string): CommandResult<{ readonly task: TaskView; readonly taskId: string }> {
    return this.transitionDelegatedTask(taskId, "blocked", { reason: "delegated_run_failed", byRunId, ...(blockerReason !== undefined ? { blockerReason } : {}), activityKind: "status_change", activityPayload: { fromStatus: "in_progress", nextStatus: "blocked", byRunId } });
  }

  addTaskActivity(input: AddTaskActivityInput): CommandResult<{ readonly task: TaskView; readonly taskId: string; readonly activityId: string }> {
    if (input.by.trim().length === 0) return failed("validation_failed", "by is required");
    if (input.kind.trim().length === 0) return failed("validation_failed", "kind is required");
    if (input.byKind !== "user" && input.byKind !== "role" && input.byKind !== "system") return failed("validation_failed", "invalid activity actor kind");

    const existing = this.task(input.taskId);
    if (!existing) return failed("not_found", `Task '${input.taskId}' not found`);

    const now = this.options.now?.() ?? Date.now();
    const activityId = randomUUID();
    const payloadJson = input.payload === undefined ? null : JSON.stringify(input.payload);
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite
        .prepare("INSERT INTO task_activities (id, task_id, kind, by_kind, by, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(activityId, input.taskId, input.kind, input.byKind, input.by, payloadJson, now);

      if (input.kind === "priority_change" && input.nextPriority !== undefined) {
        this.options.database.sqlite.prepare("UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?").run(input.nextPriority, now, input.taskId);
      }

      this.options.eventBus.publish(taskEvent("task.activity.added", existing.workspace_id, existing.room_id ?? "", input.taskId, { taskId: input.taskId, activityId, kind: input.kind, byKind: input.byKind, by: input.by, payload: input.payload }, now));
    })();

    const task = this.task(input.taskId);
    if (!task) return failed("internal_error", `Task '${input.taskId}' was not persisted`);
    return { ok: true, data: { task: taskView(task), taskId: input.taskId, activityId }, emittedEvents: latestTaskEvents(this.options.database, input.taskId) };
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

  private bindingInRoom(roomId: string, bindingId: string): ResolvedRoleBinding | undefined {
    return this.options.database.sqlite
      .prepare(
        `SELECT ab.id, ab.role_id, rp.participant_id, rp.room_id
         FROM room_participants rp
         INNER JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
         WHERE rp.room_id = ? AND ab.id = ? AND rp.participant_type = 'agent'
         LIMIT 1`
      )
      .get(roomId, bindingId) as ResolvedRoleBinding | undefined;
  }

  private delegationDepth(taskId: string): number {
    let depth = 0;
    let current = this.task(taskId);
    const visited = new Set<string>();
    while (current?.parent_task_id !== null && current?.parent_task_id !== undefined) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      depth += 1;
      if (depth >= 5) return depth;
      current = this.task(current.parent_task_id);
    }
    return depth;
  }

  private findDuplicateTask(roomId: string, title: string, description: string | null, now: number): TaskRow | undefined {
    return this.options.database.sqlite
      .prepare(
        `SELECT * FROM tasks
         WHERE room_id = ? AND title = ? AND COALESCE(description, '') = COALESCE(?, '') AND created_at >= ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(roomId, title, description, now - 5 * 60 * 1000) as TaskRow | undefined;
  }

  private rejectTransition<T = { readonly task: TaskView; readonly taskId: string }>(existing: TaskRow, nextStatus: TaskStatus, reason?: string): CommandResult<T> {
    const now = this.options.now?.() ?? Date.now();
    this.options.eventBus.publish(taskEvent("task.status.changed.rejected", existing.workspace_id, existing.room_id ?? "", existing.id, { taskId: existing.id, prevStatus: existing.status, nextStatus, ...(reason !== undefined ? { reason } : {}) }, now));
    return failed("conflict", "invalid_task_transition", { from: existing.status, to: nextStatus });
  }

  private transitionDelegatedTask(
    taskId: string,
    nextStatus: "in_progress" | "blocked" | "completed",
    input: { readonly reason: string; readonly byRunId: string; readonly blockerReason?: string; readonly activityKind: TaskActivityKind; readonly activityPayload: Record<string, unknown> }
  ): CommandResult<{ readonly task: TaskView; readonly taskId: string }> {
    const existing = this.task(taskId);
    if (!existing) return failed("not_found", `Task '${taskId}' not found`);
    if (nextStatus === "completed" && existing.expects_review !== 0) return failed("conflict", `Task '${taskId}' is not a squad task`);
    const allowedFrom: readonly TaskStatus[] = nextStatus === "in_progress" ? ["pending"] : ["pending", "in_progress"];
    if (!allowedFrom.includes(existing.status)) return failed("conflict", "invalid_task_transition", { from: existing.status, to: nextStatus });
    if (existing.status === nextStatus) return { ok: true, data: { task: taskView(existing), taskId }, emittedEvents: latestTaskEvents(this.options.database, taskId) };

    const now = this.options.now?.() ?? Date.now();
    this.options.database.sqlite.transaction(() => {
      if (nextStatus === "blocked") {
        this.options.database.sqlite.prepare("UPDATE tasks SET status = 'blocked', blocker_reason = ?, updated_at = ? WHERE id = ?").run(input.blockerReason ?? null, now, taskId);
      } else {
        this.options.database.sqlite.prepare("UPDATE tasks SET status = ?, blocker_reason = NULL, updated_at = ? WHERE id = ?").run(nextStatus, now, taskId);
      }
      this.options.eventBus.publish(taskEvent("task.status.changed", existing.workspace_id, existing.room_id ?? "", taskId, { taskId, prevStatus: existing.status, nextStatus, reason: input.reason, ...(input.blockerReason !== undefined ? { blockerReason: input.blockerReason } : {}) }, now));
    })();

    const task = this.task(taskId);
    if (!task) return failed("internal_error", `Task '${taskId}' was not persisted`);
    return { ok: true, data: { task: taskView(task), taskId }, emittedEvents: latestTaskEvents(this.options.database, taskId) };
  }
}

export function teamDispatchScope(task: TaskRow): TeamDispatchScope | undefined {
  if (task.parent_task_id !== null) return { kind: "parent_task_id", value: task.parent_task_id };
  if (task.source_run_id !== null) return { kind: "source_run_id", value: task.source_run_id };
  return undefined;
}

export function isDelegatedTask(row: TaskRow): boolean {
  return row.expects_review === 0;
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
      ...(stringField(command, "assigneeRoleId") !== undefined ? { assigneeRoleId: stringField(command, "assigneeRoleId") as string } : {}),
      ...(stringField(command, "assigneeBindingId") !== undefined ? { assigneeBindingId: stringField(command, "assigneeBindingId") as string } : {}),
      ...(booleanField(command, "expectsReview") !== undefined ? { expectsReview: booleanField(command, "expectsReview") as boolean } : {}),
      ...(delegationChainField(command) !== undefined ? { delegationChain: delegationChainField(command) as readonly DelegationStep[] } : {}),
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
    return service.updateStatus({ taskId, status, ...(stringField(command, "reason") !== undefined ? { reason: stringField(command, "reason") as string } : {}), ...(stringField(command, "blockerReason") !== undefined ? { blockerReason: stringField(command, "blockerReason") as string } : {}) });
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
    pending: ["in_progress", "review", "blocked", "cancelled"],
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
    ...(row.delegation_chain !== null ? { delegationChain: parseDelegationChain(row.delegation_chain) } : {}),
    title: row.title,
    ...(row.description !== null ? { description: row.description } : {}),
    status: row.status,
    ...(row.assignee_agent_id !== null ? { assigneeAgentId: row.assignee_agent_id } : {}),
    ...(row.assignee_role_id !== null ? { assigneeRoleId: row.assignee_role_id } : {}),
    ...(row.assignee_binding_id !== null ? { assigneeBindingId: row.assignee_binding_id } : {}),
    ...(row.source_run_id !== null ? { sourceRunId: row.source_run_id } : {}),
    ...(row.source_message_id !== null ? { sourceMessageId: row.source_message_id } : {}),
    dependencies: parseDependencies(row.dependencies),
    ...(row.priority !== null ? { priority: row.priority } : {}),
    expectsReview: row.expects_review !== 0,
    ...(row.blocker_reason !== null ? { blockerReason: row.blocker_reason } : {}),
    ...(row.due_at !== null ? { dueAt: row.due_at } : {}),
    ...(row.created_by !== null ? { createdBy: row.created_by } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function taskEvent(type: "task.created" | "task.assigned" | "task.status.changed" | "task.status.changed.rejected" | "task.activity.added" | "task.delegation.completed", workspaceId: string, roomId: string, taskId: string, payload: Record<string, unknown>, createdAt: number): PublishInput {
  return { id: randomUUID(), type, schemaVersion: 1, workspaceId, roomId, taskId, payload: withoutUndefined(payload), createdAt };
}

function ensureTaskTimeoutMailbox(database: AgentHubDatabase, eventBus: EventBus, workspaceId: string, roomId: string, agentId: string, taskId: string, now: number): string {
  const existing = database.sqlite.prepare("SELECT id FROM mailbox_messages WHERE room_id = ? AND to_agent_id = ? AND kind = 'task_timeout' AND from_type = 'system' AND from_id = ? LIMIT 1").get(roomId, agentId, taskId) as { readonly id: string } | undefined;
  if (existing !== undefined) return existing.id;

  const mailboxMessageId = randomUUID();
  database.sqlite.prepare("INSERT INTO mailbox_messages (id, workspace_id, room_id, from_type, from_id, to_agent_id, kind, content, files, read, claimed_run_id, claimed_at, delivery_batch_id, created_at, consumed_at) VALUES (?, ?, ?, 'system', ?, ?, 'task_timeout', ?, '[]', 0, NULL, NULL, NULL, ?, NULL)").run(mailboxMessageId, workspaceId, roomId, taskId, agentId, JSON.stringify({ taskId, reason: 'timeout' }), now);
  eventBus.publish({ id: randomUUID(), type: "mailbox.message.created", schemaVersion: 1, workspaceId, roomId, agentId, payload: { mailboxMessageId, roomId, fromAgentId: null, targetAgentId: agentId, taskId, reason: "timeout" }, createdAt: now });
  return mailboxMessageId;
}

export function normalizeTaskPriority(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3) return String(value);
  if (typeof value === "string" && ["0", "1", "2", "3"].includes(value)) return value;
  return undefined;
}

export function checkTaskTimeouts(database: AgentHubDatabase, eventBus: EventBus, now: number): readonly TaskTimeoutWake[] {
  const cutoff = now - 30 * 60 * 1000;
  const rows = database.sqlite
    .prepare(
      `SELECT t.id, t.room_id, t.workspace_id, t.status, r.primary_agent_id
       FROM tasks t
       INNER JOIN rooms r ON r.id = t.room_id
       WHERE t.status IN ('pending', 'in_progress') AND t.updated_at < ?
       ORDER BY t.updated_at ASC, t.id ASC`
    )
    .all(cutoff) as Array<{ readonly id: string; readonly room_id: string; readonly workspace_id: string; readonly status: TaskStatus; readonly primary_agent_id: string | null }>;

  const wakes: TaskTimeoutWake[] = [];
  if (rows.length === 0) return wakes;

  database.sqlite.transaction(() => {
    for (const row of rows) {
       const updated = database.sqlite.prepare("UPDATE tasks SET status = 'blocked', blocker_reason = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'in_progress') AND updated_at < ?").run("timeout", now, row.id, cutoff);
       if (updated.changes !== 1) continue;
       eventBus.publish(taskEvent("task.status.changed", row.workspace_id, row.room_id, row.id, { taskId: row.id, prevStatus: row.status, nextStatus: "blocked", reason: "timeout", blockerReason: "timeout" }, now));
      if (row.primary_agent_id === null) continue;
      wakes.push({ taskId: row.id, roomId: row.room_id, workspaceId: row.workspace_id, agentId: row.primary_agent_id, mailboxMessageId: ensureTaskTimeoutMailbox(database, eventBus, row.workspace_id, row.room_id, row.primary_agent_id, row.id, now) });
    }
  })();

  return wakes;
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

function parseDelegationChain(value: string): readonly DelegationStep[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is DelegationStep =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as { byRoleId?: unknown }).byRoleId === "string" &&
          typeof (item as { atRunId?: unknown }).atRunId === "string" &&
          typeof (item as { atTimestamp?: unknown }).atTimestamp === "number"
        )
      : [];
  } catch {
    return [];
  }
}

export function resolveRoleToBinding(database: AgentHubDatabase, roomId: string, roleId: string): ResolvedRoleBinding | null {
  return (
    database.sqlite
    .prepare(
      `SELECT ab.id, ab.role_id, rp.participant_id, rp.room_id
       FROM room_participants rp
       INNER JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
       WHERE rp.room_id = ? AND ab.role_id = ? AND rp.participant_type = 'agent'
       LIMIT 1`
    )
    .get(roomId, roleId) as ResolvedRoleBinding | undefined
  ) ?? null;
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

function booleanField(command: Command, key: string): boolean | undefined {
  const value = command[key];
  return typeof value === "boolean" ? value : undefined;
}

function delegationChainField(command: Command): readonly DelegationStep[] | undefined {
  const value = command.delegationChain;
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => isDelegationStep(item)) ? (value as readonly DelegationStep[]) : undefined;
}

function isDelegationStep(value: unknown): value is DelegationStep {
  return typeof value === "object" && value !== null && typeof (value as { byRoleId?: unknown }).byRoleId === "string" && typeof (value as { atRunId?: unknown }).atRunId === "string" && typeof (value as { atTimestamp?: unknown }).atTimestamp === "number";
}

function withoutUndefined(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function failed<T = unknown>(code: CommandErrorCode, message: string, details?: unknown): CommandResult<T> {
  return { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

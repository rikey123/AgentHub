import { randomUUID } from "node:crypto";

import type { CommandBus, EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

import { TaskService, type TaskRow, type TeamDispatchScope } from "./task-service.ts";

type TeamDispatchRuntime = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly commandBus: CommandBus;
  readonly taskService: TaskService;
  readonly now?: () => number;
};

export async function handleTeamDispatchReviewTerminal(runtime: TeamDispatchRuntime, runId: string): Promise<void> {
  const run = runtime.database.sqlite.prepare("SELECT id, workspace_id, room_id, agent_id, task_id, status FROM runs WHERE id = ?").get(runId) as { readonly id: string; readonly workspace_id: string; readonly room_id: string; readonly agent_id: string; readonly task_id: string | null; readonly status: string } | undefined;
  if (run === undefined || run.task_id === null) return;

  const task = runtime.database.sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(run.task_id) as TaskRow | undefined;
  if (task === undefined || task.expects_review === 0) return;

  const scope = taskDispatchScope(task);
  if (scope === undefined) return;

  const siblingState = teamDispatchSiblingState(runtime.database, task.room_id, scope);
  if (siblingState.taskIds.length === 0) return;

  const alreadyStarted = teamDispatchEventCount(runtime.database, task.room_id, "team.dispatch.started", scope) > 0;
  if (alreadyStarted) return;

  if (siblingState.pendingCount > 0) return;

  const room = runtime.database.sqlite.prepare("SELECT workspace_id, primary_agent_id FROM rooms WHERE id = ?").get(task.room_id) as { readonly workspace_id: string; readonly primary_agent_id: string | null } | undefined;
  if (room === undefined || room.primary_agent_id === null) return;

  const wakeReason = siblingState.blockedCount > 0 ? "task_blocked" : "task_review";
  const prompt = wakeReason === "task_blocked"
    ? `A delegated task is blocked: ${siblingState.taskIds.join(", ")}`
    : `All delegated tasks are ready for review: ${siblingState.taskIds.join(", ")}`;
  const wakeResult = await Promise.resolve(runtime.commandBus.dispatch(
    {
      type: "WakeAgent",
      roomId: task.room_id,
      agentId: room.primary_agent_id,
      workspaceId: room.workspace_id,
      reason: wakeReason,
      taskId: task.id,
      promptDelta: { kind: "delta_only", instructions: prompt },
      idempotencyKey: `team-dispatch:${scope.kind}:${scope.value}:${wakeReason}`
    },
    { actor: { type: "system" }, traceId: `team-dispatch:${runId}:${task.id}`, idempotencyKey: `team-dispatch:${scope.kind}:${scope.value}:${wakeReason}`, origin: "internal" }
  ));
  if (!wakeResult.ok) return;

  const leaderRunId = "runId" in wakeResult.data ? wakeResult.data.runId : wakeResult.data.appendedToRunId;
  if (typeof leaderRunId !== "string" || leaderRunId.length === 0) return;

  const dispatchId = `team-dispatch:${scope.kind}:${scope.value}`;
  runtime.eventBus.publish({
    id: randomUUID(),
    type: "team.dispatch.started",
    schemaVersion: 1,
    workspaceId: room.workspace_id,
    roomId: task.room_id,
    runId: leaderRunId,
    agentId: room.primary_agent_id,
    taskId: task.id,
    payload: { dispatchId, leaderRunId, targetTaskIds: siblingState.taskIds, sourceRunId: scope.value },
    createdAt: runtime.now?.() ?? Date.now()
  });
}

export function maybePublishTeamDispatchCompleted(runtime: Pick<TeamDispatchRuntime, "database" | "eventBus" | "now">, task: TaskRow): void {
  if (task.status !== "completed" || task.expects_review === 0) return;
  const scope = taskDispatchScope(task);
  if (scope === undefined) return;

  const taskIds = teamDispatchTaskIds(runtime.database, task.room_id, scope);
  if (taskIds.length === 0) return;
  if (teamDispatchAllCompleted(runtime.database, task.room_id, scope) === false) return;
  if (teamDispatchEventCount(runtime.database, task.room_id, "team.dispatch.completed", scope) > 0) return;

  const room = runtime.database.sqlite.prepare("SELECT workspace_id, primary_agent_id FROM rooms WHERE id = ?").get(task.room_id) as { readonly workspace_id: string; readonly primary_agent_id: string | null } | undefined;
  if (room === undefined || room.primary_agent_id === null) return;

  const dispatchId = `team-dispatch:${scope.kind}:${scope.value}`;
  runtime.eventBus.publish({
    id: randomUUID(),
    type: "team.dispatch.completed",
    schemaVersion: 1,
    workspaceId: room.workspace_id,
    roomId: task.room_id,
    runId: task.source_run_id ?? scope.value,
    agentId: room.primary_agent_id,
    taskId: task.id,
    payload: { dispatchId, leaderRunId: task.source_run_id ?? scope.value, taskIds, sourceRunId: scope.value, summary: `All ${taskIds.length} review tasks completed` },
    createdAt: runtime.now?.() ?? Date.now()
  });
}

function taskDispatchScope(task: TaskRow): TeamDispatchScope | undefined {
  if (task.parent_task_id !== null) return { kind: "parent_task_id", value: task.parent_task_id };
  if (task.source_run_id !== null) return { kind: "source_run_id", value: task.source_run_id };
  return undefined;
}

function teamDispatchTaskIds(database: AgentHubDatabase, roomId: string, scope: TeamDispatchScope): string[] {
  const sql = scope.kind === "parent_task_id"
    ? "SELECT id FROM tasks WHERE room_id = ? AND parent_task_id = ? AND expects_review = 1 ORDER BY created_at ASC, id ASC"
    : "SELECT id FROM tasks WHERE room_id = ? AND source_run_id = ? AND parent_task_id IS NULL AND expects_review = 1 ORDER BY created_at ASC, id ASC";
  const rows = database.sqlite.prepare(sql).all(roomId, scope.value) as Array<{ readonly id: string }>;
  return rows.map((row) => row.id);
}

function teamDispatchSiblingState(database: AgentHubDatabase, roomId: string, scope: TeamDispatchScope): { readonly taskIds: readonly string[]; readonly pendingCount: number; readonly blockedCount: number } {
  const sql = scope.kind === "parent_task_id"
    ? "SELECT id, status FROM tasks WHERE room_id = ? AND parent_task_id = ? AND expects_review = 1 ORDER BY created_at ASC, id ASC"
    : "SELECT id, status FROM tasks WHERE room_id = ? AND source_run_id = ? AND parent_task_id IS NULL AND expects_review = 1 ORDER BY created_at ASC, id ASC";
  const rows = database.sqlite.prepare(sql).all(roomId, scope.value) as Array<{ readonly id: string; readonly status: string }>;
  let pendingCount = 0;
  let blockedCount = 0;
  for (const row of rows) {
    if (row.status === "blocked") blockedCount += 1;
    if (row.status === "pending" || row.status === "in_progress") pendingCount += 1;
  }
  return { taskIds: rows.map((row) => row.id), pendingCount, blockedCount };
}

function teamDispatchAllCompleted(database: AgentHubDatabase, roomId: string, scope: TeamDispatchScope): boolean {
  const sql = scope.kind === "parent_task_id"
    ? "SELECT COUNT(*) AS count FROM tasks WHERE room_id = ? AND parent_task_id = ? AND expects_review = 1 AND status != 'completed'"
    : "SELECT COUNT(*) AS count FROM tasks WHERE room_id = ? AND source_run_id = ? AND parent_task_id IS NULL AND expects_review = 1 AND status != 'completed'";
  return ((database.sqlite.prepare(sql).get(roomId, scope.value) as { readonly count: number }).count ?? 0) === 0;
}

function teamDispatchEventCount(database: AgentHubDatabase, roomId: string, type: "team.dispatch.started" | "team.dispatch.completed", scope: TeamDispatchScope): number {
  const row = database.sqlite.prepare(
    `SELECT COUNT(*) AS count
     FROM events
     WHERE room_id = ?
       AND type = ?
       AND json_extract(payload, '$.sourceRunId') = ?`
  ).get(roomId, type, scope.value) as { readonly count: number };
  return row.count;
}

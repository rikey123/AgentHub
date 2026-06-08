import { randomUUID } from "node:crypto";

import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

import { TaskService, type TaskRow, type TeamDispatchScope } from "./task-service.ts";
import type { TaskModeGroupChatPresenter } from "./task-mode-group-chat-presenter.ts";

type TeamDispatchRuntime = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly commandBus?: unknown;
  readonly taskService: TaskService;
  readonly taskModeGroupChatPresenter?: TaskModeGroupChatPresenter;
  readonly now?: () => number;
};

export async function handleTeamDispatchReviewTerminal(runtime: TeamDispatchRuntime, runId: string): Promise<void> {
  const run = runtime.database.sqlite.prepare("SELECT id, workspace_id, room_id, agent_id, task_id, status FROM runs WHERE id = ?").get(runId) as { readonly id: string; readonly workspace_id: string; readonly room_id: string; readonly agent_id: string; readonly task_id: string | null; readonly status: string } | undefined;
  if (run === undefined || run.task_id === null) return;
  if (run.room_id === null) return;

  const task = runtime.database.sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(run.task_id) as TaskRow | undefined;
  if (task === undefined || task.expects_review === 0) return;
  if (task.room_id === null) return;
  const roomId = task.room_id;

  const scope = taskDispatchScope(task);
  if (scope === undefined) return;

  const siblingState = teamDispatchSiblingState(runtime.database, roomId, scope);
  if (siblingState.taskIds.length === 0) return;

  const alreadyStarted = teamDispatchEventCount(runtime.database, roomId, "team.dispatch.started", scope) > 0;
  if (alreadyStarted) return;

  if (siblingState.pendingCount > 0) return;

  const room = runtime.database.sqlite.prepare("SELECT workspace_id, primary_agent_id FROM rooms WHERE id = ?").get(roomId) as { readonly workspace_id: string; readonly primary_agent_id: string | null } | undefined;
  if (room === undefined || room.primary_agent_id === null) return;
  const leaderAgentId = room.primary_agent_id;

  const wakeReason = siblingState.blockedCount > 0 ? "task_blocked" : "task_review";
  const prompt = wakeReason === "task_blocked"
    ? `A delegated task is blocked: ${siblingState.taskIds.join(", ")}`
    : `All delegated tasks are ready for review: ${siblingState.taskIds.join(", ")}`;
  void prompt;
  const leaderRunId = `wake-outbox:${scope.kind}:${scope.value}:${wakeReason}`;

  const dispatchId = `team-dispatch:${scope.kind}:${scope.value}`;
  const createdAt = runtime.now?.() ?? Date.now();
  runtime.database.sqlite.transaction(() => {
    runtime.eventBus.publish({
      id: randomUUID(),
      type: "team.dispatch.started",
      schemaVersion: 1,
      workspaceId: room.workspace_id,
      roomId,
      runId: leaderRunId,
      agentId: leaderAgentId,
      taskId: task.id,
      payload: { dispatchId, leaderRunId, targetTaskIds: siblingState.taskIds, sourceRunId: scope.value },
      createdAt
    });
    const payload = JSON.stringify({ taskIds: siblingState.taskIds, sourceRunId: scope.value });
    const existing = runtime.database.sqlite
      .prepare("SELECT id FROM wake_outbox WHERE room_id = ? AND agent_id = ? AND reason = ? AND payload = ? AND status IN ('pending', 'dispatching', 'dispatched') LIMIT 1")
      .get(roomId, leaderAgentId, wakeReason, payload);
    if (existing === undefined) {
      runtime.database.sqlite
        .prepare("INSERT INTO wake_outbox (id, room_id, agent_id, reason, payload, status, attempt_count, max_attempts, created_at, dispatch_after) VALUES (?, ?, ?, ?, ?, 'pending', 0, 3, ?, NULL)")
        .run(randomUUID(), roomId, leaderAgentId, wakeReason, payload, createdAt);
    }
    if (wakeReason === "task_blocked") {
      const blocked = blockedTask(runtime.database, roomId, scope) ?? (task.status === "blocked" ? task : undefined);
      const reason = blocked !== undefined ? taskBlockReason(runtime.database, blocked) : undefined;
      publishSystemCoordinationMessage(runtime, {
        workspaceId: room.workspace_id,
        roomId,
        agentId: leaderAgentId,
        runId: leaderRunId,
        taskId: blocked?.id ?? task.id,
        text: `A delegated task failed or blocked. Reason: ${reason ?? "unknown"}. Degrade: leader review requested.`,
        createdAt
      });
    }
  })();
  runtime.taskModeGroupChatPresenter?.publishTeamReviewStarted({
    roomId,
    leaderAgentId,
    taskIds: siblingState.taskIds,
    runId: leaderRunId
  });
}

export function maybePublishTeamDispatchCompleted(runtime: Pick<TeamDispatchRuntime, "database" | "eventBus" | "taskModeGroupChatPresenter" | "now">, task: TaskRow): void {
  if (!isAggregateTerminal(task.status) || task.expects_review === 0) return;
  const scope = taskDispatchScope(task);
  if (scope === undefined) return;
  if (task.room_id === null) return;
  const roomId = task.room_id;

  const taskIds = teamDispatchTaskIds(runtime.database, roomId, scope);
  if (taskIds.length === 0) return;
  const terminalState = teamDispatchTerminalState(runtime.database, roomId, scope);
  if (terminalState.allTerminal === false) return;
  if (teamDispatchEventCount(runtime.database, roomId, "team.dispatch.completed", scope) > 0) return;

  const room = runtime.database.sqlite.prepare("SELECT workspace_id, primary_agent_id FROM rooms WHERE id = ?").get(roomId) as { readonly workspace_id: string; readonly primary_agent_id: string | null } | undefined;
  if (room === undefined || room.primary_agent_id === null) return;
  const leaderAgentId = room.primary_agent_id;

  const dispatchId = `team-dispatch:${scope.kind}:${scope.value}`;
  const createdAt = runtime.now?.() ?? Date.now();
  runtime.database.sqlite.transaction(() => {
    runtime.eventBus.publish({
      id: randomUUID(),
      type: "team.dispatch.completed",
      schemaVersion: 1,
      workspaceId: room.workspace_id,
      roomId,
      runId: task.source_run_id ?? scope.value,
      agentId: leaderAgentId,
      taskId: task.id,
      payload: { dispatchId, leaderRunId: task.source_run_id ?? scope.value, taskIds, sourceRunId: scope.value, summary: `All ${taskIds.length} review tasks reached terminal states` },
      createdAt
    });
    const payload = JSON.stringify({ completedTaskIds: terminalState.completedTaskIds, artifactIds: terminalState.artifactIds, blockedTaskIds: terminalState.blockedTaskIds, reviewTaskIds: terminalState.reviewTaskIds, sourceRunId: scope.value });
    const existing = runtime.database.sqlite
      .prepare("SELECT id FROM wake_outbox WHERE room_id = ? AND agent_id = ? AND reason = 'aggregate' AND payload = ? AND status IN ('pending', 'dispatching', 'dispatched') LIMIT 1")
      .get(roomId, leaderAgentId, payload);
    if (existing === undefined) {
      runtime.database.sqlite
        .prepare("INSERT INTO wake_outbox (id, room_id, agent_id, reason, payload, status, attempt_count, max_attempts, created_at, dispatch_after) VALUES (?, ?, ?, 'aggregate', ?, 'pending', 0, 3, ?, NULL)")
        .run(randomUUID(), roomId, leaderAgentId, payload, createdAt);
    }
  })();
  runtime.taskModeGroupChatPresenter?.publishTeamReviewCompleted({
    roomId,
    leaderAgentId,
    taskIds,
    runId: task.source_run_id ?? scope.value
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

function teamDispatchTerminalState(database: AgentHubDatabase, roomId: string, scope: TeamDispatchScope): { readonly allTerminal: boolean; readonly completedTaskIds: readonly string[]; readonly blockedTaskIds: readonly string[]; readonly reviewTaskIds: readonly string[]; readonly artifactIds: readonly string[] } {
  const sql = scope.kind === "parent_task_id"
    ? "SELECT id, status FROM tasks WHERE room_id = ? AND parent_task_id = ? AND expects_review = 1 ORDER BY created_at ASC, id ASC"
    : "SELECT id, status FROM tasks WHERE room_id = ? AND source_run_id = ? AND parent_task_id IS NULL AND expects_review = 1 ORDER BY created_at ASC, id ASC";
  const rows = database.sqlite.prepare(sql).all(roomId, scope.value) as Array<{ readonly id: string; readonly status: string }>;
  const completedTaskIds = rows.filter((row) => row.status === "completed").map((row) => row.id);
  const blockedTaskIds = rows.filter((row) => row.status === "blocked").map((row) => row.id);
  const reviewTaskIds = rows.filter((row) => row.status === "review").map((row) => row.id);
  const artifactIds = artifactIdsForTasks(database, rows.map((row) => row.id));
  return { allTerminal: rows.length > 0 && rows.every((row) => isAggregateTerminal(row.status)), completedTaskIds, blockedTaskIds, reviewTaskIds, artifactIds };
}

function isAggregateTerminal(status: string): boolean {
  return status === "completed" || status === "blocked" || status === "review";
}

function artifactIdsForTasks(database: AgentHubDatabase, taskIds: readonly string[]): readonly string[] {
  if (taskIds.length === 0) return [];
  const placeholders = taskIds.map(() => "?").join(",");
  const rows = database.sqlite.prepare(`SELECT DISTINCT id FROM artifacts WHERE task_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY id ASC`).all(...taskIds) as Array<{ readonly id: string }>;
  const ids = new Set(rows.map((row) => row.id));
  const activityRows = database.sqlite
    .prepare(`SELECT payload FROM task_activities WHERE task_id IN (${placeholders}) AND kind = 'comment' ORDER BY created_at ASC, id ASC`)
    .all(...taskIds) as Array<{ readonly payload: string }>;
  for (const row of activityRows) {
    for (const artifactId of artifactIdsFromActivityPayload(row.payload)) ids.add(artifactId);
  }
  return [...ids].sort();
}

function artifactIdsFromActivityPayload(payloadJson: string): readonly string[] {
  try {
    const payload = JSON.parse(payloadJson) as { readonly artifactIds?: unknown };
    if (!Array.isArray(payload.artifactIds)) return [];
    return payload.artifactIds.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

function blockedTask(database: AgentHubDatabase, roomId: string, scope: TeamDispatchScope): TaskRow | undefined {
  const sql = scope.kind === "parent_task_id"
    ? "SELECT * FROM tasks WHERE room_id = ? AND parent_task_id = ? AND expects_review = 1 AND status = 'blocked' ORDER BY updated_at DESC, id DESC LIMIT 1"
    : "SELECT * FROM tasks WHERE room_id = ? AND source_run_id = ? AND parent_task_id IS NULL AND expects_review = 1 AND status = 'blocked' ORDER BY updated_at DESC, id DESC LIMIT 1";
  return database.sqlite.prepare(sql).get(roomId, scope.value) as TaskRow | undefined;
}

function taskBlockReason(database: AgentHubDatabase, task: TaskRow): string | undefined {
  if (task.blocker_reason !== null && task.blocker_reason.trim().length > 0) return task.blocker_reason;
  const row = database.sqlite
    .prepare("SELECT payload FROM events WHERE task_id = ? AND type = 'task.status.changed' ORDER BY seq DESC LIMIT 1")
    .get(task.id) as { readonly payload: string } | undefined;
  if (row === undefined) return undefined;
  try {
    const payload = JSON.parse(row.payload) as { readonly blockerReason?: unknown; readonly reason?: unknown };
    if (typeof payload.blockerReason === "string" && payload.blockerReason.length > 0) return payload.blockerReason;
    if (typeof payload.reason === "string" && payload.reason.length > 0) return payload.reason;
  } catch {
    return undefined;
  }
  return undefined;
}

function publishSystemCoordinationMessage(runtime: Pick<TeamDispatchRuntime, "database" | "eventBus">, input: { readonly workspaceId: string; readonly roomId: string; readonly agentId: string; readonly taskId: string; readonly runId: string; readonly text: string; readonly createdAt: number }): void {
  const messageId = `msg_team_coord_${randomUUID()}`;
  runtime.database.sqlite.prepare("UPDATE rooms SET last_activity_at = ?, updated_at = ? WHERE id = ?").run(input.createdAt, input.createdAt, input.roomId);
  runtime.database.sqlite
    .prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'system', 'team-dispatch', ?, 'system', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)")
    .run(messageId, input.workspaceId, input.roomId, input.runId, input.createdAt, input.createdAt);
  runtime.database.sqlite
    .prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)")
    .run(messageId, JSON.stringify({ text: input.text }), input.createdAt);
  runtime.eventBus.publish({
    id: randomUUID(),
    type: "message.created",
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    roomId: input.roomId,
    runId: input.runId,
    agentId: input.agentId,
    taskId: input.taskId,
    payload: { messageId, senderType: "system", senderId: "team-dispatch", role: "system", status: "completed" },
    createdAt: input.createdAt
  });
  runtime.eventBus.publish({
    id: randomUUID(),
    type: "message.completed",
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    roomId: input.roomId,
    runId: input.runId,
    agentId: input.agentId,
    taskId: input.taskId,
    payload: { messageId, text: input.text },
    createdAt: input.createdAt
  });
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

import type { AgentHubDatabase } from "@agenthub/db";

import { messageText } from "../mailbox-service.ts";

export type MissionBriefEntry = {
  readonly type: "fact" | "decision" | "constraint" | "issue";
  readonly content: string;
};

export type SiblingTask = {
  readonly taskId: string;
  readonly title: string;
  readonly assigneeName: string;
  readonly status: string;
  readonly blockerReason?: string;
};

export type MissionBrief = {
  readonly goal: string;
  readonly roomMode: string;
  readonly leaderName: string;
  readonly myTaskId?: string;
  readonly myTaskTitle?: string;
  readonly siblingTasks: readonly SiblingTask[];
  readonly roomMemory: readonly MissionBriefEntry[];
  readonly activePlan?: string;
};

const MAX_MISSION_BRIEF_CHARS = 800 * 4;
const MAX_ACTIVE_PLAN_CHARS = 300;

type RoomRow = {
  readonly workspace_id: string;
  readonly mode: string;
  readonly primary_agent_id: string | null;
};

type AgentProfileRow = {
  readonly name: string;
};

type GoalContextRow = {
  readonly content: string;
  readonly id: string;
};

type MessageRow = {
  readonly id: string;
};

type TaskRow = {
  readonly title: string;
};

type SiblingTaskRow = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly blockerReason: string | null;
  readonly assigneeName: string;
};

type RoomMemoryRow = {
  readonly type: MissionBriefEntry["type"];
  readonly content: string;
};

type ActivePlanRow = {
  readonly plan_json: string;
};

/**
 * Assemble a teammate MissionBrief from live room state.
 * Returns undefined for non-squad/team rooms.
 */
export function assembleMissionBrief(
  roomId: string,
  agentId: string,
  database: AgentHubDatabase,
  taskId?: string
): MissionBrief | undefined {
  void agentId;
  const room = database.sqlite
    .prepare("SELECT workspace_id, mode, primary_agent_id FROM rooms WHERE id = ?")
    .get(roomId) as RoomRow | undefined;
  if (room === undefined || (room.mode !== "squad" && room.mode !== "team")) return undefined;

  const leaderName = readLeaderName(database, room.primary_agent_id);
  const goal = readGoal(database, roomId, room.workspace_id);
  const myTask = taskId !== undefined ? readTaskTitle(database, taskId) : undefined;
  const siblingTasks = readSiblingTasks(database, roomId);
  const activePlan = readActivePlan(database, roomId);
  const roomMemory = readRoomMemory(database, roomId, goal, room.mode, leaderName, taskId, myTask, siblingTasks, activePlan);

  return {
    goal,
    roomMode: room.mode,
    leaderName,
    ...(taskId !== undefined ? { myTaskId: taskId } : {}),
    ...(myTask !== undefined ? { myTaskTitle: myTask } : {}),
    siblingTasks,
    roomMemory,
    ...(activePlan !== undefined ? { activePlan } : {})
  };
}

/**
 * Render a MissionBrief as a clearly delimited XML block.
 */
export function buildMissionBriefBlock(brief: MissionBrief): string {
  const lines = [
    "<mission-brief>",
    `<goal>${xmlEscape(brief.goal)}</goal>`,
    `<room-mode>${xmlEscape(brief.roomMode)}</room-mode>`,
    `<leader>${xmlEscape(brief.leaderName)}</leader>`
  ];

  if (brief.myTaskId !== undefined) {
    lines.push(`<my-task id="${xmlEscape(brief.myTaskId)}">${xmlEscape(brief.myTaskTitle ?? "")}</my-task>`);
  }

  if (brief.siblingTasks.length > 0) {
    lines.push("<sibling-tasks>");
    for (const task of brief.siblingTasks) {
      const blocker = task.blockerReason !== undefined ? ` blocker="${xmlEscape(task.blockerReason)}"` : "";
      lines.push(
        `<task id="${xmlEscape(task.taskId)}" status="${xmlEscape(task.status)}" assignee="${xmlEscape(task.assigneeName)}"${blocker}>${xmlEscape(task.title)}</task>`
      );
    }
    lines.push("</sibling-tasks>");
  }

  if (brief.roomMemory.length > 0) {
    lines.push("<room-memory>");
    for (const entry of brief.roomMemory) {
      lines.push(`<${entry.type}>${xmlEscape(entry.content)}</${entry.type}>`);
    }
    lines.push("</room-memory>");
  }

  if (brief.activePlan !== undefined) {
    lines.push(`<active-plan>${xmlEscape(brief.activePlan)}</active-plan>`);
  }

  lines.push("</mission-brief>");
  return lines.join("\n");
}

function readLeaderName(database: AgentHubDatabase, primaryAgentId: string | null): string {
  if (primaryAgentId === null) return "Leader";
  const row = database.sqlite.prepare("SELECT name FROM agent_profiles WHERE id = ?").get(primaryAgentId) as AgentProfileRow | undefined;
  return row?.name ?? primaryAgentId;
}

function readGoal(database: AgentHubDatabase, roomId: string, workspaceId: string): string {
  const pinned = database.sqlite.prepare(
    `SELECT id
            , content
     FROM context_items
     WHERE workspace_id = ?
       AND scope = 'workspace'
       AND status = 'confirmed'
       AND content LIKE 'Goal:%'
     ORDER BY updated_at DESC
     LIMIT 1`
  ).get(workspaceId) as GoalContextRow | undefined;
  if (pinned !== undefined) {
    if (pinned.content.trim().length > 0) return pinned.content;
  }

  const firstUserMessage = database.sqlite.prepare(
    `SELECT id
     FROM messages
     WHERE room_id = ?
       AND role = 'user'
       AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT 1`
  ).get(roomId) as MessageRow | undefined;
  if (firstUserMessage !== undefined) {
    const text = messageText(database.sqlite, firstUserMessage.id);
    if (text !== undefined && text.trim().length > 0) return text;
  }

  return "No explicit goal set for this room.";
}

function readTaskTitle(database: AgentHubDatabase, taskId: string): string | undefined {
  const row = database.sqlite.prepare("SELECT title FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
  return row?.title;
}

function readSiblingTasks(database: AgentHubDatabase, roomId: string): readonly SiblingTask[] {
  const rows = database.sqlite.prepare(
    `SELECT t.id, t.title, t.status, t.blocker_reason AS blockerReason,
            COALESCE(ap.name, r.name, t.assignee_agent_id, t.assignee_role_id, 'unassigned') AS assigneeName
     FROM tasks t
     LEFT JOIN agent_profiles ap ON ap.id = t.assignee_agent_id
     LEFT JOIN roles r ON r.id = t.assignee_role_id
     WHERE t.room_id = ?
       AND t.status NOT IN ('cancelled', 'completed')
     ORDER BY t.updated_at DESC, t.id DESC
     LIMIT 10`
  ).all(roomId) as SiblingTaskRow[];

  return rows.map((row) => ({
    taskId: row.id,
    title: row.title,
    assigneeName: row.assigneeName,
    status: row.status,
    ...(row.blockerReason !== null ? { blockerReason: row.blockerReason } : {})
  }));
}

function readRoomMemory(
  database: AgentHubDatabase,
  roomId: string,
  goal: string,
  roomMode: string,
  leaderName: string,
  taskId: string | undefined,
  myTaskTitle: string | undefined,
  siblingTasks: readonly SiblingTask[],
  activePlan: string | undefined
): readonly MissionBriefEntry[] {
  const rows = database.sqlite.prepare(
    `SELECT type, content
     FROM context_items
     WHERE room_id = ?
       AND scope = 'conversation'
       AND status = 'confirmed'
       AND type IN ('fact', 'decision', 'constraint', 'issue')
     ORDER BY updated_at DESC, id DESC`
  ).all(roomId) as RoomMemoryRow[];

  const baseBudget = MAX_MISSION_BRIEF_CHARS - estimateFixedMissionBriefChars(goal, roomMode, leaderName, taskId, myTaskTitle, siblingTasks, activePlan);
  if (baseBudget <= 0 || rows.length === 0) return [];

  const selected: MissionBriefEntry[] = [];
  let usedChars = 0;
  for (const row of rows) {
    const entryChars = estimateSerializedChars(row.type, row.content);
    if (usedChars + entryChars > baseBudget) continue;
    selected.push({ type: row.type, content: row.content });
    usedChars += entryChars;
  }

  return selected;
}

function readActivePlan(database: AgentHubDatabase, roomId: string): string | undefined {
  const row = database.sqlite.prepare(
    `SELECT plan_json
     FROM task_plans
     WHERE room_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  ).get(roomId) as ActivePlanRow | undefined;
  if (row === undefined) return undefined;
  return row.plan_json.slice(0, MAX_ACTIVE_PLAN_CHARS);
}

function estimateFixedMissionBriefChars(
  goal: string,
  roomMode: string,
  leaderName: string,
  taskId: string | undefined,
  myTaskTitle: string | undefined,
  siblingTasks: readonly SiblingTask[],
  activePlan: string | undefined
): number {
  let total = goal.length + roomMode.length + leaderName.length;
  if (taskId !== undefined) total += taskId.length + (myTaskTitle?.length ?? 0);
  for (const task of siblingTasks) {
    total += task.taskId.length + task.title.length + task.assigneeName.length + task.status.length + (task.blockerReason?.length ?? 0);
  }
  if (activePlan !== undefined) total += activePlan.length;
  return total;
}

function estimateSerializedChars(...parts: readonly (string | undefined)[]): number {
  return parts.reduce((total, part) => total + (part?.length ?? 0), 0);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

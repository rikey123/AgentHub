import { randomUUID } from "node:crypto";

import type { EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

type PresenterOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly now?: () => number;
};

type RoomInfo = {
  readonly workspaceId: string;
  readonly mode: string;
  readonly primaryAgentId: string | null;
};

type TaskInfo = {
  readonly title: string;
  readonly assigneeAgentId: string | null;
};

export class TaskModeGroupChatPresenter {
  private lastMessageCreatedAt = 0;

  constructor(private readonly options: PresenterOptions) {}

  publishDelegationCreated(input: {
    readonly roomId: string;
    readonly leaderAgentId: string;
    readonly taskId: string;
    readonly teammateAgentId?: string | null;
    readonly runId?: string;
  }): string | undefined {
    const room = this.taskModeRoom(input.roomId);
    if (room === undefined) return undefined;
    const task = this.task(input.taskId);
    if (task === undefined) return undefined;
    const teammateAgentId = input.teammateAgentId ?? task.assigneeAgentId;
    const teammateName = teammateAgentId !== null && teammateAgentId !== undefined ? this.agentName(teammateAgentId) : "队友";
    return this.publishAgentMessage(messageInput({
      workspaceId: room.workspaceId,
      roomId: input.roomId,
      agentId: input.leaderAgentId,
      runId: input.runId,
      taskId: input.taskId,
      text: `${teammateName}，我把「${task.title}」交给你，先从你的角度推进。`
    }));
  }

  publishTaskStarted(input: {
    readonly roomId: string;
    readonly taskId: string;
    readonly teammateAgentId: string;
    readonly runId?: string;
  }): string | undefined {
    const room = this.taskModeRoom(input.roomId);
    if (room === undefined) return undefined;
    const task = this.task(input.taskId);
    if (task === undefined) return undefined;
    const teammateName = this.agentName(input.teammateAgentId);
    return this.publishAgentMessage(messageInput({
      workspaceId: room.workspaceId,
      roomId: input.roomId,
      agentId: input.teammateAgentId,
      runId: input.runId,
      taskId: input.taskId,
      text: `${teammateName}：我来处理「${task.title}」。`
    }));
  }

  publishTaskOutcome(input: {
    readonly roomId: string;
    readonly taskId: string;
    readonly teammateAgentId: string;
    readonly finalStatus: "completed" | "review" | "blocked" | string;
    readonly summary?: string;
    readonly blockerReason?: string;
    readonly runId?: string;
  }): string | undefined {
    const room = this.taskModeRoom(input.roomId);
    if (room === undefined) return undefined;
    const task = this.task(input.taskId);
    if (task === undefined) return undefined;
    const teammateName = this.agentName(input.teammateAgentId);
    const text = taskOutcomeText({
      teammateName,
      taskTitle: task.title,
      finalStatus: input.finalStatus,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.blockerReason !== undefined ? { blockerReason: input.blockerReason } : {}),
      mode: room.mode
    });
    return this.publishAgentMessage(messageInput({
      workspaceId: room.workspaceId,
      roomId: input.roomId,
      agentId: input.teammateAgentId,
      runId: input.runId,
      taskId: input.taskId,
      text
    }));
  }

  publishTeamReviewStarted(input: {
    readonly roomId: string;
    readonly leaderAgentId?: string | null;
    readonly taskIds: readonly string[];
    readonly runId?: string;
  }): string | undefined {
    const room = this.taskModeRoom(input.roomId);
    if (room === undefined || room.mode !== "team") return undefined;
    const leaderAgentId = input.leaderAgentId ?? room.primaryAgentId;
    if (leaderAgentId === null || leaderAgentId === undefined) return undefined;
    const leaderName = this.agentName(leaderAgentId);
    return this.publishAgentMessage(messageInput({
      workspaceId: room.workspaceId,
      roomId: input.roomId,
      agentId: leaderAgentId,
      runId: input.runId,
      taskId: input.taskIds[0],
      text: `${leaderName}：我开始 review 这 ${input.taskIds.length} 个结果，稍后给你收束。`
    }));
  }

  publishTeamReviewCompleted(input: {
    readonly roomId: string;
    readonly leaderAgentId?: string | null;
    readonly taskIds: readonly string[];
    readonly runId?: string;
  }): string | undefined {
    const room = this.taskModeRoom(input.roomId);
    if (room === undefined || room.mode !== "team") return undefined;
    const leaderAgentId = input.leaderAgentId ?? room.primaryAgentId;
    if (leaderAgentId === null || leaderAgentId === undefined) return undefined;
    const leaderName = this.agentName(leaderAgentId);
    return this.publishAgentMessage(messageInput({
      workspaceId: room.workspaceId,
      roomId: input.roomId,
      agentId: leaderAgentId,
      runId: input.runId,
      taskId: input.taskIds[0],
      text: `${leaderName}：这组任务已经 review 完成，我来给你合并结论。`
    }));
  }

  private taskModeRoom(roomId: string): RoomInfo | undefined {
    const room = this.options.database.sqlite.prepare("SELECT workspace_id AS workspaceId, mode, primary_agent_id AS primaryAgentId FROM rooms WHERE id = ? AND archived_at IS NULL").get(roomId) as RoomInfo | undefined;
    if (room === undefined) return undefined;
    return room.mode === "team" || room.mode === "squad" ? room : undefined;
  }

  private task(taskId: string): TaskInfo | undefined {
    return this.options.database.sqlite.prepare("SELECT title, assignee_agent_id AS assigneeAgentId FROM tasks WHERE id = ?").get(taskId) as TaskInfo | undefined;
  }

  private agentName(agentId: string): string {
    const role = this.options.database.sqlite.prepare("SELECT name FROM agent_profiles WHERE id = ?").get(agentId) as { readonly name: string | null } | undefined;
    return role?.name?.trim() || agentId;
  }

  private publishAgentMessage(input: {
    readonly workspaceId: string;
    readonly roomId: string;
    readonly agentId: string;
    readonly text: string;
    readonly runId?: string;
    readonly taskId?: string;
  }): string {
    const now = this.nextMessageCreatedAt();
    const messageId = `msg_task_chat_${randomUUID()}`;
    this.options.database.sqlite.transaction(() => {
      this.options.database.sqlite
        .prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'agent', ?, ?, 'assistant', 'completed', NULL, 'immediate', NULL, ?, ?, NULL)")
        .run(messageId, input.workspaceId, input.roomId, input.agentId, input.runId ?? null, now, now);
      this.options.database.sqlite
        .prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)")
        .run(messageId, JSON.stringify({ text: input.text }), now);
      this.publishMessageEvent("message.created", input, messageId, { messageId, senderType: "agent", senderId: input.agentId, role: "assistant", status: "completed" }, now);
      this.publishMessageEvent("message.completed", input, messageId, { messageId, text: input.text }, now);
    })();
    return messageId;
  }

  private publishMessageEvent(type: "message.created" | "message.completed", input: { readonly workspaceId: string; readonly roomId: string; readonly agentId: string; readonly runId?: string; readonly taskId?: string }, messageId: string, payload: Record<string, unknown>, createdAt: number): void {
    void messageId;
    this.options.eventBus.publish({
      id: randomUUID(),
      type,
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      roomId: input.roomId,
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      agentId: input.agentId,
      payload,
      createdAt
    } satisfies PublishInput);
  }

  private nextMessageCreatedAt(): number {
    const wallClock = this.options.now?.() ?? Date.now();
    const createdAt = Math.max(wallClock, this.lastMessageCreatedAt + 1);
    this.lastMessageCreatedAt = createdAt;
    return createdAt;
  }
}

function taskOutcomeText(input: {
  readonly teammateName: string;
  readonly taskTitle: string;
  readonly finalStatus: string;
  readonly summary?: string;
  readonly blockerReason?: string;
  readonly mode: string;
}): string {
  const summary = conciseSummary(input.summary);
  if (input.finalStatus === "blocked") {
    const reason = conciseSummary(input.blockerReason) ?? summary ?? "遇到阻塞，需要 leader 看一下。";
    return `${input.teammateName}：「${input.taskTitle}」卡住了。阻塞点：${reason}`;
  }
  if (input.finalStatus === "review") {
    const suffix = summary !== undefined ? `核心结论：${summary}` : "我已经放到 review。";
    return `${input.teammateName}：我完成了「${input.taskTitle}」，先交给 PM review。${suffix}`;
  }
  const statusText = input.mode === "team" ? "我完成了" : "我完成了";
  const suffix = summary !== undefined ? `核心结论：${summary}` : "结果已经写进任务记录。";
  return `${input.teammateName}：${statusText}「${input.taskTitle}」。${suffix}`;
}

function conciseSummary(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (normalized === undefined || normalized.length === 0) return undefined;
  return normalized.length > 80 ? `${normalized.slice(0, 77).trimEnd()}...` : normalized;
}

type MessageInputDraft = {
  readonly workspaceId: string;
  readonly roomId: string;
  readonly agentId: string;
  readonly text: string;
  readonly runId?: string | undefined;
  readonly taskId?: string | undefined;
};

function messageInput(input: MessageInputDraft): {
  readonly workspaceId: string;
  readonly roomId: string;
  readonly agentId: string;
  readonly text: string;
  readonly runId?: string;
  readonly taskId?: string;
} {
  return {
    workspaceId: input.workspaceId,
    roomId: input.roomId,
    agentId: input.agentId,
    text: input.text,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {})
  };
}

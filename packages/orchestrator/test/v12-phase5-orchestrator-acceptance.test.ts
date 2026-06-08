import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { CommandBus, EventBus, type CommandHandler } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { ArtifactService, createArtifactVersioningService } from "@agenthub/artifacts";

import {
  ActiveWakesRegistry,
  MailboxService,
  RoomMcpServer,
  RunLifecycleService,
  TaskModeGroupChatPresenter,
  TaskService,
  createWakeAgentHandler,
  handleTeamDispatchReviewTerminal,
  maybePublishTeamDispatchCompleted
} from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let activeWakes: ActiveWakesRegistry | undefined;
let mailbox: MailboxService | undefined;
let taskService: TaskService | undefined;
let presenter: TaskModeGroupChatPresenter | undefined;
let mcp: RoomMcpServer | undefined;
let now = 1000;

describe("V1.2 Phase 5 orchestrator acceptance evidence", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "agenthub-v12-orchestrator-acceptance-"));
    database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
    eventBus = new EventBus({ database: currentDatabase() });
    activeWakes = new ActiveWakesRegistry(() => now);
    mailbox = new MailboxService(currentDatabase(), () => now);
    lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), {
      now: () => now,
      sideEffects: {
        onRunning: (runId) => transitionTaskFromRun(runId, "start"),
        onCompleted: (runId) => transitionTaskFromRun(runId, "complete"),
        onFailed: (runId) => transitionTaskFromRun(runId, "block")
      }
    });
    presenter = new TaskModeGroupChatPresenter({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    taskService = new TaskService({
      database: currentDatabase(),
      eventBus: currentBus(),
      taskModeGroupChatPresenter: currentPresenter(),
      now: () => now,
      onTaskCompleted: (task) => maybePublishTeamDispatchCompleted({ database: currentDatabase(), eventBus: currentBus(), taskModeGroupChatPresenter: currentPresenter(), now: () => now }, task)
    });
    mcp = new RoomMcpServer({
      commandBus: commandBusWithWakeHandler(),
      taskService: currentTaskService(),
      database: currentDatabase(),
      eventBus: currentBus(),
      taskModeGroupChatPresenter: currentPresenter(),
      artifactService: new ArtifactService({ database: currentDatabase(), eventBus: currentBus(), now: () => now }),
      artifactVersioningService: createArtifactVersioningService({ database: currentDatabase(), eventBus: currentBus(), now: () => now }),
      now: () => now
    });
    seedTeamRoom();
  });

  afterEach(() => {
    currentBus().close();
    currentDatabase().sqlite.close();
    if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    database = undefined;
    eventBus = undefined;
    lifecycle = undefined;
    activeWakes = undefined;
    mailbox = undefined;
    taskService = undefined;
    presenter = undefined;
    mcp = undefined;
    now = 1000;
  });

  test("drives live team dispatch through delegate, publish_artifact, failure downgrade, and aggregate wake", async () => {
    const leaderSession = { roomId: "room_phase5_team", runId: "run_phase5_leader", agentId: "agent_leader" };

    const builder = await currentMcp().callTool("room.delegate", { toRoleId: "role_builder", title: "Build landing page", description: "Create a compact landing page." }, leaderSession);
    const reviewer = await currentMcp().callTool("room.delegate", { toRoleId: "role_reviewer", title: "Review landing page", description: "Check the landing page." }, leaderSession);
    const builderTaskId = taskIdFromToolResult(builder);
    const reviewerTaskId = taskIdFromToolResult(reviewer);

    expect(systemMessages("room_phase5_team").join("\n")).toContain("Build landing page");
    expect(systemMessages("room_phase5_team").join("\n")).toContain("Builder Contact");
    expect(systemMessages("room_phase5_team").join("\n")).toContain("Review landing page");
    expect(systemMessages("room_phase5_team").join("\n")).toContain("Reviewer Contact");
    expect(eventCount("task.delegation.created", "room_phase5_team")).toBe(2);
    expect(runRowsForTasks([builderTaskId, reviewerTaskId])).toEqual(expect.arrayContaining([
      expect.objectContaining({ task_id: builderTaskId, agent_id: "agent_builder", wake_reason: "delegated_task" }),
      expect.objectContaining({ task_id: reviewerTaskId, agent_id: "agent_reviewer", wake_reason: "delegated_task" })
    ]));

    const builderRunId = runIdForTask(builderTaskId);
    currentLifecycle().markClaimed(null, builderRunId);
    currentLifecycle().markStarting(null, builderRunId, 123);
    currentLifecycle().markRunning(null, builderRunId, "session-builder");

    const artifactResult = await currentMcp().callTool("room.publish_artifact", {
      kind: "web_page",
      filename: "phase5-landing.html",
      title: "Phase 5 Landing",
      content: "<main><h1>Phase 5</h1></main>"
    }, { roomId: "room_phase5_team", runId: builderRunId, agentId: "agent_builder" });
    const artifactId = artifactIdFromToolResult(artifactResult);

    await currentMcp().callTool("room.complete_task", {
      taskId: builderTaskId,
      status: "completed",
      summary: `Published the landing page as @artifact:${artifactId}.`,
      artifactIds: [artifactId]
    }, { roomId: "room_phase5_team", runId: builderRunId, agentId: "agent_builder" });

    expect(taskStatus(builderTaskId)).toBe("review");
    expect(shortAgentMessages("room_phase5_team").join("\n")).toContain(`@artifact:${artifactId}`);
    expect(artifactParts("room_phase5_team")).toEqual([expect.objectContaining({ artifactId, kind: "web_page", title: "Phase 5 Landing" })]);
    expect(shortAgentMessages("room_phase5_team").some((message) => message.includes("<main><h1>Phase 5</h1></main>"))).toBe(false);

    const reviewerRunId = runIdForTask(reviewerTaskId);
    currentDatabase().sqlite.prepare("UPDATE runs SET status = 'failed', started_at = ?, ended_at = ?, error = ?, updated_at = ? WHERE id = ?").run(now, now, "runtime timeout", now, reviewerRunId);
    currentTaskService().updateStatus({ taskId: reviewerTaskId, status: "blocked", reason: "runtime_timeout", blockerReason: "runtime timeout" });
    await handleTeamDispatchReviewTerminal({
      database: currentDatabase(),
      eventBus: currentBus(),
      taskService: currentTaskService(),
      taskModeGroupChatPresenter: currentPresenter(),
      now: () => now
    }, reviewerRunId);

    expect(systemMessages("room_phase5_team").join("\n")).toContain("runtime timeout");
    expect(systemMessages("room_phase5_team").join("\n")).toContain("Degrade: leader review requested");
    expect(wakeReasons("room_phase5_team")).toEqual(expect.arrayContaining(["task_review", "task_blocked"]));

    const aggregate = aggregateWakePayload("room_phase5_team");
    expect(aggregate).toMatchObject({
      completedTaskIds: [],
      blockedTaskIds: [reviewerTaskId],
      reviewTaskIds: [builderTaskId],
      artifactIds: [artifactId],
      sourceRunId: "run_phase5_leader"
    });
    expect(artifactTaskId(artifactId)).toBe(builderTaskId);
    expect(taskCompletionArtifactIds(builderTaskId)).toEqual([artifactId]);
    expect(eventCount("team.dispatch.completed", "room_phase5_team")).toBe(1);
    expect(shortAgentMessages("room_phase5_team").join("\n")).toContain("review");
  });
});

function seedTeamRoom(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', ?, ?, ?)").run(tempDir, now, now);
  seedRuntime("runtime_claude", "claude-code");
  seedRuntime("runtime_opencode", "opencode");
  seedRole("role_leader", "Leader Contact");
  seedRole("role_builder", "Builder Contact");
  seedRole("role_reviewer", "Reviewer Contact");
  seedBinding("binding_leader", "role_leader", "runtime_claude", "Leader Contact");
  seedBinding("binding_builder", "role_builder", "runtime_claude", "Builder Contact");
  seedBinding("binding_reviewer", "role_reviewer", "runtime_opencode", "Reviewer Contact");
  seedAgent("agent_leader", "Leader Contact", "mock");
  seedAgent("agent_builder", "Builder Contact", "mock");
  seedAgent("agent_reviewer", "Reviewer Contact", "mock");
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, leader_role_id, archived_at, created_at, updated_at) VALUES ('room_phase5_team', 'ws_1', 'Phase 5 Team', 'team', 'conversation', 'agent_leader', 'role_leader', NULL, ?, ?)").run(now, now);
  seedParticipant("agent_leader", "primary", "binding_leader");
  seedParticipant("agent_builder", "teammate", "binding_builder");
  seedParticipant("agent_reviewer", "teammate", "binding_reviewer");
  currentLifecycle().create(null, {
    runId: "run_phase5_leader",
    workspaceId: "ws_1",
    roomId: "room_phase5_team",
    agentId: "agent_leader",
    wakeReason: "primary_turn",
    messageId: "msg_phase5_user"
  });
}

function seedRuntime(id: string, kind: string): void {
  currentDatabase().sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, 'ws_1', ?, ?, NULL, NULL, NULL, ?, NULL, 'test', '[]', 'test', 'available', '{}', ?, ?)").run(id, kind, `${kind} runtime`, now, now, now);
}

function seedRole(id: string, name: string): void {
  currentDatabase().sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, 'ws_1', ?, NULL, ?, ?, '[]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(id, name, `${name} description`, `${name} prompt`, now, now);
}

function seedBinding(id: string, roleId: string, runtimeId: string, contactName: string): void {
  currentDatabase().sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, contact_name, contact_description, created_at, updated_at) VALUES (?, 'ws_1', ?, ?, NULL, NULL, ?, ?, ?, ?)").run(id, roleId, runtimeId, contactName, `${contactName} description`, now, now);
}

function seedAgent(id: string, name: string, adapterId: string): void {
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, 'ws_1', ?, ?, NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(id, name, adapterId, now, now);
}

function seedParticipant(agentId: string, role: string, bindingId: string): void {
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_phase5_team', ?, 'agent', ?, 'mock', NULL, ?, 'active', ?)").run(agentId, role, bindingId, now);
  currentDatabase().sqlite.prepare("INSERT INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES ('room_phase5_team', ?, 'active', NULL, NULL, ?)").run(agentId, now);
}

function commandBusWithWakeHandler(): CommandBus {
  return new CommandBus({
    database: currentDatabase(),
    handlers: {
      WakeAgent: createWakeAgentHandler({ database: currentDatabase(), activeWakes: currentActiveWakes(), mailbox: currentMailbox(), lifecycle: currentLifecycle() }) as CommandHandler
    }
  });
}

function transitionTaskFromRun(runId: string, kind: "start" | "complete" | "block"): void {
  const row = currentDatabase().sqlite.prepare("SELECT task_id FROM runs WHERE id = ?").get(runId) as { readonly task_id: string | null } | undefined;
  if (row?.task_id === null || row?.task_id === undefined) return;
  if (kind === "start") currentTaskService().startDelegatedRun(row.task_id, runId);
  if (kind === "complete") currentTaskService().completeDelegatedRun(row.task_id, runId);
  if (kind === "block") currentTaskService().blockDelegatedRun(row.task_id, runId);
}

function taskIdFromToolResult(result: Awaited<ReturnType<RoomMcpServer["callTool"]>>): string {
  if (!result.ok || typeof result.data !== "object" || result.data === null || typeof (result.data as { readonly taskId?: unknown }).taskId !== "string") throw new Error("expected taskId");
  return (result.data as { readonly taskId: string }).taskId;
}

function artifactIdFromToolResult(result: Awaited<ReturnType<RoomMcpServer["callTool"]>>): string {
  if (!result.ok || typeof result.data !== "object" || result.data === null || typeof (result.data as { readonly artifactId?: unknown }).artifactId !== "string") throw new Error("expected artifactId");
  return (result.data as { readonly artifactId: string }).artifactId;
}

function runIdForTask(taskId: string): string {
  const row = currentDatabase().sqlite.prepare("SELECT id FROM runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1").get(taskId) as { readonly id: string } | undefined;
  if (row === undefined) throw new Error(`missing run for ${taskId}`);
  return row.id;
}

function runRowsForTasks(taskIds: readonly string[]): readonly unknown[] {
  return currentDatabase().sqlite.prepare(`SELECT id, task_id, agent_id, wake_reason FROM runs WHERE task_id IN (${taskIds.map(() => "?").join(",")}) ORDER BY agent_id ASC`).all(...taskIds);
}

function taskStatus(taskId: string): string {
  return (currentDatabase().sqlite.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { readonly status: string }).status;
}

function systemMessages(roomId: string): string[] {
  return textMessages(roomId, "system");
}

function shortAgentMessages(roomId: string): string[] {
  return textMessages(roomId, "agent");
}

function textMessages(roomId: string, senderType: "agent" | "system"): string[] {
  const rows = currentDatabase().sqlite.prepare(
    `SELECT mp.payload
     FROM messages m
     JOIN message_parts mp ON mp.message_id = m.id
     WHERE m.room_id = ? AND m.sender_type = ? AND mp.part_type = 'text'
     ORDER BY m.created_at ASC, mp.seq ASC`
  ).all(roomId, senderType) as Array<{ readonly payload: string }>;
  return rows.map((row) => JSON.parse(row.payload) as { readonly text: string }).map((payload) => payload.text);
}

function artifactParts(roomId: string): Array<{ readonly artifactId: string; readonly kind: string; readonly title: string }> {
  const rows = currentDatabase().sqlite.prepare(
    `SELECT mp.payload
     FROM messages m
     JOIN message_parts mp ON mp.message_id = m.id
     WHERE m.room_id = ? AND mp.part_type = 'card'
       AND json_extract(mp.payload, '$.card.type') = 'artifact'
     ORDER BY m.created_at ASC, mp.seq ASC`
  ).all(roomId) as Array<{ readonly payload: string }>;
  return rows.map((row) => (JSON.parse(row.payload) as { readonly card: { readonly artifactId: string; readonly kind: string; readonly title: string } }).card);
}

function eventCount(type: string, roomId: string): number {
  return (currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = ? AND room_id = ?").get(type, roomId) as { readonly count: number }).count;
}

function wakeReasons(roomId: string): string[] {
  return (currentDatabase().sqlite.prepare("SELECT reason FROM wake_outbox WHERE room_id = ? ORDER BY created_at ASC, id ASC").all(roomId) as Array<{ readonly reason: string }>).map((row) => row.reason);
}

function aggregateWakePayload(roomId: string): Record<string, unknown> {
  const row = currentDatabase().sqlite.prepare("SELECT payload FROM wake_outbox WHERE room_id = ? AND reason = 'aggregate' ORDER BY created_at DESC LIMIT 1").get(roomId) as { readonly payload: string } | undefined;
  if (row === undefined) throw new Error("missing aggregate wake");
  return JSON.parse(row.payload) as Record<string, unknown>;
}

function taskCompletionArtifactIds(taskId: string): readonly string[] {
  const rows = currentDatabase().sqlite.prepare("SELECT payload FROM task_activities WHERE task_id = ? AND kind = 'comment' ORDER BY created_at ASC").all(taskId) as Array<{ readonly payload: string }>;
  return rows.flatMap((row) => {
    const payload = JSON.parse(row.payload) as { readonly artifactIds?: unknown };
    return Array.isArray(payload.artifactIds) ? payload.artifactIds.filter((item): item is string => typeof item === "string") : [];
  });
}

function artifactTaskId(artifactId: string): string | null {
  const row = currentDatabase().sqlite.prepare("SELECT task_id FROM artifacts WHERE id = ?").get(artifactId) as { readonly task_id: string | null } | undefined;
  if (row === undefined) throw new Error(`missing artifact ${artifactId}`);
  return row.task_id;
}

function currentMcp(): RoomMcpServer {
  expect(mcp).toBeDefined();
  return mcp as RoomMcpServer;
}

function currentTaskService(): TaskService {
  expect(taskService).toBeDefined();
  return taskService as TaskService;
}

function currentPresenter(): TaskModeGroupChatPresenter {
  expect(presenter).toBeDefined();
  return presenter as TaskModeGroupChatPresenter;
}

function currentLifecycle(): RunLifecycleService {
  expect(lifecycle).toBeDefined();
  return lifecycle as RunLifecycleService;
}

function currentActiveWakes(): ActiveWakesRegistry {
  expect(activeWakes).toBeDefined();
  return activeWakes as ActiveWakesRegistry;
}

function currentMailbox(): MailboxService {
  expect(mailbox).toBeDefined();
  return mailbox as MailboxService;
}

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

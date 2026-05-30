import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CommandBus, EventBus, type CommandHandler, type CommandResult } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";

import {
  ActiveWakesRegistry,
  AdapterBridge,
  MailboxService,
  PendingTurnService,
  ReclaimStaleClaimedRun,
  RoomMcpServer,
  RunLifecycleError,
  RunLifecycleService,
  RunQueue,
  TaskService,
  handleTeamDispatchReviewTerminal,
  maybePublishTeamDispatchCompleted,
  reconcileTerminalDelegatedTaskRuns,
  StartupRecovery,
  createCancelRunHandler,
  createCompleteTaskHandler,
  createConsumePendingTurnHandler,
  createCreateTaskHandler,
  createUpdateTaskHandler,
  createWakeAgentHandler,
  parseMentions,
} from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let mailbox: MailboxService | undefined;
let activeWakes: ActiveWakesRegistry | undefined;
let taskService: TaskService | undefined;
let now = 1000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-orchestrator-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  activeWakes = new ActiveWakesRegistry(() => now);
  mailbox = new MailboxService(currentDatabase(), () => now);
  taskService = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), {
    now: () => now,
    sideEffects: {
      onRunning: (runId) => currentTaskTransition(runId, "start"),
      onCompleted: (runId) => currentTaskTransition(runId, "complete"),
      onFailed: (runId) => currentTaskTransition(runId, "block"),
      onTerminal: (runId) => currentActiveWakes().releaseRun(runId),
      finalizeNextTurns: (tx, runId, failureClass, timestamp) => currentMailbox().finalizeForRun(tx, runId, failureClass, timestamp)
    }
  });
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  lifecycle = undefined;
  mailbox = undefined;
  activeWakes = undefined;
  taskService = undefined;
  now = 1000;
  vi.restoreAllMocks();
});

describe("RunLifecycleService", () => {
  test("owns run transitions and writes durable run events in order", () => {
    createRun("run_life", { targetFiles: ["src/a.ts"] });

    currentLifecycle().markClaimed(null, "run_life");
    currentLifecycle().markStarting(null, "run_life", 123);
    currentLifecycle().updateSessionState(null, "run_life", { adapterSessionId: "s_1", workDir: "work/run_life" });
    currentLifecycle().markRunning(null, "run_life", "s_1");
    currentLifecycle().complete(null, "run_life", zeroCost());

    expect(statusOf("run_life")).toBe("completed");
    expect(runEvents("run_life")).toEqual(["agent.run.queued", "agent.run.started", "agent.run.completed"]);
    expect(() => currentLifecycle().markStarting(null, "run_life", 123)).toThrow(RunLifecycleError);
    expect(eventPayload("agent.run.completed", "run_life")).toMatchObject({ cost: zeroCost() });
  });

  test("persists cost fields on run completion", () => {
    const cost = {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 10,
      costUsd: 0.005,
      modelId: "claude-3-5-sonnet"
    };

    createRun("run_cost");
    currentLifecycle().markClaimed(null, "run_cost");
    currentLifecycle().markStarting(null, "run_cost", 123);
    currentLifecycle().markRunning(null, "run_cost", "s_cost");
    currentLifecycle().complete(null, "run_cost", cost);

    expect(currentDatabase().sqlite.prepare("SELECT input_tokens, output_tokens, cached_tokens, cost_usd, model_id FROM runs WHERE id = ?").get("run_cost")).toMatchObject({
      input_tokens: 100,
      output_tokens: 50,
      cached_tokens: 10,
      cost_usd: 0.005,
      model_id: "claude-3-5-sonnet"
    });
  });

  test("emits waiting, waiting_permission, resumed, failed, and rolls back transient mailbox claims", () => {
    seedMailbox("mb_1", "room_1", "agent_1");
    createRun("run_fail", { mailboxClaimIds: ["mb_1"] });
    currentDatabase().sqlite.prepare("UPDATE mailbox_messages SET read = 1, claimed_run_id = ?, claimed_at = ? WHERE id = ?").run("run_fail", now, "mb_1");

    currentLifecycle().markWaiting(null, "run_fail", "agent_lock_held_by:run_other");
    currentLifecycle().markWaiting(null, "run_fail", "agent_lock_held_by:run_other");
    currentLifecycle().markClaimed(null, "run_fail");
    currentLifecycle().markStarting(null, "run_fail", 123);
    currentLifecycle().markRunning(null, "run_fail", "s_1");
    currentLifecycle().markWaitingPermission(null, "run_fail", "perm_1");
    currentLifecycle().markRunning(null, "run_fail", "s_1");
    currentLifecycle().fail(null, "run_fail", "upstream_5xx", "transient");

    expect(runEvents("run_fail")).toEqual([
      "agent.run.queued",
      "agent.run.waiting",
      "agent.run.started",
      "agent.run.waiting_permission",
      "agent.run.resumed",
      "agent.run.failed"
    ]);
    expect(currentDatabase().sqlite.prepare("SELECT read, claimed_run_id, claimed_at, delivery_batch_id FROM mailbox_messages WHERE id = 'mb_1'").get()).toMatchObject({
      read: 0,
      claimed_run_id: null,
      claimed_at: null,
      delivery_batch_id: null
    });
  });

  test("non-retryable failure consumes unhandled next turns", () => {
    createRun("run_perm");
    insertNextTurn("nt_1", "run_perm");

    currentLifecycle().fail(null, "run_perm", "permission denied", "permission_denied");

    expect(statusOf("run_perm")).toBe("failed");
    expect(currentDatabase().sqlite.prepare("SELECT consumed_at FROM run_next_turns WHERE id = 'nt_1'").get()).toMatchObject({ consumed_at: now });
  });

  test("retryable failure reopens adapter-start next turns consumed before the model handles them", () => {
    createRun("run_retry");
    insertNextTurn("nt_retry", "run_retry");

    currentMailbox().readForRun(null, { runId: "run_retry", roomId: "room_1", agentId: "agent_1", deliveryBatchId: "adapter-start:run_retry" });
    expect(currentDatabase().sqlite.prepare("SELECT consumed_at FROM run_next_turns WHERE id = 'nt_retry'").get()).toMatchObject({ consumed_at: now });

    currentLifecycle().fail(null, "run_retry", "upstream_5xx", "transient");

    expect(statusOf("run_retry")).toBe("failed");
    expect(currentDatabase().sqlite.prepare("SELECT consumed_at FROM run_next_turns WHERE id = 'nt_retry'").get()).toMatchObject({ consumed_at: null });
  });

  test("retryable failure keeps explicit read_mailbox next turns consumed", () => {
    createRun("run_explicit_read");
    insertNextTurn("nt_explicit", "run_explicit_read");

    currentMailbox().readForRun(null, { runId: "run_explicit_read", roomId: "room_1", agentId: "agent_1", deliveryBatchId: "tool_call_1" });
    currentLifecycle().fail(null, "run_explicit_read", "visible_retry", "retryable_visible");

    expect(currentDatabase().sqlite.prepare("SELECT consumed_at FROM run_next_turns WHERE id = 'nt_explicit'").get()).toMatchObject({ consumed_at: now });
  });
});

describe("WakeAgent and CancelRun handlers", () => {
  test("rejects zero-input wake and releases activeWake guard", () => {
    const commandBus = commandBusWithHandlers();

    const rejected = commandBus.dispatch(wakeCommand({ promptDelta: { kind: "delta_only", instructions: "   " } }), internalMeta("wake_zero")) as CommandResult;
    const accepted = commandBus.dispatch(wakeCommand({ messageId: "msg_1" }), internalMeta("wake_msg")) as CommandResult;

    expect(rejected).toMatchObject({ ok: false, error: { code: "validation_failed", message: "wake_rejected_zero_input" } });
    expect(accepted).toMatchObject({ ok: true });
    expect(runCount()).toBe(1);
  });

  test("creates queued run through lifecycle, claims mailbox atomically, and command idempotency caches result", () => {
    seedMailbox("mb_1", "room_1", "agent_1");
    const commandBus = commandBusWithHandlers();
    const command = wakeCommand({ idempotencyKey: "idem_wake", promptDelta: { kind: "delta_only", instructions: "review mailbox" } });
    const meta = internalMeta("idem_wake");

    const first = commandBus.dispatch(command, meta) as CommandResult<{ runId: string }>;
    const second = commandBus.dispatch(command, meta) as CommandResult<{ runId: string }>;

    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) throw new Error("expected wake success");
    expect(statusOf(first.data.runId)).toBe("queued");
    expect(runEvents(first.data.runId)).toEqual(["agent.run.queued"]);
    expect(currentDatabase().sqlite.prepare("SELECT read, claimed_run_id FROM mailbox_messages WHERE id = 'mb_1'").get()).toMatchObject({
      read: 1,
      claimed_run_id: first.data.runId
    });
  });

  test("active duplicate wake appends next_turn instead of creating another run", () => {
    const commandBus = commandBusWithHandlers();
    const first = commandBus.dispatch(wakeCommand({ messageId: "msg_1", idempotencyKey: "wake_1" }), internalMeta("wake_1")) as CommandResult<{ runId: string }>;
    if (!first.ok) throw new Error("expected wake success");

    const second = commandBus.dispatch(wakeCommand({ messageId: "msg_2", idempotencyKey: "wake_2" }), internalMeta("wake_2")) as CommandResult;

    expect(second).toMatchObject({ ok: true, data: { appendedToRunId: first.data.runId } });
    expect(runCount()).toBe(1);
    expect(nextTurnCount(first.data.runId)).toBe(1);
  });

  test("CancelRun marks cancelling and synchronously calls adapter cancel", async () => {
    createRun("run_cancel");
    currentLifecycle().markClaimed(null, "run_cancel");
    currentLifecycle().markStarting(null, "run_cancel", 123);
    currentLifecycle().markRunning(null, "run_cancel", "s_1");
    const cancelRun = vi.fn(async (): Promise<void> => undefined);
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { CancelRun: createCancelRunHandler({ lifecycle: currentLifecycle(), adapterManager: { cancelRun } }) } });

    const result = await commandBus.dispatch({ type: "CancelRun", runId: "run_cancel" }, { actor: { type: "user", id: "u_1" }, traceId: "trace", origin: "http" }) as CommandResult;

    expect(result).toMatchObject({ ok: true, data: { status: "cancelling" } });
    expect(statusOf("run_cancel")).toBe("cancelling");
    expect(cancelRun).toHaveBeenCalledWith("run_cancel");
  });

  test("CancelRun swallows adapter cancel rejection and run stays cancelling until adapter drives cancelFinalized", async () => {
    createRun("run_cancel_reject");
    currentLifecycle().markClaimed(null, "run_cancel_reject");
    currentLifecycle().markStarting(null, "run_cancel_reject", 123);
    currentLifecycle().markRunning(null, "run_cancel_reject", "s_1");
    // Adapter cancel rejects — this must not propagate to the caller.
    const cancelRun = vi.fn(async (): Promise<void> => { throw new Error("adapter cancel failed"); });
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { CancelRun: createCancelRunHandler({ lifecycle: currentLifecycle(), adapterManager: { cancelRun } }) } });

    const result = await commandBus.dispatch({ type: "CancelRun", runId: "run_cancel_reject" }, { actor: { type: "user", id: "u_1" }, traceId: "trace_reject", origin: "http" }) as CommandResult;

    // Handler returns success synchronously; adapter cancel error is swallowed.
    expect(result).toMatchObject({ ok: true, data: { status: "cancelling" } });
    expect(statusOf("run_cancel_reject")).toBe("cancelling");

    // Run stays in cancelling until the adapter bridge drives cancelFinalized via session.ended(cancelled).
    const bridge = bridgeFor("run_cancel_reject");
    bridge.handle({ type: "session.ended", sessionId: "s_1", reason: "cancelled", cost: zeroCost() });
    expect(statusOf("run_cancel_reject")).toBe("cancelled");
  });

  test("CancelRun swallows synchronous adapter cancel throw", () => {
    createRun("run_cancel_sync_throw");
    currentLifecycle().markClaimed(null, "run_cancel_sync_throw");
    currentLifecycle().markStarting(null, "run_cancel_sync_throw", 123);
    currentLifecycle().markRunning(null, "run_cancel_sync_throw", "s_1");
    // Adapter cancel throws synchronously — must also be swallowed.
    const cancelRun = vi.fn((): void => { throw new Error("sync adapter cancel failed"); });
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { CancelRun: createCancelRunHandler({ lifecycle: currentLifecycle(), adapterManager: { cancelRun } }) } });

    const result = commandBus.dispatch({ type: "CancelRun", runId: "run_cancel_sync_throw" }, { actor: { type: "user", id: "u_1" }, traceId: "trace_sync_throw", origin: "http" }) as CommandResult;

    expect(result).toMatchObject({ ok: true, data: { status: "cancelling" } });
    expect(statusOf("run_cancel_sync_throw")).toBe("cancelling");
  });

  test("ConsumePendingTurn rejects origin http", () => {
    seedRoom("room_1", "agent_1");
    seedPendingTurn("pt_http", "msg_http");
    const pendingTurns = new PendingTurnService({ database: currentDatabase(), eventBus: currentBus(), getCommandBus: (): CommandBus => commandBus, now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { ConsumePendingTurn: createConsumePendingTurnHandler(pendingTurns) as CommandHandler } });

    const result = commandBus.dispatch({ type: "ConsumePendingTurn", pendingTurnId: "pt_http" }, { actor: { type: "user", id: "u_1" }, traceId: "trace_http", origin: "http" }) as CommandResult;

    expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(pendingTurnStatus("pt_http")).toBe("queued");
  });

  test("ConsumePendingTurn transitions queued to scheduled to consumed and wakes internally", () => {
    seedRoom("room_1", "agent_1");
    seedPendingTurn("pt_1", "msg_pt_1", "consume me");
    const commandBusRef: { current?: CommandBus } = {};
    const pendingTurns = new PendingTurnService({ database: currentDatabase(), eventBus: currentBus(), getCommandBus: (): CommandBus => {
      if (!commandBusRef.current) throw new Error("CommandBus is not initialized");
      return commandBusRef.current;
    }, now: () => now });
    const commandBus = new CommandBus({
      database: currentDatabase(),
      handlers: {
        WakeAgent: createWakeAgentHandler({ database: currentDatabase(), activeWakes: currentActiveWakes(), mailbox: currentMailbox(), lifecycle: currentLifecycle() }) as CommandHandler,
        ConsumePendingTurn: createConsumePendingTurnHandler(pendingTurns) as CommandHandler
      }
    });
    commandBusRef.current = commandBus;

    const result = commandBus.dispatch({ type: "ConsumePendingTurn", pendingTurnId: "pt_1" }, internalMeta("consume_pt_1")) as CommandResult;

    expect(result).toMatchObject({ ok: true, data: { status: "consumed" } });
    expect(pendingTurnStatus("pt_1")).toBe("consumed");
    expect(eventTypes()).toEqual(expect.arrayContaining(["pending_turn.scheduled", "pending_turn.consumed", "agent.run.queued"]));
    expect(currentDatabase().sqlite.prepare("SELECT wake_reason, room_id, agent_id FROM runs ORDER BY created_at DESC LIMIT 1").get()).toMatchObject({ wake_reason: "consume_pending_turn", room_id: "room_1", agent_id: "agent_1" });
  });
});

describe("PendingTurn terminal hook", () => {
  test("prioritizes unconsumed run_next_turns over queued PendingTurn", () => {
    seedRoom("room_1", "agent_1");
    seedPendingTurn("pt_wait", "msg_wait");
    createRun("run_terminal");
    insertNextTurn("nt_wait", "run_terminal");
    const dispatched: unknown[] = [];
    const commandBus = { dispatch: (command: unknown) => { dispatched.push(command); return { ok: true, data: {}, emittedEvents: [] } satisfies CommandResult; } } as unknown as CommandBus;
    const pendingTurns = new PendingTurnService({ database: currentDatabase(), eventBus: currentBus(), getCommandBus: () => commandBus, now: () => now });

    pendingTurns.handleTerminal("run_terminal");

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ type: "WakeAgent", carryNextTurnIds: ["nt_wait"], sourceRunId: "run_terminal" });
    expect(pendingTurnStatus("pt_wait")).toBe("queued");
  });
});

describe("TaskService and RoomMcpServer", () => {
  test("CreateTask handler persists task and emits task.created plus task.assigned", () => {
    seedRoom("room_1", "agent_1");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { CreateTask: createCreateTaskHandler(service) } });

    const result = commandBus.dispatch({ type: "CreateTask", roomId: "room_1", title: "Implement task chain", assigneeAgentId: "agent_1" }, { actor: { type: "user", id: "local" }, traceId: "trace_task", origin: "http" }) as CommandResult<{ readonly taskId: string }>;

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected task create success");
    expect(currentDatabase().sqlite.prepare("SELECT title, status, assignee_agent_id FROM tasks WHERE id = ?").get(result.data.taskId)).toMatchObject({ title: "Implement task chain", status: "pending", assignee_agent_id: "agent_1" });
    expect(eventTypes()).toEqual(expect.arrayContaining(["task.created", "task.assigned"]));
  });

  test("CreateTask resolves assignee role to bound room participant and keeps compatibility agent id", () => {
    seedRoom("room_1", "agent_1");
    currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_builder', 'ws_1', 'Builder', '', '[]', 0, ?, ?)").run(now, now);
    currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_builder', 'ws_1', 'role_builder', 'runtime_1', NULL, NULL, ?, ?)").run(now, now);
    currentDatabase().sqlite.prepare("UPDATE room_participants SET agent_binding_id = 'binding_builder' WHERE room_id = 'room_1' AND participant_id = 'agent_1'").run();
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const result = service.create({
      roomId: "room_1",
      title: "Role bound task",
      assigneeRoleId: "role_builder",
      expectsReview: true,
      delegationChain: [{ byRoleId: "role_leader", atRunId: "run_1", atTimestamp: now }],
      createdBy: "user"
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected task create success");
    expect(currentDatabase().sqlite.prepare("SELECT assignee_role_id, assignee_binding_id, assignee_agent_id, expects_review, delegation_chain FROM tasks WHERE id = ?").get(result.data.taskId)).toMatchObject({
      assignee_role_id: "role_builder",
      assignee_binding_id: "binding_builder",
      assignee_agent_id: "agent_1",
      expects_review: 1,
      delegation_chain: JSON.stringify([{ byRoleId: "role_leader", atRunId: "run_1", atTimestamp: now }])
    });
    expect(result.data.task).toMatchObject({
      assigneeRoleId: "role_builder",
      assigneeBindingId: "binding_builder",
      assigneeAgentId: "agent_1",
      expectsReview: true,
      delegationChain: [{ byRoleId: "role_leader", atRunId: "run_1", atTimestamp: now }]
    });
  });

  test("CreateTask rejects unbound assignee role", () => {
    seedRoom("room_1", "agent_1");
    currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_unbound', 'ws_1', 'Unbound', '', '[]', 0, ?, ?)").run(now, now);
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const result = service.create({ roomId: "room_1", title: "Role missing binding", assigneeRoleId: "role_unbound", createdBy: "user" });

    expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE title = 'Role missing binding'").get()).toMatchObject({ count: 0 });
  });

  test("CompleteTask rejects terminal and inactive task states", () => {
    seedRoom("room_1", "agent_1");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { CreateTask: createCreateTaskHandler(service), UpdateTask: createUpdateTaskHandler(service), CompleteTask: createCompleteTaskHandler(service) } });
    const created = commandBus.dispatch({ type: "CreateTask", roomId: "room_1", title: "Complete me", assigneeAgentId: "agent_1" }, { actor: { type: "user", id: "local" }, traceId: "trace_create", origin: "http" }) as CommandResult<{ readonly taskId: string }>;
    if (!created.ok) throw new Error("expected task create success");
    const rejectedEvents: unknown[] = [];
    const unsubscribe = currentBus().subscribe("task.status.changed.rejected", (event) => {
      rejectedEvents.push(event);
    });

    const inactive = commandBus.dispatch({ type: "CompleteTask", taskId: created.data.taskId }, { actor: { type: "user", id: "local" }, traceId: "trace_complete_pending", origin: "http" }) as CommandResult;
    expect(inactive).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(rejectedEvents).toHaveLength(1);
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'task.status.changed.rejected'").get()).toBeUndefined();
    unsubscribe();

    expect(commandBus.dispatch({ type: "UpdateTask", taskId: created.data.taskId, status: "in_progress" }, { actor: { type: "user", id: "local" }, traceId: "trace_progress", origin: "http" })).toMatchObject({ ok: true });
    expect(commandBus.dispatch({ type: "CompleteTask", taskId: created.data.taskId }, { actor: { type: "user", id: "local" }, traceId: "trace_complete", origin: "http" })).toMatchObject({ ok: true });
    const terminal = commandBus.dispatch({ type: "CompleteTask", taskId: created.data.taskId }, { actor: { type: "user", id: "local" }, traceId: "trace_complete_again", origin: "http" }) as CommandResult;
    expect(terminal).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("room MCP task tools create, update, list by current room, and reject unknown tools", async () => {
    seedRoom("room_1", "agent_1");
    seedRoom("room_2", "agent_2");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { CreateTask: createCreateTaskHandler(service), UpdateTask: createUpdateTaskHandler(service) } });
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const rejectedEvents: unknown[] = [];
    const unsubscribe = currentBus().subscribe("task.status.changed.rejected", (event) => {
      rejectedEvents.push(event);
    });

    const created = await mcp.callTool("room.create_task", { title: "MCP task", assigneeAgentId: "agent_1" }, { roomId: "room_1", runId: "run_1", agentId: "agent_1" });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok || !isRecord(created.data) || typeof created.data.taskId !== "string") throw new Error("expected task id");
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, status: "done" }, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(currentDatabase().sqlite.prepare("SELECT status FROM tasks WHERE id = ?").get(created.data.taskId)).toMatchObject({ status: "pending" });
    expect(rejectedEvents).toHaveLength(1);
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'task.status.changed.rejected'").get()).toBeUndefined();
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, status: "in_progress" }, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: true });
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, status: "done" }, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: true });
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, addComment: "Found a blocker" }, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: true });
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, setBlocker: "Waiting on API contract" }, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: true });
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, linkArtifact: "artifact_1" }, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: true });
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, priority: 3 }, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: true });
    service.create({ roomId: "room_2", title: "Other room", createdBy: "user", assigneeAgentId: "agent_2" });

    const listed = await mcp.callTool("room.list_tasks", {}, { roomId: "room_1", runId: "run_1", agentId: "agent_1" });
    expect(listed).toMatchObject({ ok: true });
    if (!listed.ok || !isRecord(listed.data) || !Array.isArray(listed.data.tasks)) throw new Error("expected task list");
    expect(listed.data.tasks).toHaveLength(1);
    expect(listed.data.tasks[0]).toMatchObject({ title: "MCP task", status: "completed" });
    const activities = currentDatabase().sqlite.prepare("SELECT kind, by_kind, by, payload FROM task_activities WHERE task_id = ?").all(created.data.taskId) as Array<{ readonly kind: string; readonly by_kind: string; readonly by: string; readonly payload: string | null }>;
    expect(activities.map((activity) => activity.kind).sort()).toEqual(["artifact_linked", "blocker_set", "comment", "priority_change"]);
    expect(activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "comment", by_kind: "user", by: "agent_1", payload: JSON.stringify({ text: "Found a blocker" }) }),
      expect.objectContaining({ kind: "blocker_set", by_kind: "user", by: "agent_1", payload: JSON.stringify({ text: "Waiting on API contract" }) }),
      expect.objectContaining({ kind: "artifact_linked", by_kind: "user", by: "agent_1", payload: JSON.stringify({ artifactId: "artifact_1" }) }),
      expect.objectContaining({ kind: "priority_change", by_kind: "user", by: "agent_1", payload: JSON.stringify({ priority: "3" }) })
    ]));
    expect(eventTypes()).toEqual(expect.arrayContaining(["task.activity.added", "task.status.changed"]));
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'task.deleted'").get()).toBeUndefined();
    expect(await mcp.callTool("unknown_tool", {}, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: false, error: { code: "tool_not_found" } });
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, status: "in_progress" }, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: false, error: { code: "conflict" } });
    unsubscribe();
  });

  test("room.delegate creates task, wakes teammate, and emits delegation atomically for a leader", async () => {
    seedDelegatedRoom("room_delegate", "agent_leader", "role_leader", "role_builder", "binding_leader", "binding_builder", "agent_builder");
    createRun("run_delegate", { roomId: "room_delegate", agentId: "agent_leader" });
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = commandBusWithHandlers();
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const result = await mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Implement login", description: "Add the login flow", expectsReview: true }, { roomId: "room_delegate", runId: "run_delegate", agentId: "agent_leader" });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok || !isRecord(result.data) || typeof result.data.taskId !== "string" || typeof result.data.runId !== "string") throw new Error("expected delegate success");
    expect(currentDatabase().sqlite.prepare("SELECT title, status, assignee_role_id, assignee_binding_id, assignee_agent_id, expects_review, source_run_id FROM tasks WHERE id = ?").get(result.data.taskId)).toMatchObject({
      title: "Implement login",
      status: "pending",
      assignee_role_id: "role_builder",
      assignee_binding_id: "binding_builder",
      assignee_agent_id: "agent_builder",
      expects_review: 1,
      source_run_id: "run_delegate"
    });
    expect(currentDatabase().sqlite.prepare("SELECT task_id, wake_reason FROM runs WHERE id = ?").get(result.data.runId)).toMatchObject({ task_id: result.data.taskId, wake_reason: "delegated_task" });
    expect(eventTypes()).toEqual(expect.arrayContaining(["task.created", "task.delegation.created", "agent.run.queued"]));
    expect(currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = 'task.delegation.created' AND task_id = ?").get(result.data.taskId)).toMatchObject({
      payload: JSON.stringify({ taskId: result.data.taskId, delegationId: result.data.taskId, runId: result.data.runId, byRoleId: "role_leader", atRunId: "run_delegate", expectsReview: true })
    });
  });

  test("room.delegate can dispatch an existing pending backlog task", async () => {
    seedDelegatedRoom("room_delegate_existing", "agent_leader", "role_leader", "role_builder", "binding_leader", "binding_builder", "agent_builder");
    createRun("run_delegate_existing", { roomId: "room_delegate_existing", agentId: "agent_leader" });
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const created = service.create({ roomId: "room_delegate_existing", title: "Backlog implementation", description: "Build the queued item", assigneeRoleId: "role_builder", createdBy: "agent_leader" });
    if (!created.ok) throw new Error("expected backlog task");
    const commandBus = commandBusWithHandlers();
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const result = await mcp.callTool("room.delegate", { taskId: created.data.taskId }, { roomId: "room_delegate_existing", runId: "run_delegate_existing", agentId: "agent_leader" });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok || !isRecord(result.data) || typeof result.data.runId !== "string") throw new Error("expected delegate success");
    expect(result.data).toMatchObject({ taskId: created.data.taskId });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE room_id = 'room_delegate_existing'").get()).toMatchObject({ count: 1 });
    expect(currentDatabase().sqlite.prepare("SELECT task_id, agent_id, wake_reason FROM runs WHERE id = ?").get(result.data.runId)).toMatchObject({ task_id: created.data.taskId, agent_id: "agent_builder", wake_reason: "delegated_task" });
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'task.delegation.created' AND task_id = ?").get(created.data.taskId)).toBeDefined();
  });

  test("room.delegate backfills role and binding when dispatching legacy backlog tasks", async () => {
    seedDelegatedRoom("room_delegate_legacy", "agent_leader", "role_leader", "role_builder", "binding_leader", "binding_builder", "agent_builder");
    createRun("run_delegate_legacy", { roomId: "room_delegate_legacy", agentId: "agent_leader" });
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const created = service.create({ roomId: "room_delegate_legacy", title: "Legacy backlog", description: "Created with the V0.5 assignee field", assigneeAgentId: "agent_builder", createdBy: "agent_leader" });
    if (!created.ok) throw new Error("expected legacy backlog task");
    expect(currentDatabase().sqlite.prepare("SELECT assignee_role_id, assignee_binding_id FROM tasks WHERE id = ?").get(created.data.taskId)).toMatchObject({ assignee_role_id: null, assignee_binding_id: null });
    const mcp = new RoomMcpServer({ commandBus: commandBusWithHandlers(), taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const result = await mcp.callTool("room.delegate", { taskId: created.data.taskId }, { roomId: "room_delegate_legacy", runId: "run_delegate_legacy", agentId: "agent_leader" });

    expect(result).toMatchObject({ ok: true });
    expect(currentDatabase().sqlite.prepare("SELECT assignee_role_id, assignee_binding_id FROM tasks WHERE id = ?").get(created.data.taskId)).toMatchObject({ assignee_role_id: "role_builder", assignee_binding_id: "binding_builder" });
  });

  test("squad mode queues three teammate delegates without active wake conflicts", async () => {
    seedSquadRoomWithTeammates("room_squad_parallel", [
      { roleId: "role_builder_a", bindingId: "binding_builder_a", agentId: "agent_builder_a" },
      { roleId: "role_builder_b", bindingId: "binding_builder_b", agentId: "agent_builder_b" },
      { roleId: "role_builder_c", bindingId: "binding_builder_c", agentId: "agent_builder_c" }
    ]);
    createRun("run_squad_leader", { roomId: "room_squad_parallel", agentId: "agent_leader" });
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = commandBusWithHandlers();
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const leaderSession = { roomId: "room_squad_parallel", runId: "run_squad_leader", agentId: "agent_leader" };

    const results = await Promise.all([
      mcp.callTool("room.delegate", { toRoleId: "role_builder_a", title: "Parallel A" }, leaderSession),
      mcp.callTool("room.delegate", { toRoleId: "role_builder_b", title: "Parallel B" }, leaderSession),
      mcp.callTool("room.delegate", { toRoleId: "role_builder_c", title: "Parallel C" }, leaderSession)
    ]);

    expect(results).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
    const runIds = results.map((result) => {
      if (!result.ok || !isRecord(result.data) || typeof result.data.runId !== "string") throw new Error("expected delegated run id");
      return result.data.runId;
    });
    expect(new Set(runIds)).toHaveProperty("size", 3);
    expect(
      currentDatabase().sqlite
        .prepare("SELECT agent_id, status, wake_reason, task_id FROM runs WHERE id IN (?, ?, ?) ORDER BY agent_id ASC")
        .all(...runIds)
    ).toEqual([
      expect.objectContaining({ agent_id: "agent_builder_a", status: "queued", wake_reason: "delegated_task" }),
      expect.objectContaining({ agent_id: "agent_builder_b", status: "queued", wake_reason: "delegated_task" }),
      expect.objectContaining({ agent_id: "agent_builder_c", status: "queued", wake_reason: "delegated_task" })
    ]);
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM run_next_turns WHERE run_id IN (?, ?, ?)").get(...runIds)).toMatchObject({ count: 0 });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'task.delegation.created' AND room_id = 'room_squad_parallel'").get()).toMatchObject({ count: 3 });
  });

  test("team mode wakes leader only after every sibling task is in review", async () => {
    seedDelegatedRoom("room_team_review", "agent_leader", "role_leader", "role_builder", "binding_leader", "binding_builder", "agent_builder");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const dispatched: Array<{ readonly reason: string; readonly taskId: string; readonly idempotencyKey: string }> = [];
    const commandBus = { dispatch: (command: { readonly reason: string; readonly taskId: string; readonly idempotencyKey: string }) => { dispatched.push(command); return { ok: true, data: { runId: `leader-${dispatched.length}` }, emittedEvents: [] }; } } as unknown as CommandBus;
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const leaderSession = { roomId: "room_team_review", runId: "run_team_leader", agentId: "agent_leader" };

    const created1 = await mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Task 1", expectsReview: true }, leaderSession);
    const created2 = await mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Task 2", expectsReview: true }, leaderSession);
    if (!created1.ok || !created2.ok || !isRecord(created1.data) || !isRecord(created2.data) || typeof created1.data.taskId !== "string" || typeof created2.data.taskId !== "string") throw new Error("expected delegated tasks");
    insertTerminalRun(created1.data.taskId, "run_review_1", "completed");
    expect(service.review(created1.data.taskId)).toMatchObject({ ok: true });
    await handleTeamDispatchReviewTerminal({ database: currentDatabase(), eventBus: currentBus(), commandBus, taskService: service, now: () => now }, "run_review_1");
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'team.dispatch.started' AND json_extract(payload, '$.sourceRunId') = ?").get("run_team_leader")).toMatchObject({ count: 0 });
    insertTerminalRun(created2.data.taskId, "run_review_2", "completed");
    expect(service.review(created2.data.taskId)).toMatchObject({ ok: true });
    await handleTeamDispatchReviewTerminal({ database: currentDatabase(), eventBus: currentBus(), commandBus, taskService: service, now: () => now }, "run_review_2");
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'team.dispatch.started' AND json_extract(payload, '$.sourceRunId') = ?").get("run_team_leader")).toMatchObject({ count: 1 });
    await handleTeamDispatchReviewTerminal({ database: currentDatabase(), eventBus: currentBus(), commandBus, taskService: service, now: () => now }, "run_review_2");
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'team.dispatch.started' AND json_extract(payload, '$.sourceRunId') = ?").get("run_team_leader")).toMatchObject({ count: 1 });
    const leaderWakes = dispatched.filter((command) => command.reason === "task_review");
    expect(leaderWakes).toHaveLength(1);
    expect(leaderWakes[0]).toMatchObject({ taskId: created2.data.taskId });
  });

  test("team mode forces delegated tasks into review even if the model asks to skip review", async () => {
    seedDelegatedRoom("room_team_force_review", "agent_leader", "role_leader", "role_builder", "binding_leader", "binding_builder", "agent_builder");
    currentDatabase().sqlite.prepare("UPDATE rooms SET mode = 'team' WHERE id = 'room_team_force_review'").run();
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = commandBusWithHandlers();
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const leaderSession = { roomId: "room_team_force_review", runId: "run_team_force_review", agentId: "agent_leader" };

    const created = await mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Must review", expectsReview: false }, leaderSession);

    expect(created).toMatchObject({ ok: true });
    if (!created.ok || !isRecord(created.data) || typeof created.data.taskId !== "string") throw new Error("expected delegated task");
    expect(currentDatabase().sqlite.prepare("SELECT expects_review FROM tasks WHERE id = ?").get(created.data.taskId)).toMatchObject({ expects_review: 1 });
    const event = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = 'task.delegation.created' AND task_id = ? ORDER BY seq DESC LIMIT 1").get(created.data.taskId) as { readonly payload: string };
    expect(JSON.parse(event.payload)).toMatchObject({ expectsReview: true });
  });

  test("leader approval of review task emits team.dispatch.completed after all siblings complete", async () => {
    seedDelegatedRoom("room_team_approve", "agent_leader", "role_leader", "role_builder", "binding_leader", "binding_builder", "agent_builder");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now, onTaskCompleted: (task) => maybePublishTeamDispatchCompleted({ database: currentDatabase(), eventBus: currentBus(), now: () => now }, task) });
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { WakeAgent: createWakeAgentHandler({ database: currentDatabase(), activeWakes: currentActiveWakes(), mailbox: currentMailbox(), lifecycle: currentLifecycle() }) as CommandHandler, UpdateTask: createUpdateTaskHandler(service), CompleteTask: createCompleteTaskHandler(service) } });
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const leaderSession = { roomId: "room_team_approve", runId: "run_team_review_leader", agentId: "agent_leader" };

    const created = await mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Review me", expectsReview: true }, leaderSession);
    if (!created.ok || !isRecord(created.data) || typeof created.data.taskId !== "string") throw new Error("expected delegated task");

    expect(service.review(created.data.taskId)).toMatchObject({ ok: true });
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, status: "completed" }, leaderSession)).toMatchObject({ ok: true });
    expect(currentDatabase().sqlite.prepare("SELECT status FROM tasks WHERE id = ?").get(created.data.taskId)).toMatchObject({ status: "completed" });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'team.dispatch.completed' AND json_extract(payload, '$.sourceRunId') = ?").get("run_team_review_leader")).toMatchObject({ count: 1 });
  });

  test("team mode wakes leader with task_blocked when a sibling run fails", async () => {
    seedDelegatedRoom("room_team_blocked", "agent_leader", "role_leader", "role_builder", "binding_leader", "binding_builder", "agent_builder");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const dispatched: Array<{ readonly reason: string; readonly taskId: string; readonly idempotencyKey: string }> = [];
    const commandBus = { dispatch: (command: { readonly reason: string; readonly taskId: string; readonly idempotencyKey: string }) => { dispatched.push(command); return { ok: true, data: { runId: `leader-${dispatched.length}` }, emittedEvents: [] }; } } as unknown as CommandBus;
    const leaderSession = { roomId: "room_team_blocked", runId: "run_team_blocked", agentId: "agent_leader" };
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const [task1Result, task2Result] = await Promise.all([
      mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Blocked 1", expectsReview: true }, leaderSession),
      mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Blocked 2", expectsReview: true }, leaderSession)
    ]);
    if (!task1Result.ok || !task2Result.ok || !isRecord(task1Result.data) || !isRecord(task2Result.data) || typeof task1Result.data.taskId !== "string" || typeof task2Result.data.taskId !== "string") {
      throw new Error("expected delegated tasks");
    }
    insertTerminalRun(task1Result.data.taskId, "run_blocked_1", "failed");
    insertTerminalRun(task2Result.data.taskId, "run_blocked_2", "completed");
    expect(service.review(task2Result.data.taskId)).toMatchObject({ ok: true });
    expect(service.updateStatus({ taskId: task1Result.data.taskId, status: "blocked", reason: "timeout" })).toMatchObject({ ok: true });
    await handleTeamDispatchReviewTerminal({ database: currentDatabase(), eventBus: currentBus(), commandBus, taskService: service, now: () => now }, "run_blocked_1");

    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'team.dispatch.started' AND json_extract(payload, '$.sourceRunId') = ?").get("run_team_blocked")).toMatchObject({ count: 1 });
    const blockedWakes = dispatched.filter((command) => command.reason === "task_blocked");
    expect(blockedWakes).toHaveLength(1);
    expect(blockedWakes[0]).toMatchObject({ taskId: task1Result.data.taskId });
  });

  test("room.delegate rejects non-leader callers without writes or events", async () => {
    seedDelegatedRoom("room_delegate_denied", "agent_observer", "role_leader", "role_builder", "binding_observer", "binding_builder", "agent_builder");
    currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_observer', 'ws_1', 'Observer', '', '[]', 0, ?, ?)").run(now, now);
    currentDatabase().sqlite.prepare("UPDATE agent_bindings SET role_id = 'role_observer' WHERE id = 'binding_observer'").run();
    createRun("run_delegate_denied", { roomId: "room_delegate_denied", agentId: "agent_observer" });
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = commandBusWithHandlers();
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const result = await mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Should fail" }, { roomId: "room_delegate_denied", runId: "run_delegate_denied", agentId: "agent_observer" });

    expect(result).toMatchObject({ ok: false, error: { code: "delegate_requires_leader_role", message: "delegate_requires_leader_role" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE room_id = 'room_delegate_denied'").get()).toMatchObject({ count: 0 });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = 'room_delegate_denied' AND type LIKE 'task.%'").get()).toMatchObject({ count: 0 });
  });

  test("room.list_members returns role ids for delegate targets", async () => {
    seedDelegatedRoom("room_list_member_roles", "agent_leader", "role_leader", "role_builder", "binding_leader", "binding_builder", "agent_builder");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const mcp = new RoomMcpServer({ commandBus: commandBusWithHandlers(), taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const result = await mcp.callTool("room.list_members", {}, { roomId: "room_list_member_roles", runId: "run_members", agentId: "agent_leader" });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok || !isRecord(result.data) || !Array.isArray(result.data.members)) throw new Error("expected member list");
    expect(result.data.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "agent_builder", roleId: "role_builder", bindingId: "binding_builder" })
    ]));
  });

  test("room.delegate rolls back task and events when WakeAgent enqueue fails", async () => {
    seedDelegatedRoom("room_delegate_fail", "agent_leader", "role_leader", "role_builder", "binding_leader", "binding_builder", "agent_builder");
    createRun("run_delegate_fail", { roomId: "room_delegate_fail", agentId: "agent_leader" });
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = commandBusWithHandlers();
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const wakeSpy = vi.spyOn(mcp as unknown as { dispatchInternal: (...args: readonly unknown[]) => unknown }, "dispatchInternal").mockImplementation(() => ({ ok: false, error: { code: "internal_error", message: "simulated wake failure" } }));

    const result = await mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Rollback me" }, { roomId: "room_delegate_fail", runId: "run_delegate_fail", agentId: "agent_leader" });

    expect(result).toMatchObject({ ok: false, error: { code: "internal_error" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE room_id = 'room_delegate_fail'").get()).toMatchObject({ count: 0 });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = 'room_delegate_fail' AND type IN ('task.created', 'task.assigned', 'task.delegation.created')").get()).toMatchObject({ count: 0 });
    expect(wakeSpy).toHaveBeenCalled();
  });

  test("delegated run completion advances squad task and emits completion event", () => {
    seedDelegatedRoom("room_delegate_terminal", "agent_leader_term", "role_leader_term", "role_builder_term", "binding_leader_term", "binding_builder_term", "agent_builder_term");
    createRun("run_delegate_terminal", { roomId: "room_delegate_terminal", agentId: "agent_builder_term" });
    currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, delegation_chain, title, description, status, assignee_agent_id, assignee_role_id, assignee_binding_id, source_run_id, source_message_id, dependencies, priority, expects_review, due_at, created_by, created_at, updated_at) VALUES (?, 'ws_1', 'room_delegate_terminal', NULL, NULL, 'Terminal task', NULL, 'pending', 'agent_builder_term', 'role_builder_term', 'binding_builder_term', 'run_delegate_terminal', NULL, '[]', NULL, 0, NULL, 'agent_leader_term', ?, ?) ").run("task_delegate_terminal", now, now);
    currentDatabase().sqlite.prepare("UPDATE runs SET task_id = ?, wake_reason = 'delegated_task' WHERE id = ?").run("task_delegate_terminal", "run_delegate_terminal");

    currentDatabase().sqlite.prepare("UPDATE runs SET status = 'claimed', claimed_at = ? WHERE id = ?").run(now, "run_delegate_terminal");
    currentLifecycle().markStarting(null, "run_delegate_terminal", 12345);
    currentLifecycle().markRunning(null, "run_delegate_terminal", "s_delegate_terminal");
    currentLifecycle().complete(null, "run_delegate_terminal", zeroCost());

    expect(currentDatabase().sqlite.prepare("SELECT status, expects_review FROM tasks WHERE id = 'task_delegate_terminal'").get()).toMatchObject({ status: "completed", expects_review: 0 });
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'task.delegation.completed' AND task_id = 'task_delegate_terminal' ORDER BY seq DESC LIMIT 1").get()).toBeDefined();
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM mailbox_messages WHERE room_id = 'room_delegate_terminal' AND to_agent_id = 'agent_leader_term'").get()).toMatchObject({ count: 0 });
  });

  test("delegated run start advances review tasks to in_progress", () => {
    seedDelegatedRoom("room_delegate_review_start", "agent_leader_start", "role_leader_start", "role_builder_start", "binding_leader_start", "binding_builder_start", "agent_builder_start");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const created = service.create({ roomId: "room_delegate_review_start", title: "Review start", assigneeRoleId: "role_builder_start", expectsReview: true, sourceRunId: "run_leader_start", createdBy: "agent_leader_start" });
    if (!created.ok) throw new Error("expected review task");

    expect(service.startDelegatedRun(created.data.taskId, "run_review_start")).toMatchObject({ ok: true });

    expect(currentDatabase().sqlite.prepare("SELECT status, expects_review FROM tasks WHERE id = ?").get(created.data.taskId)).toMatchObject({ status: "in_progress", expects_review: 1 });
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'task.status.changed' AND task_id = ? AND json_extract(payload, '$.nextStatus') = 'in_progress'").get(created.data.taskId)).toBeDefined();
  });

  test("delegated run failure blocks squad task and emits blocked wake mail", () => {
    seedDelegatedRoom("room_delegate_failed", "agent_leader_fail", "role_leader_fail", "role_builder_fail", "binding_leader_fail", "binding_builder_fail", "agent_builder_fail");
    createRun("run_delegate_failed", { roomId: "room_delegate_failed", agentId: "agent_builder_fail" });
    currentDatabase().sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, delegation_chain, title, description, status, assignee_agent_id, assignee_role_id, assignee_binding_id, source_run_id, source_message_id, dependencies, priority, expects_review, due_at, created_by, created_at, updated_at) VALUES (?, 'ws_1', 'room_delegate_failed', NULL, NULL, 'Failed task', NULL, 'pending', 'agent_builder_fail', 'role_builder_fail', 'binding_builder_fail', 'run_delegate_failed', NULL, '[]', NULL, 0, NULL, 'agent_leader_fail', ?, ?) ").run("task_delegate_failed", now, now);
    currentDatabase().sqlite.prepare("UPDATE runs SET task_id = ?, wake_reason = 'delegated_task' WHERE id = ?").run("task_delegate_failed", "run_delegate_failed");

    currentDatabase().sqlite.prepare("UPDATE runs SET status = 'claimed', claimed_at = ? WHERE id = ?").run(now, "run_delegate_failed");
    currentLifecycle().markStarting(null, "run_delegate_failed", 12346);
    currentLifecycle().markRunning(null, "run_delegate_failed", "s_delegate_failed");
    currentLifecycle().fail(null, "run_delegate_failed", "upstream_5xx", "transient");

    expect(currentDatabase().sqlite.prepare("SELECT status FROM tasks WHERE id = 'task_delegate_failed'").get()).toMatchObject({ status: "blocked" });
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'task.status.changed' AND task_id = 'task_delegate_failed' AND json_extract(payload, '$.nextStatus') = 'blocked' ORDER BY seq DESC LIMIT 1").get()).toBeDefined();
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM mailbox_messages WHERE room_id = 'room_delegate_failed' AND to_agent_id = 'agent_leader_fail'").get()).toMatchObject({ count: 0 });
  });

  test("room.delegate rejects duplicate titles and over-depth delegation before writes", async () => {
    seedDelegatedRoom("room_delegate_guard", "agent_leader", "role_leader", "role_builder", "binding_leader", "binding_builder", "agent_builder");
    createRun("run_delegate_guard", { roomId: "room_delegate_guard", agentId: "agent_leader" });
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = commandBusWithHandlers();
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const first = await mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Guarded task", description: "same body" }, { roomId: "room_delegate_guard", runId: "run_delegate_guard", agentId: "agent_leader" });
    expect(first).toMatchObject({ ok: true });

    const duplicate = await mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Guarded task", description: "same body" }, { roomId: "room_delegate_guard", runId: "run_delegate_guard", agentId: "agent_leader" });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "delegation_duplicate" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE room_id = 'room_delegate_guard' AND title = 'Guarded task'").get()).toMatchObject({ count: 1 });

    if (!first.ok || !isRecord(first.data) || typeof first.data.taskId !== "string") throw new Error("expected guarded task id");
    const taskIds = [first.data.taskId];
    for (let depth = 0; depth < 5; depth += 1) {
      const created = service.create({ roomId: "room_delegate_guard", title: `Chain ${depth}`, ...(taskIds[depth] !== undefined ? { parentTaskId: taskIds[depth] } : {}), createdBy: "agent_leader" });
      if (!created.ok) throw new Error("expected chain task create success");
      taskIds.push(created.data.taskId);
    }
    const deep = await mcp.callTool("room.delegate", { toRoleId: "role_builder", title: "Too deep", parentTaskId: taskIds[5], description: "depth test" }, { roomId: "room_delegate_guard", runId: "run_delegate_guard", agentId: "agent_leader" });
    expect(deep).toMatchObject({ ok: false, error: { code: "delegation_too_deep" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE room_id = 'room_delegate_guard' AND title = 'Too deep'").get()).toMatchObject({ count: 0 });
  });

  test("delegation lock timeout uses fake clock and fails stale waiting run after 30 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    createRun("run_wait_fake_clock");
    currentLifecycle().markWaiting(null, "run_wait_fake_clock", "agent_lock_held_by:run_blocker");
    const queue = new RunQueue({ database: currentDatabase(), lifecycle: currentLifecycle(), lockTimeoutMs: 30 * 60 * 1000, now: Date.now });

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    await queue.scheduleTick();

    expect(statusOf("run_wait_fake_clock")).toBe("failed");
    expect(currentLifecycle().read("run_wait_fake_clock")).toMatchObject({ failure_class: "transient", error: "lock_timeout" });
  });

  test("room.read_mailbox atomically consumes current run mailbox and next turns", async () => {
    seedRoom("room_1", "agent_1");
    seedMailbox("mb_read", "room_1", "agent_1");
    createRun("run_read", { roomId: "room_1", agentId: "agent_1" });
    insertNextTurn("nt_read", "run_read");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase() });
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const first = await mcp.callTool("room.read_mailbox", { deliveryBatchId: "batch_read" }, { roomId: "room_1", runId: "run_read", agentId: "agent_1" });
    const second = await mcp.callTool("room.read_mailbox", { deliveryBatchId: "batch_read" }, { roomId: "room_1", runId: "run_read", agentId: "agent_1" });
    const third = await mcp.callTool("room.read_mailbox", { deliveryBatchId: "batch_empty" }, { roomId: "room_1", runId: "run_read", agentId: "agent_1" });

    expect(first).toMatchObject({
      ok: true,
      data: {
        deliveryBatchId: "batch_read",
        mailbox: [{ id: "mb_read", text: "hello", fromType: "user", fromId: "u_1" }],
        nextTurns: [{ id: "nt_read", messageId: "msg_next" }]
      }
    });
    expect(second).toEqual(first);
    expect(third).toMatchObject({ ok: true, data: { mailbox: [], nextTurns: [] } });
    expect(currentDatabase().sqlite.prepare("SELECT read, claimed_run_id, delivery_batch_id FROM mailbox_messages WHERE id = 'mb_read'").get()).toMatchObject({ read: 1, claimed_run_id: "run_read", delivery_batch_id: "batch_read" });
    expect(currentDatabase().sqlite.prepare("SELECT consumed_at FROM run_next_turns WHERE id = 'nt_read'").get()).toMatchObject({ consumed_at: now });
  });

  test("room.read_mailbox uses MCP request id fallback and ignores spoofed tool args", async () => {
    seedRoom("room_1", "agent_1");
    seedRoom("room_2", "agent_2");
    seedMailbox("mb_session", "room_1", "agent_1");
    seedMailbox("mb_spoofed", "room_2", "agent_2");
    createRun("run_session", { roomId: "room_1", agentId: "agent_1" });
    createRun("run_spoofed", { roomId: "room_2", agentId: "agent_2" });
    insertNextTurn("nt_session", "run_session");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase() });
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const session = { roomId: "room_1", runId: "run_session", agentId: "agent_1" };
    const spoofedInput = { roomId: "room_2", runId: "run_spoofed", agentId: "agent_2" };

    const first = await mcp.callTool("room.read_mailbox", spoofedInput, session, { requestId: "rpc_1" });
    const retry = await mcp.callTool("room.read_mailbox", spoofedInput, session, { requestId: "rpc_1" });
    const nextRequest = await mcp.callTool("room.read_mailbox", spoofedInput, session, { requestId: "rpc_2" });

    expect(first).toMatchObject({
      ok: true,
      data: {
        deliveryBatchId: "mcp:rpc_1",
        mailbox: [{ id: "mb_session" }],
        nextTurns: [{ id: "nt_session" }]
      }
    });
    expect(retry).toEqual(first);
    expect(nextRequest).toMatchObject({ ok: true, data: { deliveryBatchId: "mcp:rpc_2", mailbox: [], nextTurns: [] } });
    expect(currentDatabase().sqlite.prepare("SELECT read, claimed_run_id, delivery_batch_id FROM mailbox_messages WHERE id = 'mb_spoofed'").get()).toMatchObject({ read: 0, claimed_run_id: null, delivery_batch_id: null });
  });

  test("room.read_mailbox resolves the current active run for a prewarmed MCP session", async () => {
    seedRoom("room_1", "agent_1");
    seedMailbox("mb_warm", "room_1", "agent_1");
    createRun("run_warm", { roomId: "room_1", agentId: "agent_1" });
    currentLifecycle().markClaimed(null, "run_warm");
    currentLifecycle().markStarting(null, "run_warm", 123);
    currentLifecycle().markRunning(null, "run_warm", "acp-test-warm-room_1-agent_1");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase() });
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const session = { roomId: "room_1", agentId: "agent_1" };
    const rejected = await mcp.callTool("room.read_mailbox", { deliveryBatchId: "batch_rejected" }, session);
    const registration = mcp.getRegisteredStdioConfig({ roomId: "room_1", agentId: "agent_1", adapterSessionId: "acp-test-warm-room_1-agent_1" });
    const token = registration.env.find((item) => item.name === "ROOM_MCP_SESSION_TOKEN")?.value;
    if (token === undefined) throw new Error("expected session token");

    const result = await mcp.callTool("room.read_mailbox", { deliveryBatchId: "batch_warm" }, session, { registration: { token, roomId: "room_1", agentId: "agent_1", adapterSessionId: "acp-test-warm-room_1-agent_1" } });

    expect(rejected).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(result).toMatchObject({ ok: true, data: { deliveryBatchId: "batch_warm", mailbox: [{ id: "mb_warm" }] } });
    expect(currentDatabase().sqlite.prepare("SELECT read, claimed_run_id FROM mailbox_messages WHERE id = 'mb_warm'").get()).toMatchObject({ read: 1, claimed_run_id: "run_warm" });
  });

  test("registered warm MCP sessions reject stale or mismatched registrations before any tool runs", async () => {
    seedRoom("room_1", "agent_1");
    createRun("run_warm_stale", { roomId: "room_1", agentId: "agent_1" });
    currentLifecycle().markClaimed(null, "run_warm_stale");
    currentLifecycle().markStarting(null, "run_warm_stale", 123);
    currentLifecycle().markRunning(null, "run_warm_stale", "acp-test-warm-room_1-agent_1");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase() });
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const session = { roomId: "room_1", agentId: "agent_1" };

    const stale = await mcp.callTool("room.list_members", {}, session, {
      registration: { token: "stale-token", roomId: "room_1", agentId: "agent_1", adapterSessionId: "acp-stale" }
    });
    const mismatched = await mcp.callTool("room.list_tasks", {}, session, {
      registration: { token: "wrong-agent-token", roomId: "room_1", agentId: "agent_2", adapterSessionId: "acp-test-warm-room_1-agent_1" }
    });

    expect(stale).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(mismatched).toMatchObject({ ok: false, error: { code: "permission_denied" } });
  });

  test("registered warm MCP sessions ignore spoofed run ids and resolve the registered active run", async () => {
    seedRoom("room_1", "agent_1");
    seedMailbox("mb_registered", "room_1", "agent_1");
    createRun("run_registered", { roomId: "room_1", agentId: "agent_1" });
    createRun("run_spoofed", { roomId: "room_1", agentId: "agent_1" });
    currentLifecycle().markClaimed(null, "run_registered");
    currentLifecycle().markStarting(null, "run_registered", 123);
    currentLifecycle().markRunning(null, "run_registered", "acp-test-warm-room_1-agent_1");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase() });
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const registration = registeredContext(mcp, { roomId: "room_1", agentId: "agent_1", adapterSessionId: "acp-test-warm-room_1-agent_1" });

    const result = await mcp.callTool("room.read_mailbox", { deliveryBatchId: "batch_registered" }, { roomId: "room_1", runId: "run_spoofed", agentId: "agent_1" }, { registration });

    expect(result).toMatchObject({ ok: true, data: { mailbox: [{ id: "mb_registered" }] } });
    expect(currentDatabase().sqlite.prepare("SELECT claimed_run_id FROM mailbox_messages WHERE id = 'mb_registered'").get()).toMatchObject({ claimed_run_id: "run_registered" });
  });

  test("registered warm MCP sessions resolve the current run for task tools", async () => {
    seedRoom("room_1", "agent_1");
    createRun("run_warm_task", { roomId: "room_1", agentId: "agent_1" });
    currentLifecycle().markClaimed(null, "run_warm_task");
    currentLifecycle().markStarting(null, "run_warm_task", 123);
    currentLifecycle().markRunning(null, "run_warm_task", "acp-test-warm-room_1-agent_1");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { CreateTask: createCreateTaskHandler(service), UpdateTask: createUpdateTaskHandler(service) } });
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const session = { roomId: "room_1", agentId: "agent_1" };
    const registration = registeredContext(mcp, { roomId: "room_1", agentId: "agent_1", adapterSessionId: "acp-test-warm-room_1-agent_1" });

    const created = await mcp.callTool("room.create_task", { title: "Warm task", assigneeAgentId: "agent_1" }, session, { registration });

    expect(created).toMatchObject({ ok: true });
    if (!created.ok || !isRecord(created.data) || typeof created.data.taskId !== "string") throw new Error("expected task id");
    expect(currentDatabase().sqlite.prepare("SELECT source_run_id FROM tasks WHERE id = ?").get(created.data.taskId)).toMatchObject({ source_run_id: "run_warm_task" });
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, status: "in_progress" }, session, { registration })).toMatchObject({ ok: true });
  });

  test("registered warm MCP sessions resolve the current run for agent messages", async () => {
    seedAssistedRoomWithAgents("room_warm_send", "agent_sender", "agent_target");
    createRun("run_warm_sender", { roomId: "room_warm_send", agentId: "agent_sender" });
    currentLifecycle().markClaimed(null, "run_warm_sender");
    currentLifecycle().markStarting(null, "run_warm_sender", 123);
    currentLifecycle().markRunning(null, "run_warm_sender", "acp-test-warm-room_warm_send-agent_sender");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = commandBusWithHandlers();
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const session = { roomId: "room_warm_send", agentId: "agent_sender" };
    const registration = registeredContext(mcp, { roomId: "room_warm_send", agentId: "agent_sender", adapterSessionId: "acp-test-warm-room_warm_send-agent_sender" });

    const result = await mcp.callTool("room.send_message", { text: "@target please read your mailbox" }, session, { registration });

    expect(result).toMatchObject({ ok: true, data: { delivered: 1 } });
    expect(currentDatabase().sqlite.prepare("SELECT from_id, to_agent_id FROM mailbox_messages WHERE room_id = 'room_warm_send'").get()).toMatchObject({ from_id: "agent_sender", to_agent_id: "agent_target" });
    expect(currentDatabase().sqlite.prepare("SELECT run_id, source_reason FROM run_next_turns WHERE run_id = 'run_warm_sender'").get()).toBeUndefined();
    expect(runCount()).toBe(2);
  });

  test("agent mailbox wake does not append sender text as executable next-turn prompt", async () => {
    seedAssistedRoomWithAgents("room_loop", "agent_sender", "agent_target");
    createRun("run_target_active", { roomId: "room_loop", agentId: "agent_target" });
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = commandBusWithHandlers();
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const senderText = "@target 能不能看到这个房间其他两个成员，给他们俩发个消息试试";

    const result = await mcp.callTool("room.send_message", { text: senderText }, { roomId: "room_loop", runId: "run_sender", agentId: "agent_sender" });

    expect(result).toMatchObject({ ok: true, data: { delivered: 1 } });
    const mailboxRow = currentDatabase().sqlite.prepare("SELECT content FROM mailbox_messages WHERE room_id = 'room_loop' AND to_agent_id = 'agent_target'").get() as { readonly content: string };
    expect(mailboxRow.content).toContain(senderText);
    const nextTurn = currentDatabase().sqlite.prepare("SELECT prompt_delta_json, source_reason FROM run_next_turns WHERE run_id = 'run_target_active'").get() as { readonly prompt_delta_json: string; readonly source_reason: string };
    expect(nextTurn.source_reason).toBe("mailbox_message");
    expect(nextTurn.prompt_delta_json).not.toContain(senderText);
    expect(nextTurn.prompt_delta_json).toContain("room.read_mailbox");
  });

  test("assisted agent send_message requires explicit mentions instead of broadcasting", async () => {
    seedAssistedRoomWithAgents("room_no_broadcast", "agent_sender", "agent_target");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const commandBus = commandBusWithHandlers();
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    const result = await mcp.callTool("room.send_message", { text: "hello, test delivery" }, { roomId: "room_no_broadcast", runId: "run_sender", agentId: "agent_sender" });

    expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM mailbox_messages WHERE room_id = 'room_no_broadcast'").get()).toMatchObject({ count: 0 });
    expect(runCount()).toBe(0);
  });

  test("mention parser validates membership and dedupes in first order", () => {
    expect(parseMentions("hi @agent-1 and @missing and @agent-2 then @agent-1", [{ agentId: "agent-1" }, { agentId: "agent-2" }])).toEqual(["agent-1", "agent-2"]);
  });

  test("room MCP send_message degrades inactive observers to mailbox and audits active observers", async () => {
    seedRoom("room_mcp_send", "primary_agent");
    currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_mcp_send', 'observer_agent', 'agent', 'observer', 'mock', NULL, 'observing', ?)").run(now);
    currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES ('room_mcp_send', 'observer_agent', 'observing', NULL, NULL, ?)").run(now);
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const sendMessage = vi.fn<CommandHandler>(() => ({ ok: true, data: { messageId: "msg_mcp" }, emittedEvents: [] }));
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { SendMessage: sendMessage } });
    const mcp = new RoomMcpServer({ commandBus, taskService: service, database: currentDatabase(), eventBus: currentBus(), now: () => now });

    await expect(mcp.callTool("room.send_message", { text: "passive" }, { roomId: "room_mcp_send", runId: "run_mcp", agentId: "observer_agent" })).resolves.toMatchObject({ ok: true, data: { degraded: true } });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(currentDatabase().sqlite.prepare("SELECT to_agent_id FROM mailbox_messages WHERE room_id = 'room_mcp_send'").get()).toMatchObject({ to_agent_id: "primary_agent" });

    currentDatabase().sqlite.prepare("UPDATE agent_presence SET state = 'active' WHERE room_id = 'room_mcp_send' AND agent_id = 'observer_agent'").run();
    await expect(mcp.callTool("room.send_message", { text: "active" }, { roomId: "room_mcp_send", runId: "run_mcp", agentId: "observer_agent" })).resolves.toMatchObject({ ok: true });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = 'server.connected' ORDER BY seq DESC LIMIT 1").get()).toBeDefined();
  });
});

describe("RunQueue", () => {
  test("claims queued run, writes locks, starts run, then AdapterBridge opens/runs/completes", async () => {
    createRun("run_happy", { targetFiles: ["b.ts", "a.ts"] });
    const started: string[] = [];
    const queue = new RunQueue({
      database: currentDatabase(),
      lifecycle: currentLifecycle(),
      pid: 321,
      adapterManager: {
        runAgent: (run) => {
          started.push(run.id);
        }
      }
    });

    await queue.scheduleTick();
    const bridge = bridgeFor("run_happy");
    bridge.handle({ type: "session.opened", sessionId: "s_happy", workDir: "work/run_happy", providerConversationId: "pc_1" });
    bridge.handle({ type: "tool.call.requested", toolCallId: "tc_1", name: "Bash", input: { cmd: "test" } });
    bridge.handle({ type: "file.changed", path: "a.ts", change: "modified" });
    bridge.handle({ type: "session.ended", sessionId: "s_happy", reason: "completed", cost: zeroCost() });
    await queue.handleEvent({ type: "agent.run.completed", runId: "run_happy" });

    expect(started).toEqual(["run_happy"]);
    expect(statusOf("run_happy")).toBe("completed");
    expect(currentDatabase().sqlite.prepare("SELECT adapter_session_id, work_dir, provider_conversation_id, pid_at_start FROM runs WHERE id = 'run_happy'").get()).toMatchObject({
      adapter_session_id: "s_happy",
      work_dir: "work/run_happy",
      provider_conversation_id: "pc_1",
      pid_at_start: 321
    });
    expect(lockRows()).toEqual([]);
    expect(runEvents("run_happy")).toEqual(["agent.run.queued", "agent.run.started", "agent.run.completed"]);
    expect(eventTypes()).toContain("tool.call.requested");
    expect(eventTypes()).toContain("file.changed");
  });

  test("agent, room, file, and workspace locks block conflicting runs", async () => {
    createRun("run_a", { targetFiles: ["src/a.ts"] });
    createRun("run_same_agent", { agentId: "agent_1", roomId: "room_2", targetFiles: ["src/b.ts"] });
    createRun("run_same_room", { agentId: "agent_2", roomId: "room_1", targetFiles: ["src/c.ts"] });
    createRun("run_same_file", { agentId: "agent_3", roomId: "room_3", targetFiles: ["src/a.ts"] });
    createRun("run_workspace", { agentId: "agent_4", roomId: "room_4", targetFiles: [] });
    const queue = new RunQueue({ database: currentDatabase(), lifecycle: currentLifecycle(), pid: 321 });

    await queue.scheduleTick();

    expect(statusOf("run_a")).toBe("starting");
    expect(statusOf("run_same_agent")).toBe("waiting");
    expect(waitingReason("run_same_agent")).toContain("agent_lock_held_by:run_a");
    expect(statusOf("run_same_room")).toBe("waiting");
    expect(waitingReason("run_same_room")).toContain("room_lock_held_by:run_a");
    expect(statusOf("run_same_file")).toBe("waiting");
    expect(waitingReason("run_same_file")).toContain("file_lock_held_by:run_a");
    expect(statusOf("run_workspace")).toBe("waiting");
    expect(waitingReason("run_workspace")).toContain("file_locks_held_in_workspace:ws_1");
  });

  test("waiting lock timeout fails run as transient", async () => {
    createRun("run_wait");
    currentLifecycle().markWaiting(null, "run_wait", "agent_lock_held_by:run_a");
    now += 301_000;
    const queue = new RunQueue({ database: currentDatabase(), lifecycle: currentLifecycle(), lockTimeoutMs: 300_000, now: () => now });

    await queue.scheduleTick();

    expect(statusOf("run_wait")).toBe("failed");
    expect(currentLifecycle().read("run_wait").failure_class).toBe("transient");
  });

  test("adapter prompt delivery failure is transient and reopens adapter-start input", async () => {
    createRun("run_prompt_delivery");
    insertNextTurn("nt_prompt_delivery", "run_prompt_delivery");
    const queue = new RunQueue({
      database: currentDatabase(),
      lifecycle: currentLifecycle(),
      pid: 321,
      adapterManager: {
        runAgent: (run) => {
          currentMailbox().readForRun(null, { runId: run.id, roomId: run.room_id, agentId: run.agent_id, deliveryBatchId: `adapter-start:${run.id}` });
          throw new Error("prompt delivery failed");
        }
      }
    });

    await queue.scheduleTick();

    expect(statusOf("run_prompt_delivery")).toBe("failed");
    expect(currentLifecycle().read("run_prompt_delivery").failure_class).toBe("transient");
    expect(currentDatabase().sqlite.prepare("SELECT consumed_at FROM run_next_turns WHERE id = 'nt_prompt_delivery'").get()).toMatchObject({ consumed_at: null });
  });
});

describe("events:check task event contract", () => {
  const forbiddenFixture = join(process.cwd(), "packages", "orchestrator", "src", "__task_updated_events_check_fixture.ts");

  afterEach(() => {
    rmSync(forbiddenFixture, { force: true });
  });

  test("rejects forbidden task.updated literals from scanned source", () => {
    mkdirSync(join(process.cwd(), "packages", "orchestrator", "src"), { recursive: true });
    const forbiddenType = ["task", "updated"].join(".");
    writeFileSync(forbiddenFixture, `export const forbiddenTaskEvent = "${forbiddenType}";\n`);

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "checks", "events-check.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`event '${forbiddenType}' referenced`);
    expect(result.stderr).toContain("forbidden by the V1.0 event contract");
  }, 20_000);
});

describe("startup recovery and reclaim", () => {
  test("clears locks, preserves queued/waiting, fails stale claimed/starting, and finalizes cancelling", async () => {
    createRun("run_queued");
    createRun("run_waiting");
    currentLifecycle().markWaiting(null, "run_waiting", "agent_lock_held_by:old");
    createRun("run_claimed");
    currentLifecycle().markClaimed(null, "run_claimed");
    currentDatabase().sqlite.prepare("UPDATE runs SET claimed_at = ? WHERE id = 'run_claimed'").run(now - 31_000);
    createRun("run_starting");
    currentLifecycle().markClaimed(null, "run_starting");
    currentLifecycle().markStarting(null, "run_starting", 111);
    createRun("run_cancelling");
    currentLifecycle().markCancelling(null, "run_cancelling");
    currentDatabase().sqlite.prepare("INSERT INTO run_locks (lock_type, lock_key, workspace_id, run_id, acquired_at) VALUES ('agent', 'old', NULL, 'run_claimed', ?)").run(now);
    const reclaim = new ReclaimStaleClaimedRun(currentDatabase(), currentLifecycle(), () => ({ crashRecovery: "fail_run" }), () => now, 999);

    await new StartupRecovery(currentDatabase(), currentLifecycle(), reclaim, () => now, 999).run();

    expect(lockRows()).toEqual([]);
    expect(statusOf("run_queued")).toBe("queued");
    expect(statusOf("run_waiting")).toBe("waiting");
    expect(statusOf("run_claimed")).toBe("failed");
    expect(statusOf("run_starting")).toBe("failed");
    expect(statusOf("run_cancelling")).toBe("cancelled");
  });

  test("ReclaimStaleClaimedRun attaches resumable sessions and handles failed attach", async () => {
    createRun("run_resume");
    currentLifecycle().markClaimed(null, "run_resume");
    currentLifecycle().markStarting(null, "run_resume", 111);
    currentLifecycle().updateSessionState(null, "run_resume", { adapterSessionId: "s_resume", workDir: "work/run_resume" });
    createRun("run_fail_attach", { agentId: "agent_2", roomId: "room_2" });
    currentLifecycle().markClaimed(null, "run_fail_attach");
    currentLifecycle().markStarting(null, "run_fail_attach", 111);
    currentLifecycle().markRunning(null, "run_fail_attach", "s_missing");
    const attached: string[] = [];
    const reclaim = new ReclaimStaleClaimedRun(
      currentDatabase(),
      currentLifecycle(),
      (run) => ({
        crashRecovery: "resumable",
        attachSession: async ({ adapterSessionId }) => {
          if (run.id === "run_fail_attach") throw new Error("gone");
          attached.push(adapterSessionId);
        }
      }),
      () => now,
      999
    );

    await reclaim.scan();

    expect(attached).toEqual(["s_resume"]);
    expect(statusOf("run_resume")).toBe("running");
    expect(currentLifecycle().read("run_resume").pid_at_start).toBe(999);
    expect(statusOf("run_fail_attach")).toBe("failed");
    expect(currentLifecycle().read("run_fail_attach").failure_class).toBe("fresh_session_required");
  });

  test("reconciles completed team delegated runs stuck before review", async () => {
    seedDelegatedRoom("room_reconcile_team", "agent_leader_reconcile", "role_leader_reconcile", "role_builder_reconcile", "binding_leader_reconcile", "binding_builder_reconcile", "agent_builder_reconcile");
    currentDatabase().sqlite.prepare("UPDATE rooms SET mode = 'team' WHERE id = 'room_reconcile_team'").run();
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const taskA = service.create({ roomId: "room_reconcile_team", title: "Recovered A", assigneeRoleId: "role_builder_reconcile", expectsReview: false, sourceRunId: "run_source_reconcile", createdBy: "agent_leader_reconcile" });
    const taskB = service.create({ roomId: "room_reconcile_team", title: "Recovered B", assigneeRoleId: "role_builder_reconcile", expectsReview: false, sourceRunId: "run_source_reconcile", createdBy: "agent_leader_reconcile" });
    if (!taskA.ok || !taskB.ok) throw new Error("expected tasks");
    insertTerminalRunInRoom("room_reconcile_team", "agent_builder_reconcile", taskA.data.taskId, "run_reconcile_a", "completed");
    insertTerminalRunInRoom("room_reconcile_team", "agent_builder_reconcile", taskB.data.taskId, "run_reconcile_b", "completed");

    const result = reconcileTerminalDelegatedTaskRuns({ database: currentDatabase(), eventBus: currentBus(), taskService: service, now: () => now });

    expect(result.reviewDispatchRunIds).toEqual(["run_reconcile_a", "run_reconcile_b"]);
    expect(currentDatabase().sqlite.prepare("SELECT status, expects_review FROM tasks WHERE id = ?").get(taskA.data.taskId)).toMatchObject({ status: "review", expects_review: 1 });
    expect(currentDatabase().sqlite.prepare("SELECT status, expects_review FROM tasks WHERE id = ?").get(taskB.data.taskId)).toMatchObject({ status: "review", expects_review: 1 });
    const commandBus = { dispatch: (command: { readonly reason: string; readonly taskId: string }) => ({ ok: true, data: { runId: `leader-${command.taskId}` }, emittedEvents: [] }) } as unknown as CommandBus;
    await handleTeamDispatchReviewTerminal({ database: currentDatabase(), eventBus: currentBus(), commandBus, taskService: service, now: () => now }, "run_reconcile_b");
    expect(currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'team.dispatch.started' AND json_extract(payload, '$.sourceRunId') = 'run_source_reconcile'").get()).toMatchObject({ count: 1 });
  });

  test("reconciles completed squad delegated runs stuck in progress", () => {
    seedDelegatedRoom("room_reconcile_squad", "agent_leader_squad", "role_leader_squad", "role_builder_squad", "binding_leader_squad", "binding_builder_squad", "agent_builder_squad");
    const service = new TaskService({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
    const task = service.create({ roomId: "room_reconcile_squad", title: "Recovered squad", assigneeRoleId: "role_builder_squad", expectsReview: false, sourceRunId: "run_source_squad", createdBy: "agent_leader_squad" });
    if (!task.ok) throw new Error("expected squad task");
    currentDatabase().sqlite.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(task.data.taskId);
    insertTerminalRunInRoom("room_reconcile_squad", "agent_builder_squad", task.data.taskId, "run_reconcile_squad", "completed");

    const result = reconcileTerminalDelegatedTaskRuns({ database: currentDatabase(), eventBus: currentBus(), taskService: service, now: () => now });

    expect(result.completedTaskIds).toEqual([task.data.taskId]);
    expect(currentDatabase().sqlite.prepare("SELECT status, expects_review FROM tasks WHERE id = ?").get(task.data.taskId)).toMatchObject({ status: "completed", expects_review: 0 });
    expect(currentDatabase().sqlite.prepare("SELECT type FROM events WHERE type = 'task.delegation.completed' AND task_id = ?").get(task.data.taskId)).toBeDefined();
  });
});

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function currentLifecycle(): RunLifecycleService {
  expect(lifecycle).toBeDefined();
  return lifecycle as RunLifecycleService;
}

function currentMailbox(): MailboxService {
  expect(mailbox).toBeDefined();
  return mailbox as MailboxService;
}

function currentActiveWakes(): ActiveWakesRegistry {
  expect(activeWakes).toBeDefined();
  return activeWakes as ActiveWakesRegistry;
}

function currentTaskTransition(runId: string, kind: "start" | "complete" | "block"): void {
  const row = currentDatabase().sqlite.prepare("SELECT task_id FROM runs WHERE id = ?").get(runId) as { readonly task_id: string | null } | undefined;
  if (!row?.task_id) return;
  if (kind === "start") {
    currentTaskService().startDelegatedRun(row.task_id, runId);
    return;
  }
  if (kind === "complete") {
    currentTaskService().completeDelegatedRun(row.task_id, runId);
    return;
  }
  currentTaskService().blockDelegatedRun(row.task_id, runId);
}

function currentTaskService(): TaskService {
  expect(taskService).toBeDefined();
  return taskService as TaskService;
}

function createRun(
  runId: string,
  options: {
    readonly workspaceId?: string;
    readonly roomId?: string;
    readonly agentId?: string;
    readonly targetFiles?: readonly string[];
    readonly mailboxClaimIds?: readonly string[];
  } = {}
): void {
  currentLifecycle().create(null, {
    runId,
    workspaceId: options.workspaceId ?? "ws_1",
    roomId: options.roomId ?? "room_1",
    agentId: options.agentId ?? "agent_1",
    wakeReason: "primary_turn",
    targetFiles: options.targetFiles ?? [],
    ...(options.mailboxClaimIds !== undefined ? { mailboxClaimIds: options.mailboxClaimIds } : {}),
    messageId: `msg_${runId}`
  });
}

function commandBusWithHandlers(): CommandBus {
  return new CommandBus({
    database: currentDatabase(),
    handlers: {
      WakeAgent: createWakeAgentHandler({ database: currentDatabase(), activeWakes: currentActiveWakes(), mailbox: currentMailbox(), lifecycle: currentLifecycle() }) as CommandHandler
    }
  });
}

function wakeCommand(overrides: Partial<Parameters<typeof createWakeAgentHandler>[0]> & Record<string, unknown> = {}) {
  return {
    type: "WakeAgent" as const,
    roomId: "room_1",
    agentId: "agent_1",
    workspaceId: "ws_1",
    reason: "primary_turn" as const,
    idempotencyKey: "wake_default",
    ...overrides
  };
}

function internalMeta(idempotencyKey: string) {
  return { actor: { type: "system" as const }, traceId: `trace_${idempotencyKey}`, idempotencyKey, origin: "internal" as const };
}

function bridgeFor(runId: string): AdapterBridge {
  return new AdapterBridge({ runId, workspaceId: "ws_1", roomId: "room_1", agentId: "agent_1", lifecycle: currentLifecycle(), eventBus: currentBus(), now: () => now });
}

function zeroCost() {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, modelId: "mock" };
}

function insertTerminalRun(taskId: string, runId: string, status: "completed" | "failed"): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES (?, 'ws_1', ?, 'room_1', 'agent_1', NULL, NULL, NULL, NULL, ?, 'delegated_task', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)"
  ).run(runId, taskId, status, now, now, now, now);
}

function insertTerminalRunInRoom(roomId: string, agentId: string, taskId: string, runId: string, status: "completed" | "failed"): void {
  currentDatabase().sqlite.prepare(
    "INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES (?, 'ws_1', ?, ?, ?, NULL, NULL, NULL, NULL, ?, 'delegated_task', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)"
  ).run(runId, taskId, roomId, agentId, status, now, now, now, now);
}

function seedMailbox(id: string, roomId: string, agentId: string): void {
  currentDatabase().sqlite
    .prepare(
      `INSERT INTO mailbox_messages (
        id, workspace_id, room_id, from_type, from_id, to_agent_id, kind, content, files, read, claimed_run_id, claimed_at, delivery_batch_id, delivery_failure_reason, attempt_count, created_at, consumed_at
      ) VALUES (?, 'ws_1', ?, 'user', 'u_1', ?, 'message', 'hello', '[]', 0, NULL, NULL, NULL, NULL, 0, ?, NULL)`
    )
    .run(id, roomId, agentId, now);
}

function seedRoom(roomId: string, agentId: string): void {
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, 'ws_1', 'Room', 'solo', 'conversation', ?, NULL, ?, ?)").run(roomId, agentId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', 'mock', NULL, 'active', ?)").run(roomId, agentId, now);
}

function seedDelegatedRoom(roomId: string, leaderAgentId: string, leaderRoleId: string, teammateRoleId: string, leaderBindingId: string, teammateBindingId: string, teammateAgentId: string): void {
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES (?, 'ws_1', 'Leader', '', '[]', 0, ?, ?)").run(leaderRoleId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES (?, 'ws_1', 'Builder', '', '[]', 0, ?, ?)").run(teammateRoleId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, 'ws_1', ?, 'runtime_1', NULL, NULL, ?, ?)").run(leaderBindingId, leaderRoleId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, 'ws_1', ?, 'runtime_1', NULL, NULL, ?, ?)").run(teammateBindingId, teammateRoleId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, 'ws_1', 'Leader', 'mock', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(leaderAgentId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, 'ws_1', 'Builder', 'mock', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(teammateAgentId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, leader_role_id, archived_at, created_at, updated_at) VALUES (?, 'ws_1', 'Delegated', 'squad', 'conversation', ?, ?, NULL, ?, ?)").run(roomId, leaderAgentId, leaderRoleId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', 'mock', NULL, ?, 'active', ?)").run(roomId, leaderAgentId, leaderBindingId, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'teammate', 'mock', NULL, ?, 'active', ?)").run(roomId, teammateAgentId, teammateBindingId, now);
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, 'active', NULL, NULL, ?)").run(roomId, leaderAgentId, now);
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, 'active', NULL, NULL, ?)").run(roomId, teammateAgentId, now);
}

function seedSquadRoomWithTeammates(roomId: string, teammates: ReadonlyArray<{ readonly roleId: string; readonly bindingId: string; readonly agentId: string }>): void {
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_leader', 'ws_1', 'Leader', '', '[]', 0, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_leader', 'ws_1', 'role_leader', 'runtime_1', NULL, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_leader', 'ws_1', 'Leader', 'mock', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, leader_role_id, archived_at, created_at, updated_at) VALUES (?, 'ws_1', 'Squad', 'squad', 'conversation', 'agent_leader', 'role_leader', NULL, ?, ?)").run(roomId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, 'agent_leader', 'agent', 'primary', 'mock', NULL, 'binding_leader', 'active', ?)").run(roomId, now);
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, 'agent_leader', 'active', NULL, NULL, ?)").run(roomId, now);

  for (const teammate of teammates) {
    currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES (?, 'ws_1', ?, '', '[]', 0, ?, ?)").run(teammate.roleId, teammate.roleId, now, now);
    currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, 'ws_1', ?, 'runtime_1', NULL, NULL, ?, ?)").run(teammate.bindingId, teammate.roleId, now, now);
    currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, 'ws_1', ?, 'mock', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(teammate.agentId, teammate.agentId, now, now);
    currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'teammate', 'mock', NULL, ?, 'active', ?)").run(roomId, teammate.agentId, teammate.bindingId, now);
    currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, 'active', NULL, NULL, ?)").run(roomId, teammate.agentId, now);
  }
}

function registeredContext(mcp: RoomMcpServer, input: { readonly roomId: string; readonly agentId: string; readonly adapterSessionId: string }) {
  const config = mcp.getRegisteredStdioConfig(input);
  const token = config.env.find((item) => item.name === "ROOM_MCP_SESSION_TOKEN")?.value;
  if (token === undefined) throw new Error("expected session token");
  return { token, roomId: input.roomId, agentId: input.agentId, adapterSessionId: input.adapterSessionId };
}

function seedAssistedRoomWithAgents(roomId: string, primaryAgentId: string, targetAgentId: string): void {
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, 'ws_1', 'Sender', 'mock', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(primaryAgentId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, 'ws_1', 'Target', 'mock', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(targetAgentId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, 'ws_1', 'Assisted', 'assisted', 'conversation', ?, NULL, ?, ?)").run(roomId, primaryAgentId, now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', 'mock', NULL, 'active', ?)").run(roomId, primaryAgentId, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'observer', 'mock', NULL, 'active', ?)").run(roomId, targetAgentId, now);
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, 'active', NULL, NULL, ?)").run(roomId, primaryAgentId, now);
  currentDatabase().sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, 'active', NULL, NULL, ?)").run(roomId, targetAgentId, now);
}

function seedPendingTurn(id: string, messageId: string, text = "pending text"): void {
  currentDatabase().sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'ws_1', 'room_1', 'user', 'u_1', NULL, 'user', 'completed', NULL, 'pending', ?, ?, ?, NULL)").run(messageId, id, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(messageId, JSON.stringify({ text }), now);
  currentDatabase().sqlite.prepare("INSERT INTO pending_turns (id, room_id, user_message_id, primary_agent_id, status, enqueued_at, scheduled_at, cancelled_at, notes) VALUES (?, 'room_1', ?, 'agent_1', 'queued', ?, NULL, NULL, NULL)").run(id, messageId, now);
}

function insertNextTurn(id: string, runId: string): void {
  currentDatabase().sqlite
    .prepare(
      `INSERT INTO run_next_turns (id, run_id, room_id, agent_id, prompt_delta_json, message_id, pending_turn_id, source_reason, source_idempotency_key, created_at, consumed_at)
       VALUES (?, ?, 'room_1', 'agent_1', '', 'msg_next', NULL, 'primary_turn', 'idem_next', ?, NULL)`
    )
    .run(id, runId, now);
}

function statusOf(runId: string): string {
  return currentLifecycle().read(runId).status;
}

function waitingReason(runId: string): string | null {
  return currentLifecycle().read(runId).waiting_reason;
}

function runEvents(runId: string): string[] {
  return currentDatabase().sqlite
    .prepare("SELECT type FROM events WHERE run_id = ? AND type LIKE 'agent.run.%' ORDER BY seq ASC")
    .all(runId)
    .map((row) => (row as { type: string }).type);
}

function eventTypes(): string[] {
  return currentDatabase().sqlite.prepare("SELECT type FROM events ORDER BY seq ASC").all().map((row) => (row as { type: string }).type);
}

function eventPayload(type: string, runId: string): unknown {
  const row = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = ? AND run_id = ? ORDER BY seq DESC LIMIT 1").get(type, runId) as { payload: string };
  return JSON.parse(row.payload) as unknown;
}

function runCount(): number {
  return (currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM runs").get() as { count: number }).count;
}

function nextTurnCount(runId: string): number {
  return (currentDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM run_next_turns WHERE run_id = ?").get(runId) as { count: number }).count;
}

function pendingTurnStatus(id: string): string {
  return (currentDatabase().sqlite.prepare("SELECT status FROM pending_turns WHERE id = ?").get(id) as { status: string }).status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lockRows(): unknown[] {
  return currentDatabase().sqlite.prepare("SELECT lock_type, lock_key, workspace_id, run_id FROM run_locks ORDER BY lock_type, lock_key").all();
}

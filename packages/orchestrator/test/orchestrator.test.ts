import { mkdtempSync, rmSync } from "node:fs";
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
let now = 1000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-orchestrator-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  activeWakes = new ActiveWakesRegistry(() => now);
  mailbox = new MailboxService(currentDatabase(), () => now);
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), {
    now: () => now,
    sideEffects: {
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
    service.create({ roomId: "room_2", title: "Other room", createdBy: "user", assigneeAgentId: "agent_2" });

    const listed = await mcp.callTool("room.list_tasks", {}, { roomId: "room_1", runId: "run_1", agentId: "agent_1" });
    expect(listed).toMatchObject({ ok: true });
    if (!listed.ok || !isRecord(listed.data) || !Array.isArray(listed.data.tasks)) throw new Error("expected task list");
    expect(listed.data.tasks).toHaveLength(1);
    expect(listed.data.tasks[0]).toMatchObject({ title: "MCP task", status: "completed" });
    expect(await mcp.callTool("unknown_tool", {}, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: false, error: { code: "tool_not_found" } });
    expect(await mcp.callTool("room.update_task", { taskId: created.data.taskId, status: "in_progress" }, { roomId: "room_1", runId: "run_1", agentId: "agent_1" })).toMatchObject({ ok: false, error: { code: "conflict" } });
    unsubscribe();
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

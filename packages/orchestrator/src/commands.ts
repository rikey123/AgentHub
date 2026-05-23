import { randomUUID } from "node:crypto";

import type { AgentHubDatabase } from "@agenthub/db";
import type { Command, CommandErrorCode, CommandHandler, CommandMeta, CommandResult } from "@agenthub/bus";

import { ActiveWakesRegistry } from "./active-wakes.ts";
import { hasMeaningfulPromptDelta, MailboxService } from "./mailbox-service.ts";
import { RunLifecycleError, RunLifecycleService, type AgentPromptDelta, type WakeReason } from "./run-lifecycle-service.ts";

export type WakeAgentCommand = Command & {
  readonly type: "WakeAgent";
  readonly roomId: string;
  readonly agentId: string;
  readonly workspaceId: string;
  readonly reason: WakeReason;
  readonly triggerEventId?: string;
  readonly promptDelta?: AgentPromptDelta;
  readonly targetFiles?: readonly string[];
  readonly workspaceMode?: "isolated_worktree" | "isolated_copy" | "shadow_buffer" | "shared" | "external";
  readonly parentRunId?: string;
  readonly messageId?: string;
  readonly pendingTurnId?: string;
  readonly carryNextTurnIds?: readonly string[];
  readonly sourceRunId?: string;
  readonly idempotencyKey: string;
};

export type AdapterCancelManager = {
  cancelRun(runId: string): void | Promise<void>;
};

export function createCancelRunHandler(options: { readonly lifecycle: RunLifecycleService; readonly adapterManager: AdapterCancelManager }): CommandHandler {
  return (command): CommandResult => {
    if (typeof command.runId !== "string" || command.runId.length === 0) {
      return failed("validation_failed", "CancelRun requires runId");
    }
    try {
      options.lifecycle.markCancelling(null, command.runId);
      // Fire-and-forget adapter cancel per spec: "不依赖 event 回环" (bus-runtime/spec.md §CancelRun).
      // The adapter cancel is best-effort; lifecycle state is already driven by markCancelling.
      void Promise.resolve(options.adapterManager.cancelRun(command.runId)).catch(() => undefined);
      return { ok: true, data: { runId: command.runId, status: "cancelling" }, emittedEvents: [] };
    } catch (error) {
      return lifecycleFailure(error);
    }
  };
}

export function createWakeAgentHandler(options: {
  readonly database: AgentHubDatabase;
  readonly activeWakes: ActiveWakesRegistry;
  readonly mailbox: MailboxService;
  readonly lifecycle: RunLifecycleService;
}): CommandHandler<WakeAgentCommand> {
  return (command, meta) => handleWakeAgent(options, command, meta);
}

function handleWakeAgent(
  options: { readonly database: AgentHubDatabase; readonly activeWakes: ActiveWakesRegistry; readonly mailbox: MailboxService; readonly lifecycle: RunLifecycleService },
  command: WakeAgentCommand,
  meta: CommandMeta
): CommandResult {
  if (meta.origin !== "internal") return failed("validation_failed", "WakeAgent is internal only");
  const validation = validateWake(command);
  if (validation) return validation;

  const guard = options.activeWakes.tryAcquire(command.roomId, command.agentId, command.idempotencyKey);
  if (guard.kind === "already_active" && guard.existingRunId.length > 0) {
    options.mailbox.appendNextTurn(null, guard.existingRunId, nextTurnInput(command));
    return { ok: true, data: { appendedToRunId: guard.existingRunId }, emittedEvents: [] };
  }
  if (guard.kind === "already_active") return failed("conflict", "wake already active but no run is bound yet");

  let createdRunId: string | undefined;
  try {
    const data = options.database.sqlite.transaction(() => {
      const existing = findActiveRun(options.database, command.roomId, command.agentId);
      if (existing) {
        options.mailbox.appendNextTurn(options.database.sqlite, existing.id, nextTurnInput(command));
        return { appendedToRunId: existing.id };
      }

      const runId = randomUUID();
      const claimedIds = options.mailbox.claimUnread(options.database.sqlite, {
        roomId: command.roomId,
        toAgentId: command.agentId,
        runId
      });
      const hasInput =
        claimedIds.length > 0 ||
        hasMeaningfulPromptDelta(command.promptDelta) ||
        command.messageId !== undefined ||
        command.pendingTurnId !== undefined ||
        (command.carryNextTurnIds?.length ?? 0) > 0;
      if (!hasInput) return { rejected: "wake_rejected_zero_input" };
      if (claimedIds.length === 0 && (command.carryNextTurnIds?.length ?? 0) === 0 && !zeroMailboxAllowed.has(command.reason)) {
        return { rejected: "wake_rejected_no_mailbox" };
      }

      options.lifecycle.create(options.database.sqlite, {
        runId,
        agentId: command.agentId,
        roomId: command.roomId,
        workspaceId: command.workspaceId,
        wakeReason: command.reason,
        ...(command.workspaceMode !== undefined ? { workspaceMode: command.workspaceMode } : {}),
        ...(command.parentRunId !== undefined ? { parentRunId: command.parentRunId } : {}),
        ...(command.targetFiles !== undefined ? { targetFiles: command.targetFiles } : {}),
        ...(command.promptDelta !== undefined ? { promptDelta: command.promptDelta } : {}),
        mailboxClaimIds: claimedIds,
        ...(command.carryNextTurnIds !== undefined ? { carryNextTurnIds: command.carryNextTurnIds } : {}),
        ...(command.sourceRunId !== undefined ? { sourceRunId: command.sourceRunId } : {}),
        ...(command.triggerEventId !== undefined ? { triggerEventId: command.triggerEventId } : {}),
        ...(command.messageId !== undefined ? { messageId: command.messageId } : {}),
        ...(command.pendingTurnId !== undefined ? { pendingTurnId: command.pendingTurnId } : {})
      });
      createdRunId = runId;
      const emitted = latestRunEvents(options.database, runId);
      return { runId, emitted };
    })();

    if (createdRunId) guard.bindToRun(createdRunId);
    else guard.release();

    if ("rejected" in data) return failed("validation_failed", data.rejected);
    if ("appendedToRunId" in data) return { ok: true, data, emittedEvents: [] };
    return { ok: true, data: { runId: data.runId }, emittedEvents: data.emitted };
  } catch (error) {
    guard.release();
    return lifecycleFailure(error);
  }
}

function validateWake(command: WakeAgentCommand): CommandResult | undefined {
  if (!command.roomId || !command.agentId || !command.workspaceId || !command.reason || !command.idempotencyKey) {
    return failed("validation_failed", "WakeAgent requires roomId, agentId, workspaceId, reason, and idempotencyKey");
  }
  if ((command.carryNextTurnIds?.length ?? 0) > 0 && !command.sourceRunId) {
    return failed("validation_failed", "WakeAgent with carryNextTurnIds requires sourceRunId");
  }
  return undefined;
}

function nextTurnInput(command: WakeAgentCommand) {
  return {
    roomId: command.roomId,
    agentId: command.agentId,
    ...(command.promptDelta !== undefined ? { promptDelta: command.promptDelta } : {}),
    ...(command.messageId !== undefined ? { messageId: command.messageId } : {}),
    ...(command.pendingTurnId !== undefined ? { pendingTurnId: command.pendingTurnId } : {}),
    sourceReason: command.reason,
    sourceIdempotencyKey: command.idempotencyKey
  };
}

function findActiveRun(database: AgentHubDatabase, roomId: string, agentId: string): { readonly id: string } | undefined {
  return database.sqlite
    .prepare("SELECT id FROM runs WHERE room_id = ? AND agent_id = ? AND status NOT IN ('completed', 'failed', 'cancelled') ORDER BY created_at ASC LIMIT 1")
    .get(roomId, agentId) as { readonly id: string } | undefined;
}

function latestRunEvents(database: AgentHubDatabase, runId: string): { readonly seq: number; readonly type: string }[] {
  return database.sqlite.prepare("SELECT seq, type FROM events WHERE run_id = ? ORDER BY seq ASC").all(runId) as { readonly seq: number; readonly type: string }[];
}

function lifecycleFailure(error: unknown): CommandResult {
  if (error instanceof RunLifecycleError) {
    return failed(error.code === "not_found" ? "not_found" : "conflict", error.message);
  }
  return failed("internal_error", error instanceof Error ? error.message : String(error));
}

function failed(code: CommandErrorCode, message: string): CommandResult {
  return { ok: false, error: { code, message } };
}

const zeroMailboxAllowed = new Set<WakeReason>([
  "primary_turn",
  "user_mention",
  "rule_review",
  "phase_completed",
  "agent_crashed",
  "group_review",
  "knock_approved",
  "consume_pending_turn",
  "delegated_task"
]);

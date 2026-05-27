import type { AgentHubDatabase } from "@agenthub/db";

import { MailboxService, messageText, type MailboxDeliveryBatch, type MailboxMessageDelivery, type NextTurnDelivery } from "../mailbox-service.ts";
import type { AgentPromptDelta, RunRow } from "../run-lifecycle-service.ts";
import { buildFirstWakePrompt } from "./first-wake-prompt.ts";

export type RunPromptOptions = {
  readonly now?: () => number;
  readonly deliveryBatchId?: string;
};

export function buildRunPrompt(run: RunRow, database: AgentHubDatabase, options: RunPromptOptions = {}): string {
  const rolePrompt = buildFirstWakePrompt(run.id, run.agent_id, run.room_id, database);
  const batch = readCurrentRunMailbox(run, database, options);
  const input = renderBatch(batch) ?? renderQueuedRunInput(run, database) ?? `Run ${run.id} for agent ${run.agent_id}`;
  return rolePrompt !== undefined ? `${rolePrompt}\n\n---\n\n${input}` : input;
}

function readCurrentRunMailbox(run: RunRow, database: AgentHubDatabase, options: RunPromptOptions): MailboxDeliveryBatch {
  const batchId = options.deliveryBatchId ?? `adapter-start:${run.id}`;
  return new MailboxService(database, options.now ?? Date.now).readForRun(null, { runId: run.id, roomId: run.room_id, agentId: run.agent_id, deliveryBatchId: batchId });
}

function renderBatch(batch: MailboxDeliveryBatch): string | undefined {
  const parts = [
    ...batch.mailbox.map(renderMailboxMessage),
    ...batch.nextTurns.map(renderNextTurn)
  ].filter((part): part is string => part !== undefined && part.trim().length > 0);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function renderMailboxMessage(message: MailboxMessageDelivery): string {
  const sender = message.fromType === "user"
    ? "User"
    : message.fromType === "agent"
      ? (message.fromName ?? message.fromId ?? "Agent")
      : (message.fromId ?? message.fromType ?? "System");
  const files = message.files.length > 0 ? `\nFiles: ${message.files.join(", ")}` : "";
  return `[From ${sender}] ${message.text}${files}`;
}

function renderNextTurn(turn: NextTurnDelivery): string | undefined {
  const delta = turn.promptDelta !== undefined ? renderPromptDelta(turn.promptDelta) : undefined;
  const text = turn.messageText !== undefined ? `[Queued message] ${turn.messageText}` : undefined;
  return [delta, text].filter((part): part is string => part !== undefined && part.trim().length > 0).join("\n");
}

function renderQueuedRunInput(run: RunRow, database: AgentHubDatabase): string | undefined {
  const event = database.sqlite.prepare("SELECT payload FROM events WHERE run_id = ? AND type = 'agent.run.queued' ORDER BY seq DESC LIMIT 1").get(run.id) as { readonly payload: string } | undefined;
  if (event === undefined) return undefined;
  let payload: { readonly promptDelta?: AgentPromptDelta; readonly messageId?: string; readonly pendingTurnId?: string };
  try {
    payload = JSON.parse(event.payload) as typeof payload;
  } catch {
    return undefined;
  }
  const parts = [
    payload.promptDelta !== undefined ? renderPromptDelta(payload.promptDelta) : undefined,
    payload.messageId !== undefined ? messageText(database.sqlite, payload.messageId) : undefined,
    payload.pendingTurnId !== undefined ? pendingTurnText(database, payload.pendingTurnId) : undefined
  ].filter((part): part is string => part !== undefined && part.trim().length > 0);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function pendingTurnText(database: AgentHubDatabase, pendingTurnId: string): string | undefined {
  const row = database.sqlite.prepare("SELECT user_message_id FROM pending_turns WHERE id = ?").get(pendingTurnId) as { readonly user_message_id: string } | undefined;
  return row !== undefined ? messageText(database.sqlite, row.user_message_id) : undefined;
}

function renderPromptDelta(delta: AgentPromptDelta): string {
  return delta.kind === "first_wake" ? delta.fullRolePrompt : delta.instructions;
}

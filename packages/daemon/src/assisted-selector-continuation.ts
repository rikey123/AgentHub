import type { CommandBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

import type { AssistedSelectorResult } from "@agenthub/orchestrator";

export type AssistedSelectorContinuationOptions = {
  readonly database: AgentHubDatabase;
  readonly getCommandBus: () => CommandBus | undefined;
  readonly assistedSelector?: { readonly continueTurn: (input: { readonly userMessageId: string; readonly completedRunId: string; readonly completedAgentId: string; readonly completedText?: string; readonly history?: string }) => Promise<AssistedSelectorResult> };
};

type RunTerminalRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly room_id: string;
  readonly agent_id: string;
  readonly mode: string;
};

export async function continueAssistedSelectorAfterRun(options: AssistedSelectorContinuationOptions, runId: string): Promise<void> {
  const selector = options.assistedSelector;
  if (selector === undefined) return;
  const run = options.database.sqlite
    .prepare(
      `SELECT runs.id, runs.workspace_id, runs.room_id, runs.agent_id, rooms.mode
       FROM runs
       JOIN rooms ON rooms.id = runs.room_id
       WHERE runs.id = ?`
    )
    .get(runId) as RunTerminalRow | undefined;
  if (run === undefined || run.mode !== "assisted") return;
  const userMessageId = queuedMessageId(options.database, runId);
  if (userMessageId === undefined) return;

  const result = await selector.continueTurn({
    userMessageId,
    completedRunId: runId,
    completedAgentId: run.agent_id,
    completedText: completedRunText(options.database, runId),
    history: recentRoomHistory(options.database, run.room_id)
  });
  if (!("agentId" in result)) return;

  const idempotencyKey = `assisted-selector:${userMessageId}:${result.turnIndex}:${result.agentId}`;
  await Promise.resolve(options.getCommandBus()?.dispatch(
    {
      type: "WakeAgent",
      roomId: run.room_id,
      agentId: result.agentId,
      workspaceId: run.workspace_id,
      reason: "primary_turn",
      messageId: userMessageId,
      idempotencyKey
    },
    { actor: { type: "system" }, traceId: idempotencyKey, idempotencyKey, origin: "internal" }
  ));
}

function completedRunText(database: AgentHubDatabase, runId: string): string {
  const rows = database.sqlite
    .prepare(
      `SELECT id
       FROM messages
       WHERE run_id = ? AND role = 'assistant' AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .all(runId) as { readonly id: string }[];
  return rows.map((row) => messageText(database, row.id)).filter((text) => text.trim().length > 0).join("\n");
}

function recentRoomHistory(database: AgentHubDatabase, roomId: string): string {
  const rows = database.sqlite
    .prepare(
      `SELECT id, role, sender_id
       FROM messages
       WHERE room_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 12`
    )
    .all(roomId) as { readonly id: string; readonly role: string; readonly sender_id: string | null }[];
  return [...rows].reverse().map((row) => `${row.role === "assistant" ? (row.sender_id ?? "agent") : "user"}: ${messageText(database, row.id)}`).filter((line) => line.trim().length > 2).join("\n");
}

function messageText(database: AgentHubDatabase, messageId: string): string {
  const rows = database.sqlite.prepare("SELECT payload FROM message_parts WHERE message_id = ? ORDER BY seq ASC").all(messageId) as { readonly payload: string }[];
  return rows.map((row) => {
    try {
      const parsed = JSON.parse(row.payload) as { readonly text?: unknown };
      return typeof parsed.text === "string" ? parsed.text : "";
    } catch {
      return "";
    }
  }).filter((text) => text.length > 0).join("\n");
}

function queuedMessageId(database: AgentHubDatabase, runId: string): string | undefined {
  const row = database.sqlite
    .prepare("SELECT payload FROM events WHERE run_id = ? AND type = 'agent.run.queued' ORDER BY seq ASC LIMIT 1")
    .get(runId) as { readonly payload: string } | undefined;
  if (row === undefined) return undefined;
  try {
    const payload = JSON.parse(row.payload) as { readonly messageId?: unknown };
    return typeof payload.messageId === "string" && payload.messageId.length > 0 ? payload.messageId : undefined;
  } catch {
    return undefined;
  }
}

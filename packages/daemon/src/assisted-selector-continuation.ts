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

type ThreadMessageRow = {
  readonly id: string;
  readonly role: string;
  readonly senderType: string;
  readonly senderId: string | null;
  readonly senderName: string | null;
};

const MAX_HISTORY_MESSAGES = 16;
const MAX_HISTORY_CHARS = 10_000;
const MAX_MESSAGE_SNIPPET_CHARS = 900;
const MAX_ATTACHMENT_EXCERPT_CHARS = 1_400;

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
    history: recentRoomHistory(options.database, run.room_id, userMessageId)
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
      idempotencyKey,
      ...(result.promptDelta !== undefined ? { promptDelta: result.promptDelta } : {})
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
  return rows.map((row) => messageContent(database, row.id)).filter((text) => text.trim().length > 0).join("\n");
}

function recentRoomHistory(database: AgentHubDatabase, roomId: string, anchorMessageId?: string): string {
  const anchor = anchorMessageId !== undefined
    ? database.sqlite.prepare("SELECT created_at FROM messages WHERE id = ? AND room_id = ? AND deleted_at IS NULL").get(anchorMessageId, roomId) as { readonly created_at: number } | undefined
    : undefined;
  const rows = database.sqlite
    .prepare(
      `SELECT
         m.id,
         m.role,
         m.sender_type AS senderType,
         m.sender_id AS senderId,
         COALESCE(r.name, ap.name, m.sender_id, m.sender_type) AS senderName
       FROM messages m
       LEFT JOIN agent_profiles ap ON ap.id = m.sender_id
       LEFT JOIN room_participants rp ON rp.room_id = m.room_id AND rp.participant_id = m.sender_id AND rp.participant_type = 'agent'
       LEFT JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
       LEFT JOIN roles r ON r.id = ab.role_id
       WHERE m.room_id = ?
         AND m.deleted_at IS NULL
         ${anchor !== undefined ? "AND m.created_at >= ?" : ""}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ?`
    )
    .all(...(anchor !== undefined ? [roomId, anchor.created_at, MAX_HISTORY_MESSAGES] : [roomId, MAX_HISTORY_MESSAGES])) as ThreadMessageRow[];
  const lines = [...rows]
    .reverse()
    .map((row) => renderThreadMessage(database, row))
    .filter((line): line is string => line !== undefined);
  return truncateText(lines.join("\n"), MAX_HISTORY_CHARS);
}

function renderThreadMessage(database: AgentHubDatabase, row: ThreadMessageRow): string | undefined {
  const parts = [
    truncateOptional(messageText(database, row.id), MAX_MESSAGE_SNIPPET_CHARS),
    ...attachmentExcerptsForMessage(database, row.id).map((attachment) => `[File: ${attachment.path}]\n${truncateText(cleanSnippet(attachment.content), MAX_ATTACHMENT_EXCERPT_CHARS)}`)
  ].filter((part): part is string => part !== undefined && part.trim().length > 0);
  if (parts.length === 0) return undefined;
  return `${speakerName(row)}: ${parts.join("\n").replace(/\n/g, "\n  ")}`;
}

function messageContent(database: AgentHubDatabase, messageId: string): string {
  return [
    messageText(database, messageId),
    ...attachmentExcerptsForMessage(database, messageId).map((attachment) => `[File: ${attachment.path}]\n${attachment.content}`)
  ].filter((part) => part.trim().length > 0).join("\n");
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

function attachmentExcerptsForMessage(database: AgentHubDatabase, messageId: string): Array<{ readonly path: string; readonly content: string }> {
  const rows = database.sqlite.prepare("SELECT payload FROM message_parts WHERE message_id = ? AND part_type = 'attachment' ORDER BY seq ASC LIMIT 3").all(messageId) as Array<{ readonly payload: string }>;
  const excerpts: Array<{ readonly path: string; readonly content: string }> = [];
  for (const row of rows) {
    const payload = parseAttachmentPayload(row.payload);
    if (payload === undefined || !isPreviewableAttachment(payload)) continue;
    const content = artifactFileContent(database, payload.artifactId, payload.path);
    if (content === undefined || content.trim().length === 0) continue;
    excerpts.push({ path: payload.path, content });
  }
  return excerpts;
}

function parseAttachmentPayload(value: string): { readonly artifactId: string; readonly path: string; readonly mimeType?: string; readonly previewKind?: string } | undefined {
  try {
    const parsed = JSON.parse(value) as { readonly artifactId?: unknown; readonly path?: unknown; readonly mimeType?: unknown; readonly previewKind?: unknown };
    if (typeof parsed.artifactId !== "string" || parsed.artifactId.length === 0) return undefined;
    if (typeof parsed.path !== "string" || parsed.path.length === 0) return undefined;
    return {
      artifactId: parsed.artifactId,
      path: parsed.path,
      ...(typeof parsed.mimeType === "string" ? { mimeType: parsed.mimeType } : {}),
      ...(typeof parsed.previewKind === "string" ? { previewKind: parsed.previewKind } : {})
    };
  } catch {
    return undefined;
  }
}

function isPreviewableAttachment(payload: { readonly mimeType?: string; readonly previewKind?: string }): boolean {
  if (payload.previewKind === "markdown" || payload.previewKind === "text" || payload.previewKind === "code") return true;
  if (payload.mimeType === undefined) return false;
  const mime = payload.mimeType.toLowerCase();
  return mime.startsWith("text/") || mime.includes("json") || mime.includes("xml") || mime.includes("yaml") || mime.includes("javascript") || mime.includes("typescript");
}

function artifactFileContent(database: AgentHubDatabase, artifactId: string, path: string): string | undefined {
  const exact = database.sqlite.prepare("SELECT new_content AS content FROM artifact_files WHERE artifact_id = ? AND path = ? LIMIT 1").get(artifactId, path) as { readonly content: string | null } | undefined;
  if (exact?.content !== undefined && exact.content !== null) return exact.content;
  const fallback = database.sqlite.prepare("SELECT new_content AS content FROM artifact_files WHERE artifact_id = ? ORDER BY created_at ASC LIMIT 1").get(artifactId) as { readonly content: string | null } | undefined;
  return fallback?.content ?? undefined;
}

function speakerName(row: ThreadMessageRow): string {
  if (row.role === "user" || row.senderType === "user") return "User";
  const name = row.senderName?.trim();
  if (name !== undefined && name.length > 0) return name;
  return row.senderId ?? "Agent";
}

function truncateOptional(value: string, limit: number): string | undefined {
  const cleaned = cleanSnippet(value);
  if (cleaned.length === 0) return undefined;
  return truncateText(cleaned, limit);
}

function cleanSnippet(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
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

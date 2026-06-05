import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import type { EventBus, PublishInput } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

import type { RunRow } from "./run-lifecycle-service.ts";

export type FileMessageService = {
  readonly createFromContent: (input: {
    readonly workspaceId: string;
    readonly roomId: string;
    readonly runId: string;
    readonly agentId: string;
    readonly messageId: string;
    readonly title: string;
    readonly path: string;
    readonly content: string;
    readonly mimeType: string;
    readonly previewKind: "markdown" | "text" | "code";
  }) => {
    readonly artifactId: string;
    readonly path: string;
    readonly name: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly previewKind: "markdown" | "text" | "code";
  };
};

export function persistAssistantPublicMessage(input: {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly run: RunRow;
  readonly messageId: string;
  readonly text: string;
  readonly fileMessageService?: FileMessageService;
  readonly now?: () => number;
}): string {
  const now = input.now?.() ?? Date.now();
  const fileFallback = longReplyFileFallback(input.database, input.run, input.messageId, input.text, input.fileMessageService);
  const publicText = fileFallback?.publicText ?? input.text;
  input.database.sqlite.transaction(() => {
    const nextSeq = ((input.database.sqlite.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM message_parts WHERE message_id = ?").get(input.messageId) as { readonly seq: number }).seq);
    input.database.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, ?, 'text', ?, ?)").run(input.messageId, nextSeq, JSON.stringify({ text: publicText }), now);
    if (fileFallback !== undefined) {
      const file = input.fileMessageService?.createFromContent(fileFallback.file);
      if (file !== undefined) {
        const attachmentSeq = nextSeq + 1;
        const partPayload = { fileId: file.artifactId, artifactId: file.artifactId, path: file.path, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, previewKind: file.previewKind };
        input.database.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, ?, 'attachment', ?, ?)").run(input.messageId, attachmentSeq, JSON.stringify(partPayload), now);
        publishRunEvent(input, "message.part.added", { messageId: input.messageId, part: { type: "attachment", seq: attachmentSeq, ...partPayload } });
      }
    }
    input.database.sqlite.prepare("UPDATE messages SET status = 'completed', updated_at = ? WHERE id = ?").run(now, input.messageId);
    publishRunEvent(input, "message.completed", { messageId: input.messageId, text: publicText });
  })();
  return publicText;
}

function longReplyFileFallback(database: AgentHubDatabase, run: RunRow, messageId: string, text: string, fileMessageService: FileMessageService | undefined): { readonly publicText: string; readonly file: Parameters<FileMessageService["createFromContent"]>[0] } | undefined {
  if (fileMessageService === undefined) return undefined;
  if (run.wake_reason === "plan" || run.room_id === null) return undefined;
  if (!isLongPublicReply(text)) return undefined;
  if (!isMultiAgentRoom(database, run.room_id)) return undefined;
  const existingAttachment = database.sqlite.prepare("SELECT 1 FROM message_parts WHERE message_id = ? AND part_type = 'attachment' LIMIT 1").get(messageId);
  if (existingAttachment !== undefined) return undefined;
  const publicText = summarizePublicReply(text);
  const displayName = agentDisplayName(database, run.room_id, run.agent_id);
  const path = `agent-replies/${safeFileStem(displayName)}-${shortId(run.id)}.md`;
  return {
    publicText,
    file: {
      workspaceId: run.workspace_id,
      roomId: run.room_id,
      runId: run.id,
      agentId: run.agent_id,
      messageId,
      title: `${displayName} reply`,
      path,
      content: text,
      mimeType: "text/markdown",
      previewKind: previewKindForPath(path)
    }
  };
}

export function isLongPublicReply(text: string): boolean {
  const nonEmptyLines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const trimmed = text.trim();
  if (trimmed.length <= 0) return false;
  if (trimmed.length >= 1_800) return true;
  return isSubstantialDeliverable(trimmed, nonEmptyLines);
}

export function summarizePublicReply(text: string): string {
  const leadIn = conversationalLeadIn(text);
  if (leadIn !== undefined) return `${leadIn} 详细内容见文件。`;
  const insight = leadingInsight(text);
  if (insight !== undefined) return `详细内容见文件。我的核心观点是：${insight}`;
  return "详细内容见文件，方便大家继续讨论。";
}

function conversationalLeadIn(text: string): string | undefined {
  const firstNonEmpty = firstNonEmptyLine(text);
  if (firstNonEmpty === undefined) return undefined;
  if (!/^(我(?:先|来|接着|补充|不同意|同意|赞成|想挑战|想澄清|换个角度)|接着|补一句|补充一句)/u.test(firstNonEmpty)) return undefined;
  return truncateSentence(firstNonEmpty, 120);
}

function leadingInsight(text: string): string | undefined {
  const firstNonEmpty = firstNonEmptyLine(text);
  if (firstNonEmpty === undefined || firstNonEmpty.length === 0) return undefined;
  const cleaned = firstNonEmpty
    .replace(/^我(?:先|来|补一个|接着|觉得|认为)?[：:，,\s]*/u, "")
    .replace(/^我(?:补|接着).*?[：:]\s*/u, "")
    .replace(/^\*\*|\*\*$/gu, "")
    .trim();
  const insight = cleaned.length > 0 ? cleaned : firstNonEmpty;
  return insight.length > 96 ? `${insight.slice(0, 93).trimEnd()}...` : insight;
}

function firstNonEmptyLine(text: string): string | undefined {
  return text.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim();
}

function isSubstantialDeliverable(text: string, nonEmptyLines: readonly string[]): boolean {
  if (/```|^\s*\|.+\|\s*$/mu.test(text)) return true;
  const headingCount = nonEmptyLines.filter((line) => /^#{1,3}\s+\S/u.test(line.trim())).length;
  if (headingCount >= 2) return true;
  const numberedItems = nonEmptyLines.filter((line) => /^\s*\d+[.)、]\s+\S/u.test(line)).length;
  const bulletItems = nonEmptyLines.filter((line) => /^\s*[-*]\s+\S/u.test(line)).length;
  if (numberedItems + bulletItems >= 8) return true;
  if (numberedItems + bulletItems >= 5 && text.length >= 200) return true;
  if (headingCount >= 1 && numberedItems + bulletItems >= 4) return true;
  if (/^(#\s+|##\s+)?(方案|计划|清单|规范|规格|报告|评审|PRD|RFC|Spec|Checklist|Plan|Proposal|Review)\b/imu.test(text)) return true;
  return false;
}

function truncateSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function isMultiAgentRoom(database: AgentHubDatabase, roomId: string): boolean {
  const room = database.sqlite.prepare("SELECT mode FROM rooms WHERE id = ?").get(roomId) as { readonly mode: string } | undefined;
  return room?.mode === "assisted" || room?.mode === "team" || room?.mode === "squad";
}

function agentDisplayName(database: AgentHubDatabase, roomId: string, agentId: string): string {
  const role = database.sqlite
    .prepare(
      `SELECT r.name
       FROM room_participants rp
       JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
       JOIN roles r ON r.id = ab.role_id
       WHERE rp.room_id = ? AND rp.participant_id = ? AND rp.participant_type = 'agent'
       LIMIT 1`
    )
    .get(roomId, agentId) as { readonly name: string | null } | undefined;
  if (role?.name !== undefined && role.name !== null && role.name.trim().length > 0) return role.name;
  const row = database.sqlite.prepare("SELECT name FROM agent_profiles WHERE id = ?").get(agentId) as { readonly name: string | null } | undefined;
  return row?.name ?? agentId;
}

function safeFileStem(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    || "agent";
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function previewKindForPath(path: string): "markdown" | "text" | "code" {
  const extension = extname(path).toLowerCase();
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if ([".js", ".jsx", ".ts", ".tsx", ".py", ".rs", ".go", ".java", ".cs", ".cpp", ".c", ".h", ".sql", ".css", ".html", ".json", ".yaml", ".yml", ".toml", ".xml"].includes(extension)) return "code";
  return "text";
}

function publishRunEvent(input: { readonly eventBus: EventBus; readonly run: RunRow; readonly now?: () => number }, type: PublishInput["type"], payload: Record<string, unknown>): void {
  input.eventBus.publish({
    id: randomUUID(),
    type,
    schemaVersion: 1,
    workspaceId: input.run.workspace_id,
    roomId: input.run.room_id,
    ...(input.run.task_id !== null ? { taskId: input.run.task_id } : {}),
    runId: input.run.id,
    agentId: input.run.agent_id,
    payload,
    createdAt: input.now?.() ?? Date.now()
  } satisfies PublishInput);
}

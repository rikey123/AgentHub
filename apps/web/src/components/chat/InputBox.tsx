import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, TextArea } from "@heroui/react";
import type { AgentContactViewModel, ParticipantViewModel } from "../../types.ts";
import { formatBytes } from "../../lib/format.ts";

const DRAFT_PREFIX = "agenthub.draft.";
const MAX_ATTACH_BYTES = 50 * 1024 * 1024;

// 附件 — 回形针图标
function IconPaperclip() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

// 提及 — @ 图标
function IconAt() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </svg>
  );
}

type DraftQuote = { messageId: string; preview: string };

type Attachment = { fileId: string; name: string; sizeBytes: number };

export type ComposerContextRef =
  | { readonly type: "artifact"; readonly artifactId: string; readonly lineStart?: number | undefined; readonly lineEnd?: number | undefined; readonly slide?: number | undefined }
  | { readonly type: "workspace"; readonly path: string; readonly lineStart?: number | undefined; readonly lineEnd?: number | undefined };

export type ComposerReferenceToken = {
  readonly kind: "ref";
  readonly id: string;
  readonly token: string;
  readonly ref: ComposerContextRef;
};

export type ComposerMentionToken = {
  readonly kind: "mention";
  readonly id: string;
  readonly token: string;
  readonly agentBindingId: string;
  readonly label: string;
  readonly roleName?: string | undefined;
  readonly runtimeName?: string | undefined;
  readonly source: "participant" | "contact";
};

export type ComposerToken = ComposerMentionToken | ComposerReferenceToken;

export type ComposerMentionPayload = {
  readonly agentBindingId: string;
  readonly label: string;
  readonly roleName?: string | undefined;
  readonly runtimeName?: string | undefined;
};

export type ComposerSendPayload = {
  readonly text: string;
  readonly attachmentIds: string[];
  readonly mentions: string[];
  readonly mentionPayloads: ComposerMentionPayload[];
  readonly refs: ComposerContextRef[];
};

type StoredDraft = {
  text?: string;
  mentions?: string[];
  composerTokens?: ComposerToken[];
  composerRef?: ComposerContextRef;
  composerReference?: ComposerContextRef;
  quotedMessageId?: string;
  quotePreview?: string;
  quoteInsertText?: string;
  attachments?: Attachment[];
};

type MentionCandidate = {
  readonly agentBindingId: string;
  readonly label: string;
  readonly token: string;
  readonly roleName?: string | undefined;
  readonly runtimeName?: string | undefined;
  readonly subtitle: string;
  readonly source: "participant" | "contact";
};

const REFERENCE_TOKEN_PATTERN = /@(artifact|workspace):([^\s#,]+)(?:#(?:(L(\d+)-L(\d+))|slide=(\d+)))?/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mentionSlug(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function mentionTokenForLabel(label: string): string {
  const slug = mentionSlug(label);
  return slug.length > 0 ? `@${slug}` : `@"${label.replace(/"/g, '\\"')}"`;
}

function mentionCandidateTokenId(candidate: MentionCandidate): string {
  return `mention:${candidate.agentBindingId}`;
}

function mentionTokenFromCandidate(candidate: MentionCandidate): ComposerMentionToken {
  return {
    kind: "mention",
    id: mentionCandidateTokenId(candidate),
    token: candidate.token,
    agentBindingId: candidate.agentBindingId,
    label: candidate.label,
    roleName: candidate.roleName,
    runtimeName: candidate.runtimeName,
    source: candidate.source
  };
}

function participantMentionCandidate(participant: ParticipantViewModel): MentionCandidate | undefined {
  if (participant.role === "user") return undefined;
  const agentBindingId = participant.agentBindingId ?? participant.id;
  if (agentBindingId.length === 0) return undefined;
  return {
    agentBindingId,
    label: participant.name,
    token: mentionTokenForLabel(participant.name),
    roleName: participant.roleId ?? participant.role,
    runtimeName: participant.adapterId,
    subtitle: `${participant.role} / ${participant.presence}`,
    source: "participant"
  };
}

function contactMentionCandidate(contact: AgentContactViewModel): MentionCandidate {
  return {
    agentBindingId: contact.agentBindingId,
    label: contact.displayName,
    token: mentionTokenForLabel(contact.displayName),
    roleName: contact.roleId,
    runtimeName: contact.runtimeKind,
    subtitle: `${contact.runtimeKind} / ${contact.status}`,
    source: "contact"
  };
}

function mergeMentionCandidates(candidates: ReadonlyArray<MentionCandidate>): MentionCandidate[] {
  const seen = new Set<string>();
  const merged: MentionCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.agentBindingId)) continue;
    seen.add(candidate.agentBindingId);
    merged.push(candidate);
  }
  return merged;
}

function normalizeAgentContactPayload(payload: unknown): AgentContactViewModel[] {
  const rows = isRecord(payload) && Array.isArray(payload.contacts)
    ? payload.contacts
    : Array.isArray(payload)
      ? payload
      : [];
  return rows.flatMap((row): AgentContactViewModel[] => {
    if (!isRecord(row)) return [];
    const agentBindingId = stringField(row.agentBindingId) ?? stringField(row.agent_binding_id) ?? stringField(row.id);
    const displayName = stringField(row.displayName) ?? stringField(row.display_name) ?? stringField(row.contactName) ?? stringField(row.contact_name) ?? agentBindingId;
    if (!agentBindingId || !displayName) return [];
    return [{
      agentBindingId,
      displayName,
      avatarUrl: stringField(row.avatarUrl) ?? stringField(row.avatar_url),
      roleId: stringField(row.roleId) ?? stringField(row.role_id) ?? "",
      runtimeKind: stringField(row.runtimeKind) ?? stringField(row.runtime_kind) ?? stringField(row.runtimeName) ?? stringField(row.runtime_name) ?? "",
      capabilities: Array.isArray(row.capabilities) ? row.capabilities.filter((item): item is string => typeof item === "string") : [],
      status: row.status === "busy" || row.status === "offline" ? row.status : "available",
      description: stringField(row.description),
      lastUsedAt: numberField(row.lastUsedAt) ?? numberField(row.last_used_at)
    }];
  });
}

function referenceTokenId(ref: ComposerContextRef): string {
  if (ref.type === "artifact") {
    if (typeof ref.slide === "number") return `ref:artifact:${ref.artifactId}:slide:${ref.slide}`;
    if (typeof ref.lineStart === "number" && typeof ref.lineEnd === "number") return `ref:artifact:${ref.artifactId}:lines:${ref.lineStart}-${ref.lineEnd}`;
    return `ref:artifact:${ref.artifactId}`;
  }
  if (typeof ref.lineStart === "number" && typeof ref.lineEnd === "number") return `ref:workspace:${ref.path}:lines:${ref.lineStart}-${ref.lineEnd}`;
  return `ref:workspace:${ref.path}`;
}

export function tokenForComposerRef(ref: ComposerContextRef): string {
  if (ref.type === "artifact") {
    if (typeof ref.slide === "number") return `@artifact:${ref.artifactId}#slide=${ref.slide}`;
    if (typeof ref.lineStart === "number" && typeof ref.lineEnd === "number") return `@artifact:${ref.artifactId}#L${ref.lineStart}-L${ref.lineEnd}`;
    return `@artifact:${ref.artifactId}`;
  }
  if (typeof ref.lineStart === "number" && typeof ref.lineEnd === "number") return `@workspace:${ref.path}#L${ref.lineStart}-L${ref.lineEnd}`;
  return `@workspace:${ref.path}`;
}

export function parseComposerReferenceTokens(text: string): ComposerReferenceToken[] {
  const tokens: ComposerReferenceToken[] = [];
  for (const match of text.matchAll(REFERENCE_TOKEN_PATTERN)) {
    const kind = match[1]?.toLowerCase();
    const target = match[2];
    const lineStart = Number(match[4]);
    const lineEnd = Number(match[5]);
    const slide = Number(match[6]);
    const token = match[0];
    if (!target) continue;

    let ref: ComposerContextRef | undefined;
    if (kind === "artifact") {
      if (Number.isFinite(slide)) ref = { type: "artifact", artifactId: target, slide };
      else if (Number.isFinite(lineStart) && Number.isFinite(lineEnd)) ref = { type: "artifact", artifactId: target, lineStart, lineEnd };
      else ref = { type: "artifact", artifactId: target };
    } else if (kind === "workspace" && Number.isFinite(lineStart) && Number.isFinite(lineEnd)) {
      ref = { type: "workspace", path: target, lineStart, lineEnd };
    }
    if (ref) tokens.push({ kind: "ref", id: referenceTokenId(ref), token, ref });
  }
  return mergeReferenceTokens(tokens);
}

function composerRefKey(ref: ComposerContextRef): string {
  return JSON.stringify(ref);
}

function mergeReferenceTokens(...groups: ReadonlyArray<ReadonlyArray<ComposerReferenceToken>>): ComposerReferenceToken[] {
  const seen = new Set<string>();
  const merged: ComposerReferenceToken[] = [];
  for (const group of groups) {
    for (const token of group) {
      const key = composerRefKey(token.ref);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(token);
    }
  }
  return merged;
}

function mergeMentionTokens(tokens: ReadonlyArray<ComposerMentionToken>): ComposerMentionToken[] {
  const seen = new Set<string>();
  const merged: ComposerMentionToken[] = [];
  for (const token of tokens) {
    if (seen.has(token.agentBindingId)) continue;
    seen.add(token.agentBindingId);
    merged.push(token);
  }
  return merged;
}

function normalizeComposerTokens(value: unknown): ComposerToken[] {
  if (!Array.isArray(value)) return [];
  const tokens: ComposerToken[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (item.kind === "mention") {
      const agentBindingId = stringField(item.agentBindingId);
      const label = stringField(item.label);
      const token = stringField(item.token);
      if (!agentBindingId || !label || !token) continue;
      tokens.push({
        kind: "mention",
        id: stringField(item.id) ?? `mention:${agentBindingId}`,
        token,
        agentBindingId,
        label,
        roleName: stringField(item.roleName),
        runtimeName: stringField(item.runtimeName),
        source: item.source === "contact" ? "contact" : "participant"
      });
      continue;
    }
    if (item.kind === "ref" && isRecord(item.ref)) {
      const ref = normalizeComposerRef(item.ref);
      if (!ref) continue;
      tokens.push({
        kind: "ref",
        id: stringField(item.id) ?? referenceTokenId(ref),
        token: stringField(item.token) ?? tokenForComposerRef(ref),
        ref
      });
    }
  }
  return tokens;
}

function normalizeComposerRef(value: Record<string, unknown>): ComposerContextRef | undefined {
  if (value.type === "artifact") {
    const artifactId = stringField(value.artifactId);
    if (!artifactId) return undefined;
    const slide = numberField(value.slide);
    const lineStart = numberField(value.lineStart);
    const lineEnd = numberField(value.lineEnd);
    if (slide !== undefined) return { type: "artifact", artifactId, slide };
    if (lineStart !== undefined && lineEnd !== undefined) return { type: "artifact", artifactId, lineStart, lineEnd };
    return { type: "artifact", artifactId };
  }
  if (value.type === "workspace") {
    const path = stringField(value.path);
    if (!path) return undefined;
    const lineStart = numberField(value.lineStart);
    const lineEnd = numberField(value.lineEnd);
    return lineStart !== undefined && lineEnd !== undefined ? { type: "workspace", path, lineStart, lineEnd } : { type: "workspace", path };
  }
  return undefined;
}

function splitComposerTokens(tokens: ReadonlyArray<ComposerToken>): { mentions: ComposerMentionToken[]; refs: ComposerReferenceToken[] } {
  return {
    mentions: mergeMentionTokens(tokens.filter((token): token is ComposerMentionToken => token.kind === "mention")),
    refs: mergeReferenceTokens(tokens.filter((token): token is ComposerReferenceToken => token.kind === "ref"))
  };
}

function mentionPayload(token: ComposerMentionToken): ComposerMentionPayload {
  return {
    agentBindingId: token.agentBindingId,
    label: token.label,
    ...(token.roleName ? { roleName: token.roleName } : {}),
    ...(token.runtimeName ? { runtimeName: token.runtimeName } : {})
  };
}

export function buildComposerSendPayload(input: {
  readonly text: string;
  readonly attachments: ReadonlyArray<Attachment>;
  readonly mentionTokens: ReadonlyArray<ComposerMentionToken>;
  readonly referenceTokens: ReadonlyArray<ComposerReferenceToken>;
  readonly legacyMentions?: ReadonlyArray<string> | undefined;
}): ComposerSendPayload {
  const mentionTokens = mergeMentionTokens(input.mentionTokens);
  const refs = mergeReferenceTokens(input.referenceTokens, parseComposerReferenceTokens(input.text)).map((token) => token.ref);
  const mentions = Array.from(new Set([...(input.legacyMentions ?? []), ...mentionTokens.map((token) => token.agentBindingId)]));
  return {
    text: input.text.trim(),
    attachmentIds: input.attachments.map((attachment) => attachment.fileId),
    mentions,
    mentionPayloads: mentionTokens.map(mentionPayload),
    refs
  };
}

function textWithAppendedToken(text: string | undefined, token: string): string {
  const base = (text ?? "").trimEnd();
  if (base.length === 0) return token;
  return base.endsWith(token) ? base : `${base} ${token}`;
}

export function buildDraftWithComposerReference(draft: StoredDraft, ref: ComposerContextRef): StoredDraft {
  const token = tokenForComposerRef(ref);
  const existing = normalizeComposerTokens(draft.composerTokens);
  const nextRef: ComposerReferenceToken = { kind: "ref", id: referenceTokenId(ref), token, ref };
  return {
    ...draft,
    text: textWithAppendedToken(draft.text, token),
    composerTokens: [...existing.filter((item) => item.kind !== "ref" || composerRefKey(item.ref) !== composerRefKey(ref)), nextRef]
  };
}

function composerTokenTestId(token: ComposerToken): string {
  if (token.kind === "mention") return `composer-pill-mention-${sanitizeTestId(token.agentBindingId)}`;
  if (token.ref.type === "artifact") {
    if (typeof token.ref.slide === "number") return `composer-pill-ref-artifact-${sanitizeTestId(token.ref.artifactId)}-slide-${token.ref.slide}`;
    if (typeof token.ref.lineStart === "number" && typeof token.ref.lineEnd === "number") return `composer-pill-ref-artifact-${sanitizeTestId(token.ref.artifactId)}-lines-${token.ref.lineStart}-${token.ref.lineEnd}`;
    return `composer-pill-ref-artifact-${sanitizeTestId(token.ref.artifactId)}`;
  }
  if (typeof token.ref.lineStart === "number" && typeof token.ref.lineEnd === "number") return `composer-pill-ref-workspace-${sanitizeTestId(token.ref.path)}-lines-${token.ref.lineStart}-${token.ref.lineEnd}`;
  return `composer-pill-ref-workspace-${sanitizeTestId(token.ref.path)}`;
}

function sanitizeTestId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ComposerPillList({ tokens, onRemove }: { readonly tokens: ReadonlyArray<ComposerToken>; readonly onRemove?: ((token: ComposerToken) => void) | undefined }) {
  if (tokens.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Composer tokens">
      {tokens.map((token) => (
        <span key={token.id} data-testid={composerTokenTestId(token)}>
          <Chip size="sm" variant="soft" color={token.kind === "mention" ? "accent" : "default"}>
            <span className="ah-mono">{token.token}</span>
            {onRemove ? (
              <button
                type="button"
                aria-label={`Remove ${token.token}`}
                className="ml-1 text-muted hover:text-foreground"
                onClick={() => onRemove(token)}
              >
                x
              </button>
            ) : null}
          </Chip>
        </span>
      ))}
    </div>
  );
}

export function insertTextAtSelection(currentText: string, insertion: string, selectionStart: number, selectionEnd: number): { text: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, currentText.length));
  const end = Math.max(start, Math.min(selectionEnd, currentText.length));
  return {
    text: `${currentText.slice(0, start)}${insertion}${currentText.slice(end)}`,
    cursor: start + insertion.length
  };
}

interface InputBoxProps {
  roomId: string;
  participants: ReadonlyArray<ParticipantViewModel>;
  connectionStatus: "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";
  pendingCount: number;
  /** Most recent pending-turn message id; ArrowUp in an empty input jumps to editing it. */
  latestPendingMessageId?: string | undefined;
  editingTurnId?: string | undefined;
  onCancelEdit?: () => void;
  onRequestEdit?: ((messageId: string) => void) | undefined;
  csrfFetch: typeof fetch;
  onSend: (input: ComposerSendPayload & { readonly quotedMessageId?: string }) => Promise<void> | void;
  onEditSend?: (messageId: string, input: ComposerSendPayload) => Promise<void> | void;
}

export function InputBox(props: InputBoxProps) {
  const draftKey = `${DRAFT_PREFIX}${props.roomId}`;
  const [text, setText] = useState("");
  const [quote, setQuote] = useState<DraftQuote | undefined>(undefined);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [composerTokens, setComposerTokens] = useState<ComposerToken[]>([]);
  const [contacts, setContacts] = useState<AgentContactViewModel[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | undefined>(undefined);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef(text);
  const composerTokensRef = useRef<ComposerToken[]>([]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    composerTokensRef.current = composerTokens;
  }, [composerTokens]);

  const canSend = props.connectionStatus === "connected" && (text.trim().length > 0 || attachments.length > 0);
  const queueFull = props.pendingCount >= 20;
  const activeParticipants = props.participants.filter((p) => p.presence !== "offline");
  const agentCount = props.participants.filter((p) => p.role !== "user").length;
  const parsedReferenceTokens = useMemo(() => parseComposerReferenceTokens(text), [text]);
  const visibleComposerTokens = useMemo(() => {
    const split = splitComposerTokens(composerTokens);
    return [...split.mentions, ...mergeReferenceTokens(split.refs, parsedReferenceTokens)];
  }, [composerTokens, parsedReferenceTokens]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredDraft;
        if (typeof parsed.text === "string") setText(parsed.text);
        if (Array.isArray(parsed.mentions)) setMentions(parsed.mentions);
        setComposerTokens(normalizeComposerTokens(parsed.composerTokens));
        if (parsed.quotedMessageId) setQuote({ messageId: parsed.quotedMessageId, preview: parsed.quotePreview ?? "" });
        if (Array.isArray(parsed.attachments)) setAttachments(parsed.attachments);
      }
    } catch {
      // ignore corrupt draft cache
    }
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== draftKey || ev.newValue === null) return;
      try {
        const parsed = JSON.parse(ev.newValue) as StoredDraft;
        let nextText = typeof parsed.text === "string" ? parsed.text : textRef.current;
        let nextTokens = normalizeComposerTokens(parsed.composerTokens);
        if (nextTokens.length === 0) nextTokens = composerTokensRef.current;
        const draftRef = parsed.composerRef ?? parsed.composerReference;
        if (draftRef !== undefined) {
          const normalizedRef = isRecord(draftRef) ? normalizeComposerRef(draftRef) : undefined;
          if (normalizedRef) {
            const nextDraft = buildDraftWithComposerReference({ ...parsed, text: nextText, composerTokens: nextTokens }, normalizedRef);
            nextText = nextDraft.text ?? nextText;
            nextTokens = normalizeComposerTokens(nextDraft.composerTokens);
            delete parsed.composerRef;
            delete parsed.composerReference;
          }
        }
        if (typeof parsed.quoteInsertText === "string" && parsed.quoteInsertText.length > 0) {
          nextText = textRef.current;
          const selectionStart = taRef.current?.selectionStart ?? nextText.length;
          const selectionEnd = taRef.current?.selectionEnd ?? selectionStart;
          const inserted = insertTextAtSelection(nextText, parsed.quoteInsertText, selectionStart, selectionEnd);
          nextText = inserted.text;
          parsed.text = inserted.text;
          delete parsed.quoteInsertText;
          requestAnimationFrame(() => {
            taRef.current?.focus();
            taRef.current?.setSelectionRange(inserted.cursor, inserted.cursor);
          });
          const newValue = JSON.stringify(parsed);
          try {
            sessionStorage.setItem(draftKey, newValue);
            window.dispatchEvent(new StorageEvent("storage", { key: draftKey, newValue }));
          } catch {
            // ignore unavailable storage
          }
        }
        textRef.current = nextText;
        setText(nextText);
        if (Array.isArray(parsed.mentions)) setMentions(parsed.mentions);
        setComposerTokens(nextTokens);
        setQuote(parsed.quotedMessageId ? { messageId: parsed.quotedMessageId, preview: parsed.quotePreview ?? "" } : undefined);
        setAttachments(Array.isArray(parsed.attachments) ? parsed.attachments : []);
      } catch {
        // ignore corrupt draft cache
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [draftKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ text, mentions, composerTokens, quotedMessageId: quote?.messageId, quotePreview: quote?.preview, attachments })
      );
    } catch {
      // ignore unavailable storage
    }
  }, [draftKey, text, mentions, composerTokens, quote, attachments]);

  useEffect(() => {
    if (mentionQuery === undefined) return;
    let cancelled = false;
    void props.csrfFetch("/agents/contacts", { credentials: "same-origin", headers: { accept: "application/json" } })
      .then((response) => response.ok ? response.json() : undefined)
      .then((payload: unknown) => {
        if (!cancelled && payload !== undefined) setContacts(normalizeAgentContactPayload(payload));
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => { cancelled = true; };
  }, [mentionQuery, props.csrfFetch]);

  const filteredMentions = useMemo(() => {
    if (mentionQuery === undefined) return [];
    const q = mentionQuery.toLowerCase();
    const candidates = mergeMentionCandidates([
      ...props.participants.flatMap((participant) => {
        const candidate = participantMentionCandidate(participant);
        return candidate ? [candidate] : [];
      }),
      ...contacts.map(contactMentionCandidate)
    ]);
    return candidates
      .filter((candidate) =>
        candidate.label.toLowerCase().includes(q) ||
        candidate.agentBindingId.toLowerCase().includes(q) ||
        candidate.token.toLowerCase().includes(q) ||
        (candidate.roleName ?? "").toLowerCase().includes(q) ||
        (candidate.runtimeName ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [contacts, mentionQuery, props.participants]);

  useEffect(() => {
    setMentionHighlight(0);
  }, [mentionQuery]);

  const handleChange = (next: string) => {
    textRef.current = next;
    setText(next);
    const cursor = taRef.current?.selectionStart ?? next.length;
    const upToCursor = next.slice(0, cursor);
    const at = upToCursor.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(upToCursor[at - 1] ?? ""))) {
      const tail = upToCursor.slice(at + 1);
      if (!tail.includes(" ")) {
        setMentionQuery(tail);
        return;
      }
    }
    setMentionQuery(undefined);
  };

  const insertMention = (candidate: MentionCandidate) => {
    if (mentionQuery === undefined) return;
    const cursor = taRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const at = before.lastIndexOf("@");
    if (at < 0) return;
    const mentionText = candidate.token;
    const newText = before.slice(0, at) + `${mentionText} ` + after;
    textRef.current = newText;
    setText(newText);
    setMentionQuery(undefined);
    setMentions((prev) => Array.from(new Set([...prev, candidate.agentBindingId])));
    setComposerTokens((prev): ComposerToken[] => [
      ...mergeMentionTokens([
        ...prev.filter((token): token is ComposerMentionToken => token.kind === "mention"),
        mentionTokenFromCandidate(candidate)
      ]),
      ...prev.filter((token): token is ComposerReferenceToken => token.kind === "ref")
    ]);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const removeComposerToken = (token: ComposerToken) => {
    setComposerTokens((prev) => prev.filter((item) => item.id !== token.id));
    setText((current) => {
      const next = current.replace(token.token, "").replace(/\s{2,}/g, " ").trimStart();
      textRef.current = next;
      return next;
    });
    if (token.kind === "mention") {
      setMentions((prev) => prev.filter((agentBindingId) => agentBindingId !== token.agentBindingId));
    }
  };

  const startMention = () => {
    const cursor = taRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const prefix = before.length === 0 || /\s$/.test(before) ? "@" : " @";
    const next = before + prefix + after;
    const nextCursor = before.length + prefix.length;
    textRef.current = next;
    setText(next);
    setMentionQuery("");
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const uploadFiles = async (files: FileList | File[]) => {
    setError(undefined);
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACH_BYTES) {
        setError(`${file.name} exceeds 50MB`);
        continue;
      }
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await props.csrfFetch("/attachments", { method: "POST", body: fd, headers: {} });
        if (!res.ok) {
          setError(`Upload failed (${res.status})`);
          continue;
        }
        const json = await res.json() as { id?: string; fileId?: string; name?: string; sizeBytes?: number };
        const fileId = json.id ?? json.fileId;
        if (!fileId) continue;
        next.push({ fileId, name: json.name ?? file.name, sizeBytes: json.sizeBytes ?? file.size });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
  };

  const send = async () => {
    if (!canSend || isSending || queueFull) return;
    setIsSending(true);
    setError(undefined);
    try {
      const split = splitComposerTokens(composerTokens);
      const input = buildComposerSendPayload({
        text,
        attachments,
        mentionTokens: split.mentions,
        referenceTokens: mergeReferenceTokens(split.refs, parsedReferenceTokens),
        legacyMentions: mentions
      });
      if (props.editingTurnId && props.onEditSend) {
        await props.onEditSend(props.editingTurnId, input);
      } else {
        await props.onSend({ ...input, ...(quote ? { quotedMessageId: quote.messageId } : {}) });
      }
      setText("");
      setQuote(undefined);
      setAttachments([]);
      setMentions([]);
      setComposerTokens([]);
      try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/\b409\b|already (started|consumed|scheduled)/i.test(message)) {
        setError("This message has already started processing; edit no longer applies.");
      } else {
        setError(message);
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className={[
        "border-t border-border bg-[linear-gradient(180deg,color-mix(in_oklab,var(--surface)_86%,transparent),var(--surface-secondary))] px-4 py-3 shadow-[0_-16px_40px_color-mix(in_oklab,var(--accent)_10%,transparent)] backdrop-blur",
        dragOver ? "outline outline-2 outline-dashed outline-accent" : ""
      ].join(" ")}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) {
          void uploadFiles(e.dataTransfer.files);
        }
      }}
    >
      <div className="mx-auto max-w-[960px]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted">
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="soft" color={props.connectionStatus === "connected" ? "success" : "warning"}>
              {props.connectionStatus === "connected" ? "就绪" : props.connectionStatus}
            </Chip>
            <span>{activeParticipants.length} 活跃成员</span>
            <span>{agentCount} Agents</span>
            {props.pendingCount > 0 ? <span>{props.pendingCount} 待处理</span> : null}
          </div>
          {queueFull ? <span className="text-warning-soft-foreground">已达队列上限</span> : null}
        </div>

        {props.editingTurnId ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-warning bg-warning-soft px-3 py-2 text-xs shadow-sm">
            <span className="flex-1">Editing queued message <span className="ah-mono text-muted">{props.editingTurnId?.slice(0, 8)}</span></span>
            <Button size="sm" variant="ghost" onPress={() => props.onCancelEdit?.()}>Cancel edit</Button>
          </div>
        ) : null}

        {quote ? (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-accent bg-accent-soft px-3 py-2 text-xs shadow-sm">
            <span className="flex-1 truncate">引用：{quote.preview || quote.messageId}</span>
            <Button isIconOnly size="sm" variant="ghost" onPress={() => setQuote(undefined)} aria-label="移除引用">x</Button>
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((att) => (
              <Chip key={att.fileId} size="sm" variant="soft" color="default">
                <span className="ah-mono">{att.name} / {formatBytes(att.sizeBytes)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${att.name}`}
                  className="ml-1 text-muted hover:text-foreground"
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.fileId !== att.fileId))}
                >
                  x
                </button>
              </Chip>
            ))}
          </div>
        ) : null}

        <ComposerPillList tokens={visibleComposerTokens} onRemove={removeComposerToken} />

        {mentionQuery !== undefined && filteredMentions.length > 0 ? (
          <ul
            role="listbox"
            aria-label="Mention participants and contacts"
            className="mb-2 grid max-h-48 gap-1 overflow-auto rounded-2xl border border-border bg-overlay p-1.5 shadow-[var(--overlay-shadow)] sm:grid-cols-2"
          >
            {filteredMentions.map((candidate, i) => {
              const active = i === mentionHighlight;
              return (
                <li
                  key={candidate.agentBindingId}
                  role="option"
                  aria-selected={active}
                  data-testid={`mention-candidate-${candidate.agentBindingId}`}
                  onMouseEnter={() => setMentionHighlight(i)}
                  onClick={() => insertMention(candidate)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      insertMention(candidate);
                    }
                  }}
                  tabIndex={0}
                  className={[
                    "cursor-pointer rounded-xl px-3 py-2 text-sm transition-colors",
                    active ? "bg-accent-soft text-accent-soft-foreground" : "hover:bg-default"
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-secondary text-xs uppercase text-muted">
                      {candidate.label.slice(0, 2)}
                    </span>
                    <span className="truncate">{candidate.label}</span>
                    <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] uppercase text-muted">{candidate.source}</span>
                  </div>
                  <div className="mt-0.5 truncate pl-9 text-xs text-muted">{candidate.subtitle}</div>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div
          className={[
            "overflow-hidden rounded-2xl border bg-overlay shadow-[var(--surface-shadow)] transition-colors",
            dragOver ? "border-accent bg-accent-soft" : "border-border"
          ].join(" ")}
        >
          <div className="px-3 pt-3">
            <TextArea
              ref={taRef as never}
              value={text}
              onChange={(e) => handleChange(e.currentTarget.value)}
              aria-label="Message"
              data-testid="message-input"
              placeholder={
                props.connectionStatus !== "connected" ? "已断开连接" :
                queueFull ? "队列已满" :
                "输入消息..."
              }
              className="min-h-[72px] max-h-40 w-full"
              disabled={props.connectionStatus !== "connected" || queueFull}
              onKeyDown={(e) => {
                const popoverOpen = mentionQuery !== undefined && filteredMentions.length > 0;
                if (popoverOpen && e.key === "Tab") {
                  e.preventDefault();
                  const len = filteredMentions.length;
                  setMentionHighlight((h) => (e.shiftKey ? (h - 1 + len) % len : (h + 1) % len));
                  return;
                }
                if (popoverOpen && e.key === "Enter") {
                  e.preventDefault();
                  const target = filteredMentions[mentionHighlight];
                  if (target) insertMention(target);
                  return;
                }
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void send();
                } else if (e.key === "Enter" && !e.shiftKey && mentionQuery === undefined) {
                  e.preventDefault();
                  void send();
                } else if (e.key === "Escape" && mentionQuery !== undefined) {
                  setMentionQuery(undefined);
                } else if (e.key === "ArrowUp" && text.length === 0 && !props.editingTurnId && props.latestPendingMessageId !== undefined && props.onRequestEdit !== undefined) {
                  e.preventDefault();
                  props.onRequestEdit(props.latestPendingMessageId);
                }
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface/70 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                aria-label="附件"
                className="ah-sr-only"
                onChange={(event) => {
                  const files = event.currentTarget.files;
                  if (files && files.length > 0) void uploadFiles(files);
                  event.currentTarget.value = "";
                }}
              />
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => fileInputRef.current?.click()}
                isDisabled={props.connectionStatus !== "connected"}
                aria-label="附件"
              >
                <IconPaperclip />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={startMention}
                isDisabled={props.connectionStatus !== "connected" || queueFull}
                aria-label="提及 Agent"
              >
                <IconAt />
              </Button>
              {attachments.length > 0 ? (
                <Chip size="sm" variant="soft" color="accent">{attachments.length} 个文件</Chip>
              ) : null}
            </div>
            <Button
              variant="primary"
              size="md"
              className="min-w-24 rounded-full"
              isPending={isSending}
              isDisabled={!canSend || queueFull}
              onPress={() => void send()}
              data-testid="message-send"
            >
              {props.editingTurnId ? "保存" : "发送"}
            </Button>
          </div>
        </div>

        {error ? <p className="mt-2 px-1 text-xs text-danger" role="alert">{error}</p> : null}
        {props.connectionStatus !== "connected" ? (
          <span className="ah-sr-only" aria-live="polite">Connection: {props.connectionStatus}</span>
        ) : null}
      </div>
    </div>
  );
}

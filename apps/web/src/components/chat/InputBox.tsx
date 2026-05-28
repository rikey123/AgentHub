import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, TextArea } from "@heroui/react";
import type { ParticipantViewModel } from "../../types.ts";
import { formatBytes } from "../../lib/format.ts";

const DRAFT_PREFIX = "agenthub.draft.";
const MAX_ATTACH_BYTES = 50 * 1024 * 1024;

type DraftQuote = { messageId: string; preview: string };

type Attachment = { fileId: string; name: string; sizeBytes: number };

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
  onSend: (input: { text: string; quotedMessageId?: string; attachmentIds: string[]; mentions: string[] }) => Promise<void> | void;
  onEditSend?: (messageId: string, input: { text: string; attachmentIds: string[]; mentions: string[] }) => Promise<void> | void;
}

export function InputBox(props: InputBoxProps) {
  const draftKey = `${DRAFT_PREFIX}${props.roomId}`;
  const [text, setText] = useState("");
  const [quote, setQuote] = useState<DraftQuote | undefined>(undefined);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | undefined>(undefined);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = props.connectionStatus === "connected" && (text.trim().length > 0 || attachments.length > 0);
  const queueFull = props.pendingCount >= 20;
  const activeParticipants = props.participants.filter((p) => p.presence !== "offline");
  const agentCount = props.participants.filter((p) => p.role !== "user").length;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { text?: string; mentions?: string[]; quotedMessageId?: string; quotePreview?: string; attachments?: Attachment[] };
        if (typeof parsed.text === "string") setText(parsed.text);
        if (Array.isArray(parsed.mentions)) setMentions(parsed.mentions);
        if (parsed.quotedMessageId) setQuote({ messageId: parsed.quotedMessageId, preview: parsed.quotePreview ?? "" });
        if (Array.isArray(parsed.attachments)) setAttachments(parsed.attachments);
      }
    } catch {
      // ignore corrupt draft cache
    }
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== draftKey || ev.newValue === null) return;
      try {
        const parsed = JSON.parse(ev.newValue) as { text?: string; mentions?: string[]; quotedMessageId?: string; quotePreview?: string; attachments?: Attachment[] };
        if (typeof parsed.text === "string") setText(parsed.text);
        if (Array.isArray(parsed.mentions)) setMentions(parsed.mentions);
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
        JSON.stringify({ text, mentions, quotedMessageId: quote?.messageId, quotePreview: quote?.preview, attachments })
      );
    } catch {
      // ignore unavailable storage
    }
  }, [draftKey, text, mentions, quote, attachments]);

  const filteredMentions = useMemo(() => {
    if (mentionQuery === undefined) return [];
    const q = mentionQuery.toLowerCase();
    return props.participants
      .filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.role.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mentionQuery, props.participants]);

  useEffect(() => {
    setMentionHighlight(0);
  }, [mentionQuery]);

  const handleChange = (next: string) => {
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

  const insertMention = (p: ParticipantViewModel) => {
    if (mentionQuery === undefined) return;
    const cursor = taRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const at = before.lastIndexOf("@");
    if (at < 0) return;
    const slug = p.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const newText = before.slice(0, at) + `@${slug} ` + after;
    setText(newText);
    setMentionQuery(undefined);
    setMentions((prev) => Array.from(new Set([...prev, p.id])));
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const startMention = () => {
    const cursor = taRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const prefix = before.length === 0 || /\s$/.test(before) ? "@" : " @";
    const next = before + prefix + after;
    const nextCursor = before.length + prefix.length;
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
      const input = {
        text: text.trim(),
        attachmentIds: attachments.map((a) => a.fileId),
        mentions
      };
      if (props.editingTurnId && props.onEditSend) {
        await props.onEditSend(props.editingTurnId, input);
      } else {
        await props.onSend({ ...input, ...(quote ? { quotedMessageId: quote.messageId } : {}) });
      }
      setText("");
      setQuote(undefined);
      setAttachments([]);
      setMentions([]);
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
              {props.connectionStatus === "connected" ? "Ready" : props.connectionStatus}
            </Chip>
            <span>{activeParticipants.length} active</span>
            <span>{agentCount} agents</span>
            {props.pendingCount > 0 ? <span>{props.pendingCount} pending</span> : null}
          </div>
          {queueFull ? <span className="text-warning-soft-foreground">Queue limit reached</span> : null}
        </div>

        {props.editingTurnId ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-warning bg-warning-soft px-3 py-2 text-xs shadow-sm">
            <span className="flex-1">Editing queued message <span className="ah-mono text-muted">{props.editingTurnId?.slice(0, 8)}</span></span>
            <Button size="sm" variant="ghost" onPress={() => props.onCancelEdit?.()}>Cancel edit</Button>
          </div>
        ) : null}

        {quote ? (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-accent bg-accent-soft px-3 py-2 text-xs shadow-sm">
            <span className="flex-1 truncate">Quoting: {quote.preview || quote.messageId}</span>
            <Button isIconOnly size="sm" variant="ghost" onPress={() => setQuote(undefined)} aria-label="Remove quote">x</Button>
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

        {mentionQuery !== undefined && filteredMentions.length > 0 ? (
          <ul
            role="listbox"
            aria-label="Mention participants"
            className="mb-2 grid max-h-48 gap-1 overflow-auto rounded-2xl border border-border bg-overlay p-1.5 shadow-[var(--overlay-shadow)] sm:grid-cols-2"
          >
            {filteredMentions.map((p, i) => {
              const active = i === mentionHighlight;
              return (
                <li
                  key={p.id}
                  role="option"
                  aria-selected={active}
                  data-testid={`mention-candidate-${p.id}`}
                  onMouseEnter={() => setMentionHighlight(i)}
                  onClick={() => insertMention(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      insertMention(p);
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
                      {p.name.slice(0, 2)}
                    </span>
                    <span className="truncate">{p.name}</span>
                  </div>
                  <div className="mt-0.5 truncate pl-9 text-xs text-muted">{p.role} / {p.presence}</div>
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
                props.connectionStatus !== "connected" ? "Disconnected" :
                queueFull ? "Queue full" :
                "Message this room..."
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
                aria-label="Attach files"
                className="ah-sr-only"
                onChange={(event) => {
                  const files = event.currentTarget.files;
                  if (files && files.length > 0) void uploadFiles(files);
                  event.currentTarget.value = "";
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                onPress={() => fileInputRef.current?.click()}
                isDisabled={props.connectionStatus !== "connected"}
                aria-label="Attach files"
              >
                Attach
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={startMention}
                isDisabled={props.connectionStatus !== "connected" || queueFull}
                aria-label="Mention agent"
              >
                @ Agent
              </Button>
              {attachments.length > 0 ? (
                <Chip size="sm" variant="soft" color="accent">{attachments.length} files</Chip>
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
              {props.editingTurnId ? "Save" : "Send"}
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

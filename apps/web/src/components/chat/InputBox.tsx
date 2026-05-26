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
  /** Most recent pending-turn message id; ↑ key in an empty input jumps to editing it. */
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

  const canSend = props.connectionStatus === "connected" && (text.trim().length > 0 || attachments.length > 0);
  const queueFull = props.pendingCount >= 20;

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
      // ignore
    }
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== draftKey || ev.newValue === null) return;
      try {
        const parsed = JSON.parse(ev.newValue) as { text?: string; mentions?: string[]; quotedMessageId?: string; quotePreview?: string };
        if (typeof parsed.text === "string") setText(parsed.text);
        if (Array.isArray(parsed.mentions)) setMentions(parsed.mentions);
        if (parsed.quotedMessageId) setQuote({ messageId: parsed.quotedMessageId, preview: parsed.quotePreview ?? "" });
      } catch {
        // ignore
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
      // ignore
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
    const newText = before.slice(0, at) + `@${p.name} ` + after;
    setText(newText);
    setMentionQuery(undefined);
    setMentions((prev) => Array.from(new Set([...prev, p.id])));
    requestAnimationFrame(() => taRef.current?.focus());
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
      // Detect 409: pending turn was already consumed by an agent before the edit landed.
      const message = err instanceof Error ? err.message : String(err);
      if (/\b409\b|already (started|consumed|scheduled)/i.test(message)) {
        setError("This message has already started processing — edit no longer applies.");
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
        "border-t border-border bg-surface p-3",
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
      {props.editingTurnId ? (
        <div className="mb-2 flex items-center gap-2 rounded bg-warning-soft px-2 py-1 text-xs">
          <span>Editing queued message <span className="ah-mono text-muted">{props.editingTurnId?.slice(0, 8)}</span></span>
          <Button size="sm" variant="ghost" onPress={() => props.onCancelEdit?.()}>Cancel edit</Button>
        </div>
      ) : null}

      {quote ? (
        <div className="mb-2 flex items-start gap-2 rounded border-l-2 border-accent bg-accent-soft px-2 py-1 text-xs">
          <span className="flex-1 truncate">Quoting: {quote.preview || quote.messageId}</span>
          <Button isIconOnly size="sm" variant="ghost" onPress={() => setQuote(undefined)} aria-label="Remove quote">×</Button>
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {attachments.map((att) => (
            <Chip key={att.fileId} size="sm" variant="soft" color="default">
              <span className="ah-mono">📎 {att.name} · {formatBytes(att.sizeBytes)}</span>
              <button
                type="button"
                aria-label={`Remove ${att.name}`}
                className="ml-1 text-muted hover:text-foreground"
                onClick={() => setAttachments((prev) => prev.filter((a) => a.fileId !== att.fileId))}
              >
                ×
              </button>
            </Chip>
          ))}
        </div>
      ) : null}

      {mentionQuery !== undefined && filteredMentions.length > 0 ? (
        <ul role="listbox" aria-label="Mention participants" className="mb-2 flex max-h-40 flex-col gap-1 overflow-auto rounded border border-border bg-overlay p-1">
          {filteredMentions.map((p, i) => {
            const active = i === mentionHighlight;
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={active}
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
                  "cursor-pointer rounded px-2 py-1 text-sm",
                  active ? "bg-accent-soft text-accent-soft-foreground" : "hover:bg-default"
                ].join(" ")}
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted">{p.role} · {p.id}</div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="flex items-end gap-2">
        <TextArea
          ref={taRef as never}
          value={text}
          onChange={(e) => handleChange(e.currentTarget.value)}
          aria-label="Message"
          placeholder={
            props.connectionStatus !== "connected" ? "Disconnected — cannot send" :
            queueFull ? "Queue full — wait for messages to send" :
            "Type a message. Use @ to mention. Drop files to attach."
          }
          className="min-h-[44px] max-h-32 flex-1"
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
              // Quick-edit: empty input + ↑ jumps the user into editing the most recent
              // queued pending turn so they don't have to mouse over to its edit button.
              e.preventDefault();
              props.onRequestEdit(props.latestPendingMessageId);
            }
          }}
        />
        <Button
          variant="primary"
          isPending={isSending}
          isDisabled={!canSend || queueFull}
          onPress={() => void send()}
        >
          {props.editingTurnId ? "Save" : "Send"}
        </Button>
      </div>

      {error ? <p className="mt-2 text-xs text-danger" role="alert">{error}</p> : null}
      {props.connectionStatus !== "connected" ? (
        <span className="ah-sr-only" aria-live="polite">Connection: {props.connectionStatus}</span>
      ) : null}
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from "react";
import type { RoomViewModel, ParticipantViewModel } from "../types.ts";
import { RoomMembersPopover, type MentionCandidate } from "./RoomMembersPopover.tsx";
import { useCsrfFetch } from "../hooks/useSdk.ts";

export type SendPayload = {
  readonly text: string;
  readonly mentions?: readonly string[] | undefined;
  readonly quotedMessageId?: string | undefined;
  readonly attachments?: readonly AttachmentFile[] | undefined;
};

export type AttachmentFile = {
  readonly fileId: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
};

type InputBoxProps = {
  readonly onSend: (payload: SendPayload) => void;
  readonly disabled: boolean;
  readonly room: RoomViewModel;
  readonly pendingTurnCount: number;
  readonly editingPendingTurn?: { readonly messageId: string; readonly text: string } | undefined;
  readonly onClearEdit?: () => void;
  readonly editError?: string | undefined;
};

export function InputBox({ onSend, disabled, room, pendingTurnCount, editingPendingTurn, onClearEdit, editError }: InputBoxProps) {
  const [text, setText] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [mentions, setMentions] = useState<string[]>([]);
  const [quote, setQuote] = useState<{ readonly messageId: string; readonly senderName: string; readonly text: string } | undefined>(undefined);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionAnchor, setMentionAnchor] = useState<HTMLElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const csrfFetch = useCsrfFetch();

  const draftKey = `agenthub.draft.${room.id}`;

  // Restore draft on mount / room change / storage event
  useEffect(() => {
    if (editingPendingTurn) {
      setText(editingPendingTurn.text);
      return;
    }
    const loadDraft = () => {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { text?: string; mentions?: string[]; quotedMessageId?: string; attachments?: AttachmentFile[] };
          setText(parsed.text ?? "");
          setMentions(parsed.mentions ?? []);
          if (parsed.quotedMessageId) {
            const msg = room.messages.find((m) => m.id === parsed.quotedMessageId);
            if (msg) {
              setQuote({ messageId: msg.id, senderName: msg.senderName, text: msg.text.slice(0, 100) });
            }
          } else {
            setQuote(undefined);
          }
          setAttachments(parsed.attachments ?? []);
        } catch {
          setText(saved);
        }
      } else {
        setText("");
        setMentions([]);
        setQuote(undefined);
        setAttachments([]);
      }
    };
    loadDraft();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === draftKey) {
        loadDraft();
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [draftKey, room.messages, editingPendingTurn]);

  // Persist draft
  useEffect(() => {
    const payload = { text, mentions, quotedMessageId: quote?.messageId, attachments };
    sessionStorage.setItem(draftKey, JSON.stringify(payload));
  }, [text, mentions, quote, attachments, draftKey]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend({ text: trimmed, mentions, quotedMessageId: quote?.messageId, attachments });
    setText("");
    setMentions([]);
    setQuote(undefined);
    setAttachments([]);
    sessionStorage.removeItem(draftKey);
    if (editingPendingTurn && onClearEdit) {
      onClearEdit();
    }
  }, [text, disabled, onSend, mentions, quote, attachments, draftKey, editingPendingTurn, onClearEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showMentions) {
        // Let RoomMembersPopover handle Tab/Enter/Escape
        if (e.key === "Tab" || e.key === "Enter" || e.key === "Escape") {
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [showMentions, handleSend]
  );

  const detectMention = useCallback((currentText: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart;
    const beforeCursor = currentText.slice(0, cursorPos);
    const match = beforeCursor.match(/@([^\s@]*)$/);
    if (match) {
      setMentionQuery(match[1] ?? "");
      setShowMentions(true);
      setMentionAnchor(el);
    } else {
      setShowMentions(false);
      setMentionQuery("");
    }
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      setText(newText);
      detectMention(newText);
    },
    [detectMention]
  );

  const handleSelectMention = useCallback(
    (candidate: MentionCandidate) => {
      const el = textareaRef.current;
      if (!el) return;
      const cursorPos = el.selectionStart;
      const beforeCursor = text.slice(0, cursorPos);
      const afterCursor = text.slice(cursorPos);
      const match = beforeCursor.match(/@([^\s@]*)$/);
      if (match) {
        const newBefore = beforeCursor.slice(0, beforeCursor.length - match[0].length) + `@${candidate.displayName} `;
        const newText = newBefore + afterCursor;
        setText(newText);
        setMentions((prev) => [...prev, candidate.agentId]);
        setShowMentions(false);
        setMentionQuery("");
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = newBefore.length;
          el.focus();
        });
      }
    },
    [text]
  );

  const handleCloseMentions = useCallback(() => {
    setShowMentions(false);
    setMentionQuery("");
  }, []);

  const mentionCandidates: MentionCandidate[] = room.participants.map((p: ParticipantViewModel) => ({
    agentId: p.id,
    displayName: p.name,
    role: p.role,
    presence: p.presence
  }));

  // Drag-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      setUploadError(undefined);

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) {
          setUploadError(`File "${file.name}" exceeds 50MB limit.`);
          continue;
        }
        const formData = new FormData();
        formData.append("file", file);
        try {
          const res = await csrfFetch("/attachments", { method: "POST", body: formData });
          if (res.status === 413) {
            setUploadError(`File "${file.name}" too large (server rejected).`);
            continue;
          }
          if (res.status === 415) {
            setUploadError(`File "${file.name}" type not supported.`);
            continue;
          }
          if (!res.ok) {
            setUploadError(`Upload failed for "${file.name}" (${res.status}).`);
            continue;
          }
          const data = (await res.json()) as { fileId?: string; name?: string; sizeBytes?: number; mimeType?: string };
          if (data.fileId) {
            setAttachments((prev) => [
              ...prev,
              { fileId: data.fileId!, name: data.name ?? file.name, sizeBytes: data.sizeBytes ?? file.size, mimeType: data.mimeType ?? file.type }
            ]);
          }
        } catch (err) {
          setUploadError(`Upload error for "${file.name}".`);
        }
      }
    },
    [csrfFetch]
  );

  const removeAttachment = useCallback((fileId: string) => {
    setAttachments((prev) => prev.filter((a) => a.fileId !== fileId));
  }, []);

  const removeQuote = useCallback(() => {
    setQuote(undefined);
  }, []);

  const atLimit = pendingTurnCount >= 20;
  const nearLimit = pendingTurnCount >= 15 && pendingTurnCount < 20;

  return (
    <div
      style={{ borderTop: "1px solid #e5e7eb", padding: "12px 16px", background: "#ffffff" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {editingPendingTurn && (
        <div
          style={{
            background: "#eff6ff",
            color: "#1d4ed8",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 8,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <span>Editing pending turn {editingPendingTurn.messageId.slice(0, 8)}</span>
          <button
            onClick={onClearEdit}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#1d4ed8" }}
            aria-label="Cancel editing"
          >
            x
          </button>
        </div>
      )}
      {editError && (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 8,
            fontWeight: 500
          }}
        >
          {editError}
        </div>
      )}
      {nearLimit && !atLimit && (
        <div
          style={{
            background: "#fef3c7",
            color: "#92400e",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 8,
            fontWeight: 500
          }}
        >
          {pendingTurnCount} messages queued. Consider cancelling old messages or waiting for the agent.
        </div>
      )}
      {atLimit && (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 8,
            fontWeight: 500
          }}
        >
          Queue limit reached (20). Cancel old messages to send more.
        </div>
      )}
      {uploadError && (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 8,
            fontWeight: 500
          }}
        >
          {uploadError}
          <button
            onClick={() => setUploadError(undefined)}
            style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#991b1b" }}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}
      {quote && (
        <div
          style={{
            background: "#f9fafb",
            borderLeft: "3px solid #3b82f6",
            padding: "8px 12px",
            borderRadius: "0 6px 6px 0",
            fontSize: 12,
            color: "#4b5563",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <span>
            <strong>@{quote.senderName}:</strong> {quote.text}
          </span>
          <button
            onClick={removeQuote}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#6b7280" }}
            aria-label="Remove quote"
          >
            x
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {attachments.map((att) => (
            <div
              key={att.fileId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                background: "#f3f4f6",
                borderRadius: 6,
                fontSize: 12,
                color: "#374151"
              }}
            >
              <span>{att.name}</span>
              <span style={{ color: "#9ca3af" }}>({(att.sizeBytes / 1024).toFixed(1)} KB)</span>
              <button
                onClick={() => removeAttachment(att.fileId)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#6b7280" }}
                aria-label={`Remove ${att.name}`}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          border: dragOver ? "2px dashed #3b82f6" : "2px dashed transparent",
          borderRadius: 8,
          padding: dragOver ? 6 : 8,
          transition: "border 0.2s, padding 0.2s"
        }}
      >
        <div style={{ flex: 1, position: "relative" }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled || atLimit}
            placeholder={atLimit ? "Queue full" : "Type a message..."}
            rows={2}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              fontSize: 14,
              resize: "vertical",
              minHeight: 44,
              maxHeight: 120,
              background: disabled || atLimit ? "#f3f4f6" : "#ffffff",
              color: "#111827"
            }}
            data-testid="message-input"
          />
          {showPreview && (
            <div
              style={{
                position: "absolute",
                bottom: "100%",
                left: 0,
                right: 0,
                background: "#ffffff",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                padding: 12,
                marginBottom: 4,
                maxHeight: 200,
                overflow: "auto",
                fontSize: 14,
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
              }}
            >
              <strong>Preview</strong>
              <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{text}</div>
            </div>
          )}
          {showMentions && (
            <RoomMembersPopover
              candidates={mentionCandidates}
              query={mentionQuery}
              onSelect={handleSelectMention}
              onClose={handleCloseMentions}
              anchorElement={mentionAnchor}
            />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={() => setShowPreview((v) => !v)}
            disabled={!text}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              cursor: "pointer",
              fontSize: 12,
              color: "#374151"
            }}
          >
            {showPreview ? "Hide" : "Preview"}
          </button>
          <button
            onClick={handleSend}
            disabled={disabled || atLimit || !text.trim()}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: disabled || atLimit ? "#d1d5db" : "#3b82f6",
              color: "#ffffff",
              cursor: disabled || atLimit ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 600
            }}
            data-testid="send-button"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

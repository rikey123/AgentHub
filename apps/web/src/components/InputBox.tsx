import { useState, useRef, useEffect, useCallback } from "react";
import type { RoomViewModel } from "../types.ts";

type InputBoxProps = {
  readonly onSend: (text: string) => void;
  readonly disabled: boolean;
  readonly room: RoomViewModel;
  readonly pendingTurnCount: number;
};

export function InputBox({ onSend, disabled, room, pendingTurnCount }: InputBoxProps) {
  const [text, setText] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftKey = `draft:${room.id}`;

  useEffect(() => {
    const saved = sessionStorage.getItem(draftKey);
    if (saved) setText(saved);
  }, [draftKey]);

  useEffect(() => {
    sessionStorage.setItem(draftKey, text);
  }, [text, draftKey]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    sessionStorage.removeItem(draftKey);
  }, [text, disabled, onSend, draftKey]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const atLimit = pendingTurnCount >= 20;
  const nearLimit = pendingTurnCount >= 15 && pendingTurnCount < 20;

  return (
    <div style={{ borderTop: "1px solid #e5e7eb", padding: "12px 16px", background: "#ffffff" }}>
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
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
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
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

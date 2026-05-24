import { useRef, useEffect, useState, useCallback } from "react";
import type { RoomViewModel, MessageViewModel } from "../types.ts";
import { PermissionCard } from "./cards/PermissionCard.tsx";
import { InterventionCard } from "./cards/InterventionCard.tsx";
import { DiffCard } from "./cards/DiffCard.tsx";
import { ContextCard } from "./cards/ContextCard.tsx";
import { TaskCard } from "./cards/TaskCard.tsx";
import { PreviewCard } from "./cards/PreviewCard.tsx";
import { UnknownCard } from "./cards/UnknownCard.tsx";
import { MailboxFailureCard } from "./cards/MailboxFailureCard.tsx";
import { TerminalCard } from "./cards/TerminalCard.tsx";
import type { Card } from "@agenthub/protocol/domains";
import { useCsrfFetch } from "../hooks/useSdk.ts";

type ChatStreamProps = {
  readonly room: RoomViewModel;
  readonly onOpenRunDetail: (runId: string) => void;
  readonly onCancelPendingTurn: (pendingTurnId: string) => void;
  readonly onEditPendingTurn: (messageId: string, text: string) => void;
  readonly onQuoteMessage: (messageId: string) => void;
  readonly connectionStatus: "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";
};

export function ChatStream({ room, onOpenRunDetail, onCancelPendingTurn, onEditPendingTurn, onQuoteMessage, connectionStatus }: ChatStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | undefined>(undefined);
  const csrfFetch = useCsrfFetch();
  const isOffline = connectionStatus === "offline";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [room.messages.length, room.briefs.length]);

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      try {
        await csrfFetch(`/messages/${encodeURIComponent(messageId)}/regenerate`, { method: "POST", body: "{}" });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("regenerate failed", error);
      }
    },
    [csrfFetch]
  );

  const handlePin = useCallback(
    async (messageId: string) => {
      try {
        await csrfFetch(`/messages/${encodeURIComponent(messageId)}/pin`, { method: "POST", body: "{}" });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("pin failed", error);
      }
    },
    [csrfFetch]
  );

  const handleDelete = useCallback(
    async (messageId: string) => {
      try {
        await csrfFetch(`/messages/${encodeURIComponent(messageId)}`, { method: "DELETE", body: "{}" });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("delete failed", error);
      }
    },
    [csrfFetch]
  );

  // Keyboard navigation for messages
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;

      if (e.key === "j") {
        e.preventDefault();
        setSelectedMessageId((prev) => {
          const ids = room.messages.map((m) => m.id);
          if (!prev) return ids[0];
          const idx = ids.indexOf(prev);
          return ids[Math.min(idx + 1, ids.length - 1)] ?? prev;
        });
      } else if (e.key === "k") {
        e.preventDefault();
        setSelectedMessageId((prev) => {
          const ids = room.messages.map((m) => m.id);
          if (!prev) return ids[ids.length - 1];
          const idx = ids.indexOf(prev);
          return ids[Math.max(idx - 1, 0)] ?? prev;
        });
      } else if (e.key === "q") {
        e.preventDefault();
        if (selectedMessageId) {
          onQuoteMessage(selectedMessageId);
        }
      } else if (e.key === "r") {
        e.preventDefault();
        if (selectedMessageId) {
          const msg = room.messages.find((m) => m.id === selectedMessageId);
          if (msg?.runId) onOpenRunDetail(msg.runId);
        }
      } else if (e.key === "p") {
        e.preventDefault();
        if (selectedMessageId) {
          handlePin(selectedMessageId);
        }
      } else if (e.key === "d") {
        e.preventDefault();
        if (selectedMessageId) {
          handleDelete(selectedMessageId);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [room.messages, selectedMessageId, onQuoteMessage, onOpenRunDetail, handlePin, handleDelete]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 16px" }}>
      {connectionStatus === "reconnecting" && (
        <div
          style={{
            background: "#fef3c7",
            color: "#92400e",
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 500,
            textAlign: "center",
            borderBottom: "1px solid #fcd34d"
          }}
        >
          Reconnecting...
        </div>
      )}
      {connectionStatus === "offline" && (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 500,
            textAlign: "center",
            borderBottom: "1px solid #fca5a5"
          }}
        >
          Offline - check daemon connection
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto", paddingBottom: 16 }}>
        {room.messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            onCancelPendingTurn={onCancelPendingTurn}
            onEditPendingTurn={onEditPendingTurn}
            onQuoteMessage={onQuoteMessage}
            onRegenerate={handleRegenerate}
            onPin={handlePin}
            onDelete={handleDelete}
            isSelected={selectedMessageId === message.id}
            onSelect={() => setSelectedMessageId(message.id)}
            isOffline={isOffline}
          />
        ))}
        {room.briefs.map((brief) => (
          <BriefItem key={`${brief.runId}-${brief.kind}`} brief={brief} onOpenRunDetail={onOpenRunDetail} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageItem({
  message,
  onCancelPendingTurn,
  onEditPendingTurn,
  onQuoteMessage,
  onRegenerate,
  onPin,
  onDelete,
  isSelected,
  onSelect,
  isOffline
}: {
  readonly message: MessageViewModel;
  readonly onCancelPendingTurn: (pendingTurnId: string) => void;
  readonly onEditPendingTurn: (messageId: string, text: string) => void;
  readonly onQuoteMessage: (messageId: string) => void;
  readonly onRegenerate: (messageId: string) => void;
  readonly onPin: (messageId: string) => void;
  readonly onDelete: (messageId: string) => void;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly isOffline: boolean;
}) {
  const isUser = message.senderType === "user";
  const isCancelled = message.pendingTurnStatus === "cancelled";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      window.addEventListener("mousedown", handleClickOutside);
      return () => window.removeEventListener("mousedown", handleClickOutside);
    }
    return undefined;
  }, [menuOpen]);

  const canRegenerate = message.senderType === "agent" && message.status === "completed";
  const canPin = message.status === "completed";
  const canDelete = isUser || message.status === "completed";
  const canQuote = message.text.length > 0;

  return (
    <div
      style={{
        marginTop: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        opacity: isCancelled ? 0.5 : 1,
        outline: isSelected ? "2px solid #3b82f6" : "none",
        outlineOffset: 4,
        borderRadius: 8
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{message.senderName}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{new Date(message.createdAt).toLocaleTimeString()}</span>
        {message.pendingTurnStatus === "queued" && (
          <span
            style={{
              fontSize: 11,
              color: "#d97706",
              background: "#fef3c7",
              padding: "2px 8px",
              borderRadius: 10,
              fontWeight: 500
            }}
          >
            queued ({message.pendingTurnPosition})
          </span>
        )}
        {message.pendingTurnStatus === "scheduled" && (
          <span
            style={{
              fontSize: 11,
              color: "#059669",
              background: "#d1fae5",
              padding: "2px 8px",
              borderRadius: 10,
              fontWeight: 500
            }}
          >
            scheduled
          </span>
        )}
        {message.pendingTurnStatus === "consumed" && (
          <span
            style={{
              fontSize: 11,
              color: "#2563eb",
              background: "#dbeafe",
              padding: "2px 8px",
              borderRadius: 10,
              fontWeight: 500
            }}
          >
            consumed
          </span>
        )}
        {isCancelled && (
          <span
            style={{
              fontSize: 11,
              color: "#6b7280",
              background: "#f3f4f6",
              padding: "2px 8px",
              borderRadius: 10,
              fontWeight: 500
            }}
          >
            cancelled
          </span>
        )}

        {/* Kebab menu */}
        <div style={{ position: "relative" }} ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              color: "#9ca3af",
              padding: "2px 6px"
            }}
            aria-label="Message actions"
            data-testid={`message-menu-${message.id}`}
          >
            &#x22EE;
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                zIndex: 100,
                minWidth: 140,
                padding: "4px 0"
              }}
            >
              {canQuote && (
                <MenuItem
                  label="Quote"
                  shortcut="q"
                  onClick={() => {
                    onQuoteMessage(message.id);
                    setMenuOpen(false);
                  }}
                  disabled={isOffline}
                />
              )}
              {canRegenerate && (
                <MenuItem
                  label="Regenerate"
                  shortcut="r"
                  onClick={() => {
                    onRegenerate(message.id);
                    setMenuOpen(false);
                  }}
                  disabled={isOffline}
                />
              )}
              {canPin && (
                <MenuItem
                  label="Pin"
                  shortcut="p"
                  onClick={() => {
                    onPin(message.id);
                    setMenuOpen(false);
                  }}
                  disabled={isOffline}
                />
              )}
              {canDelete && (
                <MenuItem
                  label="Delete"
                  shortcut="d"
                  onClick={() => {
                    onDelete(message.id);
                    setMenuOpen(false);
                  }}
                  disabled={isOffline}
                  danger
                />
              )}
            </div>
          )}
        </div>
      </div>

      {message.senderType === "system" && message.text.startsWith("Delivery failed:") ? (
        <MailboxFailureCard
          reason={message.text.replace("Delivery failed: ", "")}
          targetAgentId={message.senderId}
          timestamp={message.createdAt}
          onRetry={() => {
            // Retry would re-send the message; for now just log
          }}
          onDebug={() => {
            window.open("/debug/events", "_blank");
          }}
        />
      ) : (
        <div
          style={{
            maxWidth: "80%",
            padding: "10px 14px",
            borderRadius: 12,
            background: isUser ? "#3b82f6" : "#f3f4f6",
            color: isUser ? "#ffffff" : "#111827",
            fontSize: 14,
            lineHeight: 1.5,
            wordBreak: "break-word"
          }}
        >
          {message.quotedMessageId && (
            <div
              style={{
                borderLeft: "2px solid " + (isUser ? "rgba(255,255,255,0.5)" : "#d1d5db"),
                paddingLeft: 8,
                marginBottom: 6,
                fontSize: 12,
                opacity: 0.8
              }}
            >
              Quoting message {message.quotedMessageId.slice(0, 8)}
            </div>
          )}
          {message.text}
          {message.parts.map((part, idx) => (
            <PartRenderer key={idx} part={part} />
          ))}
        </div>
      )}

      {message.pendingTurnStatus === "queued" && message.pendingTurnId && (
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button
            onClick={() => message.pendingTurnId && onCancelPendingTurn(message.pendingTurnId)}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              cursor: "pointer",
              color: "#374151"
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onEditPendingTurn(message.id, message.text)}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              cursor: "pointer",
              color: "#374151"
            }}
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  shortcut,
  onClick,
  disabled,
  danger
}: {
  readonly label: string;
  readonly shortcut: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Needs online connection" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "8px 12px",
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 13,
        color: disabled ? "#9ca3af" : danger ? "#ef4444" : "#374151",
        textAlign: "left"
      }}
    >
      <span>{label}</span>
      <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 12 }}>{shortcut}</span>
    </button>
  );
}

function PartRenderer({
  part
}: {
  readonly part: import("@agenthub/protocol/domains").MessagePart;
}) {
  if (part.type === "card") {
    return <CardRenderer card={part.card} />;
  }
  if (part.type === "text") {
    return <div>{part.text}</div>;
  }
  if (part.type === "code") {
    return (
      <pre style={{ background: "#1f2937", color: "#e5e7eb", padding: 12, borderRadius: 6, overflow: "auto", fontSize: 12 }}>
        <code>{part.text}</code>
      </pre>
    );
  }
  if (part.type === "attachment") {
    return (
      <div style={{ marginTop: 8, padding: "8px 12px", background: "#f9fafb", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }}>
        <span style={{ fontWeight: 500 }}>{part.name}</span>
        <span style={{ color: "#9ca3af", marginLeft: 8 }}>({(part.sizeBytes / 1024).toFixed(1)} KB)</span>
      </div>
    );
  }
  return null;
}

function CardRenderer({ card }: { readonly card: Card }) {
  switch (card.type) {
    case "permission":
      return <PermissionCard card={card} />;
    case "intervention":
      return <InterventionCard card={card} />;
    case "diff":
      return <DiffCard card={card} />;
    case "context":
      return <ContextCard card={card} />;
    case "task":
      return <TaskCard card={card} />;
    case "preview":
      return <PreviewCard card={card} />;
    default:
      return <UnknownCard card={card} />;
  }
}

function BriefItem({
  brief,
  onOpenRunDetail
}: {
  readonly brief: import("../types.ts").BriefViewModel;
  readonly onOpenRunDetail: (runId: string) => void;
}) {
  const kindColor: Record<string, string> = {
    run_started: "#3b82f6",
    run_completed: "#10b981",
    run_failed: "#ef4444",
    run_cancelled: "#6b7280",
    phase_completed: "#8b5cf6"
  };

  return (
    <div
      style={{
        marginTop: 12,
        padding: "10px 14px",
        borderRadius: 8,
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer"
      }}
      onClick={() => onOpenRunDetail(brief.runId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpenRunDetail(brief.runId);
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: kindColor[brief.kind] ?? "#6b7280",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 600,
          flexShrink: 0
        }}
      >
        {brief.agentName.charAt(0).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>
          {brief.agentName} {brief.summary}
        </div>
        {brief.failureReason && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 2 }}>{brief.failureReason}</div>}
        {brief.artifactCount !== undefined && (
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{brief.artifactCount} files changed</div>
        )}
      </div>
      <div style={{ fontSize: 12, color: "#3b82f6", fontWeight: 500, flexShrink: 0 }} data-testid="brief-open-detail">Open Detail</div>
    </div>
  );
}

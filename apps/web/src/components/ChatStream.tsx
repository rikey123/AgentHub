import { useRef, useEffect, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { RoomViewModel, MessageViewModel } from "../types.ts";
import { PermissionCard } from "./cards/PermissionCard.tsx";
import { InterventionCard } from "./cards/InterventionCard.tsx";
import { DiffCard } from "./cards/DiffCard.tsx";
import { ContextCard } from "./cards/ContextCard.tsx";
import { TaskCard } from "./cards/TaskCard.tsx";
import { PreviewCard } from "./cards/PreviewCard.tsx";
import { UnknownCard } from "./cards/UnknownCard.tsx";
import { MailboxFailureCard } from "./cards/MailboxFailureCard.tsx";
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

const VIRTUALIZATION_THRESHOLD = 50;

function estimateMessageHeight(message: MessageViewModel): number {
  // Base height for sender info + padding
  let height = 48;
  // Text content: ~20px per 100 chars, min 20
  height += Math.max(20, Math.ceil(message.text.length / 100) * 20);
  // Parts add height
  for (const part of message.parts) {
    if (part.type === "card") {
      height += 120; // approximate card height
    } else if (part.type === "code") {
      height += 80;
    } else if (part.type === "attachment") {
      height += 40;
    }
  }
  // Pending turn buttons
  if (message.pendingTurnStatus === "queued") {
    height += 36;
  }
  return height;
}

export function ChatStream({ room, onOpenRunDetail, onCancelPendingTurn, onEditPendingTurn, onQuoteMessage, connectionStatus }: ChatStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | undefined>(undefined);
  const csrfFetch = useCsrfFetch();
  const isOffline = connectionStatus === "offline";
  const shouldVirtualize = room.messages.length >= VIRTUALIZATION_THRESHOLD;

  const virtualizerOptions = {
    count: room.messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index: number) => estimateMessageHeight(room.messages[index]!),
    overscan: shouldVirtualize ? 20 : 0
  };

  const virtualizer = useVirtualizer(
    shouldVirtualize
      ? { ...virtualizerOptions, measureElement: (el: Element) => el.getBoundingClientRect().height }
      : virtualizerOptions
  );

  useEffect(() => {
    if (!shouldVirtualize) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [room.messages.length, room.briefs.length, shouldVirtualize]);

  // Auto-scroll to bottom on new messages when virtualized
  useEffect(() => {
    if (shouldVirtualize && scrollRef.current) {
      virtualizer.scrollToIndex(room.messages.length - 1, { align: "end" });
    }
  }, [room.messages.length, shouldVirtualize, virtualizer]);

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
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedMessageId) {
          const msg = room.messages.find((m) => m.id === selectedMessageId);
          if (msg?.runId) {
            onOpenRunDetail(msg.runId);
          }
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

  // Scroll selected message into view when virtualized
  useEffect(() => {
    if (shouldVirtualize && selectedMessageId) {
      const index = room.messages.findIndex((m) => m.id === selectedMessageId);
      if (index >= 0) {
        virtualizer.scrollToIndex(index, { align: "center" });
      }
    }
  }, [selectedMessageId, shouldVirtualize, room.messages, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 var(--ah-space-4)" }}>
      {connectionStatus === "reconnecting" && (
        <div className="ah-banner ah-banner--reconnecting" role="status" aria-live="polite">
          <span>Reconnecting...</span>
        </div>
      )}
      {connectionStatus === "offline" && (
        <div className="ah-banner ah-banner--offline" role="alert" aria-live="assertive">
          <span>Offline - check daemon connection</span>
        </div>
      )}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: "auto", paddingBottom: "var(--ah-space-4)", position: "relative" }}
      >
        {shouldVirtualize ? (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualItems.map((virtualItem: VirtualItem) => {
              const message = room.messages[virtualItem.index];
              if (!message) return null;
              return (
                <div
                  key={message.id}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`
                  }}
                >
                  <MessageItem
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
                </div>
              );
            })}
          </div>
        ) : (
          <>
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
          </>
        )}
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
      className="ah-message-enter"
      style={{
        marginTop: "var(--ah-space-4)",
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        opacity: isCancelled ? 0.5 : 1,
        outline: isSelected ? "2px solid var(--ah-accent)" : "none",
        outlineOffset: "var(--ah-space-1)",
        borderRadius: "var(--ah-radius-lg)",
        cursor: "pointer"
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)", marginBottom: "var(--ah-space-1)" }}>
        <span style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-text-secondary)" }}>{message.senderName}</span>
        <span style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)" }}>{new Date(message.createdAt).toLocaleTimeString()}</span>
        {message.pendingTurnStatus === "queued" && (
          <span
            style={{
              fontSize: "var(--ah-font-size-xs)",
              color: "var(--ah-warning)",
              background: "var(--ah-warning-light)",
              padding: "2px var(--ah-space-2)",
              borderRadius: "var(--ah-radius-full)",
              fontWeight: 500
            }}
            aria-label={`Queued at position ${message.pendingTurnPosition}`}
          >
            queued ({message.pendingTurnPosition})
          </span>
        )}
        {message.pendingTurnStatus === "scheduled" && (
          <span
            style={{
              fontSize: "var(--ah-font-size-xs)",
              color: "var(--ah-success)",
              background: "var(--ah-success-light)",
              padding: "2px var(--ah-space-2)",
              borderRadius: "var(--ah-radius-full)",
              fontWeight: 500
            }}
            aria-label="Scheduled"
          >
            scheduled
          </span>
        )}
        {message.pendingTurnStatus === "consumed" && (
          <span
            style={{
              fontSize: "var(--ah-font-size-xs)",
              color: "var(--ah-accent)",
              background: "var(--ah-accent-light)",
              padding: "2px var(--ah-space-2)",
              borderRadius: "var(--ah-radius-full)",
              fontWeight: 500
            }}
            aria-label="Consumed"
          >
            consumed
          </span>
        )}
        {isCancelled && (
          <span
            style={{
              fontSize: "var(--ah-font-size-xs)",
              color: "var(--ah-text-muted)",
              background: "var(--ah-bg-secondary)",
              padding: "2px var(--ah-space-2)",
              borderRadius: "var(--ah-radius-full)",
              fontWeight: 500
            }}
            aria-label="Cancelled"
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
              fontSize: "var(--ah-font-size-base)",
              color: "var(--ah-text-muted)",
              padding: "2px 6px",
              borderRadius: "var(--ah-radius-sm)"
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
                background: "var(--ah-bg-primary)",
                border: "1px solid var(--ah-border)",
                borderRadius: "var(--ah-radius-lg)",
                boxShadow: "var(--ah-shadow-md)",
                zIndex: "var(--ah-z-dropdown)",
                minWidth: 140,
                padding: "var(--ah-space-1) 0"
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
            padding: "var(--ah-space-3) var(--ah-space-4)",
            borderRadius: "var(--ah-radius-xl)",
            background: isUser ? "var(--ah-accent)" : "var(--ah-bg-secondary)",
            color: isUser ? "var(--ah-text-inverse)" : "var(--ah-text-primary)",
            fontSize: "var(--ah-font-size-base)",
            lineHeight: "var(--ah-line-height-normal)",
            wordBreak: "break-word"
          }}
        >
          {message.quotedMessageId && (
            <div
              style={{
                borderLeft: "2px solid " + (isUser ? "rgba(255,255,255,0.5)" : "var(--ah-border-strong)"),
                paddingLeft: "var(--ah-space-2)",
                marginBottom: "var(--ah-space-2)",
                fontSize: "var(--ah-font-size-sm)",
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
        <div style={{ display: "flex", gap: "var(--ah-space-2)", marginTop: "var(--ah-space-2)" }}>
          <button
            onClick={() => message.pendingTurnId && onCancelPendingTurn(message.pendingTurnId)}
            disabled={isOffline}
            title={isOffline ? "Needs online connection" : "Cancel pending turn"}
            style={{
              fontSize: "var(--ah-font-size-xs)",
              padding: "var(--ah-space-1) var(--ah-space-3)",
              borderRadius: "var(--ah-radius-sm)",
              border: "1px solid var(--ah-border-strong)",
              background: "var(--ah-bg-primary)",
              cursor: isOffline ? "not-allowed" : "pointer",
              color: isOffline ? "var(--ah-text-muted)" : "var(--ah-text-secondary)"
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onEditPendingTurn(message.id, message.text)}
            disabled={isOffline}
            title={isOffline ? "Needs online connection" : "Edit pending turn"}
            style={{
              fontSize: "var(--ah-font-size-xs)",
              padding: "var(--ah-space-1) var(--ah-space-3)",
              borderRadius: "var(--ah-radius-sm)",
              border: "1px solid var(--ah-border-strong)",
              background: "var(--ah-bg-primary)",
              cursor: isOffline ? "not-allowed" : "pointer",
              color: isOffline ? "var(--ah-text-muted)" : "var(--ah-text-secondary)"
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
        padding: "var(--ah-space-2) var(--ah-space-3)",
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "var(--ah-font-size-md)",
        color: disabled ? "var(--ah-text-muted)" : danger ? "var(--ah-danger)" : "var(--ah-text-secondary)",
        textAlign: "left",
        borderRadius: "var(--ah-radius-sm)"
      }}
    >
      <span>{label}</span>
      <span style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginLeft: "var(--ah-space-3)" }}>{shortcut}</span>
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
      <pre style={{ background: "var(--ah-bg-inverse)", color: "var(--ah-text-inverse)", padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", overflow: "auto", fontSize: "var(--ah-font-size-sm)" }}>
        <code>{part.text}</code>
      </pre>
    );
  }
  if (part.type === "attachment") {
    return (
      <div style={{ marginTop: "var(--ah-space-2)", padding: "var(--ah-space-2) var(--ah-space-3)", background: "var(--ah-bg-elevated)", borderRadius: "var(--ah-radius-md)", border: "1px solid var(--ah-border)", fontSize: "var(--ah-font-size-sm)" }}>
        <span style={{ fontWeight: 500 }}>{part.name}</span>
        <span style={{ color: "var(--ah-text-muted)", marginLeft: "var(--ah-space-2)" }}>({(part.sizeBytes / 1024).toFixed(1)} KB)</span>
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
    run_started: "var(--ah-accent)",
    run_completed: "var(--ah-success)",
    run_failed: "var(--ah-danger)",
    run_cancelled: "var(--ah-text-muted)",
    phase_completed: "#8b5cf6"
  };

  return (
    <div
      style={{
        marginTop: "var(--ah-space-3)",
        padding: "var(--ah-space-3) var(--ah-space-4)",
        borderRadius: "var(--ah-radius-lg)",
        background: "var(--ah-bg-elevated)",
        border: "1px solid var(--ah-border)",
        display: "flex",
        alignItems: "center",
        gap: "var(--ah-space-3)",
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
          borderRadius: "var(--ah-radius-full)",
          background: kindColor[brief.kind] ?? "var(--ah-text-muted)",
          color: "var(--ah-text-inverse)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--ah-font-size-sm)",
          fontWeight: 600,
          flexShrink: 0
        }}
      >
        {brief.agentName.charAt(0).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--ah-font-size-md)", fontWeight: 500, color: "var(--ah-text-primary)" }}>
          {brief.agentName} {brief.summary}
        </div>
        {brief.failureReason && <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-danger)", marginTop: 2 }}>{brief.failureReason}</div>}
        {brief.artifactCount !== undefined && (
          <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: 2 }}>{brief.artifactCount} files changed</div>
        )}
      </div>
      <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-accent)", fontWeight: 500, flexShrink: 0 }} data-testid="brief-open-detail">Open Detail</div>
    </div>
  );
}

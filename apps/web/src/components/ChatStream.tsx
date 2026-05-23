import { useRef, useEffect } from "react";
import type { RoomViewModel } from "../types.ts";
import { PermissionCard } from "./cards/PermissionCard.tsx";
import { InterventionCard } from "./cards/InterventionCard.tsx";
import { DiffCard } from "./cards/DiffCard.tsx";
import { ContextCard } from "./cards/ContextCard.tsx";
import { TaskCard } from "./cards/TaskCard.tsx";
import { PreviewCard } from "./cards/PreviewCard.tsx";
import { UnknownCard } from "./cards/UnknownCard.tsx";
import type { Card } from "@agenthub/protocol/domains";

type ChatStreamProps = {
  readonly room: RoomViewModel;
  readonly onOpenRunDetail: (runId: string) => void;
  readonly onCancelPendingTurn: (pendingTurnId: string) => void;
  readonly connectionStatus: "connected" | "connecting" | "disconnected";
};

export function ChatStream({ room, onOpenRunDetail, onCancelPendingTurn, connectionStatus }: ChatStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [room.messages.length, room.briefs.length]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 16px" }}>
      {connectionStatus === "disconnected" && (
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
      <div style={{ flex: 1, overflow: "auto", paddingBottom: 16 }}>
        {room.messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            onCancelPendingTurn={onCancelPendingTurn}
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
  onCancelPendingTurn
}: {
  readonly message: import("../types.ts").MessageViewModel;
  readonly onCancelPendingTurn: (pendingTurnId: string) => void;
}) {
  const isUser = message.senderType === "user";
  const isCancelled = message.pendingTurnStatus === "cancelled";

  return (
    <div
      style={{
        marginTop: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        opacity: isCancelled ? 0.5 : 1
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
      </div>

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
        {message.text}
        {message.parts.map((part, idx) => (
          <PartRenderer key={idx} part={part} />
        ))}
      </div>

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
            onClick={() => {
              // Edit = cancel + new message with same text
              if (message.pendingTurnId) {
                onCancelPendingTurn(message.pendingTurnId);
              }
            }}
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
      <div style={{ fontSize: 12, color: "#3b82f6", fontWeight: 500, flexShrink: 0 }}>Open Detail</div>
    </div>
  );
}

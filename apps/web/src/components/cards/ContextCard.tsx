import { useState } from "react";
import type { Card } from "@agenthub/protocol/domains";

type ContextCardProps = {
  readonly card: Extract<Card, { type: "context" }>;
};

export function ContextCard({ card }: ContextCardProps) {
  const [status, setStatus] = useState(card.status);

  const handleConfirm = async () => {
    try {
      await fetch(`/context/${encodeURIComponent(card.contextId)}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      setStatus("confirmed");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("confirm context failed", error);
    }
  };

  const handleDiscard = async () => {
    try {
      await fetch(`/context/${encodeURIComponent(card.contextId)}/deprecate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseVersion: 1, reason: "discarded from card" })
      });
      setStatus("deprecated");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("discard context failed", error);
    }
  };

  const isDraft = status === "draft";

  return (
    <div
      style={{
        marginTop: 8,
        padding: "12px 14px",
        borderRadius: 8,
        background: "#eff6ff",
        border: "1px solid #bfdbfe"
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af", marginBottom: 6 }}>Context</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1e3a8a", marginBottom: 4 }}>{card.title}</div>
      <div style={{ fontSize: 12, color: "#3b82f6", marginBottom: 8 }}>{card.summary}</div>

      {isDraft && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleConfirm}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              background: "#3b82f6",
              color: "#ffffff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600
            }}
          >
            Confirm
          </button>
          <button
            onClick={handleDiscard}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              cursor: "pointer",
              fontSize: 12,
              color: "#374151"
            }}
          >
            Discard
          </button>
        </div>
      )}

      {!isDraft && (
        <div style={{ fontSize: 12, fontWeight: 600, color: status === "confirmed" ? "#059669" : "#6b7280" }}>
          {status === "confirmed" ? "Confirmed" : status === "deprecated" ? "Discarded" : status}
        </div>
      )}
    </div>
  );
}

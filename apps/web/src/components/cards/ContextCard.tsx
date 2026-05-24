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
        marginTop: "var(--ah-space-2)",
        padding: "var(--ah-space-3) var(--ah-space-4)",
        borderRadius: "var(--ah-radius-lg)",
        background: "var(--ah-accent-light)",
        border: "1px solid var(--ah-accent)"
      }}
    >
      <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-accent-text)", marginBottom: "var(--ah-space-2)" }}>Context</div>
      <div style={{ fontSize: "var(--ah-font-size-md)", fontWeight: 600, color: "var(--ah-accent-text)", marginBottom: "var(--ah-space-1)" }}>{card.title}</div>
      <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-accent)", marginBottom: "var(--ah-space-2)" }}>{card.summary}</div>

      {isDraft && (
        <div style={{ display: "flex", gap: "var(--ah-space-2)" }}>
          <button
            onClick={handleConfirm}
            style={{
              padding: "var(--ah-space-2) var(--ah-space-3)",
              borderRadius: "var(--ah-radius-md)",
              border: "none",
              background: "var(--ah-accent)",
              color: "var(--ah-text-inverse)",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-sm)",
              fontWeight: 600
            }}
            aria-label="Confirm context"
          >
            Confirm
          </button>
          <button
            onClick={handleDiscard}
            style={{
              padding: "var(--ah-space-2) var(--ah-space-3)",
              borderRadius: "var(--ah-radius-md)",
              border: "1px solid var(--ah-border-strong)",
              background: "var(--ah-bg-primary)",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-sm)",
              color: "var(--ah-text-secondary)"
            }}
            aria-label="Discard context"
          >
            Discard
          </button>
        </div>
      )}

      {!isDraft && (
        <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: status === "confirmed" ? "var(--ah-success)" : "var(--ah-text-muted)" }}>
          {status === "confirmed" ? "Confirmed" : status === "deprecated" ? "Discarded" : status}
        </div>
      )}
    </div>
  );
}

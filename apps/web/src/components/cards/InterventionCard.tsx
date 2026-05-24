import { useState } from "react";
import type { Card } from "@agenthub/protocol/domains";

type InterventionCardProps = {
  readonly card: Extract<Card, { type: "intervention" }>;
};

export function InterventionCard({ card }: InterventionCardProps) {
  const [effectiveText, setEffectiveText] = useState(card.preview ?? "");
  const [status, setStatus] = useState(card.status);

  const handleAction = async (action: "approve" | "later" | "ignore" | "reject") => {
    setStatus(action === "approve" ? "approved" : action === "later" ? "snoozed" : action === "ignore" ? "ignored" : "rejected");
    try {
      const endpoint = action === "approve" ? "approve" : action === "later" ? "later" : action === "ignore" ? "ignore" : "reject";
      await fetch(`/interventions/${encodeURIComponent(card.interventionId)}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "approve" ? { effectiveText } : {})
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("intervention action failed", error);
    }
  };

  const isResolved = status !== "pending_user_decision";
  const priorityColor = card.priority === "high" ? "var(--ah-danger)" : card.priority === "medium" ? "var(--ah-warning)" : "var(--ah-text-muted)";

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
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)", marginBottom: "var(--ah-space-2)" }}>
        <span style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-accent-text)" }}>Intervention</span>
        <span style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-inverse)", background: priorityColor, padding: "2px var(--ah-space-2)", borderRadius: "var(--ah-radius-full)" }}>
          {card.priority}
        </span>
      </div>
      <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-accent-text)", marginBottom: "var(--ah-space-1)" }}>
        <strong>Agent:</strong> {card.agentId}
      </div>
      <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-accent-text)", marginBottom: "var(--ah-space-1)" }}>{card.reason}</div>
      {card.preview && (
        <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-accent)", marginBottom: "var(--ah-space-2)", fontStyle: "italic" }}>{card.preview}</div>
      )}

      {!isResolved && (
        <>
          <textarea
            value={effectiveText}
            onChange={(e) => setEffectiveText(e.target.value)}
            placeholder="Edit effective text..."
            rows={2}
            style={{
              width: "100%",
              padding: "var(--ah-space-2)",
              borderRadius: "var(--ah-radius-md)",
              border: "1px solid var(--ah-accent)",
              fontSize: "var(--ah-font-size-sm)",
              marginBottom: "var(--ah-space-2)",
              resize: "vertical",
              background: "var(--ah-bg-primary)",
              color: "var(--ah-text-primary)"
            }}
            aria-label="Edit effective text"
          />
          <div style={{ display: "flex", gap: "var(--ah-space-1)", flexWrap: "wrap" }}>
            <button
              onClick={() => handleAction("approve")}
              style={{
                padding: "var(--ah-space-2) var(--ah-space-3)",
                borderRadius: "var(--ah-radius-md)",
                border: "none",
                background: "var(--ah-success)",
                color: "var(--ah-text-inverse)",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-sm)",
                fontWeight: 600
              }}
              aria-label="Approve intervention"
            >
              Approve
            </button>
            <button
              onClick={() => handleAction("later")}
              style={{
                padding: "var(--ah-space-2) var(--ah-space-3)",
                borderRadius: "var(--ah-radius-md)",
                border: "1px solid var(--ah-border-strong)",
                background: "var(--ah-bg-primary)",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-sm)",
                color: "var(--ah-text-secondary)"
              }}
              aria-label="Snooze intervention"
            >
              Later
            </button>
            <button
              onClick={() => handleAction("ignore")}
              style={{
                padding: "var(--ah-space-2) var(--ah-space-3)",
                borderRadius: "var(--ah-radius-md)",
                border: "1px solid var(--ah-border-strong)",
                background: "var(--ah-bg-primary)",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-sm)",
                color: "var(--ah-text-secondary)"
              }}
              aria-label="Ignore intervention"
            >
              Ignore
            </button>
            <button
              onClick={() => handleAction("reject")}
              style={{
                padding: "var(--ah-space-2) var(--ah-space-3)",
                borderRadius: "var(--ah-radius-md)",
                border: "none",
                background: "var(--ah-danger)",
                color: "var(--ah-text-inverse)",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-sm)",
                fontWeight: 600
              }}
              aria-label="Reject intervention"
            >
              Reject
            </button>
          </div>
        </>
      )}

      {isResolved && (
        <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)" }}>Status: {status}</div>
      )}
    </div>
  );
}

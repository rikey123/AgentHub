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
  const priorityColor = card.priority === "high" ? "#ef4444" : card.priority === "medium" ? "#d97706" : "#6b7280";

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#1e40af" }}>Intervention</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#ffffff", background: priorityColor, padding: "2px 8px", borderRadius: 10 }}>
          {card.priority}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "#1e3a8a", marginBottom: 4 }}>
        <strong>Agent:</strong> {card.agentId}
      </div>
      <div style={{ fontSize: 13, color: "#1e3a8a", marginBottom: 4 }}>{card.reason}</div>
      {card.preview && (
        <div style={{ fontSize: 12, color: "#3b82f6", marginBottom: 8, fontStyle: "italic" }}>{card.preview}</div>
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
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #bfdbfe",
              fontSize: 12,
              marginBottom: 8,
              resize: "vertical"
            }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => handleAction("approve")}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "none",
                background: "#10b981",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600
              }}
            >
              Approve
            </button>
            <button
              onClick={() => handleAction("later")}
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
              Later
            </button>
            <button
              onClick={() => handleAction("ignore")}
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
              Ignore
            </button>
            <button
              onClick={() => handleAction("reject")}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "none",
                background: "#ef4444",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600
              }}
            >
              Reject
            </button>
          </div>
        </>
      )}

      {isResolved && (
        <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginTop: 4 }}>Status: {status}</div>
      )}
    </div>
  );
}

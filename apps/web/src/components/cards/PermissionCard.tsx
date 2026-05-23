import { useState } from "react";
import type { Card } from "@agenthub/protocol/domains";

type PermissionCardProps = {
  readonly card: Extract<Card, { type: "permission" }>;
};

export function PermissionCard({ card }: PermissionCardProps) {
  const [decision, setDecision] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);

  const handleResolve = async (decisionValue: "allow" | "deny") => {
    setDecision(decisionValue);
    try {
      await fetch(`/permissions/${encodeURIComponent(card.permissionId)}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: decisionValue, remember, scope: "once" })
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("resolve permission failed", error);
    }
  };

  const isResolved = card.status !== "pending" || decision !== null;
  const resolvedStatus = decision ?? card.status;

  return (
    <div
      style={{
        marginTop: 8,
        padding: "12px 14px",
        borderRadius: 8,
        background: "#fef3c7",
        border: "1px solid #fcd34d"
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e", marginBottom: 6 }}>Permission Request</div>
      <div style={{ fontSize: 13, color: "#78350f", marginBottom: 4 }}>
        <strong>Agent:</strong> {card.agentId}
      </div>
      <div style={{ fontSize: 13, color: "#78350f", marginBottom: 4 }}>
        <strong>Resource:</strong> {card.resource.type}
      </div>
      {card.reason && (
        <div style={{ fontSize: 12, color: "#92400e", marginBottom: 8 }}>{card.reason}</div>
      )}

      {!isResolved && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#78350f", marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Always allow for this project
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => handleResolve("allow")}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "none",
                background: "#10b981",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600
              }}
            >
              Allow
            </button>
            <button
              onClick={() => handleResolve("deny")}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "none",
                background: "#ef4444",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600
              }}
            >
              Deny
            </button>
          </div>
        </>
      )}

      {isResolved && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: resolvedStatus === "allowed" ? "#059669" : "#dc2626",
            marginTop: 4
          }}
        >
          {resolvedStatus === "allowed" ? "Allowed" : resolvedStatus === "denied" ? "Denied" : resolvedStatus}
        </div>
      )}
    </div>
  );
}

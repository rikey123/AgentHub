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
        marginTop: "var(--ah-space-2)",
        padding: "var(--ah-space-3) var(--ah-space-4)",
        borderRadius: "var(--ah-radius-lg)",
        background: "var(--ah-warning-light)",
        border: "1px solid var(--ah-warning)"
      }}
    >
      <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-warning)", marginBottom: "var(--ah-space-2)" }}>Permission Request</div>
      <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-warning)", marginBottom: "var(--ah-space-1)" }}>
        <strong>Agent:</strong> {card.agentId}
      </div>
      <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-warning)", marginBottom: "var(--ah-space-1)" }}>
        <strong>Resource:</strong> {card.resource.type}
      </div>
      {card.reason && (
        <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-warning)", marginBottom: "var(--ah-space-2)" }}>{card.reason}</div>
      )}

      {!isResolved && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-1)", fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-warning)", marginBottom: "var(--ah-space-3)", cursor: "pointer" }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} aria-label="Always allow for this project" />
            Always allow for this project
          </label>
          <div style={{ display: "flex", gap: "var(--ah-space-2)" }}>
            <button
              onClick={() => handleResolve("allow")}
              style={{
                padding: "var(--ah-space-2) var(--ah-space-4)",
                borderRadius: "var(--ah-radius-md)",
                border: "none",
                background: "var(--ah-success)",
                color: "var(--ah-text-inverse)",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-md)",
                fontWeight: 600
              }}
              aria-label="Allow permission"
            >
              Allow
            </button>
            <button
              onClick={() => handleResolve("deny")}
              style={{
                padding: "var(--ah-space-2) var(--ah-space-4)",
                borderRadius: "var(--ah-radius-md)",
                border: "none",
                background: "var(--ah-danger)",
                color: "var(--ah-text-inverse)",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-md)",
                fontWeight: 600
              }}
              aria-label="Deny permission"
            >
              Deny
            </button>
          </div>
        </>
      )}

      {isResolved && (
        <div
          style={{
            fontSize: "var(--ah-font-size-sm)",
            fontWeight: 600,
            color: resolvedStatus === "allowed" ? "var(--ah-success)" : "var(--ah-danger)",
            marginTop: "var(--ah-space-1)"
          }}
        >
          {resolvedStatus === "allowed" ? "Allowed" : resolvedStatus === "denied" ? "Denied" : resolvedStatus}
        </div>
      )}
    </div>
  );
}

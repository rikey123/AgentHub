import { useState } from "react";
import type { Card } from "@agenthub/protocol/domains";

type DiffCardProps = {
  readonly card: Extract<Card, { type: "diff" }>;
};

export function DiffCard({ card }: DiffCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(card.applyStatus);

  const handleApply = async () => {
    try {
      await fetch(`/artifacts/${encodeURIComponent(card.artifactId)}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      setStatus("applied");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("apply diff failed", error);
    }
  };

  const handleReject = async () => {
    try {
      await fetch(`/artifacts/${encodeURIComponent(card.artifactId)}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      setStatus("rejected");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("reject diff failed", error);
    }
  };

  const totalAdditions = card.files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = card.files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div
      style={{
        marginTop: 8,
        padding: "12px 14px",
        borderRadius: 8,
        background: "#f0fdf4",
        border: "1px solid #bbf7d0"
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#166534", marginBottom: 6 }}>Diff</div>
      <div style={{ fontSize: 13, color: "#14532d", marginBottom: 4 }}>
        {card.files.length} files changed
        <span style={{ color: "#10b981", marginLeft: 8 }}>+{totalAdditions}</span>
        <span style={{ color: "#ef4444", marginLeft: 4 }}>-{totalDeletions}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 8, marginBottom: 8 }}>
          {card.files.map((file) => (
            <div key={file.path} style={{ fontSize: 12, color: "#374151", padding: "4px 0", borderBottom: "1px solid #e5e7eb" }}>
              <span
                style={{
                  fontWeight: 600,
                  color: file.status === "added" ? "#10b981" : file.status === "deleted" ? "#ef4444" : "#3b82f6"
                }}
              >
                {file.status}
              </span>{" "}
              {file.path}
              <span style={{ color: "#10b981", marginLeft: 8 }}>+{file.additions}</span>
              <span style={{ color: "#ef4444", marginLeft: 4 }}>-{file.deletions}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          onClick={() => setExpanded((v) => !v)}
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
          {expanded ? "Hide" : "View"}
        </button>
        {status === "draft" || status === "reviewing" || status === "accepted" ? (
          <>
            <button
              onClick={handleApply}
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
              Apply
            </button>
            <button
              onClick={handleReject}
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
          </>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: status === "applied" ? "#059669" : "#dc2626" }}>
            {status === "applied" ? "Applied" : status === "rejected" ? "Rejected" : status}
          </span>
        )}
      </div>
    </div>
  );
}

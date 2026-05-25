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
        marginTop: "var(--ah-space-2)",
        padding: "var(--ah-space-3) var(--ah-space-4)",
        borderRadius: "var(--ah-radius-lg)",
        background: "var(--ah-success-light)",
        border: "1px solid var(--ah-success)"
      }}
    >
      <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-success-hover)", marginBottom: "var(--ah-space-2)" }}>Diff</div>
      <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-success-hover)", marginBottom: "var(--ah-space-1)" }}>
        {card.files.length} files changed
        <span style={{ color: "var(--ah-success)", marginLeft: "var(--ah-space-2)" }}>+{totalAdditions}</span>
        <span style={{ color: "var(--ah-danger)", marginLeft: "var(--ah-space-1)" }}>-{totalDeletions}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: "var(--ah-space-2)", marginBottom: "var(--ah-space-2)" }}>
          {card.files.map((file) => (
            <div key={file.path} style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-secondary)", padding: "var(--ah-space-1) 0", borderBottom: "1px solid var(--ah-border)" }}>
              <span
                style={{
                  fontWeight: 600,
                  color: file.status === "added" ? "var(--ah-success)" : file.status === "deleted" ? "var(--ah-danger)" : "var(--ah-accent)"
                }}
              >
                {file.status}
              </span>{" "}
              {file.path}
              <span style={{ color: "var(--ah-success)", marginLeft: "var(--ah-space-2)" }}>+{file.additions}</span>
              <span style={{ color: "var(--ah-danger)", marginLeft: "var(--ah-space-1)" }}>-{file.deletions}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--ah-space-2)", marginTop: "var(--ah-space-2)" }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            padding: "var(--ah-space-2) var(--ah-space-3)",
            borderRadius: "var(--ah-radius-md)",
            border: "1px solid var(--ah-border-strong)",
            background: "var(--ah-bg-primary)",
            cursor: "pointer",
            fontSize: "var(--ah-font-size-sm)",
            color: "var(--ah-text-secondary)"
          }}
          aria-label={expanded ? "Hide diff details" : "View diff details"}
        >
          {expanded ? "Hide" : "View"}
        </button>
        {status === "draft" || status === "reviewing" || status === "accepted" ? (
          <>
            <button
              onClick={handleApply}
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
              aria-label="Apply diff"
            >
              Apply
            </button>
            <button
              onClick={handleReject}
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
              aria-label="Reject diff"
            >
              Reject
            </button>
          </>
        ) : (
          <span style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: status === "applied" ? "var(--ah-success)" : "var(--ah-danger)" }}>
            {status === "applied" ? "Applied" : status === "rejected" ? "Rejected" : status}
          </span>
        )}
      </div>
    </div>
  );
}

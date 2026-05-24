type MailboxFailureCardProps = {
  readonly reason: string;
  readonly targetAgentId: string;
  readonly timestamp: number;
  readonly onRetry?: () => void;
  readonly onDebug?: () => void;
};

export function MailboxFailureCard({ reason, targetAgentId, timestamp, onRetry, onDebug }: MailboxFailureCardProps) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: "12px 16px",
        borderRadius: 8,
        background: "#fef2f2",
        border: "1px solid #fecaca",
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}
      data-testid="mailbox-failure-card"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>&#x26A0;</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#991b1b" }}>Delivery Failed</span>
      </div>
      <div style={{ fontSize: 12, color: "#7f1d1d" }}>
        <strong>Reason:</strong> {reason}
      </div>
      <div style={{ fontSize: 12, color: "#7f1d1d" }}>
        <strong>Target:</strong> {targetAgentId}
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af" }}>
        {new Date(timestamp).toLocaleString()}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {onRetry && (
          <button
            onClick={onRetry}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #ef4444",
              background: "#ffffff",
              cursor: "pointer",
              fontSize: 12,
              color: "#ef4444",
              fontWeight: 500
            }}
            data-testid="mailbox-failure-retry"
          >
            Retry
          </button>
        )}
        {onDebug && (
          <button
            onClick={onDebug}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              background: "transparent",
              cursor: "pointer",
              fontSize: 12,
              color: "#6b7280"
            }}
            data-testid="mailbox-failure-debug"
          >
            Debug
          </button>
        )}
      </div>
    </div>
  );
}

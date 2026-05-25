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
        marginTop: "var(--ah-space-3)",
        padding: "var(--ah-space-3) var(--ah-space-4)",
        borderRadius: "var(--ah-radius-lg)",
        background: "var(--ah-danger-light)",
        border: "1px solid var(--ah-danger)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--ah-space-2)"
      }}
      data-testid="mailbox-failure-card"
      role="alert"
      aria-live="assertive"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)" }}>
        <span style={{ fontSize: "var(--ah-font-size-base)" }}>&#x26A0;</span>
        <span style={{ fontSize: "var(--ah-font-size-md)", fontWeight: 600, color: "var(--ah-text-danger)" }}>Delivery Failed</span>
      </div>
      <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-danger)" }}>
        <strong>Reason:</strong> {reason}
      </div>
      <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-danger)" }}>
        <strong>Target:</strong> {targetAgentId}
      </div>
      <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)" }}>
        {new Date(timestamp).toLocaleString()}
      </div>
      <div style={{ display: "flex", gap: "var(--ah-space-2)", marginTop: "var(--ah-space-1)" }}>
        {onRetry && (
          <button
            onClick={onRetry}
            style={{
              padding: "var(--ah-space-1) var(--ah-space-3)",
              borderRadius: "var(--ah-radius-sm)",
              border: "1px solid var(--ah-danger)",
              background: "var(--ah-bg-primary)",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-sm)",
              color: "var(--ah-danger)",
              fontWeight: 500
            }}
            data-testid="mailbox-failure-retry"
            aria-label="Retry delivery"
          >
            Retry
          </button>
        )}
        {onDebug && (
          <button
            onClick={onDebug}
            style={{
              padding: "var(--ah-space-1) var(--ah-space-3)",
              borderRadius: "var(--ah-radius-sm)",
              border: "1px solid var(--ah-border-strong)",
              background: "transparent",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-sm)",
              color: "var(--ah-text-muted)"
            }}
            data-testid="mailbox-failure-debug"
            aria-label="Debug delivery failure"
          >
            Debug
          </button>
        )}
      </div>
    </div>
  );
}

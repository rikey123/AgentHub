import type { MessageViewModel } from "../types.ts";

type PendingTurnListProps = {
  readonly pendingTurns: readonly MessageViewModel[];
  readonly onCancel: (pendingTurnId: string) => void;
  readonly onEdit: (messageId: string, text: string) => void;
  readonly disabled: boolean;
};

export function PendingTurnList({ pendingTurns, onCancel, onEdit, disabled }: PendingTurnListProps) {
  const showWarning = pendingTurns.length >= 15;

  return (
    <div style={{ borderTop: "1px solid var(--ah-border)", padding: "var(--ah-space-2) var(--ah-space-4)", background: "var(--ah-bg-elevated)" }}>
      {showWarning && (
        <div
          style={{
            background: "var(--ah-warning-light)",
            color: "var(--ah-text-warning)",
            padding: "var(--ah-space-1) var(--ah-space-2)",
            borderRadius: "var(--ah-radius-sm)",
            fontSize: "var(--ah-font-size-xs)",
            marginBottom: "var(--ah-space-2)",
            fontWeight: 500
          }}
          role="alert"
          aria-live="polite"
        >
          Queue approaching limit ({pendingTurns.length}/20)
        </div>
      )}
      <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-muted)", marginBottom: "var(--ah-space-2)", textTransform: "uppercase" }}>
        Pending ({pendingTurns.length})
      </div>
      {pendingTurns.map((turn, index) => (
        <div
          key={turn.pendingTurnId ?? turn.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--ah-space-2)",
            padding: "var(--ah-space-2)",
            borderRadius: "var(--ah-radius-md)",
            background: "var(--ah-bg-primary)",
            border: "1px solid var(--ah-border)",
            marginBottom: "var(--ah-space-2)",
            fontSize: "var(--ah-font-size-sm)"
          }}
        >
          <span style={{ color: "var(--ah-text-muted)", fontWeight: 500, minWidth: 20 }}>#{index + 1}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ah-text-secondary)" }}>
            "{turn.text.slice(0, 60)}{turn.text.length > 60 ? "..." : ""}"
          </span>
          <span style={{ color: "var(--ah-text-muted)", fontSize: "var(--ah-font-size-xs)", whiteSpace: "nowrap" }}>
            {turn.createdAt ? new Date(turn.createdAt).toLocaleTimeString() : ""}
          </span>
          <button
            onClick={() => turn.pendingTurnId && onEdit(turn.id, turn.text)}
            disabled={disabled}
            title={disabled ? "Needs online connection" : "Edit"}
            style={{
              padding: "2px var(--ah-space-2)",
              borderRadius: "var(--ah-radius-sm)",
              border: "1px solid var(--ah-border-strong)",
              background: "var(--ah-bg-primary)",
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: "var(--ah-font-size-xs)",
              color: disabled ? "var(--ah-text-muted)" : "var(--ah-text-secondary)"
            }}
            data-testid={`pending-turn-edit-${turn.pendingTurnId ?? turn.id}`}
            aria-label="Edit pending turn"
          >
            Edit
          </button>
          <button
            onClick={() => {
              if (window.confirm("Are you sure you want to cancel this pending turn? This cannot be undone.")) {
                if (turn.pendingTurnId) onCancel(turn.pendingTurnId);
              }
            }}
            disabled={disabled}
            title={disabled ? "Needs online connection" : "Cancel"}
            style={{
              padding: "2px var(--ah-space-2)",
              borderRadius: "var(--ah-radius-sm)",
              border: "1px solid var(--ah-border-strong)",
              background: "var(--ah-bg-primary)",
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: "var(--ah-font-size-xs)",
              color: disabled ? "var(--ah-text-muted)" : "var(--ah-danger)"
            }}
            data-testid={`pending-turn-cancel-${turn.pendingTurnId ?? turn.id}`}
            aria-label="Cancel pending turn"
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}

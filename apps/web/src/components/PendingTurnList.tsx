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
    <div style={{ borderTop: "1px solid #e5e7eb", padding: "8px 16px", background: "#fafafa" }}>
      {showWarning && (
        <div
          style={{
            background: "#fef3c7",
            color: "#92400e",
            padding: "4px 8px",
            borderRadius: 4,
            fontSize: 11,
            marginBottom: 6,
            fontWeight: 500
          }}
        >
          Queue approaching limit ({pendingTurns.length}/20)
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 6, textTransform: "uppercase" }}>
        Pending ({pendingTurns.length})
      </div>
      {pendingTurns.map((turn, index) => (
        <div
          key={turn.pendingTurnId ?? turn.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            borderRadius: 6,
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            marginBottom: 6,
            fontSize: 12
          }}
        >
          <span style={{ color: "#9ca3af", fontWeight: 500, minWidth: 20 }}>#{index + 1}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>
            "{turn.text.slice(0, 60)}{turn.text.length > 60 ? "..." : ""}"
          </span>
          <span style={{ color: "#9ca3af", fontSize: 11, whiteSpace: "nowrap" }}>
            {turn.createdAt ? new Date(turn.createdAt).toLocaleTimeString() : ""}
          </span>
          <button
            onClick={() => turn.pendingTurnId && onEdit(turn.id, turn.text)}
            disabled={disabled}
            title={disabled ? "Needs online connection" : "Edit"}
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: 11,
              color: disabled ? "#9ca3af" : "#374151"
            }}
            data-testid={`pending-turn-edit-${turn.pendingTurnId ?? turn.id}`}
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
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: 11,
              color: disabled ? "#9ca3af" : "#ef4444"
            }}
            data-testid={`pending-turn-cancel-${turn.pendingTurnId ?? turn.id}`}
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}

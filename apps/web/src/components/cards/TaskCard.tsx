import type { Card } from "@agenthub/protocol/domains";

type TaskCardProps = {
  readonly card: Extract<Card, { type: "task" }>;
};

export function TaskCard({ card }: TaskCardProps) {
  const statusColors: Record<string, string> = {
    todo: "var(--ah-text-muted)",
    queued: "var(--ah-accent)",
    running: "var(--ah-accent)",
    waiting_approval: "var(--ah-warning)",
    blocked: "var(--ah-danger)",
    review: "#8b5cf6",
    done: "var(--ah-success)",
    failed: "var(--ah-danger)",
    cancelled: "var(--ah-text-muted)"
  };

  return (
    <div
      style={{
        marginTop: "var(--ah-space-2)",
        padding: "var(--ah-space-3) var(--ah-space-4)",
        borderRadius: "var(--ah-radius-lg)",
        background: "var(--ah-bg-secondary)",
        border: "1px solid var(--ah-border)"
      }}
    >
      <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-muted)", marginBottom: "var(--ah-space-2)" }}>Task</div>
      <div style={{ fontSize: "var(--ah-font-size-md)", fontWeight: 600, color: "var(--ah-text-primary)", marginBottom: "var(--ah-space-1)" }}>{card.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)", marginTop: "var(--ah-space-1)" }}>
        <span
          style={{
            fontSize: "var(--ah-font-size-xs)",
            fontWeight: 600,
            color: "var(--ah-text-inverse)",
            background: statusColors[card.status] ?? "var(--ah-text-muted)",
            padding: "2px var(--ah-space-2)",
            borderRadius: "var(--ah-radius-full)"
          }}
          aria-label={`Status: ${card.status}`}
        >
          {card.status}
        </span>
        {card.assigneeAgentId && <span style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)" }}>{card.assigneeAgentId}</span>}
      </div>
    </div>
  );
}

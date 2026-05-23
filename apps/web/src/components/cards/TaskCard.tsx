import type { Card } from "@agenthub/protocol/domains";

type TaskCardProps = {
  readonly card: Extract<Card, { type: "task" }>;
};

export function TaskCard({ card }: TaskCardProps) {
  const statusColors: Record<string, string> = {
    todo: "#6b7280",
    queued: "#3b82f6",
    running: "#3b82f6",
    waiting_approval: "#d97706",
    blocked: "#ef4444",
    review: "#8b5cf6",
    done: "#10b981",
    failed: "#ef4444",
    cancelled: "#6b7280"
  };

  return (
    <div
      style={{
        marginTop: 8,
        padding: "12px 14px",
        borderRadius: 8,
        background: "#faf5ff",
        border: "1px solid #e9d5ff"
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b21a8", marginBottom: 6 }}>Task</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#581c87", marginBottom: 4 }}>{card.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "#ffffff",
            background: statusColors[card.status] ?? "#6b7280",
            padding: "2px 8px",
            borderRadius: 10
          }}
        >
          {card.status}
        </span>
        {card.assigneeAgentId && <span style={{ fontSize: 11, color: "#7e22ce" }}>{card.assigneeAgentId}</span>}
      </div>
    </div>
  );
}

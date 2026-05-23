import type { Card } from "@agenthub/protocol/domains";

type UnknownCardProps = {
  readonly card: Card;
};

export function UnknownCard({ card }: UnknownCardProps) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: "12px 14px",
        borderRadius: 8,
        background: "#f3f4f6",
        border: "1px solid #d1d5db"
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>Unknown Card</div>
      <pre style={{ fontSize: 11, color: "#374151", overflow: "auto", maxHeight: 120 }}>{JSON.stringify(card, null, 2)}</pre>
    </div>
  );
}

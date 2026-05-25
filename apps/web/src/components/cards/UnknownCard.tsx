import type { Card } from "@agenthub/protocol/domains";

type UnknownCardProps = {
  readonly card: Card;
};

export function UnknownCard({ card }: UnknownCardProps) {
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
      <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-muted)", marginBottom: "var(--ah-space-2)" }}>Unknown Card</div>
      <pre style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-secondary)", overflow: "auto", maxHeight: 120 }}>{JSON.stringify(card, null, 2)}</pre>
    </div>
  );
}

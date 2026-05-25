import { useState } from "react";
import type { Card } from "@agenthub/protocol/domains";

type PreviewCardProps = {
  readonly card: Extract<Card, { type: "preview" }>;
};

export function PreviewCard({ card }: PreviewCardProps) {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <div
      style={{
        marginTop: "var(--ah-space-2)",
        padding: "var(--ah-space-3) var(--ah-space-4)",
        borderRadius: "var(--ah-radius-lg)",
        background: "var(--ah-accent-light)",
        border: "1px solid var(--ah-accent)"
      }}
    >
      <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-accent-text)", marginBottom: "var(--ah-space-2)" }}>Preview</div>
      <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-accent-text)", marginBottom: "var(--ah-space-2)" }}>{card.kind}</div>

      {!fullscreen && (
        <div style={{ display: "flex", gap: "var(--ah-space-2)" }}>
          <button
            onClick={() => setFullscreen(true)}
            style={{
              padding: "var(--ah-space-2) var(--ah-space-3)",
              borderRadius: "var(--ah-radius-md)",
              border: "1px solid var(--ah-border-strong)",
              background: "var(--ah-bg-primary)",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-sm)",
              color: "var(--ah-text-secondary)"
            }}
            aria-label="Open preview"
          >
            Open Preview
          </button>
        </div>
      )}

      {fullscreen && (
        <div style={{ marginTop: "var(--ah-space-2)" }}>
          <iframe
            src={card.url}
            sandbox="allow-scripts"
            style={{ width: "100%", height: 300, border: "1px solid var(--ah-accent)", borderRadius: "var(--ah-radius-md)" }}
            title="Preview"
            loading="lazy"
          />
          <button
            onClick={() => setFullscreen(false)}
            style={{
              marginTop: "var(--ah-space-2)",
              padding: "var(--ah-space-2) var(--ah-space-3)",
              borderRadius: "var(--ah-radius-md)",
              border: "1px solid var(--ah-border-strong)",
              background: "var(--ah-bg-primary)",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-sm)",
              color: "var(--ah-text-secondary)"
            }}
            aria-label="Close preview"
          >
            Close Preview
          </button>
        </div>
      )}
    </div>
  );
}

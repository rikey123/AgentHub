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
        marginTop: 8,
        padding: "12px 14px",
        borderRadius: 8,
        background: "#f0f9ff",
        border: "1px solid #bae6fd"
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#0369a1", marginBottom: 6 }}>Preview</div>
      <div style={{ fontSize: 13, color: "#0c4a6e", marginBottom: 8 }}>{card.kind}</div>

      {!fullscreen && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setFullscreen(true)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              cursor: "pointer",
              fontSize: 12,
              color: "#374151"
            }}
          >
            Open Preview
          </button>
        </div>
      )}

      {fullscreen && (
        <div style={{ marginTop: 8 }}>
          <iframe
            src={card.url}
            sandbox="allow-scripts"
            style={{ width: "100%", height: 300, border: "1px solid #bfdbfe", borderRadius: 6 }}
            title="Preview"
          />
          <button
            onClick={() => setFullscreen(false)}
            style={{
              marginTop: 8,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              cursor: "pointer",
              fontSize: 12,
              color: "#374151"
            }}
          >
            Close Preview
          </button>
        </div>
      )}
    </div>
  );
}

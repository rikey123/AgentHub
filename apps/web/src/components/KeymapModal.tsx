import { useEffect } from "react";

type KeymapModalProps = {
  readonly onClose: () => void;
};

const KEYMAP_SECTIONS = [
  {
    title: "Message Stream",
    items: [
      { key: "j", description: "Select next message" },
      { key: "k", description: "Select previous message" },
      { key: "r", description: "Open Run Detail for selected message" },
      { key: "Enter", description: "Open Run Detail if message has brief" },
      { key: "q", description: "Quote selected message" },
      { key: "p", description: "Pin selected message" },
      { key: "d", description: "Delete selected message" },
      { key: "Esc", description: "Close Run Detail / modal" }
    ]
  },
  {
    title: "Input Box",
    items: [
      { key: "Shift + Enter", description: "New line" },
      { key: "Ctrl/Cmd + Enter", description: "Send message" },
      { key: "Tab / Shift+Tab", description: "Navigate @mention candidates" },
      { key: "Enter", description: "Select @mention candidate" },
      { key: "Esc", description: "Close @mention popover" }
    ]
  },
  {
    title: "Global",
    items: [
      { key: "Ctrl/Cmd + K", description: "Open command palette" },
      { key: "?", description: "Show this keymap" },
      { key: "g r", description: "Jump to Room list" },
      { key: "g d", description: "Jump to Debug Panel (admin)" }
    ]
  },
  {
    title: "Pending Turns",
    items: [
      { key: "↑", description: "Focus most recent pending turn" },
      { key: "Backspace / Delete", description: "Cancel focused pending turn" }
    ]
  }
];

export function KeymapModal({ onClose }: KeymapModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="ah-keymap-overlay" onClick={onClose} role="dialog" aria-label="Keyboard shortcuts" aria-modal="true">
      <div className="ah-keymap-modal" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "var(--ah-space-4)"
          }}
        >
          <h2 style={{ margin: 0, fontSize: "var(--ah-font-size-lg)", color: "var(--ah-text-primary)" }}>Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-lg)",
              color: "var(--ah-text-muted)",
              padding: "var(--ah-space-1)"
            }}
            aria-label="Close keymap"
          >
            x
          </button>
        </div>
        {KEYMAP_SECTIONS.map((section) => (
          <div key={section.title} className="ah-keymap-section">
            <div className="ah-keymap-section-title">{section.title}</div>
            {section.items.map((item) => (
              <div key={item.key} className="ah-keymap-row">
                <span>{item.description}</span>
                <kbd>{item.key}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useRef, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";

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

function restoreFocus(previous: HTMLElement | null) {
  if (previous && previous.isConnected) {
    previous.focus({ preventScroll: true });
  }
}

export function KeymapModal({ onClose }: KeymapModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => restoreFocus(previousFocusRef.current);
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        closeButtonRef.current?.focus({ preventScroll: true });
      }
    },
    [onClose]
  );

  return (
    <div
      className="ah-keymap-overlay"
      onClick={onClose}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--ah-z-modal)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--ah-space-4)",
        background: "rgba(15, 23, 42, 0.58)",
        backdropFilter: "blur(12px)"
      }}
    >
      <div
        className="ah-keymap-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keymap-title"
        aria-describedby="keymap-description"
        style={{
          width: "min(920px, 100%)",
          maxHeight: "min(84vh, 820px)",
          overflow: "hidden",
          borderRadius: "calc(var(--ah-radius-xl) + 4px)",
          border: "1px solid var(--ah-border-strong)",
          background: "linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, var(--ah-bg-elevated) 100%)",
          boxShadow: "var(--ah-shadow-lg)",
          color: "var(--ah-text-primary)"
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--ah-space-4)",
            padding: "var(--ah-space-4) var(--ah-space-5) var(--ah-space-3)",
            borderBottom: "1px solid var(--ah-border)",
            background: "linear-gradient(180deg, var(--ah-bg-primary) 0%, var(--ah-bg-elevated) 100%)"
          }}
        >
          <div>
            <h2
              id="keymap-title"
              style={{
                margin: 0,
                fontFamily: "var(--ah-font-heading)",
                fontSize: "var(--ah-font-size-xl)",
                fontWeight: 700,
                lineHeight: "var(--ah-line-height-tight)",
                letterSpacing: "-0.02em"
              }}
            >
              Keyboard Shortcuts
            </h2>
            <div id="keymap-description" style={{ marginTop: "var(--ah-space-1)", color: "var(--ah-text-muted)", fontSize: "var(--ah-font-size-sm)" }}>
              Mission-control reference for the keyboard-first workflow.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "var(--ah-space-1) var(--ah-space-2)",
                borderRadius: "var(--ah-radius-full)",
                background: "var(--ah-bg-secondary)",
                color: "var(--ah-text-secondary)",
                fontSize: "var(--ah-font-size-xs)",
                fontWeight: 700,
                whiteSpace: "nowrap"
              }}
            >
              Global shortcuts
            </span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              background: "var(--ah-bg-elevated)",
              border: "1px solid var(--ah-border)",
              borderRadius: "var(--ah-radius-full)",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-lg)",
              color: "var(--ah-text-muted)",
              boxShadow: "var(--ah-shadow-sm)"
            }}
            aria-label="Close keymap"
          >
            ×
          </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "var(--ah-space-3)",
            padding: "var(--ah-space-4) var(--ah-space-5)",
            overflow: "auto"
          }}
        >
          {KEYMAP_SECTIONS.map((section) => (
            <section
              key={section.title}
              className="ah-keymap-section"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--ah-space-2)",
                padding: "var(--ah-space-4)",
                borderRadius: "var(--ah-radius-lg)",
                border: "1px solid var(--ah-border)",
                background: "var(--ah-bg-primary)",
                boxShadow: "var(--ah-shadow-sm)"
              }}
            >
              <div
                className="ah-keymap-section-title"
                style={{
                  fontSize: "var(--ah-font-size-xs)",
                  letterSpacing: "var(--ah-letter-spacing-wide)",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  color: "var(--ah-text-muted)"
                }}
              >
                {section.title}
              </div>
              {section.items.map((item) => (
                <div
                  key={item.key}
                  className="ah-keymap-row"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "var(--ah-space-3)",
                    padding: "var(--ah-space-2) 0",
                    borderTop: "1px solid var(--ah-border-light)"
                  }}
                >
                  <span style={{ color: "var(--ah-text-primary)", fontSize: "var(--ah-font-size-sm)" }}>{item.description}</span>
                  <kbd
                    style={{
                      fontFamily: "var(--ah-font-mono)",
                      fontSize: "var(--ah-font-size-xs)",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      padding: "2px var(--ah-space-2)",
                      borderRadius: "var(--ah-radius-sm)",
                      border: "1px solid var(--ah-border)",
                      background: "var(--ah-bg-secondary)",
                      color: "var(--ah-text-secondary)"
                    }}
                  >
                    {item.key}
                  </kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

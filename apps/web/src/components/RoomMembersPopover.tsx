import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useFloating, offset, flip, shift, size, autoUpdate } from "@floating-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";

export type MentionCandidate = {
  readonly agentId: string;
  readonly displayName: string;
  readonly role: string;
  readonly presence: string;
};

type RoomMembersPopoverProps = {
  readonly candidates: readonly MentionCandidate[];
  readonly query: string;
  readonly onSelect: (candidate: MentionCandidate) => void;
  readonly onClose: () => void;
  readonly anchorElement: HTMLElement | null;
};

export function RoomMembersPopover({ candidates, query, onSelect, onClose, anchorElement }: RoomMembersPopoverProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.agentId.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q)
    );
  }, [candidates, query]);

  const { refs, floatingStyles } = useFloating({
    elements: {
      reference: anchorElement
    },
    placement: "top-start",
    strategy: "fixed",
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.min(availableHeight, 320)}px`;
        }
      })
    ],
    whileElementsMounted: autoUpdate
  });

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 40,
    overscan: 5
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  if (filtered.length === 0) return null;

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={refs.setFloating}
      style={{
        ...floatingStyles,
        background: "var(--ah-bg-primary)",
        border: "1px solid var(--ah-border)",
        borderRadius: "var(--ah-radius-lg)",
        boxShadow: "var(--ah-shadow-md)",
        zIndex: "var(--ah-z-modal)",
        overflow: "hidden",
        width: 280,
        display: "flex",
        flexDirection: "column"
      }}
      role="listbox"
      aria-label="Mention candidates"
    >
      <div
        ref={listRef}
        style={{ overflow: "auto", maxHeight: 320 }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualItems.map((virtualItem) => {
            const candidate = filtered[virtualItem.index];
            if (!candidate) return null;
            const isSelected = virtualItem.index === selectedIndex;
            return (
              <div
                key={candidate.agentId}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                onClick={() => onSelect(candidate)}
                onMouseEnter={() => setSelectedIndex(virtualItem.index)}
                role="option"
                aria-selected={isSelected}
                data-testid={`mention-candidate-${candidate.agentId}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualItem.size,
                  transform: `translateY(${virtualItem.start}px)`,
                  padding: "var(--ah-space-2) var(--ah-space-3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--ah-space-3)",
                  cursor: "pointer",
                  background: isSelected ? "var(--ah-accent-light)" : "transparent",
                  borderBottom: "1px solid var(--ah-border-light)"
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "var(--ah-radius-full)",
                    background: "var(--ah-bg-tertiary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "var(--ah-font-size-xs)",
                    fontWeight: 600,
                    color: "var(--ah-text-secondary)",
                    flexShrink: 0
                  }}
                >
                  {candidate.displayName.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--ah-font-size-md)", fontWeight: 500, color: "var(--ah-text-primary)" }}>{candidate.displayName}</div>
                  <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)" }}>
                    {candidate.agentId} · {candidate.role}
                  </div>
                </div>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "var(--ah-radius-full)",
                    background:
                      candidate.presence === "active" || candidate.presence === "working"
                        ? "var(--ah-success)"
                        : candidate.presence === "observing"
                          ? "var(--ah-accent)"
                          : "var(--ah-text-muted)",
                    flexShrink: 0
                  }}
                  title={candidate.presence}
                  aria-label={`Presence: ${candidate.presence}`}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

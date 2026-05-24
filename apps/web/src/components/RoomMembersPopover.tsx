import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useFloating, offset, flip, shift, size, autoUpdate } from "@floating-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ParticipantViewModel } from "../types.ts";

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
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 1000,
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
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  background: isSelected ? "#eff6ff" : "transparent",
                  borderBottom: "1px solid #f3f4f6"
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    background: "#e5e7eb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#374151",
                    flexShrink: 0
                  }}
                >
                  {candidate.displayName.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{candidate.displayName}</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>
                    {candidate.agentId} · {candidate.role}
                  </div>
                </div>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    background:
                      candidate.presence === "active" || candidate.presence === "working"
                        ? "#10b981"
                        : candidate.presence === "observing"
                          ? "#3b82f6"
                          : "#9ca3af",
                    flexShrink: 0
                  }}
                  title={candidate.presence}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

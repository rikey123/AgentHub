import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RoomViewModel } from "../types.ts";
import type { Theme, Density } from "../hooks/useTheme.ts";

type CommandPaletteProps = {
  readonly rooms: RoomViewModel[];
  readonly activeRoomId?: string | undefined;
  readonly onSelectRoom: (roomId: string) => void;
  readonly onOpenRunDetail: (runId: string) => void;
  readonly onClose: () => void;
  readonly onSwitchTheme: (theme: Theme) => void;
  readonly onSwitchDensity: (density: Density) => void;
  readonly currentTheme: Theme;
  readonly currentDensity: Density;
};

type CommandItem = {
  readonly id: string;
  readonly type: "room" | "run" | "action";
  readonly label: string;
  readonly subtitle?: string;
  readonly onSelect: () => void;
  readonly shortcut?: string;
};

export function CommandPalette({
  rooms,
  activeRoomId,
  onSelectRoom,
  onOpenRunDetail,
  onClose,
  onSwitchTheme,
  onSwitchDensity,
  currentTheme,
  currentDensity
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    const result: CommandItem[] = [];

    // Rooms
    const sortedRooms = [...rooms].sort((a, b) => {
      // Sort by unread first, then activity
      if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      return b.messages.length - a.messages.length;
    });

    for (const room of sortedRooms) {
      if (!q || room.title.toLowerCase().includes(q)) {
        result.push({
          id: `room-${room.id}`,
          type: "room",
          label: room.title,
          subtitle: `${room.mode} · ${room.messages.length} messages`,
          onSelect: () => onSelectRoom(room.id)
        });
      }
    }

    // Recent runs (from active room or all rooms)
    const activeRoom = rooms.find((r) => r.id === activeRoomId);
    const runsToShow = activeRoom ? activeRoom.runs.slice(0, 10) : rooms.flatMap((r) => r.runs).slice(0, 10);
    for (const run of runsToShow) {
      if (!q || run.agentName.toLowerCase().includes(q) || run.id.toLowerCase().includes(q)) {
        result.push({
          id: `run-${run.id}`,
          type: "run",
          label: `Run: ${run.agentName}`,
          subtitle: `${run.status} · ${run.id.slice(0, 8)}`,
          onSelect: () => onOpenRunDetail(run.id)
        });
      }
    }

    // Actions
    const actions: CommandItem[] = [
      {
        id: "action-theme-light",
        type: "action",
        label: "Switch to Light Theme",
        subtitle: `Current: ${currentTheme}`,
        onSelect: () => onSwitchTheme("light")
      },
      {
        id: "action-theme-dark",
        type: "action",
        label: "Switch to Dark Theme",
        subtitle: `Current: ${currentTheme}`,
        onSelect: () => onSwitchTheme("dark")
      },
      {
        id: "action-theme-auto",
        type: "action",
        label: "Switch to Auto Theme",
        subtitle: `Current: ${currentTheme}`,
        onSelect: () => onSwitchTheme("auto")
      },
      {
        id: "action-density-cozy",
        type: "action",
        label: "Switch to Cozy Density",
        subtitle: `Current: ${currentDensity}`,
        onSelect: () => onSwitchDensity("cozy")
      },
      {
        id: "action-density-compact",
        type: "action",
        label: "Switch to Compact Density",
        subtitle: `Current: ${currentDensity}`,
        onSelect: () => onSwitchDensity("compact")
      }
    ];

    for (const action of actions) {
      if (!q || action.label.toLowerCase().includes(q)) {
        result.push(action);
      }
    }

    return result;
  }, [rooms, activeRoomId, query, onSelectRoom, onOpenRunDetail, onSwitchTheme, onSwitchDensity, currentTheme, currentDensity]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) {
          item.onSelect();
          onClose();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [items, selectedIndex, onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Virtualization for >=20 items
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 40,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="ah-cmd-palette-overlay" onClick={onClose} role="dialog" aria-label="Command palette" aria-modal="true">
      <div className="ah-cmd-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search rooms, runs, actions..."
          className="ah-cmd-palette-input"
          aria-label="Command palette search"
        />
        <div ref={listRef} className="ah-cmd-palette-list" style={{ height: Math.min(items.length * 40, 320) }}>
          {items.length === 0 && (
            <div style={{ padding: "var(--ah-space-4)", textAlign: "center", color: "var(--ah-text-muted)", fontSize: "var(--ah-font-size-sm)" }}>
              No results found
            </div>
          )}
          {items.length > 0 && (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {virtualItems.map((virtualItem) => {
                const item = items[virtualItem.index];
                if (!item) return null;
                const isSelected = virtualItem.index === selectedIndex;
                return (
                  <div
                    key={virtualItem.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    className={`ah-cmd-palette-item ${isSelected ? "ah-cmd-palette-item--selected" : ""}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: virtualItem.size,
                      transform: `translateY(${virtualItem.start}px)`
                    }}
                    onClick={() => {
                      item.onSelect();
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(virtualItem.index)}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span style={{ fontWeight: 500, color: "var(--ah-text-primary)" }}>{item.label}</span>
                    {item.subtitle && (
                      <span style={{ color: "var(--ah-text-muted)", marginLeft: "var(--ah-space-2)", fontSize: "var(--ah-font-size-xs)" }}>
                        {item.subtitle}
                      </span>
                    )}
                    {item.shortcut && <kbd>{item.shortcut}</kbd>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div
          style={{
            padding: "var(--ah-space-2) var(--ah-space-4)",
            borderTop: "1px solid var(--ah-border)",
            fontSize: "var(--ah-font-size-xs)",
            color: "var(--ah-text-muted)",
            display: "flex",
            gap: "var(--ah-space-3)"
          }}
        >
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Select</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

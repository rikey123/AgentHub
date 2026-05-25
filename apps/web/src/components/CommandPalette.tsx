import { useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";
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
  readonly typeLabel: string;
  readonly label: string;
  readonly subtitle?: string;
  readonly onSelect: () => void;
  readonly shortcut?: string;
};

const ITEM_ESTIMATE = 76;

function restoreFocus(previous: HTMLElement | null) {
  if (previous && previous.isConnected) {
    previous.focus({ preventScroll: true });
  }
}

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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

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
          typeLabel: "Room",
          label: room.title,
          subtitle: `${room.mode} · ${room.messages.length} messages`,
          onSelect: () => onSelectRoom(room.id),
          shortcut: "↵"
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
          typeLabel: "Run",
          label: `Run: ${run.agentName}`,
          subtitle: `${run.status} · ${run.id.slice(0, 8)}`,
          onSelect: () => onOpenRunDetail(run.id),
          shortcut: "↵"
        });
      }
    }

    // Actions
    const actions: CommandItem[] = [
        {
          id: "action-theme-light",
          type: "action",
          typeLabel: "Action",
          label: "Switch to Light Theme",
          subtitle: `Current: ${currentTheme}`,
          onSelect: () => onSwitchTheme("light"),
          shortcut: "↵"
      },
        {
          id: "action-theme-dark",
          type: "action",
          typeLabel: "Action",
          label: "Switch to Dark Theme",
          subtitle: `Current: ${currentTheme}`,
          onSelect: () => onSwitchTheme("dark"),
          shortcut: "↵"
      },
        {
          id: "action-theme-auto",
          type: "action",
          typeLabel: "Action",
          label: "Switch to Auto Theme",
          subtitle: `Current: ${currentTheme}`,
          onSelect: () => onSwitchTheme("auto"),
          shortcut: "↵"
      },
        {
          id: "action-density-cozy",
          type: "action",
          typeLabel: "Action",
          label: "Switch to Cozy Density",
          subtitle: `Current: ${currentDensity}`,
          onSelect: () => onSwitchDensity("cozy"),
          shortcut: "↵"
      },
        {
          id: "action-density-compact",
          type: "action",
          typeLabel: "Action",
          label: "Switch to Compact Density",
          subtitle: `Current: ${currentDensity}`,
          onSelect: () => onSwitchDensity("compact"),
          shortcut: "↵"
      },
        {
          id: "action-close",
          type: "action",
          typeLabel: "Action",
          label: "Close command palette",
          subtitle: "Cancel and return to the room",
          onSelect: onClose,
          shortcut: "Esc"
      }
    ];

    for (const action of actions) {
      if (!q || action.label.toLowerCase().includes(q)) {
        result.push(action);
      }
    }

    return result;
  }, [rooms, activeRoomId, query, onSelectRoom, onOpenRunDetail, onSwitchTheme, onSwitchDensity, onClose, currentTheme, currentDensity]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    setSelectedIndex((prev) => (items.length === 0 ? 0 : Math.min(prev, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus({ preventScroll: true });

    return () => restoreFocus(previousFocusRef.current);
  }, []);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ITEM_ESTIMATE,
    overscan: 6
  });

  useEffect(() => {
    if (items.length > 0) {
      virtualizer.scrollToIndex(selectedIndex, { align: "center" });
    }
  }, [items.length, selectedIndex, virtualizer]);

  const handleSelectCurrent = useCallback(() => {
    const item = items[selectedIndex];
    if (!item) return;
    item.onSelect();
    onClose();
  }, [items, onClose, selectedIndex]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const activeElement = document.activeElement;
      const hasItems = items.length > 0;

      if (e.key === "Tab") {
        e.preventDefault();
        const focusables = [inputRef.current, closeButtonRef.current].filter(Boolean) as HTMLElement[];
        if (focusables.length === 0) return;

        const currentIndex = focusables.findIndex((element) => element === activeElement);
        const nextIndex = e.shiftKey
          ? currentIndex <= 0
            ? focusables.length - 1
            : currentIndex - 1
          : currentIndex < 0 || currentIndex === focusables.length - 1
            ? 0
            : currentIndex + 1;

        focusables[nextIndex]?.focus({ preventScroll: true });
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!hasItems) return;
        setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!hasItems) return;
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (e.key === "Home") {
        e.preventDefault();
        if (!hasItems) return;
        setSelectedIndex(0);
        return;
      }

      if (e.key === "End") {
        e.preventDefault();
        if (!hasItems) return;
        setSelectedIndex(items.length - 1);
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (!hasItems) return;
        handleSelectCurrent();
      }
    },
    [handleSelectCurrent, items.length, onClose]
  );

  const activeItemId = items[selectedIndex] ? `command-palette-item-${items[selectedIndex]!.id}` : undefined;
  const roomCount = items.filter((item) => item.type === "room").length;
  const runCount = items.filter((item) => item.type === "run").length;
  const actionCount = items.filter((item) => item.type === "action").length;
  const panelHeight = Math.min(Math.max(items.length * ITEM_ESTIMATE + 16, 240), 520);

  return (
    <div
      className="ah-cmd-palette-overlay"
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
        background: "rgba(15, 23, 42, 0.62)",
        backdropFilter: "blur(12px)"
      }}
    >
      <div
        className="ah-cmd-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        aria-describedby="command-palette-description"
        style={{
          width: "min(860px, 100%)",
          maxHeight: "min(80vh, 760px)",
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
          <div style={{ minWidth: 0 }}>
            <div
              id="command-palette-title"
              style={{
                fontFamily: "var(--ah-font-heading)",
                fontSize: "var(--ah-font-size-xl)",
                fontWeight: 700,
                lineHeight: "var(--ah-line-height-tight)",
                letterSpacing: "-0.02em"
              }}
            >
              Command palette
            </div>
            <div
              id="command-palette-description"
              style={{
                marginTop: "var(--ah-space-1)",
                color: "var(--ah-text-muted)",
                fontSize: "var(--ah-font-size-sm)"
              }}
            >
              Mission control for rooms, runs, theme, and density.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--ah-space-2)",
                padding: "var(--ah-space-1) var(--ah-space-2)",
                borderRadius: "var(--ah-radius-full)",
                background: "var(--ah-bg-secondary)",
                color: "var(--ah-text-secondary)",
                fontSize: "var(--ah-font-size-xs)",
                fontWeight: 700,
                whiteSpace: "nowrap"
              }}
            >
              <kbd>Ctrl/Cmd+K</kbd>
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--ah-space-2)",
                padding: "var(--ah-space-1) var(--ah-space-2)",
                borderRadius: "var(--ah-radius-full)",
                background: "var(--ah-bg-secondary)",
                color: "var(--ah-text-secondary)",
                fontSize: "var(--ah-font-size-xs)",
                fontWeight: 700,
                whiteSpace: "nowrap"
              }}
            >
              <kbd>?</kbd>
            </span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close command palette"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: "var(--ah-radius-full)",
                border: "1px solid var(--ah-border)",
                background: "var(--ah-bg-elevated)",
                color: "var(--ah-text-muted)",
                cursor: "pointer",
                boxShadow: "var(--ah-shadow-sm)"
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ padding: "var(--ah-space-4) var(--ah-space-5) var(--ah-space-3)" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: "var(--ah-space-3)",
              alignItems: "center"
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search rooms, runs, or actions"
              className="ah-cmd-palette-input"
              aria-label="Command palette search"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-activedescendant={activeItemId}
              style={{
                width: "100%",
                minWidth: 0,
                borderRadius: "var(--ah-radius-lg)",
                border: "1px solid var(--ah-border-strong)",
                background: "var(--ah-bg-primary)",
                color: "var(--ah-text-primary)",
                fontSize: "var(--ah-font-size-lg)",
                lineHeight: "var(--ah-line-height-normal)",
                padding: "var(--ah-space-3) var(--ah-space-4)",
                boxShadow: "var(--ah-shadow-sm)",
                outline: "none"
              }}
            />

            <div
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "2px",
                padding: "var(--ah-space-2) var(--ah-space-3)",
                borderRadius: "var(--ah-radius-lg)",
                border: "1px solid var(--ah-border)",
                background: "var(--ah-bg-secondary)",
                color: "var(--ah-text-muted)",
                fontSize: "var(--ah-font-size-xs)",
                whiteSpace: "nowrap"
              }}
            >
              <span>{items.length} results</span>
              <span>{roomCount} rooms · {runCount} runs · {actionCount} actions</span>
            </div>
          </div>
        </div>

        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          aria-label="Command palette results"
          style={{ height: panelHeight, overflow: "auto", padding: "0 var(--ah-space-3) var(--ah-space-3)" }}
        >
          {items.length === 0 ? (
            <div
              style={{
                minHeight: 220,
                display: "grid",
                placeItems: "center",
                padding: "var(--ah-space-6)",
                border: "1px dashed var(--ah-border-strong)",
                borderRadius: "var(--ah-radius-lg)",
                background: "var(--ah-bg-primary)",
                color: "var(--ah-text-muted)",
                textAlign: "center"
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: "var(--ah-text-secondary)" }}>No results found</div>
                <div style={{ marginTop: "var(--ah-space-1)", fontSize: "var(--ah-font-size-sm)" }}>
                  Try a room title, run id, or action name.
                </div>
              </div>
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {virtualizer.getVirtualItems().map((virtualItem: VirtualItem) => {
                const item = items[virtualItem.index];
                if (!item) return null;
                const isSelected = virtualItem.index === selectedIndex;
                return (
                  <div
                    key={virtualItem.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    id={`command-palette-item-${item.id}`}
                    className={`ah-cmd-palette-item ${isSelected ? "ah-cmd-palette-item--selected" : ""}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: virtualItem.size,
                      transform: `translateY(${virtualItem.start}px)`,
                      padding: "0 var(--ah-space-1)"
                    }}
                    onClick={() => {
                      item.onSelect();
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(virtualItem.index)}
                    role="option"
                    aria-selected={isSelected}
                    aria-label={`${item.label} ${item.typeLabel}`}
                  >
                    <div
                      style={{
                        height: "calc(100% - var(--ah-space-1))",
                        display: "grid",
                        gridTemplateColumns: "auto minmax(0, 1fr) auto",
                        alignItems: "center",
                        gap: "var(--ah-space-3)",
                        padding: "var(--ah-space-3) var(--ah-space-4)",
                        borderRadius: "var(--ah-radius-lg)",
                        border: isSelected ? "1px solid var(--ah-accent)" : "1px solid transparent",
                        background: isSelected ? "var(--ah-accent-light)" : "var(--ah-bg-elevated)",
                        boxShadow: isSelected ? "var(--ah-shadow-sm)" : "none",
                        cursor: "pointer",
                        transition: "background var(--ah-transition-fast), border-color var(--ah-transition-fast), box-shadow var(--ah-transition-fast)"
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: 68,
                          padding: "var(--ah-space-1) var(--ah-space-2)",
                          borderRadius: "var(--ah-radius-full)",
                          background: isSelected ? "var(--ah-accent)" : "var(--ah-bg-secondary)",
                          color: isSelected ? "var(--ah-text-inverse)" : "var(--ah-text-muted)",
                          fontSize: "var(--ah-font-size-xs)",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase"
                        }}
                      >
                        {item.typeLabel}
                      </span>

                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: "var(--ah-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {item.label}
                        </div>
                        {item.subtitle && (
                          <div style={{ color: "var(--ah-text-muted)", marginTop: "2px", fontSize: "var(--ah-font-size-xs)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {item.subtitle}
                          </div>
                        )}
                      </div>

                      {item.shortcut && (
                        <kbd
                          style={{
                            fontFamily: "var(--ah-font-mono)",
                            fontSize: "var(--ah-font-size-xs)",
                            fontWeight: 700,
                            color: isSelected ? "var(--ah-accent-text)" : "var(--ah-text-secondary)",
                            background: isSelected ? "rgba(255, 255, 255, 0.55)" : "var(--ah-bg-secondary)",
                            border: "1px solid var(--ah-border)",
                            borderRadius: "var(--ah-radius-sm)",
                            padding: "2px var(--ah-space-2)",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {item.shortcut}
                        </kbd>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--ah-space-3)",
            padding: "var(--ah-space-3) var(--ah-space-5)",
            borderTop: "1px solid var(--ah-border)",
            background: "var(--ah-bg-primary)",
            color: "var(--ah-text-muted)",
            fontSize: "var(--ah-font-size-xs)"
          }}
        >
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Select</span>
          <span><kbd>Esc</kbd> Close</span>
          <span><kbd>Tab</kbd> Trap focus</span>
        </div>
      </div>
    </div>
  );
}

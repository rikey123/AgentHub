import type { ReactNode } from "react";

type LayoutProps = {
  readonly leftCollapsed: boolean;
  readonly onToggleLeft: () => void;
  readonly rightCollapsed: boolean;
  readonly onToggleRight: () => void;
  readonly leftPanel: ReactNode;
  readonly centerPanel: ReactNode;
  readonly rightPanel: ReactNode;
  readonly overlay?: ReactNode;
  readonly connectionStatus?: "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";
  readonly onOpenCommandPalette?: () => void;
  readonly theme?: string;
  readonly onToggleTheme?: () => void;
};

const CONNECTION_LABELS: Record<NonNullable<LayoutProps["connectionStatus"]>, string> = {
  connected: "Connected",
  connecting: "Reconnecting...",
  reconnecting: "Reconnecting...",
  offline: "Offline",
  disconnected: "Offline"
};

const CONNECTION_COLORS: Record<NonNullable<LayoutProps["connectionStatus"]>, string> = {
  connected: "var(--ah-success)",
  connecting: "var(--ah-warning)",
  reconnecting: "var(--ah-warning)",
  offline: "var(--ah-danger)",
  disconnected: "var(--ah-danger)"
};

export function Layout({
  leftCollapsed,
  onToggleLeft,
  rightCollapsed,
  onToggleRight,
  leftPanel,
  centerPanel,
  rightPanel,
  overlay,
  connectionStatus = "disconnected",
  onOpenCommandPalette,
  theme,
  onToggleTheme
}: LayoutProps) {
  const statusLabel = CONNECTION_LABELS[connectionStatus];
  const statusColor = CONNECTION_COLORS[connectionStatus];

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", overflow: "hidden" }}>
      <header
        style={{
          height: "var(--ah-app-header-height)",
          minHeight: "var(--ah-app-header-height)",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: "var(--ah-space-4)",
          padding: "0 var(--ah-space-4)",
          borderBottom: "1px solid var(--ah-border)",
          background: "var(--ah-bg-elevated)",
          color: "var(--ah-text-primary)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)", minWidth: 0 }}>
          <span aria-hidden="true">⚡</span>
          <span style={{ fontWeight: 700, fontSize: "var(--ah-font-size-lg)", color: "var(--ah-text-primary)" }}>AgentHub</span>
        </div>

        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--ah-space-2)",
            color: "var(--ah-text-muted)",
            fontSize: "var(--ah-font-size-sm)",
            fontWeight: 600
          }}
        >
          <span
            className={connectionStatus === "connecting" || connectionStatus === "reconnecting" ? "ah-pulse-dot" : undefined}
            style={{
              width: "var(--ah-space-2)",
              height: "var(--ah-space-2)",
              borderRadius: "var(--ah-radius-full)",
              background: statusColor
            }}
          />
          {statusLabel}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--ah-space-2)" }}>
          <button
            onClick={onOpenCommandPalette}
            disabled={!onOpenCommandPalette}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--ah-space-2)",
              border: "1px solid var(--ah-border)",
              borderRadius: "var(--ah-radius-full)",
              background: "var(--ah-bg-primary)",
              color: "var(--ah-text-muted)",
              cursor: onOpenCommandPalette ? "pointer" : "default",
              fontSize: "var(--ah-font-size-sm)",
              padding: "var(--ah-space-1) var(--ah-space-3)"
            }}
            aria-label="Open command palette"
          >
            <kbd
              style={{
                fontFamily: "inherit",
                fontSize: "var(--ah-font-size-xs)",
                fontWeight: 700,
                borderRadius: "var(--ah-radius-sm)",
                border: "1px solid var(--ah-border)",
                background: "var(--ah-bg-secondary)",
                color: "var(--ah-text-secondary)",
                padding: "var(--ah-space-1) var(--ah-space-2)"
              }}
            >
              ⌘K
            </kbd>
          </button>
          <button
            onClick={onToggleTheme}
            disabled={!onToggleTheme}
            style={{
              width: "var(--ah-space-7)",
              height: "var(--ah-space-7)",
              border: "1px solid var(--ah-border)",
              borderRadius: "var(--ah-radius-full)",
              background: "var(--ah-bg-primary)",
              color: "var(--ah-text-secondary)",
              cursor: onToggleTheme ? "pointer" : "default",
              fontSize: "var(--ah-font-size-base)"
            }}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Left sidebar */}
        <div
          style={{
            width: leftCollapsed ? "var(--ah-sidebar-left-collapsed)" : "var(--ah-sidebar-left-width)",
            minWidth: leftCollapsed ? "var(--ah-sidebar-left-collapsed)" : "var(--ah-sidebar-left-width)",
            borderRight: "1px solid var(--ah-border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--ah-bg-elevated)",
            transition: "width var(--ah-transition-normal)"
          }}
        >
          <div style={{ padding: "var(--ah-space-3)", borderBottom: "1px solid var(--ah-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {!leftCollapsed && <span style={{ fontWeight: 600, fontSize: "var(--ah-font-size-base)", color: "var(--ah-text-primary)" }}>Rooms</span>}
            <button
              onClick={onToggleLeft}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "var(--ah-space-1)",
                borderRadius: "var(--ah-radius-sm)",
                color: "var(--ah-text-muted)",
                fontSize: "var(--ah-font-size-lg)",
                fontWeight: 600
              }}
              aria-label={leftCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={leftCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {leftCollapsed ? "›" : "‹"}
            </button>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>{leftPanel}</div>
        </div>

        {/* Center chat area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--ah-bg-primary)" }}>
          <div style={{ flex: 1, overflow: "auto", position: "relative" }}>{centerPanel}</div>
        </div>

        {/* Right side panel */}
        <div
          style={{
            width: rightCollapsed ? "var(--ah-sidebar-right-collapsed)" : "var(--ah-sidebar-right-width)",
            minWidth: rightCollapsed ? "var(--ah-sidebar-right-collapsed)" : "var(--ah-sidebar-right-width)",
            borderLeft: "1px solid var(--ah-border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--ah-bg-elevated)",
            transition: "width var(--ah-transition-normal)"
          }}
        >
          <div style={{ padding: "var(--ah-space-3)", borderBottom: "1px solid var(--ah-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {!rightCollapsed && <span style={{ fontWeight: 600, fontSize: "var(--ah-font-size-base)", color: "var(--ah-text-primary)" }}>Panel</span>}
            <button
              onClick={onToggleRight}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "var(--ah-space-1)",
                borderRadius: "var(--ah-radius-sm)",
                color: "var(--ah-text-muted)",
                fontSize: "var(--ah-font-size-lg)",
                fontWeight: 600
              }}
              aria-label={rightCollapsed ? "Expand panel" : "Collapse panel"}
              title={rightCollapsed ? "Expand panel" : "Collapse panel"}
            >
              {rightCollapsed ? "‹" : "›"}
            </button>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>{rightPanel}</div>
        </div>
      </div>

      {/* Overlay for Run Detail */}
      {overlay && (
        <div
          className="ah-slide-over-enter"
          style={{
            position: "fixed",
            top: "var(--ah-app-header-height)",
            right: 0,
            width: "60%",
            height: "calc(100% - var(--ah-app-header-height))",
            background: "var(--ah-bg-primary)",
            borderLeft: "1px solid var(--ah-border)",
            boxShadow: "var(--ah-shadow-overlay)",
            zIndex: "var(--ah-z-overlay)",
            display: "flex",
            flexDirection: "column"
          }}
        >
          {overlay}
        </div>
      )}
    </div>
  );
}

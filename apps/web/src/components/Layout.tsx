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
};

export function Layout({
  leftCollapsed,
  onToggleLeft,
  rightCollapsed,
  onToggleRight,
  leftPanel,
  centerPanel,
  rightPanel,
  overlay
}: LayoutProps) {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", overflow: "hidden" }}>
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
              color: "var(--ah-text-muted)"
            }}
            aria-label={leftCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {leftCollapsed ? ">" : "<"}
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
              color: "var(--ah-text-muted)"
            }}
            aria-label={rightCollapsed ? "Expand panel" : "Collapse panel"}
          >
            {rightCollapsed ? "<" : ">"}
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>{rightPanel}</div>
      </div>

      {/* Overlay for Run Detail */}
      {overlay && (
        <div
          className="ah-slide-over-enter"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: "60%",
            height: "100%",
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

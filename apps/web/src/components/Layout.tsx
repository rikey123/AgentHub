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
          width: leftCollapsed ? 48 : 240,
          minWidth: leftCollapsed ? 48 : 240,
          borderRight: "1px solid #e5e7eb",
          display: "flex",
          flexDirection: "column",
          background: "#f9fafb",
          transition: "width 0.2s ease"
        }}
      >
        <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {!leftCollapsed && <span style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>Rooms</span>}
          <button
            onClick={onToggleLeft}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              borderRadius: 4,
              color: "#6b7280"
            }}
            aria-label={leftCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {leftCollapsed ? ">" : "<"}
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>{leftPanel}</div>
      </div>

      {/* Center chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "#ffffff" }}>
        <div style={{ flex: 1, overflow: "auto", position: "relative" }}>{centerPanel}</div>
      </div>

      {/* Right side panel */}
      <div
        style={{
          width: rightCollapsed ? 48 : 280,
          minWidth: rightCollapsed ? 48 : 280,
          borderLeft: "1px solid #e5e7eb",
          display: "flex",
          flexDirection: "column",
          background: "#f9fafb",
          transition: "width 0.2s ease"
        }}
      >
        <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {!rightCollapsed && <span style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>Panel</span>}
          <button
            onClick={onToggleRight}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              borderRadius: 4,
              color: "#6b7280"
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
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: "60%",
            height: "100%",
            background: "#ffffff",
            borderLeft: "1px solid #e5e7eb",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
            zIndex: 100,
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

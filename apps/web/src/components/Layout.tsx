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

type RailItem = {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly caption?: string;
};

const CONNECTION_LABELS: Record<NonNullable<LayoutProps["connectionStatus"]>, string> = {
  connected: "Connected",
  connecting: "Connecting...",
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

const FEATURE_RAIL_ITEMS: RailItem[] = [
  { id: "chat", label: "Chat", icon: <ChatGlyph />, active: true },
  { id: "runs", label: "Runs", icon: <RunsGlyph /> },
  { id: "context", label: "Context", icon: <ContextGlyph /> },
  { id: "tasks", label: "Tasks", icon: <TasksGlyph /> },
  { id: "kanban", label: "Kanban", icon: <KanbanGlyph />, disabled: true, caption: "Coming soon" },
  { id: "workflow", label: "Workflow", icon: <WorkflowGlyph />, disabled: true, caption: "Coming soon" },
  { id: "artifacts", label: "Artifacts", icon: <ArtifactsGlyph /> },
  { id: "settings", label: "Settings", icon: <SettingsGlyph /> }
];

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
  const resolvedTheme = theme === "dark" || theme === "light" || theme === "auto" ? theme : "auto";
  const themeLabel = resolvedTheme === "dark" ? "Dark" : resolvedTheme === "light" ? "Light" : "Auto";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "var(--ah-bg-primary)",
        color: "var(--ah-text-primary)"
      }}
    >
      <a className="ah-skip-link" href="#agenthub-workbench-main">
        Skip to workbench
      </a>

      <header
        style={{
          height: "var(--ah-app-header-height)",
          minHeight: "var(--ah-app-header-height)",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
          alignItems: "center",
          gap: "var(--ah-space-4)",
          padding: "0 var(--ah-space-4)",
          borderBottom: "1px solid var(--ah-border)",
          background: "var(--ah-bg-elevated)",
          color: "var(--ah-text-primary)",
          flexShrink: 0
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-3)", minWidth: 0 }}>
          <div
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--ah-radius-lg)",
              background: "linear-gradient(135deg, var(--ah-accent) 0%, var(--ah-accent-hover) 100%)",
              color: "var(--ah-text-inverse)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "var(--ah-shadow-sm)",
              flexShrink: 0
            }}
          >
            <WorkbenchMarkIcon />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--ah-font-heading)",
                fontSize: "var(--ah-font-size-lg)",
                fontWeight: 700,
                lineHeight: "var(--ah-line-height-tight)",
                color: "var(--ah-text-primary)"
              }}
            >
              AgentHub
            </div>
            <div
              style={{
                fontSize: "var(--ah-font-size-xs)",
                color: "var(--ah-text-muted)",
                letterSpacing: "var(--ah-letter-spacing-wide)",
                textTransform: "uppercase"
              }}
            >
              Dual-theme workbench
            </div>
          </div>
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
            fontWeight: 600,
            whiteSpace: "nowrap"
          }}
        >
          <span
            className={connectionStatus === "connecting" || connectionStatus === "reconnecting" ? "ah-pulse-dot" : undefined}
            aria-hidden="true"
            style={{
              width: "var(--ah-space-2)",
              height: "var(--ah-space-2)",
              borderRadius: "var(--ah-radius-full)",
              background: statusColor,
              flexShrink: 0
            }}
          />
          <span>{statusLabel}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--ah-space-2)" }}>
          <button
            type="button"
            onClick={onOpenCommandPalette}
            disabled={!onOpenCommandPalette}
            data-testid="layout-command-palette"
            aria-label="Open command palette"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--ah-space-2)",
              border: "1px solid var(--ah-border)",
              borderRadius: "var(--ah-radius-full)",
              background: "var(--ah-bg-primary)",
              color: "var(--ah-text-muted)",
              cursor: onOpenCommandPalette ? "pointer" : "default",
              fontSize: "var(--ah-font-size-sm)",
              fontWeight: 600,
              padding: "var(--ah-space-1) var(--ah-space-3)",
              boxShadow: "var(--ah-shadow-sm)"
            }}
          >
            <CommandGlyph />
            <span>Command</span>
            <kbd
              style={{
                fontFamily: "var(--ah-font-mono)",
                fontSize: "var(--ah-font-size-xs)",
                fontWeight: 700,
                borderRadius: "var(--ah-radius-sm)",
                border: "1px solid var(--ah-border)",
                background: "var(--ah-bg-secondary)",
                color: "var(--ah-text-secondary)",
                padding: "2px var(--ah-space-2)"
              }}
            >
              ⌘K
            </kbd>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            disabled={!onToggleTheme}
            data-testid="layout-theme-toggle"
            aria-label={`Toggle theme. Current mode: ${themeLabel}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--ah-space-2)",
              border: "1px solid var(--ah-border)",
              borderRadius: "var(--ah-radius-full)",
              background: "var(--ah-bg-primary)",
              color: "var(--ah-text-secondary)",
              cursor: onToggleTheme ? "pointer" : "default",
              fontSize: "var(--ah-font-size-sm)",
              fontWeight: 600,
              padding: "var(--ah-space-1) var(--ah-space-3)",
              boxShadow: "var(--ah-shadow-sm)"
            }}
          >
            {resolvedTheme === "dark" ? <SunGlyph /> : resolvedTheme === "light" ? <MoonGlyph /> : <AutoGlyph />}
            <span>{themeLabel}</span>
          </button>
        </div>
      </header>

      <main
        id="agenthub-workbench-main"
        style={{
          display: "grid",
          gridTemplateColumns: `${leftCollapsed ? "var(--ah-sidebar-left-collapsed)" : "var(--ah-col-rooms-width)"} var(--ah-col-rail-expanded) minmax(0, 1fr) ${rightCollapsed ? "var(--ah-sidebar-right-collapsed)" : "var(--ah-col-right-width)"}`,
          minWidth: 0,
          minHeight: 0,
          flex: 1,
          overflow: "hidden",
          borderTop: "1px solid var(--ah-border-light)"
        }}
      >
        <aside
          aria-label="Rooms and groups"
          className="ah-workbench-panel"
          style={{
            minWidth: 0,
            borderLeft: "none",
            borderRight: "1px solid var(--ah-border)",
            background: "var(--ah-bg-elevated)",
            width: leftCollapsed ? "var(--ah-sidebar-left-collapsed)" : "var(--ah-col-rooms-width)"
          }}
        >
          <div className="ah-workbench-panel-header" style={{ justifyContent: "space-between" }}>
            <span style={{ display: leftCollapsed ? "none" : "inline-flex", alignItems: "center", gap: "var(--ah-space-2)" }}>
              <RoomsGlyph />
              Rooms &amp; groups
            </span>
            <button
              type="button"
              onClick={onToggleLeft}
              data-testid="layout-toggle-left"
              aria-label={leftCollapsed ? "Expand rooms column" : "Collapse rooms column"}
              title={leftCollapsed ? "Expand rooms column" : "Collapse rooms column"}
              style={{
                width: 28,
                height: 28,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--ah-border)",
                borderRadius: "var(--ah-radius-full)",
                background: "var(--ah-bg-primary)",
                color: "var(--ah-text-secondary)",
                cursor: "pointer",
                flexShrink: 0
              }}
            >
              <ChevronGlyph direction={leftCollapsed ? "right" : "left"} />
            </button>
          </div>

          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }} aria-hidden={leftCollapsed}>
            {leftCollapsed ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--ah-space-2)", padding: "var(--ah-space-3) var(--ah-space-2)", color: "var(--ah-text-muted)" }}>
                <RoomsGlyph />
              </div>
            ) : (
              leftPanel
            )}
          </div>
        </aside>

        <nav
          aria-label="Feature rail"
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
            background: "var(--ah-bg-primary)",
            borderRight: "1px solid var(--ah-border)"
          }}
        >
          <div className="ah-workbench-panel-header" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--ah-space-2)" }}>
              <RailGlyph />
              Feature rail
            </span>
            <span
              style={{
                fontSize: "var(--ah-font-size-xs)",
                color: "var(--ah-text-muted)",
                letterSpacing: "var(--ah-letter-spacing-wide)",
                textTransform: "uppercase"
              }}
            >
              Preview
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--ah-space-1)", padding: "var(--ah-space-2)", minHeight: 0, overflow: "auto" }}>
            {FEATURE_RAIL_ITEMS.map((item) => (
              <div
                key={item.id}
                className={`ah-rail-item ${item.active ? "ah-rail-item--active" : ""} ${item.disabled ? "ah-rail-item--disabled" : ""}`.trim()}
                data-testid={`layout-rail-${item.id}`}
                aria-current={item.active ? "page" : undefined}
                aria-disabled={item.disabled ? true : undefined}
                style={{ cursor: item.disabled ? "not-allowed" : "default" }}
              >
                <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0 }}>
                  {item.icon}
                </span>
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
                  {item.caption ? (
                    <span style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.caption}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </nav>

        <section
          aria-label="Center chat canvas"
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            background: "var(--ah-bg-primary)",
            overflow: "hidden"
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--ah-space-4)",
              padding: "var(--ah-space-3) var(--ah-space-4)",
              borderBottom: "1px solid var(--ah-border)",
              background: "linear-gradient(180deg, var(--ah-bg-elevated) 0%, var(--ah-bg-primary) 100%)",
              flexShrink: 0
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--ah-font-heading)", fontSize: "var(--ah-font-size-sm)", fontWeight: 700, color: "var(--ah-text-primary)" }}>
                Chat canvas
              </div>
              <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", textTransform: "uppercase", letterSpacing: "var(--ah-letter-spacing-wide)" }}>
                Main conversation workspace
              </div>
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--ah-space-2)",
                padding: "var(--ah-space-1) var(--ah-space-3)",
                borderRadius: "var(--ah-radius-full)",
                border: "1px solid var(--ah-border)",
                background: "var(--ah-bg-elevated)",
                color: "var(--ah-text-muted)",
                fontSize: "var(--ah-font-size-xs)",
                fontWeight: 600
              }}
            >
              <ActiveFeatureGlyph />
              Live canvas
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>{centerPanel}</div>
        </section>

        <aside
          aria-label="Workbench"
          className="ah-workbench-panel"
          style={{
            minWidth: 0,
            borderRight: "none",
            width: rightCollapsed ? "var(--ah-sidebar-right-collapsed)" : "var(--ah-col-right-width)",
            background: "var(--ah-bg-elevated)",
            overflow: "hidden"
          }}
        >
          <div className="ah-workbench-panel-header" style={{ justifyContent: "space-between" }}>
            <span style={{ display: rightCollapsed ? "none" : "inline-flex", alignItems: "center", gap: "var(--ah-space-2)" }}>
              <WorkbenchGlyph />
              Workbench
            </span>
            <button
              type="button"
              onClick={onToggleRight}
              data-testid="layout-toggle-right"
              aria-label={rightCollapsed ? "Expand workbench column" : "Collapse workbench column"}
              title={rightCollapsed ? "Expand workbench column" : "Collapse workbench column"}
              style={{
                width: 28,
                height: 28,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--ah-border)",
                borderRadius: "var(--ah-radius-full)",
                background: "var(--ah-bg-primary)",
                color: "var(--ah-text-secondary)",
                cursor: "pointer",
                flexShrink: 0
              }}
            >
              <ChevronGlyph direction={rightCollapsed ? "left" : "right"} />
            </button>
          </div>

          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }} aria-hidden={rightCollapsed}>
            {rightCollapsed ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--ah-space-2)", padding: "var(--ah-space-3) var(--ah-space-2)", color: "var(--ah-text-muted)" }}>
                <WorkbenchGlyph />
              </div>
            ) : (
              rightPanel
            )}
          </div>
        </aside>
      </main>

      {overlay ? (
        <div
          className="ah-slide-over-enter"
          style={{
            position: "fixed",
            top: "var(--ah-app-header-height)",
            right: 0,
            width: "min(720px, 60vw)",
            height: "calc(100% - var(--ah-app-header-height))",
            background: "var(--ah-bg-primary)",
            borderLeft: "1px solid var(--ah-border)",
            boxShadow: "var(--ah-shadow-overlay)",
            zIndex: "var(--ah-z-overlay)",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden"
          }}
        >
          {overlay}
        </div>
      ) : null}
    </div>
  );
}

function WorkbenchMarkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5 19 8v8l-7 4.5-7-4.5V8z" />
      <path d="M9 9.25h6l-1.4 4.1H15l-4.2 5.15 1.4-4.15H9z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CommandGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 8.5a2.5 2.5 0 1 1 0 5H6.5A2.5 2.5 0 1 1 6.5 8.5H8Z" />
      <path d="M16 8.5a2.5 2.5 0 1 1 0 5h-1.5A2.5 2.5 0 1 1 14.5 8.5H16Z" />
      <path d="M8 11.5h8" />
      <path d="M8 14.5v1.5a2.5 2.5 0 1 1-2.5-2.5" />
      <path d="M16 14.5v1.5a2.5 2.5 0 1 0 2.5-2.5" />
    </svg>
  );
}

function SunGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v3" />
      <path d="M12 18.5v3" />
      <path d="M2.5 12h3" />
      <path d="M18.5 12h3" />
      <path d="m4.9 4.9 2.1 2.1" />
      <path d="m17 17 2.1 2.1" />
      <path d="m19.1 4.9-2.1 2.1" />
      <path d="m7 17-2.1 2.1" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 14.75A7 7 0 0 1 9.25 7.5c0-.9.14-1.77.4-2.57a7.5 7.5 0 1 0 9.42 9.42c-.8.26-1.67.4-2.57.4Z" />
    </svg>
  );
}

function AutoGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4.5v3" />
      <path d="M12 16.5v3" />
      <path d="M4.5 12h3" />
      <path d="M16.5 12h3" />
      <path d="M7.2 7.2 9.3 9.3" />
      <path d="M14.7 14.7 16.8 16.8" />
      <path d="M16.8 7.2 14.7 9.3" />
      <path d="M9.3 14.7 7.2 16.8" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function ChevronGlyph({ direction }: { readonly direction: "left" | "right" }) {
  const d = direction === "left" ? "M14 6 8 12l6 6" : "M10 6l6 6-6 6";
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function RoomsGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 7.5h7.5v5H4.5z" />
      <path d="M12 7.5h7.5v5H12z" />
      <path d="M4.5 14.5H12v2H4.5z" />
      <path d="M12 14.5h7.5v2H12z" />
    </svg>
  );
}

function RailGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 6h14" />
      <path d="M5 12h14" />
      <path d="M5 18h14" />
      <path d="M8 6v12" />
    </svg>
  );
}

function ActiveFeatureGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7.5h10v8H11l-4 3v-3H7z" />
    </svg>
  );
}

function WorkbenchGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 7h12" />
      <path d="M8 7v11" />
      <path d="M16 7v11" />
      <path d="M6 18h12" />
      <path d="M10 11h4" />
    </svg>
  );
}

function ChatGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 6.5h13v8h-6l-4 3v-3h-3z" />
    </svg>
  );
}

function RunsGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6.5v11l9-5.5z" />
    </svg>
  );
}

function ContextGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 5.5h12v13H6z" />
      <path d="M9 9h6" />
      <path d="M9 12h6" />
      <path d="M9 15h4" />
    </svg>
  );
}

function TasksGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7.5h11" />
      <path d="M7 12h11" />
      <path d="M7 16.5h11" />
      <path d="M4.5 7.5 5.5 8.5 7 6.9" />
      <path d="M4.5 12 5.5 13 7 11.4" />
      <path d="M4.5 16.5 5.5 17.5 7 15.9" />
    </svg>
  );
}

function KanbanGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="6" width="14" height="12" rx="2" />
      <path d="M9 6v12" />
      <path d="M15 6v12" />
    </svg>
  );
}

function WorkflowGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="12" cy="17" r="2" />
      <path d="M8 7h8" />
      <path d="M12 9v6" />
      <path d="M7.5 8.5 10.8 14" />
      <path d="M16.5 8.5 13.2 14" />
    </svg>
  );
}

function ArtifactsGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7.5 12 5l5 2.5v8L12 18l-5-2.5z" />
      <path d="M12 5v13" />
      <path d="M7 7.5l5 2.5 5-2.5" />
    </svg>
  );
}

function SettingsGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 4.5v2" />
      <path d="M12 17.5v2" />
      <path d="M4.5 12h2" />
      <path d="M17.5 12h2" />
      <path d="M6.8 6.8 8.2 8.2" />
      <path d="M15.8 15.8 17.2 17.2" />
      <path d="M17.2 6.8 15.8 8.2" />
      <path d="M8.2 15.8 6.8 17.2" />
    </svg>
  );
}

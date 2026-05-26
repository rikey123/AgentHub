import type { ReactNode } from "react";

interface AppShellProps {
  topBar: ReactNode;
  rail: ReactNode;
  rooms: ReactNode;
  center: ReactNode;
  panel?: ReactNode | undefined;
  panelCollapsed?: boolean | undefined;
  roomsCollapsed?: boolean | undefined;
}

export function AppShell({ topBar, rail, rooms, center, panel, panelCollapsed, roomsCollapsed }: AppShellProps) {
  const cols = [
    "56px",
    roomsCollapsed ? "0px" : "260px",
    "1fr",
    panelCollapsed || !panel ? "0px" : "360px"
  ].join(" ");

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center border-b border-border bg-surface">
        {topBar}
      </header>
      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: cols, transition: "grid-template-columns 200ms ease" }}
      >
        <aside className="border-r border-border bg-surface overflow-hidden">{rail}</aside>
        <aside className="border-r border-border bg-surface overflow-hidden">
          <div className={roomsCollapsed ? "hidden" : "h-full"}>{rooms}</div>
        </aside>
        <main id="agenthub-workbench-main" className="min-w-0 overflow-hidden">{center}</main>
        <aside className="border-l border-border bg-surface overflow-hidden">
          <div className={panelCollapsed || !panel ? "hidden" : "h-full"}>{panel}</div>
        </aside>
      </div>
    </div>
  );
}

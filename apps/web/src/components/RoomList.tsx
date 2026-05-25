import type { RoomViewModel } from "../types.ts";

const ACTIVE_RUN_STATUSES = new Set(["running", "queued", "starting", "claimed"]);

function truncateSummary(summary: string): string {
  return summary.length > 60 ? `${summary.slice(0, 60)}...` : summary;
}

type RoomListProps = {
  readonly rooms: RoomViewModel[];
  readonly activeRoomId?: string | undefined;
  readonly onSelectRoom: (roomId: string) => void;
  readonly onCreateRoom: () => void;
};

export function RoomList({ rooms, activeRoomId, onSelectRoom, onCreateRoom }: RoomListProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "var(--ah-space-3)" }}>
        <button
          onClick={onCreateRoom}
          style={{
            width: "100%",
            padding: "var(--ah-space-2) var(--ah-space-3)",
            borderRadius: "var(--ah-radius-md)",
            border: "1px solid var(--ah-border-strong)",
            background: "var(--ah-bg-primary)",
            cursor: "pointer",
            fontSize: "var(--ah-font-size-md)",
            fontWeight: 500,
            color: "var(--ah-text-secondary)"
          }}
        >
          + New Room
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {rooms.length === 0 && (
          <div style={{ padding: "var(--ah-space-4)", fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)", textAlign: "center" }}>No rooms yet</div>
        )}
        {rooms.map((room) => {
          const hasActiveRun = room.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
          const latestBrief = room.briefs[room.briefs.length - 1];
          const secondaryText = latestBrief ? truncateSummary(latestBrief.summary) : room.mode;
          const pendingTurnCount = room.pendingTurns.length;

          return (
            <div
              key={room.id}
              onClick={() => onSelectRoom(room.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                if (e.key === "Enter" || e.key === " ") onSelectRoom(room.id);
              }}
              style={{
                padding: "var(--ah-space-3)",
                cursor: "pointer",
                borderBottom: "1px solid var(--ah-border-light)",
                background: room.id === activeRoomId ? "var(--ah-accent-light)" : "transparent",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "var(--ah-space-2)",
                borderRadius: "var(--ah-radius-sm)",
                margin: "0 var(--ah-space-2)",
                transition: "background var(--ah-transition-fast)"
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--ah-space-2)", minWidth: 0, flex: 1 }}>
                {hasActiveRun && (
                  <span
                    className="ah-pulse-dot"
                    style={{
                      width: "var(--ah-space-2)",
                      height: "var(--ah-space-2)",
                      background: "var(--ah-success)",
                      borderRadius: "var(--ah-radius-full)",
                      flexShrink: 0,
                      marginTop: "var(--ah-space-1)"
                    }}
                    aria-label="Active run"
                    title="Active run"
                  />
                )}
                <div style={{ overflow: "hidden", minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "var(--ah-font-size-md)",
                      fontWeight: 500,
                      color: "var(--ah-text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {room.title}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--ah-font-size-xs)",
                      color: "var(--ah-text-muted)",
                      marginTop: "var(--ah-space-1)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {secondaryText}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-1)", flexShrink: 0 }}>
                {room.unreadCount > 0 && (
                  <span
                    style={{
                      background: "var(--ah-danger)",
                      color: "var(--ah-text-inverse)",
                      fontSize: "var(--ah-font-size-xs)",
                      fontWeight: 600,
                      padding: "2px var(--ah-space-2)",
                      borderRadius: "var(--ah-radius-full)",
                      minWidth: "var(--ah-space-5)",
                      textAlign: "center"
                    }}
                    aria-label={`${room.unreadCount} unread messages`}
                  >
                    {room.unreadCount}
                  </span>
                )}
                {pendingTurnCount > 0 && (
                  <span
                    style={{
                      background: "var(--ah-warning)",
                      color: "var(--ah-text-inverse)",
                      fontSize: "var(--ah-font-size-xs)",
                      fontWeight: 600,
                      padding: "2px var(--ah-space-2)",
                      borderRadius: "var(--ah-radius-full)",
                      minWidth: "var(--ah-space-5)",
                      textAlign: "center"
                    }}
                    aria-label={`${pendingTurnCount} pending turns`}
                  >
                    {pendingTurnCount}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

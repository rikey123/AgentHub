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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--ah-bg-elevated)" }}>
      <div
        style={{
          padding: "var(--ah-space-4)",
          borderBottom: "1px solid var(--ah-border)",
          background: "linear-gradient(180deg, var(--ah-bg-elevated), var(--ah-bg-primary))"
        }}
      >
        <button
          onClick={onCreateRoom}
          data-testid="room-list-create-room"
          style={{
            width: "100%",
            padding: "var(--ah-space-3) var(--ah-space-4)",
            borderRadius: "var(--ah-radius-lg)",
            border: "1px solid var(--ah-accent)",
            background: "var(--ah-accent)",
            boxShadow: "var(--ah-shadow-sm)",
            cursor: "pointer",
            fontSize: "var(--ah-font-size-sm)",
            fontWeight: 700,
            color: "var(--ah-text-inverse)"
          }}
        >
          New room
        </button>
        <div style={{ marginTop: "var(--ah-space-3)", fontSize: "var(--ah-font-size-xs)", fontWeight: 700, letterSpacing: "var(--ah-letter-spacing-wide)", textTransform: "uppercase", color: "var(--ah-text-muted)" }}>
          Collaboration rooms
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "var(--ah-space-2)" }}>
        {rooms.length === 0 && (
          <div style={{ padding: "var(--ah-space-4)", fontSize: "var(--ah-font-size-sm)", lineHeight: "var(--ah-line-height-normal)", color: "var(--ah-text-muted)", textAlign: "center" }}>
            No rooms yet. Create the first collaboration space to start a run.
          </div>
        )}
        {rooms.map((room) => {
          const hasActiveRun = room.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
          const latestBrief = room.briefs[room.briefs.length - 1];
          const secondaryText = latestBrief ? truncateSummary(latestBrief.summary) : room.mode;
          const pendingTurnCount = room.pendingTurns.length;

          return (
            <button
              key={room.id}
              onClick={() => onSelectRoom(room.id)}
              data-testid={`room-list-item-${room.id}`}
              aria-current={room.id === activeRoomId ? "true" : undefined}
              style={{
                width: "100%",
                padding: "var(--ah-space-3)",
                cursor: "pointer",
                border: "1px solid var(--ah-border)",
                background: room.id === activeRoomId ? "var(--ah-accent-light)" : "var(--ah-bg-primary)",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "var(--ah-space-2)",
                borderRadius: "var(--ah-radius-lg)",
                marginBottom: "var(--ah-space-2)",
                transition: "background var(--ah-transition-fast), border-color var(--ah-transition-fast), transform var(--ah-transition-fast)",
                boxShadow: "var(--ah-shadow-sm)",
                textAlign: "left"
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
                      fontSize: "var(--ah-font-size-sm)",
                      fontWeight: 700,
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
            </button>
          );
        })}
      </div>
    </div>
  );
}

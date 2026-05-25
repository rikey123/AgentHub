import type { RoomViewModel } from "../types.ts";

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
        {rooms.map((room) => (
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
              alignItems: "center",
              justifyContent: "space-between",
              borderRadius: "var(--ah-radius-sm)",
              margin: "0 var(--ah-space-2)",
              transition: "background var(--ah-transition-fast)"
            }}
          >
            <div style={{ overflow: "hidden" }}>
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
              <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: 2 }}>{room.mode}</div>
            </div>
            {room.unreadCount > 0 && (
              <span
                style={{
                  background: "var(--ah-danger)",
                  color: "var(--ah-text-inverse)",
                  fontSize: "var(--ah-font-size-xs)",
                  fontWeight: 600,
                  padding: "2px var(--ah-space-2)",
                  borderRadius: "var(--ah-radius-full)",
                  minWidth: 18,
                  textAlign: "center"
                }}
                aria-label={`${room.unreadCount} unread messages`}
              >
                {room.unreadCount}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

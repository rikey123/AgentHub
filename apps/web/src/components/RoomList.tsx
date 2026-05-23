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
      <div style={{ padding: 12 }}>
        <button
          onClick={onCreateRoom}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            background: "#ffffff",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            color: "#374151"
          }}
        >
          + New Room
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {rooms.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: "#9ca3af", textAlign: "center" }}>No rooms yet</div>
        )}
        {rooms.map((room) => (
          <div
            key={room.id}
            onClick={() => onSelectRoom(room.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelectRoom(room.id);
            }}
            style={{
              padding: "10px 12px",
              cursor: "pointer",
              borderBottom: "1px solid #f3f4f6",
              background: room.id === activeRoomId ? "#eff6ff" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <div style={{ overflow: "hidden" }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#111827",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {room.title}
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{room.mode}</div>
            </div>
            {room.unreadCount > 0 && (
              <span
                style={{
                  background: "#ef4444",
                  color: "#ffffff",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: 10,
                  minWidth: 18,
                  textAlign: "center"
                }}
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

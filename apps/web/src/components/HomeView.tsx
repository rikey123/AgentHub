import type { RoomViewModel } from "../types.ts";

type HomeViewProps = {
  readonly rooms: RoomViewModel[];
  readonly onSelectRoom: (roomId: string) => void;
  readonly onCreateRoom: () => void;
};

function truncateSummary(summary: string): string {
  return summary.length > 80 ? `${summary.slice(0, 80)}...` : summary;
}

function hasActiveRun(room: RoomViewModel): boolean {
  return room.runs.some((run) => run.status === "running" || run.status === "queued");
}

export function HomeView({ rooms, onSelectRoom, onCreateRoom }: HomeViewProps) {
  return (
    <div
      style={{
        minHeight: "100%",
        padding: "var(--ah-space-8)",
        background: "var(--ah-bg-primary)",
        color: "var(--ah-text-primary)",
        overflow: "auto"
      }}
    >
      <section
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--ah-space-6)",
          marginBottom: "var(--ah-space-8)"
        }}
      >
        <div>
          <div
            style={{
              fontSize: "var(--ah-font-size-xs)",
              fontWeight: 700,
              letterSpacing: "var(--ah-letter-spacing-wide)",
              textTransform: "uppercase",
              color: "var(--ah-accent)",
              marginBottom: "var(--ah-space-2)"
            }}
          >
            Local workbench
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--ah-font-size-xl)",
              lineHeight: "var(--ah-line-height-tight)",
              color: "var(--ah-text-primary)"
            }}
          >
            Welcome to AgentHub
          </h1>
          <p
            style={{
              margin: "var(--ah-space-2) 0 0",
              fontSize: "var(--ah-font-size-base)",
              lineHeight: "var(--ah-line-height-normal)",
              color: "var(--ah-text-muted)"
            }}
          >
            Your local multi-agent coding workbench
          </p>
        </div>
        <button
          onClick={onCreateRoom}
          style={{
            border: "1px solid var(--ah-accent)",
            borderRadius: "var(--ah-radius-lg)",
            background: "var(--ah-accent)",
            color: "var(--ah-text-inverse)",
            cursor: "pointer",
            fontSize: "var(--ah-font-size-base)",
            fontWeight: 700,
            padding: "var(--ah-space-3) var(--ah-space-5)",
            boxShadow: "var(--ah-shadow-sm)",
            transition: "background var(--ah-transition-fast), border-color var(--ah-transition-fast), transform var(--ah-transition-fast)"
          }}
        >
          + New Room
        </button>
      </section>

      {rooms.length > 0 ? (
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "var(--ah-space-4)"
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: "var(--ah-font-size-lg)",
                lineHeight: "var(--ah-line-height-tight)",
                color: "var(--ah-text-primary)"
              }}
            >
              Recent Rooms
            </h2>
            <span style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>{rooms.length} total</span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(var(--ah-home-card-min-width), 1fr))",
              gap: "var(--ah-space-4)"
            }}
          >
            {rooms.map((room) => (
              <RoomCard key={room.id} room={room} onSelectRoom={onSelectRoom} />
            ))}
          </div>
        </section>
      ) : (
        <section
          style={{
            border: "1px dashed var(--ah-border-strong)",
            borderRadius: "var(--ah-radius-xl)",
            background: "var(--ah-bg-elevated)",
            padding: "var(--ah-space-8)",
            textAlign: "center",
            boxShadow: "var(--ah-shadow-sm)"
          }}
        >
          <div style={{ fontSize: "var(--ah-font-size-xl)", marginBottom: "var(--ah-space-3)" }}>⚡</div>
          <h2
            style={{
              margin: 0,
              fontSize: "var(--ah-font-size-lg)",
              lineHeight: "var(--ah-line-height-tight)",
              color: "var(--ah-text-primary)"
            }}
          >
            Create your first room to get started
          </h2>
          <p
            style={{
              margin: "var(--ah-space-2) auto var(--ah-space-5)",
              maxWidth: "var(--ah-home-empty-max-width)",
              fontSize: "var(--ah-font-size-base)",
              lineHeight: "var(--ah-line-height-normal)",
              color: "var(--ah-text-muted)"
            }}
          >
            Start a solo room for a focused agent run, then expand into assisted collaboration when the work needs more hands.
          </p>
          <button
            onClick={onCreateRoom}
            style={{
              border: "1px solid var(--ah-accent)",
              borderRadius: "var(--ah-radius-lg)",
              background: "var(--ah-accent)",
              color: "var(--ah-text-inverse)",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-base)",
              fontWeight: 700,
              padding: "var(--ah-space-3) var(--ah-space-6)",
              boxShadow: "var(--ah-shadow-sm)"
            }}
          >
            New Room
          </button>
        </section>
      )}
    </div>
  );
}

function RoomCard({ room, onSelectRoom }: { readonly room: RoomViewModel; readonly onSelectRoom: (roomId: string) => void }) {
  const lastBrief = room.briefs[room.briefs.length - 1];
  const active = hasActiveRun(room);

  return (
    <button
      onClick={() => onSelectRoom(room.id)}
      style={{
        width: "100%",
        minHeight: "var(--ah-home-card-min-height)",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "var(--ah-space-3)",
        textAlign: "left",
        border: "1px solid var(--ah-border)",
        borderRadius: "var(--ah-radius-xl)",
        background: "var(--ah-bg-elevated)",
        color: "var(--ah-text-primary)",
        cursor: "pointer",
        padding: "var(--ah-space-4)",
        boxShadow: "var(--ah-shadow-sm)",
        transition: "border-color var(--ah-transition-fast), box-shadow var(--ah-transition-fast), transform var(--ah-transition-fast)"
      }}
    >
      <span style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--ah-space-3)" }}>
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: "var(--ah-font-size-base)",
              fontWeight: 700,
              color: "var(--ah-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {room.title}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)", marginTop: "var(--ah-space-2)" }}>
            {active && (
              <span
                className="ah-pulse-dot"
                style={{
                  width: "var(--ah-space-2)",
                  height: "var(--ah-space-2)",
                  borderRadius: "var(--ah-radius-full)",
                  background: "var(--ah-success)"
                }}
                aria-label="Active run"
              />
            )}
            <span
              style={{
                borderRadius: "var(--ah-radius-full)",
                border: "1px solid var(--ah-border)",
                background: "var(--ah-bg-primary)",
                color: "var(--ah-text-secondary)",
                fontSize: "var(--ah-font-size-xs)",
                fontWeight: 700,
                padding: "var(--ah-space-1) var(--ah-space-2)",
                textTransform: "uppercase"
              }}
            >
              {room.mode}
            </span>
          </span>
        </span>
        {room.unreadCount > 0 && (
          <span
            style={{
              background: "var(--ah-danger)",
              color: "var(--ah-text-inverse)",
              fontSize: "var(--ah-font-size-xs)",
              fontWeight: 700,
              padding: "var(--ah-space-1) var(--ah-space-2)",
              borderRadius: "var(--ah-radius-full)",
              minWidth: "var(--ah-space-6)",
              textAlign: "center"
            }}
            aria-label={`${room.unreadCount} unread messages`}
          >
            {room.unreadCount}
          </span>
        )}
      </span>

      <span style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>{room.participants.length} agents</span>

      <span
        style={{
          flex: 1,
          display: "block",
          fontSize: "var(--ah-font-size-sm)",
          lineHeight: "var(--ah-line-height-normal)",
          color: lastBrief ? "var(--ah-text-secondary)" : "var(--ah-text-muted)"
        }}
      >
        {lastBrief ? truncateSummary(lastBrief.summary) : "No briefs yet. Open the room to start the first run."}
      </span>
    </button>
  );
}

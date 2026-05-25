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
  const sortedRooms = [...rooms].sort((a, b) => getRoomActivityScore(b) - getRoomActivityScore(a));
  const activeRooms = sortedRooms.filter((room) => hasActiveRun(room));
  const unreadRooms = sortedRooms.filter((room) => room.unreadCount > 0);
  const pendingRooms = sortedRooms.filter((room) => room.pendingTurns.length > 0);

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
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)",
          gap: "var(--ah-space-6)",
          alignItems: "start",
          marginBottom: "var(--ah-space-8)"
        }}
      >
        <div
          style={{
            border: "1px solid var(--ah-border)",
            borderRadius: "var(--ah-radius-xl)",
            background: "linear-gradient(180deg, var(--ah-bg-elevated), var(--ah-bg-secondary))",
            padding: "var(--ah-space-6)",
            boxShadow: "var(--ah-shadow-sm)"
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--ah-space-2)",
              borderRadius: "var(--ah-radius-full)",
              border: "1px solid var(--ah-border)",
              background: "var(--ah-bg-primary)",
              color: "var(--ah-text-muted)",
              fontSize: "var(--ah-font-size-xs)",
              fontWeight: 700,
              letterSpacing: "var(--ah-letter-spacing-wide)",
              textTransform: "uppercase",
              padding: "var(--ah-space-1) var(--ah-space-3)",
              marginBottom: "var(--ah-space-4)"
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
            Workbench dashboard
          </h1>
          <p
            style={{
              margin: "var(--ah-space-3) 0 0",
              maxWidth: "var(--ah-home-empty-max-width)",
              fontSize: "var(--ah-font-size-base)",
              lineHeight: "var(--ah-line-height-normal)",
              color: "var(--ah-text-secondary)"
            }}
          >
            Start a new room for focused agent work, or jump back into an active collaboration with unread updates, pending turns, and recent run briefs already surfaced.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--ah-space-2)", marginTop: "var(--ah-space-5)" }}>
            <DashboardStat label="Rooms" value={rooms.length.toString()} />
            <DashboardStat label="Active" value={activeRooms.length.toString()} tone="success" />
            <DashboardStat label="Unread" value={unreadRooms.length.toString()} tone="danger" />
            <DashboardStat label="Pending" value={pendingRooms.length.toString()} tone="warning" />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--ah-space-3)", marginTop: "var(--ah-space-6)" }}>
            <button
              onClick={onCreateRoom}
              data-testid="home-create-room"
              style={{
                border: "1px solid var(--ah-accent)",
                borderRadius: "var(--ah-radius-lg)",
                background: "var(--ah-accent)",
                color: "var(--ah-text-inverse)",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-base)",
                fontWeight: 700,
                padding: "var(--ah-space-3) var(--ah-space-5)",
                boxShadow: "var(--ah-shadow-sm)"
              }}
            >
              New Room
            </button>
            <button
              type="button"
              onClick={() => sortedRooms[0] && onSelectRoom(sortedRooms[0].id)}
              disabled={sortedRooms.length === 0}
              style={{
                border: "1px solid var(--ah-border-strong)",
                borderRadius: "var(--ah-radius-lg)",
                background: "var(--ah-bg-primary)",
                color: "var(--ah-text-secondary)",
                cursor: sortedRooms.length > 0 ? "pointer" : "default",
                fontSize: "var(--ah-font-size-base)",
                fontWeight: 700,
                padding: "var(--ah-space-3) var(--ah-space-5)",
                boxShadow: "var(--ah-shadow-sm)"
              }}
            >
              Open Latest Room
            </button>
          </div>
        </div>

        <div
          style={{
            border: "1px solid var(--ah-border)",
            borderRadius: "var(--ah-radius-xl)",
            background: "var(--ah-bg-elevated)",
            padding: "var(--ah-space-5)",
            boxShadow: "var(--ah-shadow-sm)"
          }}
        >
          <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 700, letterSpacing: "var(--ah-letter-spacing-wide)", textTransform: "uppercase", color: "var(--ah-text-muted)" }}>
            Today’s focus
          </div>
          <div style={{ display: "grid", gap: "var(--ah-space-3)", marginTop: "var(--ah-space-4)" }}>
            <WorkbenchCue title="Open a room" description="Resume a conversation, review briefs, or continue a queued turn from the room list." />
            <WorkbenchCue title="Start a new run" description="Create a room when you need a fresh collaborative workspace with its own history." />
            <WorkbenchCue title="Watch for activity" description="Unread messages, active runs, and pending turns are surfaced without opening the room." />
          </div>
        </div>
      </section>

      {sortedRooms.length > 0 ? (
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
              Recent rooms
            </h2>
            <span style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>{sortedRooms.length} total</span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, var(--ah-home-card-min-width)), 1fr))",
              gap: "var(--ah-space-4)"
            }}
          >
            {sortedRooms.map((room) => (
              <RoomCard key={room.id} room={room} onSelectRoom={onSelectRoom} />
            ))}
          </div>
        </section>
      ) : (
        <section
          style={{
            border: "1px solid var(--ah-border)",
            borderRadius: "var(--ah-radius-xl)",
            background: "var(--ah-bg-elevated)",
            padding: "var(--ah-space-8)",
            textAlign: "center",
            boxShadow: "var(--ah-shadow-sm)"
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "var(--ah-radius-full)",
              margin: "0 auto var(--ah-space-4)",
              background: "var(--ah-accent-light)",
              color: "var(--ah-accent-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--ah-font-size-xl)",
              fontWeight: 700
            }}
          >
            AH
          </div>
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
              color: "var(--ah-text-secondary)"
            }}
          >
            Start a solo room for a focused agent run, then expand into assisted collaboration when the work needs more hands.
          </p>
          <button
            onClick={onCreateRoom}
            data-testid="home-create-room-empty"
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

function getRoomActivityScore(room: RoomViewModel): number {
  const latestBriefTime = room.briefs.length;
  const latestRunTime = room.runs.length;
  const unreadBoost = room.unreadCount > 0 ? 1_000_000 : 0;
  const activeBoost = hasActiveRun(room) ? 500_000 : 0;
  const pendingBoost = room.pendingTurns.length > 0 ? 250_000 : 0;
  return unreadBoost + activeBoost + pendingBoost + latestBriefTime * 1_000 + latestRunTime;
}

function DashboardStat({ label, value, tone = "default" }: { readonly label: string; readonly value: string; readonly tone?: "default" | "success" | "danger" | "warning" }) {
  const tones: Record<typeof tone, { readonly background: string; readonly color: string }> = {
    default: { background: "var(--ah-bg-secondary)", color: "var(--ah-text-primary)" },
    success: { background: "var(--ah-success-light)", color: "var(--ah-text-success)" },
    danger: { background: "var(--ah-danger-light)", color: "var(--ah-text-danger)" },
    warning: { background: "var(--ah-warning-light)", color: "var(--ah-text-warning)" }
  };

  const resolved = tones[tone];

  return (
    <div
      style={{
        minWidth: 92,
        borderRadius: "var(--ah-radius-lg)",
        border: "1px solid var(--ah-border)",
        background: resolved.background,
        padding: "var(--ah-space-3) var(--ah-space-4)"
      }}
    >
      <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", textTransform: "uppercase", letterSpacing: "var(--ah-letter-spacing-wide)", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ marginTop: "var(--ah-space-1)", fontSize: "var(--ah-font-size-lg)", fontWeight: 700, color: resolved.color }}>
        {value}
      </div>
    </div>
  );
}

function WorkbenchCue({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <div
      style={{
        borderRadius: "var(--ah-radius-lg)",
        border: "1px solid var(--ah-border)",
        background: "var(--ah-bg-primary)",
        padding: "var(--ah-space-4)"
      }}
    >
      <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 700, color: "var(--ah-text-primary)" }}>{title}</div>
      <div style={{ marginTop: "var(--ah-space-1)", fontSize: "var(--ah-font-size-sm)", lineHeight: "var(--ah-line-height-normal)", color: "var(--ah-text-muted)" }}>
        {description}
      </div>
    </div>
  );
}

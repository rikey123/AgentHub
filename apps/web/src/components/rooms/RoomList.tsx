import { useMemo, useState } from "react";
import { Badge, Button, Chip, SearchField, ScrollShadow } from "@heroui/react";
import type { RoomViewModel } from "../../types.ts";

interface RoomListProps {
  rooms: ReadonlyArray<RoomViewModel>;
  activeRoomId?: string | undefined;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

function roomInitials(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "AH";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "AH";
}

function relativeRoomTime(room: RoomViewModel) {
  const latestMessage = room.messages.reduce<number | undefined>((latest, message) => {
    if (latest === undefined || message.createdAt > latest) return message.createdAt;
    return latest;
  }, undefined);
  if (latestMessage === undefined) return "No messages";
  const minutes = Math.max(0, Math.round((Date.now() - latestMessage) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function roomPreview(room: RoomViewModel) {
  const latest = room.messages[room.messages.length - 1];
  if (latest?.text.trim()) return latest.text.trim();
  if (room.pendingTurns.length > 0) return `${room.pendingTurns.length} queued turn${room.pendingTurns.length === 1 ? "" : "s"}`;
  if (room.runs.some((run) => run.status === "running" || run.status === "starting")) return "Agents are working";
  if (room.participants.length > 0) return `${room.participants.length} members ready`;
  return "Start the room conversation";
}

export function RoomList({ rooms, activeRoomId, onSelect, onCreate }: RoomListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rooms.filter((r) => r.title.toLowerCase().includes(q) || r.mode.toLowerCase().includes(q))
      : rooms.slice();
    return list.sort((a, b) => {
      if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      const ar = a.runs.some((r) => r.status === "running" || r.status === "starting");
      const br = b.runs.some((r) => r.status === "running" || r.status === "starting");
      if (ar !== br) return Number(br) - Number(ar);
      return b.pendingTurns.length - a.pendingTurns.length;
    });
  }, [rooms, query]);

  const liveCount = rooms.filter((room) => room.runs.some((run) => run.status === "running" || run.status === "starting")).length;
  const totalPending = rooms.reduce((sum, room) => sum + room.pendingTurns.length, 0);

  return (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,var(--surface),var(--surface-secondary))]">
      <div className="border-b border-border px-3 pb-3 pt-3">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Workspace</p>
            <h2 className="truncate text-lg font-semibold">Rooms</h2>
          </div>
          <Button size="sm" variant="primary" className="rounded-full px-4" onPress={onCreate} aria-label="New Room" data-testid="room-list-create-room">
            New
          </Button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-overlay/70 px-3 py-2 shadow-sm">
            <div className="text-base font-semibold">{rooms.length}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted">rooms</div>
          </div>
          <div className="rounded-xl border border-border bg-overlay/70 px-3 py-2 shadow-sm">
            <div className="text-base font-semibold">{liveCount}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted">live</div>
          </div>
        </div>

        <SearchField aria-label="Search rooms" value={query} onChange={setQuery}>
          <SearchField.Group className="rounded-xl border border-border bg-overlay shadow-sm">
            <SearchField.Input placeholder="Search room or mode" />
          </SearchField.Group>
        </SearchField>

        {totalPending > 0 ? (
          <div className="mt-3 rounded-xl border border-warning bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
            {totalPending} queued turn{totalPending === 1 ? "" : "s"} waiting across rooms.
          </div>
        ) : null}
      </div>

      <ScrollShadow className="flex-1 overflow-auto" orientation="vertical">
        <ul role="listbox" aria-label="Rooms" className="flex flex-col gap-2 p-2">
          {filtered.length === 0 ? (
            <li className="rounded-2xl border border-dashed border-border bg-overlay/60 px-4 py-8 text-center text-sm text-muted">
              {query ? "No rooms match your search." : "No rooms yet. Create one to start."}
            </li>
          ) : null}
          {filtered.map((room) => {
            const active = room.id === activeRoomId;
            const hasActiveRun = room.runs.some((r) => r.status === "running" || r.status === "starting");
            const preview = roomPreview(room);
            return (
              <li
                key={room.id}
                role="option"
                aria-selected={active}
                aria-current={active ? "true" : undefined}
                data-testid={`room-list-item-${room.id}`}
                onClick={() => onSelect(room.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(room.id);
                  }
                }}
                tabIndex={0}
                className={[
                  "group relative cursor-pointer rounded-2xl border px-3 py-3 text-sm shadow-sm transition-all",
                  active
                    ? "border-accent bg-accent-soft text-accent-soft-foreground shadow-[0_14px_30px_color-mix(in_oklab,var(--accent)_18%,transparent)]"
                    : "border-transparent bg-overlay/68 hover:border-border hover:bg-overlay hover:shadow-[var(--surface-shadow)]"
                ].join(" ")}
              >
                <div className="flex gap-3">
                  <div
                    className={[
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xs font-bold uppercase",
                      active ? "bg-accent text-accent-foreground" : "bg-surface-secondary text-muted"
                    ].join(" ")}
                  >
                    {roomInitials(room.title)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-semibold">{room.title}</span>
                      <span className="shrink-0 text-[11px] text-muted">{relativeRoomTime(room)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{preview}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-[52px]">
                  <Chip size="sm" variant="soft" color="default">{room.mode}</Chip>
                  <Chip size="sm" variant="soft" color="default">{room.participants.length} members</Chip>
                  {hasActiveRun ? (
                    <Chip size="sm" variant="soft" color="accent">live</Chip>
                  ) : null}
                  {room.pendingTurns.length > 0 ? (
                    <Chip size="sm" variant="soft" color="warning">{room.pendingTurns.length} queued</Chip>
                  ) : null}
                  {room.unreadCount > 0 ? (
                    <Badge color="danger" variant="primary">{String(room.unreadCount)}</Badge>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollShadow>
    </div>
  );
}

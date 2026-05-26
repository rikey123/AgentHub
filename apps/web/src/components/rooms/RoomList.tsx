import { useMemo, useState } from "react";
import { Badge, Button, Chip, SearchField, ScrollShadow } from "@heroui/react";
import type { RoomViewModel } from "../../types.ts";

interface RoomListProps {
  rooms: ReadonlyArray<RoomViewModel>;
  activeRoomId?: string | undefined;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function RoomList({ rooms, activeRoomId, onSelect, onCreate }: RoomListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rooms.filter((r) => r.title.toLowerCase().includes(q))
      : rooms.slice();
    return list.sort((a, b) => {
      if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      const ar = a.runs.some((r) => r.status === "running" || r.status === "starting");
      const br = b.runs.some((r) => r.status === "running" || r.status === "starting");
      if (ar !== br) return Number(br) - Number(ar);
      return b.pendingTurns.length - a.pendingTurns.length;
    });
  }, [rooms, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold">Rooms</h2>
        <Button size="sm" variant="primary" onPress={onCreate} aria-label="New Room">
          New
        </Button>
      </div>
      <div className="px-3 py-2 border-b border-border">
        <SearchField aria-label="Search rooms" value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.Input placeholder="Search rooms" />
          </SearchField.Group>
        </SearchField>
      </div>
      <ScrollShadow className="flex-1 overflow-auto" orientation="vertical">
        <ul role="listbox" aria-label="Rooms" className="flex flex-col py-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-muted">
              {query ? "No matches" : "No rooms yet"}
            </li>
          ) : null}
          {filtered.map((room) => {
            const active = room.id === activeRoomId;
            const hasActiveRun = room.runs.some((r) => r.status === "running" || r.status === "starting");
            return (
              <li
                key={room.id}
                role="option"
                aria-selected={active}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(room.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(room.id);
                  }
                }}
                tabIndex={0}
                className={[
                  "mx-2 my-0.5 cursor-pointer rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-accent-soft text-accent-soft-foreground" : "hover:bg-default"
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate font-medium">{room.title}</span>
                  {room.unreadCount > 0 ? (
                    <Badge color="danger" variant="primary">{String(room.unreadCount)}</Badge>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <Chip size="sm" variant="soft" color="default">{room.mode}</Chip>
                  {hasActiveRun ? (
                    <Chip size="sm" variant="soft" color="accent">live</Chip>
                  ) : null}
                  {room.pendingTurns.length > 0 ? (
                    <Chip size="sm" variant="soft" color="warning">{room.pendingTurns.length} queued</Chip>
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

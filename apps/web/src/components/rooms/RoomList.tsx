import { useMemo, useState } from "react";
import { Badge, Button, Chip, SearchField, ScrollShadow } from "@heroui/react";
import type { RoomViewModel } from "../../types.ts";
import { roomModeLabel } from "../../lib/format.ts";

interface RoomListProps {
  rooms: ReadonlyArray<RoomViewModel>;
  activeRoomId?: string | undefined;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onTogglePin?: ((id: string, isPinned: boolean) => void) | undefined;
}

function roomInitials(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "AH";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "AH";
}

function relativeRoomTime(room: RoomViewModel) {
  const latestActivity = latestRoomActivity(room);
  if (latestActivity === undefined) return "No messages";
  const minutes = Math.max(0, Math.round((Date.now() - latestActivity) / 60000));
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

export function orderedRoomsForList(rooms: ReadonlyArray<RoomViewModel>, query: string): RoomViewModel[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? rooms.filter((room) => roomSearchText(room).includes(q))
    : rooms.slice();
  return list.sort((a, b) => {
    const ap = a.pinnedAt !== undefined;
    const bp = b.pinnedAt !== undefined;
    if (ap !== bp) return Number(bp) - Number(ap);
    if (ap && bp && a.pinnedAt !== b.pinnedAt) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
    const activityDelta = (latestRoomActivity(b) ?? 0) - (latestRoomActivity(a) ?? 0);
    if (activityDelta !== 0) return activityDelta;
    return a.title.localeCompare(b.title);
  });
}

function latestRoomActivity(room: RoomViewModel): number | undefined {
  if (room.lastActivityAt !== undefined) return room.lastActivityAt;
  return room.messages.reduce<number | undefined>((latest, message) => {
    if (latest === undefined || message.createdAt > latest) return message.createdAt;
    return latest;
  }, undefined);
}

function roomSearchText(room: RoomViewModel): string {
  return [
    room.title,
    room.mode,
    ...Object.values(room.participantContactNames),
    ...room.participants.flatMap((participant) => [participant.name, participant.role, participant.presence]),
    ...room.messages.slice(-5).map((message) => message.text)
  ].join(" ").toLowerCase();
}

export function RoomList({ rooms, activeRoomId, onSelect, onCreate, onTogglePin }: RoomListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return orderedRoomsForList(rooms, query);
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
          <Button size="sm" variant="primary" className="rounded-full px-4" onPress={onCreate} aria-label="新建房间" data-testid="room-list-create-room">
            + 新建
          </Button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-overlay/70 px-3 py-2 shadow-sm">
            <div className="text-base font-semibold">{rooms.length}</div>
            <div className="text-[11px] tracking-wide text-muted">房间总数</div>
          </div>
          <div className="rounded-xl border border-border bg-overlay/70 px-3 py-2 shadow-sm">
            <div className="text-base font-semibold">{liveCount}</div>
            <div className="text-[11px] tracking-wide text-muted">在线房间</div>
          </div>
        </div>

        <SearchField aria-label="搜索房间" value={query} onChange={setQuery}>
          <SearchField.Group className="rounded-xl border border-border bg-overlay shadow-sm">
            <SearchField.Input placeholder="搜索房间 / 模式" className="placeholder:text-muted" />
          </SearchField.Group>
        </SearchField>

        {totalPending > 0 ? (
          <div className="mt-3 rounded-xl border border-warning bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
            {totalPending} queued turn{totalPending === 1 ? "" : "s"} waiting across rooms.
          </div>
        ) : null}
      </div>

      <ScrollShadow className="flex-1 overflow-auto" orientation="vertical">
        <ul aria-label="Rooms" className="flex flex-col gap-2 p-2">
          {filtered.length === 0 ? (
            <li className="rounded-2xl border border-dashed border-border bg-overlay/60 px-4 py-8 text-center text-sm text-muted">
              {query ? "没有查找到相应的房间。" : "No rooms yet. Create one to start."}
            </li>
          ) : null}
          {filtered.map((room) => {
            const active = room.id === activeRoomId;
            const hasActiveRun = room.runs.some((r) => r.status === "running" || r.status === "starting");
            const preview = roomPreview(room);
            const isPinned = room.pinnedAt !== undefined;
            return (
              <li
                key={room.id}
                data-testid={`room-list-item-${room.id}`}
                className={[
                  "group relative rounded-2xl border px-3 py-3 text-sm shadow-sm transition-all",
                  active
                    ? "border-accent bg-accent-soft text-accent-soft-foreground shadow-[0_14px_30px_color-mix(in_oklab,var(--accent)_18%,transparent)]"
                    : "border-transparent bg-overlay/68 hover:border-border hover:bg-overlay hover:shadow-[var(--surface-shadow)]"
                ].join(" ")}
              >
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  aria-label={`Open room ${room.title}`}
                  className="flex w-full gap-3 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  onClick={() => onSelect(room.id)}
                >
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
                </button>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-[52px]">
                  {onTogglePin ? (
                    <Button
                      size="sm"
                      variant={isPinned ? "secondary" : "ghost"}
                      className="h-7 px-2 text-xs"
                      aria-label={`${isPinned ? "Unpin" : "Pin"} room ${room.title}`}
                      data-testid={`room-list-${isPinned ? "unpin" : "pin"}-${room.id}`}
                      onPress={() => onTogglePin(room.id, isPinned)}
                    >
                      {isPinned ? "Unpin" : "Pin"}
                    </Button>
                  ) : null}
                  <Chip size="sm" variant="soft" color="default">{roomModeLabel(room.mode)}</Chip>
                  <Chip size="sm" variant="soft" color="default">{room.participants.length} 名成员</Chip>
                  {hasActiveRun ? (
                    <Chip size="sm" variant="soft" color="accent">在线</Chip>
                  ) : null}
                  {room.pendingTurns.length > 0 ? (
                    <Chip size="sm" variant="soft" color="warning">{room.pendingTurns.length} 待处理</Chip>
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

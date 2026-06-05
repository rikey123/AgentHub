import { Button, Card, Chip, ScrollShadow } from "@heroui/react";
import type { RoomViewModel } from "../../types.ts";
import { truncate, roomModeLabel } from "../../lib/format.ts";

interface HomeViewProps {
  rooms: ReadonlyArray<RoomViewModel>;
  onOpenRoom: (id: string) => void;
  onCreate: () => void;
}

export function HomeView({ rooms, onOpenRoom, onCreate }: HomeViewProps) {
  const total = rooms.length;
  const active = rooms.filter((r) => r.runs.some((run) => run.status === "running" || run.status === "starting")).length;
  const unread = rooms.reduce((acc, r) => acc + r.unreadCount, 0);
  const pending = rooms.reduce((acc, r) => acc + r.pendingTurns.length, 0);

  const sorted = rooms.slice().sort((a, b) => {
    if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
    const ar = a.runs.some((r) => r.status === "running" || r.status === "starting");
    const br = b.runs.some((r) => r.status === "running" || r.status === "starting");
    if (ar !== br) return Number(br) - Number(ar);
    return b.pendingTurns.length - a.pendingTurns.length;
  });

  return (
    <ScrollShadow className="h-full overflow-auto" orientation="vertical">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">AgentHub</h1>
            <p className="text-sm text-muted">Your local-first multi-agent workbench.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onPress={onCreate}>新建房间</Button>
            {sorted[0] ? (
              <Button variant="secondary" onPress={() => onOpenRoom(sorted[0]!.id)}>
                最近访问
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="房间总数" value={total} />
          <StatCard label="在线房间" value={active} accent />
          <StatCard label="未读" value={unread} />
          <StatCard label="待处理" value={pending} />
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Rooms</h2>
          {sorted.length === 0 ? (
            <Card variant="default" className="items-center text-center">
              <Card.Header>
                <Card.Title>还没有房间</Card.Title>
                <Card.Description>新建一个房间，开始与你的 agent 对话。</Card.Description>
              </Card.Header>
              <Card.Footer>
                <Button variant="primary" onPress={onCreate}>创建第一个房间</Button>
              </Card.Footer>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {sorted.map((room) => {
                const lastBrief = room.briefs[room.briefs.length - 1];
                const hasActive = room.runs.some((r) => r.status === "running" || r.status === "starting");
                return (
                  <Card
                    key={room.id}
                    variant="default"
                    className="cursor-pointer transition-colors hover:bg-surface-secondary"
                    onClick={() => onOpenRoom(room.id)}
                  >
                    <Card.Header>
                      <div className="flex items-start gap-2">
                        <Card.Title className="flex-1 truncate">{room.title}</Card.Title>
                        {hasActive ? <Chip size="sm" color="accent" variant="soft">在线</Chip> : null}
                      </div>
                      <Card.Description>
                        {lastBrief ? truncate(lastBrief.summary, 80) : "暂无活动。"}
                      </Card.Description>
                    </Card.Header>
                    <Card.Footer className="flex items-center gap-1.5 text-xs">
                      <Chip size="sm" variant="soft" color="default">{roomModeLabel(room.mode)}</Chip>
                      {room.unreadCount > 0 ? (
                        <Chip size="sm" variant="soft" color="danger">{room.unreadCount} 未读</Chip>
                      ) : null}
                      {room.pendingTurns.length > 0 ? (
                        <Chip size="sm" variant="soft" color="warning">{room.pendingTurns.length} 待处理</Chip>
                      ) : null}
                      <span className="ml-auto text-muted">{room.participants.length} 名成员</span>
                    </Card.Footer>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </ScrollShadow>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card variant={accent ? "secondary" : "default"}>
      <Card.Header className="gap-1.5">
        <Card.Description className="text-sm font-medium tracking-wide text-muted">{label}</Card.Description>
        <Card.Title className="text-3xl font-semibold leading-none tabular-nums">{value}</Card.Title>
      </Card.Header>
    </Card>
  );
}

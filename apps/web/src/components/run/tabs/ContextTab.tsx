import type { RoomViewModel } from "../../../types.ts";
import { Card, Chip } from "@heroui/react";
import { contextStatusColor } from "../../../lib/status.ts";

export function ContextTab({ room, runId }: { room: RoomViewModel; runId: string }) {
  const items = room.contextItems.filter((c) => c.runId === runId || !c.runId);
  if (items.length === 0) {
    return <div className="p-6 text-center text-sm text-muted">No context for this run.</div>;
  }
  return (
    <ul className="flex flex-col gap-2 p-3">
      {items.map((c) => (
        <li key={c.id}>
          <Card variant="transparent" className="border border-border">
            <Card.Header>
              <div className="flex items-center gap-2">
                <Card.Title className="flex-1 truncate text-sm">{c.title}</Card.Title>
                <Chip size="sm" variant="soft" color={contextStatusColor(c.status)}>{c.status}</Chip>
              </div>
              <Card.Description className="whitespace-pre-wrap">{c.content}</Card.Description>
            </Card.Header>
          </Card>
        </li>
      ))}
    </ul>
  );
}

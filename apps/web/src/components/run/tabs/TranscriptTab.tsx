import type { RoomViewModel } from "../../../types.ts";
import { Avatar, Card, Chip, ScrollShadow } from "@heroui/react";
import { formatTime, initials } from "../../../lib/format.ts";

export function TranscriptTab({ room, runId }: { room: RoomViewModel; runId: string }) {
  const messages = room.messages.filter((m) => m.runId === runId);
  if (messages.length === 0) {
    return <div className="p-6 text-center text-sm text-muted">No transcript for this run yet.</div>;
  }
  return (
    <ScrollShadow className="h-full overflow-auto" orientation="vertical">
      <ul className="flex flex-col gap-2 p-3">
        {messages.map((m) => (
          <li key={m.id}>
            <Card variant="transparent" className="border border-border">
              <Card.Header>
                <div className="flex items-center gap-2">
                  <Avatar size="sm"><Avatar.Fallback>{initials(m.senderName)}</Avatar.Fallback></Avatar>
                  <Card.Title className="text-sm">{m.senderName}</Card.Title>
                  <Chip size="sm" variant="soft" color="default">{m.role}</Chip>
                  <span className="ml-auto text-xs text-muted">{formatTime(m.createdAt)}</span>
                </div>
              </Card.Header>
              {m.text ? (
                <Card.Content>
                  <p className="text-sm whitespace-pre-wrap">{m.text}</p>
                </Card.Content>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </ScrollShadow>
  );
}

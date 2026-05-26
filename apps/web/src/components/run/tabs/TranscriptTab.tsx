import type { RoomViewModel, ContextItemViewModel } from "../../../types.ts";
import { Alert, Avatar, Card, Chip, ScrollShadow } from "@heroui/react";
import { formatTime, initials, truncate } from "../../../lib/format.ts";

const COMPACT_RE = /(claude_compact|compact|summary)/i;

function findPreCompact(items: ContextItemViewModel[], runId: string): ContextItemViewModel | undefined {
  const matches = items.filter(
    (c) => c.runId === runId && c.status === "draft" && (COMPACT_RE.test(c.title) || COMPACT_RE.test(c.content))
  );
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1];
}

export function TranscriptTab({ room, runId }: { room: RoomViewModel; runId: string }) {
  const messages = room.messages.filter((m) => m.runId === runId);
  const preCompact = findPreCompact(room.contextItems, runId);

  if (messages.length === 0 && !preCompact) {
    return <div className="p-6 text-center text-sm text-muted">No transcript for this run yet.</div>;
  }
  return (
    <ScrollShadow className="h-full overflow-auto" orientation="vertical">
      <div className="flex flex-col gap-2 p-3">
        {preCompact ? (
          <Alert color="warning">
            <Alert.Content>
              <div className="flex items-center gap-2">
                <Alert.Title>Context compacted</Alert.Title>
                <Chip size="sm" variant="soft" color="warning">PreCompact</Chip>
              </div>
              <Alert.Description>
                <span className="block text-xs text-muted">{preCompact.title}</span>
                <span className="block whitespace-pre-wrap">{truncate(preCompact.content, 200)}</span>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        <ul className="flex flex-col gap-2">
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
      </div>
    </ScrollShadow>
  );
}

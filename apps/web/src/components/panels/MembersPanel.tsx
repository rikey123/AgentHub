import { Avatar, Card, Chip } from "@heroui/react";
import type { ParticipantViewModel } from "../../types.ts";
import { initials } from "../../lib/format.ts";
import { presenceColor } from "../../lib/status.ts";

export function MembersPanel({ members }: { members: ReadonlyArray<ParticipantViewModel> }) {
  if (members.length === 0) {
    return <EmptyState label="No members in this room yet." />;
  }
  return (
    <ul className="flex flex-col gap-2 p-3" role="list">
      {members.map((m) => (
        <li key={m.id}>
          <Card variant="transparent" className="border border-border">
            <Card.Header>
              <div className="flex items-center gap-3">
                <Avatar><Avatar.Fallback>{initials(m.name)}</Avatar.Fallback></Avatar>
                <div className="min-w-0 flex-1">
                  <Card.Title className="truncate">{m.name}</Card.Title>
                  <Card.Description className="text-xs">{m.role} · {m.adapterId}</Card.Description>
                </div>
                <Chip size="sm" variant="soft" color={presenceColor(m.presence)}>{m.presence}</Chip>
              </div>
            </Card.Header>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="p-6 text-center text-sm text-muted">{label}</div>;
}

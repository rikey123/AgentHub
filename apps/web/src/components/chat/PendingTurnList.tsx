import { Button, Card, Chip, ScrollShadow } from "@heroui/react";
import type { MessageViewModel } from "../../types.ts";
import { formatTime, truncate } from "../../lib/format.ts";
import { pendingTurnColor } from "../../lib/status.ts";

interface PendingTurnListProps {
  turns: ReadonlyArray<MessageViewModel>;
  onCancel: (pendingTurnId: string) => void;
  onEdit: (messageId: string) => void;
}

export function PendingTurnList({ turns, onCancel, onEdit }: PendingTurnListProps) {
  if (turns.length === 0) return null;
  return (
    <div className="border-t border-border bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Queued ({turns.length})</h3>
        {turns.length >= 15 ? (
          <Chip size="sm" variant="soft" color="warning" role="alert">Queue almost full</Chip>
        ) : null}
      </div>
      <ScrollShadow className="mt-2 max-h-32 overflow-auto" orientation="vertical">
        <ul className="flex flex-col gap-1">
          {turns.map((turn) => (
            <li key={turn.pendingTurnId} className="flex items-center gap-2">
              <Card variant="transparent" className="flex-1 border border-border">
                <Card.Header className="gap-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Chip size="sm" variant="soft" color={pendingTurnColor(turn.pendingTurnStatus)}>
                      {turn.pendingTurnStatus ?? "queued"}
                    </Chip>
                    <span className="text-muted">{formatTime(turn.createdAt)}</span>
                  </div>
                  <Card.Description className="text-sm">{truncate(turn.text, 140)}</Card.Description>
                </Card.Header>
              </Card>
              <Button size="sm" variant="secondary" onPress={() => onEdit(turn.id)} aria-label="Edit pending turn">Edit</Button>
              <Button
                size="sm"
                variant="danger"
                aria-label="Cancel pending turn"
                onPress={() => {
                  if (turn.pendingTurnId && window.confirm("Cancel queued message?")) {
                    onCancel(turn.pendingTurnId);
                  }
                }}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      </ScrollShadow>
    </div>
  );
}

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
    <div className="border-t border-border bg-surface px-3 py-2" data-testid="pending-turn-list">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">待发送（{turns.length}）</h3>
        {turns.length >= 20 ? (
          <Chip size="sm" variant="soft" color="warning" role="alert">队列已满</Chip>
        ) : turns.length >= 15 ? (
          <Chip size="sm" variant="soft" color="warning" role="alert">队列即将满</Chip>
        ) : null}
      </div>
      <ScrollShadow className="mt-2 max-h-32 overflow-auto" orientation="vertical">
        <ul className="flex flex-col gap-1">
          {turns.map((turn, index) => (
            <li key={turn.pendingTurnId} className="flex items-center gap-2">
              <Card variant="transparent" className="flex-1 border border-border">
                <Card.Header className="gap-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Chip size="sm" variant="soft" color={pendingTurnColor(turn.pendingTurnStatus)}>
                      {pendingTurnStatusLabel(turn.pendingTurnStatus)}（{turn.pendingTurnPosition ?? index + 1}）
                    </Chip>
                    <span className="text-muted">{formatTime(turn.createdAt)}</span>
                  </div>
                  <Card.Description className="text-sm">{truncate(turn.text, 140)}</Card.Description>
                </Card.Header>
              </Card>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => onEdit(turn.id)}
                aria-label="编辑待发送消息"
                data-testid={`pending-turn-edit-${turn.pendingTurnId}`}
              >
                编辑
              </Button>
              <Button
                size="sm"
                variant="danger"
                aria-label="取消待发送消息"
                data-testid={`pending-turn-cancel-${turn.pendingTurnId}`}
                onPress={() => {
                  if (turn.pendingTurnId && window.confirm("取消这条待发送消息？")) {
                    onCancel(turn.pendingTurnId);
                  }
                }}
              >
                取消
              </Button>
            </li>
          ))}
        </ul>
      </ScrollShadow>
    </div>
  );
}

function pendingTurnStatusLabel(status: MessageViewModel["pendingTurnStatus"]): string {
  if (status === "scheduled") return "已排期";
  if (status === "consumed") return "处理中";
  if (status === "cancelled") return "已取消";
  return "排队中";
}

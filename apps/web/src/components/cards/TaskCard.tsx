import { Card, Chip } from "@heroui/react";
import type { Card as ProtocolCard } from "@agenthub/protocol/domains";
import { taskStatusColor } from "../../lib/status.ts";

type TaskCardData = Extract<ProtocolCard, { type: "task" }>;

export function TaskCard({ card }: { card: TaskCardData }) {
  return (
    <Card variant="default">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1 truncate">{card.title}</Card.Title>
          <Chip size="sm" variant="soft" color={taskStatusColor(String(card.status))}>{String(card.status)}</Chip>
        </div>
        {card.assigneeAgentId ? (
          <Card.Description>负责人：{card.assigneeAgentId}</Card.Description>
        ) : null}
      </Card.Header>
    </Card>
  );
}

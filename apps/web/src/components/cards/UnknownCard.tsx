import { Card, Chip } from "@heroui/react";

interface UnknownCardProps {
  card: Record<string, unknown> & { type?: string };
}

export function UnknownCard({ card }: UnknownCardProps) {
  return (
    <Card variant="default">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title>不支持的卡片</Card.Title>
          <Chip size="sm" variant="soft" color="default">{card.type ?? "未知类型"}</Chip>
        </div>
      </Card.Header>
      <Card.Content>
        <pre className="ah-mono max-h-48 overflow-auto rounded bg-surface-secondary p-2 text-xs">
          {JSON.stringify(card, null, 2)}
        </pre>
      </Card.Content>
    </Card>
  );
}

import { useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import type { Card as ProtocolCard } from "@agenthub/protocol/domains";

type PreviewCardData = Extract<ProtocolCard, { type: "preview" }>;

export function PreviewCard({ card }: { card: PreviewCardData }) {
  const [open, setOpen] = useState(false);
  return (
    <Card variant="default">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1">预览</Card.Title>
          <Chip size="sm" variant="soft" color="default">{card.kind}</Chip>
        </div>
        <Card.Description className="ah-mono truncate">{card.url}</Card.Description>
      </Card.Header>
      <Card.Content>
        {open ? (
          <iframe
            title="产物预览"
            src={card.url}
            sandbox="allow-scripts"
            className="h-72 w-full rounded-lg border border-border"
          />
        ) : null}
      </Card.Content>
      <Card.Footer className="gap-2">
        <Button variant="secondary" onPress={() => setOpen((v) => !v)}>
          {open ? "收起预览" : "显示预览"}
        </Button>
        <Button variant="ghost" onPress={() => window.open(card.url, "_blank", "noopener,noreferrer")}>
          打开
        </Button>
      </Card.Footer>
    </Card>
  );
}

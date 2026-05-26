import { useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import type { Card as ProtocolCard } from "@agenthub/protocol/domains";
import { contextStatusColor } from "../../lib/status.ts";

type ContextCardData = Extract<ProtocolCard, { type: "context" }>;

interface ContextCardProps {
  card: ContextCardData;
  csrfFetch: typeof fetch;
}

export function ContextCard({ card, csrfFetch }: ContextCardProps) {
  const [pending, setPending] = useState<"confirm" | "discard" | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const isDraft = card.status === "draft";

  const act = async (action: "confirm" | "deprecate") => {
    setPending(action === "confirm" ? "confirm" : "discard");
    setError(undefined);
    try {
      const res = await csrfFetch(`/context/${encodeURIComponent(card.contextId)}/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "deprecate" ? { baseVersion: 1, reason: "discarded" } : {})
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Card variant="default">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1 truncate">{card.title}</Card.Title>
          <Chip size="sm" variant="soft" color={contextStatusColor(String(card.status))}>
            {String(card.status)}
          </Chip>
        </div>
        <Card.Description>{card.summary}</Card.Description>
      </Card.Header>
      {error ? <Card.Content><p className="text-xs text-danger">{error}</p></Card.Content> : null}
      {isDraft ? (
        <Card.Footer className="gap-2">
          <Button variant="primary" isPending={pending === "confirm"} onPress={() => act("confirm")}>Confirm</Button>
          <Button variant="tertiary" isPending={pending === "discard"} onPress={() => act("deprecate")}>Discard</Button>
        </Card.Footer>
      ) : null}
    </Card>
  );
}

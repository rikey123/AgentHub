import { useState } from "react";
import { Button, Card, Chip, TextArea } from "@heroui/react";
import type { Card as ProtocolCard } from "@agenthub/protocol/domains";
import { interventionPriorityColor } from "../../lib/status.ts";

type InterventionCardData = Extract<ProtocolCard, { type: "intervention" }>;

interface InterventionCardProps {
  card: InterventionCardData;
  csrfFetch: typeof fetch;
}

export function InterventionCard({ card, csrfFetch }: InterventionCardProps) {
  const [effective, setEffective] = useState<string>(card.preview ?? "");
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const resolved = ["approved", "ignored", "rejected", "snoozed", "injected", "resolved", "closed"].includes(String(card.status));

  const act = async (action: "approve" | "ignore" | "reject" | "later") => {
    setPending(action);
    setError(undefined);
    try {
      const body: Record<string, unknown> = {};
      if (action === "approve") body.effectiveText = effective;
      if (action === "later") body.snoozeSeconds = 5 * 60;
      const res = await csrfFetch(`/interventions/${encodeURIComponent(card.interventionId)}/${action}`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Card variant="default" className="border border-accent/30">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title>Intervention</Card.Title>
          <Chip size="sm" variant="soft" color={interventionPriorityColor(String(card.priority))}>
            {String(card.priority)}
          </Chip>
          <Chip size="sm" variant="soft" color="default">{String(card.status)}</Chip>
        </div>
        <Card.Description>{card.reason}</Card.Description>
      </Card.Header>
      <Card.Content>
        {!resolved ? (
          <TextArea
            value={effective}
            onChange={(e) => setEffective(e.currentTarget.value)}
            aria-label="Effective text"
            placeholder="Optional override text"
            className="min-h-20"
          />
        ) : (
          card.preview ? <p className="text-sm text-muted whitespace-pre-wrap">{card.preview}</p> : null
        )}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </Card.Content>
      {!resolved ? (
        <Card.Footer className="gap-2 flex-wrap">
          <Button variant="primary" isPending={pending === "approve"} onPress={() => act("approve")}>Approve</Button>
          <Button variant="secondary" isPending={pending === "later"} onPress={() => act("later")}>Later</Button>
          <Button variant="tertiary" isPending={pending === "ignore"} onPress={() => act("ignore")}>Ignore</Button>
          <Button variant="danger" isPending={pending === "reject"} onPress={() => act("reject")}>Reject</Button>
        </Card.Footer>
      ) : null}
    </Card>
  );
}

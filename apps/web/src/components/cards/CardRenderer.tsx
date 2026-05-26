import type { Card as ProtocolCard } from "@agenthub/protocol/domains";
import { PermissionCard } from "./PermissionCard.tsx";
import { InterventionCard } from "./InterventionCard.tsx";
import { DiffCard } from "./DiffCard.tsx";
import { ContextCard } from "./ContextCard.tsx";
import { TaskCard } from "./TaskCard.tsx";
import { PreviewCard } from "./PreviewCard.tsx";
import { UnknownCard } from "./UnknownCard.tsx";

interface CardRendererProps {
  card: ProtocolCard;
  csrfFetch: typeof fetch;
}

export function CardRenderer({ card, csrfFetch }: CardRendererProps) {
  switch (card.type) {
    case "permission": return <PermissionCard card={card} csrfFetch={csrfFetch} />;
    case "intervention": return <InterventionCard card={card} csrfFetch={csrfFetch} />;
    case "diff": return <DiffCard card={card} csrfFetch={csrfFetch} />;
    case "context": return <ContextCard card={card} csrfFetch={csrfFetch} />;
    case "task": return <TaskCard card={card} />;
    case "preview": return <PreviewCard card={card} />;
    default:
      return <UnknownCard card={card as unknown as Record<string, unknown>} />;
  }
}

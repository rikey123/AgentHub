import type { Card as ProtocolCard } from "@agenthub/protocol/domains";
import { PermissionCard } from "./PermissionCard.tsx";
import { InterventionCard } from "./InterventionCard.tsx";
import { DiffCard } from "./DiffCard.tsx";
import { ContextCard } from "./ContextCard.tsx";
import { TaskCard } from "./TaskCard.tsx";
import { PreviewCard } from "./PreviewCard.tsx";
import { UnknownCard } from "./UnknownCard.tsx";
import { DeploymentCard, DocumentCard, PresentationCard, PreviewArtifactCard } from "./ArtifactCards.tsx";

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
    case "artifact": {
      if (card.kind === "web_page" || card.kind === "web_app") return <PreviewArtifactCard card={card} />;
      if (card.kind === "document") return <DocumentCard card={card} />;
      if (card.kind === "presentation" || card.kind === "presentation_pptx") return <PresentationCard card={card} />;
      return <UnknownCard card={card as unknown as Record<string, unknown>} />;
    }
    case "deployment": return <DeploymentCard card={card as never} />;
    default:
      return <UnknownCard card={card as unknown as Record<string, unknown>} />;
  }
}

import { Card, Chip } from "@heroui/react";
import type { Card as ProtocolCard } from "@agenthub/protocol/domains";

type ArtifactCardData = Extract<ProtocolCard, { type: "artifact" }>;
type DeploymentCardData = Extract<ProtocolCard, { type: "deployment" }> & {
  readonly lastError?: string;
  readonly logs?: readonly string[];
};

export function PreviewArtifactCard({ card }: { readonly card: ArtifactCardData }) {
  const downloadUrl = artifactDownloadUrl(card.artifactId);
  return (
    <Card variant="default" data-testid="preview-card">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1 truncate">Preview</Card.Title>
          <Chip size="sm" variant="soft" color="accent">{card.kind}</Chip>
          {card.version !== undefined ? <Chip size="sm" variant="soft" color="default">v{card.version}</Chip> : null}
        </div>
        <Card.Description className="truncate">{card.title}</Card.Description>
      </Card.Header>
      <Card.Content>
        <iframe
          title={card.title}
          src={`/artifacts/${encodeURIComponent(card.artifactId)}/preview`}
          sandbox="allow-scripts"
          className="h-48 w-full rounded-lg border border-border bg-white"
        />
      </Card.Content>
      <Card.Footer className="flex-wrap gap-2">
        <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={downloadUrl}>Download</a>
      </Card.Footer>
    </Card>
  );
}

export function DocumentCard({ card }: { readonly card: ArtifactCardData }) {
  return (
    <Card variant="default" data-testid="document-card">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1 truncate">Document</Card.Title>
          <Chip size="sm" variant="soft" color="default">{card.kind}</Chip>
          {card.version !== undefined ? <Chip size="sm" variant="soft" color="default">v{card.version}</Chip> : null}
        </div>
        <Card.Description className="truncate">{card.title}</Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="rounded-lg border border-border bg-surface-secondary p-3 text-sm text-muted">
          Markdown preview is available in the artifact studio.
        </div>
      </Card.Content>
      <Card.Footer className="flex-wrap gap-2">
        <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={artifactDownloadUrl(card.artifactId)}>Download</a>
      </Card.Footer>
    </Card>
  );
}

export function PresentationCard({ card }: { readonly card: ArtifactCardData }) {
  const isPptx = card.kind === "presentation_pptx";
  return (
    <Card variant="default" data-testid="presentation-card">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1 truncate">{isPptx ? "PPTX preview" : "HTML slides"}</Card.Title>
          <Chip size="sm" variant="soft" color={isPptx ? "warning" : "accent"}>{card.kind}</Chip>
          {card.version !== undefined ? <Chip size="sm" variant="soft" color="default">v{card.version}</Chip> : null}
        </div>
        <Card.Description className="truncate">{card.title}</Card.Description>
      </Card.Header>
      <Card.Content>
        {isPptx ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-semibold">Install failed</p>
            <p className="mt-1 text-muted">Download the file if officecli preview cannot start.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface-secondary p-3 text-sm text-muted">
            Slide 1 thumbnail. Use fullscreen controls to navigate.
          </div>
        )}
      </Card.Content>
      <Card.Footer className="flex-wrap gap-2">
        <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={artifactDownloadUrl(card.artifactId)}>Download</a>
      </Card.Footer>
    </Card>
  );
}

export function DeploymentCard({ card }: { readonly card: DeploymentCardData }) {
  const logs = card.logs ?? [];
  const error = card.lastError;
  return (
    <Card variant="default" data-testid="deployment-card">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1 truncate">Deployment</Card.Title>
          <Chip size="sm" variant="soft" color="default">{card.kind}</Chip>
          <Chip size="sm" variant="soft" color={statusColor(card.status)}>{card.status}</Chip>
        </div>
        <Card.Description className="ah-mono truncate">{card.deploymentId}</Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="grid gap-2 text-sm">
          {card.url ? <a className="text-accent underline underline-offset-2" href={card.url}>Open</a> : null}
          {card.downloadUrl ? <a className="text-accent underline underline-offset-2" href={card.downloadUrl}>Download ZIP</a> : null}
          {card.imageTag ? <div className="ah-mono rounded bg-surface-secondary px-2 py-1 text-xs">{card.imageTag}</div> : null}
          {error ? <div className="rounded border border-danger/40 bg-danger/10 p-2 text-danger">{error}</div> : null}
          {logs.length > 0 ? (
            <pre className="ah-mono max-h-32 overflow-auto rounded bg-surface-secondary p-2 text-xs">{logs.join("\n")}</pre>
          ) : null}
        </div>
      </Card.Content>
      <Card.Footer className="flex-wrap gap-2">
        {card.url ? <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={card.url}>Open</a> : null}
      </Card.Footer>
    </Card>
  );
}

function artifactDownloadUrl(artifactId: string): string {
  return `/artifacts/${encodeURIComponent(artifactId)}/download`;
}

function statusColor(status: DeploymentCardData["status"]): "default" | "success" | "warning" | "danger" {
  if (status === "ready") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "queued" || status === "in_progress") return "warning";
  return "default";
}

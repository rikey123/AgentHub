import { useRef, useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import type { Card as ProtocolCard } from "@agenthub/protocol/domains";
import { artifactContentTypeFor } from "@agenthub/protocol/preview";
import { ArtifactPreviewModal, normalizePreviewKind } from "../artifacts/ArtifactPreviewModal.tsx";

type ArtifactCardData = Extract<ProtocolCard, { type: "artifact" }>;
type DeploymentCardData = Extract<ProtocolCard, { type: "deployment" }> & {
  readonly lastError?: string;
  readonly logs?: readonly string[];
};
type ArtifactPreviewState = { readonly path: string; readonly name: string; readonly content?: string | undefined; readonly error?: string | undefined; readonly loading?: boolean | undefined; readonly mimeType?: string | undefined; readonly sizeBytes?: number | undefined };
type LoadArtifactPreviewStateInput = { readonly artifactId: string; readonly title: string; readonly csrfFetch: typeof fetch; readonly shouldApply?: (() => boolean) | undefined };
type DeploymentAction = "redeploy" | "retry" | "cancel" | "unpublish";
type DeploymentStage = "pending" | "active" | "complete" | "failed" | "muted";

export function PreviewArtifactCard({ card, csrfFetch }: { readonly card: ArtifactCardData; readonly csrfFetch: typeof fetch }) {
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
        <ArtifactExpandAction card={card} csrfFetch={csrfFetch} />
      </Card.Footer>
    </Card>
  );
}

export function DocumentCard({ card, csrfFetch }: { readonly card: ArtifactCardData; readonly csrfFetch: typeof fetch }) {
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
        <ArtifactExpandAction card={card} csrfFetch={csrfFetch} />
      </Card.Footer>
    </Card>
  );
}

export function PresentationCard({ card, csrfFetch }: { readonly card: ArtifactCardData; readonly csrfFetch: typeof fetch }) {
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
        <ArtifactExpandAction card={card} csrfFetch={csrfFetch} />
      </Card.Footer>
    </Card>
  );
}

export function DeploymentCard({ card, csrfFetch }: { readonly card: DeploymentCardData; readonly csrfFetch: typeof fetch }) {
  const [pendingAction, setPendingAction] = useState<DeploymentAction | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [copyError, setCopyError] = useState<string | undefined>(undefined);
  const logs = card.logs ?? [];
  const error = card.lastError;
  const deploymentId = encodeURIComponent(card.deploymentId);
  const logsUrl = `/deployments/${deploymentId}/logs`;
  const outputReady = card.status === "ready";
  const previewUrl = outputReady ? card.url : undefined;
  const downloadUrl = outputReady ? deploymentDownloadUrl(card) : undefined;
  const imageTag = outputReady ? card.imageTag : undefined;
  const dockerCommand = imageTag ? `docker run ${imageTag}` : undefined;
  const actions = deploymentActions(card);
  const copyText = (value: string) => {
    setCopyError(undefined);
    const writer = globalThis.navigator?.clipboard?.writeText;
    if (writer === undefined) {
      setCopyError("Clipboard is unavailable.");
      return;
    }
    void writer.call(globalThis.navigator.clipboard, value).catch((err: unknown) => {
      setCopyError(err instanceof Error ? err.message : String(err));
    });
  };
  const runAction = async (action: DeploymentAction) => {
    setPendingAction(action);
    setActionError(undefined);
    try {
      const res = await csrfFetch(`/deployments/${deploymentId}/${action}`, {
        method: "POST",
        body: "{}"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(undefined);
    }
  };

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
          <p className="text-muted">{deploymentSubtitle(card)}</p>
          <div className="grid gap-1 rounded border border-border bg-surface-secondary/60 p-2">
            <DeploymentStageRow label="Build" stage={buildStage(card.status)} />
            <DeploymentStageRow label="Deploy" stage={deployStage(card.status)} />
          </div>
          {previewUrl ? <a className="text-accent underline underline-offset-2" href={previewUrl}>Open Preview</a> : null}
          {downloadUrl ? <a className="text-accent underline underline-offset-2" href={downloadUrl}>Download ZIP</a> : null}
          {previewUrl ? (
            <div className="grid gap-1 rounded bg-surface-secondary px-2 py-1">
              <span className="text-xs font-semibold text-muted">Copy URL</span>
              <code className="ah-mono text-xs">{previewUrl}</code>
            </div>
          ) : null}
          {imageTag ? <div className="ah-mono rounded bg-surface-secondary px-2 py-1 text-xs">{imageTag}</div> : null}
          {dockerCommand ? (
            <div className="grid gap-1 rounded bg-surface-secondary px-2 py-1">
              <span className="text-xs font-semibold text-muted">Copy Docker Command</span>
              <code className="ah-mono text-xs">{dockerCommand}</code>
            </div>
          ) : null}
          {error ? <div className="rounded border border-danger/40 bg-danger/10 p-2 text-danger">{error}</div> : null}
          {logs.length > 0 ? (
            <details className="rounded border border-border bg-surface-secondary">
              <summary className="cursor-pointer px-2 py-1 text-xs font-semibold text-foreground">View Logs</summary>
              <pre className="ah-mono max-h-32 overflow-auto p-2 text-xs">{logs.join("\n")}</pre>
            </details>
          ) : null}
          <a className="text-xs font-semibold text-accent underline underline-offset-2" href={logsUrl}>View Logs</a>
          {actionError ? <p className="text-xs text-danger">{actionError}</p> : null}
          {copyError ? <p className="text-xs text-danger">{copyError}</p> : null}
        </div>
      </Card.Content>
      <Card.Footer className="flex-wrap gap-2">
        {previewUrl ? <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={previewUrl}>Open</a> : null}
        {downloadUrl ? <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={downloadUrl}>Download ZIP</a> : null}
        {previewUrl ? (
          <Button size="sm" variant="tertiary" onPress={() => copyText(previewUrl)}>
            Copy URL
          </Button>
        ) : null}
        {dockerCommand ? (
          <Button size="sm" variant="tertiary" onPress={() => copyText(dockerCommand)}>
            Copy Docker Command
          </Button>
        ) : null}
        {actions.map((action) => (
          <Button
            key={action}
            size="sm"
            variant={action === "cancel" || action === "unpublish" ? "danger" : "secondary"}
            isPending={pendingAction === action}
            isDisabled={pendingAction !== undefined}
            onPress={() => void runAction(action)}
            data-endpoint={`/deployments/${card.deploymentId}/${action}`}
          >
            {actionLabel(action)}
          </Button>
        ))}
      </Card.Footer>
    </Card>
  );
}

function artifactDownloadUrl(artifactId: string): string {
  return `/artifacts/${encodeURIComponent(artifactId)}/download`;
}

function ArtifactExpandAction({ card, csrfFetch }: { readonly card: ArtifactCardData; readonly csrfFetch: typeof fetch }) {
  const [preview, setPreview] = useState<ArtifactPreviewState | undefined>(undefined);
  const requestGenerationRef = useRef(0);
  const openPreview = async () => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setPreview({ path: "artifact.txt", name: card.title, loading: true });
    const loaded = await loadArtifactPreviewState({
      artifactId: card.artifactId,
      title: card.title,
      csrfFetch,
      shouldApply: () => requestGenerationRef.current === generation
    });
    if (loaded !== undefined) setPreview(loaded);
  };

  return (
    <>
      <Button size="sm" variant="secondary" onPress={() => void openPreview()}>Expand</Button>
      <ArtifactPreviewModal
        isOpen={preview !== undefined}
        name={preview?.name ?? card.title}
        mimeType={preview?.mimeType}
        sizeBytes={preview?.sizeBytes}
        previewKind={normalizePreviewKind(undefined, preview?.mimeType, preview?.name ?? card.title)}
        content={preview?.content}
        error={preview?.error}
        loading={preview?.loading}
        downloadUrl={preview ? artifactFileRawPath(card.artifactId, preview.path) : artifactDownloadUrl(card.artifactId)}
        onRetry={() => void openPreview()}
        onOpenChange={(open) => {
          if (!open) {
            requestGenerationRef.current += 1;
            setPreview(undefined);
          }
        }}
      />
    </>
  );
}

export async function loadArtifactPreviewState(input: LoadArtifactPreviewStateInput): Promise<ArtifactPreviewState | undefined> {
  const shouldApply = input.shouldApply ?? (() => true);
  try {
    const filesRes = await input.csrfFetch(`/artifacts/${encodeURIComponent(input.artifactId)}/files`);
    if (!filesRes.ok) throw new Error(`files ${filesRes.status}`);
    if (!shouldApply()) return undefined;
    const filesData = await filesRes.json() as { readonly files?: Array<{ readonly path?: unknown }> };
    if (!shouldApply()) return undefined;
    const file = Array.isArray(filesData.files) ? filesData.files.find((item) => typeof item.path === "string") : undefined;
    const path = typeof file?.path === "string" ? file.path : "artifact.txt";
    const contentRes = await input.csrfFetch(artifactFileContentPath(input.artifactId, path));
    if (!contentRes.ok) throw new Error(`content ${contentRes.status}`);
    if (!shouldApply()) return undefined;
    const contentData = await contentRes.json() as { readonly content?: { readonly content?: unknown } | null };
    if (!shouldApply()) return undefined;
    const content = contentData.content && typeof contentData.content.content === "string" ? contentData.content.content : "";
    return {
      path,
      name: path,
      content,
      loading: false,
      mimeType: artifactContentTypeFor(path),
      sizeBytes: new TextEncoder().encode(content).byteLength
    };
  } catch (error) {
    if (!shouldApply()) return undefined;
    return { path: "artifact.txt", name: input.title, error: error instanceof Error ? error.message : String(error), loading: false };
  }
}

function artifactFileContentPath(artifactId: string, path: string): string {
  return `/artifacts/${encodeURIComponent(artifactId)}/files/${encodeURIComponent(path)}`;
}

function artifactFileRawPath(artifactId: string, path: string): string {
  return `${artifactFileContentPath(artifactId, path)}/raw`;
}

function statusColor(status: DeploymentCardData["status"]): "default" | "success" | "warning" | "danger" {
  if (status === "ready") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "queued" || status === "in_progress") return "warning";
  return "default";
}

function deploymentSubtitle(card: DeploymentCardData): string {
  if (card.status === "queued") return "Queued for deployment.";
  if (card.status === "in_progress") return card.kind === "container-build" || card.kind === "self-hosted"
    ? "Build and deploy are in progress."
    : "Deploy is in progress.";
  if (card.status === "failed") return "Deployment failed. Review logs, fix the issue, then retry.";
  if (card.status === "cancelled") return "Deployment was cancelled before completion.";
  if (card.status === "expired") return "Preview expired. Redeploy to create a fresh URL.";
  if (card.status === "unpublished") return "Deployment is unpublished.";
  if (card.downloadUrl && !card.url) return "Ready for download.";
  if (card.imageTag && !card.url) return "Container image is ready.";
  return "Deployment is ready.";
}

function deploymentActions(card: DeploymentCardData): readonly DeploymentAction[] {
  if (card.status === "queued" || card.status === "in_progress") return ["cancel"];
  if (card.status === "failed") return ["retry"];
  if (card.status === "expired" || card.status === "cancelled") return ["redeploy"];
  if (card.status === "ready") return canUnpublish(card.kind) ? ["redeploy", "unpublish"] : ["redeploy"];
  if (card.status === "unpublished") return ["redeploy"];
  return [];
}

function actionLabel(action: DeploymentAction): string {
  if (action === "redeploy") return "Redeploy";
  if (action === "retry") return "Retry";
  if (action === "cancel") return "Cancel";
  return "Unpublish";
}

function deploymentDownloadUrl(card: DeploymentCardData): string | undefined {
  if (card.kind === "source-zip" || card.kind === "container-export") {
    return `/deployments/${encodeURIComponent(card.deploymentId)}/download`;
  }
  return card.downloadUrl !== undefined && isBrowserUrl(card.downloadUrl) ? card.downloadUrl : undefined;
}

function canUnpublish(kind: DeploymentCardData["kind"]): boolean {
  return kind === "static-site" || kind === "self-hosted";
}

function isBrowserUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");
}

function buildStage(status: DeploymentCardData["status"]): DeploymentStage {
  if (status === "queued") return "pending";
  if (status === "in_progress") return "active";
  if (status === "ready" || status === "unpublished" || status === "expired") return "complete";
  if (status === "failed") return "failed";
  return "muted";
}

function deployStage(status: DeploymentCardData["status"]): DeploymentStage {
  if (status === "queued") return "pending";
  if (status === "in_progress") return "active";
  if (status === "ready") return "complete";
  if (status === "failed") return "failed";
  return "muted";
}

function DeploymentStageRow({ label, stage }: { readonly label: string; readonly stage: DeploymentStage }) {
  return (
    <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2 text-xs">
      <span className="font-semibold text-foreground">{label}</span>
      <span className="h-1.5 rounded-full bg-border">
        <span className={`block h-full rounded-full ${stageBarClass(stage)}`} />
      </span>
      <span className="text-muted">{stageLabel(stage)}</span>
    </div>
  );
}

function stageBarClass(stage: DeploymentStage): string {
  if (stage === "complete") return "w-full bg-success";
  if (stage === "active") return "w-2/3 bg-warning";
  if (stage === "failed") return "w-full bg-danger";
  if (stage === "pending") return "w-1/4 bg-border";
  return "w-full bg-border";
}

function stageLabel(stage: DeploymentStage): string {
  if (stage === "complete") return "done";
  if (stage === "active") return "running";
  if (stage === "failed") return "failed";
  if (stage === "pending") return "queued";
  return "stopped";
}

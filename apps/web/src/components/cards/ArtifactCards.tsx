import { useEffect, useRef, useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import type { Card as ProtocolCard } from "@agenthub/protocol/domains";
import { artifactContentTypeFor } from "@agenthub/protocol/preview";
import {
  ArtifactPreviewModal,
  artifactChatReferenceForSlide,
  normalizePreviewKind,
  type ArtifactChatReference
} from "../artifacts/ArtifactPreviewModal.tsx";

type ArtifactCardData = Extract<ProtocolCard, { type: "artifact" }> & {
  readonly summary?: string | undefined;
  readonly slideCount?: number | undefined;
  readonly currentSlide?: number | undefined;
  readonly pptStatus?: "loading" | "installing" | "ready" | "startFailed" | "installFailed" | undefined;
  readonly pptPreviewUrl?: string | undefined;
};
type DeploymentCardData = Extract<ProtocolCard, { type: "deployment" }> & {
  readonly lastError?: string;
  readonly logs?: readonly string[];
  readonly logPreview?: readonly string[];
};
type ArtifactPreviewState = { readonly path: string; readonly name: string; readonly content?: string | undefined; readonly error?: string | undefined; readonly loading?: boolean | undefined; readonly mimeType?: string | undefined; readonly sizeBytes?: number | undefined };
type LoadArtifactPreviewStateInput = { readonly artifactId: string; readonly title: string; readonly csrfFetch: typeof fetch; readonly shouldApply?: (() => boolean) | undefined };
type PptPreviewState = {
  readonly status: NonNullable<ArtifactCardData["pptStatus"]> | "ready";
  readonly previewUrl?: string | undefined;
  readonly port?: number | undefined;
  readonly error?: string | undefined;
};
type PptPreviewStartResponse = {
  readonly port?: unknown;
  readonly previewUrl?: unknown;
  readonly status?: unknown;
  readonly message?: unknown;
  readonly error?: unknown;
};
export type DeploymentAction = "redeploy" | "retry" | "cancel" | "unpublish";
type DeploymentStage = "pending" | "active" | "complete" | "failed" | "muted";
type ArtifactCardProps = {
  readonly card: ArtifactCardData;
  readonly csrfFetch: typeof fetch;
  readonly onReferenceArtifact?: ((reference: ArtifactChatReference) => void) | undefined;
};

export function PreviewArtifactCard({ card, csrfFetch, onReferenceArtifact }: ArtifactCardProps) {
  const downloadUrl = artifactDownloadUrl(card.artifactId);
  const displayName = artifactDisplayName(card);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | undefined>();
  const deploy = async () => {
    setDeploying(true);
    setDeployError(undefined);
    try {
      const response = await csrfFetch("/deployments", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ artifactId: card.artifactId, kind: "preview-url" })
      });
      if (!response.ok) throw new Error(`Deploy failed: ${response.status}`);
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeploying(false);
    }
  };
  return (
    <Card variant="default" data-testid="preview-card">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1 truncate">Preview</Card.Title>
          <Chip size="sm" variant="soft" color="accent">{card.kind}</Chip>
          {card.version !== undefined ? <Chip size="sm" variant="soft" color="default">v{card.version}</Chip> : null}
        </div>
        <Card.Description className="truncate">{artifactDescription(card)}</Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="grid gap-2">
          <iframe
            title={displayName}
            src={`/artifacts/${encodeURIComponent(card.artifactId)}/preview`}
            sandbox="allow-scripts"
            className="h-48 w-full rounded-lg border border-border bg-white"
          />
          {deployError ? <p className="text-xs text-danger" role="alert">{deployError}</p> : null}
        </div>
      </Card.Content>
      <Card.Footer className="flex-wrap gap-2">
        <ArtifactExpandAction card={card} csrfFetch={csrfFetch} onReferenceArtifact={onReferenceArtifact} label="Edit" variant="primary" />
        <Button size="sm" variant="secondary" isPending={deploying} isDisabled={deploying} onPress={() => void deploy()} data-endpoint="/deployments">Deploy</Button>
        <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={downloadUrl}>Download</a>
        <ArtifactExpandAction card={card} csrfFetch={csrfFetch} onReferenceArtifact={onReferenceArtifact} />
      </Card.Footer>
    </Card>
  );
}

export function DocumentCard({ card, csrfFetch, onReferenceArtifact }: ArtifactCardProps) {
  return (
    <Card variant="default" data-testid="document-card">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1 truncate">Document</Card.Title>
          <Chip size="sm" variant="soft" color="default">{card.kind}</Chip>
          {card.version !== undefined ? <Chip size="sm" variant="soft" color="default">v{card.version}</Chip> : null}
        </div>
        <Card.Description className="truncate">{artifactDescription(card)}</Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="rounded-lg border border-border bg-surface-secondary p-3 text-sm text-muted">
          <p className="font-semibold text-foreground">Markdown summary</p>
          <p className="mt-1">{card.summary ?? "Preview the first paragraphs, then expand for the full artifact studio."}</p>
        </div>
      </Card.Content>
      <Card.Footer className="flex-wrap gap-2">
        <ArtifactExpandAction card={card} csrfFetch={csrfFetch} onReferenceArtifact={onReferenceArtifact} label="Edit" variant="primary" />
        <Button size="sm" variant="secondary" onPress={() => onReferenceArtifact?.({ token: `@artifact:${card.artifactId}#L1-L1`, ref: { type: "artifact", artifactId: card.artifactId, lineStart: 1, lineEnd: 1 } })} data-reference-token={`@artifact:${card.artifactId}#L1-L1`}>Reference</Button>
        <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={artifactDownloadUrl(card.artifactId)}>Download</a>
        <ArtifactExpandAction card={card} csrfFetch={csrfFetch} onReferenceArtifact={onReferenceArtifact} />
      </Card.Footer>
    </Card>
  );
}

export function PresentationCard({ card, csrfFetch, onReferenceArtifact }: ArtifactCardProps) {
  const isPptx = card.kind === "presentation_pptx";
  const [slide, setSlide] = useState(card.currentSlide ?? 1);
  const slideCount = Math.max(1, card.slideCount ?? 1);
  const [pptPreview, setPptPreview] = useState<PptPreviewState>(() => initialPptPreviewState(card));
  useEffect(() => {
    if (!isPptx) return;
    if (card.pptPreviewUrl !== undefined || card.pptStatus !== undefined) {
      setPptPreview(initialPptPreviewState(card));
      return;
    }
    let cancelled = false;
    let startedPort: number | undefined;
    setPptPreview({ status: "loading" });
    void startPptPreviewSession(csrfFetch, card.artifactId)
      .then((session) => {
        startedPort = session.port;
        if (cancelled) {
          if (startedPort !== undefined) void stopPptPreviewSession(csrfFetch, card.artifactId, startedPort);
          return;
        }
        setPptPreview(session);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPptPreview({
          status: "startFailed",
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return () => {
      cancelled = true;
      if (startedPort !== undefined) void stopPptPreviewSession(csrfFetch, card.artifactId, startedPort);
    };
  }, [card.artifactId, card.pptPreviewUrl, card.pptStatus, csrfFetch, isPptx]);
  return (
    <Card variant="default" data-testid="presentation-card">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1 truncate">{isPptx ? "PPTX preview" : "HTML slides"}</Card.Title>
          <Chip size="sm" variant="soft" color={isPptx ? "warning" : "accent"}>{card.kind}</Chip>
          {card.version !== undefined ? <Chip size="sm" variant="soft" color="default">v{card.version}</Chip> : null}
        </div>
        <Card.Description className="truncate">{artifactDescription(card)}</Card.Description>
      </Card.Header>
      <Card.Content>
        {isPptx ? <PptxPreviewBody preview={pptPreview} /> : (
          <div className="rounded-lg border border-border bg-surface-secondary p-3 text-sm text-muted">
            Slide {slide} thumbnail. Use fullscreen controls to navigate.
          </div>
        )}
      </Card.Content>
      <Card.Footer className="flex-wrap gap-2">
        <Button size="sm" variant="tertiary" isDisabled={slide <= 1} onPress={() => setSlide((current) => Math.max(1, current - 1))}>Prev</Button>
        <Button size="sm" variant="tertiary" isDisabled={slide >= slideCount} onPress={() => setSlide((current) => Math.min(slideCount, current + 1))}>Next</Button>
        <Button size="sm" variant="secondary" onPress={() => onReferenceArtifact?.(artifactChatReferenceForSlide(card.artifactId, slide))} data-reference-token={`@artifact:${card.artifactId}#slide=${slide}`}>Reference Slide</Button>
        <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={artifactDownloadUrl(card.artifactId)}>Download</a>
        <ArtifactExpandAction card={card} csrfFetch={csrfFetch} onReferenceArtifact={onReferenceArtifact} />
      </Card.Footer>
    </Card>
  );
}

function PptxPreviewBody({ preview }: { readonly preview: PptPreviewState }) {
  if (preview.status === "ready" && preview.previewUrl) {
    return <iframe title="PPT Preview" src={preview.previewUrl} className="h-48 w-full rounded-lg border border-border bg-white" />;
  }
  const statusText = pptStatusText(preview.status, preview.error);
  return (
    <div className={`rounded-lg border p-3 text-sm ${preview.status === "startFailed" || preview.status === "installFailed" ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10"}`}>
      <p className="font-semibold">{statusText.title}</p>
      <p className="mt-1 text-muted">{statusText.description}</p>
      <p className="mt-2 text-xs text-muted">Download fallback is always available.</p>
    </div>
  );
}

export function GenericArtifactCard({ card, csrfFetch, onReferenceArtifact }: ArtifactCardProps) {
  return (
    <Card variant="default" data-testid="artifact-card">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title className="flex-1 truncate">Artifact</Card.Title>
          <Chip size="sm" variant="soft" color="default">{card.kind}</Chip>
          {card.version !== undefined ? <Chip size="sm" variant="soft" color="default">v{card.version}</Chip> : null}
        </div>
        <Card.Description className="truncate">{artifactDescription(card)}</Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="rounded-lg border border-border bg-surface-secondary p-3 text-sm text-muted">
          {card.kind === "source_code" ? "Source preview is available in the artifact studio." : "This artifact can be downloaded or expanded for details."}
        </div>
      </Card.Content>
      <Card.Footer className="flex-wrap gap-2">
        <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={artifactDownloadUrl(card.artifactId)}>Download</a>
        <ArtifactExpandAction card={card} csrfFetch={csrfFetch} onReferenceArtifact={onReferenceArtifact} />
      </Card.Footer>
    </Card>
  );
}

function artifactDisplayName(card: ArtifactCardData): string {
  return card.filename && card.filename.length > 0 ? card.filename : card.title;
}

function artifactDescription(card: ArtifactCardData): string {
  const displayName = artifactDisplayName(card);
  return displayName !== card.title ? `${displayName} - ${card.title}` : displayName;
}

export function DeploymentCard({ card, csrfFetch }: { readonly card: DeploymentCardData; readonly csrfFetch: typeof fetch }) {
  const [pendingAction, setPendingAction] = useState<DeploymentAction | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [copyError, setCopyError] = useState<string | undefined>(undefined);
  const [fallbackLogs, setFallbackLogs] = useState<readonly string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | undefined>(undefined);
  const liveLogs = deploymentLogLines(card.logs ?? card.logPreview ?? []);
  const logs = deploymentLogLines([...liveLogs, ...fallbackLogs]);
  const error = card.lastError;
  const deploymentId = encodeURIComponent(card.deploymentId);
  const logsUrl = `/deployments/${deploymentId}/logs`;
  const outputReady = card.status === "ready";
  const previewUrl = outputReady ? card.url : undefined;
  const downloadUrl = outputReady ? deploymentDownloadUrl(card) : undefined;
  const imageTag = outputReady ? card.imageTag : undefined;
  const expiresLabel = outputReady && card.expiresAt !== undefined ? formatDeploymentExpiry(card.expiresAt) : undefined;
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
  const loadLogs = async () => {
    setLogsLoading(true);
    setLogsError(undefined);
    try {
      setFallbackLogs(await loadDeploymentLogFallback(csrfFetch, card.deploymentId, liveLogs));
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : String(err));
    } finally {
      setLogsLoading(false);
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
          {expiresLabel ? <p className="text-xs font-semibold text-warning-700 dark:text-warning-200">{expiresLabel}</p> : null}
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
            <details className="rounded border border-border bg-surface-secondary" open={fallbackLogs.length > 0 ? true : undefined}>
              <summary className="cursor-pointer px-2 py-1 text-xs font-semibold text-foreground">Logs</summary>
              <pre className="ah-mono max-h-32 overflow-auto p-2 text-xs">{logs.join("\n")}</pre>
            </details>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="tertiary" isPending={logsLoading} isDisabled={logsLoading} onPress={() => void loadLogs()}>View Logs</Button>
            <a className="text-xs font-semibold text-accent underline underline-offset-2" href={logsUrl}>Open full log</a>
          </div>
          {logsError ? <p className="text-xs text-danger">{logsError}</p> : null}
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
            {...deploymentActionButtonState(action, pendingAction)}
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

function initialPptPreviewState(card: ArtifactCardData): PptPreviewState {
  if (card.pptStatus !== undefined) {
    return {
      status: card.pptStatus,
      previewUrl: card.pptStatus === "ready" ? card.pptPreviewUrl : undefined
    };
  }
  if (card.pptPreviewUrl !== undefined) {
    return { status: "ready", previewUrl: card.pptPreviewUrl };
  }
  return card.kind === "presentation_pptx" ? { status: "loading" } : { status: "ready" };
}

async function startPptPreviewSession(csrfFetch: typeof fetch, artifactId: string): Promise<PptPreviewState> {
  const response = await csrfFetch(`/artifacts/${encodeURIComponent(artifactId)}/ppt-preview`, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({})) as PptPreviewStartResponse;
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  const previewUrl = typeof payload.previewUrl === "string" ? payload.previewUrl : undefined;
  if (previewUrl === undefined) throw new Error("PPT preview response did not include a previewUrl.");
  return {
    status: payload.status === "installing" ? "installing" : "ready",
    previewUrl,
    port: typeof payload.port === "number" && Number.isInteger(payload.port) ? payload.port : undefined
  };
}

async function stopPptPreviewSession(csrfFetch: typeof fetch, artifactId: string, port: number): Promise<void> {
  await csrfFetch(`/artifacts/${encodeURIComponent(artifactId)}/ppt-preview/${encodeURIComponent(String(port))}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    keepalive: true
  }).catch(() => undefined);
}

function ArtifactExpandAction({ card, csrfFetch, onReferenceArtifact, label = "Expand Preview", variant = "secondary" }: ArtifactCardProps & { readonly label?: string | undefined; readonly variant?: "primary" | "secondary" | "tertiary" | undefined }) {
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
      <Button size="sm" variant={variant} onPress={() => void openPreview()}>{label}</Button>
      <ArtifactPreviewModal
        isOpen={preview !== undefined}
        artifactId={card.artifactId}
        artifactKind={card.kind}
        kind={card.kind}
        type="file"
        name={preview?.name ?? card.title}
        mimeType={preview?.mimeType}
        sizeBytes={preview?.sizeBytes}
        previewKind={normalizePreviewKind(undefined, preview?.mimeType, preview?.name ?? card.title)}
        content={preview?.content}
        error={preview?.error}
        loading={preview?.loading}
        downloadUrl={preview ? artifactFileRawPath(card.artifactId, preview.path) : artifactDownloadUrl(card.artifactId)}
        onReferenceInChat={onReferenceArtifact}
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

export function deploymentLogLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines.flatMap((value) => value.split(/\r?\n/u))) {
    const normalized = line.trimEnd();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export async function loadDeploymentLogFallback(fetchImpl: typeof fetch, deploymentId: string, liveLines: readonly string[] = []): Promise<string[]> {
  const response = await fetchImpl(`/deployments/${encodeURIComponent(deploymentId)}/logs`, { headers: { accept: "text/plain" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return deploymentLogLines([...liveLines, await response.text()]);
}

export function deploymentActionButtonState(action: DeploymentAction, pendingAction: DeploymentAction | undefined): { readonly isPending: boolean; readonly isDisabled: boolean } {
  return {
    isPending: pendingAction === action,
    isDisabled: pendingAction !== undefined
  };
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

function pptStatusText(status: NonNullable<ArtifactCardData["pptStatus"]> | "ready", error?: string | undefined): { readonly title: string; readonly description: string } {
  if (status === "loading") {
    return {
      title: "Loading PPT preview",
      description: "Starting the read-only office preview bridge."
    };
  }
  if (status === "installing") {
    return {
      title: "Installing officecli",
      description: "AgentHub is preparing the local PPT preview dependency."
    };
  }
  if (status === "startFailed") {
    return {
      title: "Preview start failed",
      description: error ?? "officecli is installed, but the preview process could not start."
    };
  }
  if (status === "installFailed") {
    return {
      title: "Install failed",
      description: "Download the file if officecli preview cannot start."
    };
  }
  return {
    title: "PPT Preview",
    description: "The PPT preview bridge is ready."
  };
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

function formatDeploymentExpiry(expiresAt: number, now = Date.now()): string {
  const remainingMs = Math.max(0, expiresAt - now);
  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  if (remainingMinutes <= 0) return "Expires now";
  if (remainingMinutes >= 60) {
    const hours = Math.floor(remainingMinutes / 60);
    const minutes = remainingMinutes % 60;
    return minutes === 0 ? `Expires in ${hours}h` : `Expires in ${hours}h ${minutes}m`;
  }
  return `Expires in ${remainingMinutes}m`;
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

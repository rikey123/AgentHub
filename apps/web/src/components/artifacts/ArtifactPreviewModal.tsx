import { useState } from "react";
import { Button, Modal } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { extensionToLanguage, normalizePreviewKind as normalizeProtocolPreviewKind, type PreviewKind } from "@agenthub/protocol/preview";
import { formatBytes } from "../../lib/format.ts";

export type ArtifactPreviewKind = PreviewKind;

export type ArtifactPreviewModalProps = {
  readonly isOpen: boolean;
  readonly name: string;
  readonly mimeType?: string | undefined;
  readonly sizeBytes?: number | undefined;
  readonly previewKind?: string | undefined;
  readonly content?: string | undefined;
  readonly error?: string | undefined;
  readonly loading?: boolean | undefined;
  readonly downloadUrl?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly onOpenChange: (open: boolean) => void;
};

const previewTextLimit = 512 * 1024;

export function ArtifactPreviewModal(props: ArtifactPreviewModalProps) {
  const kind = normalizePreviewKind(props.previewKind, props.mimeType, props.name);
  const [sourceMode, setSourceMode] = useState(false);
  const canToggleSource = props.content !== undefined && (kind === "markdown" || kind === "code" || kind === "html");
  return (
    <Modal.Backdrop isOpen={props.isOpen} onOpenChange={props.onOpenChange}>
      <Modal.Container size="cover" className="items-center justify-center p-3">
        <Modal.Dialog aria-label="File preview" className="flex h-[min(92vh,920px)] w-[min(96vw,1180px)] max-w-[1180px] overflow-hidden p-0">
          <Modal.CloseTrigger aria-label="Close file preview" />
          <Modal.Header className="border-b border-border px-4 py-3">
            <div className="flex w-full min-w-0 flex-wrap items-start justify-between gap-3 pr-8">
              <div className="min-w-0">
                <Modal.Heading>{props.name}</Modal.Heading>
                <p className="mt-1 text-xs text-muted">
                  {labelForKind(kind)}
                  {props.sizeBytes !== undefined ? ` / ${formatBytes(props.sizeBytes)}` : ""}
                  {props.mimeType ? ` / ${props.mimeType}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {canToggleSource ? <Button size="sm" variant="secondary" onPress={() => setSourceMode((current) => !current)}>{sourceMode ? "Preview" : "Source"}</Button> : null}
                {props.downloadUrl ? <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={props.downloadUrl} target="_blank" rel="noreferrer">Open</a> : null}
                {props.downloadUrl ? <a className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold text-accent-foreground hover:opacity-90" href={downloadUrlForRawArtifact(props.downloadUrl)} download={props.name}>Download</a> : null}
              </div>
            </div>
          </Modal.Header>
          <Modal.Body className="min-h-0 overflow-auto bg-surface-secondary p-4">
            {props.loading ? (
              <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">Loading preview...</div>
            ) : props.error ? (
              <ArtifactPreviewError message={props.error} onRetry={props.onRetry} />
            ) : props.content !== undefined && props.content.length > previewTextLimit ? (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
                <p className="text-sm font-semibold">Preview is too large</p>
                <p className="mt-1 text-sm text-muted">This artifact is {formatBytes(props.content.length)}. Use Open or Download to inspect the full file.</p>
              </div>
            ) : (
              <ArtifactPreviewContent previewKind={sourceMode ? "text" : kind} content={props.content} name={props.name} downloadUrl={props.downloadUrl} />
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function ArtifactPreviewError({ message, onRetry }: { readonly message: string; readonly onRetry?: (() => void) | undefined }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
      <p>{message}</p>
      {onRetry ? <Button size="sm" variant="secondary" className="mt-3" onPress={onRetry}>Retry</Button> : null}
    </div>
  );
}

export function ArtifactPreviewContent({ previewKind, content, name, downloadUrl }: { readonly previewKind: ArtifactPreviewKind; readonly content?: string | undefined; readonly name: string; readonly downloadUrl?: string | undefined }) {
  if (previewKind === "html" && content !== undefined) {
    return <iframe title={name} sandbox="allow-scripts" srcDoc={content} className="h-[72vh] w-full rounded-lg border border-border bg-white" />;
  }
  if (previewKind === "image" && downloadUrl) {
    return <img src={downloadUrl} alt={name} className="mx-auto max-h-[72vh] max-w-full rounded-lg border border-border object-contain" />;
  }
  if (previewKind === "pdf" && downloadUrl) {
    return <iframe title={name} src={downloadUrl} className="h-[72vh] w-full rounded-lg border border-border bg-white" />;
  }
  if (previewKind === "audio" && downloadUrl) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-border bg-surface p-4">
        <audio src={downloadUrl} controls className="w-full max-w-2xl" />
      </div>
    );
  }
  if (previewKind === "video" && downloadUrl) {
    return <video src={downloadUrl} controls className="mx-auto max-h-[72vh] max-w-full rounded-lg border border-border bg-black" />;
  }
  if (previewKind === "markdown" && content !== undefined) {
    return (
      <article className="max-w-none rounded-lg border border-border bg-surface p-4 text-sm leading-6 text-foreground">
        <ReactMarkdown
          remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
          components={{
            h1: ({ children }) => <h1 className="mb-3 text-xl font-semibold">{children}</h1>,
            h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-semibold">{children}</h2>,
            h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold">{children}</h3>,
            p: ({ children }) => <p className="mb-3">{children}</p>,
            ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
            ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
            li: ({ children }) => <li>{children}</li>,
            a: ({ href, children }) => <a className="text-accent underline underline-offset-2" href={href} target="_blank" rel="noreferrer">{children}</a>,
            code: ({ className, children }) => className
              ? <code className={className}>{children}</code>
              : <code className="rounded bg-surface-secondary px-1 py-0.5 ah-mono text-[0.85em]">{children}</code>,
            pre: ({ children }) => <pre className="mb-3 overflow-auto rounded-md border border-border bg-surface-secondary p-3 ah-mono text-xs leading-5">{children}</pre>,
            blockquote: ({ children }) => <blockquote className="mb-3 border-l-4 border-border pl-3 text-muted">{children}</blockquote>,
            table: ({ children }) => <div className="mb-3 overflow-auto rounded-md border border-border"><table className="min-w-full border-collapse text-sm">{children}</table></div>,
            th: ({ children }) => <th className="border-b border-border bg-surface-secondary px-2 py-1 text-left font-semibold">{children}</th>,
            td: ({ children }) => <td className="border-t border-border px-2 py-1">{children}</td>
          }}
        >
          {content}
        </ReactMarkdown>
      </article>
    );
  }
  if ((previewKind === "text" || previewKind === "code") && content !== undefined) {
    const language = previewKind === "code" ? extensionToLanguage(name) : undefined;
    return (
      <pre className="ah-mono min-h-[240px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-4 text-xs leading-5 text-foreground" data-language={language}>
        {content}
      </pre>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-semibold">Preview is not available</p>
      <p className="mt-1 text-sm text-muted">{name} can still be downloaded or opened externally when a file URL is available.</p>
    </div>
  );
}

export function normalizePreviewKind(previewKind: string | undefined, mimeType: string | undefined, name: string): ArtifactPreviewKind {
  return normalizeProtocolPreviewKind(previewKind, mimeType, name);
}

export function downloadUrlForRawArtifact(rawUrl: string): string {
  const separator = rawUrl.includes("?") ? "&" : "?";
  return rawUrl.includes("download=1") ? rawUrl : `${rawUrl}${separator}download=1`;
}

function labelForKind(kind: ArtifactPreviewKind): string {
  if (kind === "markdown") return "Markdown";
  if (kind === "code") return "Code";
  if (kind === "html") return "HTML";
  if (kind === "image") return "Image";
  if (kind === "pdf") return "PDF";
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  if (kind === "text") return "Text";
  return "File";
}

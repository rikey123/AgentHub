import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { Button, Modal, Tabs } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { extensionToLanguage, normalizePreviewKind as normalizeProtocolPreviewKind, type PreviewKind } from "@agenthub/protocol/preview";
import { formatBytes } from "../../lib/format.ts";
import { createCsrfFetch } from "../../hooks/useSdk.ts";

export type ArtifactPreviewKind = PreviewKind;
export type ArtifactPreviewTab = "preview" | "editor" | "history" | "raw";
export type ArtifactVersionEncoding = "text" | "binary";

export type ArtifactVersionMetadata = {
  readonly filename?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly sizeBytes?: number | undefined;
  readonly newSha256?: string | undefined;
  readonly sha256?: string | undefined;
  readonly hash?: string | undefined;
  readonly downloadUrl?: string | undefined;
};

export type ArtifactVersionSummary = {
  readonly id?: string | undefined;
  readonly artifactId?: string | undefined;
  readonly version: number;
  readonly contentEncoding?: ArtifactVersionEncoding | undefined;
  readonly createdAt?: number | undefined;
  readonly createdBy?: string | undefined;
  readonly message?: string | undefined;
  readonly metadata?: ArtifactVersionMetadata | undefined;
};

type ArtifactVersionDetail = ArtifactVersionSummary & {
  readonly content?: string | undefined;
};

type ArtifactLineSelection = {
  readonly startLineNumber: number;
  readonly endLineNumber: number;
};

export type ArtifactChatReference = {
  readonly token: string;
  readonly ref:
    | { readonly type: "artifact"; readonly artifactId: string; readonly lineStart: number; readonly lineEnd: number }
    | { readonly type: "artifact"; readonly artifactId: string; readonly slide: number };
};

export type ArtifactPreviewModalProps = {
  readonly isOpen: boolean;
  readonly artifactId?: string | undefined;
  readonly type?: string | undefined;
  readonly kind?: string | undefined;
  readonly name: string;
  readonly artifactType?: string | undefined;
  readonly artifactKind?: string | undefined;
  readonly isBinary?: boolean | undefined;
  readonly mimeType?: string | undefined;
  readonly sizeBytes?: number | undefined;
  readonly binaryMetadata?: ArtifactVersionMetadata | undefined;
  readonly previewKind?: string | undefined;
  readonly content?: string | undefined;
  readonly error?: string | undefined;
  readonly loading?: boolean | undefined;
  readonly downloadUrl?: string | undefined;
  readonly csrfFetch?: typeof fetch | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly onReferenceInChat?: ((reference: ArtifactChatReference) => void | Promise<void>) | undefined;
  readonly onSaved?: ((version: ArtifactVersionSummary) => void | Promise<void>) | undefined;
  readonly onRestored?: ((version: ArtifactVersionSummary) => void | Promise<void>) | undefined;
  readonly onOpenChange: (open: boolean) => void;
};

export type ArtifactStudioContentProps = Omit<ArtifactPreviewModalProps, "isOpen" | "onOpenChange"> & {
  readonly isOpen?: boolean | undefined;
  readonly initialTab?: ArtifactPreviewTab | undefined;
};

const previewTextLimit = 512 * 1024;
const monacoCtrlCmd = 2048;
const monacoKeyS = 49;

let monacoLoaderConfigured = false;
let monacoLoaderPromise: Promise<void> | undefined;

function configureMonacoLoader(): Promise<void> {
  if (typeof window === "undefined" || monacoLoaderConfigured) return Promise.resolve();
  monacoLoaderPromise ??= import("monaco-editor").then((monaco) => {
    loader.config({ monaco });
    monacoLoaderConfigured = true;
  });
  return monacoLoaderPromise;
}

export function ArtifactPreviewModal(props: ArtifactPreviewModalProps) {
  return (
    <Modal.Backdrop isOpen={props.isOpen} onOpenChange={props.onOpenChange}>
      <Modal.Container size="cover" className="items-center justify-center p-3">
        <Modal.Dialog aria-label="产物工作台" className="flex h-[min(92vh,920px)] w-[min(96vw,1180px)] max-w-[1180px] overflow-hidden p-0">
          <Modal.CloseTrigger aria-label="关闭文件预览" />
          <ArtifactStudioContent {...props} isOpen={props.isOpen} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function ArtifactStudioContent(props: ArtifactStudioContentProps) {
  const kind = normalizePreviewKind(props.previewKind, props.mimeType, props.name);
  const artifactId = useMemo(() => props.artifactId ?? artifactIdFromUrl(props.downloadUrl), [props.artifactId, props.downloadUrl]);
  const artifactType = props.type ?? props.artifactType;
  const artifactKind = props.kind ?? props.artifactKind;
  const isBinary = props.isBinary === true || artifactKind === "presentation_pptx" || isBinaryPreview(kind, props.mimeType, props.name);
  const tabs = artifactPreviewTabsFor({
    type: artifactType,
    kind: artifactKind,
    isBinary
  });
  const [selectedTab, setSelectedTab] = useState<ArtifactPreviewTab>(props.initialTab ?? tabs[0] ?? "preview");
  const activeTab = tabs.includes(selectedTab) ? selectedTab : tabs[0] ?? "preview";
  const fetchImpl = useMemo(() => props.csrfFetch ?? createCsrfFetch(), [props.csrfFetch]);
  const [sourceMode, setSourceMode] = useState(false);
  const [currentContent, setCurrentContent] = useState(props.content);
  const [draftContent, setDraftContent] = useState(props.content ?? "");
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<ArtifactVersionSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | undefined>(undefined);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<number | undefined>(undefined);
  const [diffPreview, setDiffPreview] = useState<{ readonly fromVersion: number; readonly toVersion: number; readonly text: string } | undefined>(undefined);
  const [diffLoadingVersion, setDiffLoadingVersion] = useState<number | undefined>(undefined);
  const rawMetadata = useMemo(() => ({
    ...(props.binaryMetadata ?? {}),
    filename: props.binaryMetadata?.filename ?? props.name,
    ...(props.mimeType !== undefined ? { mimeType: props.mimeType } : {}),
    ...(props.sizeBytes !== undefined ? { sizeBytes: props.sizeBytes } : {})
  }), [props.binaryMetadata, props.mimeType, props.name, props.sizeBytes]);
  const canToggleSource = currentContent !== undefined && (kind === "markdown" || kind === "code" || kind === "html");

  const refreshVersions = async () => {
    if (artifactId === undefined) {
      setVersions([]);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(undefined);
    try {
      setVersions(await loadArtifactVersions(fetchImpl, artifactId));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const save = async () => {
    if (artifactId === undefined || isBinary) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const saved = await saveArtifactText(fetchImpl, artifactId, draftContent, saveMessage);
      setCurrentContent(draftContent);
      setSaveMessage("");
      await refreshVersions();
      await props.onSaved?.(saved);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const restore = async (version: number) => {
    if (artifactId === undefined) return;
    setRestoringVersion(version);
    setHistoryError(undefined);
    let source: ArtifactVersionDetail | undefined;
    if (!isBinary) {
      try {
        source = await loadArtifactVersion(fetchImpl, artifactId, version);
      } catch {
        source = undefined;
      }
    }
    try {
      const restored = await restoreArtifactVersion(fetchImpl, artifactId, version);
      if (source?.content !== undefined) {
        setCurrentContent(source.content);
        setDraftContent(source.content);
      } else {
        props.onRetry?.();
      }
      await refreshVersions();
      await props.onRestored?.(restored);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setRestoringVersion(undefined);
    }
  };

  const compare = async (version: number) => {
    if (artifactId === undefined || isBinary) return;
    const currentVersion = versions.reduce((max, item) => Math.max(max, item.version), version);
    setDiffLoadingVersion(version);
    setHistoryError(undefined);
    try {
      const diff = await loadArtifactVersionDiff(fetchImpl, artifactId, version, currentVersion);
      setDiffPreview({ fromVersion: version, toVersion: currentVersion, text: diff });
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiffLoadingVersion(undefined);
    }
  };

  useEffect(() => {
    setCurrentContent(props.content);
    setDraftContent(props.content ?? "");
  }, [props.content]);

  useEffect(() => {
    if (!tabs.includes(selectedTab)) setSelectedTab(tabs[0] ?? "preview");
  }, [selectedTab, tabs]);

  useEffect(() => {
    if (props.isOpen === false || artifactId === undefined) return;
    void refreshVersions();
  }, [artifactId, props.isOpen]);

  return (
    <>
      <Modal.Header className="border-b border-border px-4 py-3">
        <div className="flex w-full min-w-0 flex-wrap items-start justify-between gap-3 pr-8">
          <div className="min-w-0">
            <Modal.Heading>产物工作台</Modal.Heading>
            <p className="mt-1 truncate text-sm font-semibold text-foreground">{props.name}</p>
            <p className="mt-1 text-xs text-muted">
              {labelForKind(kind)}
              {artifactKind ? ` / ${artifactKind}` : ""}
              {props.sizeBytes !== undefined ? ` / ${formatBytes(props.sizeBytes)}` : ""}
              {props.mimeType ? ` / ${props.mimeType}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            {canToggleSource ? <Button size="sm" variant="secondary" onPress={() => setSourceMode((current) => !current)}>{sourceMode ? "预览" : "源码"}</Button> : null}
            {props.downloadUrl ? <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={props.downloadUrl} target="_blank" rel="noreferrer">打开</a> : null}
            {props.downloadUrl ? <a className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold text-accent-foreground hover:opacity-90" href={downloadUrlForRawArtifact(props.downloadUrl)} download={props.name}>下载</a> : null}
          </div>
        </div>
      </Modal.Header>
      <Modal.Body className="min-h-0 overflow-hidden bg-surface-secondary p-0">
        <Tabs selectedKey={activeTab} onSelectionChange={(key) => setSelectedTab(String(key) as ArtifactPreviewTab)} className="flex h-full min-h-0 flex-col">
          <Tabs.ListContainer className="border-b border-border bg-surface px-4">
            <Tabs.List aria-label="产物工作台标签页">
              {tabs.map((tab, index) => (
                <Tabs.Tab key={tab} id={tab} data-testid={`artifact-studio-tab-${tab}`}>
                  {index > 0 ? <Tabs.Separator /> : null}
                  {artifactTabLabel(tab)}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <Tabs.Panel id="preview">
              <ArtifactStudioPreviewPanel {...props} content={currentContent} previewKind={sourceMode ? "text" : kind} />
            </Tabs.Panel>
            {tabs.includes("editor") ? (
              <Tabs.Panel id="editor">
                <ArtifactStudioEditorPanel
                  artifactId={artifactId}
                  content={draftContent}
                  error={saveError}
                  isDirty={draftContent !== (currentContent ?? "")}
                  isSaving={saving}
                  message={saveMessage}
                  name={props.name}
                  onContentChange={setDraftContent}
                  onMessageChange={setSaveMessage}
                  onReferenceInChat={props.onReferenceInChat}
                  onSave={() => void save()}
                />
              </Tabs.Panel>
            ) : null}
            <Tabs.Panel id="history">
              <ArtifactHistoryList
                artifactId={artifactId}
                downloadUrl={props.downloadUrl}
                diffPreview={diffPreview}
                error={historyError}
                fallbackMetadata={rawMetadata}
                isBinary={isBinary}
                loading={historyLoading}
                comparingVersion={diffLoadingVersion}
                restoringVersion={restoringVersion}
                versions={versions}
                onCompare={(version) => void compare(version)}
                onRestore={(version) => void restore(version)}
              />
            </Tabs.Panel>
            <Tabs.Panel id="raw">
              <ArtifactRawView
                content={currentContent}
                downloadUrl={props.downloadUrl}
                isBinary={isBinary}
                metadata={rawMetadata}
                name={props.name}
                sizeBytes={props.sizeBytes}
              />
            </Tabs.Panel>
          </div>
        </Tabs>
      </Modal.Body>
    </>
  );
}

export function ArtifactPreviewError({ message, onRetry }: { readonly message: string; readonly onRetry?: (() => void) | undefined }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
      <p>{message}</p>
      {onRetry ? <Button size="sm" variant="secondary" className="mt-3" onPress={onRetry}>重试</Button> : null}
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
      <p className="text-sm font-semibold">暂时无法预览</p>
      <p className="mt-1 text-sm text-muted">如果文件 URL 可用，仍可下载或在外部打开 {name}。</p>
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

export function artifactPreviewTabsFor(input: { readonly type?: string | undefined; readonly kind?: string | undefined; readonly isBinary?: boolean | undefined }): ArtifactPreviewTab[] {
  const readonlyTypes = new Set(["diff", "worktree_diff", "terminal"]);
  const hideEditor = readonlyTypes.has(input.type ?? "") || input.isBinary === true || input.kind === "presentation_pptx";
  return hideEditor ? ["preview", "history", "raw"] : ["preview", "editor", "history", "raw"];
}

function ArtifactStudioPreviewPanel(props: ArtifactStudioContentProps & { readonly previewKind: ArtifactPreviewKind }) {
  if (props.loading) {
    return <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">正在加载预览...</div>;
  }
  if (props.error) {
    return <ArtifactPreviewError message={props.error} onRetry={props.onRetry} />;
  }
  if (props.content !== undefined && props.content.length > previewTextLimit) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
        <p className="text-sm font-semibold">预览内容过大</p>
        <p className="mt-1 text-sm text-muted">此产物大小为 {formatBytes(props.content.length)}。可使用“打开”或“下载”查看完整文件。</p>
      </div>
    );
  }
  return <ArtifactPreviewContent previewKind={props.previewKind} content={props.content} name={props.name} downloadUrl={props.downloadUrl} />;
}

function ArtifactStudioEditorPanel(props: {
  readonly artifactId?: string | undefined;
  readonly content: string;
  readonly error?: string | undefined;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly message: string;
  readonly name: string;
  readonly onContentChange: (value: string) => void;
  readonly onMessageChange: (value: string) => void;
  readonly onReferenceInChat?: ((reference: ArtifactChatReference) => void | Promise<void>) | undefined;
  readonly onSave: () => void;
}) {
  const latestSaveRef = useRef(props.onSave);
  const [monacoReady, setMonacoReady] = useState(() => typeof window !== "undefined" && monacoLoaderConfigured);
  const [selection, setSelection] = useState<ArtifactLineSelection>({ startLineNumber: 1, endLineNumber: 1 });

  useEffect(() => {
    latestSaveRef.current = props.onSave;
  }, [props.onSave]);

  useEffect(() => {
    let cancelled = false;
    void configureMonacoLoader().then(() => {
      if (!cancelled) setMonacoReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isArtifactSaveShortcut(event)) {
      event.preventDefault();
      latestSaveRef.current();
    }
  };
  const language = extensionToLanguage(props.name) ?? "plaintext";
  const reference = props.artifactId !== undefined ? artifactChatReferenceForLineSelection(props.artifactId, selection) : undefined;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Monaco 编辑器</p>
          <p className="text-xs text-muted">语言：{language}</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            isDisabled={reference === undefined || props.onReferenceInChat === undefined}
            onPress={() => { if (reference !== undefined) void props.onReferenceInChat?.(reference); }}
            data-reference-token={reference?.token}
          >
            引用到聊天
          </Button>
          <Button size="sm" variant="primary" isPending={props.isSaving} isDisabled={props.artifactId === undefined || !props.isDirty || props.isSaving} onPress={props.onSave}>保存</Button>
        </div>
      </div>
      <div data-testid="artifact-monaco-editor" className="min-h-[52vh] overflow-hidden rounded-lg border border-border bg-surface" onKeyDown={handleKeyDown}>
        {monacoReady ? (
          <Editor
            height="52vh"
            language={language}
            theme="vs-dark"
            value={props.content}
            options={{ automaticLayout: true, fontSize: 12, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on" }}
            onChange={(value) => props.onContentChange(value ?? "")}
            onMount={(editor) => {
              editor.addCommand(monacoCtrlCmd | monacoKeyS, () => latestSaveRef.current());
              editor.onDidChangeCursorSelection?.((event: { readonly selection: ArtifactLineSelection }) => {
                setSelection(event.selection);
              });
            }}
          />
        ) : (
          <div className="flex h-[52vh] items-center justify-center text-sm text-muted">正在加载...</div>
        )}
      </div>
      <label className="grid gap-1 text-xs font-semibold text-muted">
        保存说明
        <input
          className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm font-normal text-foreground"
          value={props.message}
          onChange={(event) => props.onMessageChange(event.currentTarget.value)}
          placeholder="描述这个版本"
        />
      </label>
      {props.artifactId === undefined ? <p className="text-xs text-warning-700 dark:text-warning-200">此预览没有暴露 artifact id，暂时无法保存。</p> : null}
      {props.error ? <p className="text-xs text-danger">{props.error}</p> : null}
    </div>
  );
}

export function ArtifactHistoryList(props: {
  readonly artifactId?: string | undefined;
  readonly comparingVersion?: number | undefined;
  readonly diffPreview?: { readonly fromVersion: number; readonly toVersion: number; readonly text: string } | undefined;
  readonly downloadUrl?: string | undefined;
  readonly error?: string | undefined;
  readonly fallbackMetadata?: ArtifactVersionMetadata | undefined;
  readonly isBinary: boolean;
  readonly loading?: boolean | undefined;
  readonly restoringVersion?: number | undefined;
  readonly versions: readonly ArtifactVersionSummary[];
  readonly onCompare: (version: number) => void;
  readonly onRestore: (version: number) => void;
}) {
  if (props.artifactId === undefined) {
    return <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">此预览暂时没有版本历史。</div>;
  }
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">历史版本</p>
          <p className="text-xs text-muted">{props.isBinary ? "二进制元数据版本" : "文本产物版本"}</p>
        </div>
        {props.loading ? <span className="text-xs text-muted">正在加载版本...</span> : null}
      </div>
      {props.error ? <p className="rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{props.error}</p> : null}
      {props.versions.length === 0 && !props.loading ? (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">还没有记录版本。</div>
      ) : null}
      <ol className="grid gap-2">
        {props.versions.map((version) => {
          const metadata = props.isBinary ? { ...(props.fallbackMetadata ?? {}), ...(version.metadata ?? {}) } : version.metadata;
          return (
            <li key={`${version.version}-${version.id ?? ""}`} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ah-mono text-sm font-semibold">v{version.version}</span>
                    {version.contentEncoding ? <span className="rounded bg-surface-secondary px-2 py-0.5 text-xs text-muted">{version.contentEncoding}</span> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {version.createdBy ?? "未知"}
                    {version.createdAt !== undefined ? ` / ${new Date(version.createdAt).toLocaleString()}` : ""}
                  </p>
                  {version.message ? <p className="mt-1 text-sm text-foreground">{version.message}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {props.isBinary && props.downloadUrl ? <a className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary" href={downloadUrlForRawArtifact(metadata?.downloadUrl ?? props.downloadUrl)} download={metadata?.filename}>下载</a> : null}
                  {!props.isBinary ? <Button size="sm" variant="tertiary" isPending={props.comparingVersion === version.version} isDisabled={props.comparingVersion !== undefined || props.restoringVersion !== undefined} onPress={() => props.onCompare(version.version)}>对比</Button> : null}
                  <Button size="sm" variant="secondary" isPending={props.restoringVersion === version.version} isDisabled={props.restoringVersion !== undefined} onPress={() => props.onRestore(version.version)}>恢复</Button>
                </div>
              </div>
              {props.isBinary && metadata !== undefined ? <BinaryMetadataGrid metadata={metadata} /> : null}
            </li>
          );
        })}
      </ol>
      {!props.isBinary && props.diffPreview !== undefined ? (
        <section aria-label="版本差异" className="grid gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">差异 v{props.diffPreview.fromVersion} {"->"} v{props.diffPreview.toVersion}</p>
          </div>
          <pre className="max-h-72 overflow-auto rounded-md bg-surface-secondary p-3 text-xs text-foreground">{props.diffPreview.text}</pre>
        </section>
      ) : null}
    </section>
  );
}

export function ArtifactRawView(props: {
  readonly content?: string | undefined;
  readonly downloadUrl?: string | undefined;
  readonly isBinary: boolean;
  readonly metadata?: ArtifactVersionMetadata | undefined;
  readonly name: string;
  readonly sizeBytes?: number | undefined;
}) {
  const metadata = {
    ...(props.metadata ?? {}),
    filename: props.metadata?.filename ?? props.name,
    ...(props.sizeBytes !== undefined ? { sizeBytes: props.metadata?.sizeBytes ?? props.sizeBytes } : {})
  };
  if (props.isBinary) {
    return (
      <section className="grid gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">二进制元数据</p>
            <p className="text-xs text-muted">二进制内容不可作为文本编辑，原始视图仅展示元数据。</p>
          </div>
          {props.downloadUrl ? <a className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold text-accent-foreground hover:opacity-90" href={downloadUrlForRawArtifact(props.downloadUrl)} download={metadata.filename}>下载</a> : null}
        </div>
        <BinaryMetadataGrid metadata={metadata} />
      </section>
    );
  }
  if (props.content !== undefined) {
    return (
      <pre className="ah-mono min-h-[240px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-4 text-xs leading-5 text-foreground">
        {props.content}
      </pre>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-semibold">原始内容不可用</p>
      {props.downloadUrl ? <a className="mt-3 inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold text-accent-foreground hover:opacity-90" href={downloadUrlForRawArtifact(props.downloadUrl)} download={props.name}>下载</a> : null}
    </div>
  );
}

function BinaryMetadataGrid({ metadata }: { readonly metadata: ArtifactVersionMetadata }) {
  const hash = metadata.newSha256 ?? metadata.sha256 ?? metadata.hash;
  return (
    <dl className="mt-3 grid gap-2 rounded border border-border bg-surface-secondary p-3 text-xs sm:grid-cols-2">
      <MetadataItem label="文件名" value={metadata.filename} />
      <MetadataItem label="MIME 类型" value={metadata.mimeType} />
      <MetadataItem label="大小" value={metadata.sizeBytes !== undefined ? formatBinarySize(metadata.sizeBytes) : undefined} />
      <MetadataItem label="哈希" value={hash} />
    </dl>
  );
}

function MetadataItem({ label, value }: { readonly label: string; readonly value?: string | undefined }) {
  if (value === undefined || value.length === 0) return null;
  return (
    <div className="min-w-0">
      <dt className="font-semibold uppercase text-muted">{label}</dt>
      <dd className="ah-mono mt-0.5 break-all text-foreground">{value}</dd>
    </div>
  );
}

function artifactTabLabel(tab: ArtifactPreviewTab): string {
  if (tab === "preview") return "预览";
  if (tab === "editor") return "编辑器";
  if (tab === "history") return "历史";
  return "原始";
}

export function artifactVersionListPath(artifactId: string): string {
  return `/artifacts/${encodeURIComponent(artifactId)}/versions`;
}

export function artifactVersionReadPath(artifactId: string, version: number): string {
  return `${artifactVersionListPath(artifactId)}/${encodeURIComponent(String(version))}`;
}

export function artifactVersionDiffPath(artifactId: string, fromVersion: number, toVersion: number): string {
  return `${artifactVersionReadPath(artifactId, fromVersion)}/diff/${encodeURIComponent(String(toVersion))}`;
}

export function artifactVersionRestorePath(artifactId: string, version: number): string {
  return `${artifactVersionReadPath(artifactId, version)}/restore`;
}

export function artifactTextSaveRequest(artifactId: string, content: string, message?: string | undefined): { readonly path: string; readonly init: RequestInit } {
  const trimmedMessage = message?.trim();
  return {
    path: `/artifacts/${encodeURIComponent(artifactId)}`,
    init: {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content,
        ...(trimmedMessage ? { message: trimmedMessage } : {})
      })
    }
  };
}

export async function saveArtifactText(fetchImpl: typeof fetch, artifactId: string, content: string, message?: string | undefined): Promise<ArtifactVersionSummary> {
  const request = artifactTextSaveRequest(artifactId, content, message);
  const response = await fetchImpl(request.path, request.init);
  if (!response.ok) throw new Error(`save ${response.status}`);
  const payload = await response.json() as { readonly version?: unknown };
  const version = normalizeArtifactVersion(payload.version);
  if (version === undefined) throw new Error("save response missing version");
  return version;
}

export async function restoreArtifactVersion(fetchImpl: typeof fetch, artifactId: string, version: number): Promise<ArtifactVersionSummary> {
  const response = await fetchImpl(artifactVersionRestorePath(artifactId, version), { method: "POST" });
  if (!response.ok) throw new Error(`restore ${response.status}`);
  const payload = await response.json() as { readonly version?: unknown };
  const restored = normalizeArtifactVersion(payload.version);
  if (restored === undefined) throw new Error("restore response missing version");
  return restored;
}

export async function loadArtifactVersions(fetchImpl: typeof fetch, artifactId: string): Promise<ArtifactVersionSummary[]> {
  const response = await fetchImpl(artifactVersionListPath(artifactId));
  if (!response.ok) throw new Error(`versions ${response.status}`);
  const versions = normalizeArtifactVersions(await response.json());
  return await Promise.all(versions.map((version) => enrichBinaryVersionMetadata(fetchImpl, artifactId, version)));
}

export async function loadArtifactVersionDiff(fetchImpl: typeof fetch, artifactId: string, fromVersion: number, toVersion: number): Promise<string> {
  const response = await fetchImpl(artifactVersionDiffPath(artifactId, fromVersion, toVersion));
  if (!response.ok) throw new Error(`diff failed: HTTP ${response.status}`);
  return response.text();
}

async function loadArtifactVersion(fetchImpl: typeof fetch, artifactId: string, version: number): Promise<ArtifactVersionDetail> {
  const response = await fetchImpl(artifactVersionReadPath(artifactId, version));
  if (!response.ok) throw new Error(`version ${response.status}`);
  const payload = await response.json() as { readonly version?: unknown };
  const normalized = normalizeArtifactVersion(payload.version);
  if (normalized === undefined) throw new Error("version response missing version");
  const detail = isRecord(payload.version) ? payload.version : {};
  return {
    ...normalized,
    ...(typeof detail.content === "string" ? { content: detail.content } : {})
  };
}

export function normalizeArtifactVersions(payload: unknown): ArtifactVersionSummary[] {
  const versions = isRecord(payload) && Array.isArray(payload.versions) ? payload.versions : [];
  return versions.map(normalizeArtifactVersion).filter((version): version is ArtifactVersionSummary => version !== undefined);
}

async function enrichBinaryVersionMetadata(fetchImpl: typeof fetch, artifactId: string, version: ArtifactVersionSummary): Promise<ArtifactVersionSummary> {
  if (version.contentEncoding !== "binary" || version.metadata !== undefined) return version;
  try {
    const response = await fetchImpl(artifactVersionDiffPath(artifactId, version.version, version.version));
    if (!response.ok) return version;
    const diff = parseJson(await response.text());
    if (!isRecord(diff) || diff.type !== "binary") return version;
    const metadata = normalizeVersionMetadata(diff.to) ?? normalizeVersionMetadata(diff.from);
    return metadata !== undefined ? { ...version, metadata } : version;
  } catch {
    return version;
  }
}

function normalizeArtifactVersion(payload: unknown): ArtifactVersionSummary | undefined {
  if (!isRecord(payload)) return undefined;
  const version = numberField(payload.version);
  if (version === undefined) return undefined;
  const artifactId = stringField(payload.artifactId) ?? stringField(payload.artifact_id);
  const contentEncoding = normalizeEncoding(payload.contentEncoding ?? payload.content_encoding);
  const createdAt = numberField(payload.createdAt ?? payload.created_at);
  const createdBy = stringField(payload.createdBy ?? payload.created_by);
  const metadata = normalizeVersionMetadata(payload.metadata);
  return {
    ...(stringField(payload.id) !== undefined ? { id: stringField(payload.id) } : {}),
    ...(artifactId !== undefined ? { artifactId } : {}),
    version,
    ...(contentEncoding !== undefined ? { contentEncoding } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(createdBy !== undefined ? { createdBy } : {}),
    ...(stringField(payload.message) !== undefined ? { message: stringField(payload.message) } : {}),
    ...(metadata !== undefined ? { metadata } : {})
  };
}

function normalizeVersionMetadata(value: unknown): ArtifactVersionMetadata | undefined {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!isRecord(parsed)) return undefined;
  const metadata: ArtifactVersionMetadata = {
    ...(stringField(parsed.filename ?? parsed.path) !== undefined ? { filename: stringField(parsed.filename ?? parsed.path) } : {}),
    ...(stringField(parsed.mimeType ?? parsed.mime_type) !== undefined ? { mimeType: stringField(parsed.mimeType ?? parsed.mime_type) } : {}),
    ...(numberField(parsed.sizeBytes ?? parsed.size_bytes) !== undefined ? { sizeBytes: numberField(parsed.sizeBytes ?? parsed.size_bytes) } : {}),
    ...(stringField(parsed.newSha256 ?? parsed.new_sha256) !== undefined ? { newSha256: stringField(parsed.newSha256 ?? parsed.new_sha256) } : {}),
    ...(stringField(parsed.sha256) !== undefined ? { sha256: stringField(parsed.sha256) } : {}),
    ...(stringField(parsed.hash) !== undefined ? { hash: stringField(parsed.hash) } : {}),
    ...(stringField(parsed.downloadUrl ?? parsed.download_url) !== undefined ? { downloadUrl: stringField(parsed.downloadUrl ?? parsed.download_url) } : {})
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function artifactIdFromUrl(rawUrl: string | undefined): string | undefined {
  if (rawUrl === undefined) return undefined;
  const match = /^\/artifacts\/([^/?#]+)/u.exec(rawUrl);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : undefined;
}

export function isArtifactSaveShortcut(input: { readonly ctrlKey?: boolean | undefined; readonly metaKey?: boolean | undefined; readonly key: string }): boolean {
  return (input.ctrlKey === true || input.metaKey === true) && input.key.toLowerCase() === "s";
}

export function artifactChatReferenceForLineSelection(artifactId: string, selection: ArtifactLineSelection): ArtifactChatReference {
  const lineStart = Math.max(1, Math.min(selection.startLineNumber, selection.endLineNumber));
  const lineEnd = Math.max(lineStart, Math.max(selection.startLineNumber, selection.endLineNumber));
  return {
    token: `@artifact:${artifactId}#L${lineStart}-L${lineEnd}`,
    ref: { type: "artifact", artifactId, lineStart, lineEnd }
  };
}

export function artifactChatReferenceForSlide(artifactId: string, slide: number): ArtifactChatReference {
  const safeSlide = Math.max(1, Math.floor(slide));
  return {
    token: `@artifact:${artifactId}#slide=${safeSlide}`,
    ref: { type: "artifact", artifactId, slide: safeSlide }
  };
}

function isBinaryPreview(kind: ArtifactPreviewKind, mimeType: string | undefined, name: string): boolean {
  if (isBinaryFilename(name)) return true;
  if (kind === "image" || kind === "pdf" || kind === "audio" || kind === "video" || kind === "download") return true;
  if (mimeType !== undefined && !mimeType.startsWith("text/") && mimeType !== "application/json") return true;
  return false;
}

function isBinaryFilename(name: string): boolean {
  return /\.(pptx?|odp)$/iu.test(name);
}

function normalizeEncoding(value: unknown): ArtifactVersionEncoding | undefined {
  return value === "text" || value === "binary" ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function formatBinarySize(bytes: number): string {
  return formatBytes(bytes);
}

function labelForKind(kind: ArtifactPreviewKind): string {
  if (kind === "markdown") return "Markdown";
  if (kind === "code") return "代码";
  if (kind === "html") return "HTML";
  if (kind === "image") return "图片";
  if (kind === "pdf") return "PDF";
  if (kind === "audio") return "音频";
  if (kind === "video") return "视频";
  if (kind === "text") return "文本";
  return "文件";
}

import { useEffect, useState } from "react";
import { Card, Chip, Spinner } from "@heroui/react";
import { artifactContentTypeFor } from "@agenthub/protocol/preview";
import { CardRenderer } from "../../cards/CardRenderer.tsx";
import { TerminalCard } from "../../cards/TerminalCard.tsx";
import { DiffReviewViewer, type DiffLineSelection, type DiffReviewComment, type ReviewFile } from "../../artifacts/DiffReviewViewer.tsx";
import { ArtifactPreviewModal, normalizePreviewKind } from "../../artifacts/ArtifactPreviewModal.tsx";
import type { RoomViewModel } from "../../../types.ts";

interface ArtifactsTabProps {
  room: RoomViewModel;
  runId: string;
  csrfFetch: typeof fetch;
}

export type ArtifactSummary = {
  id: string;
  type: string;
  title: string;
  status: string;
  runId?: string | undefined;
  taskId?: string | undefined;
  createdBy?: string | undefined;
  createdAt?: number | undefined;
  archivedAt?: number | undefined;
  deletedAt?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
};

type ArtifactReviewSummary = {
  readonly id: string;
  readonly artifactId: string;
  readonly decision: string;
  readonly reviewerKind: string;
  readonly reviewerId: string;
  readonly reason?: string | undefined;
  readonly filePath?: string | undefined;
  readonly lineNumber?: number | undefined;
  readonly lineStart?: number | undefined;
  readonly lineEnd?: number | undefined;
  readonly side?: "old" | "new" | undefined;
  readonly status?: "open" | "resolved" | "deleted" | undefined;
  readonly createdAt: number;
};

export type ArtifactWorkspaceFilters = {
  readonly type: string;
  readonly status: string;
  readonly runId: string;
  readonly taskId: string;
  readonly createdBy: string;
};

type TerminalLine = { stream: "stdout" | "stderr"; text: string };

type TerminalState = {
  lines: TerminalLine[];
  exitCode: number | null;
};

type ArtifactPreviewState = { readonly artifactId: string; readonly path: string; readonly name: string; readonly content?: string | undefined; readonly error?: string | undefined; readonly loading?: boolean | undefined; readonly mimeType?: string | undefined; readonly sizeBytes?: number | undefined };
export type ArtifactPreviewTab = Pick<ArtifactPreviewState, "artifactId" | "path" | "name">;
type SetArtifactPreviewTabs = (updater: (prev: ArtifactPreviewTab[]) => ArtifactPreviewTab[]) => void;

export function ArtifactsTab({ room, runId, csrfFetch }: ArtifactsTabProps) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [terminalById, setTerminalById] = useState<Record<string, TerminalState>>({});
  const [filesByArtifactId, setFilesByArtifactId] = useState<Record<string, ReviewFile[]>>({});
  const [reviewsByArtifactId, setReviewsByArtifactId] = useState<Record<string, ArtifactReviewSummary[]>>({});
  const [selectedLineByArtifactId, setSelectedLineByArtifactId] = useState<Record<string, DiffLineSelection | undefined>>({});
  const [focusedReviewId, setFocusedReviewId] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<ArtifactPreviewState | undefined>(undefined);
  const [previewTabs, setPreviewTabs] = useState<ArtifactPreviewTab[]>([]);
  const [filters, setFilters] = useState<ArtifactWorkspaceFilters>({ type: "all", status: "all", runId, taskId: "all", createdBy: "all" });

  useEffect(() => {
    setLoading(true);
    csrfFetch(`/artifacts?roomId=${encodeURIComponent(room.id)}`)
      .then((response) => response.json())
      .then((data: { artifacts?: ArtifactSummary[] }) => setArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [room.id, csrfFetch]);

  useEffect(() => {
    setFilters((current) => ({ ...current, runId }));
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    for (const terminal of artifacts.filter((artifact) => artifact.type === "terminal")) {
      if (terminalById[terminal.id]) continue;
      void loadTerminalState(terminal, csrfFetch)
        .then((state) => {
          if (!cancelled) setTerminalById((prev) => ({ ...prev, [terminal.id]: state }));
        })
        .catch(() => {
          if (!cancelled) setTerminalById((prev) => ({ ...prev, [terminal.id]: metadataTerminalState(terminal.metadata) }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [artifacts, csrfFetch, terminalById]);

  useEffect(() => {
    let cancelled = false;
    for (const artifact of artifacts.filter(isCodeChangeArtifact)) {
      if (!filesByArtifactId[artifact.id]) {
        void csrfFetch(`/artifacts/${encodeURIComponent(artifact.id)}/files`)
          .then(async (response) => {
            if (!response.ok) throw new Error(`files ${response.status}`);
            return response.json() as Promise<{ readonly files?: ReviewFile[] }>;
          })
          .then((payload) => {
            if (!cancelled) setFilesByArtifactId((prev) => ({ ...prev, [artifact.id]: Array.isArray(payload.files) ? payload.files : [] }));
          })
          .catch(() => {
            if (!cancelled) setFilesByArtifactId((prev) => ({ ...prev, [artifact.id]: [] }));
          });
      }
      if (!reviewsByArtifactId[artifact.id]) {
        void csrfFetch(`/artifacts/${encodeURIComponent(artifact.id)}/reviews`)
          .then(async (response) => {
            if (!response.ok) throw new Error(`reviews ${response.status}`);
            return response.json() as Promise<{ readonly reviews?: ArtifactReviewSummary[] }>;
          })
          .then((payload) => {
            if (!cancelled) setReviewsByArtifactId((prev) => ({ ...prev, [artifact.id]: Array.isArray(payload.reviews) ? payload.reviews : [] }));
          })
          .catch(() => {
            if (!cancelled) setReviewsByArtifactId((prev) => ({ ...prev, [artifact.id]: [] }));
          });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [artifacts, csrfFetch, filesByArtifactId, reviewsByArtifactId]);

  const messages = room.messages.filter((message) => message.runId === runId);
  const cardArtifacts = messages.flatMap((message) =>
    message.parts
      .map((part, index) => ({ id: `${message.id}-${index}`, part }))
      .filter(({ part }) => part.type === "card" && (part.card.type === "diff" || part.card.type === "preview"))
  );
  const filteredArtifacts = filterArtifactsForWorkspace(artifacts, filters);
  const terminals = filteredArtifacts.filter((artifact) => artifact.type === "terminal");
  const codeChanges = filteredArtifacts.filter(isCodeChangeArtifact);
  const otherArtifacts = filteredArtifacts.filter((artifact) => !isCodeChangeArtifact(artifact) && artifact.type !== "terminal");
  const hasVisibleArtifacts = cardArtifacts.length > 0 || terminals.length > 0 || codeChanges.length > 0 || otherArtifacts.length > 0;
  const openFilePreview = (artifactId: string, path: string) => openArtifactFilePreview(artifactId, path, csrfFetch, setPreview, setPreviewTabs);

  return (
    <div className="flex flex-col gap-3 p-3">
      {loading ? <div className="flex items-center gap-2"><Spinner size="sm" /><span className="text-sm">正在加载产物...</span></div> : null}
      {error ? <Chip size="sm" color="danger" variant="soft">{error}</Chip> : null}
      <ArtifactWorkspaceFiltersBar artifacts={artifacts} filters={filters} onChange={setFilters} currentRunId={runId} />
      <ArtifactPreviewTabs
        tabs={previewTabs}
        active={preview}
        onOpen={(tab) => openFilePreview(tab.artifactId, tab.path)}
        onClose={(tab) => {
          setPreviewTabs((current) => current.filter((item) => artifactPreviewTabKey(item) !== artifactPreviewTabKey(tab)));
          if (preview && artifactPreviewTabKey(preview) === artifactPreviewTabKey(tab)) setPreview(undefined);
        }}
      />
      {!hasVisibleArtifacts && !loading ? <p className="text-sm text-muted">没有符合筛选条件的产物。</p> : null}

      {cardArtifacts.map(({ id, part }) =>
        part.type === "card" ? <CardRenderer key={id} card={part.card} csrfFetch={csrfFetch} /> : null
      )}

      {codeChanges.length > 0 ? (
        <Card variant="transparent" className="border border-border">
          <Card.Header>
            <Card.Title className="text-sm">代码变更</Card.Title>
          </Card.Header>
          <Card.Content>
            <div className="flex flex-col gap-3">
              {codeChanges.map((artifact) => {
                const reviews = reviewsByArtifactId[artifact.id] ?? [];
                const files = filesByArtifactId[artifact.id] ?? [];
                return (
                  <div key={artifact.id} id={`artifact-${encodeURIComponent(artifact.id)}`} className="rounded-lg border border-border bg-surface px-3 py-3">
                    <ArtifactHeader artifact={artifact} csrfFetch={csrfFetch} onArtifactChanged={(next) => setArtifacts((prev) => prev.map((item) => item.id === artifact.id ? { ...item, ...next } : item).filter((item) => item.deletedAt === undefined))} />
                    <div className="mt-2">
                      <DiffReviewViewer
                        artifactId={artifact.id}
                        files={files}
                        comments={reviews}
                        compact
                        focusedCommentId={focusedReviewId}
                        onLineSelect={(selection) => setSelectedLineByArtifactId((prev) => ({ ...prev, [artifact.id]: selection }))}
                        onViewFile={(file) => openFilePreview(artifact.id, file.path)}
                        onEditComment={(comment) => editReviewComment(artifact.id, comment, csrfFetch, setReviewsByArtifactId)}
                        onResolveComment={(comment) => updateReviewStatus(artifact.id, comment, "resolve", csrfFetch, setReviewsByArtifactId)}
                        onDeleteComment={(comment) => updateReviewStatus(artifact.id, comment, "delete", csrfFetch, setReviewsByArtifactId)}
                      />
                    </div>
                    <ArtifactReviewTools artifactId={artifact.id} files={files} selectedLine={selectedLineByArtifactId[artifact.id]} csrfFetch={csrfFetch} onReviewAdded={(review) => setReviewsByArtifactId((prev) => ({ ...prev, [artifact.id]: [...(prev[artifact.id] ?? []), review] }))} />
                    <ArtifactReviewTimeline reviews={reviews} onFocus={setFocusedReviewId} onResolve={(review) => updateReviewStatus(artifact.id, review, "resolve", csrfFetch, setReviewsByArtifactId)} onDelete={(review) => updateReviewStatus(artifact.id, review, "delete", csrfFetch, setReviewsByArtifactId)} />
                  </div>
                );
              })}
            </div>
          </Card.Content>
        </Card>
      ) : null}

      {terminals.map((terminal) => {
        const state = terminalById[terminal.id];
        return (
          <TerminalCard
            key={terminal.id}
            artifactId={terminal.id}
            title={terminal.title || "终端"}
            lines={state?.lines ?? []}
            exitCode={state?.exitCode ?? null}
          />
        );
      })}

      {otherArtifacts.length > 0 ? (
        <Card variant="transparent" className="border border-border">
          <Card.Header>
            <Card.Title className="text-sm">其他产物</Card.Title>
          </Card.Header>
          <Card.Content>
            <ul className="flex flex-col gap-1">
              {otherArtifacts.map((artifact) => (
                <li key={artifact.id} className="flex items-center gap-2 text-sm">
                  <Chip size="sm" variant="soft" color="default">{artifact.type}</Chip>
                  <span className="flex-1 truncate">{artifact.title}</span>
                  <span className="text-xs text-muted">{artifact.status}</span>
                  {(artifact.type === "file" || artifact.type === "document" || artifact.type === "preview") ? (
                    <button
                      type="button"
                      className="rounded-full bg-accent-soft px-2 py-1 text-xs font-semibold text-accent-soft-foreground"
                      onClick={() => openArtifactPreview(artifact, csrfFetch, setPreview, setPreviewTabs)}
                    >
                      预览
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      ) : null}

      <ArtifactPreviewModal
        isOpen={preview !== undefined}
        name={preview?.name ?? "产物"}
        mimeType={preview?.mimeType}
        sizeBytes={preview?.sizeBytes}
        previewKind={normalizePreviewKind(undefined, preview?.mimeType, preview?.name ?? "artifact.txt")}
        content={preview?.content}
        error={preview?.error}
        loading={preview?.loading}
        downloadUrl={preview ? artifactFilePreviewRequest(preview.artifactId, preview.path).rawUrl : undefined}
        onRetry={preview ? () => openFilePreview(preview.artifactId, preview.path) : undefined}
        onOpenChange={(open) => { if (!open) setPreview(undefined); }}
      />
    </div>
  );
}

export function filterArtifactsForWorkspace(artifacts: readonly ArtifactSummary[], filters: ArtifactWorkspaceFilters): ArtifactSummary[] {
  return artifacts.filter((artifact) =>
    artifact.deletedAt === undefined &&
    (filters.type === "all" || artifact.type === filters.type) &&
    (filters.status === "all" || artifact.status === filters.status) &&
    (filters.runId === "all" || artifact.runId === filters.runId) &&
    (filters.taskId === "all" || artifact.taskId === filters.taskId) &&
    (filters.createdBy === "all" || artifact.createdBy === filters.createdBy)
  );
}

function ArtifactWorkspaceFiltersBar({ artifacts, filters, onChange, currentRunId }: { readonly artifacts: readonly ArtifactSummary[]; readonly filters: ArtifactWorkspaceFilters; readonly onChange: (filters: ArtifactWorkspaceFilters) => void; readonly currentRunId: string }) {
  const typeOptions = uniqueOptionValues(artifacts.map((artifact) => artifact.type));
  const statusOptions = uniqueOptionValues(artifacts.map((artifact) => artifact.status));
  const runOptions = uniqueOptionValues(artifacts.map((artifact) => artifact.runId).filter((value): value is string => typeof value === "string" && value.length > 0));
  const taskOptions = uniqueOptionValues(artifacts.map((artifact) => artifact.taskId).filter((value): value is string => typeof value === "string" && value.length > 0));
  const authorOptions = uniqueOptionValues(artifacts.map((artifact) => artifact.createdBy).filter((value): value is string => typeof value === "string" && value.length > 0));
  const update = (patch: Partial<ArtifactWorkspaceFilters>) => onChange({ ...filters, ...patch });
  return (
    <Card variant="transparent" className="border border-border">
      <Card.Content className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-5">
        <FilterSelect label="类型" value={filters.type} options={typeOptions} onChange={(type) => update({ type })} />
        <FilterSelect label="状态" value={filters.status} options={statusOptions} onChange={(status) => update({ status })} />
        <FilterSelect label="运行" value={filters.runId} options={[currentRunId, ...runOptions.filter((value) => value !== currentRunId)]} allLabel="全部运行" onChange={(nextRunId) => update({ runId: nextRunId })} />
        <FilterSelect label="任务" value={filters.taskId} options={taskOptions} allLabel="全部任务" onChange={(taskId) => update({ taskId })} />
        <FilterSelect label="作者" value={filters.createdBy} options={authorOptions} allLabel="全部作者" onChange={(createdBy) => update({ createdBy })} />
      </Card.Content>
    </Card>
  );
}

function ArtifactPreviewTabs({ tabs, active, onOpen, onClose }: { readonly tabs: readonly ArtifactPreviewTab[]; readonly active?: ArtifactPreviewState | undefined; readonly onOpen: (tab: ArtifactPreviewTab) => void; readonly onClose: (tab: ArtifactPreviewTab) => void }) {
  if (tabs.length === 0) return null;
  const activeKey = active ? artifactPreviewTabKey(active) : undefined;
  return (
    <Card variant="transparent" className="border border-border">
      <Card.Content className="flex flex-wrap items-center gap-2 p-2">
        <span className="px-1 text-xs font-semibold uppercase text-muted">已打开预览</span>
        {tabs.map((tab) => {
          const key = artifactPreviewTabKey(tab);
          const isActive = key === activeKey;
          return (
            <span key={key} className={`inline-flex max-w-full items-center overflow-hidden rounded-md border ${isActive ? "border-accent bg-accent-soft text-accent-soft-foreground" : "border-border bg-surface-secondary text-foreground"}`}>
              <button type="button" className="min-h-7 max-w-[240px] truncate px-2 text-xs font-semibold" title={tab.path} onClick={() => onOpen(tab)}>
                {tab.name}
              </button>
              <button type="button" className="min-h-7 border-l border-border/60 px-2 text-xs font-semibold" aria-label={`关闭预览 ${tab.name}`} onClick={() => onClose(tab)}>
                x
              </button>
            </span>
          );
        })}
      </Card.Content>
    </Card>
  );
}

function FilterSelect({ label, value, options, onChange, allLabel = "全部" }: { readonly label: string; readonly value: string; readonly options: readonly string[]; readonly onChange: (value: string) => void; readonly allLabel?: string | undefined }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs">
      <span className="font-semibold uppercase text-muted">{label}</span>
      <select className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground" value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        <option value="all">{allLabel}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ArtifactReviewTools({ artifactId, files, selectedLine, csrfFetch, onReviewAdded }: { readonly artifactId: string; readonly files: readonly ReviewFile[]; readonly selectedLine?: DiffLineSelection | undefined; readonly csrfFetch: typeof fetch; readonly onReviewAdded: (review: ArtifactReviewSummary) => void }) {
  const [filePath, setFilePath] = useState(files[0]?.path ?? "");
  const [lineNumber, setLineNumber] = useState("");
  const [side, setSide] = useState<"old" | "new">("new");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!filePath && files[0]?.path) setFilePath(files[0].path);
  }, [filePath, files]);

  useEffect(() => {
    if (!selectedLine) return;
    setFilePath(selectedLine.filePath);
    setLineNumber(String(selectedLine.lineNumber));
    setSide(selectedLine.side);
  }, [selectedLine]);

  const submit = () => {
    if (reason.trim().length === 0) return;
    setPending(true);
    setError(undefined);
    void csrfFetch(`/artifacts/${encodeURIComponent(artifactId)}/reviews`, {
      method: "POST",
      body: JSON.stringify({
        decision: "comment",
        reason: reason.trim(),
        ...(filePath ? { filePath } : {}),
        ...(lineNumber.trim().length > 0 ? { lineNumber: Number(lineNumber), lineStart: Number(lineNumber), lineEnd: Number(lineNumber), side } : {})
      })
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`review ${response.status}`);
        return response.json() as Promise<{ readonly review?: ArtifactReviewSummary }>;
      })
      .then((payload) => {
        if (payload.review) onReviewAdded(payload.review);
        setReason("");
        setLineNumber("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPending(false));
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-secondary px-3 py-2">
      {selectedLine ? <p className="mb-2 text-xs text-accent-soft-foreground">已选择 {selectedLine.filePath}:{selectedLine.lineNumber}（{diffSideLabel(selectedLine.side)}）</p> : null}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_84px_84px]">
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          <span className="font-semibold uppercase text-muted">文件</span>
          <select className="min-h-8 rounded-md border border-border bg-surface px-2 text-sm" value={filePath} onChange={(event) => setFilePath(event.currentTarget.value)}>
            <option value="">整个产物</option>
            {files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-semibold uppercase text-muted">行</span>
          <input className="min-h-8 rounded-md border border-border bg-surface px-2 text-sm" inputMode="numeric" value={lineNumber} onChange={(event) => setLineNumber(event.currentTarget.value.replace(/\D/gu, ""))} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-semibold uppercase text-muted">侧</span>
          <select className="min-h-8 rounded-md border border-border bg-surface px-2 text-sm" value={side} onChange={(event) => setSide(event.currentTarget.value === "old" ? "old" : "new")}>
            <option value="new">新</option>
            <option value="old">旧</option>
          </select>
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <input className="min-h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm" value={reason} placeholder="审查意见" onChange={(event) => setReason(event.currentTarget.value)} />
        <button type="button" className="rounded-md bg-accent px-3 text-sm font-semibold text-accent-foreground disabled:opacity-60" disabled={pending || reason.trim().length === 0} onClick={submit}>{pending ? "添加中" : "添加"}</button>
      </div>
      {error ? <p className="mt-1 text-xs text-danger-700 dark:text-danger-200">{error}</p> : null}
    </div>
  );
}

function ArtifactReviewTimeline({ reviews, onFocus, onResolve, onDelete }: { readonly reviews: readonly ArtifactReviewSummary[]; readonly onFocus: (reviewId: string) => void; readonly onResolve: (review: ArtifactReviewSummary) => void; readonly onDelete: (review: ArtifactReviewSummary) => void }) {
  const visible = reviews.filter((review) => review.status !== "deleted");
  if (visible.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="mb-1 text-xs font-semibold uppercase text-muted">审查历史</div>
      <ol className="flex flex-col gap-1">
        {visible.map((review) => (
          <li key={review.id} className="flex flex-wrap items-center gap-2 text-xs">
            <Chip size="sm" variant="soft" color={review.decision === "rejected" || review.decision === "failed" ? "danger" : review.decision === "applied" ? "success" : "default"}>{review.decision}</Chip>
            <span className="text-muted">{review.reviewerKind}:{review.reviewerId}</span>
            {review.status === "resolved" ? <Chip size="sm" variant="soft" color="success">已解决</Chip> : null}
            {review.filePath ? <button type="button" className="text-muted ah-mono underline" onClick={() => onFocus(review.id)}>{review.filePath}{review.lineNumber !== undefined ? `:${review.lineNumber}` : ""}{reviewLineRangeLabel(review)}{review.side ? ` (${diffSideLabel(review.side)})` : ""}</button> : null}
            <span className="text-muted">{new Date(review.createdAt).toLocaleString()}</span>
            {review.reason ? <span className="truncate text-foreground">{review.reason}</span> : null}
            {review.status !== "resolved" ? <button type="button" className="font-semibold text-accent underline" onClick={() => onResolve(review)}>解决</button> : null}
            <button type="button" className="font-semibold text-danger underline" onClick={() => onDelete(review)}>删除</button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function reviewLineRangeLabel(review: ArtifactReviewSummary): string {
  if (review.lineStart === undefined || review.lineEnd === undefined || review.lineStart === review.lineEnd) return "";
  return `:${review.lineStart}-${review.lineEnd}`;
}

async function loadTerminalState(artifact: ArtifactSummary, csrfFetch: typeof fetch): Promise<TerminalState> {
  const filesRes = await csrfFetch(`/artifacts/${encodeURIComponent(artifact.id)}/files`);
  if (!filesRes.ok) throw new Error(`files ${filesRes.status}`);
  const filesData = (await filesRes.json()) as { files?: Array<{ path: string; updatedAt?: number }> };
  const files = Array.isArray(filesData.files) ? filesData.files : [];
  if (files.length === 0) return metadataTerminalState(artifact.metadata);
  const stderrFile = files.find((file) => /stderr/iu.test(file.path));
  const stdoutFile = files.find((file) => /stdout/iu.test(file.path));
  const sorted = [...files].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const primary = stdoutFile ?? sorted[0]!;
  const out = await fetchTerminalLines(artifact.id, primary.path, "stdout", csrfFetch);
  const err = stderrFile && stderrFile.path !== primary.path ? await fetchTerminalLines(artifact.id, stderrFile.path, "stderr", csrfFetch) : [];
  return { lines: [...out, ...err], exitCode: readExitCode(artifact.metadata) };
}

async function fetchTerminalLines(artifactId: string, path: string, stream: "stdout" | "stderr", csrfFetch: typeof fetch): Promise<TerminalLine[]> {
  const response = await csrfFetch(`/artifacts/${encodeURIComponent(artifactId)}/files/${encodeURIComponent(path)}`);
  if (!response.ok) return [];
  const body = await response.json() as { readonly content?: { readonly content?: unknown } | null };
  const text = body.content && typeof body.content.content === "string" ? body.content.content : "";
  return text.split(/\r?\n/u).filter((line) => line.length > 0).map((line) => ({ stream, text: line }));
}

function metadataTerminalState(meta: Record<string, unknown> | undefined): TerminalState {
  const lines: TerminalLine[] = [];
  const stdout = meta?.stdout;
  const stderr = meta?.stderr;
  if (typeof stdout === "string") lines.push(...stdout.split(/\r?\n/u).filter((line) => line.length > 0).map((line) => ({ stream: "stdout" as const, text: line })));
  if (typeof stderr === "string") lines.push(...stderr.split(/\r?\n/u).filter((line) => line.length > 0).map((line) => ({ stream: "stderr" as const, text: line })));
  return { lines, exitCode: readExitCode(meta) };
}

function readExitCode(meta: Record<string, unknown> | undefined): number | null {
  if (!meta) return null;
  const candidate = (meta as { exitCode?: unknown; exit_code?: unknown }).exitCode ?? (meta as { exit_code?: unknown }).exit_code;
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === "string" && candidate.trim() !== "" && Number.isFinite(Number(candidate))) return Number(candidate);
  return null;
}

function openArtifactPreview(artifact: ArtifactSummary, csrfFetch: typeof fetch, setPreview: (value: ArtifactPreviewState | undefined) => void, setPreviewTabs?: SetArtifactPreviewTabs): void {
  void (async () => {
    try {
      const filesRes = await csrfFetch(`/artifacts/${encodeURIComponent(artifact.id)}/files`);
      if (!filesRes.ok) throw new Error(`files ${filesRes.status}`);
      const filesData = await filesRes.json() as { readonly files?: ReviewFile[] };
      const file = Array.isArray(filesData.files) ? filesData.files[0] : undefined;
      if (!file) {
        setPreview(artifactPreviewStateFromContent(artifact.id, "artifact.txt", markdownFromArtifactMetadata(artifact) ?? "", artifact.title));
        return;
      }
      rememberArtifactPreviewTab({ artifactId: artifact.id, path: file.path, name: file.path }, setPreviewTabs);
      setPreview({ artifactId: artifact.id, path: file.path, name: file.path, loading: true });
      const contentRes = await csrfFetch(`/artifacts/${encodeURIComponent(artifact.id)}/files/${encodeURIComponent(file.path)}`);
      if (!contentRes.ok) throw new Error(`content ${contentRes.status}`);
      const contentData = await contentRes.json() as { readonly content?: { readonly content?: unknown } | null };
      const content = contentData.content && typeof contentData.content.content === "string" ? contentData.content.content : "";
      setPreview(artifactPreviewStateFromContent(artifact.id, file.path, content));
    } catch (previewError) {
      setPreview({ artifactId: artifact.id, path: "artifact.txt", name: artifact.title, error: previewError instanceof Error ? previewError.message : String(previewError), loading: false });
    }
  })();
}

function openArtifactFilePreview(artifactId: string, path: string, csrfFetch: typeof fetch, setPreview: (value: ArtifactPreviewState | undefined) => void, setPreviewTabs?: SetArtifactPreviewTabs): void {
  const request = artifactFilePreviewRequest(artifactId, path);
  rememberArtifactPreviewTab({ artifactId, path, name: path }, setPreviewTabs);
  setPreview({ artifactId, path, name: path, loading: true });
  void csrfFetch(request.contentPath)
    .then(async (response) => {
      if (!response.ok) throw new Error(`content ${response.status}`);
      return response.json() as Promise<{ readonly content?: { readonly content?: unknown } | null }>;
    })
    .then((payload) => {
      const content = payload.content && typeof payload.content.content === "string" ? payload.content.content : "";
      setPreview(artifactPreviewStateFromContent(artifactId, path, content));
    })
    .catch((previewError) => {
      setPreview({ artifactId, path, name: path, error: previewError instanceof Error ? previewError.message : String(previewError), loading: false });
    });
}

export function artifactPreviewStateFromContent(artifactId: string, path: string, content: string, name = path): ArtifactPreviewState {
  return {
    artifactId,
    path,
    name,
    content,
    loading: false,
    mimeType: artifactContentTypeFor(path),
    sizeBytes: new TextEncoder().encode(content).byteLength
  };
}

export function artifactPreviewTabsAfterOpen(current: readonly ArtifactPreviewTab[], opened: ArtifactPreviewTab, limit = 8): ArtifactPreviewTab[] {
  return [
    opened,
    ...current.filter((tab) => artifactPreviewTabKey(tab) !== artifactPreviewTabKey(opened))
  ].slice(0, limit);
}

function rememberArtifactPreviewTab(tab: ArtifactPreviewTab, setPreviewTabs: SetArtifactPreviewTabs | undefined): void {
  setPreviewTabs?.((current) => artifactPreviewTabsAfterOpen(current, tab));
}

function artifactPreviewTabKey(tab: Pick<ArtifactPreviewState, "artifactId" | "path">): string {
  return `${tab.artifactId}\u0000${tab.path}`;
}

export function artifactFilePreviewRequest(artifactId: string, path: string): { readonly contentPath: string; readonly rawUrl: string } {
  const encodedArtifactId = encodeURIComponent(artifactId);
  const encodedPath = encodeURIComponent(path);
  const contentPath = `/artifacts/${encodedArtifactId}/files/${encodedPath}`;
  return {
    contentPath,
    rawUrl: `${contentPath}/raw`
  };
}

function markdownFromArtifactMetadata(artifact: ArtifactSummary): string | undefined {
  const markdown = artifact.metadata?.markdown;
  return typeof markdown === "string" ? markdown : undefined;
}

function isCodeChangeArtifact(artifact: ArtifactSummary): boolean {
  return artifact.type === "diff" || artifact.type === "worktree_diff";
}

function ArtifactHeader({ artifact, csrfFetch, onArtifactChanged }: { readonly artifact: ArtifactSummary; readonly csrfFetch: typeof fetch; readonly onArtifactChanged: (artifact: Partial<ArtifactSummary>) => void }) {
  const [pending, setPending] = useState<"archive" | "delete" | undefined>(undefined);
  const act = (action: "archive" | "delete") => {
    setPending(action);
    void csrfFetch(`/artifacts/${encodeURIComponent(artifact.id)}${action === "archive" ? "/archive" : ""}`, { method: action === "archive" ? "POST" : "DELETE" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`artifact ${action} ${response.status}`);
        return response.json() as Promise<{ readonly artifact?: ArtifactSummary }>;
      })
      .then((payload) => { if (payload.artifact) onArtifactChanged(payload.artifact); })
      .finally(() => setPending(undefined));
  };
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant="soft" color={artifact.type === "worktree_diff" ? "accent" : "default"}>{artifact.type}</Chip>
          <Chip size="sm" variant="soft" color={artifact.status === "conflict" ? "danger" : artifact.status === "ready_for_review" ? "success" : "default"}>{artifact.status}</Chip>
        </div>
        <h3 className="mt-1 truncate text-sm font-semibold">{artifact.title}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {artifact.createdBy ? `作者 ${artifact.createdBy}` : "未知作者"}
          {artifact.runId ? ` / 运行 ${artifact.runId}` : ""}
          {artifact.taskId ? ` / 任务 ${artifact.taskId}` : ""}
          {typeof artifact.metadata?.artifactFsMode === "string" ? ` / ${artifact.metadata.artifactFsMode}` : ""}
          {typeof artifact.metadata?.baseRef === "string" ? ` / 基线 ${artifact.metadata.baseRef}` : ""}
        </p>
      </div>
      <div className="flex gap-2">
        <button type="button" className="rounded-md border border-border px-2 py-1 text-xs font-semibold" disabled={pending !== undefined || artifact.archivedAt !== undefined} onClick={() => act("archive")}>{pending === "archive" ? "归档中" : artifact.archivedAt !== undefined ? "已归档" : "归档"}</button>
        <button type="button" className="rounded-md bg-danger px-2 py-1 text-xs font-semibold text-danger-foreground" disabled={pending !== undefined} onClick={() => act("delete")}>{pending === "delete" ? "删除中" : "删除"}</button>
      </div>
    </div>
  );
}

type SetReviewsByArtifactId = (updater: (prev: Record<string, ArtifactReviewSummary[]>) => Record<string, ArtifactReviewSummary[]>) => void;

function updateReviewStatus(artifactId: string, comment: DiffReviewComment | ArtifactReviewSummary, action: "resolve" | "delete", csrfFetch: typeof fetch, setReviewsByArtifactId: SetReviewsByArtifactId): void {
  const method = action === "resolve" ? "POST" : "DELETE";
  const suffix = action === "resolve" ? "/resolve" : "";
  void csrfFetch(`/artifacts/${encodeURIComponent(artifactId)}/reviews/${encodeURIComponent(comment.id)}${suffix}`, { method })
    .then(async (response) => {
      if (!response.ok) throw new Error(`review ${action} ${response.status}`);
      return response.json() as Promise<{ readonly review?: ArtifactReviewSummary }>;
    })
    .then((payload) => {
      if (!payload.review) return;
      setReviewsByArtifactId((prev) => ({
        ...prev,
        [artifactId]: (prev[artifactId] ?? []).map((review) => review.id === payload.review?.id ? payload.review : review)
      }));
    })
    .catch(() => undefined);
}

function editReviewComment(artifactId: string, comment: DiffReviewComment | ArtifactReviewSummary, csrfFetch: typeof fetch, setReviewsByArtifactId: SetReviewsByArtifactId): void {
  const current = typeof comment.reason === "string" ? comment.reason : "";
  const nextReason = window.prompt("编辑审查意见", current);
  if (nextReason === null) return;
  const trimmed = nextReason.trim();
  if (trimmed.length === 0) return;
  const request = artifactReviewEditRequest(artifactId, comment, trimmed);
  void csrfFetch(request.path, request.init)
    .then(async (response) => {
      if (!response.ok) throw new Error(`review edit ${response.status}`);
      return response.json() as Promise<{ readonly review?: ArtifactReviewSummary }>;
    })
    .then((payload) => {
      if (!payload.review) return;
      setReviewsByArtifactId((prev) => ({
        ...prev,
        [artifactId]: (prev[artifactId] ?? []).map((review) => review.id === payload.review?.id ? payload.review : review)
      }));
    })
    .catch(() => undefined);
}

export function artifactReviewEditRequest(artifactId: string, comment: Pick<DiffReviewComment | ArtifactReviewSummary, "id" | "filePath" | "lineNumber" | "lineStart" | "lineEnd" | "side">, reason: string): { readonly path: string; readonly init: RequestInit } {
  return {
    path: `/artifacts/${encodeURIComponent(artifactId)}/reviews/${encodeURIComponent(comment.id)}`,
    init: {
      method: "PATCH",
      body: JSON.stringify({
        reason,
        ...(comment.filePath !== undefined ? { filePath: comment.filePath } : {}),
        ...(comment.lineNumber !== undefined ? { lineNumber: comment.lineNumber } : {}),
        ...(comment.lineStart !== undefined ? { lineStart: comment.lineStart } : {}),
        ...(comment.lineEnd !== undefined ? { lineEnd: comment.lineEnd } : {}),
        ...(comment.side !== undefined ? { side: comment.side } : {})
      })
    }
  };
}

function uniqueOptionValues(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function diffSideLabel(side: "old" | "new"): string {
  return side === "old" ? "旧" : "新";
}

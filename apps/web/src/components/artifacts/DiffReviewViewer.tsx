import { useMemo, useState } from "react";
import { Button, Card, Chip, Disclosure, DisclosureGroup } from "@heroui/react";

export type ReviewFileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "mode_changed";

export type ReviewFile = {
  readonly path: string;
  readonly fileStatus?: ReviewFileStatus | undefined;
  readonly status?: ReviewFileStatus | undefined;
  readonly additions?: number | undefined;
  readonly deletions?: number | undefined;
  readonly patch?: string | undefined;
};

export type DiffReviewViewerProps = {
  readonly artifactId?: string | undefined;
  readonly files: readonly ReviewFile[];
  readonly compact?: boolean | undefined;
  readonly largeDiffLineLimit?: number | undefined;
  readonly comments?: readonly DiffReviewComment[] | undefined;
  readonly focusedCommentId?: string | undefined;
  readonly onLineSelect?: (selection: DiffLineSelection) => void;
  readonly onViewFile?: (file: ReviewFile) => void;
  readonly onResolveComment?: (comment: DiffReviewComment) => void;
  readonly onDeleteComment?: (comment: DiffReviewComment) => void;
  readonly onEditComment?: (comment: DiffReviewComment) => void;
};

type DiffMode = "unified" | "split";
type ParsedDiffLine = { readonly kind: "context" | "addition" | "deletion" | "hunk" | "meta"; readonly text: string; readonly oldLine?: number; readonly newLine?: number };
export type DiffLineSide = "old" | "new";
export type DiffLineSelection = { readonly filePath: string; readonly lineNumber: number; readonly side: DiffLineSide };
export type DiffReviewComment = { readonly id: string; readonly filePath?: string | undefined; readonly lineNumber?: number | undefined; readonly lineStart?: number | undefined; readonly lineEnd?: number | undefined; readonly side?: DiffLineSide | undefined; readonly status?: "open" | "resolved" | "deleted" | undefined; readonly reason?: string | undefined; readonly reviewerKind?: string | undefined; readonly reviewerId?: string | undefined };

export function DiffReviewViewer({ artifactId, files, compact = false, largeDiffLineLimit = 500, comments = [], focusedCommentId, onLineSelect, onViewFile, onResolveComment, onDeleteComment, onEditComment }: DiffReviewViewerProps) {
  const [mode, setMode] = useState<DiffMode>("unified");
  const [expandedLarge, setExpandedLarge] = useState<Record<string, boolean>>({});
  const totalAdditions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const totalDeletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);

  if (files.length === 0) {
    return <p className="text-sm text-muted">No file changes recorded.</p>;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="diff-review-viewer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Chip size="sm" variant="soft" color="default">{files.length} file{files.length === 1 ? "" : "s"}</Chip>
          <span className="text-success">+{totalAdditions}</span>
          <span className="text-danger">-{totalDeletions}</span>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={mode === "unified" ? "primary" : "secondary"} onPress={() => setMode("unified")}>Unified</Button>
          <Button size="sm" variant={mode === "split" ? "primary" : "secondary"} onPress={() => setMode("split")}>Split</Button>
        </div>
      </div>
      <DisclosureGroup defaultExpandedKeys={files.slice(0, compact ? 2 : files.length).map((file) => file.path)}>
        {files.map((file) => {
          const key = file.path;
          const patchLines = file.patch ? file.patch.split(/\r?\n/u) : [];
          const isLarge = patchLines.length > largeDiffLineLimit;
          const canRender = !isLarge || expandedLarge[key] === true;
          const parsed = canRender ? parseUnifiedDiff(file.patch ?? "") : [];
          const fileComments = comments.filter((comment) => comment.filePath === file.path && comment.status !== "deleted");
          const fileAnchorId = artifactId ? artifactFileAnchorId(artifactId, file.path) : undefined;
          return (
            <Disclosure key={key} id={key} {...(fileAnchorId ? { "data-artifact-file-anchor": fileAnchorId } : {})}>
              {fileAnchorId ? <span id={fileAnchorId} className="block scroll-mt-6" aria-hidden="true" /> : null}
              <Disclosure.Trigger>
                <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <Chip size="sm" variant="soft" color={statusColor(fileStatus(file))}>{fileStatus(file)}</Chip>
                  <span className="min-w-0 flex-1 truncate ah-mono text-sm">{file.path}</span>
                  <span className="shrink-0 text-xs text-muted">+{file.additions ?? 0} -{file.deletions ?? 0}</span>
                </div>
              </Disclosure.Trigger>
              {onViewFile ? (
                <button
                  type="button"
                  className="ml-2 shrink-0 rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-surface-secondary"
                  aria-label={`Open file ${file.path}`}
                  data-view-file={file.path}
                  onClick={() => onViewFile(file)}
                >
                  Open file
                </button>
              ) : null}
              <Disclosure.Body>
                {file.patch === undefined || file.patch.length === 0 ? (
                  <p className="rounded-md border border-border bg-surface-secondary p-3 text-xs text-muted">No patch text available for this file.</p>
                ) : isLarge && !canRender ? (
                  <Card variant="transparent" className="border border-warning/40 bg-warning/10">
                    <Card.Content className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <div>
                        <p className="text-sm font-semibold">Large diff</p>
                        <p className="text-xs text-muted">{patchLines.length} lines. Rendering is paused to keep the UI responsive.</p>
                      </div>
                      <Button size="sm" variant="secondary" onPress={() => setExpandedLarge((current) => ({ ...current, [key]: true }))}>Render anyway</Button>
                    </Card.Content>
                  </Card>
                ) : mode === "split" ? (
                  <SplitDiff filePath={file.path} lines={parsed} comments={fileComments} focusedCommentId={focusedCommentId} onLineSelect={onLineSelect} onResolveComment={onResolveComment} onDeleteComment={onDeleteComment} onEditComment={onEditComment} />
                ) : (
                  <UnifiedDiff filePath={file.path} lines={parsed} comments={fileComments} focusedCommentId={focusedCommentId} onLineSelect={onLineSelect} onResolveComment={onResolveComment} onDeleteComment={onDeleteComment} onEditComment={onEditComment} />
                )}
              </Disclosure.Body>
            </Disclosure>
          );
        })}
      </DisclosureGroup>
    </div>
  );
}

export function artifactFileAnchorId(artifactId: string, path: string): string {
  return `artifact-file-${encodeURIComponent(artifactId)}-${encodeURIComponent(path)}`;
}

export function parseUnifiedDiff(patch: string): ParsedDiffLine[] {
  const output: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const rawLine of patch.split(/\r?\n/u)) {
    const hunk = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      output.push({ kind: "hunk", text: rawLine });
      continue;
    }
    if (rawLine.startsWith("diff --git ") || rawLine.startsWith("index ") || rawLine.startsWith("--- ") || rawLine.startsWith("+++ ") || rawLine.startsWith("new file mode ") || rawLine.startsWith("deleted file mode ")) {
      output.push({ kind: "meta", text: rawLine });
      continue;
    }
    if (rawLine.startsWith("+")) {
      output.push({ kind: "addition", text: rawLine, newLine });
      newLine += 1;
      continue;
    }
    if (rawLine.startsWith("-")) {
      output.push({ kind: "deletion", text: rawLine, oldLine });
      oldLine += 1;
      continue;
    }
    output.push({ kind: "context", text: rawLine, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }
  return output;
}

function UnifiedDiff({ filePath, lines, comments, focusedCommentId, onLineSelect, onResolveComment, onDeleteComment, onEditComment }: { readonly filePath: string; readonly lines: readonly ParsedDiffLine[]; readonly comments: readonly DiffReviewComment[]; readonly focusedCommentId?: string | undefined; readonly onLineSelect?: ((selection: DiffLineSelection) => void) | undefined; readonly onResolveComment?: ((comment: DiffReviewComment) => void) | undefined; readonly onDeleteComment?: ((comment: DiffReviewComment) => void) | undefined; readonly onEditComment?: ((comment: DiffReviewComment) => void) | undefined }) {
  return (
    <pre className="ah-mono max-h-[420px] overflow-auto rounded-md border border-border bg-surface-secondary text-xs leading-5">
      {lines.map((line, index) => {
        const lineComments = commentsForLine(comments, line);
        const selection = lineSelection(filePath, line);
        return (
          <div key={index}>
            <button
              type="button"
              className={`${lineClass(line.kind)} block w-full cursor-text text-left`}
              data-diff-line={selection ? `${selection.filePath}:${selection.side}:${selection.lineNumber}` : undefined}
              onClick={() => { if (selection) onLineSelect?.(selection); }}
              disabled={selection === undefined}
            >
              <span className="inline-block w-12 select-none pr-2 text-right text-muted">{line.oldLine ?? ""}</span>
              <span className="inline-block w-12 select-none border-r border-border/70 pr-2 text-right text-muted">{line.newLine ?? ""}</span>
              <span className="pl-2">{line.text || " "}</span>
            </button>
            <InlineComments comments={lineComments} focusedCommentId={focusedCommentId} onResolveComment={onResolveComment} onDeleteComment={onDeleteComment} onEditComment={onEditComment} />
          </div>
        );
      })}
    </pre>
  );
}

function SplitDiff({ filePath, lines, comments, focusedCommentId, onLineSelect, onResolveComment, onDeleteComment, onEditComment }: { readonly filePath: string; readonly lines: readonly ParsedDiffLine[]; readonly comments: readonly DiffReviewComment[]; readonly focusedCommentId?: string | undefined; readonly onLineSelect?: ((selection: DiffLineSelection) => void) | undefined; readonly onResolveComment?: ((comment: DiffReviewComment) => void) | undefined; readonly onDeleteComment?: ((comment: DiffReviewComment) => void) | undefined; readonly onEditComment?: ((comment: DiffReviewComment) => void) | undefined }) {
  const rows = toSplitRows(lines);
  return (
    <div className="max-h-[420px] overflow-auto rounded-md border border-border bg-surface-secondary ah-mono text-xs leading-5">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-2">
          <button type="button" className={`${splitCellClass(row.left?.kind)} text-left`} data-diff-line={row.left?.oldLine !== undefined ? `${filePath}:old:${row.left.oldLine}` : undefined} onClick={() => { if (row.left?.oldLine !== undefined) onLineSelect?.({ filePath, side: "old", lineNumber: row.left.oldLine }); }} disabled={row.left?.oldLine === undefined}>
            <span className="inline-block w-12 select-none pr-2 text-right text-muted">{row.left?.oldLine ?? ""}</span>
            <span>{row.left?.text ?? " "}</span>
          </button>
          <button type="button" className={`${splitCellClass(row.right?.kind)} text-left`} data-diff-line={row.right?.newLine !== undefined ? `${filePath}:new:${row.right.newLine}` : undefined} onClick={() => { if (row.right?.newLine !== undefined) onLineSelect?.({ filePath, side: "new", lineNumber: row.right.newLine }); }} disabled={row.right?.newLine === undefined}>
            <span className="inline-block w-12 select-none pr-2 text-right text-muted">{row.right?.newLine ?? ""}</span>
            <span>{row.right?.text ?? " "}</span>
          </button>
          <div className="col-span-2">
            <InlineComments comments={[...commentsForLine(comments, row.left), ...commentsForLine(comments, row.right)]} focusedCommentId={focusedCommentId} onResolveComment={onResolveComment} onDeleteComment={onDeleteComment} onEditComment={onEditComment} />
          </div>
        </div>
      ))}
    </div>
  );
}

function toSplitRows(lines: readonly ParsedDiffLine[]): Array<{ readonly left?: ParsedDiffLine; readonly right?: ParsedDiffLine }> {
  const rows: Array<{ readonly left?: ParsedDiffLine; readonly right?: ParsedDiffLine }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.kind === "deletion" && lines[index + 1]?.kind === "addition") {
      rows.push({ left: line, right: lines[index + 1]! });
      index += 1;
      continue;
    }
    if (line.kind === "addition") rows.push({ right: line });
    else if (line.kind === "deletion") rows.push({ left: line });
    else rows.push({ left: line, right: line });
  }
  return rows;
}

function fileStatus(file: ReviewFile): ReviewFileStatus {
  return file.fileStatus ?? file.status ?? "modified";
}

function statusColor(status: ReviewFileStatus): "success" | "danger" | "warning" {
  if (status === "added" || status === "copied") return "success";
  if (status === "deleted") return "danger";
  return "warning";
}

function lineClass(kind: ParsedDiffLine["kind"]): string {
  if (kind === "addition") return "bg-success/10 text-success-900 dark:text-success-100";
  if (kind === "deletion") return "bg-danger/10 text-danger-900 dark:text-danger-100";
  if (kind === "hunk") return "bg-accent-soft text-accent-soft-foreground";
  if (kind === "meta") return "text-muted";
  return "";
}

function splitCellClass(kind: ParsedDiffLine["kind"] | undefined): string {
  const base = "min-w-0 whitespace-pre-wrap border-r border-border/60 px-2";
  if (kind === "addition") return `${base} bg-success/10 text-success-900 dark:text-success-100`;
  if (kind === "deletion") return `${base} bg-danger/10 text-danger-900 dark:text-danger-100`;
  if (kind === "hunk") return `${base} bg-accent-soft text-accent-soft-foreground`;
  if (kind === "meta") return `${base} text-muted`;
  return base;
}

function commentsForLine(comments: readonly DiffReviewComment[], line: ParsedDiffLine | undefined): DiffReviewComment[] {
  if (line === undefined) return [];
  return comments.filter((comment) => comment.lineNumber !== undefined && (
    comment.side === "new" ? comment.lineNumber === line.newLine :
    comment.side === "old" ? comment.lineNumber === line.oldLine :
    comment.lineNumber === line.newLine || comment.lineNumber === line.oldLine
  ));
}

function lineSelection(filePath: string, line: ParsedDiffLine): DiffLineSelection | undefined {
  if (line.kind === "addition" && line.newLine !== undefined) return { filePath, side: "new", lineNumber: line.newLine };
  if (line.kind === "deletion" && line.oldLine !== undefined) return { filePath, side: "old", lineNumber: line.oldLine };
  if (line.newLine !== undefined) return { filePath, side: "new", lineNumber: line.newLine };
  if (line.oldLine !== undefined) return { filePath, side: "old", lineNumber: line.oldLine };
  return undefined;
}

function InlineComments({ comments, focusedCommentId, onResolveComment, onDeleteComment, onEditComment }: { readonly comments: readonly DiffReviewComment[]; readonly focusedCommentId?: string | undefined; readonly onResolveComment?: ((comment: DiffReviewComment) => void) | undefined; readonly onDeleteComment?: ((comment: DiffReviewComment) => void) | undefined; readonly onEditComment?: ((comment: DiffReviewComment) => void) | undefined }) {
  if (comments.length === 0) return null;
  return (
    <div className="border-y border-accent/20 bg-accent-soft/50 px-4 py-1 text-xs text-accent-soft-foreground">
      {comments.map((comment) => (
        <div key={comment.id} id={`artifact-review-${comment.id}`} data-comment-id={comment.id} data-focused={focusedCommentId === comment.id ? "true" : undefined} className={`flex flex-wrap items-center gap-2 whitespace-pre-wrap ${focusedCommentId === comment.id ? "rounded bg-accent/20 px-1" : ""}`}>
          <span className="font-semibold">{comment.reviewerKind ?? "reviewer"}:{comment.reviewerId ?? "local"}</span>
          {commentRangeLabel(comment) ? <span className="rounded bg-surface px-1 text-muted">{commentRangeLabel(comment)}</span> : null}
          {comment.status === "resolved" ? <span className="rounded bg-success/10 px-1 text-success-900 dark:text-success-100">resolved</span> : null}
          {comment.reason ? <span> - {comment.reason}</span> : null}
          {onEditComment ? <button type="button" className="font-semibold underline" onClick={() => onEditComment(comment)}>Edit</button> : null}
          {comment.status !== "resolved" && onResolveComment ? <button type="button" className="font-semibold underline" onClick={() => onResolveComment(comment)}>Resolve</button> : null}
          {onDeleteComment ? <button type="button" className="font-semibold underline" onClick={() => onDeleteComment(comment)}>Delete</button> : null}
        </div>
      ))}
    </div>
  );
}

function commentRangeLabel(comment: DiffReviewComment): string | undefined {
  if (comment.lineStart === undefined || comment.lineEnd === undefined || comment.lineStart === comment.lineEnd) return undefined;
  return `lines ${comment.lineStart}-${comment.lineEnd}`;
}

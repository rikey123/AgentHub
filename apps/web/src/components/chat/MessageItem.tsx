import { useState } from "react";
import { Avatar, Button, Card, Chip, Dropdown } from "@heroui/react";
import type { MessageViewModel } from "../../types.ts";
import { formatBytes, formatTime, initials } from "../../lib/format.ts";
import { pendingTurnColor } from "../../lib/status.ts";
import { CardRenderer } from "../cards/CardRenderer.tsx";
import { ArtifactPreviewModal, normalizePreviewKind } from "../artifacts/ArtifactPreviewModal.tsx";

export type QuotedMessagePreview = {
  readonly id: string;
  readonly senderName: string;
  readonly preview: string;
};

interface MessageItemProps {
  message: MessageViewModel;
  quotedMessage?: QuotedMessagePreview | undefined;
  isSelected?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  onOpenQuotedMessage?: ((id: string) => void) | undefined;
  onOpenRun?: ((runId: string) => void) | undefined;
  onReply?: (() => void) | undefined;
  onQuote?: (() => void) | undefined;
  onPin?: (() => void) | undefined;
  onRegenerate?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onCancelPending?: (() => void) | undefined;
  onEditPending?: (() => void) | undefined;
  csrfFetch: typeof fetch;
}

export function MessageItem(props: MessageItemProps) {
  const { message, quotedMessage, isSelected, onSelect, onOpenQuotedMessage, onOpenRun, onReply, onQuote, onPin, onRegenerate, onDelete, onCancelPending, onEditPending, csrfFetch } = props;
  const [expanded, setExpanded] = useState(false);

  const isUser = message.senderType === "user";
  const isSystem = message.senderType === "system";
  const senderColor = isUser ? "accent" : isSystem ? "default" : "success";
  const isStreaming = message.status === "streaming";
  const isPending = !!message.pendingTurnId && (message.pendingTurnStatus === "queued" || message.pendingTurnStatus === "scheduled");
  const testId = `message-bubble-${isUser ? "user" : isSystem ? "system" : "agent"}`;
  const textPreview = publicAgentTextPreview(message.text, message.senderType, isStreaming);
  const visibleText = textPreview.collapsed && !expanded ? textPreview.preview : message.text;
  const selectMessage = () => {
    onSelect?.();
  };

  return (
    <div
      className={[
        "group mx-auto my-1.5 w-full max-w-[1280px] px-6 py-1 transition-colors",
        isSelected ? "rounded-2xl bg-accent-soft" : ""
      ].join(" ")}
      data-message-id={message.id}
      data-speaker-type={isUser ? "user" : isSystem ? "system" : "agent"}
      data-testid={testId}
    >
      <div className={["flex items-end gap-2.5", isUser ? "justify-end" : "justify-start"].join(" ")}>
        {!isUser ? (
          <Avatar size="sm" className="mb-6 shrink-0 shadow-sm ring-2 ring-background">
            <Avatar.Fallback>{initials(message.senderName)}</Avatar.Fallback>
          </Avatar>
        ) : null}

        <div className={["flex min-w-0 max-w-[min(88%,900px)] flex-col", isUser ? "items-end" : "items-start"].join(" ")}>
          {!isUser ? (
            <header className="mb-1 flex max-w-full items-center gap-2 text-xs justify-start">
              <span className="truncate font-semibold text-foreground">{message.senderName}</span>
              <Chip size="sm" variant="soft" color={senderColor}>{message.role}</Chip>
              {message.pendingTurnStatus ? (
                <Chip
                  size="sm"
                  variant="soft"
                  color={pendingTurnColor(message.pendingTurnStatus)}
                  aria-label={`Pending turn: ${message.pendingTurnStatus}${message.pendingTurnPosition ? ` position ${message.pendingTurnPosition}` : ""}`}
                >
                  {message.pendingTurnStatus}{message.pendingTurnPosition ? ` #${message.pendingTurnPosition}` : ""}
                </Chip>
              ) : null}
            </header>
          ) : null}

          <div
            onClick={(e) => {
              e.stopPropagation();
              if (!shouldSelectMessageFromTarget(e.target)) return;
              selectMessage();
            }}
            className={[
              "relative w-fit rounded-[20px] px-4 py-3 text-sm leading-6 shadow-sm",
              isUser
                ? "rounded-br-md bg-accent text-accent-foreground"
                : isSystem
                  ? "rounded-bl-md border border-border bg-surface-tertiary text-foreground"
                  : "rounded-bl-md border border-border bg-surface text-foreground shadow-surface"
            ].join(" ")}
          >
            {message.quotedMessageId ? (
              <QuotedMessageBubble
                quotedMessageId={message.quotedMessageId}
                quotedMessage={quotedMessage}
                isUser={isUser}
                onOpenQuotedMessage={onOpenQuotedMessage}
              />
            ) : null}

            {message.text ? (
              <MessageTextView text={visibleText} isStreaming={isStreaming} />
            ) : null}

            {textPreview.collapsed ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-2">
                <Chip size="sm" variant="soft" color="default">长回复</Chip>
                <Button size="sm" variant="tertiary" onPress={() => setExpanded((value) => !value)}>
                  {expanded ? "收起" : "展开全文"}
                </Button>
                {message.runId && onOpenRun ? (
                  <Button size="sm" variant="secondary" onPress={() => onOpenRun(message.runId!)}>
                    打开运行详情
                  </Button>
                ) : null}
              </div>
            ) : null}

            {message.parts.length > 0 ? (
              <div className="mt-3 flex flex-col gap-2">
                {message.parts.map((part, i) => (
                  <PartView key={i} part={part} csrfFetch={csrfFetch} />
                ))}
              </div>
            ) : null}

            {isPending ? (
              <div className="mt-3 flex gap-2">
                {onEditPending ? (
                  <Button size="sm" variant={isUser ? "secondary" : "outline"} onPress={onEditPending}>Edit</Button>
                ) : null}
                {onCancelPending ? (
                  <Button size="sm" variant="danger" onPress={onCancelPending}>Cancel</Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <footer
            className={["mt-1 flex items-center gap-1.5 text-xs", isUser ? "justify-end" : "justify-start"].join(" ")}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="shrink-0 text-muted">{formatTime(message.createdAt)}</span>
            <Dropdown>
              <Dropdown.Trigger
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted opacity-0 transition-opacity hover:bg-default group-hover:opacity-100 focus:opacity-100"
                aria-label="消息操作"
                data-testid={`message-menu-${message.id}`}
              >
                ...
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu aria-label="消息操作">
                  {onReply ? <Dropdown.Item onAction={onReply}>Reply</Dropdown.Item> : null}
                  {onQuote ? <Dropdown.Item onAction={onQuote}>Quote</Dropdown.Item> : null}
                  {onRegenerate && message.senderType === "agent" && message.status === "completed" ? (
                    <Dropdown.Item onAction={onRegenerate}>重新生成</Dropdown.Item>
                  ) : null}
                  {onPin && message.status === "completed" ? <Dropdown.Item onAction={onPin}>{pinActionLabel(message.pinnedAt !== undefined)}</Dropdown.Item> : null}
                  {message.runId && onOpenRun ? (
                    <Dropdown.Item onAction={() => onOpenRun(message.runId!)}>打开运行详情</Dropdown.Item>
                  ) : null}
                  {onDelete ? (
                    <Dropdown.Item onAction={onDelete} className="text-danger">删除</Dropdown.Item>
                  ) : null}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </footer>
        </div>

        {isUser ? (
          <Avatar size="sm" className="mb-6 shrink-0 shadow-sm ring-2 ring-background">
            <Avatar.Fallback>{initials(message.senderName)}</Avatar.Fallback>
          </Avatar>
        ) : null}
      </div>
    </div>
  );
}

function QuotedMessageBubble(props: {
  readonly quotedMessageId: string;
  readonly quotedMessage?: QuotedMessagePreview | undefined;
  readonly isUser: boolean;
  readonly onOpenQuotedMessage?: ((id: string) => void) | undefined;
}) {
  const targetId = props.quotedMessage?.id ?? props.quotedMessageId;
  const senderName = props.quotedMessage?.senderName ?? "Quoted message";
  const preview = props.quotedMessage?.preview || props.quotedMessageId.slice(0, 8);

  return (
    <button
      type="button"
      className={[
        "mb-2 block max-w-full rounded-lg border-l-2 px-2 py-1.5 text-left text-xs leading-5 transition-colors",
        props.isUser
          ? "border-accent-foreground/70 bg-white/10 text-accent-foreground/90 hover:bg-white/15"
          : "border-accent bg-accent-soft text-muted hover:bg-accent-soft/80"
      ].join(" ")}
      data-message-action
      data-quoted-message-id={targetId}
      aria-label={`Open quoted message from ${senderName}`}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpenQuotedMessage?.(targetId);
      }}
    >
      <span className="block truncate font-semibold">{senderName}</span>
      <span className="block truncate">{preview}</span>
    </button>
  );
}

type MessageTextSegment =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "code"; readonly lang: string; readonly text: string };

export function parseMarkdownFencedCode(text: string): MessageTextSegment[] {
  const segments: MessageTextSegment[] = [];
  const fencePattern = /^```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;
  let lastIndex = 0;

  for (const match of text.matchAll(fencePattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, index) });
    }
    segments.push({
      type: "code",
      lang: match[1]?.trim() || "code",
      text: match[2] ?? ""
    });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", text }];
}

function MessageTextView({ text, isStreaming }: { readonly text: string; readonly isStreaming: boolean }) {
  const segments = parseMarkdownFencedCode(text);

  return (
    <div className={["flex flex-col gap-2", isStreaming ? "ah-streaming-caret" : ""].join(" ")}>
      {segments.map((segment, index) => {
        if (segment.type === "code") {
          return <CodePartView key={index} part={{ type: "code", seq: index + 1, lang: segment.lang, text: segment.text }} />;
        }

        return segment.text.trim().length > 0 ? (
          <p key={index} className="whitespace-pre-wrap break-words">
            {segment.text.trim()}
          </p>
        ) : null;
      })}
    </div>
  );
}

function publicAgentTextPreview(text: string, senderType: MessageViewModel["senderType"], isStreaming: boolean): { collapsed: boolean; preview: string } {
  if (senderType !== "agent") return { collapsed: false, preview: text };
  if (hasMarkdownFencedCode(text)) return { collapsed: false, preview: text };
  const contentLines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const shouldCollapse = text.length > 640 || contentLines.length > 4;
  if (!shouldCollapse) return { collapsed: false, preview: text };

  if (isStreaming) {
    const firstNonEmpty = contentLines[0];
    const preview = firstNonEmpty !== undefined && firstNonEmpty.length <= 180
      ? firstNonEmpty
      : firstNonEmpty !== undefined
        ? `${firstNonEmpty.slice(0, 177).trimEnd()}...`
        : "Receiving a longer reply...";
    return { collapsed: true, preview };
  }

  if (text.length > 640 && contentLines.length <= 4) {
    return { collapsed: true, preview: `${text.slice(0, 520).trimEnd()}...` };
  }

  const lines = text.split(/\r?\n/);
  let contentCount = 0;
  const previewLines: string[] = [];
  for (const line of lines) {
    if (line.trim().length > 0) contentCount += 1;
    if (contentCount > 4) break;
    previewLines.push(line);
  }
  return { collapsed: true, preview: `${previewLines.join("\n").trimEnd()}...` };
}

function hasMarkdownFencedCode(text: string): boolean {
  return /^```[^\r\n`]*\r?\n[\s\S]*?\r?\n```[ \t]*$/m.test(text);
}

function PartView({ part, csrfFetch }: { part: MessageViewModel["parts"][number]; csrfFetch: typeof fetch }) {
  switch (part.type) {
    case "text":
      return <p className="text-sm whitespace-pre-wrap">{part.text}</p>;
    case "code":
      return <CodePartView part={part} />;
    case "tool_call":
      return (
        <Card variant="transparent" className="border border-border">
          <Card.Header>
            <Card.Title className="text-xs">Tool call - {part.name}</Card.Title>
          </Card.Header>
          <Card.Content>
            <pre className="ah-mono max-h-32 overflow-auto text-xs">{JSON.stringify(part.input, null, 2)}</pre>
          </Card.Content>
        </Card>
      );
    case "tool_result":
      return (
        <Card variant="transparent" className="border border-border">
          <Card.Header>
            <Card.Title className="text-xs">
              Tool result {part.ok ? <Chip size="sm" color="success" variant="soft">ok</Chip> : <Chip size="sm" color="danger" variant="soft">error</Chip>}
            </Card.Title>
          </Card.Header>
          <Card.Content>
            <pre className="ah-mono max-h-32 overflow-auto text-xs">{JSON.stringify(part.output, null, 2)}</pre>
          </Card.Content>
        </Card>
      );
    case "attachment":
      return <ArtifactAttachmentCard part={part} csrfFetch={csrfFetch} />;
    case "card":
      return <CardRenderer card={part.card} csrfFetch={csrfFetch} />;
    default: {
      return null;
    }
  }
}

const MESSAGE_ACTION_SELECTOR = "button,a,input,textarea,select,[role='button'],[data-message-action]";

export function shouldSelectMessageFromTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object" || !("closest" in target)) return true;
  const closest = (target as { readonly closest?: unknown }).closest;
  return typeof closest !== "function" || closest.call(target, MESSAGE_ACTION_SELECTOR) === null;
}

export function copyCodeButtonLabel(copied: boolean): string {
  return copied ? "Copied ✓" : "Copy Code";
}

export function pinActionLabel(isPinned: boolean): string {
  return isPinned ? "Unpin" : "Pin";
}

function CodePartView({ part }: { part: Extract<MessageViewModel["parts"][number], { type: "code" }> }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | undefined>(undefined);

  const copyCode = () => {
    setCopyError(undefined);
    const writer = globalThis.navigator?.clipboard?.writeText;
    if (!writer) {
      setCopyError("Clipboard is unavailable.");
      return;
    }

    void writer.call(globalThis.navigator.clipboard, part.text)
      .then(() => {
        setCopied(true);
        globalThis.setTimeout(() => setCopied(false), 1500);
      })
      .catch((err: unknown) => {
        setCopyError(err instanceof Error ? err.message : String(err));
      });
  };

  return (
    <div className="overflow-hidden rounded bg-surface-secondary">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-2 py-1">
        <span className="text-[11px] font-semibold text-muted">{part.lang}</span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onPress={copyCode} aria-label="Copy code block">
          {copyCodeButtonLabel(copied)}
        </Button>
      </div>
      <pre className="ah-mono overflow-auto p-2 text-xs">
        {part.text}
      </pre>
      {copyError ? <p className="px-2 pb-2 text-xs text-danger">{copyError}</p> : null}
    </div>
  );
}

function ArtifactAttachmentCard({ part, csrfFetch }: { part: Extract<MessageViewModel["parts"][number], { type: "attachment" }>; csrfFetch: typeof fetch }) {
  const [preview, setPreview] = useState<{ readonly title: string; readonly content: string; readonly error?: string | undefined } | undefined>();
  const [loading, setLoading] = useState(false);
  const canPreview = part.artifactId !== undefined && part.path !== undefined;
  const previewLabel = previewLabelFor(part.previewKind, part.mimeType);
  const previewKind = normalizePreviewKind(part.previewKind, part.mimeType, part.name);
  const downloadUrl = canPreview ? `/artifacts/${encodeURIComponent(part.artifactId!)}/files/${encodeURIComponent(part.path!)}/raw` : undefined;

  const openPreview = async () => {
    if (!canPreview) return;
    setLoading(true);
    try {
      const res = await csrfFetch(`/artifacts/${encodeURIComponent(part.artifactId!)}/files/${encodeURIComponent(part.path!)}`);
      if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
      const body = await res.json() as { readonly content?: { readonly content?: unknown } | null };
      const content = body.content && typeof body.content.content === "string" ? body.content.content : "";
      setPreview({ title: part.name, content });
    } catch (err) {
      setPreview({ title: part.name, content: "", error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="flex w-full max-w-[420px] items-center gap-3 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-left shadow-sm transition-colors hover:border-accent hover:bg-surface-tertiary"
        onClick={openPreview}
        disabled={!canPreview}
        data-testid="artifact-file-card"
        aria-label="Open file preview"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface ah-mono text-xs font-semibold text-muted">
          {fileBadgeFor(part)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{part.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{previewLabel}</span>
            <span>{formatBytes(part.sizeBytes)}</span>
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-accent">{loading ? "Loading" : canPreview ? "Open" : "Unavailable"}</span>
      </button>
      <ArtifactPreviewModal
        isOpen={preview !== undefined}
        name={preview?.title ?? part.name}
        mimeType={part.mimeType}
        sizeBytes={part.sizeBytes}
        previewKind={previewKind}
        content={preview?.content}
        error={preview?.error}
        loading={loading}
        downloadUrl={downloadUrl}
        onRetry={openPreview}
        onOpenChange={(open) => { if (!open) setPreview(undefined); }}
      />
    </>
  );
}

function previewLabelFor(previewKind: string | undefined, mimeType: string): string {
  if (previewKind === "markdown") return "Markdown";
  if (previewKind === "code") return "Code";
  if (previewKind === "html") return "HTML";
  if (previewKind === "pdf") return "PDF";
  if (previewKind === "image") return "Image";
  if (previewKind === "text") return "Text";
  if (mimeType === "text/html") return "HTML";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "text/markdown") return "Markdown";
  if (mimeType.startsWith("text/")) return "Text";
  return "File";
}

function fileBadgeFor(part: Extract<MessageViewModel["parts"][number], { type: "attachment" }>): string {
  const extension = part.name.includes(".") ? part.name.split(".").pop() : undefined;
  if (extension && extension.length > 0 && extension.length <= 4) return extension.toUpperCase();
  if (part.previewKind === "markdown") return "MD";
  if (part.previewKind === "code") return "CODE";
  if (part.previewKind === "image") return "IMG";
  return "FILE";
}

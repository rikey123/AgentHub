import { useState } from "react";
import { Avatar, Button, Card, Chip, Dropdown } from "@heroui/react";
import type { MessageViewModel } from "../../types.ts";
import { formatTime, initials } from "../../lib/format.ts";
import { pendingTurnColor } from "../../lib/status.ts";
import { CardRenderer } from "../cards/CardRenderer.tsx";

interface MessageItemProps {
  message: MessageViewModel;
  isSelected?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  onOpenRun?: ((runId: string) => void) | undefined;
  onQuote?: (() => void) | undefined;
  onPin?: (() => void) | undefined;
  onRegenerate?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onCancelPending?: (() => void) | undefined;
  onEditPending?: (() => void) | undefined;
  csrfFetch: typeof fetch;
}

export function MessageItem(props: MessageItemProps) {
  const { message, isSelected, onSelect, onOpenRun, onQuote, onPin, onRegenerate, onDelete, onCancelPending, onEditPending, csrfFetch } = props;
  const [expanded, setExpanded] = useState(false);

  const isUser = message.senderType === "user";
  const isSystem = message.senderType === "system";
  const senderColor = isUser ? "accent" : isSystem ? "default" : "success";
  const isStreaming = message.status === "streaming";
  const isPending = !!message.pendingTurnId && (message.pendingTurnStatus === "queued" || message.pendingTurnStatus === "scheduled");
  const testId = `message-bubble-${isUser ? "user" : isSystem ? "system" : "agent"}`;
  const textPreview = publicAgentTextPreview(message.text, message.senderType, isStreaming);
  const visibleText = textPreview.collapsed && !expanded ? textPreview.preview : message.text;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={[
        "group mx-auto my-1.5 w-full max-w-[920px] px-4 py-1 transition-colors",
        isSelected ? "rounded-2xl bg-accent-soft" : ""
      ].join(" ")}
      data-message-id={message.id}
      data-testid={testId}
    >
      <div className={["flex items-end gap-2", isUser ? "justify-end" : "justify-start"].join(" ")}>
        {!isUser ? (
          <Avatar size="sm" className="mb-1 shrink-0 shadow-sm ring-2 ring-background">
            <Avatar.Fallback>{initials(message.senderName)}</Avatar.Fallback>
          </Avatar>
        ) : null}

        <div className={["flex min-w-0 max-w-[min(78%,760px)] flex-col", isUser ? "items-end" : "items-start"].join(" ")}>
          <header className={["mb-1 flex max-w-full items-center gap-2 text-xs", isUser ? "justify-end" : "justify-start"].join(" ")}>
            {!isUser ? <span className="truncate font-semibold text-foreground">{message.senderName}</span> : null}
            {isSystem ? <Chip size="sm" variant="soft" color={senderColor}>{message.role}</Chip> : null}
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
            <span className="shrink-0 text-muted">{formatTime(message.createdAt)}</span>
            <Dropdown>
              <Dropdown.Trigger
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted opacity-0 transition-opacity hover:bg-default group-hover:opacity-100 focus:opacity-100"
                aria-label="Message actions"
                data-testid={`message-menu-${message.id}`}
              >
                ...
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu aria-label="Message actions">
                  {onQuote ? <Dropdown.Item onAction={onQuote}>Quote</Dropdown.Item> : null}
                  {onRegenerate && message.senderType === "agent" && message.status === "completed" ? (
                    <Dropdown.Item onAction={onRegenerate}>Regenerate</Dropdown.Item>
                  ) : null}
                  {onPin && message.status === "completed" ? <Dropdown.Item onAction={onPin}>Pin</Dropdown.Item> : null}
                  {message.runId && onOpenRun ? (
                    <Dropdown.Item onAction={() => onOpenRun(message.runId!)}>Open run</Dropdown.Item>
                  ) : null}
                  {onDelete ? (
                    <Dropdown.Item onAction={onDelete} className="text-danger">Delete</Dropdown.Item>
                  ) : null}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </header>

          <div
            className={[
              "relative min-w-24 rounded-[20px] px-4 py-3 text-sm leading-6 shadow-sm",
              isUser
                ? "rounded-br-md bg-accent text-accent-foreground"
                : isSystem
                  ? "rounded-bl-md border border-border bg-surface-tertiary text-foreground"
                  : "rounded-bl-md border border-border bg-surface text-foreground shadow-surface"
            ].join(" ")}
          >
            {message.quotedMessageId ? (
              <Card variant="transparent" className={["mb-2 border-l-2 pl-2", isUser ? "border-accent-foreground/70 bg-white/10" : "border-accent bg-accent-soft"].join(" ")}>
                <Card.Description className={["text-xs", isUser ? "text-accent-foreground/85" : ""].join(" ")}>
                  Quoting {message.quotedMessageId.slice(0, 8)}
                </Card.Description>
              </Card>
            ) : null}

            {message.text ? (
              <p className={["whitespace-pre-wrap break-words", isStreaming ? "ah-streaming-caret" : ""].join(" ")}>
                {visibleText}
              </p>
            ) : null}

            {textPreview.collapsed ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-2">
                <Chip size="sm" variant="soft" color="default">Long agent reply</Chip>
                <Button size="sm" variant="tertiary" onPress={() => setExpanded((value) => !value)}>
                  {expanded ? "Show less" : "Show full"}
                </Button>
                {message.runId && onOpenRun ? (
                  <Button size="sm" variant="secondary" onPress={() => onOpenRun(message.runId!)}>
                    Open run
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
        </div>

        {isUser ? (
          <Avatar size="sm" className="mb-1 shrink-0 shadow-sm ring-2 ring-background">
            <Avatar.Fallback>{initials(message.senderName)}</Avatar.Fallback>
          </Avatar>
        ) : null}
      </div>
    </div>
  );
}

function publicAgentTextPreview(text: string, senderType: MessageViewModel["senderType"], isStreaming: boolean): { collapsed: boolean; preview: string } {
  if (senderType !== "agent" || isStreaming) return { collapsed: false, preview: text };
  const contentLines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const shouldCollapse = text.length > 640 || contentLines.length > 4;
  if (!shouldCollapse) return { collapsed: false, preview: text };

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

function PartView({ part, csrfFetch }: { part: MessageViewModel["parts"][number]; csrfFetch: typeof fetch }) {
  switch (part.type) {
    case "text":
      return <p className="text-sm whitespace-pre-wrap">{part.text}</p>;
    case "code":
      return (
        <pre className="ah-mono overflow-auto rounded bg-surface-secondary p-2 text-xs">
          {part.text}
        </pre>
      );
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
      return (
        <Chip size="sm" variant="soft" color="default" className="ah-mono">
          File {part.name} - {Math.round(part.sizeBytes / 1024)}kb
        </Chip>
      );
    case "card":
      return <CardRenderer card={part.card} csrfFetch={csrfFetch} />;
    default: {
      return null;
    }
  }
}

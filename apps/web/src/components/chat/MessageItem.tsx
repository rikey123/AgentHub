import { Avatar, Button, Card, Chip, Dropdown } from "@heroui/react";
import type { MessageViewModel } from "../../types.ts";
import { formatTime, initials, truncate } from "../../lib/format.ts";
import { pendingTurnColor } from "../../lib/status.ts";
import { CardRenderer } from "../cards/CardRenderer.tsx";
import { MailboxFailureCard } from "../cards/MailboxFailureCard.tsx";

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

  const senderColor = message.senderType === "user" ? "accent" : message.senderType === "system" ? "default" : "success";
  const isStreaming = message.status === "streaming";
  const isPending = !!message.pendingTurnId && (message.pendingTurnStatus === "queued" || message.pendingTurnStatus === "scheduled");

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
        "group mx-3 my-2 rounded-xl px-3 py-2 transition-colors",
        isSelected ? "bg-accent-soft" : "hover:bg-surface-secondary"
      ].join(" ")}
      data-message-id={message.id}
    >
      <div className="flex items-start gap-2">
        <Avatar size="sm">
          <Avatar.Fallback>{initials(message.senderName)}</Avatar.Fallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <header className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-sm">{message.senderName}</span>
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
            <span className="ml-auto text-muted">{formatTime(message.createdAt)}</span>
            <Dropdown>
              <Dropdown.Trigger className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-default" aria-label="Message actions">
                ⋯
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

          {message.quotedMessageId ? (
            <Card variant="transparent" className="my-1.5 border-l-2 border-accent pl-2">
              <Card.Description className="text-xs">
                Quoting {message.quotedMessageId.slice(0, 8)}…
              </Card.Description>
            </Card>
          ) : null}

          {message.text ? (
            <p className={["text-sm whitespace-pre-wrap break-words", isStreaming ? "ah-streaming-caret" : ""].join(" ")}>
              {message.text}
            </p>
          ) : null}

          {message.parts.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2">
              {message.parts.map((part, i) => (
                <PartView key={i} part={part} csrfFetch={csrfFetch} />
              ))}
            </div>
          ) : null}

          {isPending ? (
            <div className="mt-2 flex gap-2">
              {onEditPending ? (
                <Button size="sm" variant="secondary" onPress={onEditPending}>Edit</Button>
              ) : null}
              {onCancelPending ? (
                <Button size="sm" variant="danger" onPress={onCancelPending}>Cancel</Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
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
            <Card.Title className="text-xs">Tool call · {part.name}</Card.Title>
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
          📎 {part.name} · {Math.round(part.sizeBytes / 1024)}kb
        </Chip>
      );
    case "card":
      return <CardRenderer card={part.card} csrfFetch={csrfFetch} />;
    default: {
      const fallback = part as unknown as { type?: string };
      if (fallback.type === "mailbox_failure") return <MailboxFailureCard reason="Delivery failed" />;
      return null;
    }
  }
}

void truncate;

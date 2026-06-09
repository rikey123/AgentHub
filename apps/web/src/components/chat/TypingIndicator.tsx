import { Avatar, Button, Chip, Spinner } from "@heroui/react";
import { initials } from "../../lib/format.ts";

interface TypingIndicatorProps {
  runId?: string | undefined;
  agentName: string;
  status: string;
  mode?: string | undefined;
  turnIndex?: number | undefined;
  onStopDiscussion?: ((runId: string) => void) | undefined;
}

export function TypingIndicator({ runId, agentName, status, mode, turnIndex, onStopDiscussion }: TypingIndicatorProps) {
  const isAssisted = mode === "assisted";
  const isCancelling = status === "cancelling";
  const label = isAssisted
    ? `${agentName} is ${isCancelling ? "stopping" : "speaking"}`
    : `${agentName} is`;
  const chipLabel = isCancelling ? "Stopping discussion" : isAssisted && turnIndex !== undefined ? `Group turn ${turnIndex}` : status;
  const canStop = isAssisted && !isCancelling && runId !== undefined && onStopDiscussion !== undefined;
  return (
    <div className="px-4 py-2" role="status" aria-live="polite" data-chat-typing-indicator>
      <div className="ah-typing-indicator mx-auto flex max-w-[920px] items-center gap-2 text-xs text-muted">
        <Avatar size="sm">
          <Avatar.Fallback>{initials(agentName)}</Avatar.Fallback>
        </Avatar>
        <span>{label}</span>
        <Chip size="sm" variant="soft" color="accent">{chipLabel}</Chip>
        <span className="ah-typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <Spinner size="sm" color="current" />
        {canStop ? (
          <Button size="sm" variant="danger-soft" onPress={() => onStopDiscussion(runId)}>
            Stop discussion
          </Button>
        ) : null}
      </div>
    </div>
  );
}

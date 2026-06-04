import { Avatar, Chip, Spinner } from "@heroui/react";
import { initials } from "../../lib/format.ts";

interface TypingIndicatorProps {
  agentName: string;
  status: string;
  mode?: string | undefined;
  turnIndex?: number | undefined;
}

export function TypingIndicator({ agentName, status, mode, turnIndex }: TypingIndicatorProps) {
  const isAssisted = mode === "assisted";
  const label = isAssisted ? `${agentName} is speaking` : `${agentName} is`;
  const chipLabel = isAssisted && turnIndex !== undefined ? `Group turn ${turnIndex}` : status;
  return (
    <div className="px-4 py-2" role="status" aria-live="polite">
      <div className="mx-auto flex max-w-[920px] items-center gap-2 text-xs text-muted">
        <Avatar size="sm">
          <Avatar.Fallback>{initials(agentName)}</Avatar.Fallback>
        </Avatar>
        <span>{label}</span>
        <Chip size="sm" variant="soft" color="accent">{chipLabel}</Chip>
        <Spinner size="sm" color="current" />
      </div>
    </div>
  );
}

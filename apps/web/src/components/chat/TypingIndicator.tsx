import { Avatar, Chip, Spinner } from "@heroui/react";
import { initials } from "../../lib/format.ts";

interface TypingIndicatorProps {
  agentName: string;
  status: string;
}

export function TypingIndicator({ agentName, status }: TypingIndicatorProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted" role="status" aria-live="polite">
      <Avatar size="sm">
        <Avatar.Fallback>{initials(agentName)}</Avatar.Fallback>
      </Avatar>
      <span>{agentName} is</span>
      <Chip size="sm" variant="soft" color="accent">{status}</Chip>
      <Spinner size="sm" color="current" />
    </div>
  );
}

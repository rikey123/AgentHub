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
  const isWorking = status === "working";
  const label = isAssisted
    ? `${agentName}${isCancelling ? " 正在停止" : " 正在发言"}`
    : `${agentName}${isWorking ? " 工作中" : " 正在处理"}`;
  const chipLabel = isCancelling ? (isAssisted ? "正在停止讨论" : "停止中") : isAssisted && turnIndex !== undefined ? `第 ${turnIndex} 轮` : runStatusLabel(status);
  const canStop = !isCancelling && runId !== undefined && onStopDiscussion !== undefined;
  const stopLabel = isAssisted ? "停止讨论" : "停止运行";
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
            {stopLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function runStatusLabel(status: string): string {
  if (status === "starting") return "启动中";
  if (status === "working") return "工作中";
  if (status === "running") return "运行中";
  if (status === "cancelling") return "停止中";
  if (status === "queued") return "排队中";
  if (status === "waiting") return "排队中";
  return status;
}

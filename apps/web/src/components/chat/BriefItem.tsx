import { Chip } from "@heroui/react";
import type { BriefViewModel } from "../../types.ts";
import { formatTokens, formatUsd } from "../../lib/format.ts";

interface BriefItemProps {
  brief: BriefViewModel;
  onOpenRun?: (runId: string) => void;
}

const kindColor: Record<string, "success" | "danger" | "default" | "accent" | "warning"> = {
  run_started: "accent",
  run_completed: "success",
  run_failed: "danger",
  run_cancelled: "default",
  phase_completed: "accent"
};

export function BriefItem({ brief, onOpenRun }: BriefItemProps) {
  const openRun = () => {
    if (brief.runId) onOpenRun?.(brief.runId);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="brief-card"
      onClick={openRun}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openRun();
        }
      }}
      className="mx-auto my-2 flex w-fit max-w-[760px] items-center gap-2 rounded-full border border-border bg-surface/55 px-3 py-1 text-xs text-muted opacity-85 backdrop-blur transition-colors hover:bg-surface hover:opacity-100"
    >
      <Chip size="sm" variant="soft" color={kindColor[brief.kind] ?? "default"}>{brief.kind.replace("_", " ")}</Chip>
      <span className="max-w-[420px] truncate">
        {brief.agentName}: {brief.summary || "Run updated"}
      </span>
      <span className="flex items-center gap-1">
        {brief.failureReason ? <Chip size="sm" variant="soft" color="danger">{brief.failureClass ?? "failure"}</Chip> : null}
        {brief.artifactCount ? <Chip size="sm" variant="soft" color="default">{brief.artifactCount} 个产物</Chip> : null}
        {brief.cost ? (
          <Chip size="sm" variant="soft" color="default">
            {formatTokens(brief.cost.tokens)} tokens{brief.cost.usd != null ? ` · ${formatUsd(brief.cost.usd)}` : ""}
          </Chip>
        ) : null}
        {brief.runId && onOpenRun ? <span className="text-foreground">打开运行详情</span> : null}
      </span>
    </div>
  );
}

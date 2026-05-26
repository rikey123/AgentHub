import { Avatar, Button, Card, Chip } from "@heroui/react";
import type { BriefViewModel } from "../../types.ts";
import { formatTokens, formatUsd, initials } from "../../lib/format.ts";

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
  return (
    <Card variant="secondary" className="mx-3 my-2">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Avatar size="sm">
            <Avatar.Fallback>{initials(brief.agentName)}</Avatar.Fallback>
          </Avatar>
          <Card.Title className="flex-1 text-sm">{brief.agentName}</Card.Title>
          <Chip size="sm" variant="soft" color={kindColor[brief.kind] ?? "default"}>{brief.kind.replace("_", " ")}</Chip>
        </div>
        <Card.Description className="text-sm whitespace-pre-wrap">{brief.summary}</Card.Description>
      </Card.Header>
      <Card.Footer className="gap-2 text-xs">
        {brief.failureReason ? <Chip size="sm" variant="soft" color="danger">{brief.failureClass ?? "failure"}</Chip> : null}
        {brief.artifactCount ? <Chip size="sm" variant="soft" color="default">{brief.artifactCount} artifacts</Chip> : null}
        {brief.cost ? (
          <Chip size="sm" variant="soft" color="default">
            {formatTokens(brief.cost.tokens)} tokens{brief.cost.usd != null ? ` · ${formatUsd(brief.cost.usd)}` : ""}
          </Chip>
        ) : null}
        {brief.runId && onOpenRun ? (
          <Button size="sm" variant="ghost" onPress={() => onOpenRun(brief.runId)}>Open run</Button>
        ) : null}
      </Card.Footer>
    </Card>
  );
}

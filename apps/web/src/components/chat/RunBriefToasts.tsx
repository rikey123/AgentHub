import { useEffect, useRef } from "react";
import { Avatar, Button, Toast } from "@heroui/react";
import type { BriefViewModel } from "../../types.ts";
import { initials } from "../../lib/format.ts";

interface RunBriefToastsProps {
  roomId: string;
  briefs: ReadonlyArray<BriefViewModel>;
  onOpenRun: (runId: string) => void;
}

const notifiedBriefs = new Set<string>();

function briefKey(roomId: string, brief: BriefViewModel, index: number): string {
  return `${roomId}:${brief.runId}:${brief.kind}:${index}`;
}

function briefTitle(brief: BriefViewModel): string {
  switch (brief.kind) {
    case "run_started":
      return `${brief.agentName} started a run`;
    case "run_failed":
      return `${brief.agentName} needs attention`;
    case "run_cancelled":
      return `${brief.agentName} run cancelled`;
    case "phase_completed":
      return `${brief.agentName} finished a phase`;
    case "run_completed":
    default:
      return `${brief.agentName} sent a message`;
  }
}

function briefVariant(brief: BriefViewModel): "accent" | "success" | "warning" | "danger" | "default" {
  if (brief.kind === "run_failed") return "danger";
  if (brief.kind === "run_cancelled") return "default";
  if (brief.kind === "run_completed") return "success";
  return "accent";
}

export function RunBriefToasts({ roomId, briefs, onOpenRun }: RunBriefToastsProps) {
  const initializedRef = useRef(false);
  const roomIdRef = useRef(roomId);

  useEffect(() => {
    if (roomIdRef.current !== roomId) {
      roomIdRef.current = roomId;
      briefs.forEach((brief, index) => notifiedBriefs.add(briefKey(roomId, brief, index)));
      return;
    }

    if (!initializedRef.current) {
      briefs.forEach((brief, index) => notifiedBriefs.add(briefKey(roomId, brief, index)));
      initializedRef.current = true;
      return;
    }

    briefs.forEach((brief, index) => {
      const key = briefKey(roomId, brief, index);
      if (notifiedBriefs.has(key)) return;
      notifiedBriefs.add(key);

      Toast.toast(briefTitle(brief), {
        description: brief.summary || "打开运行详情可查看 transcript、工具调用、产物和成本。",
        variant: briefVariant(brief),
        timeout: 5000,
        ...(brief.runId ? {
          actionProps: {
            children: "Open",
            onPress: () => onOpenRun(brief.runId)
          }
        } : {})
      });
    });
  }, [roomId, briefs, onOpenRun]);

  return (
    <Toast.Provider placement="top end" width={380} maxVisibleToasts={3}>
      {({ toast }) => {
        const content = toast.content;
        const title = typeof content?.title === "string" ? content.title : "Run update";
        const description = typeof content?.description === "string" ? content.description : "";
        const agentName = title.split(" sent ")[0]?.split(" started ")[0]?.split(" needs ")[0]?.split(" run ")[0]?.split(" finished ")[0] ?? "Agent";
        return (
          <Toast toast={toast} variant={content?.variant} className="border border-border bg-overlay/95 shadow-overlay backdrop-blur">
            <Avatar size="sm" className="shrink-0">
              <Avatar.Fallback>{initials(agentName)}</Avatar.Fallback>
            </Avatar>
            <Toast.Content data-testid="run-brief-toast">
              <Toast.Title>{title}</Toast.Title>
              {description ? <Toast.Description>{description}</Toast.Description> : null}
            </Toast.Content>
            {content?.actionProps?.children && content.actionProps.onPress ? (
              <Button size="sm" variant="secondary" onPress={content.actionProps.onPress}>
                {content.actionProps.children}
              </Button>
            ) : null}
            <Toast.CloseButton />
          </Toast>
        );
      }}
    </Toast.Provider>
  );
}

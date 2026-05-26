import { Drawer, Tabs, Chip, ScrollShadow } from "@heroui/react";
import type { RoomViewModel } from "../../types.ts";
import { TranscriptTab } from "./tabs/TranscriptTab.tsx";
import { ToolsTab } from "./tabs/ToolsTab.tsx";
import { ContextTab } from "./tabs/ContextTab.tsx";
import { PermissionsTab } from "./tabs/PermissionsTab.tsx";
import { ArtifactsTab } from "./tabs/ArtifactsTab.tsx";
import { RawStreamTab } from "./tabs/RawStreamTab.tsx";
import { CostTab } from "./tabs/CostTab.tsx";
import { runStatusColor } from "../../lib/status.ts";
import { formatDuration } from "../../lib/format.ts";

interface RunDetailDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  room?: RoomViewModel | undefined;
  runId?: string | undefined;
  csrfFetch: typeof fetch;
}

export function RunDetailDrawer(props: RunDetailDrawerProps) {
  const { room, runId } = props;
  const run = room && runId ? room.runs.find((r) => r.id === runId) : undefined;
  const transcriptCount = room && runId ? room.messages.filter((m) => m.runId === runId).length : 0;
  const permissionCount = room && runId ? room.pendingPermissions.filter((p) => !p.runId || p.runId === runId).length : 0;
  const contextCount = room && runId ? room.contextItems.filter((c) => c.runId === runId || !c.runId).length : 0;
  const duration = run?.startedAt && run?.endedAt ? formatDuration(run.endedAt - run.startedAt) : run?.startedAt ? formatDuration(Date.now() - run.startedAt) : "—";

  return (
    <Drawer.Backdrop isOpen={props.isOpen} onOpenChange={props.onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-[640px] max-w-[90vw]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>{run?.agentName ?? "Run"} — {run?.status ?? "unknown"}</Drawer.Heading>
            {run ? (
              <div className="mt-1 flex items-center gap-2 text-xs">
                <Chip size="sm" variant="soft" color={runStatusColor(run.status)}>{run.status}</Chip>
                <span className="text-muted">Duration: {duration}</span>
                <span className="ah-mono text-muted">{run.id.slice(0, 8)}</span>
              </div>
            ) : null}
          </Drawer.Header>
          <Drawer.Body className="p-0">
            {!room || !runId ? (
              <div className="p-6 text-center text-sm text-muted">No run selected.</div>
            ) : (
              <Tabs defaultSelectedKey="transcript" className="flex h-full min-h-0 flex-col">
                <Tabs.ListContainer>
                  <Tabs.List aria-label="Run detail">
                    <Tabs.Tab id="transcript">Transcript<Chip className="ml-1" size="sm" variant="soft" color="default">{transcriptCount}</Chip><Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="tools"><Tabs.Separator />Tools<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="context"><Tabs.Separator />Context<Chip className="ml-1" size="sm" variant="soft" color="default">{contextCount}</Chip><Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="perms"><Tabs.Separator />Permissions<Chip className="ml-1" size="sm" variant="soft" color="default">{permissionCount}</Chip><Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="artifacts"><Tabs.Separator />Artifacts<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="raw"><Tabs.Separator />Raw<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="cost"><Tabs.Separator />Cost<Tabs.Indicator /></Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
                <ScrollShadow className="flex-1 min-h-0 overflow-auto" orientation="vertical">
                  <Tabs.Panel id="transcript"><TranscriptTab room={room} runId={runId} /></Tabs.Panel>
                  <Tabs.Panel id="tools"><ToolsTab room={room} runId={runId} /></Tabs.Panel>
                  <Tabs.Panel id="context"><ContextTab room={room} runId={runId} /></Tabs.Panel>
                  <Tabs.Panel id="perms"><PermissionsTab room={room} runId={runId} /></Tabs.Panel>
                  <Tabs.Panel id="artifacts"><ArtifactsTab room={room} runId={runId} csrfFetch={props.csrfFetch} /></Tabs.Panel>
                  <Tabs.Panel id="raw"><RawStreamTab roomId={room.id} runId={runId} /></Tabs.Panel>
                  <Tabs.Panel id="cost">{run ? <CostTab run={run} /> : null}</Tabs.Panel>
                </ScrollShadow>
              </Tabs>
            )}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

import { useState } from "react";
import { Drawer, Tabs, Chip, ScrollShadow, Skeleton } from "@heroui/react";
import type { RoomViewModel, TaskViewModel } from "../../types.ts";
import { TranscriptTab } from "./tabs/TranscriptTab.tsx";
import { ToolsTab } from "./tabs/ToolsTab.tsx";
import { ContextTab } from "./tabs/ContextTab.tsx";
import { PermissionsTab } from "./tabs/PermissionsTab.tsx";
import { ArtifactsTab } from "./tabs/ArtifactsTab.tsx";
import { RawStreamTab } from "./tabs/RawStreamTab.tsx";
import { CostTab } from "./tabs/CostTab.tsx";
import { runStatusColor, taskStatusColor } from "../../lib/status.ts";
import { formatDuration } from "../../lib/format.ts";

interface RunDetailDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  room?: RoomViewModel | undefined;
  runId?: string | undefined;
  onOpenRun?: ((runId: string) => void) | undefined;
  csrfFetch: typeof fetch;
}

export function RunDetailDrawer(props: RunDetailDrawerProps) {
  const { room, runId } = props;
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const run = room && runId ? room.runs.find((r) => r.id === runId) : undefined;
  const selectedTask = room && selectedTaskId ? room.tasks.find((task) => task.id === selectedTaskId) : undefined;
  const transcriptCount = room && runId ? room.messages.filter((m) => m.runId === runId).length : 0;
  const permissionCount = room && runId ? room.pendingPermissions.filter((p) => !p.runId || p.runId === runId).length : 0;
  const contextCount = room && runId ? room.contextItems.filter((c) => c.runId === runId || !c.runId).length : 0;
  const duration = run?.startedAt && run?.endedAt ? formatDuration(run.endedAt - run.startedAt) : run?.startedAt ? formatDuration(Date.now() - run.startedAt) : "-";

  const handleOpenRun = (nextRunId: string) => {
    setSelectedTaskId(undefined);
    props.onOpenRun?.(nextRunId);
  };

  return (
    <>
    <Drawer.Backdrop isOpen={props.isOpen} onOpenChange={props.onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-[640px] max-w-[90vw]">
          <Drawer.CloseTrigger aria-label="Close run detail" />
          <Drawer.Header>
            <Drawer.Heading>{run?.agentName ?? "Run"} - {run?.status ?? "unknown"}</Drawer.Heading>
            {run ? (
              <div className="mt-1 flex items-center gap-2 text-xs">
                <Chip size="sm" variant="soft" color={runStatusColor(run.status)}>{run.status}</Chip>
                <span className="text-muted">Duration: {duration}</span>
                <span className="ah-mono text-muted">{run.id.slice(0, 8)}</span>
              </div>
            ) : null}
          </Drawer.Header>
          <Drawer.Body className="p-0">
            {!runId ? (
              <div className="p-6 text-center text-sm text-muted">No run selected.</div>
            ) : !room || !run ? (
              <div className="flex flex-col gap-3 p-6" aria-label="Loading run">
                <Skeleton className="h-4 w-2/3 rounded" />
                <Skeleton className="h-4 w-1/2 rounded" />
                <Skeleton className="h-4 w-3/4 rounded" />
              </div>
            ) : (
              <div data-testid="run-detail-tabs" className="flex h-full min-h-0 flex-col">
                <Tabs defaultSelectedKey="transcript" className="flex h-full min-h-0 flex-col">
                  <Tabs.ListContainer>
                    <Tabs.List aria-label="Run detail">
                      <Tabs.Tab id="transcript" data-testid="run-detail-tab-transcript">Transcript<Chip className="ml-1" size="sm" variant="soft" color="default">{transcriptCount}</Chip><Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="tools" data-testid="run-detail-tab-tools"><Tabs.Separator />Tools<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="context" data-testid="run-detail-tab-context"><Tabs.Separator />Context<Chip className="ml-1" size="sm" variant="soft" color="default">{contextCount}</Chip><Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="perms" data-testid="run-detail-tab-permissions"><Tabs.Separator />Permissions<Chip className="ml-1" size="sm" variant="soft" color="default">{permissionCount}</Chip><Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="artifacts" data-testid="run-detail-tab-artifacts"><Tabs.Separator />Artifacts<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="raw" data-testid="run-detail-tab-raw"><Tabs.Separator />Raw<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="cost" data-testid="run-detail-tab-cost"><Tabs.Separator />Cost<Tabs.Indicator /></Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                  <ScrollShadow className="flex-1 min-h-0 overflow-auto" orientation="vertical">
                    <Tabs.Panel id="transcript"><TranscriptTab room={room} runId={runId} /></Tabs.Panel>
                    <Tabs.Panel id="tools"><ToolsTab room={room} runId={runId} onOpenRun={handleOpenRun} onOpenTask={setSelectedTaskId} /></Tabs.Panel>
                    <Tabs.Panel id="context"><ContextTab room={room} runId={runId} /></Tabs.Panel>
                    <Tabs.Panel id="perms"><PermissionsTab room={room} runId={runId} /></Tabs.Panel>
                    <Tabs.Panel id="artifacts"><ArtifactsTab room={room} runId={runId} csrfFetch={props.csrfFetch} /></Tabs.Panel>
                    <Tabs.Panel id="raw"><RawStreamTab roomId={room.id} runId={runId} /></Tabs.Panel>
                    <Tabs.Panel id="cost">{run ? <CostTab run={run} csrfFetch={props.csrfFetch} /> : null}</Tabs.Panel>
                  </ScrollShadow>
                </Tabs>
              </div>
            )}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
    <TaskDetailDrawer task={selectedTask} isOpen={!!selectedTask} onOpenChange={(open) => { if (!open) setSelectedTaskId(undefined); }} />
    </>
  );
}

function TaskDetailDrawer({ task, isOpen, onOpenChange }: { task?: TaskViewModel | undefined; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-[420px] max-w-[88vw]">
          <Drawer.CloseTrigger aria-label="Close task detail" />
          <Drawer.Header>
            <Drawer.Heading>{task?.title ?? "Task"}</Drawer.Heading>
            {task ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <Chip size="sm" variant="soft" color={taskStatusColor(task.status)}>{task.status}</Chip>
                {task.priority ? <Chip size="sm" variant="soft" color="default">{task.priority}</Chip> : null}
                <span className="ah-mono text-muted">{task.id}</span>
              </div>
            ) : null}
          </Drawer.Header>
          <Drawer.Body>
            {task ? (
              <div data-testid="task-detail-drawer" className="flex flex-col gap-3 text-sm">
                {task.description ? <p className="whitespace-pre-wrap text-muted">{task.description}</p> : <p className="text-muted">No description.</p>}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                  <dt className="font-semibold text-muted">Assignee</dt>
                  <dd>{task.assigneeAgentId ?? task.assigneeRoleId ?? "Unassigned"}</dd>
                  <dt className="font-semibold text-muted">Parent task</dt>
                  <dd className="ah-mono">{task.parentTaskId ?? "-"}</dd>
                  <dt className="font-semibold text-muted">Source run</dt>
                  <dd className="ah-mono">{task.sourceRunId ?? "-"}</dd>
                </dl>
              </div>
            ) : null}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

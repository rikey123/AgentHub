import { useEffect, useState } from "react";
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
  const [selectedTab, setSelectedTab] = useState(() => initialRunDetailTab());
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

  useEffect(() => {
    const syncFromHash = () => {
      if (artifactHashTarget()) {
        setSelectedTab("artifacts");
      }
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  useEffect(() => {
    if (selectedTab !== "artifacts") return;
    return scrollArtifactHashTarget();
  }, [room, runId, selectedTab]);

  return (
    <>
    <Drawer.Backdrop isOpen={props.isOpen} onOpenChange={props.onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-[640px] max-w-[90vw]">
          <Drawer.CloseTrigger aria-label="关闭运行详情" />
          <Drawer.Header>
            <Drawer.Heading>{run?.agentName ?? "运行"} - {run?.status ?? "unknown"}</Drawer.Heading>
            {run ? (
              <div className="mt-1 flex items-center gap-2 text-xs">
                <Chip size="sm" variant="soft" color={runStatusColor(run.status)}>{run.status}</Chip>
                <span className="text-muted">耗时：{duration}</span>
                <span className="ah-mono text-muted">{run.id.slice(0, 8)}</span>
              </div>
            ) : null}
          </Drawer.Header>
          <Drawer.Body className="p-0">
            {!runId ? (
              <div className="p-6 text-center text-sm text-muted">未选择运行。</div>
            ) : !room || !run ? (
              <div className="flex flex-col gap-3 p-6" aria-label="正在加载运行">
                <Skeleton className="h-4 w-2/3 rounded" />
                <Skeleton className="h-4 w-1/2 rounded" />
                <Skeleton className="h-4 w-3/4 rounded" />
              </div>
            ) : (
              <div data-testid="run-detail-tabs" className="flex h-full min-h-0 flex-col">
                <Tabs selectedKey={selectedTab} onSelectionChange={(key) => setSelectedTab(String(key))} className="flex h-full min-h-0 flex-col">
                  <Tabs.ListContainer>
                    <Tabs.List aria-label="运行详情">
                      <Tabs.Tab id="transcript" data-testid="run-detail-tab-transcript">转录<Chip className="ml-1" size="sm" variant="soft" color="default">{transcriptCount}</Chip><Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="tools" data-testid="run-detail-tab-tools"><Tabs.Separator />工具<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="context" data-testid="run-detail-tab-context"><Tabs.Separator />上下文<Chip className="ml-1" size="sm" variant="soft" color="default">{contextCount}</Chip><Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="perms" data-testid="run-detail-tab-permissions"><Tabs.Separator />许可<Chip className="ml-1" size="sm" variant="soft" color="default">{permissionCount}</Chip><Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="artifacts" data-testid="run-detail-tab-artifacts"><Tabs.Separator />产物<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="raw" data-testid="run-detail-tab-raw"><Tabs.Separator />原始<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="cost" data-testid="run-detail-tab-cost"><Tabs.Separator />成本<Tabs.Indicator /></Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                  <ScrollShadow className="flex-1 min-h-0 overflow-auto" orientation="vertical">
                    <Tabs.Panel id="transcript"><TranscriptTab room={room} runId={runId} /></Tabs.Panel>
                    <Tabs.Panel id="tools"><ToolsTab room={room} runId={runId} onOpenRun={handleOpenRun} onOpenTask={setSelectedTaskId} /></Tabs.Panel>
                    <Tabs.Panel id="context"><ContextTab room={room} runId={runId} /></Tabs.Panel>
                    <Tabs.Panel id="perms"><PermissionsTab room={room} runId={runId} csrfFetch={props.csrfFetch} /></Tabs.Panel>
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

function initialRunDetailTab(): string {
  return artifactHashTarget() ? "artifacts" : "transcript";
}

export function artifactHashTarget(hash = typeof window !== "undefined" ? window.location.hash : ""): { artifactId: string; path: string; elementId: string } | undefined {
  if (!hash.startsWith("#artifact:")) return undefined;
  const [, artifactIdPart, ...pathParts] = hash.split(":");
  const pathPart = pathParts.join(":");
  if (!artifactIdPart || !pathPart) return undefined;
  try {
    const artifactId = decodeURIComponent(artifactIdPart);
    const path = decodeURIComponent(pathPart);
    return {
      artifactId,
      path,
      elementId: `artifact-file-${encodeURIComponent(artifactId)}-${encodeURIComponent(path)}`
    };
  } catch {
    return undefined;
  }
}

export function scrollArtifactHashTarget(hash = typeof window !== "undefined" ? window.location.hash : ""): () => void {
  const target = artifactHashTarget(hash);
  if (!target || typeof document === "undefined") return () => {};
  let cancelled = false;
  let found = false;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  const attempt = () => {
    if (cancelled || found) return;
    const element = document.getElementById(target.elementId);
    if (!element) return;
    found = true;
    element.scrollIntoView({ block: "center" });
    element.classList.add("ah-artifact-file-highlight");
    highlightTimer = setTimeout(() => {
      element.classList.remove("ah-artifact-file-highlight");
    }, 800);
  };

  attempt();
  for (const delay of [50, 150, 300]) {
    timers.push(setTimeout(attempt, delay));
  }

  return () => {
    cancelled = true;
    for (const timer of timers) clearTimeout(timer);
    if (highlightTimer) clearTimeout(highlightTimer);
  };
}

function TaskDetailDrawer({ task, isOpen, onOpenChange }: { task?: TaskViewModel | undefined; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-[420px] max-w-[88vw]">
          <Drawer.CloseTrigger aria-label="关闭任务详情" />
          <Drawer.Header>
            <Drawer.Heading>{task?.title ?? "任务"}</Drawer.Heading>
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
                {task.description ? <p className="whitespace-pre-wrap text-muted">{task.description}</p> : <p className="text-muted">暂无描述。</p>}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                  <dt className="font-semibold text-muted">负责人</dt>
                  <dd>{task.assigneeAgentId ?? task.assigneeRoleId ?? "未分配"}</dd>
                  <dt className="font-semibold text-muted">父任务</dt>
                  <dd className="ah-mono">{task.parentTaskId ?? "-"}</dd>
                  <dt className="font-semibold text-muted">来源运行</dt>
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

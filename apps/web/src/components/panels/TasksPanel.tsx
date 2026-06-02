import { Avatar, Button, Card, Chip, Drawer, ScrollShadow } from "@heroui/react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { RoomExecutionPlanViewModel, TaskActivityViewModel, TaskFileChangeRunViewModel, TaskViewModel, WorktreeReviewViewModel } from "../../types.ts";
import { formatRelativeTime, formatTime, initials, truncate } from "../../lib/format.ts";
import { taskStatusColor, type ChipColor } from "../../lib/status.ts";

export const KANBAN_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting", label: "Waiting" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" }
] as const;

const KANBAN_COLUMN_LABELS = KANBAN_COLUMNS.map((column) => column.label);

export type KanbanColumnLabel = (typeof KANBAN_COLUMNS)[number]["label"];

export type TaskStatusGroup = (typeof KANBAN_COLUMNS)[number] & {
  readonly items: TaskViewModel[];
};

type TaskDetail = {
  readonly task: TaskViewModel;
  readonly parent?: TaskViewModel | undefined;
  readonly children: TaskViewModel[];
  readonly activities: TaskActivityViewModel[];
};

type ExecutionPlan = {
  readonly id: string;
  readonly runId: string;
  readonly plan: unknown;
  readonly createdAt: number;
};

type DependencyLine = {
  readonly fromTaskId: string;
  readonly toTaskId: string;
};

type PositionedDependencyLine = DependencyLine & {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

type TaskCardRect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
};

export function defaultColumnForStatus(status: string): KanbanColumnLabel | undefined {
  switch (status) {
    case "pending":
      return "Backlog";
    case "in_progress":
      return "In Progress";
    case "blocked":
      return "Waiting";
    case "review":
      return "Review";
    case "completed":
      return "Done";
    case "cancelled":
      return undefined;
    default:
      return "Backlog";
  }
}

export function taskColumn(task: TaskViewModel): KanbanColumnLabel | undefined {
  if (task.status === "cancelled") return undefined;
  return isKanbanColumn(task.boardColumn) ? task.boardColumn : defaultColumnForStatus(task.status);
}

export function groupTasksByKanbanColumn(tasks: ReadonlyArray<TaskViewModel>): TaskStatusGroup[] {
  return KANBAN_COLUMNS.map((column) => ({
    ...column,
    items: tasks.filter((task) => taskColumn(task) === column.label)
  }));
}

export function getTaskDetail(tasks: ReadonlyArray<TaskViewModel>, taskId: string | undefined): TaskDetail | undefined {
  if (!taskId) return undefined;
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return undefined;
  return {
    task,
    parent: task.parentTaskId ? tasks.find((item) => item.id === task.parentTaskId) : undefined,
    children: tasks.filter((item) => item.parentTaskId === task.id),
    activities: [...(task.activities ?? [])].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  };
}

export function taskUpdatedAt(task: TaskViewModel): number | undefined {
  const timestamps = [
    ...(task.activities ?? []).map((activity) => activity.createdAt),
    ...(task.delegations ?? []).flatMap((delegation) => [delegation.completedAt, delegation.createdAt]),
    ...(task.fileChangeRuns ?? []).map((run) => run.createdAt),
    ...(task.worktreeReviews ?? []).map((review) => review.updatedAt)
  ].filter((value): value is number => typeof value === "number");
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
}

export function summarizeTaskActivityPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "No payload";
  if (typeof payload === "string") return payload;
  if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
  if (!isRecord(payload)) return "Payload recorded";

  const preferredKeys = ["comment", "message", "summary", "reason", "status", "artifactPath", "artifactId", "runId", "blocker", "blockerReason", "text"];
  for (const key of preferredKeys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }

  return Object.entries(payload)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" / ") || "Payload recorded";
}

export function unresolvedDependencyCount(task: TaskViewModel, tasks: ReadonlyArray<TaskViewModel>): number {
  const taskById = new Map(tasks.map((item) => [item.id, item]));
  return (task.dependencies ?? []).filter((dependencyId) => taskById.get(dependencyId)?.status !== "completed").length;
}

export function dependencyLines(tasks: ReadonlyArray<TaskViewModel>): DependencyLine[] {
  const visibleIds = new Set(tasks.filter((task) => taskColumn(task) !== undefined).map((task) => task.id));
  return tasks.flatMap((task) =>
    (task.dependencies ?? [])
      .filter((dependencyId) => visibleIds.has(dependencyId) && visibleIds.has(task.id))
      .map((dependencyId) => ({ fromTaskId: dependencyId, toTaskId: task.id }))
  );
}

export function aggregateFileChanges(task: TaskViewModel): number {
  return task.fileChangeRuns?.reduce((total, run) => total + run.files.length, 0) ?? task.fileChangesCount ?? 0;
}

export function latestWorktreeReview(task: TaskViewModel): WorktreeReviewViewModel | undefined {
  return [...(task.worktreeReviews ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function positionDependencyLines(lines: readonly DependencyLine[], boardRect: TaskCardRect, cardRects: ReadonlyMap<string, TaskCardRect>): PositionedDependencyLine[] {
  return lines.flatMap((line) => {
    const from = cardRects.get(line.fromTaskId);
    const to = cardRects.get(line.toTaskId);
    if (!from || !to) return [];
    const fromCenterX = from.left + from.width / 2;
    const toCenterX = to.left + to.width / 2;
    const fromRight = from.left + from.width;
    const toLeft = to.left;
    const fromLeft = from.left;
    const toRight = to.left + to.width;
    const x1 = fromCenterX <= toCenterX ? fromRight : fromLeft;
    const x2 = fromCenterX <= toCenterX ? toLeft : toRight;
    return [{
      ...line,
      x1: x1 - boardRect.left,
      y1: from.top + from.height / 2 - boardRect.top,
      x2: x2 - boardRect.left,
      y2: to.top + to.height / 2 - boardRect.top
    }];
  });
}

export function roomExecutionPlan(plan: RoomExecutionPlanViewModel | undefined): ExecutionPlan | null {
  if (!plan) return null;
  return {
    id: plan.planId,
    runId: plan.runId,
    plan: plan.planJson,
    createdAt: plan.createdAt
  };
}

export function fileArtifactTarget(run: TaskFileChangeRunViewModel, file: TaskFileChangeRunViewModel["files"][number]): { readonly artifactId: string; readonly href: string } | undefined {
  const artifactId = file.artifactId ?? run.artifactId;
  if (!artifactId) return undefined;
  return {
    artifactId,
    href: `#artifact:${encodeURIComponent(artifactId)}:${encodeURIComponent(file.path)}`
  };
}

export function TasksPanel({ roomId, tasks, csrfFetch, executionPlan, onOpenArtifact }: { roomId: string; tasks: ReadonlyArray<TaskViewModel>; csrfFetch: typeof fetch; executionPlan?: RoomExecutionPlanViewModel | undefined; onOpenArtifact?: ((input: { artifactId: string; runId: string; path: string }) => void) | undefined }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(() => groupTasksByKanbanColumn(tasks), [tasks]);
  const visibleTasks = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const detail = useMemo(() => getTaskDetail(tasks, selectedTaskId), [tasks, selectedTaskId]);
  const plan = useMemo(() => roomExecutionPlan(executionPlan), [executionPlan]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const columnIds = useMemo(() => new Set(KANBAN_COLUMNS.map((column) => column.label)), []);
  const collisionDetection = useMemo(() => makeKanbanCollision(columnIds), [columnIds]);

  const handleDragEnd = (event: DragEndEvent) => {
    const taskId = String(event.active.id);
    const targetColumn = overColumn(event.over?.id, groups);
    setLayoutVersion((version) => version + 1);
    if (!targetColumn) return;
    const task = tasks.find((item) => item.id === taskId);
    if (!task || taskColumn(task) === targetColumn) return;
    setActionError(undefined);
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/tasks/${encodeURIComponent(taskId)}/column`, {
      method: "POST",
      body: JSON.stringify({ column: targetColumn })
    }).catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)));
  };

  if (tasks.length === 0) {
    return <div className="p-6 text-center text-sm text-muted">No tasks yet.</div>;
  }

  return (
    <>
      <div className="flex min-h-[480px] flex-col gap-3 p-3" data-testid="tasks-panel-kanban">
        {actionError ? (
          <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-900 dark:border-danger-800 dark:bg-danger-950/40 dark:text-danger-100">
            {actionError}
          </div>
        ) : null}
        {plan ? <ExecutionPlanCard plan={plan} /> : null}
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
          <div ref={boardRef} className="relative min-h-[420px] overflow-x-auto pb-2">
            <DependencyArrowOverlay lines={dependencyLines(visibleTasks)} layoutVersion={layoutVersion} scrollElementRef={boardRef} />
            <div className="relative z-10 grid min-w-[760px] grid-cols-5 gap-2">
              {groups.map((group) => (
                <TaskColumn key={group.key} group={group} allTasks={tasks} onOpenTask={setSelectedTaskId} />
              ))}
            </div>
          </div>
        </DndContext>
      </div>
      <TaskDetailDrawer
        roomId={roomId}
        detail={detail}
        plan={plan}
        csrfFetch={csrfFetch}
        onOpenArtifact={onOpenArtifact}
        isOpen={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(undefined);
        }}
      />
    </>
  );
}

function TaskColumn({ group, allTasks, onOpenTask }: { group: TaskStatusGroup; allTasks: ReadonlyArray<TaskViewModel>; onOpenTask: (taskId: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: group.label });

  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface-secondary/70 p-2" aria-label={`${group.label} tasks`}>
      <header className="mb-2 flex h-7 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase text-muted">{group.label}</h3>
        <Chip size="sm" variant="soft" color="default">{group.items.length}</Chip>
      </header>
      <div ref={setNodeRef} className={`flex min-h-[360px] flex-col gap-2 rounded-md p-1 transition-colors ${isOver ? "bg-accent-soft" : ""}`}>
        <SortableContext items={group.items.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {group.items.map((task) => (
            <TaskKanbanCard key={task.id} task={task} allTasks={allTasks} onOpen={() => onOpenTask(task.id)} />
          ))}
        </SortableContext>
        {group.items.length === 0 ? <p className="py-8 text-center text-xs text-muted">None.</p> : null}
      </div>
    </section>
  );
}

function TaskKanbanCard({ task, allTasks, onOpen }: { task: TaskViewModel; allTasks: ReadonlyArray<TaskViewModel>; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const updatedAt = taskUpdatedAt(task);
  const assignee = task.assigneeRoleId ?? task.assigneeAgentId ?? "Unassigned";
  const unresolved = unresolvedDependencyCount(task, allTasks);
  const fileCount = aggregateFileChanges(task);
  const worktree = latestWorktreeReview(task);
  const turnCount = task.delegations?.filter((delegation) => delegation.runId !== undefined).length ?? 0;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      id={`task-card-${task.id}`}
      data-task-id={task.id}
      variant="transparent"
      className={`border border-border bg-surface ${isDragging ? "opacity-70 shadow-lg" : ""}`}
    >
      <div className="flex flex-col gap-2 px-2.5 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            className="mt-0.5 h-5 w-5 shrink-0 cursor-grab rounded border border-border bg-surface-secondary text-xs text-muted"
            aria-label={`Drag task ${task.title}`}
            {...attributes}
            {...listeners}
          >
            ::
          </button>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen} aria-label={`Open task ${task.title}`}>
            <span className="block truncate text-sm font-medium">{task.title}</span>
            <span className="mt-1 block truncate text-xs text-muted">{task.description?.trim() || "No description"}</span>
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          <Chip size="sm" variant="soft" color={priorityColor(task.priority)}>{priorityLabel(task.priority)}</Chip>
          <Chip size="sm" variant="soft" color={taskStatusColor(task.status)}>{task.status}</Chip>
          {task.blockerReason ? <Chip size="sm" variant="soft" color="danger">Blocked</Chip> : null}
          {task.blockerReason === "missing_completion_report" ? <Chip size="sm" variant="soft" color="warning">Missing report</Chip> : null}
          {fileCount > 0 ? <Chip size="sm" variant="soft" color="accent">{fileCount} files</Chip> : null}
          {unresolved > 0 ? <Chip size="sm" variant="soft" color="warning">Waiting on {unresolved}</Chip> : null}
          {task.maxTurns !== undefined ? <Chip size="sm" variant="soft" color="default">{turnCount}/{task.maxTurns} turns</Chip> : null}
          {worktree?.status === "ready_for_review" ? <Chip size="sm" variant="soft" color="success">Ready</Chip> : null}
          {worktree?.status === "conflict" ? <Chip size="sm" variant="soft" color="danger">Conflict</Chip> : null}
        </div>
        {task.blockerReason ? <p className="line-clamp-2 text-xs text-danger-700 dark:text-danger-200">{humanizeReason(task.blockerReason)}</p> : null}
        <div className="flex items-center gap-2 text-xs text-muted">
          <Avatar className="h-5 w-5 text-[10px]"><Avatar.Fallback>{initials(assignee)}</Avatar.Fallback></Avatar>
          <span className="min-w-0 flex-1 truncate">{assignee}</span>
          <span className="shrink-0">{updatedAt ? formatRelativeTime(updatedAt) : "-"}</span>
        </div>
      </div>
    </Card>
  );
}

function DependencyArrowOverlay({ lines, layoutVersion, scrollElementRef }: { lines: readonly DependencyLine[]; layoutVersion: number; scrollElementRef?: React.RefObject<HTMLElement | null> | undefined }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [positionedLines, setPositionedLines] = useState<PositionedDependencyLine[]>([]);

  const measure = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const boardRect = rectFromDomRect(svg.getBoundingClientRect());
    const cardRects = new Map<string, TaskCardRect>();
    for (const line of lines) {
      for (const taskId of [line.fromTaskId, line.toTaskId]) {
        if (cardRects.has(taskId)) continue;
        const element = document.getElementById(`task-card-${taskId}`);
        if (element) cardRects.set(taskId, rectFromDomRect(element.getBoundingClientRect()));
      }
    }
    setPositionedLines(positionDependencyLines(lines, boardRect, cardRects));
  }, [lines]);

  useEffect(() => {
    measure();
  }, [layoutVersion, measure]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observed = new Set<Element>([svg]);
    for (const line of lines) {
      const from = document.getElementById(`task-card-${line.fromTaskId}`);
      const to = document.getElementById(`task-card-${line.toTaskId}`);
      if (from) observed.add(from);
      if (to) observed.add(to);
    }

    let frame: number | undefined;
    const schedule = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const ResizeObserverCtor = typeof ResizeObserver === "undefined" ? undefined : ResizeObserver;
    const observer = ResizeObserverCtor ? new ResizeObserverCtor(schedule) : undefined;
    for (const element of observed) observer?.observe(element);
    const scrollElement = scrollElementRef?.current;
    window.addEventListener("resize", schedule);
    scrollElement?.addEventListener("scroll", schedule, { passive: true });
    schedule();

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      scrollElement?.removeEventListener("scroll", schedule);
    };
  }, [lines, measure, scrollElementRef]);

  return (
    <svg ref={svgRef} className="pointer-events-none absolute inset-0 z-0 h-full w-full" aria-hidden="true" data-testid="dependency-arrow-overlay">
      <defs>
        <marker id="dependency-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
        </marker>
      </defs>
      {positionedLines.map((line, index) => (
        <line
          key={`${line.fromTaskId}:${line.toTaskId}:${index}`}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          markerEnd="url(#dependency-arrow)"
          opacity="0.45"
        />
      ))}
    </svg>
  );
}

function TaskDetailDrawer({ roomId, detail, plan, csrfFetch, onOpenArtifact, isOpen, onOpenChange }: { roomId: string; detail: TaskDetail | undefined; plan: ExecutionPlan | null; csrfFetch: typeof fetch; onOpenArtifact?: ((input: { artifactId: string; runId: string; path: string }) => void) | undefined; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const task = detail?.task;
  const assignee = task ? task.assigneeRoleId ?? task.assigneeAgentId ?? "Unassigned" : "Unassigned";

  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-[560px] max-w-[94vw]" aria-label="Task detail">
          <Drawer.CloseTrigger aria-label="Close task detail" />
          <Drawer.Header>
            <Drawer.Heading>{task?.title ?? "Task"}</Drawer.Heading>
            {task ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Chip size="sm" variant="soft" color={priorityColor(task.priority)}>{priorityLabel(task.priority)}</Chip>
                <Chip size="sm" variant="soft" color={taskStatusColor(task.status)}>{task.status}</Chip>
                <span className="text-muted">Updated {taskUpdatedAt(task) ? formatRelativeTime(taskUpdatedAt(task)!) : "-"}</span>
              </div>
            ) : null}
          </Drawer.Header>
          <Drawer.Body className="p-0">
            {!detail || !task ? (
              <div className="p-6 text-center text-sm text-muted">No task selected.</div>
            ) : (
              <ScrollShadow className="max-h-[calc(100vh-9rem)] overflow-auto" orientation="vertical">
                <div className="flex flex-col gap-3 p-4">
                  {plan ? <ExecutionPlanCard plan={plan} compact /> : null}
                  <DetailCard title="Description">
                    <p className="whitespace-pre-wrap text-sm text-muted">{task.description?.trim() || "No description provided."}</p>
                  </DetailCard>

                  <DetailCard title="Assignee">
                    <div className="flex items-center gap-2 text-sm">
                      <Avatar className="h-7 w-7 text-xs"><Avatar.Fallback>{initials(assignee)}</Avatar.Fallback></Avatar>
                      <span>{assignee}</span>
                    </div>
                  </DetailCard>

                  <DetailCard title="Parent + children">
                    <div className="flex flex-col gap-2 text-sm">
                      <RelationRow label="Parent" value={detail.parent ? detail.parent.title : task.parentTaskId ?? "None"} muted={!detail.parent && !task.parentTaskId} />
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase text-muted">Children</div>
                        {detail.children.length === 0 ? (
                          <p className="text-xs text-muted">None.</p>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {detail.children.map((child) => (
                              <li key={child.id} className="rounded-lg border border-border bg-surface-secondary px-2 py-1">
                                <div className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                                  <Chip size="sm" variant="soft" color={taskStatusColor(child.status)}>{child.status}</Chip>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </DetailCard>

                  <FileChangesSection runs={task.fileChangeRuns ?? []} fallbackCount={task.fileChangesCount ?? 0} onOpenArtifact={onOpenArtifact} />
                  <WorktreeSection roomId={roomId} task={task} csrfFetch={csrfFetch} />

                  <DetailCard title="Activity timeline">
                    <ActivityTimeline activities={detail.activities} />
                  </DetailCard>
                </div>
              </ScrollShadow>
            )}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

function ExecutionPlanCard({ plan, compact = false }: { plan: ExecutionPlan; compact?: boolean }) {
  const parsed = isRecord(plan.plan) ? plan.plan : {};
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return (
    <Card variant="transparent" className="border border-border">
      <Card.Header>
        <Card.Title className={compact ? "text-sm" : "text-sm"}>Execution Plan</Card.Title>
      </Card.Header>
      <Card.Content>
        <details open={!compact}>
          <summary className="cursor-pointer text-xs text-muted">{typeof parsed.goal === "string" ? parsed.goal : `Plan ${plan.id}`}</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {tasks.slice(0, compact ? 5 : 8).map((item, index) => {
              const record = isRecord(item) ? item : {};
              return (
                <li key={`${plan.id}:${index}`} className="rounded-md border border-border bg-surface-secondary px-2 py-1 text-xs">
                  <div className="font-medium">{typeof record.title === "string" ? record.title : `Task ${index + 1}`}</div>
                  {typeof record.assigneeRole === "string" ? <div className="text-muted">{record.assigneeRole}</div> : null}
                </li>
              );
            })}
          </ul>
        </details>
      </Card.Content>
    </Card>
  );
}

function FileChangesSection({ runs, fallbackCount, onOpenArtifact }: { runs: readonly TaskFileChangeRunViewModel[]; fallbackCount: number; onOpenArtifact?: ((input: { artifactId: string; runId: string; path: string }) => void) | undefined }) {
  return (
    <DetailCard title="File changes">
      {runs.length === 0 ? (
        <p className="text-sm text-muted">{fallbackCount > 0 ? `${fallbackCount} files changed.` : "No file changes recorded."}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {[...runs].sort((a, b) => b.createdAt - a.createdAt).map((run) => (
            <div key={run.runId} className="rounded-lg border border-border bg-surface-secondary px-2 py-2">
              <div className="mb-1 flex items-center gap-2 text-xs">
                <Chip size="sm" variant="soft" color="default">{run.files.length} files</Chip>
                <a className="min-w-0 truncate text-accent-soft-foreground" href={`#run:${encodeURIComponent(run.runId)}`}>{run.runId}</a>
              </div>
              <ul className="flex flex-col gap-1">
                {run.files.map((file) => {
                  const target = fileArtifactTarget(run, file);
                  return (
                    <li key={`${run.runId}:${file.path}`} className="flex items-center gap-2 text-xs">
                      <Chip size="sm" variant="soft" color={fileChangeColor(file.change)}>{file.change}</Chip>
                      {target ? (
                        <a
                          className="min-w-0 flex-1 truncate text-accent-soft-foreground ah-mono"
                          href={target.href}
                          onClick={() => onOpenArtifact?.({ artifactId: target.artifactId, runId: run.runId, path: file.path })}
                        >
                          {file.path}
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate ah-mono">{file.path}</span>
                      )}
                      <span className="shrink-0 text-muted">+{file.linesAdded ?? 0} / -{file.linesRemoved ?? 0}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </DetailCard>
  );
}

function WorktreeSection({ roomId, task, csrfFetch }: { roomId: string; task: TaskViewModel; csrfFetch: typeof fetch }) {
  const [pending, setPending] = useState<"apply" | "discard" | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const review = latestWorktreeReview(task);

  if (!review || (review.status !== "ready_for_review" && review.status !== "conflict")) {
    return (
      <DetailCard title="Worktree">
        <p className="text-sm text-muted">No pending worktree changes.</p>
      </DetailCard>
    );
  }

  const apply = () => {
    setPending("apply");
    setError(undefined);
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/worktrees/${encodeURIComponent(review.runId)}/apply`, { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error(`Apply failed with ${res.status}`);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPending(undefined));
  };

  const discard = () => {
    if (!window.confirm("Discard worktree changes?")) return;
    setPending("discard");
    setError(undefined);
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/worktrees/${encodeURIComponent(review.runId)}/discard`, { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error(`Discard failed with ${res.status}`);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPending(undefined));
  };

  return (
    <DetailCard title="Worktree">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Chip size="sm" variant="soft" color={review.status === "conflict" ? "danger" : "success"}>{review.status === "conflict" ? "Merge conflict" : "Changes ready to apply"}</Chip>
          {review.artifactId ? <Chip size="sm" variant="soft" color="default">{review.artifactId}</Chip> : null}
        </div>
        {review.filesChanged && review.filesChanged.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs">
            {review.filesChanged.map((path) => <li key={path} className="truncate ah-mono">{path}</li>)}
          </ul>
        ) : null}
        {review.conflictDiff ? <pre className="max-h-40 overflow-auto rounded-md bg-surface-secondary p-2 text-xs ah-mono">{review.conflictDiff}</pre> : null}
        {error ? <p className="text-xs text-danger-700 dark:text-danger-200">{error}</p> : null}
        <div className="flex gap-2">
          {review.status === "ready_for_review" ? <Button size="sm" variant="primary" onPress={apply} isDisabled={pending !== undefined}>{pending === "apply" ? "Applying..." : "Apply changes"}</Button> : null}
          <Button size="sm" variant="danger" onPress={discard} isDisabled={pending !== undefined}>{pending === "discard" ? "Discarding..." : "Discard changes"}</Button>
        </div>
      </div>
    </DetailCard>
  );
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card variant="transparent" className="border border-border">
      <Card.Header>
        <Card.Title className="text-sm">{title}</Card.Title>
      </Card.Header>
      <Card.Content>{children}</Card.Content>
    </Card>
  );
}

function RelationRow({ label, value, muted }: { label: string; value: string; muted?: boolean | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-surface-secondary px-2 py-1">
      <div className="text-xs font-semibold uppercase text-muted">{label}</div>
      <div className={muted ? "text-muted" : "text-foreground"}>{value}</div>
    </div>
  );
}

function ActivityTimeline({ activities }: { activities: ReadonlyArray<TaskActivityViewModel> }) {
  if (activities.length === 0) {
    return <p className="text-sm text-muted">No activity yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {activities.map((activity) => (
        <li key={activity.id} className="rounded-lg border border-border bg-surface-secondary px-3 py-2">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs" aria-hidden="true">
              {activityIcon(activity.kind)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Chip size="sm" variant="soft" color="default">{activity.kind}</Chip>
                <span className="text-muted">by {activity.by || activity.byKind}</span>
                {activity.createdAt ? <span className="text-muted">{formatTime(activity.createdAt)}</span> : null}
              </div>
              <p className="mt-1 text-sm">{truncate(summarizeTaskActivityPayload(activity.payload), 180)}</p>
              <ActivityLinks activity={activity} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ActivityLinks({ activity }: { activity: TaskActivityViewModel }) {
  const payload = isRecord(activity.payload) ? activity.payload : undefined;
  const runId = typeof payload?.runId === "string" ? payload.runId : typeof payload?.byRunId === "string" ? payload.byRunId : undefined;
  const artifact = typeof payload?.artifactPath === "string" ? payload.artifactPath : typeof payload?.artifactId === "string" ? payload.artifactId : undefined;

  if (!runId && !artifact) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      {runId ? <a className="rounded-full bg-accent-soft px-2 py-1 text-accent-soft-foreground" href={`#run:${encodeURIComponent(runId)}`}>Run Detail: {runId}</a> : null}
      {artifact ? <a className="rounded-full bg-surface px-2 py-1 text-muted" href={`#artifact:${encodeURIComponent(artifact)}`}>Artifact: {artifact}</a> : null}
    </div>
  );
}

function makeKanbanCollision(columnIds: Set<string>): CollisionDetection {
  return (args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) {
      const cards = pointer.filter((collision) => !columnIds.has(String(collision.id)));
      if (cards.length > 0) return cards;
    }
    return closestCenter(args);
  };
}

function overColumn(overId: unknown, groups: readonly TaskStatusGroup[]): KanbanColumnLabel | undefined {
  if (overId === null || overId === undefined) return undefined;
  const id = String(overId);
  if (isKanbanColumn(id)) return id;
  const group = groups.find((item) => item.items.some((task) => task.id === id));
  return group?.label;
}

function rectFromDomRect(rect: DOMRect): TaskCardRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  };
}

function activityIcon(kind: string): string {
  switch (kind) {
    case "comment":
      return "C";
    case "run_started":
      return "S";
    case "run_completed":
      return "D";
    case "artifact":
    case "artifact_linked":
      return "A";
    case "blocker":
    case "blocker_set":
      return "!";
    case "status_change":
      return ">";
    default:
      return "-";
  }
}

function priorityLabel(priority: string | undefined): string {
  switch (priority) {
    case "3":
      return "urgent";
    case "2":
      return "high";
    case "1":
      return "normal";
    case "0":
      return "low";
    default:
      return priority ?? "normal";
  }
}

function priorityColor(priority: string | undefined): ChipColor {
  switch (priority) {
    case "3":
    case "critical":
    case "urgent":
    case "high":
      return "danger";
    case "2":
    case "medium":
      return "warning";
    case "0":
    case "low":
      return "default";
    default:
      return "accent";
  }
}

function fileChangeColor(change: string): ChipColor {
  switch (change) {
    case "added":
    case "created":
      return "success";
    case "deleted":
    case "removed":
      return "danger";
    default:
      return "default";
  }
}

function humanizeReason(reason: string): string {
  return reason.replace(/_/gu, " ");
}

function isKanbanColumn(value: unknown): value is KanbanColumnLabel {
  return typeof value === "string" && KANBAN_COLUMN_LABELS.includes(value as KanbanColumnLabel);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

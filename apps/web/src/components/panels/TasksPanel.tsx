import { Avatar, Button, Card, Chip, Drawer, Modal, ScrollShadow } from "@heroui/react";
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
import { roleDisplayName } from "../../lib/roles.ts";
import { taskStatusColor, type ChipColor } from "../../lib/status.ts";

export const KANBAN_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting", label: "Waiting" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" }
] as const;

const KANBAN_COLUMN_LABELS = KANBAN_COLUMNS.map((column) => column.label);
const proofActivityKinds = new Set(["run_completed", "artifact", "artifact_linked", "review", "validation", "test", "blocker_set"]);
const taskDeliveryReportTemplateVersion = 2;

export type KanbanColumnLabel = (typeof KANBAN_COLUMNS)[number]["label"];

export type TaskStatusGroup = (typeof KANBAN_COLUMNS)[number] & {
  readonly items: TaskViewModel[];
};

export const TASK_BOARD_FILTERS = [
  { key: "all", label: "全部" },
  { key: "blocked", label: "阻塞" },
  { key: "review", label: "待评审" },
  { key: "waiting", label: "等待中" },
  { key: "ready", label: "可应用" },
  { key: "files", label: "变更文件" }
] as const;

export type TaskBoardFilter = (typeof TASK_BOARD_FILTERS)[number]["key"];

export type TaskBoardSummary = {
  readonly total: number;
  readonly visible: number;
  readonly active: number;
  readonly blocked: number;
  readonly review: number;
  readonly done: number;
  readonly readyToApply: number;
  readonly conflicts: number;
  readonly filesChanged: number;
  readonly waitingDependencies: number;
  readonly runningRuns: number;
};

export type TaskBoardBrief = {
  readonly standup: string;
  readonly review: string;
  readonly blockers: readonly { readonly id: string; readonly title: string; readonly reason: string }[];
};

type TaskReportEvidenceCounts = {
  readonly fileRuns: number;
  readonly changedFiles: number;
  readonly worktreeReviews: number;
  readonly proofActivities: number;
  readonly reviewDecisions: number;
  readonly unresolvedComments: number;
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
  readonly taskCount?: number | undefined;
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

export function buildTaskBoardSummary(tasks: ReadonlyArray<TaskViewModel>): TaskBoardSummary {
  const visible = tasks.filter((task) => taskColumn(task) !== undefined);
  return {
    total: tasks.length,
    visible: visible.length,
    active: visible.filter(isActiveTask).length,
    blocked: visible.filter(isBlockedTask).length,
    review: visible.filter((task) => task.status === "review").length,
    done: visible.filter((task) => task.status === "completed").length,
    readyToApply: visible.filter(hasReadyWorktree).length,
    conflicts: visible.filter(hasWorktreeConflict).length,
    filesChanged: visible.filter((task) => aggregateFileChanges(task) > 0).length,
    waitingDependencies: visible.filter((task) => unresolvedDependencyCount(task, tasks) > 0).length,
    runningRuns: visible.reduce((total, task) => total + activeRunCount(task), 0)
  };
}

export function filterTasksForBoard(tasks: ReadonlyArray<TaskViewModel>, filter: TaskBoardFilter): TaskViewModel[] {
  const visible = tasks.filter((task) => taskColumn(task) !== undefined);
  switch (filter) {
    case "blocked":
      return visible.filter(isBlockedTask);
    case "review":
      return visible.filter((task) => task.status === "review");
    case "waiting":
      return visible.filter((task) => unresolvedDependencyCount(task, tasks) > 0);
    case "ready":
      return visible.filter(hasReadyWorktree);
    case "files":
      return visible.filter((task) => aggregateFileChanges(task) > 0);
    case "all":
    default:
      return visible;
  }
}

export function taskBoardBrief(tasks: ReadonlyArray<TaskViewModel>): TaskBoardBrief {
  const summary = buildTaskBoardSummary(tasks);
  const visible = tasks.filter((task) => taskColumn(task) !== undefined);
  const carryOver = visible.filter((task) => task.status !== "completed").length;
  return {
    standup: `${summary.active} 个进行中，${summary.blocked} 个阻塞，${summary.waitingDependencies} 个等待前置任务`,
    review: `已完成：${summary.done}。未完成：${carryOver}。阻塞：${summary.blocked}。`,
    blockers: attentionTasks(visible, tasks)
      .filter(isBlockedTask)
      .map((task) => ({
        id: task.id,
        title: task.title,
        reason: blockerText(task)
      }))
  };
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
  if (payload === null || payload === undefined) return "无 payload";
  if (typeof payload === "string") return payload;
  if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
  if (!isRecord(payload)) return "已记录 payload";

  const preferredKeys = ["comment", "message", "summary", "reason", "status", "artifactPath", "artifactId", "runId", "blocker", "blockerReason", "text"];
  for (const key of preferredKeys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }

  return Object.entries(payload)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" / ") || "已记录 payload";
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
    ...(plan.taskCount !== undefined ? { taskCount: plan.taskCount } : {}),
    createdAt: plan.createdAt
  };
}

export function hydrateExecutionPlanFromLatest(current: RoomExecutionPlanViewModel, payload: unknown): RoomExecutionPlanViewModel {
  const planPayload = isRecord(payload) ? payload.plan : undefined;
  if (!isRecord(planPayload)) return current;
  const planId = typeof planPayload.id === "string" ? planPayload.id : undefined;
  if (planId !== current.planId) return current;
  return {
    ...current,
    runId: typeof planPayload.runId === "string" ? planPayload.runId : current.runId,
    planJson: "plan" in planPayload ? planPayload.plan : current.planJson,
    createdAt: typeof planPayload.createdAt === "number" ? planPayload.createdAt : current.createdAt
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

export async function taskBoardResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.clone().json() as unknown;
    if (isRecord(payload)) {
      const error = payload.error;
      const message = payload.message;
      if (typeof error === "string" && error.trim().length > 0) return error;
      if (typeof message === "string" && message.trim().length > 0) return message;
    }
  } catch {
    // Failed board actions can return plain text or empty bodies; keep a useful fallback.
  }
  return `${fallback} (${response.status})`;
}

export function TasksPanel({ roomId, tasks, csrfFetch, executionPlan, onOpenArtifact }: { roomId: string; tasks: ReadonlyArray<TaskViewModel>; csrfFetch: typeof fetch; executionPlan?: RoomExecutionPlanViewModel | undefined; onOpenArtifact?: ((input: { artifactId: string; runId: string; path: string }) => void) | undefined }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [kanbanOpen, setKanbanOpen] = useState(false);
  const [boardFilter, setBoardFilter] = useState<TaskBoardFilter>("all");
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [hydratedPlan, setHydratedPlan] = useState<RoomExecutionPlanViewModel | undefined>(undefined);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const effectiveExecutionPlan = hydratedPlan?.planId === executionPlan?.planId ? hydratedPlan : executionPlan;
  const summary = useMemo(() => buildTaskBoardSummary(tasks), [tasks]);
  const brief = useMemo(() => taskBoardBrief(tasks), [tasks]);
  const boardTasks = useMemo(() => filterTasksForBoard(tasks, boardFilter), [tasks, boardFilter]);
  const groups = useMemo(() => groupTasksByKanbanColumn(tasks), [tasks]);
  const boardGroups = useMemo(() => groupTasksByKanbanColumn(boardTasks), [boardTasks]);
  const visibleTasks = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const boardVisibleTasks = useMemo(() => boardGroups.flatMap((group) => group.items), [boardGroups]);
  const attention = useMemo(() => attentionTasks(visibleTasks, tasks), [visibleTasks, tasks]);
  const detail = useMemo(() => getTaskDetail(tasks, selectedTaskId), [tasks, selectedTaskId]);
  const plan = useMemo(() => roomExecutionPlan(effectiveExecutionPlan), [effectiveExecutionPlan]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const columnIds = useMemo(() => new Set(KANBAN_COLUMNS.map((column) => column.label)), []);
  const collisionDetection = useMemo(() => makeKanbanCollision(columnIds), [columnIds]);

  useEffect(() => {
    if (!executionPlan) {
      setHydratedPlan(undefined);
      return;
    }
    if (executionPlan.planJson !== null && executionPlan.planJson !== undefined) {
      setHydratedPlan(undefined);
      return;
    }
    let cancelled = false;
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/task-plans/latest`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await taskBoardResponseError(response, "加载执行计划失败"));
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!cancelled) setHydratedPlan(hydrateExecutionPlanFromLatest(executionPlan, payload));
      })
      .catch((error: unknown) => {
        if (!cancelled) setActionError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [csrfFetch, executionPlan, roomId]);

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
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await taskBoardResponseError(response, "移动任务失败"));
      })
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)));
  };

  if (tasks.length === 0) {
    return <div className="p-6 text-center text-sm text-muted">暂无任务。</div>;
  }

  return (
    <>
      <div className="flex min-h-[480px] flex-col gap-3 p-3" data-testid="tasks-panel-list">
        {actionError ? (
          <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-900 dark:border-danger-800 dark:bg-danger-950/40 dark:text-danger-100">
            {actionError}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">任务</h2>
            <p className="text-xs text-muted">{visibleTasks.length} 个当前任务</p>
          </div>
          <Button size="sm" variant="secondary" onPress={() => setKanbanOpen(true)}>打开看板</Button>
        </div>
        <BoardHealthStrip summary={summary} compact />
        <BoardBriefCard brief={brief} attention={attention} allTasks={tasks} onOpenTask={setSelectedTaskId} compact />
        {plan ? <ExecutionPlanCard plan={plan} /> : null}
        <TaskList groups={groups} allTasks={tasks} onOpenTask={setSelectedTaskId} />
      </div>
      <Modal.Backdrop isOpen={kanbanOpen} onOpenChange={setKanbanOpen}>
        <Modal.Container size="cover" className="items-center justify-center p-3">
          <Modal.Dialog className="flex h-[min(92vh,920px)] w-[min(98vw,1480px)] max-w-[1480px] overflow-hidden p-0" aria-label="任务看板">
            <Modal.CloseTrigger aria-label="关闭任务看板" />
            <Modal.Header className="border-b border-border px-4 py-3">
              <div className="flex w-full min-w-0 flex-wrap items-start justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <Modal.Heading>任务看板</Modal.Heading>
                  <p className="mt-1 text-xs text-muted">显示 {boardVisibleTasks.length} 个，共 {visibleTasks.length} 个当前任务</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TASK_BOARD_FILTERS.map((filter) => (
                    <Button
                      key={filter.key}
                      size="sm"
                      variant={boardFilter === filter.key ? "primary" : "secondary"}
                      onPress={() => setBoardFilter(filter.key)}
                    >
                      {filter.label}
                    </Button>
                  ))}
                </div>
              </div>
            </Modal.Header>
            <Modal.Body className="min-h-0 p-0">
              <div className="flex h-full min-h-[480px] flex-col gap-3 p-3" data-testid="tasks-panel-kanban">
                <BoardHealthStrip summary={summary} />
                <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
                    <div ref={boardRef} className="relative min-h-[420px] flex-1 overflow-x-auto pb-2">
                      <DependencyArrowOverlay lines={dependencyLines(boardVisibleTasks)} layoutVersion={layoutVersion} scrollElementRef={boardRef} />
                      <div className="relative z-10 grid min-w-[940px] grid-cols-5 gap-2">
                        {boardGroups.map((group) => (
                          <TaskColumn key={group.key} group={group} allTasks={tasks} onOpenTask={setSelectedTaskId} />
                        ))}
                      </div>
                    </div>
                  </DndContext>
                  <BoardBriefCard brief={brief} attention={attention} allTasks={tasks} onOpenTask={setSelectedTaskId} />
                </div>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
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

function BoardHealthStrip({ summary, compact = false }: { summary: TaskBoardSummary; compact?: boolean | undefined }) {
  const metrics = [
    { key: "active", label: "进行中", value: summary.active, detail: `${summary.runningRuns} 个运行中的 run`, color: "accent" as ChipColor },
    { key: "blocked", label: "阻塞", value: summary.blocked, detail: "需要关注", color: "danger" as ChipColor },
    { key: "review", label: "待评审", value: summary.review, detail: "等待确认", color: "warning" as ChipColor },
    { key: "ready", label: "可应用", value: summary.readyToApply, detail: "Worktree 可应用", color: "success" as ChipColor },
    { key: "conflicts", label: "冲突", value: summary.conflicts, detail: "需要处理", color: "danger" as ChipColor },
    { key: "files", label: "变更", value: summary.filesChanged, detail: "包含文件变更", color: "default" as ChipColor },
    { key: "waiting", label: "等待中", value: summary.waitingDependencies, detail: "前置任务未完成", color: "warning" as ChipColor }
  ];
  const shown = compact ? metrics.slice(0, 5) : metrics;

  return (
    <section className="rounded-xl border border-border bg-surface-secondary/70 px-3 py-3" aria-label="看板概览">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted">看板概览</h3>
          <p className="text-xs text-muted">显示 {summary.visible} 个 / 共 {summary.total} 个</p>
        </div>
        <Chip size="sm" variant="soft" color={summary.blocked > 0 || summary.conflicts > 0 ? "danger" : summary.review > 0 ? "warning" : "success"}>
          {summary.blocked > 0 || summary.conflicts > 0 ? "需关注" : summary.review > 0 ? "待评审" : "正常"}
        </Chip>
      </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 md:grid-cols-4 xl:grid-cols-7"}`}>
        {shown.map((metric) => (
          <div key={metric.key} className="min-w-0 rounded-lg border border-border bg-surface px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-semibold uppercase text-muted">{metric.label}</span>
              <Chip size="sm" variant="soft" color={metric.color}>{metric.value}</Chip>
            </div>
            <p className="mt-1 truncate text-[11px] text-muted">{metric.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BoardBriefCard({ brief, attention, allTasks, onOpenTask, compact = false }: { brief: TaskBoardBrief; attention: readonly TaskViewModel[]; allTasks: ReadonlyArray<TaskViewModel>; onOpenTask: (taskId: string) => void; compact?: boolean | undefined }) {
  const shownAttention = attention.slice(0, compact ? 3 : 8);

  return (
    <Card variant="transparent" className="border border-border bg-surface">
      <Card.Header className="gap-1">
        <Card.Title className="text-sm">任务简报</Card.Title>
        <Card.Description className="text-xs">{brief.standup}</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2">
          <div className="mb-1 text-xs font-semibold uppercase text-muted">任务回顾</div>
          <p className="text-sm">{brief.review}</p>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase text-muted">优先处理阻塞项</h3>
            <Chip size="sm" variant="soft" color={brief.blockers.length > 0 ? "danger" : "success"}>{brief.blockers.length}</Chip>
          </div>
          {shownAttention.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-surface-secondary px-3 py-4 text-center text-xs text-muted">暂无需要优先关注的任务。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shownAttention.map((task) => (
                <BoardAttentionItem key={task.id} task={task} allTasks={allTasks} onOpenTask={onOpenTask} />
              ))}
            </ul>
          )}
        </div>
      </Card.Content>
    </Card>
  );
}

function BoardAttentionItem({ task, allTasks, onOpenTask }: { task: TaskViewModel; allTasks: ReadonlyArray<TaskViewModel>; onOpenTask: (taskId: string) => void }) {
  const unresolved = unresolvedDependencyCount(task, allTasks);
  const fileCount = aggregateFileChanges(task);
  const worktree = latestWorktreeReview(task);
  const updatedAt = taskUpdatedAt(task);

  return (
    <li>
      <button
        type="button"
        className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-left transition-colors hover:bg-surface"
        onClick={() => onOpenTask(task.id)}
        aria-label={`打开任务 ${task.title}`}
      >
        <div className="flex min-w-0 items-start gap-2">
          <Chip size="sm" variant="soft" color={attentionColor(task)}>{attentionLabel(task)}</Chip>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{task.title}</div>
            <p className="mt-1 line-clamp-2 text-xs text-muted">{attentionReason(task, unresolved, fileCount, worktree)}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {unresolved > 0 ? <Chip size="sm" variant="soft" color="warning">前置未完成 {unresolved}</Chip> : null}
          {fileCount > 0 ? <Chip size="sm" variant="soft" color="default">{fileCount} 个文件</Chip> : null}
          {worktree?.status === "ready_for_review" ? <Chip size="sm" variant="soft" color="success">可应用</Chip> : null}
          {worktree?.status === "conflict" ? <Chip size="sm" variant="soft" color="danger">冲突</Chip> : null}
          <span className="ml-auto">{updatedAt ? formatRelativeTime(updatedAt) : "-"}</span>
        </div>
      </button>
    </li>
  );
}

function TaskList({ groups, allTasks, onOpenTask }: { groups: readonly TaskStatusGroup[]; allTasks: ReadonlyArray<TaskViewModel>; onOpenTask: (taskId: string) => void }) {
  const nonEmptyGroups = groups.filter((group) => group.items.length > 0);
  if (nonEmptyGroups.length === 0) {
    return <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-center text-sm text-muted">暂无当前任务。</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {nonEmptyGroups.map((group) => (
        <section key={group.key} className="rounded-xl border border-border bg-surface-secondary/60">
          <header className="flex items-center gap-2 border-b border-border px-3 py-2">
            <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase text-muted">{kanbanColumnDisplayLabel(group.label)}</h3>
            <Chip size="sm" variant="soft" color="default">{group.items.length}</Chip>
          </header>
          <div className="flex flex-col divide-y divide-border">
            {group.items.map((task) => (
              <TaskListRow key={task.id} task={task} allTasks={allTasks} onOpen={() => onOpenTask(task.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskListRow({ task, allTasks, onOpen }: { task: TaskViewModel; allTasks: ReadonlyArray<TaskViewModel>; onOpen: () => void }) {
  const updatedAt = taskUpdatedAt(task);
  const assignee = task.assigneeRoleId ?? task.assigneeAgentId ?? "未分配";
  const assigneeLabel = roleDisplayName(assignee) || assignee;
  const unresolved = unresolvedDependencyCount(task, allTasks);
  const fileCount = aggregateFileChanges(task);
  const worktree = latestWorktreeReview(task);
  const turnCount = task.delegations?.filter((delegation) => delegation.runId !== undefined).length ?? 0;

  return (
    <button type="button" className="grid w-full gap-2 px-3 py-3 text-left hover:bg-surface sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" onClick={onOpen} aria-label={`打开任务 ${task.title}`}>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold">{task.title}</span>
          <Chip size="sm" variant="soft" color={taskStatusColor(task.status)}>{taskStatusLabel(task.status)}</Chip>
          <Chip size="sm" variant="soft" color={priorityColor(task.priority)}>{priorityLabel(task.priority)}</Chip>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted">{task.description?.trim() || "暂无描述"}</p>
        {task.blockerReason ? <p className="mt-1 line-clamp-2 text-xs text-danger-700 dark:text-danger-200">{humanizeReason(task.blockerReason)}</p> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted sm:justify-end">
        {task.blockerReason ? <Chip size="sm" variant="soft" color="danger">阻塞</Chip> : null}
        {fileCount > 0 ? <Chip size="sm" variant="soft" color="accent">{fileCount} 个文件</Chip> : null}
        {unresolved > 0 ? <Chip size="sm" variant="soft" color="warning">前置未完成 {unresolved}</Chip> : null}
        {task.maxTurns !== undefined ? <Chip size="sm" variant="soft" color="default">{turnCount}/{task.maxTurns} 轮</Chip> : null}
        {worktree?.status === "ready_for_review" ? <Chip size="sm" variant="soft" color="success">可应用</Chip> : null}
        {worktree?.status === "conflict" ? <Chip size="sm" variant="soft" color="danger">冲突</Chip> : null}
        <span className="inline-flex min-w-0 items-center gap-1">
          <Avatar className="h-5 w-5 text-[10px]"><Avatar.Fallback>{initials(assigneeLabel)}</Avatar.Fallback></Avatar>
          <span className="max-w-28 truncate">{assigneeLabel}</span>
        </span>
        <span className="shrink-0">{updatedAt ? formatRelativeTime(updatedAt) : "-"}</span>
      </div>
    </button>
  );
}

function TaskColumn({ group, allTasks, onOpenTask }: { group: TaskStatusGroup; allTasks: ReadonlyArray<TaskViewModel>; onOpenTask: (taskId: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: group.label });

  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface-secondary/70 p-2" aria-label={`${kanbanColumnDisplayLabel(group.label)}任务`}>
      <header className="mb-2 flex h-7 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase text-muted">{kanbanColumnDisplayLabel(group.label)}</h3>
        <Chip size="sm" variant="soft" color="default">{group.items.length}</Chip>
      </header>
      <div ref={setNodeRef} className={`flex min-h-[360px] flex-col gap-2 rounded-md p-1 transition-colors ${isOver ? "bg-accent-soft" : ""}`}>
        <SortableContext items={group.items.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {group.items.map((task) => (
            <TaskKanbanCard key={task.id} task={task} allTasks={allTasks} onOpen={() => onOpenTask(task.id)} />
          ))}
        </SortableContext>
        {group.items.length === 0 ? <p className="py-8 text-center text-xs text-muted">暂无。</p> : null}
      </div>
    </section>
  );
}

function TaskKanbanCard({ task, allTasks, onOpen }: { task: TaskViewModel; allTasks: ReadonlyArray<TaskViewModel>; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const updatedAt = taskUpdatedAt(task);
  const assignee = task.assigneeRoleId ?? task.assigneeAgentId ?? "未分配";
  const assigneeLabel = roleDisplayName(assignee) || assignee;
  const unresolved = unresolvedDependencyCount(task, allTasks);
  const fileCount = aggregateFileChanges(task);
  const worktree = latestWorktreeReview(task);
  const turnCount = task.delegations?.filter((delegation) => delegation.runId !== undefined).length ?? 0;
  const activeRuns = activeRunCount(task);
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
            aria-label={`拖拽任务 ${task.title}`}
            {...attributes}
            {...listeners}
          >
            ::
          </button>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen} aria-label={`打开任务 ${task.title}`}>
            <span className="block line-clamp-2 text-sm font-semibold leading-snug">{task.title}</span>
            <span className="mt-1 block truncate text-xs text-muted">{task.description?.trim() || "暂无描述"}</span>
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <Chip size="sm" variant="soft" color={taskStatusColor(task.status)}>{taskStatusLabel(task.status)}</Chip>
          <Chip size="sm" variant="soft" color={priorityColor(task.priority)}>{priorityLabel(task.priority)}</Chip>
          {activeRuns > 0 ? <span className="ml-auto text-[11px] text-muted">{activeRuns} 个运行中</span> : null}
        </div>
        {task.blockerReason ? (
          <div className="rounded-md border border-danger-200 bg-danger-50 px-2 py-1.5 text-xs text-danger-900 dark:border-danger-800 dark:bg-danger-950/40 dark:text-danger-100">
            {humanizeReason(task.blockerReason)}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted">
          <TaskCardFact label="前置任务" value={unresolved > 0 ? `${unresolved} 个未完成` : "无"} tone={unresolved > 0 ? "warning" : "default"} />
          <TaskCardFact label="文件" value={fileCount > 0 ? String(fileCount) : "无"} tone={fileCount > 0 ? "accent" : "default"} />
          <TaskCardFact label="Worktree" value={worktreeLabel(worktree)} tone={worktreeTone(worktree)} />
          <TaskCardFact label="轮次" value={task.maxTurns !== undefined ? `${turnCount}/${task.maxTurns}` : String(turnCount)} tone="default" />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <Avatar className="h-5 w-5 text-[10px]"><Avatar.Fallback>{initials(assigneeLabel)}</Avatar.Fallback></Avatar>
          <span className="min-w-0 flex-1 truncate">{assigneeLabel}</span>
          <span className="shrink-0">{updatedAt ? formatRelativeTime(updatedAt) : "-"}</span>
        </div>
      </div>
    </Card>
  );
}

function TaskCardFact({ label, value, tone }: { label: string; value: string; tone: ChipColor }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-secondary px-2 py-1">
      <div className="truncate text-[10px] uppercase text-muted">{label}</div>
      <div className={`truncate text-[11px] ${tone === "danger" ? "text-danger-700 dark:text-danger-200" : tone === "warning" ? "text-warning-700 dark:text-warning-200" : tone === "accent" ? "text-accent-soft-foreground" : "text-foreground"}`}>
        {value}
      </div>
    </div>
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
  const assignee = task ? task.assigneeRoleId ?? task.assigneeAgentId ?? "未分配" : "未分配";
  const assigneeLabel = roleDisplayName(assignee) || assignee;

  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-[560px] max-w-[94vw]" aria-label="任务详情">
          <Drawer.CloseTrigger aria-label="关闭任务详情" />
          <Drawer.Header>
            <Drawer.Heading>{task?.title ?? "任务"}</Drawer.Heading>
            {task ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Chip size="sm" variant="soft" color={priorityColor(task.priority)}>{priorityLabel(task.priority)}</Chip>
                <Chip size="sm" variant="soft" color={taskStatusColor(task.status)}>{taskStatusLabel(task.status)}</Chip>
                <span className="text-muted">更新于 {taskUpdatedAt(task) ? formatRelativeTime(taskUpdatedAt(task)!) : "-"}</span>
              </div>
            ) : null}
          </Drawer.Header>
          <Drawer.Body className="p-0">
            {!detail || !task ? (
              <div className="p-6 text-center text-sm text-muted">未选择任务。</div>
            ) : (
              <ScrollShadow className="max-h-[calc(100vh-9rem)] overflow-auto" orientation="vertical">
                <div className="flex flex-col gap-3 p-4">
                  {plan ? <ExecutionPlanCard plan={plan} compact /> : null}
                  <DetailCard title="描述">
                    <p className="whitespace-pre-wrap text-sm text-muted">{task.description?.trim() || "暂无描述。"}</p>
                  </DetailCard>

                  <DetailCard title="负责人">
                    <div className="flex items-center gap-2 text-sm">
                      <Avatar className="h-7 w-7 text-xs"><Avatar.Fallback>{initials(assigneeLabel)}</Avatar.Fallback></Avatar>
                      <span>{assigneeLabel}</span>
                    </div>
                  </DetailCard>

                  <DetailCard title="父子任务">
                    <div className="flex flex-col gap-2 text-sm">
                      <RelationRow label="父任务" value={detail.parent ? detail.parent.title : task.parentTaskId ?? "无"} muted={!detail.parent && !task.parentTaskId} />
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase text-muted">子任务</div>
                        {detail.children.length === 0 ? (
                          <p className="text-xs text-muted">无。</p>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {detail.children.map((child) => (
                              <li key={child.id} className="rounded-lg border border-border bg-surface-secondary px-2 py-1">
                                <div className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                                  <Chip size="sm" variant="soft" color={taskStatusColor(child.status)}>{taskStatusLabel(child.status)}</Chip>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </DetailCard>

                  <FileChangesSection runs={task.fileChangeRuns ?? []} fallbackCount={task.fileChangesCount ?? 0} onOpenArtifact={onOpenArtifact} />
                  <WorktreeSection roomId={roomId} task={task} csrfFetch={csrfFetch} onOpenArtifact={onOpenArtifact} />
                  <ProofOfWorkSection roomId={roomId} task={task} csrfFetch={csrfFetch} />

                  <DetailCard title="活动记录">
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
  const displayedTaskCount = tasks.length > 0 ? tasks.length : plan.taskCount;
  return (
    <Card variant="transparent" className="border border-border">
      <Card.Header>
        <Card.Title className={compact ? "text-sm" : "text-sm"}>执行计划</Card.Title>
      </Card.Header>
      <Card.Content>
        <details open={!compact}>
          <summary className="cursor-pointer text-xs text-muted">{typeof parsed.goal === "string" ? parsed.goal : displayedTaskCount !== undefined ? `${displayedTaskCount} 个计划任务` : `计划 ${plan.id}`}</summary>
          {tasks.length === 0 ? (
            <p className="mt-2 text-xs text-muted">正在加载计划详情...</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {tasks.slice(0, compact ? 5 : 8).map((item, index) => {
              const record = isRecord(item) ? item : {};
              return (
                <li key={`${plan.id}:${index}`} className="rounded-md border border-border bg-surface-secondary px-2 py-1 text-xs">
                  <div className="font-medium">{typeof record.title === "string" ? record.title : `任务 ${index + 1}`}</div>
                  {typeof record.assigneeRole === "string" ? <div className="text-muted">{roleDisplayName(record.assigneeRole) || record.assigneeRole}</div> : null}
                </li>
              );
              })}
            </ul>
          )}
        </details>
      </Card.Content>
    </Card>
  );
}

function FileChangesSection({ runs, fallbackCount, onOpenArtifact }: { runs: readonly TaskFileChangeRunViewModel[]; fallbackCount: number; onOpenArtifact?: ((input: { artifactId: string; runId: string; path: string }) => void) | undefined }) {
  return (
    <DetailCard title="文件变更">
      {runs.length === 0 ? (
        <p className="text-sm text-muted">{fallbackCount > 0 ? `${fallbackCount} 个文件已变更。` : "暂无文件变更记录。"}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {[...runs].sort((a, b) => b.createdAt - a.createdAt).map((run) => (
            <div key={run.runId} className="rounded-lg border border-border bg-surface-secondary px-2 py-2">
              <div className="mb-1 flex items-center gap-2 text-xs">
                <Chip size="sm" variant="soft" color="default">{run.files.length} 个文件</Chip>
                <a className="min-w-0 truncate text-accent-soft-foreground" href={`#run:${encodeURIComponent(run.runId)}`}>{run.runId}</a>
              </div>
              <ul className="flex flex-col gap-1">
                {run.files.map((file) => {
                  const target = fileArtifactTarget(run, file);
                  return (
                    <li key={`${run.runId}:${file.path}`} className="flex items-center gap-2 text-xs">
                      <Chip size="sm" variant="soft" color={fileChangeColor(file.change)}>{fileChangeLabel(file.change)}</Chip>
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

function WorktreeSection({ roomId, task, csrfFetch, onOpenArtifact }: { roomId: string; task: TaskViewModel; csrfFetch: typeof fetch; onOpenArtifact?: ((input: { artifactId: string; runId: string; path: string }) => void) | undefined }) {
  const [pending, setPending] = useState<"apply" | "discard" | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const review = latestWorktreeReview(task);

  if (!review || (review.status !== "ready_for_review" && review.status !== "conflict")) {
    return (
      <DetailCard title="Worktree">
        <p className="text-sm text-muted">暂无待处理的 Worktree 变更。</p>
      </DetailCard>
    );
  }

  const apply = () => {
    setPending("apply");
    setError(undefined);
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/worktrees/${encodeURIComponent(review.runId)}/apply`, { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error(`应用失败：${res.status}`);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPending(undefined));
  };

  const discard = () => {
    if (!window.confirm("丢弃 Worktree 变更？")) return;
    setPending("discard");
    setError(undefined);
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/worktrees/${encodeURIComponent(review.runId)}/discard`, { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error(`丢弃失败：${res.status}`);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPending(undefined));
  };

  return (
    <DetailCard title="Worktree">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Chip size="sm" variant="soft" color={review.status === "conflict" ? "danger" : "success"}>{review.status === "conflict" ? "合并冲突" : "变更可应用"}</Chip>
          {review.artifactId ? <Chip size="sm" variant="soft" color="default">{review.artifactId}</Chip> : null}
        </div>
        {review.filesChanged && review.filesChanged.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs">
            {review.filesChanged.map((path) => (
              <li key={path} className="truncate ah-mono">
                {review.artifactId ? (
                  <a
                    className="text-accent-soft-foreground"
                    href={`#artifact:${encodeURIComponent(review.artifactId)}:${encodeURIComponent(path)}`}
                    onClick={() => onOpenArtifact?.({ artifactId: review.artifactId!, runId: review.runId, path })}
                  >
                    {path}
                  </a>
                ) : path}
              </li>
            ))}
          </ul>
        ) : null}
        {review.conflictDiff ? <pre className="max-h-40 overflow-auto rounded-md bg-surface-secondary p-2 text-xs ah-mono">{review.conflictDiff}</pre> : null}
        {error ? <p className="text-xs text-danger-700 dark:text-danger-200">{error}</p> : null}
        <div className="flex gap-2">
          {review.status === "ready_for_review" ? <Button size="sm" variant="primary" onPress={apply} isDisabled={pending !== undefined}>{pending === "apply" ? "应用中..." : "应用变更"}</Button> : null}
          <Button size="sm" variant="danger" onPress={discard} isDisabled={pending !== undefined}>{pending === "discard" ? "丢弃中..." : "丢弃变更"}</Button>
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
    return <p className="text-sm text-muted">暂无活动。</p>;
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
                <span className="text-muted">由 {activity.by || activity.byKind}</span>
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
      {runId ? <a className="rounded-full bg-accent-soft px-2 py-1 text-accent-soft-foreground" href={`#run:${encodeURIComponent(runId)}`}>Run 详情：{runId}</a> : null}
      {artifact ? <a className="rounded-full bg-surface px-2 py-1 text-muted" href={`#artifact:${encodeURIComponent(artifact)}`}>产物：{artifact}</a> : null}
    </div>
  );
}

function ProofOfWorkSection({ roomId, task, csrfFetch }: { roomId: string; task: TaskViewModel; csrfFetch: typeof fetch }) {
  const counts = taskReportEvidenceCounts(task);
  const latestReview = latestWorktreeReview(task);
  const validationActivities = (task.activities ?? []).filter((activity) => proofActivityKinds.has(activity.kind)).slice(0, 5);
  const [reportPending, setReportPending] = useState(false);
  const [reportError, setReportError] = useState<string | undefined>(undefined);
  const [reportArtifact, setReportArtifact] = useState<{ readonly artifactId: string; readonly path: string; readonly evidenceCounts?: TaskReportEvidenceCounts | undefined } | undefined>(undefined);

  const createReport = () => {
    setReportPending(true);
    setReportError(undefined);
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/tasks/${encodeURIComponent(task.id)}/report`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await taskBoardResponseError(response, "Create delivery report failed"));
        return response.json() as Promise<{ readonly artifact?: { readonly id?: string }; readonly path?: string; readonly evidenceCounts?: TaskReportEvidenceCounts }>;
      })
      .then((payload) => {
        const artifactId = payload.artifact?.id;
        if (typeof artifactId === "string") setReportArtifact({ artifactId, path: payload.path ?? ".agenthub/reports/task-report.md", evidenceCounts: payload.evidenceCounts });
      })
      .catch((error: unknown) => setReportError(error instanceof Error ? error.message : String(error)))
      .finally(() => setReportPending(false));
  };

  return (
    <DetailCard title="Proof of work">
      <div className="flex flex-col gap-2 text-sm">
        <div className="grid gap-2 sm:grid-cols-3">
          <ProofMetric label="Files" value={String(counts.changedFiles)} tone={counts.changedFiles > 0 ? "accent" : "default"} />
          <ProofMetric label="Worktree" value={worktreeLabel(latestReview)} tone={worktreeTone(latestReview)} />
          <ProofMetric label="Proof" value={String(counts.proofActivities)} tone={counts.proofActivities > 0 ? "success" : "default"} />
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <span className="rounded-md bg-surface-secondary px-2 py-1">File runs: {counts.fileRuns}</span>
          <span className="rounded-md bg-surface-secondary px-2 py-1">Worktree reviews: {counts.worktreeReviews}</span>
          <span className="rounded-md bg-surface-secondary px-2 py-1">Template v{taskDeliveryReportTemplateVersion}</span>
        </div>
        {validationActivities.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {validationActivities.map((activity) => (
              <li key={activity.id} className="rounded-md border border-border bg-surface-secondary px-2 py-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" variant="soft" color="default">{activity.kind}</Chip>
                  {activity.createdAt ? <span className="text-muted">{formatTime(activity.createdAt)}</span> : null}
                </div>
                <p className="mt-1">{truncate(summarizeTaskActivityPayload(activity.payload), 220)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No validation evidence has been recorded yet.</p>
        )}
        {reportArtifact ? (
          <div className="rounded-md border border-success/30 bg-success/10 px-2 py-1 text-xs">
            Report artifact: <span className="ah-mono">{reportArtifact.artifactId}</span> / <span className="ah-mono">{reportArtifact.path}</span>
            {reportArtifact.evidenceCounts ? <span className="ml-2 text-muted">({reportArtifact.evidenceCounts.changedFiles} files, {reportArtifact.evidenceCounts.proofActivities} proof)</span> : null}
          </div>
        ) : null}
        {reportError ? <p className="text-xs text-danger-700 dark:text-danger-200">{reportError}</p> : null}
        <div>
          <Button size="sm" variant="secondary" onPress={createReport} isDisabled={reportPending}>
            {reportPending ? "Updating..." : "Create/update delivery report"}
          </Button>
        </div>
      </div>
    </DetailCard>
  );
}

export function taskDeliveryReportMarkdown(task: TaskViewModel): string {
  const counts = taskReportEvidenceCounts(task);
  const lines = [
    `# Task Delivery Report: ${task.title}`,
    "",
    `- Template version: ${taskDeliveryReportTemplateVersion}`,
    `- Generated at: ${new Date().toISOString()}`,
    `- Task: \`${task.id}\``,
    `- Status: ${task.status}`,
    `- Assignee: ${task.assigneeRoleId ?? task.assigneeAgentId ?? "Unassigned"}`,
    `- Source run: ${task.sourceRunId ?? "-"}`,
    "",
    "## Evidence Summary",
    "",
    `- File runs: ${counts.fileRuns}`,
    `- Changed files: ${counts.changedFiles}`,
    `- Worktree reviews: ${counts.worktreeReviews}`,
    `- Proof activities: ${counts.proofActivities}`,
    `- Review decisions: ${counts.reviewDecisions}`,
    `- Unresolved comments: ${counts.unresolvedComments}`,
    "",
    "## Description",
    "",
    task.description?.trim() || "No description provided.",
    "",
    "## File Changes"
  ];
  const fileRuns = task.fileChangeRuns ?? [];
  if (fileRuns.length === 0) {
    lines.push("", "No file changes recorded.");
  } else {
    for (const run of fileRuns) {
      lines.push("", `### Run ${run.runId}${run.artifactId ? ` / artifact ${run.artifactId}` : ""}`);
      for (const file of run.files) lines.push(`- \`${file.path}\` (${file.change}, +${file.linesAdded ?? 0} / -${file.linesRemoved ?? 0})`);
    }
  }
  lines.push("", "## Worktree Reviews");
  const worktreeReviews = task.worktreeReviews ?? [];
  if (worktreeReviews.length === 0) {
    lines.push("", "No worktree review records.");
  } else {
    for (const review of worktreeReviews) {
      lines.push("", `- run \`${review.runId}\`: ${review.status}${review.artifactId ? ` / artifact ${review.artifactId}` : ""}`);
      for (const path of review.filesChanged ?? []) lines.push(`  - \`${path}\``);
      if (review.conflictDiff) lines.push(`  - conflict: ${review.conflictDiff.slice(0, 500)}`);
    }
  }
  lines.push("", "## Proof And Validation");
  const proof = (task.activities ?? []).filter((activity) => proofActivityKinds.has(activity.kind));
  if (proof.length === 0) {
    lines.push("", "No validation evidence has been recorded yet.");
  } else {
    lines.push("");
    for (const activity of proof) lines.push(`- ${activity.kind}: ${summarizeTaskActivityPayload(activity.payload)}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function taskReportEvidenceCounts(task: TaskViewModel): TaskReportEvidenceCounts {
  const proof = (task.activities ?? []).filter((activity) => proofActivityKinds.has(activity.kind) && !isDeliveryReportActivity(activity.payload));
  return {
    fileRuns: task.fileChangeRuns?.length ?? 0,
    changedFiles: aggregateFileChanges(task),
    worktreeReviews: task.worktreeReviews?.length ?? 0,
    proofActivities: proof.length,
    reviewDecisions: 0,
    unresolvedComments: 0
  };
}

function isDeliveryReportActivity(payload: unknown): boolean {
  return isRecord(payload) && payload.artifactKind === "delivery_report";
}

function ProofMetric({ label, value, tone }: { label: string; value: string; tone: ChipColor }) {
  return (
    <div className="rounded-lg border border-border bg-surface-secondary px-2 py-2">
      <div className="text-xs font-semibold uppercase text-muted">{label}</div>
      <Chip size="sm" variant="soft" color={tone}>{value}</Chip>
    </div>
  );
}

function attentionTasks(tasks: ReadonlyArray<TaskViewModel>, allTasks: ReadonlyArray<TaskViewModel>): TaskViewModel[] {
  return [...tasks]
    .filter((task) =>
      isBlockedTask(task) ||
      task.status === "review" ||
      hasWorktreeConflict(task) ||
      hasReadyWorktree(task) ||
      unresolvedDependencyCount(task, allTasks) > 0 ||
      aggregateFileChanges(task) > 0
    )
    .sort((a, b) => attentionScore(b, allTasks) - attentionScore(a, allTasks) || (taskUpdatedAt(b) ?? 0) - (taskUpdatedAt(a) ?? 0));
}

function attentionScore(task: TaskViewModel, allTasks: ReadonlyArray<TaskViewModel>): number {
  let score = 0;
  if (hasWorktreeConflict(task)) score += 80;
  if (isBlockedTask(task)) score += 70;
  if (task.status === "review") score += 45;
  if (hasReadyWorktree(task)) score += 35;
  if (unresolvedDependencyCount(task, allTasks) > 0) score += 25;
  if (aggregateFileChanges(task) > 0) score += 15;
  if (isActiveTask(task)) score += 10;
  return score;
}

function attentionLabel(task: TaskViewModel): string {
  if (hasWorktreeConflict(task)) return "冲突";
  if (isBlockedTask(task)) return "阻塞";
  if (task.status === "review") return "待评审";
  if (hasReadyWorktree(task)) return "可应用";
  if (aggregateFileChanges(task) > 0) return "有变更";
  return "等待中";
}

function attentionColor(task: TaskViewModel): ChipColor {
  if (hasWorktreeConflict(task) || isBlockedTask(task)) return "danger";
  if (task.status === "review") return "warning";
  if (hasReadyWorktree(task)) return "success";
  if (aggregateFileChanges(task) > 0) return "accent";
  return "default";
}

function attentionReason(task: TaskViewModel, unresolved: number, fileCount: number, worktree: WorktreeReviewViewModel | undefined): string {
  if (worktree?.status === "conflict") return "Worktree 存在合并冲突，需要人工处理。";
  if (task.blockerReason) return humanizeReason(task.blockerReason);
  if (task.status === "blocked") return "任务已阻塞。";
  if (task.status === "review") return "任务正在等待评审。";
  if (worktree?.status === "ready_for_review") return "Worktree 变更已可应用。";
  if (unresolved > 0) return `还有 ${unresolved} 个前置任务未完成。`;
  if (fileCount > 0) return `已记录 ${fileCount} 个变更文件。`;
  return "需要关注。";
}

function blockerText(task: TaskViewModel): string {
  if (task.blockerReason) return humanizeReason(task.blockerReason);
  if (hasWorktreeConflict(task)) return "Worktree 冲突";
  return "阻塞";
}

function isActiveTask(task: TaskViewModel): boolean {
  return task.status === "in_progress" || task.status === "running";
}

function isBlockedTask(task: TaskViewModel): boolean {
  return task.status === "blocked" || Boolean(task.blockerReason) || hasWorktreeConflict(task);
}

function hasReadyWorktree(task: TaskViewModel): boolean {
  return task.worktreeStatus === "ready_for_review" || latestWorktreeReview(task)?.status === "ready_for_review";
}

function hasWorktreeConflict(task: TaskViewModel): boolean {
  return task.worktreeStatus === "conflict" || latestWorktreeReview(task)?.status === "conflict";
}

function activeRunCount(task: TaskViewModel): number {
  return task.delegations?.filter((delegation) => delegation.runId !== undefined && delegation.completedAt === undefined).length ?? 0;
}

function worktreeLabel(worktree: WorktreeReviewViewModel | undefined): string {
  switch (worktree?.status) {
    case "ready_for_review":
      return "可应用";
    case "conflict":
      return "冲突";
    case "applied":
      return "已应用";
    case "discarded":
      return "已丢弃";
    default:
      return "无";
  }
}

function worktreeTone(worktree: WorktreeReviewViewModel | undefined): ChipColor {
  switch (worktree?.status) {
    case "ready_for_review":
      return "success";
    case "conflict":
      return "danger";
    default:
      return "default";
  }
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
      return "紧急";
    case "2":
      return "高";
    case "1":
      return "普通";
    case "0":
      return "低";
    case "critical":
      return "关键";
    case "urgent":
      return "紧急";
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return priority ?? "普通";
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

function fileChangeLabel(change: string): string {
  switch (change) {
    case "added":
    case "created":
      return "新增";
    case "deleted":
    case "removed":
      return "删除";
    case "modified":
      return "修改";
    case "renamed":
      return "重命名";
    default:
      return change;
  }
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case "pending":
    case "open":
      return "待处理";
    case "in_progress":
    case "running":
      return "进行中";
    case "blocked":
      return "阻塞";
    case "review":
    case "waiting_review":
      return "待评审";
    case "completed":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function kanbanColumnDisplayLabel(label: KanbanColumnLabel): string {
  switch (label) {
    case "Backlog":
      return "待办";
    case "In Progress":
      return "进行中";
    case "Waiting":
      return "等待中";
    case "Review":
      return "待评审";
    case "Done":
      return "已完成";
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

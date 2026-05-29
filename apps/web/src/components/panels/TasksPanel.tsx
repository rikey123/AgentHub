import { Avatar, Button, Card, Chip, Drawer, ScrollShadow } from "@heroui/react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TaskActivityViewModel, TaskViewModel } from "../../types.ts";
import { formatRelativeTime, formatTime, initials, truncate } from "../../lib/format.ts";
import { taskStatusColor, type ChipColor } from "../../lib/status.ts";

export const TASK_STATUS_GROUPS = [
  { key: "backlog", label: "Backlog", statuses: ["pending"] },
  { key: "in_progress", label: "In Progress", statuses: ["in_progress"] },
  { key: "blocked", label: "Blocked", statuses: ["blocked"] },
  { key: "review", label: "Review", statuses: ["review"] },
  { key: "done", label: "Done", statuses: ["completed", "cancelled"] }
] as const;

export type TaskStatusGroup = (typeof TASK_STATUS_GROUPS)[number] & {
  readonly items: TaskViewModel[];
};

type TaskDetail = {
  readonly task: TaskViewModel;
  readonly parent?: TaskViewModel | undefined;
  readonly children: TaskViewModel[];
  readonly activities: TaskActivityViewModel[];
};

export function groupTasksByV10Status(tasks: ReadonlyArray<TaskViewModel>): TaskStatusGroup[] {
  return TASK_STATUS_GROUPS.map((group) => ({
    ...group,
    items: tasks.filter((task) => group.statuses.includes(task.status as never))
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
    ...(task.delegations ?? []).flatMap((delegation) => [delegation.completedAt, delegation.createdAt])
  ].filter((value): value is number => typeof value === "number");
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
}

export function summarizeTaskActivityPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "No payload";
  if (typeof payload === "string") return payload;
  if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
  if (!isRecord(payload)) return "Payload recorded";

  const preferredKeys = ["comment", "message", "summary", "reason", "status", "artifactPath", "artifactId", "runId", "blocker"];
  for (const key of preferredKeys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }

  return Object.entries(payload)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ") || "Payload recorded";
}

export function TasksPanel({ tasks }: { tasks: ReadonlyArray<TaskViewModel> }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const groups = useMemo(() => groupTasksByV10Status(tasks), [tasks]);
  const detail = useMemo(() => getTaskDetail(tasks, selectedTaskId), [tasks, selectedTaskId]);

  if (tasks.length === 0) {
    return <div className="p-6 text-center text-sm text-muted">No tasks yet.</div>;
  }

  return (
    <>
      <div className="flex flex-col gap-3 p-3" data-testid="tasks-panel-v10">
        {groups.map((group) => (
          <TaskLane key={group.key} label={group.label} items={group.items} onOpenTask={setSelectedTaskId} />
        ))}
      </div>
      <TaskDetailDrawer detail={detail} isOpen={Boolean(detail)} onOpenChange={(open) => {
        if (!open) setSelectedTaskId(undefined);
      }} />
    </>
  );
}

function TaskLane({ label, items, onOpenTask }: { label: string; items: ReadonlyArray<TaskViewModel>; onOpenTask: (taskId: string) => void }) {
  return (
    <section aria-label={`${label} tasks`}>
      <header className="mb-1 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
        <Chip size="sm" variant="soft" color="default">{items.length}</Chip>
      </header>
      {items.length === 0 ? (
        <p className="text-xs text-muted">None.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((task) => (
            <li key={task.id}>
              <TaskRow task={task} onOpen={() => onOpenTask(task.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({ task, onOpen }: { task: TaskViewModel; onOpen: () => void }) {
  const updatedAt = taskUpdatedAt(task);
  const assignee = task.assigneeRoleId ?? task.assigneeAgentId ?? "Unassigned";

  return (
    <Card variant="transparent" className="border border-border">
      <Button
        aria-label={`Open task ${task.title}`}
        className="w-full justify-start rounded-[inherit] p-0 text-left"
        variant="ghost"
        onPress={onOpen}
      >
        <div className="flex w-full flex-col gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Chip size="sm" variant="soft" color={priorityColor(task.priority)}>{task.priority ?? "normal"}</Chip>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
            <Chip size="sm" variant="soft" color={taskStatusColor(task.status)}>{task.status}</Chip>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Avatar className="h-5 w-5 text-[10px]"><Avatar.Fallback>{initials(assignee)}</Avatar.Fallback></Avatar>
            <span className="min-w-0 flex-1 truncate">{assignee}</span>
            <span className="shrink-0">Updated {updatedAt ? formatRelativeTime(updatedAt) : "-"}</span>
          </div>
        </div>
      </Button>
    </Card>
  );
}

function TaskDetailDrawer({ detail, isOpen, onOpenChange }: { detail: TaskDetail | undefined; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const task = detail?.task;
  const assignee = task ? task.assigneeRoleId ?? task.assigneeAgentId ?? "Unassigned" : "Unassigned";

  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-[520px] max-w-[92vw]" aria-label="Task detail">
          <Drawer.CloseTrigger aria-label="Close task detail" />
          <Drawer.Header>
            <Drawer.Heading>{task?.title ?? "Task"}</Drawer.Heading>
            {task ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Chip size="sm" variant="soft" color={priorityColor(task.priority)}>{task.priority ?? "normal"}</Chip>
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
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Children</div>
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
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
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
        <li key={activity.id} className="rounded-xl border border-border bg-surface-secondary px-3 py-2">
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
  const runId = typeof payload?.runId === "string" ? payload.runId : undefined;
  const artifact = typeof payload?.artifactPath === "string" ? payload.artifactPath : typeof payload?.artifactId === "string" ? payload.artifactId : undefined;

  if (!runId && !artifact) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      {runId ? <a className="rounded-full bg-accent-soft px-2 py-1 text-accent-soft-foreground" href={`#run:${encodeURIComponent(runId)}`}>查看 Run Detail: {runId}</a> : null}
      {artifact ? <a className="rounded-full bg-surface px-2 py-1 text-muted" href={`#artifact:${encodeURIComponent(artifact)}`}>Artifact: {artifact}</a> : null}
    </div>
  );
}

function activityIcon(kind: string): string {
  switch (kind) {
    case "comment":
      return "💬";
    case "run_started":
      return "▶";
    case "run_completed":
      return "✓";
    case "artifact":
      return "↗";
    case "blocker":
      return "!";
    case "status_change":
      return "↻";
    default:
      return "•";
  }
}

function priorityColor(priority: string | undefined): ChipColor {
  switch (priority) {
    case "critical":
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
      return "default";
    default:
      return "accent";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

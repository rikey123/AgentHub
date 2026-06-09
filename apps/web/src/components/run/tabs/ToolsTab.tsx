import type { RoomViewModel, RunViewModel, TaskViewModel } from "../../../types.ts";
import { Card, Chip } from "@heroui/react";
import { formatDuration, formatTokens, formatUsd } from "../../../lib/format.ts";
import { runStatusColor, taskStatusColor } from "../../../lib/status.ts";

export type RunTaskCollaborationView = {
  readonly currentRun?: RunViewModel | undefined;
  readonly associatedTask?: TaskViewModel | undefined;
  readonly parentRun?: RunViewModel | undefined;
  readonly siblingRuns: readonly RunViewModel[];
  readonly tasks: readonly TaskViewModel[];
};

type ToolsTabProps = {
  room: RoomViewModel;
  runId: string;
  onOpenRun?: ((runId: string) => void) | undefined;
  onOpenTask?: ((taskId: string) => void) | undefined;
};

export function ToolsTab({ room, runId, onOpenRun, onOpenTask }: ToolsTabProps) {
  const messages = room.messages.filter((m) => m.runId === runId);
  const calls = messages.flatMap((m) =>
    m.parts
      .map((p, idx) => ({ messageId: m.id, idx, part: p }))
      .filter(({ part }) => part.type === "tool_call" || part.type === "tool_result")
  );
  const subagents = room.runs.filter((r) => r.id !== runId);
  const collaboration = getRunTaskCollaborationView(room, runId);
  const showCollaboration = room.mode === "team" || room.mode === "squad" || collaboration.tasks.length > 0 || collaboration.parentRun || collaboration.siblingRuns.length > 0;

  return (
    <div className="flex flex-col gap-3 p-3">
      {showCollaboration ? <CollaborationSection view={collaboration} onOpenRun={onOpenRun} onOpenTask={onOpenTask} /> : null}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">工具调用</h3>
        {calls.length === 0 ? <p className="text-sm text-muted">暂无工具调用。</p> : (
          <ul className="flex flex-col gap-2">
            {calls.map(({ messageId, idx, part }) => (
              <li key={`${messageId}-${idx}`}>
                <Card variant="transparent" className="border border-border">
                  <Card.Header>
                    <div className="flex items-center gap-2">
                      <Card.Title className="text-sm">
                        {part.type === "tool_call" ? `调用 · ${part.name}` : "结果"}
                      </Card.Title>
                      {part.type === "tool_result" ? (
                        <Chip size="sm" variant="soft" color={part.ok ? "success" : "danger"}>
                          {part.ok ? "ok" : "error"}
                        </Chip>
                      ) : null}
                    </div>
                  </Card.Header>
                  <Card.Content>
                    <pre className="ah-mono max-h-32 overflow-auto rounded bg-surface-secondary p-2 text-xs">
                      {JSON.stringify(part.type === "tool_call" ? part.input : part.type === "tool_result" ? part.output : null, null, 2)}
                    </pre>
                  </Card.Content>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      {subagents.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">子 agent 运行</h3>
          <ul className="flex flex-col gap-2">
            {subagents.map((sub) => {
              const duration = sub.startedAt !== undefined && sub.endedAt !== undefined ? formatDuration(sub.endedAt - sub.startedAt) : undefined;
              const tokens = sub.cost ? sub.cost.inputTokens + sub.cost.outputTokens : undefined;
              return (
                <li key={sub.id}>
                  <Card variant="transparent" className="border border-border">
                    <Card.Header>
                      <div className="flex flex-wrap items-center gap-2">
                        <Card.Title className="text-sm">{sub.agentName}</Card.Title>
                        <Chip size="sm" variant="soft" color="default">{sub.status}</Chip>
                        {duration ? <Chip size="sm" variant="soft" color="default">⏱ {duration}</Chip> : null}
                        {tokens !== undefined && tokens > 0 ? <Chip size="sm" variant="soft" color="default">{formatTokens(tokens)} tok</Chip> : null}
                        {sub.cost && sub.cost.costUsd > 0 ? <Chip size="sm" variant="soft" color="default">{formatUsd(sub.cost.costUsd)}</Chip> : null}
                      </div>
                      <Card.Description className="text-xs ah-mono">{sub.id}</Card.Description>
                    </Card.Header>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function getRunTaskCollaborationView(room: RoomViewModel, runId: string): RunTaskCollaborationView {
  const currentRun = room.runs.find((r) => r.id === runId);
  const associatedTask = room.tasks.find((task) => task.id === currentRun?.taskId || task.delegations?.some((delegation) => delegation.runId === runId));
  const parentTaskId = currentRun?.parentTaskId ?? associatedTask?.parentTaskId ?? associatedTask?.id;
  const parentRun = currentRun?.parentRunId ? room.runs.find((run) => run.id === currentRun.parentRunId) : associatedTask?.sourceRunId ? room.runs.find((run) => run.id === associatedTask.sourceRunId) : undefined;
  const siblingRunIds = new Set<string>();
  if (parentTaskId) {
    for (const run of room.runs) {
      if (run.id !== runId && run.parentTaskId === parentTaskId) siblingRunIds.add(run.id);
    }
    for (const task of room.tasks) {
      if (task.id === associatedTask?.id || task.parentTaskId !== parentTaskId) continue;
      for (const delegation of task.delegations ?? []) {
        if (delegation.runId && delegation.runId !== runId) siblingRunIds.add(delegation.runId);
      }
    }
  }
  const siblingRuns = room.runs.filter((run) => siblingRunIds.has(run.id));
  const treeRootId = associatedTask ? rootTaskId(room.tasks, associatedTask) : parentTaskId;
  const tasks = treeRootId ? flattenTaskTree(room.tasks, treeRootId) : [];

  return { currentRun, associatedTask, parentRun, siblingRuns, tasks };
}

function rootTaskId(tasks: ReadonlyArray<TaskViewModel>, task: TaskViewModel): string {
  let current = task;
  const seen = new Set<string>();
  while (current.parentTaskId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = tasks.find((item) => item.id === current.parentTaskId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

function flattenTaskTree(tasks: ReadonlyArray<TaskViewModel>, rootId: string): TaskViewModel[] {
  const byParent = new Map<string | undefined, TaskViewModel[]>();
  for (const task of tasks) {
    const siblings = byParent.get(task.parentTaskId) ?? [];
    siblings.push(task);
    byParent.set(task.parentTaskId, siblings);
  }
  const result: TaskViewModel[] = [];
  const visit = (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    result.push(task);
    for (const child of byParent.get(task.id) ?? []) visit(child.id);
  };
  visit(rootId);
  return result;
}

function CollaborationSection({ view, onOpenRun, onOpenTask }: { view: RunTaskCollaborationView; onOpenRun?: ((runId: string) => void) | undefined; onOpenTask?: ((taskId: string) => void) | undefined }) {
  return (
    <section data-testid="run-task-collaboration">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">多 agent 协作</h3>
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title className="text-sm">委托任务上下文</Card.Title>
            {view.associatedTask ? <Chip size="sm" variant="soft" color={taskStatusColor(view.associatedTask.status)}>{view.associatedTask.status}</Chip> : null}
          </div>
          <Card.Description className="text-xs">展示此委托队友运行关联的运行和任务树。</Card.Description>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-3">
            {view.parentRun ? <RunLink label="父级 Leader 运行" run={view.parentRun} onOpenRun={onOpenRun} /> : null}
            {view.siblingRuns.length > 0 ? (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">同级委托运行</div>
                <ul className="flex flex-col gap-1.5">
                  {view.siblingRuns.map((run) => <li key={run.id}><RunLink label={run.agentName} run={run} onOpenRun={onOpenRun} /></li>)}
                </ul>
              </div>
            ) : null}
            {view.tasks.length > 0 ? (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">任务树</div>
                <ul className="flex flex-col gap-1.5" data-testid="run-task-tree">
                  {view.tasks.map((task) => <TaskTreeItem key={task.id} task={task} onOpenTask={onOpenTask} />)}
                </ul>
              </div>
            ) : <p className="text-xs text-muted">此运行尚未关联任务树。</p>}
          </div>
        </Card.Content>
      </Card>
    </section>
  );
}

function RunLink({ label, run, onOpenRun }: { label: string; run: RunViewModel; onOpenRun?: ((runId: string) => void) | undefined }) {
  return (
    <button type="button" className="flex w-full items-center gap-2 rounded border border-border bg-surface-secondary px-2 py-1.5 text-left text-xs hover:bg-surface-tertiary" onClick={() => onOpenRun?.(run.id)} data-testid={`run-link-${run.id}`}>
      <span className="font-medium">{label}</span>
      <Chip size="sm" variant="soft" color={runStatusColor(run.status)}>{run.status}</Chip>
      <span className="ah-mono text-muted">{run.id}</span>
    </button>
  );
}

function TaskTreeItem({ task, onOpenTask }: { task: TaskViewModel; onOpenTask?: ((taskId: string) => void) | undefined }) {
  const depth = task.parentTaskId ? 1 : 0;
  return (
    <li className={depth > 0 ? "ml-4" : undefined}>
      <button type="button" className="flex w-full items-center gap-2 rounded border border-border bg-surface-secondary px-2 py-1.5 text-left text-xs hover:bg-surface-tertiary" onClick={() => onOpenTask?.(task.id)} data-testid={`task-link-${task.id}`}>
        <span className="flex-1 truncate font-medium">{task.title}</span>
        <Chip size="sm" variant="soft" color={taskStatusColor(task.status)}>{task.status}</Chip>
        <span className="ah-mono text-muted">{task.id}</span>
      </button>
    </li>
  );
}

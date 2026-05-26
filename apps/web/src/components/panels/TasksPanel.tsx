import { Card, Chip } from "@heroui/react";
import type { TaskViewModel } from "../../types.ts";
import { taskStatusColor } from "../../lib/status.ts";

const LANES: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "todo", label: "Todo", statuses: ["todo", "queued"] },
  { key: "running", label: "In Progress", statuses: ["running", "in_progress"] },
  { key: "blocked", label: "Blocked", statuses: ["blocked", "waiting_approval"] },
  { key: "review", label: "Review", statuses: ["review"] },
  { key: "done", label: "Done", statuses: ["done", "completed"] }
];

export function TasksPanel({ tasks }: { tasks: ReadonlyArray<TaskViewModel> }) {
  if (tasks.length === 0) {
    return <div className="p-6 text-center text-sm text-muted">No tasks yet.</div>;
  }
  const lanes = LANES.map((lane) => ({
    ...lane,
    items: tasks.filter((t) => lane.statuses.includes(t.status))
  }));
  const other = tasks.filter((t) => !LANES.some((l) => l.statuses.includes(t.status)));
  return (
    <div className="flex flex-col gap-3 p-3">
      {lanes.map((lane) => (
        <Lane key={lane.key} label={lane.label} items={lane.items} />
      ))}
      {other.length > 0 ? <Lane label="Other" items={other} /> : null}
    </div>
  );
}

function Lane({ label, items }: { label: string; items: ReadonlyArray<TaskViewModel> }) {
  return (
    <section>
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
              <Card variant="transparent" className="border border-border">
                <Card.Header>
                  <div className="flex items-center gap-2">
                    <Card.Title className="flex-1 truncate text-sm">{task.title}</Card.Title>
                    <Chip size="sm" variant="soft" color={taskStatusColor(task.status)}>{task.status}</Chip>
                  </div>
                  <Card.Description className="text-xs">
                    {task.assigneeAgentId ? `Assigned to ${task.assigneeAgentId}` : "Unassigned"}
                  </Card.Description>
                </Card.Header>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

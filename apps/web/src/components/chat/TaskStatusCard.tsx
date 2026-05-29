import { Button, Card, Chip } from "@heroui/react";
import { taskStatusColor } from "../../lib/status.ts";

export interface TaskStatusCardModel {
  readonly id: string;
  readonly summary: string;
  readonly taskId?: string | undefined;
  readonly taskTitle?: string | undefined;
  readonly assigneeRole: string;
  readonly status: string;
  readonly actionTarget: "task" | "tasks_tab";
}

interface TaskStatusCardProps {
  card: TaskStatusCardModel;
  onOpenTask?: ((taskId: string) => void) | undefined;
  onOpenTasks?: (() => void) | undefined;
}

export function TaskStatusCard({ card, onOpenTask, onOpenTasks }: TaskStatusCardProps) {
  const canOpenTask = card.actionTarget === "task" && !!card.taskId && !!onOpenTask;
  const canOpenTasks = card.actionTarget === "tasks_tab" && !!onOpenTasks;
  const actionLabel = "View Task";

  const open = () => {
    if (canOpenTask) {
      onOpenTask(card.taskId!);
      return;
    }
    if (canOpenTasks) onOpenTasks();
  };

  return (
    <Card
      variant="default"
      className="mx-auto my-2 w-full max-w-[760px] border border-border bg-surface/80 shadow-surface backdrop-blur"
      data-testid="task-status-card"
      data-task-status-card-id={card.id}
    >
      <Card.Header>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Card.Title className="text-sm">Task status</Card.Title>
            <Card.Description className="mt-1 line-clamp-2 text-sm text-foreground">
              {card.summary}
            </Card.Description>
          </div>
          <Chip size="sm" variant="soft" color={taskStatusColor(card.status)}>
            {card.status}
          </Chip>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {card.taskTitle ? (
            <Chip size="sm" variant="soft" color="default" className="max-w-full">
              <span className="truncate">{card.taskTitle}</span>
            </Chip>
          ) : null}
          <Chip size="sm" variant="soft" color="accent">
            {card.assigneeRole}
          </Chip>
        </div>
      </Card.Content>
      <Card.Footer>
        <Button
          size="sm"
          variant="primary"
          onPress={open}
          isDisabled={!canOpenTask && !canOpenTasks}
          data-testid="task-status-card-action"
        >
          {actionLabel}
        </Button>
      </Card.Footer>
    </Card>
  );
}

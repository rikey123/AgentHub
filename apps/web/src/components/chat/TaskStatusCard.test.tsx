import { describe, expect, it, vi } from "vitest";
import type { RoomViewModel } from "../../types.ts";
import { buildChatFeedItems } from "./ChatStream.tsx";
import { TaskStatusCard, type TaskStatusCardModel } from "./TaskStatusCard.tsx";

describe("TaskStatusCard timeline integration", () => {
  it("creates a dispatch card from projector task delegation state", () => {
    const room = roomFixture({
      tasks: [
        {
          id: "task-1",
          title: "Stabilize worker retries",
          status: "in_progress",
          assigneeRoleId: "role-builder",
          delegations: [
            {
              id: "delegation-1",
              status: "created",
              assigneeRoleId: "role-builder",
              payload: {
                leaderName: "Lead",
                assigneeRoleName: "Builder",
                taskTitle: "Stabilize worker retries"
              }
            }
          ]
        }
      ]
    });

    const cards = buildChatFeedItems(room).filter((item) => item.kind === "task_status");

    expect(cards).toHaveLength(1);
    expect(cards[0]?.data).toMatchObject({
      summary: "Lead dispatched 'Stabilize worker retries' to Builder",
      taskId: "task-1",
      taskTitle: "Stabilize worker retries",
      assigneeRole: "Builder",
      status: "created",
      actionTarget: "task"
    });
  });

  it("creates a review-ready card from dispatch started brief and links to Tasks tab", () => {
    const room = roomFixture({
      briefs: [
        {
          kind: "dispatch_started",
          runId: "run-review",
          dispatchId: "dispatch-1",
          agentId: "agent-lead",
          agentName: "Lead",
          summary: "Dispatch started"
        }
      ],
      tasks: [
        { id: "task-1", title: "Task one", status: "review" },
        { id: "task-2", title: "Task two", status: "review" },
        { id: "task-3", title: "Task three", status: "completed" }
      ]
    });

    const card = buildChatFeedItems(room).find((item) => item.kind === "task_status")?.data;
    expect(card).toMatchObject({
      summary: "2 tasks ready for review",
      assigneeRole: "Team",
      status: "review",
      actionTarget: "tasks_tab"
    });

    const onOpenTasks = vi.fn();
    const tree = TaskStatusCard({ card: card as TaskStatusCardModel, onOpenTasks });
    const action = findElementByProp(tree, "data-testid", "task-status-card-action");

    expect(action).toBeDefined();
    expect(typeof action?.props.onPress).toBe("function");
    (action?.props.onPress as (() => void) | undefined)?.();
    expect(onOpenTasks).toHaveBeenCalledTimes(1);
  });

  it("does not turn task activity rows into main timeline feed items", () => {
    const room = roomFixture({
      tasks: [
        {
          id: "task-1",
          title: "Quiet activity",
          status: "in_progress",
          activities: [
            { id: "activity-1", kind: "comment", byKind: "agent", by: "agent-1" },
            { id: "activity-2", kind: "status_change", byKind: "system", by: "system" }
          ]
        }
      ]
    });

    expect(buildChatFeedItems(room)).toEqual([]);
  });
});

function roomFixture(patch: Partial<RoomViewModel>): RoomViewModel {
  return {
    id: "room-1",
    title: "Room",
    mode: "team",
    primaryAgentId: undefined,
    participants: [],
    messages: [],
    briefs: [],
    unresolvedInterventions: [],
    pendingPermissions: [],
    contextItems: [],
    tasks: [],
    runs: [],
    pendingTurns: [],
    mailboxFailures: [],
    unreadCount: 0,
    ...patch
  };
}

function findElementByProp(element: unknown, prop: string, value: unknown): { props: Record<string, unknown> } | undefined {
  if (!element || typeof element !== "object" || !("props" in element)) return undefined;
  const props = (element as { props: Record<string, unknown> }).props;
  if (props[prop] === value) return { props };

  const children = props.children;
  const childList = Array.isArray(children) ? children : [children];
  for (const child of childList) {
    const found = findElementByProp(child, prop, value);
    if (found) return found;
  }
  return undefined;
}

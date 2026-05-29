import { describe, expect, it } from "vitest";
import type { TaskViewModel } from "../../types.ts";
import { getTaskDetail, groupTasksByV10Status, summarizeTaskActivityPayload, taskUpdatedAt } from "./TasksPanel.tsx";

describe("TasksPanel V1.0 task view contract", () => {
  it("groups projector tasks into V1.0 status lanes", () => {
    const groups = groupTasksByV10Status([
      task({ id: "t-backlog", title: "Prepare plan", status: "pending" }),
      task({ id: "t-progress", title: "Implement worker", status: "in_progress" }),
      task({ id: "t-blocked", title: "Wait on approval", status: "blocked" }),
      task({ id: "t-review", title: "Review patch", status: "review" }),
      task({ id: "t-complete", title: "Ship evidence", status: "completed" }),
      task({ id: "t-cancelled", title: "Drop duplicate", status: "cancelled" })
    ]);

    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ["Backlog", ["t-backlog"]],
      ["In Progress", ["t-progress"]],
      ["Blocked", ["t-blocked"]],
      ["Review", ["t-review"]],
      ["Done", ["t-complete", "t-cancelled"]]
    ]);
  });

  it("opens task detail data with assignee, parent, children, and newest-first activity timeline", () => {
    const tasks = [
      task({ id: "parent", title: "Parent task", status: "in_progress", assigneeRoleId: "leader" }),
      task({
        id: "child",
        title: "Child task",
        description: "Build the V1.0 panel.",
        status: "blocked",
        priority: "high",
        assigneeRoleId: "builder",
        parentTaskId: "parent",
        activities: [
          activity({ id: "old", kind: "comment", by: "leader", payload: { comment: "Please handle the panel." }, createdAt: 100 }),
          activity({ id: "new", kind: "run_completed", by: "builder", payload: { runId: "run_123", summary: "Panel complete" }, createdAt: 200 })
        ]
      }),
      task({ id: "grandchild", title: "Nested follow-up", status: "pending", parentTaskId: "child" })
    ];

    const detail = getTaskDetail(tasks, "child");

    expect(detail?.task).toMatchObject({ id: "child", title: "Child task", assigneeRoleId: "builder" });
    expect(detail?.parent).toMatchObject({ id: "parent", title: "Parent task" });
    expect(detail?.children.map((child) => child.id)).toEqual(["grandchild"]);
    expect(detail?.activities.map((item) => item.id)).toEqual(["new", "old"]);
    expect(detail?.activities.map((item) => summarizeTaskActivityPayload(item.payload))).toEqual([
      "Panel complete",
      "Please handle the panel."
    ]);
  });

  it("uses task activity and delegation timestamps as the task updated timestamp", () => {
    expect(taskUpdatedAt(task({
      id: "updated",
      activities: [activity({ createdAt: 300 })],
      delegations: [{ id: "d1", createdAt: 200, completedAt: 400 }]
    }))).toBe(400);
  });
});

function task(patch: Partial<TaskViewModel>): TaskViewModel {
  return {
    id: "task",
    title: "Task",
    status: "pending",
    ...patch
  };
}

function activity(patch: Partial<NonNullable<TaskViewModel["activities"]>[number]> = {}): NonNullable<TaskViewModel["activities"]>[number] {
  return {
    id: "activity",
    kind: "comment",
    byKind: "role",
    by: "builder",
    createdAt: 100,
    payload: { comment: "Activity" },
    ...patch
  };
}

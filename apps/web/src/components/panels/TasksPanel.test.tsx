import { describe, expect, it } from "vitest";
import type { TaskViewModel } from "../../types.ts";
import {
  aggregateFileChanges,
  dependencyLines,
  fileArtifactTarget,
  getTaskDetail,
  groupTasksByKanbanColumn,
  latestWorktreeReview,
  positionDependencyLines,
  roomExecutionPlan,
  summarizeTaskActivityPayload,
  taskColumn,
  taskUpdatedAt,
  unresolvedDependencyCount
} from "./TasksPanel.tsx";

describe("TasksPanel V1.1 Kanban task view contract", () => {
  it("groups tasks into Kanban columns, applies board overrides, and hides cancelled tasks", () => {
    const tasks = [
      task({ id: "t-backlog", title: "Prepare plan", status: "pending" }),
      task({ id: "t-progress", title: "Implement worker", status: "in_progress" }),
      task({ id: "t-blocked", title: "Wait on approval", status: "blocked" }),
      task({ id: "t-review", title: "Review patch", status: "review" }),
      task({ id: "t-complete", title: "Ship evidence", status: "completed" }),
      task({ id: "t-override", title: "Dragged blocked card", status: "blocked", boardColumn: "Review" }),
      task({ id: "t-cancelled", title: "Drop duplicate", status: "cancelled" })
    ];
    const groups = groupTasksByKanbanColumn(tasks);

    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ["Backlog", ["t-backlog"]],
      ["In Progress", ["t-progress"]],
      ["Waiting", ["t-blocked"]],
      ["Review", ["t-review", "t-override"]],
      ["Done", ["t-complete"]]
    ]);
    expect(taskColumn(tasks[5]!)).toBe("Review");
    expect(taskColumn(tasks[6]!)).toBeUndefined();
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

  it("summarizes dependencies, file changes, and latest worktree review", () => {
    const tasks = [
      task({ id: "dep-done", title: "Done dep", status: "completed" }),
      task({ id: "dep-open", title: "Open dep", status: "in_progress" }),
      task({
        id: "dependent",
        title: "Dependent",
        status: "pending",
        dependencies: ["dep-done", "dep-open"],
        fileChangeRuns: [
          { runId: "run-old", createdAt: 10, files: [{ path: "old.ts", change: "modified" }] },
          { runId: "run-new", createdAt: 20, files: [{ path: "new-a.ts", change: "added" }, { path: "new-b.ts", change: "modified" }] }
        ],
        worktreeReviews: [
          { runId: "run-old", artifactId: "artifact-old", status: "ready_for_review", updatedAt: 10 },
          { runId: "run-new", artifactId: "artifact-new", status: "conflict", conflictDiff: "patch conflict", updatedAt: 30 }
        ]
      }),
      task({ id: "hidden-cancelled", title: "Hidden", status: "cancelled", dependencies: ["dep-open"] })
    ];

    expect(unresolvedDependencyCount(tasks[2]!, tasks)).toBe(1);
    expect(dependencyLines(tasks)).toEqual([
      { fromTaskId: "dep-done", toTaskId: "dependent" },
      { fromTaskId: "dep-open", toTaskId: "dependent" }
    ]);
    expect(aggregateFileChanges(tasks[2]!)).toBe(3);
    expect(latestWorktreeReview(tasks[2]!)).toMatchObject({ runId: "run-new", status: "conflict", artifactId: "artifact-new" });
  });

  it("positions dependency arrows from real task card rectangles", () => {
    const positioned = positionDependencyLines(
      [{ fromTaskId: "task-a", toTaskId: "task-b" }],
      rect({ left: 10, top: 20, width: 500, height: 300 }),
      new Map([
        ["task-a", rect({ left: 30, top: 60, width: 100, height: 40 })],
        ["task-b", rect({ left: 260, top: 150, width: 120, height: 60 })]
      ])
    );

    expect(positioned).toEqual([
      { fromTaskId: "task-a", toTaskId: "task-b", x1: 120, y1: 60, x2: 250, y2: 160 }
    ]);
  });

  it("derives execution plan and file diff artifact targets for the panel", () => {
    expect(roomExecutionPlan({ planId: "plan-1", runId: "run-plan", planJson: { goal: "ship" }, createdAt: 123 })).toEqual({
      id: "plan-1",
      runId: "run-plan",
      plan: { goal: "ship" },
      createdAt: 123
    });
    expect(fileArtifactTarget(
      { runId: "run-files", artifactId: "artifact-run", createdAt: 10, files: [] },
      { path: "src/a.ts", change: "modified" }
    )).toEqual({
      artifactId: "artifact-run",
      href: "#artifact:artifact-run:src%2Fa.ts"
    });
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

function rect(input: { left: number; top: number; width: number; height: number }) {
  return {
    left: input.left,
    top: input.top,
    width: input.width,
    height: input.height,
    right: input.left + input.width,
    bottom: input.top + input.height
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

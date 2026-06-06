import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TaskViewModel } from "../../types.ts";
import {
  TasksPanel,
  aggregateFileChanges,
  buildTaskBoardSummary,
  dependencyLines,
  fileArtifactTarget,
  filterTasksForBoard,
  taskDeliveryReportMarkdown,
  getTaskDetail,
  groupTasksByKanbanColumn,
  hydrateExecutionPlanFromLatest,
  latestWorktreeReview,
  positionDependencyLines,
  taskBoardBrief,
  taskBoardResponseError,
  roomExecutionPlan,
  summarizeTaskActivityPayload,
  taskColumn,
  taskUpdatedAt,
  unresolvedDependencyCount
} from "./TasksPanel.tsx";

describe("TasksPanel V1.1 Kanban task view contract", () => {
  it("renders a clear task list by default and keeps the Kanban board behind a modal trigger", () => {
    const html = renderToStaticMarkup(createElement(TasksPanel, {
      roomId: "room_1",
      tasks: [
        task({ id: "t-plan", title: "Prepare plan", status: "pending", assigneeRoleId: "planner" }),
        task({ id: "t-build", title: "Build panel", status: "in_progress", assigneeRoleId: "builder" })
      ],
      csrfFetch: vi.fn<typeof fetch>(),
      executionPlan: undefined
    }));

    expect(html).toContain("data-testid=\"tasks-panel-list\"");
    expect(html).toContain("Open Kanban");
    expect(html).toContain("Prepare plan");
    expect(html).toContain("Build panel");
    expect(html).toContain("Board health");
    expect(html).toContain("Standup brief");
    expect(html).toContain("Blockers first");
    expect(html).not.toContain("data-testid=\"tasks-panel-kanban\"");
  });

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

  it("builds a mature board health summary from task, dependency, file, and worktree state", () => {
    const tasks = [
      task({ id: "active", title: "Build runtime", status: "in_progress", delegations: [{ id: "d-active", createdAt: 100, runId: "run-active" }] }),
      task({ id: "blocked", title: "Resolve keychain", status: "blocked", blockerReason: "Missing API key" }),
      task({ id: "review", title: "Review patch", status: "review" }),
      task({ id: "ready", title: "Apply worktree", status: "in_progress", worktreeReviews: [{ runId: "run-ready", artifactId: "artifact-ready", status: "ready_for_review", updatedAt: 300 }] }),
      task({ id: "conflict", title: "Fix merge", status: "blocked", worktreeReviews: [{ runId: "run-conflict", status: "conflict", updatedAt: 400 }] }),
      task({ id: "files", title: "Edit UI", status: "in_progress", fileChangeRuns: [{ runId: "run-files", createdAt: 500, files: [{ path: "apps/web/src/App.tsx", change: "modified" }] }] }),
      task({ id: "waiting", title: "Wait for active", status: "pending", dependencies: ["active"] }),
      task({ id: "done", title: "Shipped", status: "completed" })
    ];

    expect(buildTaskBoardSummary(tasks)).toMatchObject({
      total: 8,
      visible: 8,
      active: 3,
      blocked: 2,
      review: 1,
      done: 1,
      readyToApply: 1,
      conflicts: 1,
      filesChanged: 1,
      waitingDependencies: 1,
      runningRuns: 1
    });
  });

  it("filters the board with Hermes-style query lenses", () => {
    const tasks = [
      task({ id: "blocked", status: "blocked", blockerReason: "Need approval" }),
      task({ id: "review", status: "review" }),
      task({ id: "ready", status: "in_progress", worktreeReviews: [{ runId: "run-ready", status: "ready_for_review", updatedAt: 10 }] }),
      task({ id: "files", status: "in_progress", fileChangeRuns: [{ runId: "run-files", createdAt: 20, files: [{ path: "a.ts", change: "modified" }] }] }),
      task({ id: "cancelled", status: "cancelled" })
    ];

    expect(filterTasksForBoard(tasks, "all").map((item) => item.id)).toEqual(["blocked", "review", "ready", "files"]);
    expect(filterTasksForBoard(tasks, "blocked").map((item) => item.id)).toEqual(["blocked"]);
    expect(filterTasksForBoard(tasks, "review").map((item) => item.id)).toEqual(["review"]);
    expect(filterTasksForBoard(tasks, "ready").map((item) => item.id)).toEqual(["ready"]);
    expect(filterTasksForBoard(tasks, "files").map((item) => item.id)).toEqual(["files"]);
  });

  it("creates blockers-first standup and review briefs like the reference Kanban rituals", () => {
    const tasks = [
      task({ id: "active", title: "Build runtime", status: "in_progress", priority: "2" }),
      task({ id: "blocked", title: "Resolve keychain", status: "blocked", blockerReason: "Missing API key" }),
      task({ id: "waiting", title: "Wait for active", status: "pending", dependencies: ["active"] }),
      task({ id: "review", title: "Review patch", status: "review" }),
      task({ id: "done", title: "Shipped", status: "completed" })
    ];

    expect(taskBoardBrief(tasks)).toEqual({
      standup: "1 active, 1 blocked, 1 waiting on dependencies",
      review: "Completed: 1. Carry-over: 4. Blocked: 1.",
      blockers: [{ id: "blocked", title: "Resolve keychain", reason: "Missing API key" }]
    });
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

  it("hydrates minimized execution plans from the latest task plan REST response", () => {
    const current = { planId: "plan-1", runId: "run-plan", planJson: null, taskCount: 1, createdAt: 100 };
    const fullPlan = { goal: "ship", tasks: [{ title: "Build" }] };

    expect(hydrateExecutionPlanFromLatest(current, {
      plan: { id: "plan-1", runId: "run-plan", plan: fullPlan, createdAt: 123 }
    })).toEqual({
      planId: "plan-1",
      runId: "run-plan",
      planJson: fullPlan,
      taskCount: 1,
      createdAt: 123
    });

    expect(hydrateExecutionPlanFromLatest(current, {
      plan: { id: "other-plan", runId: "run-other", plan: fullPlan, createdAt: 123 }
    })).toBe(current);
  });

  it("surfaces non-2xx Kanban action error messages from response bodies", async () => {
    const response = new Response(JSON.stringify({ error: "invalid board column" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });

    await expect(taskBoardResponseError(response, "Move task failed")).resolves.toBe("invalid board column");
  });

  it("builds a readable Markdown delivery report from task proof-of-work", () => {
    const report = taskDeliveryReportMarkdown(task({
      id: "task-report",
      title: "Ship artifact review",
      description: "Close artifact and diff review gaps.",
      status: "completed",
      assigneeRoleId: "builder",
      fileChangeRuns: [{ runId: "run-files", artifactId: "artifact-files", createdAt: 20, files: [{ path: "src/a.ts", change: "modified", linesAdded: 4, linesRemoved: 1 }] }],
      worktreeReviews: [{ runId: "run-worktree", artifactId: "artifact-worktree", status: "applied", filesChanged: ["src/a.ts"], updatedAt: 30 }],
      activities: [
        activity({ id: "proof", kind: "validation", payload: { summary: "pnpm check:all passed" }, createdAt: 40 }),
        activity({ id: "note", kind: "comment", payload: { comment: "Non-proof chatter" }, createdAt: 50 })
      ]
    }));

    expect(report).toContain("# Task Delivery Report: Ship artifact review");
    expect(report).toContain("Template version: 2");
    expect(report).toContain("Generated at:");
    expect(report).toContain("Changed files: 1");
    expect(report).toContain("Worktree reviews: 1");
    expect(report).toContain("Proof activities: 1");
    expect(report).toContain("Status: completed");
    expect(report).toContain("Assignee: builder");
    expect(report).toContain("- `src/a.ts` (modified, +4 / -1)");
    expect(report).toContain("- run `run-worktree`: applied");
    expect(report).toContain("- validation: pnpm check:all passed");
    expect(report).not.toContain("Non-proof chatter");
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

import { describe, expect, it } from "vitest";
import type { RoomViewModel } from "../../../types.ts";
import { getRunTaskCollaborationView } from "./ToolsTab.tsx";

const emptyRoom = (overrides: Partial<RoomViewModel>): RoomViewModel => ({
  id: "room-1",
  title: "Room",
  mode: "solo",
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
  ...overrides
});

describe("ToolsTab task collaboration view", () => {
  it("shows sibling task tree context for a delegated teammate run", () => {
    const room = emptyRoom({
      mode: "team",
      runs: [
        { id: "run-leader", agentId: "leader", agentName: "Leader", status: "completed" },
        { id: "run-builder", agentId: "builder", agentName: "Builder", status: "running", parentRunId: "run-leader", parentTaskId: "task-parent", taskId: "task-build", wakeReason: "delegated_task" },
        { id: "run-reviewer", agentId: "reviewer", agentName: "Reviewer", status: "completed", parentRunId: "run-leader", parentTaskId: "task-parent", taskId: "task-review", wakeReason: "delegated_task" }
      ],
      tasks: [
        { id: "task-parent", title: "Ship feature", status: "in_progress", sourceRunId: "run-leader" },
        { id: "task-build", title: "Build feature", status: "running", parentTaskId: "task-parent", delegations: [{ id: "del-build", runId: "run-builder" }] },
        { id: "task-review", title: "Review feature", status: "completed", parentTaskId: "task-parent", delegations: [{ id: "del-review", runId: "run-reviewer" }] }
      ]
    });

    const view = getRunTaskCollaborationView(room, "run-builder");

    expect(view.parentRun?.id).toBe("run-leader");
    expect(view.siblingRuns.map((run) => run.id)).toEqual(["run-reviewer"]);
    expect(view.tasks.map((task) => task.id)).toEqual(["task-parent", "task-build", "task-review"]);
  });

  it("leaves solo runs without task context unchanged", () => {
    const room = emptyRoom({
      runs: [{ id: "run-solo", agentId: "solo", agentName: "Solo", status: "completed" }]
    });

    const view = getRunTaskCollaborationView(room, "run-solo");

    expect(view.parentRun).toBeUndefined();
    expect(view.siblingRuns).toEqual([]);
    expect(view.tasks).toEqual([]);
  });
});

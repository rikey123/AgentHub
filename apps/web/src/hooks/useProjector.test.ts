import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getProjector } from "./useProjector.ts";
import type { ProjectorState } from "../types.ts";
import type { EventType } from "@agenthub/protocol/events";

function makeEvent<T extends EventType>(type: T, roomId: string, payload: Record<string, unknown>, createdAt = Date.now()) {
  return {
    id: randomUUID(),
    type,
    schemaVersion: 1,
    durability: "durable" as const,
    visibility: "both" as const,
    workspaceId: "default-workspace",
    roomId,
    runId: typeof payload.runId === "string" ? payload.runId : undefined,
    payload,
    createdAt
  };
}

describe("useProjector replay handling", () => {
  let emittedState: ProjectorState;
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    emittedState = { rooms: new Map(), connectionStatus: "disconnected" };
    unsubscribe = getProjector().subscribe((state) => {
      emittedState = state;
    });
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
  });

  it("maps task.created v1.0 payload fields without legacy todo fallback", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "solo" }));
    projector.apply(makeEvent("task.created", roomId, {
      taskId: "task-1",
      title: "Ship it",
      assigneeRoleId: "role-1",
      assigneeBindingId: "binding-1",
      assigneeAgentId: "agent-1",
      expectsReview: true,
      parentTaskId: "task-parent",
      sourceRunId: "run-1",
      createdBy: "agent-0"
    }));

    const task = emittedState.rooms.get(roomId)?.tasks.find((item) => item.id === "task-1");
    expect(task).toMatchObject({
      id: "task-1",
      title: "Ship it",
      status: "pending",
      assigneeRoleId: "role-1",
      assigneeBindingId: "binding-1",
      assigneeAgentId: "agent-1",
      expectsReview: true,
      parentTaskId: "task-parent",
      sourceRunId: "run-1"
    });
    expect(task?.status).not.toBe("todo");
  });

  it("keeps task.status.changed idempotent during replay", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "solo" }));
    projector.apply(makeEvent("task.created", roomId, { taskId: "task-2", title: "Review", status: "pending" }));
    const statusEvent = makeEvent("task.status.changed", roomId, { taskId: "task-2", nextStatus: "review" });
    projector.apply(statusEvent);
    projector.apply(statusEvent);

    const tasks = emittedState.rooms.get(roomId)?.tasks.filter((item) => item.id === "task-2") ?? [];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: "review" });
  });

  it("projects task column moves and clears board overrides on terminal status changes", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "solo" }));
    projector.apply(makeEvent("task.created", roomId, { taskId: "task-kanban", title: "Kanban", status: "blocked" }));
    projector.apply(makeEvent("task.column.moved", roomId, { taskId: "task-kanban", roomId, fromColumn: "Waiting", toColumn: "Review" }));

    let task = emittedState.rooms.get(roomId)?.tasks.find((item) => item.id === "task-kanban");
    expect(task).toMatchObject({ status: "blocked", boardColumn: "Review" });

    projector.apply(makeEvent("task.status.changed", roomId, { taskId: "task-kanban", prevStatus: "blocked", nextStatus: "completed", boardColumn: null }));

    task = emittedState.rooms.get(roomId)?.tasks.find((item) => item.id === "task-kanban");
    expect(task).toMatchObject({ status: "completed" });
    expect(task?.boardColumn).toBeUndefined();
  });

  it("dedupes task.activity.added replay events", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "solo" }));
    projector.apply(makeEvent("task.created", roomId, { taskId: "task-3", title: "Activity", status: "pending" }));
    const activityEvent = makeEvent("task.activity.added", roomId, {
      taskId: "task-3",
      activityId: "activity-1",
      kind: "comment",
      byKind: "user",
      by: "user-1",
      payload: { text: "hello" }
    });
    projector.apply(activityEvent);
    projector.apply(activityEvent);

    const task = emittedState.rooms.get(roomId)?.tasks.find((item) => item.id === "task-3");
    expect(task?.activities).toHaveLength(1);
    expect(task?.activities?.[0]).toMatchObject({ id: "activity-1", kind: "comment", byKind: "user", by: "user-1" });
  });

  it("aggregates task file changes per run and preserves artifact ids", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "solo" }));
    projector.apply(makeEvent("task.created", roomId, { taskId: "task-files", title: "Files", status: "in_progress" }));
    projector.apply(makeEvent("run.file_changes.recorded", roomId, {
      taskId: "task-files",
      runId: "run-files-1",
      artifactId: "artifact-files-1",
      filesChangedCount: 2,
      filesChanged: [
        { path: "src/a.ts", change: "modified", linesAdded: 4, linesRemoved: 1, artifactId: "artifact-file-a" },
        { path: "src/b.ts", change: "added", additions: 8, deletions: 0 }
      ]
    }, 100));
    projector.apply(makeEvent("run.file_changes.recorded", roomId, {
      taskId: "task-files",
      runId: "run-files-2",
      filesChangedCount: 1,
      filesChanged: [{ path: "src/c.ts", change: "deleted" }]
    }, 200));

    const task = emittedState.rooms.get(roomId)?.tasks.find((item) => item.id === "task-files");
    expect(task?.fileChangesCount).toBe(3);
    expect(task?.fileChangeRuns?.map((run) => [run.runId, run.files.length])).toEqual([
      ["run-files-1", 2],
      ["run-files-2", 1]
    ]);
    expect(task?.fileChangeRuns?.[0]).toMatchObject({ artifactId: "artifact-files-1" });
    expect(task?.fileChangeRuns?.[0]?.files[0]).toMatchObject({ artifactId: "artifact-file-a" });
  });

  it("uses worktree.diff.ready artifact id as the file-change run fallback", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "solo" }));
    projector.apply(makeEvent("task.created", roomId, { taskId: "task-files", title: "Files", status: "in_progress" }));
    projector.apply(makeEvent("run.file_changes.recorded", roomId, {
      taskId: "task-files",
      runId: "run-files",
      filesChangedCount: 1,
      filesChanged: [{ path: "src/a.ts", change: "modified" }]
    }, 100));
    projector.apply(makeEvent("worktree.diff.ready", roomId, {
      taskId: "task-files",
      runId: "run-files",
      artifactId: "artifact-worktree",
      filesChanged: ["src/a.ts"]
    }, 200));

    const task = emittedState.rooms.get(roomId)?.tasks.find((item) => item.id === "task-files");
    expect(task?.fileChangeRuns?.[0]).toMatchObject({ runId: "run-files", artifactId: "artifact-worktree" });
  });

  it("projects task.plan.created into room-level execution plan state", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "team" }));
    projector.apply(makeEvent("task.plan.created", roomId, {
      roomId,
      runId: "run-plan",
      planId: "plan-1",
      plan: { goal: "ship", tasks: [{ title: "Build" }] },
      taskCount: 1
    }, 321));

    expect(emittedState.rooms.get(roomId)?.executionPlan).toEqual({
      planId: "plan-1",
      runId: "run-plan",
      planJson: { goal: "ship", tasks: [{ title: "Build" }] },
      createdAt: 321
    });
  });

  it("stores worktree review state and conflicts for task cards", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "solo" }));
    projector.apply(makeEvent("task.created", roomId, { taskId: "task-worktree", title: "Worktree", status: "review" }));
    projector.apply(makeEvent("worktree.diff.ready", roomId, {
      taskId: "task-worktree",
      runId: "run-worktree",
      artifactId: "artifact-worktree",
      filesChanged: ["src/a.ts"]
    }, 100));

    let task = emittedState.rooms.get(roomId)?.tasks.find((item) => item.id === "task-worktree");
    expect(task).toMatchObject({
      worktreeStatus: "ready_for_review",
      worktreeArtifactId: "artifact-worktree",
      worktreeRunId: "run-worktree"
    });
    expect(task?.worktreeReviews?.[0]).toMatchObject({ runId: "run-worktree", status: "ready_for_review", filesChanged: ["src/a.ts"] });

    projector.apply(makeEvent("worktree.conflict_detected", roomId, {
      taskId: "task-worktree",
      runId: "run-worktree",
      artifactId: "artifact-worktree",
      conflictDiff: "merge conflict"
    }, 200));

    task = emittedState.rooms.get(roomId)?.tasks.find((item) => item.id === "task-worktree");
    expect(task).toMatchObject({ worktreeStatus: "conflict", blockerReason: "worktree_apply_conflict" });
    expect(task?.worktreeReviews?.[0]).toMatchObject({ runId: "run-worktree", status: "conflict", conflictDiff: "merge conflict" });
  });

  it("projects room stalled and unstalled events", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "solo" }));
    projector.apply(makeEvent("room.stalled", roomId, { roomId, stalledTaskIds: ["task-1"], reason: "leader_unavailable" }, 123));

    let room = emittedState.rooms.get(roomId);
    expect(room).toMatchObject({ stalledAt: 123, stalledTaskIds: ["task-1"], stalledReason: "leader_unavailable" });

    projector.apply(makeEvent("room.unstalled", roomId, { roomId }, 456));

    room = emittedState.rooms.get(roomId);
    expect(room?.stalledAt).toBeUndefined();
    expect(room?.stalledTaskIds).toBeUndefined();
    expect(room?.stalledReason).toBeUndefined();
  });

  it("applies delegation, dispatch, and run collaboration payload ids", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "team" }));
    projector.apply(makeEvent("task.created", roomId, { taskId: "task-4", title: "Delegate", expectsReview: true, createdBy: "agent-0" }));
    projector.apply(makeEvent("task.delegation.created", roomId, {
      taskId: "task-4",
      delegationId: "task-4",
      runId: "run-child-1",
      status: "created",
      assigneeRoleId: "role-1",
      payload: { foo: "bar" }
    }));
    projector.apply(makeEvent("agent.run.started", roomId, { runId: "run-child-1", taskId: "task-4", parentRunId: "run-parent-1" }));
    projector.apply(makeEvent("agent.run.completed", roomId, { runId: "run-child-1" }));
    projector.apply(makeEvent("team.dispatch.started", roomId, { dispatchId: "team-dispatch:source_run_id:run-parent-1", leaderRunId: "run-lead-1", summary: "Dispatch started" }));

    const task = emittedState.rooms.get(roomId)?.tasks.find((item) => item.id === "task-4");
    const run = emittedState.rooms.get(roomId)?.runs.find((item) => item.id === "run-child-1");
    const brief = emittedState.rooms.get(roomId)?.briefs.find((item) => item.kind === "dispatch_started");

    expect(task?.delegations?.[0]).toMatchObject({ id: "task-4", runId: "run-child-1", status: "created" });
    expect(run).toMatchObject({ id: "run-child-1", taskId: "task-4", parentRunId: "run-parent-1" });
    expect(brief).toMatchObject({ dispatchId: "team-dispatch:source_run_id:run-parent-1", runId: "run-lead-1" });
  });

  it("stores skill materialization failures with skill name for chat visibility", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "team" }));
    projector.apply(makeEvent("skill.materialization_failed", roomId, {
      skillId: "skill-1",
      name: "task-planner",
      runId: "run-skill-1",
      error: "disk full"
    }));

    const room = emittedState.rooms.get(roomId);
    expect(room?.skillErrors).toEqual([
      expect.objectContaining({ skillId: "skill-1", skillName: "task-planner", runId: "run-skill-1", error: "disk full" })
    ]);
  });

  it("infers failed brief kind from run state when replaying legacy brief payloads", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "team" }));
    projector.apply(makeEvent("agent.run.failed", roomId, {
      runId: "run-failed-1",
      reason: "adapter_start_failed",
      failureClass: "configuration",
      error: "require is not defined"
    }));
    projector.apply(makeEvent("message.brief.published", roomId, {
      runId: "run-failed-1",
      text: "Run updated"
    }));

    const brief = emittedState.rooms.get(roomId)?.briefs.find((item) => item.runId === "run-failed-1");
    expect(brief).toMatchObject({
      kind: "run_failed",
      summary: "Run updated"
    });
  });
});

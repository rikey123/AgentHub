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

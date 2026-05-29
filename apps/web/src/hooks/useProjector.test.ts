import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getProjector } from "./useProjector.ts";
import type { ProjectorState } from "../types.ts";

function makeEvent(type: string, roomId: string, payload: Record<string, unknown>, createdAt = Date.now()) {
  return {
    id: randomUUID(),
    type,
    schemaVersion: 1,
    durability: "durable" as const,
    visibility: "both" as const,
    workspaceId: "default-workspace",
    roomId,
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
      status: "pending",
      description: "details",
      priority: "high",
      assigneeRoleId: "role-1",
      assigneeBindingId: "binding-1",
      assigneeAgentId: "agent-1",
      expectsReview: true,
      parentTaskId: "task-parent",
      delegationChain: [{ byRoleId: "role-0", atRunId: "run-0", atTimestamp: 1 }],
      sourceRunId: "run-1"
    }));

    const task = emittedState.rooms.get(roomId)?.tasks.find((item) => item.id === "task-1");
    expect(task).toMatchObject({
      id: "task-1",
      title: "Ship it",
      status: "pending",
      description: "details",
      priority: "high",
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
});

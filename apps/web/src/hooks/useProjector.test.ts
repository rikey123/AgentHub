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

function makeAgentEvent<T extends EventType>(type: T, roomId: string, agentId: string, payload: Record<string, unknown>, createdAt = Date.now()) {
  return {
    ...makeEvent(type, roomId, payload, createdAt),
    agentId
  };
}

function makeWorkspaceEvent<T extends EventType>(type: T, payload: Record<string, unknown>, createdAt = Date.now()) {
  return {
    id: randomUUID(),
    type,
    schemaVersion: 1,
    durability: "durable" as const,
    visibility: "both" as const,
    workspaceId: "default-workspace",
    payload,
    createdAt
  };
}

describe("useProjector replay handling", () => {
  let emittedState: ProjectorState;
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    emittedState = { rooms: new Map(), workflows: [], connectionStatus: "disconnected" };
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

  it("projects minimized task.plan.created into room-level execution plan state", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "team" }));
    projector.apply(makeEvent("task.plan.created", roomId, {
      roomId,
      runId: "run-plan",
      planId: "plan-1",
      taskCount: 1
    }, 321));

    expect(emittedState.rooms.get(roomId)?.executionPlan).toEqual({
      planId: "plan-1",
      runId: "run-plan",
      planJson: null,
      taskCount: 1,
      createdAt: 321
    });
  });

  it("appends artifact attachment parts from live message.part.added events", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "assisted" }));
    projector.apply(makeAgentEvent("message.created", roomId, "agent-builder", {
      messageId: "msg-file-1",
      role: "assistant",
      senderId: "agent-builder",
      senderType: "agent",
      text: "I wrote the full architecture note as a file."
    }));

    projector.apply(makeEvent("message.part.added", roomId, {
      messageId: "msg-file-1",
      part: {
        type: "attachment",
        seq: 1,
        fileId: "file-1",
        name: "multi-agent-platform-architecture.md",
        mimeType: "text/markdown",
        sizeBytes: 2048,
        artifactId: "artifact-1",
        path: "multi-agent-platform-architecture.md",
        previewKind: "markdown"
      }
    }));

    const message = emittedState.rooms.get(roomId)?.messages.find((item) => item.id === "msg-file-1");
    expect(message?.parts).toEqual([
      {
        type: "attachment",
        seq: 1,
        fileId: "file-1",
        name: "multi-agent-platform-architecture.md",
        mimeType: "text/markdown",
        sizeBytes: 2048,
        artifactId: "artifact-1",
        path: "multi-agent-platform-architecture.md",
        previewKind: "markdown"
      }
    ]);
  });

  it("removes deleted messages and pending turn entries from live state", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "assisted" }));
    projector.apply(makeEvent("message.created", roomId, {
      messageId: "msg-delete-1",
      role: "user",
      text: "Please remove me"
    }));
    projector.apply(makeEvent("pending_turn.created", roomId, {
      messageId: "msg-delete-1",
      pendingTurnId: "turn-delete-1"
    }));

    expect(emittedState.rooms.get(roomId)?.messages.map((item) => item.id)).toEqual(["msg-delete-1"]);
    expect(emittedState.rooms.get(roomId)?.pendingTurns.map((item) => item.id)).toEqual(["msg-delete-1"]);

    projector.apply(makeEvent("message.deleted", roomId, { messageId: "msg-delete-1" }));

    expect(emittedState.rooms.get(roomId)?.messages).toEqual([]);
    expect(emittedState.rooms.get(roomId)?.pendingTurns).toEqual([]);
  });

  it("projects cancelling runs so stop discussion gives immediate feedback", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "assisted" }));
    projector.apply(makeAgentEvent("agent.joined", roomId, "agent-builder", { agentId: "agent-builder", agentName: "Builder", role: "teammate" }));
    projector.apply(makeAgentEvent("agent.run.started", roomId, "agent-builder", { runId: "run-cancel-1" }));

    projector.apply(makeAgentEvent("agent.run.cancelling", roomId, "agent-builder", { runId: "run-cancel-1" }));

    const run = emittedState.rooms.get(roomId)?.runs.find((item) => item.id === "run-cancel-1");
    expect(run).toMatchObject({ id: "run-cancel-1", agentName: "Builder", status: "cancelling" });
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

  it("keeps queued run wake reason and message id for assisted group turn UI", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "assisted" }));
    projector.apply(makeAgentEvent("agent.joined", roomId, "agent-builder", { agentId: "agent-builder", agentName: "Builder", role: "teammate" }));
    projector.apply(makeAgentEvent("agent.run.queued", roomId, "agent-builder", {
      runId: "run-builder-1",
      wakeReason: "primary_turn",
      messageId: "msg-user-1"
    }));

    const run = emittedState.rooms.get(roomId)?.runs.find((item) => item.id === "run-builder-1");
    expect(run).toMatchObject({
      wakeReason: "primary_turn",
      messageId: "msg-user-1"
    });
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

  it("rebuilds workflow graph and runtime state from durable workflow events", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "team" }));
    projector.apply(makeEvent("workflow.created", roomId, {
      workflow: {
        id: "workflow-1",
        workspaceId: "default-workspace",
        roomId,
        name: "Agent handoff",
        draftVersionId: "workflow-version-1",
        createdAt: 1,
        updatedAt: 1
      },
      version: {
        id: "workflow-version-1",
        workflowId: "workflow-1",
        versionNumber: 1,
        state: "draft",
        valid: true,
        validationErrors: [],
        viewport: {},
        createdAt: 1,
        updatedAt: 1
      },
      nodes: [
        {
          id: "workflow-node-row-a",
          workflowVersionId: "workflow-version-1",
          nodeId: "node-a",
          kind: "agent_context",
          displayName: "Planner",
          prompt: "Plan",
          position: { x: 10, y: 20 },
          enabled: true,
          locked: false,
          config: {},
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: "workflow-node-row-b",
          workflowVersionId: "workflow-version-1",
          nodeId: "node-b",
          kind: "agent_context",
          displayName: "Reviewer",
          prompt: "Review",
          position: { x: 320, y: 20 },
          enabled: true,
          locked: false,
          config: {},
          createdAt: 1,
          updatedAt: 1
        }
      ],
      edges: [
        {
          id: "workflow-edge-row-ab",
          workflowVersionId: "workflow-version-1",
          edgeId: "edge-a-b",
          sourceNodeId: "node-a",
          targetNodeId: "node-b",
          enabled: true,
          config: {},
          createdAt: 1,
          updatedAt: 1
        }
      ],
      validation: {
        runnable: true,
        issues: [],
        upstreamByNodeId: { "node-b": ["node-a"] },
        downstreamByNodeId: { "node-a": ["node-b"] }
      }
    }, 100));
    projector.apply(makeEvent("workflow.run.started", roomId, {
      workflowId: "workflow-1",
      run: {
        id: "workflow-run-1",
        workflowId: "workflow-1",
        workflowVersionId: "workflow-version-1",
        workspaceId: "default-workspace",
        roomId,
        status: "running",
        seedContext: "Investigate auth flow",
        startedAt: 110,
        createdAt: 110,
        updatedAt: 110
      }
    }, 110));
    projector.apply(makeEvent("workflow.node.queued", roomId, {
      workflowId: "workflow-1",
      workflowRunId: "workflow-run-1",
      nodeRun: {
        id: "workflow-node-run-a",
        workflowRunId: "workflow-run-1",
        workflowNodeId: "workflow-node-row-a",
        nodeId: "node-a",
        status: "queued",
        inputContexts: [],
        createdAt: 111,
        updatedAt: 111
      }
    }, 111));
    projector.apply(makeEvent("workflow.edge.delivery.mailbox_created", roomId, {
      workflowId: "workflow-1",
      workflowRunId: "workflow-run-1",
      delivery: {
        id: "workflow-delivery-ab",
        workflowRunId: "workflow-run-1",
        workflowEdgeId: "workflow-edge-row-ab",
        edgeId: "edge-a-b",
        sourceNodeId: "node-a",
        targetNodeId: "node-b",
        mailboxMessageId: "mailbox-1",
        status: "mailbox_created",
        context: {},
        attemptCount: 1,
        createdAt: 112,
        updatedAt: 112
      }
    }, 112));
    projector.apply(makeEvent("workflow.edge.delivery.delivered", roomId, {
      workflowId: "workflow-1",
      workflowRunId: "workflow-run-1",
      delivery: {
        id: "workflow-delivery-ab",
        workflowRunId: "workflow-run-1",
        workflowEdgeId: "workflow-edge-row-ab",
        edgeId: "edge-a-b",
        sourceNodeId: "node-a",
        targetNodeId: "node-b",
        mailboxMessageId: "mailbox-1",
        status: "delivered",
        context: { text: "A to B" },
        attemptCount: 1,
        createdAt: 112,
        updatedAt: 113,
        deliveredAt: 113
      }
    }, 113));

    const workflow = emittedState.workflows.find((item) => item.id === "workflow-1");
    expect(workflow).toMatchObject({
      id: "workflow-1",
      name: "Agent handoff",
      nodes: [{ nodeId: "node-a" }, { nodeId: "node-b" }],
      edges: [{ edgeId: "edge-a-b" }]
    });
    expect(workflow?.runs[0]).toMatchObject({
      id: "workflow-run-1",
      status: "running",
      nodeRuns: [{ id: "workflow-node-run-a", status: "queued" }],
      edgeDeliveries: [{ id: "workflow-delivery-ab", status: "delivered" }]
    });
    expect(emittedState.rooms.get(roomId)?.workflows?.[0]).toMatchObject({ id: "workflow-1" });
  });

  it("projects workspace workflows even when events are not room scoped", () => {
    const projector = getProjector();
    projector.apply(makeWorkspaceEvent("workflow.created", {
      workflow: {
        id: "workflow-workspace-1",
        workspaceId: "default-workspace",
        name: "Workspace handoff",
        draftVersionId: "workflow-version-workspace",
        createdAt: 1,
        updatedAt: 1
      },
      version: {
        id: "workflow-version-workspace",
        workflowId: "workflow-workspace-1",
        versionNumber: 1,
        state: "draft",
        valid: true,
        validationErrors: [],
        viewport: {},
        createdAt: 1,
        updatedAt: 1
      },
      nodes: [],
      edges: [],
      validation: {
        runnable: false,
        issues: [],
        upstreamByNodeId: {},
        downstreamByNodeId: {}
      }
    }, 100));

    expect(emittedState.workflows.find((item) => item.id === "workflow-workspace-1")).toMatchObject({
      name: "Workspace handoff",
      roomId: undefined
    });
  });

  it("replays workflow version updates without requiring a full workflow object", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "team" }));
    projector.apply(makeEvent("workflow.created", roomId, {
      workflow: {
        id: "workflow-update-1",
        workspaceId: "default-workspace",
        roomId,
        name: "Editable handoff",
        draftVersionId: "workflow-version-draft",
        createdAt: 1,
        updatedAt: 1
      },
      version: {
        id: "workflow-version-draft",
        workflowId: "workflow-update-1",
        versionNumber: 1,
        state: "draft",
        valid: true,
        validationErrors: [],
        viewport: {},
        createdAt: 1,
        updatedAt: 1
      },
      nodes: [
        {
          id: "workflow-update-node-a",
          workflowVersionId: "workflow-version-draft",
          nodeId: "node-a",
          kind: "agent_context",
          displayName: "Planner",
          prompt: "Plan",
          position: { x: 10, y: 20 },
          enabled: true,
          locked: false,
          config: {},
          createdAt: 1,
          updatedAt: 1
        }
      ],
      edges: [],
      validation: {
        runnable: true,
        issues: [],
        upstreamByNodeId: {},
        downstreamByNodeId: {}
      }
    }, 100));

    projector.apply(makeEvent("workflow.version.updated", roomId, {
      workflowId: "workflow-update-1",
      version: {
        id: "workflow-version-draft",
        workflowId: "workflow-update-1",
        versionNumber: 2,
        state: "draft",
        valid: true,
        validationErrors: [],
        viewport: {},
        createdAt: 1,
        updatedAt: 200
      },
      nodes: [
        {
          id: "workflow-update-node-a",
          workflowVersionId: "workflow-version-draft",
          nodeId: "node-a",
          kind: "agent_context",
          displayName: "Planner",
          prompt: "Plan",
          position: { x: 20, y: 40 },
          enabled: true,
          locked: false,
          config: {},
          createdAt: 1,
          updatedAt: 200
        },
        {
          id: "workflow-update-note",
          workflowVersionId: "workflow-version-draft",
          nodeId: "note-1",
          kind: "note",
          displayName: "Design note",
          prompt: "Summarize why this handoff exists.",
          position: { x: 180, y: 120 },
          enabled: true,
          locked: false,
          config: {},
          createdAt: 200,
          updatedAt: 200
        }
      ],
      edges: [],
      validation: {
        runnable: true,
        issues: [],
        upstreamByNodeId: {},
        downstreamByNodeId: {}
      }
    }, 200));

    const workflow = emittedState.workflows.find((item) => item.id === "workflow-update-1");
    expect(workflow).toMatchObject({
      name: "Editable handoff",
      updatedAt: 200,
      nodes: [
        { nodeId: "node-a", position: { x: 20, y: 40 } },
        { nodeId: "note-1", kind: "note" }
      ],
      edges: []
    });
    expect(workflow?.versions[0]).toMatchObject({ versionNumber: 2, updatedAt: 200 });
    expect(emittedState.rooms.get(roomId)?.workflows?.find((item) => item.id === "workflow-update-1")).toMatchObject({ id: "workflow-update-1" });
  });

  it("recognizes agent-authored message payloads even when replay lacks envelope agentId", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "team" }));
    projector.apply(makeAgentEvent("agent.joined", roomId, "agent-builder", { agentId: "agent-builder", agentName: "Builder", role: "teammate" }));
    projector.apply(makeEvent("message.created", roomId, {
      messageId: "agent-msg-1",
      senderId: "agent-builder",
      role: "user",
      text: "Done"
    }));

    const message = emittedState.rooms.get(roomId)?.messages.find((item) => item.id === "agent-msg-1");
    expect(message).toMatchObject({
      senderType: "agent",
      senderId: "agent-builder",
      senderName: "Builder",
      role: "user",
      text: "Done"
    });
  });

  it("projects agent.joined V1.1 member metadata for the Members panel", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "team" }));
    projector.apply(makeAgentEvent("agent.joined", roomId, "binding-builder", {
      agentId: "binding-builder",
      agentName: "Builder",
      role: "teammate",
      adapterId: "native",
      agentBindingId: "binding-builder",
      roleId: "role-builder",
      capabilities: ["code.edit", "file.write"]
    }));

    const participant = emittedState.rooms.get(roomId)?.participants.find((item) => item.id === "binding-builder");
    expect(participant).toMatchObject({
      id: "binding-builder",
      name: "Builder",
      role: "teammate",
      adapterId: "native",
      agentBindingId: "binding-builder",
      roleId: "role-builder",
      capabilities: ["code.edit", "file.write"]
    });
  });

  it("normalizes permission decisions from backend action words to view statuses", () => {
    const roomId = `room-${randomUUID()}`;
    const projector = getProjector();
    projector.apply(makeEvent("room.created", roomId, { roomId, title: "Room", mode: "team" }));
    projector.apply(makeAgentEvent("permission.requested", roomId, "agent-builder", {
      requestId: "perm-1",
      resource: { type: "file", path: "report.md", operation: "write" },
      reason: "file.write"
    }));
    projector.apply(makeAgentEvent("permission.resolved", roomId, "agent-builder", {
      requestId: "perm-1",
      decision: "deny",
      reason: "timeout"
    }));

    const permission = emittedState.rooms.get(roomId)?.pendingPermissions.find((item) => item.id === "perm-1");
    expect(permission?.status).toBe("expired");
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

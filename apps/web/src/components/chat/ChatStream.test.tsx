import { describe, expect, it } from "vitest";
import type { RoomViewModel } from "../../types.ts";
import { activeRunIndicatorProps, buildChatFeedItems } from "./ChatStream.tsx";

describe("ChatStream task notification feed", () => {
  it("keeps delegated task updates out of the main chat feed", () => {
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

    expect(buildChatFeedItems(room)).toEqual([]);
  });

  it("keeps team dispatch briefs out of the main chat feed", () => {
    const room = roomFixture({
      briefs: [
        {
          kind: "dispatch_started",
          runId: "run-review",
          dispatchId: "dispatch-1",
          agentId: "agent-lead",
          agentName: "Lead",
          summary: "Dispatch started"
        },
        {
          kind: "dispatch_completed",
          runId: "run-review",
          dispatchId: "dispatch-1",
          agentId: "agent-lead",
          agentName: "Lead",
          summary: "Dispatch completed"
        }
      ],
      tasks: [
        { id: "task-1", title: "Task one", status: "review" },
        { id: "task-2", title: "Task two", status: "review" },
        { id: "task-3", title: "Task three", status: "completed" }
      ]
    });

    expect(buildChatFeedItems(room)).toEqual([]);
  });

  it("keeps ordinary run briefs in the main chat feed", () => {
    const room = roomFixture({
      briefs: [
        {
          kind: "run_completed",
          runId: "run-1",
          agentId: "agent-builder",
          agentName: "Builder",
          summary: "Finished the reply"
        }
      ]
    });

    expect(buildChatFeedItems(room)).toMatchObject([
      { kind: "brief", id: "run-1-0" }
    ]);
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

  it("includes permission requests as chat-level actionable feed items", () => {
    const room = roomFixture({
      pendingPermissions: [
        {
          id: "perm-1",
          agentId: "agent-builder",
          agentName: "Builder",
          resource: { type: "file", path: "multi-agent-collaboration-report.md", operation: "write" },
          reason: "file.write",
          status: "pending"
        }
      ]
    });

    expect(buildChatFeedItems(room)).toMatchObject([
      { kind: "permission", id: "perm-1" }
    ]);
  });

  it("labels assisted active runs by their group turn for the same user message", () => {
    const room = roomFixture({
      mode: "assisted",
      runs: [
        { id: "run-builder", agentId: "builder", agentName: "Builder", status: "completed", wakeReason: "primary_turn", messageId: "msg-1" },
        { id: "run-reviewer", agentId: "reviewer", agentName: "Reviewer", status: "starting", wakeReason: "primary_turn", messageId: "msg-1" }
      ]
    });

    expect(activeRunIndicatorProps(room)).toEqual({
      runId: "run-reviewer",
      agentName: "Reviewer",
      status: "starting",
      mode: "assisted",
      turnIndex: 2
    });
  });

  it("keeps cancelling assisted runs visible as active stop feedback", () => {
    const room = roomFixture({
      mode: "assisted",
      runs: [
        { id: "run-builder", agentId: "builder", agentName: "Builder", status: "cancelling", wakeReason: "primary_turn", messageId: "msg-1" }
      ]
    });

    expect(activeRunIndicatorProps(room)).toEqual({
      runId: "run-builder",
      agentName: "Builder",
      status: "cancelling",
      mode: "assisted",
      turnIndex: 1
    });
  });
});

function roomFixture(patch: Partial<RoomViewModel>): RoomViewModel {
  return {
    id: "room-1",
    title: "Room",
    mode: "team",
    primaryAgentId: undefined,
    participants: [],
    participantContactNames: {},
    messages: [],
    briefs: [],
    unresolvedInterventions: [],
    pendingPermissions: [],
    contextItems: [],
    tasks: [],
    runs: [],
    pendingTurns: [],
    mailboxFailures: [],
    artifactVersionsById: {},
    deploymentsById: {},
    deploymentLogsById: {},
    unreadCount: 0,
    ...patch
  };
}

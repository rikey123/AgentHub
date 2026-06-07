import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RoomViewModel } from "../../types.ts";
import { ChatStream, activeRunIndicatorProps, buildChatFeedItems, latestRegenerableAgentMessageId, pinnedMessagesForDrawer } from "./ChatStream.tsx";

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

  it("orders pinned messages newest first for the Pinned Context drawer", () => {
    const room = roomFixture({
      messages: [
        messageFixture({ id: "old-pin", text: "Old durable context", pinnedAt: 100 }),
        messageFixture({ id: "not-pin", text: "Regular message" }),
        messageFixture({ id: "new-pin", text: "Latest durable context", pinnedAt: 200 })
      ]
    });

    expect(pinnedMessagesForDrawer(room).map((message) => message.id)).toEqual(["new-pin", "old-pin"]);
  });

  it("renders a collapsed Pinned Context drawer with unpin actions", () => {
    const html = renderToStaticMarkup(createElement(ChatStream, {
      room: roomFixture({
        messages: [
          messageFixture({ id: "message-pin-1", text: "API base path is /api/v2", pinnedAt: 200 }),
          messageFixture({ id: "message-pin-2", text: "Long artifact note", parts: [{ type: "card", seq: 1, card: { type: "artifact", artifactId: "artifact_1", kind: "web_page", title: "Large HTML" } }], pinnedAt: 100 })
        ]
      }),
      onSelectMessage: vi.fn(),
      onOpenRun: vi.fn(),
      onReply: vi.fn(),
      onQuote: vi.fn(),
      onPin: vi.fn(),
      onRegenerate: vi.fn(),
      onDelete: vi.fn(),
      onOpenTask: vi.fn(),
      onOpenTasks: vi.fn(),
      onCancelPending: vi.fn(),
      onEditPending: vi.fn(),
      csrfFetch: vi.fn<typeof fetch>(),
      connectionStatus: "connected"
    }));

    expect(html).toContain("Pinned Context");
    expect(html).toContain("2 pinned");
    expect(html).toContain("API base path is /api/v2");
    expect(html).toContain("@artifact:artifact_1");
    expect(html).toContain("Unpin pinned message");
  });

  it("warns when pinned artifact messages are compacted", () => {
    const html = renderToStaticMarkup(createElement(ChatStream, {
      room: roomFixture({
        messages: [
          messageFixture({
            id: "artifact-pin",
            text: "Large HTML artifact content should not be expanded in the pinned drawer.",
            parts: [{ type: "card", seq: 1, card: { type: "artifact", artifactId: "artifact_large", kind: "web_page", title: "Large HTML" } }],
            pinnedAt: 300
          })
        ]
      }),
      onSelectMessage: vi.fn(),
      onOpenRun: vi.fn(),
      onReply: vi.fn(),
      onQuote: vi.fn(),
      onPin: vi.fn(),
      onRegenerate: vi.fn(),
      onDelete: vi.fn(),
      onOpenTask: vi.fn(),
      onOpenTasks: vi.fn(),
      onCancelPending: vi.fn(),
      onEditPending: vi.fn(),
      csrfFetch: vi.fn<typeof fetch>(),
      connectionStatus: "connected"
    }));

    expect(html).toContain("@artifact:artifact_large");
    expect(html).toContain("Content compacted");
  });

  it("identifies only the latest completed agent message as regenerable", () => {
    expect(latestRegenerableAgentMessageId([
      messageFixture({ id: "older-agent", text: "Earlier answer", senderType: "agent", status: "completed", createdAt: 100 }),
      messageFixture({ id: "latest-user", text: "Follow-up", senderType: "user", status: "completed", createdAt: 150 }),
      messageFixture({ id: "streaming-agent", text: "Still running", senderType: "agent", status: "streaming", createdAt: 175 }),
      messageFixture({ id: "latest-agent", text: "Latest answer", senderType: "agent", status: "completed", createdAt: 200 })
    ])).toBe("latest-agent");
  });

  it("uses createdAt rather than array order for the latest regenerable agent message", () => {
    expect(latestRegenerableAgentMessageId([
      messageFixture({ id: "newest-agent", text: "Newest answer", senderType: "agent", status: "completed", createdAt: 300 }),
      messageFixture({ id: "older-agent", text: "Older answer", senderType: "agent", status: "completed", createdAt: 100 })
    ])).toBe("newest-agent");
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

function messageFixture(patch: Partial<RoomViewModel["messages"][number]>): RoomViewModel["messages"][number] {
  return {
    id: "message-1",
    roomId: "room-1",
    senderType: "agent",
    senderId: "agent",
    senderName: "Agent",
    role: "assistant",
    status: "completed",
    text: "",
    parts: [],
    createdAt: 1,
    ...patch
  };
}

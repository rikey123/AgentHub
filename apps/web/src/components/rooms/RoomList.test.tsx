import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RoomViewModel } from "../../types.ts";
import { orderedRoomsForList, RoomList } from "./RoomList.tsx";

describe("RoomList V1.2 behavior", () => {
  it("orders pinned rooms first then by last activity", () => {
    const rooms = [
      roomFixture({ id: "old", title: "Old", lastActivityAt: 10 }),
      roomFixture({ id: "pinned", title: "Pinned", pinnedAt: 20, lastActivityAt: 1 }),
      roomFixture({ id: "new", title: "New", lastActivityAt: 30 })
    ];

    expect(orderedRoomsForList(rooms, "").map((room) => room.id)).toEqual(["pinned", "new", "old"]);
  });

  it("searches title participant contact names and recent message text", () => {
    const rooms = [
      roomFixture({
        id: "contact",
        title: "General",
        participantContactNames: { "agent-1": "Review Captain" }
      }),
      roomFixture({
        id: "message",
        title: "Build",
        messages: [messageFixture({ text: "The deploy provider failed." })]
      }),
      roomFixture({ id: "miss", title: "Other" })
    ];

    expect(orderedRoomsForList(rooms, "captain").map((room) => room.id)).toEqual(["contact"]);
    expect(orderedRoomsForList(rooms, "provider").map((room) => room.id)).toEqual(["message"]);
  });

  it("does not render inert pin archive action labels before handlers exist", () => {
    const html = renderToStaticMarkup(createElement(RoomList, {
      rooms: [roomFixture({ id: "room-1", title: "Room 1", pinnedAt: 123 })],
      activeRoomId: "room-1",
      onSelect: vi.fn(),
      onCreate: vi.fn()
    }));

    expect(html).not.toContain("Unpin");
    expect(html).not.toContain("Pin");
    expect(html).not.toContain("Archive");
  });
});

function roomFixture(patch: Partial<RoomViewModel>): RoomViewModel {
  return {
    id: "room",
    title: "Room",
    mode: "assisted",
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
    roomId: "room",
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

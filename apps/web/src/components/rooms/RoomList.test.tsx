import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RoomViewModel } from "../../types.ts";
import { orderedRoomsForList, RoomList, updateRoomListSearchQuery } from "./RoomList.tsx";

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

  it("renders participant contact names in each room row", () => {
    const html = renderToStaticMarkup(createElement(RoomList, {
      rooms: [
        roomFixture({
          id: "contacts",
          title: "Contact Room",
          participantContactNames: {
            "agent-builder": "Builder Contact",
            "agent-reviewer": "Reviewer Contact"
          }
        })
      ],
      activeRoomId: "contacts",
      onSelect: vi.fn(),
      onCreate: vi.fn()
    }));

    expect(html).toContain("Builder Contact");
    expect(html).toContain("Reviewer Contact");
    expect(html).toContain("max-w-[132px]");
  });

  it("notifies the parent when the search query changes", () => {
    const setQuery = vi.fn();
    const onSearchQueryChange = vi.fn();

    updateRoomListSearchQuery("Builder", setQuery, onSearchQueryChange);

    expect(setQuery).toHaveBeenCalledWith("Builder");
    expect(onSearchQueryChange).toHaveBeenCalledWith("Builder");
  });

  it("can render server search results without re-filtering by local message text", () => {
    const html = renderToStaticMarkup(createElement(RoomList, {
      rooms: [
        roomFixture({ id: "server-only", title: "Architecture", messages: [] })
      ],
      activeRoomId: "server-only",
      onSelect: vi.fn(),
      onCreate: vi.fn(),
      useServerSearchResults: true
    }));

    expect(html).toContain("data-testid=\"room-list-item-server-only\"");
  });

  it("renders pin and unpin room actions without exposing archive", () => {
    const html = renderToStaticMarkup(createElement(RoomList, {
      rooms: [
        roomFixture({ id: "room-1", title: "Room 1" }),
        roomFixture({ id: "room-2", title: "Room 2", pinnedAt: 123 })
      ],
      activeRoomId: "room-1",
      onSelect: vi.fn(),
      onCreate: vi.fn(),
      onTogglePin: vi.fn()
    }));

    expect(html).toContain("置顶房间 Room 1");
    expect(html).toContain("取消置顶房间 Room 2");
    expect(html).toContain("打开房间 Room 1");
    expect(html).not.toContain("role=\"listbox\"");
    expect(html).not.toContain("role=\"option\"");
    expect(html).not.toContain("Archive");
  });

  it("keeps archived rooms out of the main list behind a collapsed entry", () => {
    const html = renderToStaticMarkup(createElement(RoomList, {
      rooms: [
        roomFixture({ id: "active", title: "Active Room", lastActivityAt: 20 }),
        roomFixture({ id: "archived", title: "Archived Room", archivedAt: 10, lastActivityAt: 30 })
      ],
      activeRoomId: "active",
      onSelect: vi.fn(),
      onCreate: vi.fn()
    }));

    expect(html).toContain("data-testid=\"room-list-item-active\"");
    expect(html).not.toContain("data-testid=\"room-list-item-archived\"");
    expect(html).toContain("data-testid=\"room-list-archive-entry\"");
    expect(html).toContain("已归档房间");
    expect(html).toContain("1");
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

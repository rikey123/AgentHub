import { describe, expect, it } from "vitest";

import { shouldUseDevProxy } from "./connection.ts";
import { applySnapshot, emptyMobileState, markOffline, mergeMessages, shouldRefreshSnapshot, visibleForRoom } from "./mobileState.ts";

describe("mobile state helpers", () => {
  it("applies a mobile snapshot and selects the first room", () => {
    const state = applySnapshot(emptyMobileState, {
      view: "mobile",
      cursor: 42,
      rooms: [{ id: "room_1", title: "Room" }],
      tasks: [],
      runs: [],
      permissions: [],
      artifacts: []
    });

    expect(state.status).toBe("connected");
    expect(state.cursor).toBe(42);
    expect(state.selectedRoomId).toBe("room_1");
    expect(typeof state.lastSyncedAt).toBe("number");
  });

  it("keeps prior snapshot data when the connection drops", () => {
    const connected = applySnapshot(emptyMobileState, {
      view: "mobile",
      cursor: 10,
      rooms: [{ id: "room_1", title: "Room" }],
      tasks: [{ id: "task_1", room_id: "room_1" }],
      runs: [],
      permissions: [],
      artifacts: []
    });
    const offline = markOffline(connected, "network down");

    expect(offline.status).toBe("offline");
    expect(offline.error).toBe("network down");
    expect(offline.rooms).toEqual([{ id: "room_1", title: "Room" }]);
    expect(offline.tasks).toEqual([{ id: "task_1", room_id: "room_1" }]);
  });

  it("deduplicates merged messages by id", () => {
    expect(mergeMessages([{ id: "m1", created_at: 1 }], [{ id: "m1", created_at: 1 }, { id: "m2", created_at: 2 }])).toEqual([
      { id: "m1", created_at: 1 },
      { id: "m2", created_at: 2 }
    ]);
  });

  it("filters records by snake or camel room id", () => {
    expect(visibleForRoom([{ id: "a", room_id: "room_1" }, { id: "b", roomId: "room_2" }], "room_2")).toEqual([{ id: "b", roomId: "room_2" }]);
  });

  it("refreshes snapshots for mobile-relevant event families", () => {
    expect(shouldRefreshSnapshot({ id: "e1", type: "permission.requested", schemaVersion: 1, durability: "durable", visibility: "main", seq: 1, workspaceId: "w", payload: {}, createdAt: 1 })).toBe(true);
    expect(shouldRefreshSnapshot({ id: "e2", type: "adapter.raw.stdout", schemaVersion: 1, durability: "ephemeral", visibility: "detail", seq: 2, workspaceId: "w", payload: {}, createdAt: 2 })).toBe(false);
  });

  it("uses the Vite proxy for browser mobile dev traffic on port 5174", () => {
    expect(shouldUseDevProxy({ port: "5174" })).toBe(true);
    expect(shouldUseDevProxy({ port: "6677" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { EventMigrator, UnsupportedEventSchemaVersionError } from "../src/events/index.ts";

describe("EventMigrator", () => {
  it("returns v1 events unchanged after envelope validation", () => {
    const input = {
      id: "evt_v1",
      type: "room.created",
      schemaVersion: 1,
      durability: "durable",
      visibility: "both",
      seq: 7,
      workspaceId: "workspace_01",
      roomId: "room_01",
      payload: { roomId: "room_01" },
      createdAt: 1_764_000_000_100
    };

    const migrated = new EventMigrator().migrate(input);

    expect(migrated).toEqual(input);
  });

  it("rejects unsupported future versions explicitly", () => {
    expect(() =>
      new EventMigrator().migrate({
        id: "evt_v2",
        type: "room.created",
        schemaVersion: 2,
        durability: "durable",
        visibility: "both",
        seq: 8,
        workspaceId: "workspace_01",
        roomId: "room_01",
        payload: { roomId: "room_01" },
        createdAt: 1_764_000_000_101
      })
    ).toThrow(UnsupportedEventSchemaVersionError);
  });
});

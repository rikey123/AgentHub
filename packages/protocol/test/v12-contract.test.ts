import { describe, expect, it } from "vitest";
import { EVENT_PAYLOAD_SCHEMAS, EVENT_REGISTRY } from "../src/events/index.ts";

describe("V1.2 contract registry", () => {
  it("includes deployment and artifact version events", () => {
    const eventTypes = new Set(EVENT_REGISTRY.map((entry) => entry.type));

    for (const type of [
      "artifact.version.created",
      "deployment.created",
      "deployment.status.changed",
      "deployment.log.appended",
      "deployment.ready",
      "deployment.failed",
      "deployment.cancelled",
      "deployment.expired",
      "deployment.unpublished",
      "room.pinned",
      "room.unpinned",
      "task.unblocked",
      "wake_outbox.dispatched"
    ]) {
      expect(eventTypes.has(type)).toBe(true);
    }
  });

  it("registers payload schemas for the V1.2 additions", () => {
    for (const type of [
      "artifact.version.created",
      "deployment.created",
      "deployment.status.changed",
      "deployment.log.appended",
      "deployment.ready",
      "deployment.failed",
      "deployment.cancelled",
      "deployment.expired",
      "deployment.unpublished",
      "room.pinned",
      "room.unpinned",
      "task.unblocked",
      "wake_outbox.dispatched"
    ]) {
      expect(type in EVENT_PAYLOAD_SCHEMAS).toBe(true);
    }
  });
});

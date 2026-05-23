import { describe, expect, it } from "vitest";
import { EVENT_REGISTRY, checkProtocolSchemas } from "../src/events/index.ts";

describe("schema registry checks", () => {
  it("validates canonical registry consistency", () => {
    const result = checkProtocolSchemas();

    expect(result.ok).toBe(true);
    expect(result.checkedEventTypes).toBe(EVENT_REGISTRY.length);
    expect(EVENT_REGISTRY.length).toBeGreaterThan(0);
  });
});

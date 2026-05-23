import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { EventEnvelopeSchema, assertEnvelopeMatchesRegistry } from "../src/events/index.ts";

describe("EventEnvelopeSchema", () => {
  it("decodes a durable envelope with required trace and classification fields", () => {
    const decoded = Schema.decodeUnknownSync(EventEnvelopeSchema)({
      id: "evt_01",
      type: "message.created",
      schemaVersion: 1,
      durability: "durable",
      visibility: "both",
      seq: 42,
      workspaceId: "workspace_01",
      roomId: "room_01",
      runId: "run_01",
      agentId: "agent_01",
      traceId: "trace_01",
      causationId: "evt_parent",
      correlationId: "run_01",
      payload: { messageId: "message_01" },
      createdAt: 1_764_000_000_000
    });

    assertEnvelopeMatchesRegistry(decoded);
    expect(decoded.type).toBe("message.created");
    expect(decoded.seq).toBe(42);
  });

  it("decodes an ephemeral envelope without seq", () => {
    const decoded = Schema.decodeUnknownSync(EventEnvelopeSchema)({
      id: "evt_02",
      type: "message.part.delta",
      schemaVersion: 1,
      durability: "ephemeral",
      visibility: "detail",
      workspaceId: "workspace_01",
      roomId: "room_01",
      payload: { messageId: "message_01", seq: 0, delta: "Hello" },
      createdAt: 1_764_000_000_001
    });

    assertEnvelopeMatchesRegistry(decoded);
    expect(decoded.seq).toBeUndefined();
  });

  it("rejects envelopes missing schemaVersion", () => {
    expect(() =>
      Schema.decodeUnknownSync(EventEnvelopeSchema)({
        id: "evt_missing_version",
        type: "message.created",
        durability: "durable",
        visibility: "both",
        seq: 1,
        workspaceId: "workspace_01",
        payload: {},
        createdAt: 1
      })
    ).toThrow();
  });

  it("rejects registry mismatches for ephemeral seq", () => {
    const decoded = Schema.decodeUnknownSync(EventEnvelopeSchema)({
      id: "evt_bad_seq",
      type: "message.part.delta",
      schemaVersion: 1,
      durability: "ephemeral",
      visibility: "detail",
      seq: 9,
      workspaceId: "workspace_01",
      payload: {},
      createdAt: 1
    });

    expect(() => assertEnvelopeMatchesRegistry(decoded)).toThrow("must not carry seq");
  });
});

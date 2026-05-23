import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { CodexAdapterStub } from "../src/index.ts";

describe("CodexAdapterStub", () => {
  it("is interface-only and returns deterministic 501 not implemented", () => {
    const adapter = new CodexAdapterStub();
    expect(Effect.runSync(adapter.detect())).toEqual([]);
    expect(() => Effect.runSync(Stream.runDrain(adapter.runAgent({ runId: "run", message: { role: "user", content: "hi" } })))).toThrow(/CodexAdapter is V1.x/iu);
  });
});

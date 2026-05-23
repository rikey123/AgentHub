import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { OpenCodeAdapterStub } from "../src/index.ts";

describe("OpenCodeAdapterStub", () => {
  it("is interface-only and returns deterministic 501 not implemented", () => {
    const adapter = new OpenCodeAdapterStub();
    expect(Effect.runSync(adapter.detect())).toEqual([]);
    expect(() => Effect.runSync(Stream.runDrain(adapter.runAgent({ runId: "run", message: { role: "user", content: "hi" } })))).toThrow(/OpenCodeAdapter is V0.5/iu);
  });
});

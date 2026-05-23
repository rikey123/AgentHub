import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { A2AAdapterStub } from "../src/index.ts";

describe("A2AAdapterStub", () => {
  it("is interface-only and returns deterministic 501 not implemented", () => {
    const adapter = new A2AAdapterStub();
    expect(Effect.runSync(adapter.detect())).toEqual([]);
    expect(() => Effect.runSync(Stream.runDrain(adapter.runAgent({ runId: "run", message: { role: "user", content: "hi" } })))).toThrow(/A2AAdapter is V1.3/iu);
  });
});

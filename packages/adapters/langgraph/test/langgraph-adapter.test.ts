import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { LangGraphAdapterStub } from "../src/index.ts";

describe("LangGraphAdapterStub", () => {
  it("is interface-only and returns deterministic 501 not implemented", () => {
    const adapter = new LangGraphAdapterStub();
    expect(Effect.runSync(adapter.detect())).toEqual([]);
    expect(() => Effect.runSync(Stream.runDrain(adapter.runAgent({ runId: "run", message: { role: "user", content: "hi" } })))).toThrow(/LangGraphAdapter is V1.3/iu);
  });
});

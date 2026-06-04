import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TypingIndicator } from "./TypingIndicator.tsx";

describe("TypingIndicator", () => {
  it("renders assisted group turn status as a speaker handoff instead of a raw run state", () => {
    const html = renderToStaticMarkup(createElement(TypingIndicator, {
      agentName: "Reviewer",
      status: "starting",
      mode: "assisted",
      turnIndex: 2
    }));

    expect(html).toContain("Reviewer is speaking");
    expect(html).toContain("Group turn 2");
    expect(html).not.toContain(">starting<");
  });
});

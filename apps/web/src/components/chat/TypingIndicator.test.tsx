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

    expect(html).toContain("Reviewer 正在发言");
    expect(html).toContain("第 2 轮");
    expect(html).not.toContain(">starting<");
  });

  it("renders an assisted discussion stop action", () => {
    const html = renderToStaticMarkup(createElement(TypingIndicator, {
      agentName: "Reviewer",
      status: "running",
      mode: "assisted",
      turnIndex: 4,
      runId: "run-4",
      onStopDiscussion: () => undefined
    }));

    expect(html).toContain("停止讨论");
    expect(html).toContain("Reviewer 正在发言");
    expect(html).toContain("第 4 轮");
  });

  it("renders cancelling feedback instead of another stop action", () => {
    const html = renderToStaticMarkup(createElement(TypingIndicator, {
      agentName: "Builder",
      status: "cancelling",
      mode: "assisted",
      turnIndex: 1,
      runId: "run-1",
      onStopDiscussion: () => undefined
    }));

    expect(html).toContain("Builder 正在停止");
    expect(html).toContain("正在停止讨论");
    expect(html).not.toContain("停止讨论</button>");
  });
});

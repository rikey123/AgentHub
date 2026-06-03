import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MessageViewModel } from "../../types.ts";
import { MessageItem } from "./MessageItem.tsx";

describe("MessageItem public chat rendering", () => {
  it("collapses long completed agent text in the public chat bubble", () => {
    const longText = [
      "Here is the full platform architecture review.",
      "Section one explains the control plane in detail.",
      "Section two explains the execution plane in detail.",
      "Section three explains the data plane in detail.",
      "Section four explains governance and observability in detail.",
      "Section five explains roadmap and implementation sequencing in detail."
    ].join("\n\n");

    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        senderType: "agent",
        senderName: "Builder",
        text: longText,
        status: "completed",
        runId: "run_1"
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("Show full");
    expect(html).toContain("Long agent reply");
    expect(html).toContain("Here is the full platform architecture review.");
    expect(html).not.toContain("Section five explains roadmap and implementation sequencing in detail.");
  });

  it("does not collapse user text", () => {
    const longText = [
      "This is a long user message.",
      "It should stay visible because it is the user's input.",
      "The chat UI should not hide what the user wrote.",
      "The final sentence should still render."
    ].join("\n\n");

    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        senderType: "user",
        senderName: "You",
        text: longText,
        status: "completed"
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).not.toContain("Show full");
    expect(html).toContain("The final sentence should still render.");
  });
});

function messageFixture(patch: Partial<MessageViewModel>): MessageViewModel {
  return {
    id: "message_1",
    roomId: "room_1",
    senderType: "agent",
    senderId: "agent_1",
    senderName: "Builder",
    role: "teammate",
    status: "completed",
    text: "Done.",
    parts: [],
    createdAt: 1_700_000_000,
    ...patch
  };
}

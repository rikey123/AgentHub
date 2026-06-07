import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MessageViewModel } from "../../types.ts";
import { copyCodeButtonLabel, MessageItem, shouldSelectMessageFromTarget } from "./MessageItem.tsx";

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

    expect(html).toContain("展开全文");
    expect(html).toContain("长回复");
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

    expect(html).not.toContain("展开全文");
    expect(html).toContain("The final sentence should still render.");
  });

  it("renders agent messages with a visible group-chat speaker badge", () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        senderType: "agent",
        senderName: "Reviewer",
        role: "teammate",
        text: "I see one risk in the handoff."
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("Reviewer");
    expect(html).toContain("teammate");
    expect(html).toContain("data-speaker-type=\"agent\"");
  });

  it("renders artifact attachments as clickable file cards", () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        text: "I put the full design in a file.",
        parts: [{
          type: "attachment",
          seq: 1,
          fileId: "artifact_1",
          artifactId: "artifact_1",
          name: "multi-agent-platform-architecture.md",
          mimeType: "text/markdown",
          sizeBytes: 4096,
          path: "multi-agent-platform-architecture.md",
          previewKind: "markdown"
        }]
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("data-testid=\"artifact-file-card\"");
    expect(html).toContain("multi-agent-platform-architecture.md");
    expect(html).toContain("Markdown");
    expect(html).toContain("4.0 KB");
    expect(html).toContain("Open file preview");
  });

  it("renders a Copy Code action for code parts", () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        text: "Use this snippet.",
        parts: [{ type: "code", seq: 1, lang: "ts", text: "const apiBase = '/api/v2';" }]
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("const apiBase = &#x27;/api/v2&#x27;;");
    expect(html).toContain("Copy Code");
    expect(html).toContain("Copy code block");
  });

  it("matches the spec label while a code block copy is confirmed", () => {
    expect(copyCodeButtonLabel(true)).toBe("Copied ✓");
    expect(copyCodeButtonLabel(false)).toBe("Copy Code");
  });

  it("renders Markdown fenced code blocks with Copy Code actions", () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        text: [
          "Use this endpoint:",
          "",
          "```ts",
          "const apiBase = '/api/v2';",
          "```",
          "",
          "Then send requests through it."
        ].join("\n")
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("Use this endpoint:");
    expect(html).toContain("const apiBase = &#x27;/api/v2&#x27;;");
    expect(html).toContain("Copy Code");
    expect(html).toContain("Copy code block");
    expect(html).not.toContain("```ts");
  });

  it("does not expose the message wrapper as a button when nested actions render", () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        text: "Use this snippet.",
        parts: [{ type: "code", seq: 1, lang: "ts", text: "const apiBase = '/api/v2';" }]
      }),
      onSelect: vi.fn(),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("Copy Code");
    expect(html).not.toContain("role=\"button\"");
  });

  it("does not select the message when a nested action is clicked", () => {
    const actionTarget = {
      closest: vi.fn((selector: string) => selector.includes("button") ? {} : null)
    } as unknown as Element;

    expect(shouldSelectMessageFromTarget(actionTarget)).toBe(false);
    expect(actionTarget.closest).toHaveBeenCalledWith("button,a,input,textarea,select,[role='button'],[data-message-action]");
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

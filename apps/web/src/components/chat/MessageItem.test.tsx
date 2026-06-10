import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MessageViewModel } from "../../types.ts";
import { copyCodeButtonLabel, MessageItem, pinActionLabel, regenerateActionLabel, shouldSelectMessageFromTarget } from "./MessageItem.tsx";

describe("MessageItem public chat rendering", () => {
  it("renders long completed agent text expanded by default", () => {
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

    expect(html).toContain("data-testid=\"long-message-disclosure\"");
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("ah-long-message-label");
    expect(html).toContain(">长回复<");
    expect(html).toContain(">全文已展开<");
    expect(html).toContain(">收起<");
    expect(html).not.toContain("展开全文");
    expect(html).toContain("Here is the full platform architecture review.");
    expect(html).toContain("Section five explains roadmap and implementation sequencing in detail.");
  });

  it("renders common markdown formatting in message text", () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        text: [
          "This system has **10 switching positions**.",
          "",
          "- **5-way selector**: 5 positions",
          "- **Alter Switch**: 2 modes"
        ].join("\n")
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("<strong");
    expect(html).toContain("10 switching positions");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).not.toContain("**10 switching positions**");
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

  it("keeps run details as a secondary action in the long reply disclosure", () => {
    const longText = [
      "Here is the full platform architecture review.",
      "Section one explains the control plane in detail.",
      "Section two explains the execution plane in detail.",
      "Section three explains the data plane in detail.",
      "Section four explains governance and observability in detail."
    ].join("\n\n");

    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        senderType: "agent",
        senderName: "Builder",
        text: longText,
        status: "completed",
        runId: "run_1"
      }),
      onOpenRun: vi.fn(),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("data-testid=\"long-message-run-details\"");
    expect(html).toContain(">运行详情<");
    expect(html).not.toContain(">打开运行详情<");
  });

  it("renders agent messages with a visible group-chat speaker badge", () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        senderType: "agent",
        senderName: "Reviewer",
        senderAvatarUrl: "/avatars/dicebear/v1/notionists-neutral/role%3Areviewer.svg",
        role: "teammate",
        text: "I see one risk in the handoff."
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("Reviewer");
    expect(html).toContain("teammate");
    expect(html).toContain("data-speaker-type=\"agent\"");
    expect(html).toContain("src=\"/avatars/dicebear/v1/notionists-neutral/role%3Areviewer.svg\"");
  });

  it("renders the user sender avatar on the right side of user messages", () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        senderType: "user",
        senderName: "You",
        senderAvatarUrl: "/avatars/dicebear/v1/notionists-neutral/Zoish.svg",
        text: "Please review this change."
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("data-speaker-type=\"user\"");
    expect(html).toContain("src=\"/avatars/dicebear/v1/notionists-neutral/Zoish.svg\"");
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
    expect(html).toContain("打开文件预览");
    expect(html).toContain(">打开<");
  });

  it("renders uploaded attachments as enabled file cards without artifact metadata", () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        text: "Please inspect this upload.",
        parts: [{
          type: "attachment",
          seq: 1,
          fileId: "123e4567-e89b-12d3-a456-426614174101",
          name: "question.md",
          mimeType: "text/markdown",
          sizeBytes: 128,
          previewKind: "markdown"
        }]
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("data-testid=\"artifact-file-card\"");
    expect(html).toContain("question.md");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("does not render a duplicate text part when message text already contains it", () => {
    const text = "Read the attachment and answer my question.";
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: messageFixture({
        senderType: "user",
        senderName: "You",
        text,
        parts: [
          { type: "text", seq: 1, text },
          {
            type: "attachment",
            seq: 2,
            fileId: "123e4567-e89b-12d3-a456-426614174101",
            name: "question.md",
            mimeType: "text/markdown",
            sizeBytes: 128,
            previewKind: "markdown"
          }
        ]
      }),
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html.indexOf(text)).toBe(html.lastIndexOf(text));
    expect(html).toContain("question.md");
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
    expect(html).toContain("复制代码");
    expect(html).toContain("复制代码块");
  });

  it("matches the spec label while a code block copy is confirmed", () => {
    expect(copyCodeButtonLabel(true)).toBe("已复制");
    expect(copyCodeButtonLabel(false)).toBe("复制代码");
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
    expect(html).toContain("复制代码");
    expect(html).toContain("复制代码块");
    expect(html).not.toContain("```ts");
  });

  it("labels the pin action by current pinned state", () => {
    expect(pinActionLabel(false)).toBe("Pin");
    expect(pinActionLabel(true)).toBe("Unpin");
  });

  it("labels the regenerate action with the spec text", () => {
    expect(regenerateActionLabel()).toBe("Regenerate");
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

    expect(html).toContain("复制代码");
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

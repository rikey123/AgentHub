import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ComposerPillList,
  buildComposerSendPayload,
  buildDraftWithComposerReference,
  insertTextAtSelection,
  parseComposerReferenceTokens,
  type ComposerMentionToken
} from "./InputBox.tsx";

describe("InputBox draft insertion helpers", () => {
  it("inserts pending quote text at the current composer cursor", () => {
    const quoteText = "> API base path is /api/v2";

    expect(insertTextAtSelection("Ask  now", quoteText, 4, 4)).toEqual({
      text: `Ask ${quoteText} now`,
      cursor: 4 + quoteText.length
    });
  });

  it("replaces the current selection when inserting pending quote text", () => {
    const quoteText = "> Use /api/v2";

    expect(insertTextAtSelection("Ask old path now", quoteText, 4, 12)).toEqual({
      text: `Ask ${quoteText} now`,
      cursor: 4 + quoteText.length
    });
  });
});

describe("InputBox V1.2 composer token model", () => {
  it("parses artifact and workspace token strings into structured refs", () => {
    const tokens = parseComposerReferenceTokens(
      "Use @artifact:doc-1, @artifact:artifact-1#L10-L25, @artifact:deck-1#slide=3, and @workspace:src/app.ts#L1-L2"
    );

    expect(tokens.map((token) => token.token)).toEqual([
      "@artifact:doc-1",
      "@artifact:artifact-1#L10-L25",
      "@artifact:deck-1#slide=3",
      "@workspace:src/app.ts#L1-L2"
    ]);
    expect(tokens.map((token) => token.ref)).toEqual([
      { type: "artifact", artifactId: "doc-1" },
      { type: "artifact", artifactId: "artifact-1", lineStart: 10, lineEnd: 25 },
      { type: "artifact", artifactId: "deck-1", slide: 3 },
      { type: "workspace", path: "src/app.ts", lineStart: 1, lineEnd: 2 }
    ]);
  });

  it("serializes readable token text with structured mentions and refs", () => {
    const mention: ComposerMentionToken = {
      kind: "mention",
      id: "mention:binding-frontend",
      token: "@frontend-builder",
      agentBindingId: "binding-frontend",
      label: "Frontend Builder",
      roleName: "builder",
      runtimeName: "Claude Code",
      source: "participant"
    };

    const payload = buildComposerSendPayload({
      text: "  Ask @frontend-builder to inspect @artifact:artifact-1#L10-L25  ",
      attachments: [],
      mentionTokens: [mention],
      referenceTokens: parseComposerReferenceTokens("@artifact:artifact-1#L10-L25")
    });

    expect(payload).toEqual({
      text: "Ask @frontend-builder to inspect @artifact:artifact-1#L10-L25",
      attachmentIds: [],
      mentions: ["binding-frontend"],
      mentionPayloads: [{
        agentBindingId: "binding-frontend",
        label: "Frontend Builder",
        roleName: "builder",
        runtimeName: "Claude Code"
      }],
      refs: [{ type: "artifact", artifactId: "artifact-1", lineStart: 10, lineEnd: 25 }]
    });
  });

  it("turns Reference in Chat inserts into structured ref pills", () => {
    const draft = buildDraftWithComposerReference(
      { text: "Please inspect" },
      { type: "artifact", artifactId: "report-1", lineStart: 10, lineEnd: 25 }
    );

    expect(draft.text).toBe("Please inspect @artifact:report-1#L10-L25");
    expect(draft.composerTokens).toEqual([
      expect.objectContaining({
        kind: "ref",
        token: "@artifact:report-1#L10-L25",
        ref: { type: "artifact", artifactId: "report-1", lineStart: 10, lineEnd: 25 }
      })
    ]);
  });

  it("renders independent pills for mentions and context refs", () => {
    const html = renderToStaticMarkup(createElement(ComposerPillList, {
      tokens: [
        {
          kind: "mention",
          id: "mention:binding-frontend",
          token: "@frontend-builder",
          agentBindingId: "binding-frontend",
          label: "Frontend Builder",
          source: "participant"
        },
        ...parseComposerReferenceTokens("@artifact:artifact-1#slide=2 @workspace:src/app.ts#L1-L3")
      ]
    }));

    expect(html).toContain('data-testid="composer-pill-mention-binding-frontend"');
    expect(html).toContain('data-testid="composer-pill-ref-artifact-artifact-1-slide-2"');
    expect(html).toContain('data-testid="composer-pill-ref-workspace-src-app-ts-lines-1-3"');
    expect(html).toContain("@frontend-builder");
    expect(html).toContain("@artifact:artifact-1#slide=2");
    expect(html).toContain("@workspace:src/app.ts#L1-L3");
  });
});

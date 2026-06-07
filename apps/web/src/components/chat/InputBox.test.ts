import { describe, expect, it } from "vitest";
import { insertTextAtSelection } from "./InputBox.tsx";

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

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiffCard } from "./DiffCard.tsx";

describe("DiffCard", () => {
  it("renders card files through the review viewer with stable artifact anchors before async file details load", () => {
    const html = renderToStaticMarkup(createElement(DiffCard, {
      card: {
        type: "diff",
        artifactId: "artifact-1",
        files: [{ path: "src/app.ts", additions: 1, deletions: 1, status: "modified" }],
        applyStatus: "reviewing"
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("artifact-file-artifact-1-src%2Fapp.ts");
    expect(html).toContain("data-testid=\"diff-review-viewer\"");
    expect(html).toContain("No patch text available for this file.");
  });
});

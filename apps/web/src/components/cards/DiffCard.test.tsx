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
    expect(html).toContain("此文件没有可用的 patch 文本。");
  });

  it("labels apply explicitly and links to the full artifact review target", () => {
    const html = renderToStaticMarkup(createElement(DiffCard, {
      card: {
        type: "diff",
        artifactId: "artifact-1",
        files: [{ path: "src/app.ts", additions: 1, deletions: 1, status: "modified" }],
        applyStatus: "reviewing"
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("应用 Diff");
    expect(html).toContain("查看详情");
    expect(html).toContain("href=\"#artifact:artifact-1:src%2Fapp.ts\"");
  });

  it("keeps the details link available after the diff is resolved", () => {
    const html = renderToStaticMarkup(createElement(DiffCard, {
      card: {
        type: "diff",
        artifactId: "artifact-1",
        files: [{ path: "src/app.ts", additions: 1, deletions: 1, status: "modified" }],
        applyStatus: "applied"
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("查看详情");
    expect(html).toContain("href=\"#artifact:artifact-1:src%2Fapp.ts\"");
    expect(html).not.toContain("应用 Diff");
    expect(html).not.toContain("拒绝");
  });

  it("does not render a details link when no file target is available", () => {
    const html = renderToStaticMarkup(createElement(DiffCard, {
      card: {
        type: "diff",
        artifactId: "artifact-1",
        files: [],
        applyStatus: "reviewing"
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).not.toContain("查看详情");
    expect(html).not.toContain("href=\"#artifact:artifact-1\"");
  });

  it("hides the footer when a resolved diff has no available actions", () => {
    const html = renderToStaticMarkup(createElement(DiffCard, {
      card: {
        type: "diff",
        artifactId: "artifact-1",
        files: [],
        applyStatus: "applied"
      },
      csrfFetch: vi.fn<typeof fetch>()
    }));

    expect(html).not.toContain("data-slot=\"card-footer\"");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiffReviewViewer } from "./DiffReviewViewer.tsx";

describe("DiffReviewViewer", () => {
  it("renders per-file unified diff lines with change stats", () => {
    const html = renderToStaticMarkup(createElement(DiffReviewViewer, {
      files: [
        {
          path: "src/app.ts",
          fileStatus: "modified",
          additions: 1,
          deletions: 1,
          patch: [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "-old",
            "+new"
          ].join("\n")
        }
      ]
    }));

    expect(html).toContain("src/app.ts");
    expect(html).toContain("modified");
    expect(html).toContain("+1");
    expect(html).toContain("-1");
    expect(html).toContain("-old");
    expect(html).toContain("+new");
  });

  it("guards very large diffs before rendering every line", () => {
    const patch = Array.from({ length: 650 }, (_, index) => `+line ${index + 1}`).join("\n");
    const html = renderToStaticMarkup(createElement(DiffReviewViewer, {
      files: [{ path: "huge.txt", fileStatus: "modified", additions: 650, deletions: 0, patch }]
    }));

    expect(html).toContain("Large diff");
    expect(html).not.toContain("line 650");
  });

  it("renders selectable diff line buttons and focused review comments", () => {
    const html = renderToStaticMarkup(createElement(DiffReviewViewer, {
      files: [
        {
          path: "src/app.ts",
          fileStatus: "modified",
          additions: 1,
          deletions: 0,
          patch: [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "+new"
          ].join("\n")
        }
      ],
      focusedCommentId: "comment-1",
      comments: [{ id: "comment-1", filePath: "src/app.ts", lineNumber: 1, side: "new", status: "open", reason: "Check this line", reviewerKind: "user", reviewerId: "local" }],
      onLineSelect: () => undefined,
      onEditComment: () => undefined,
      onResolveComment: () => undefined,
      onDeleteComment: () => undefined
    }));

    expect(html).toContain("data-diff-line=\"src/app.ts:new:1\"");
    expect(html).toContain("data-comment-id=\"comment-1\"");
    expect(html).toContain("data-focused=\"true\"");
    expect(html).toContain("Check this line");
    expect(html).toContain("Edit");
    expect(html).toContain("Resolve");
    expect(html).toContain("Delete");
  });

  it("renders line ranges when review comments include a selected range", () => {
    const html = renderToStaticMarkup(createElement(DiffReviewViewer, {
      files: [
        {
          path: "src/app.ts",
          fileStatus: "modified",
          additions: 2,
          deletions: 0,
          patch: [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1,2 @@",
            "+first",
            "+second"
          ].join("\n")
        }
      ],
      comments: [{ id: "comment-1", filePath: "src/app.ts", lineNumber: 1, lineStart: 1, lineEnd: 2, side: "new", status: "open", reason: "Range comment" }]
    }));

    expect(html).toContain("lines 1-2");
  });

  it("renders an Open file action when a view-file handler is available", () => {
    const html = renderToStaticMarkup(createElement(DiffReviewViewer, {
      files: [
        {
          path: "src/app.ts",
          fileStatus: "modified",
          additions: 1,
          deletions: 1,
          patch: [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "-old",
            "+new"
          ].join("\n")
        }
      ],
      onViewFile: () => undefined
    }));

    expect(html).toContain("aria-label=\"Open file src/app.ts\"");
    expect(html).toContain("data-view-file=\"src/app.ts\"");
  });

  it("renders stable artifact file anchors when an artifact id is provided", () => {
    const html = renderToStaticMarkup(createElement(DiffReviewViewer, {
      artifactId: "artifact-1",
      files: [
        {
          path: "src/app.ts",
          fileStatus: "modified",
          additions: 1,
          deletions: 1,
          patch: [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "-old",
            "+new"
          ].join("\n")
        }
      ]
    }));

    expect(html).toContain("id=\"artifact-file-artifact-1-src%2Fapp.ts\"");
  });
});

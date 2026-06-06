import { afterEach, describe, expect, it, vi } from "vitest";
import { artifactHashTarget, scrollArtifactHashTarget } from "./RunDetailDrawer.tsx";
import { artifactFilePreviewRequest, artifactPreviewStateFromContent, artifactPreviewTabsAfterOpen, artifactReviewEditRequest, filterArtifactsForWorkspace } from "./tabs/ArtifactsTab.tsx";

describe("RunDetailDrawer artifact hash targeting", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "document");
  });

  it("parses artifact hash into the diff file element id", () => {
    expect(artifactHashTarget("#artifact:artifact-1:src%2Fa.ts")).toEqual({
      artifactId: "artifact-1",
      path: "src/a.ts",
      elementId: "artifact-file-artifact-1-src%2Fa.ts"
    });
  });

  it("scrolls and temporarily highlights the targeted diff file", () => {
    vi.useFakeTimers();
    const classes = new Set<string>();
    const element = {
      scrollIntoView: vi.fn(),
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        contains: (name: string) => classes.has(name)
      }
    } as unknown as HTMLElement;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        getElementById: (id: string) => id === "artifact-file-artifact-1-src%2Fa.ts" ? element : null
      }
    });

    const cleanup = scrollArtifactHashTarget("#artifact:artifact-1:src%2Fa.ts");

    expect(element.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(element.classList.contains("ah-artifact-file-highlight")).toBe(true);

    vi.advanceTimersByTime(800);
    expect(element.classList.contains("ah-artifact-file-highlight")).toBe(false);

    cleanup();
  });
});

describe("ArtifactsTab workspace filters", () => {
  it("filters artifacts by type, status, run, task, and author", () => {
    const artifacts = [
      { id: "a1", type: "diff", title: "Code", status: "reviewing", runId: "run-1", taskId: "task-1", createdBy: "builder", metadata: {} },
      { id: "a2", type: "terminal", title: "Logs", status: "applied", runId: "run-2", taskId: "task-1", createdBy: "tester", metadata: {} },
      { id: "a3", type: "file", title: "Report", status: "draft", runId: "run-1", taskId: "task-2", createdBy: "builder", metadata: {} }
    ];

    expect(filterArtifactsForWorkspace(artifacts, { type: "all", status: "all", runId: "all", taskId: "all", createdBy: "all" }).map((artifact) => artifact.id)).toEqual(["a1", "a2", "a3"]);
    expect(filterArtifactsForWorkspace(artifacts, { type: "diff", status: "all", runId: "all", taskId: "all", createdBy: "all" }).map((artifact) => artifact.id)).toEqual(["a1"]);
    expect(filterArtifactsForWorkspace(artifacts, { type: "all", status: "applied", runId: "all", taskId: "all", createdBy: "all" }).map((artifact) => artifact.id)).toEqual(["a2"]);
    expect(filterArtifactsForWorkspace(artifacts, { type: "all", status: "all", runId: "run-1", taskId: "all", createdBy: "all" }).map((artifact) => artifact.id)).toEqual(["a1", "a3"]);
    expect(filterArtifactsForWorkspace(artifacts, { type: "all", status: "all", runId: "all", taskId: "task-1", createdBy: "all" }).map((artifact) => artifact.id)).toEqual(["a1", "a2"]);
    expect(filterArtifactsForWorkspace(artifacts, { type: "all", status: "all", runId: "all", taskId: "all", createdBy: "tester" }).map((artifact) => artifact.id)).toEqual(["a2"]);
  });

  it("builds review edit requests with the daemon PATCH contract", () => {
    const request = artifactReviewEditRequest("artifact 1", {
      id: "review 1",
      filePath: "src/app.ts",
      lineNumber: 3,
      lineStart: 3,
      lineEnd: 5,
      side: "new"
    }, "Updated comment");

    expect(request.path).toBe("/artifacts/artifact%201/reviews/review%201");
    expect(request.init.method).toBe("PATCH");
    expect(JSON.parse(String(request.init.body))).toEqual({
      reason: "Updated comment",
      filePath: "src/app.ts",
      lineNumber: 3,
      lineStart: 3,
      lineEnd: 5,
      side: "new"
    });
  });

  it("builds file preview requests for a selected artifact file path", () => {
    const request = artifactFilePreviewRequest("artifact 1", "src/app.ts");

    expect(request.contentPath).toBe("/artifacts/artifact%201/files/src%2Fapp.ts");
    expect(request.rawUrl).toBe("/artifacts/artifact%201/files/src%2Fapp.ts/raw");
  });

  it("preserves raw URL when building file preview requests", () => {
    const request = artifactFilePreviewRequest("artifact:1", "docs/report.md");

    expect(request.rawUrl).toBe(`${request.contentPath}/raw`);
  });

  it("tracks opened artifact previews as most-recent tabs without duplicates", () => {
    const tabs = artifactPreviewTabsAfterOpen([
      { artifactId: "artifact-1", path: "src/a.ts", name: "src/a.ts" },
      { artifactId: "artifact-2", path: "docs/report.md", name: "docs/report.md" }
    ], { artifactId: "artifact-1", path: "src/a.ts", name: "src/a.ts" });

    expect(tabs).toEqual([
      { artifactId: "artifact-1", path: "src/a.ts", name: "src/a.ts" },
      { artifactId: "artifact-2", path: "docs/report.md", name: "docs/report.md" }
    ]);

    expect(artifactPreviewTabsAfterOpen(tabs, { artifactId: "artifact-3", path: "logs/out.txt", name: "logs/out.txt" })).toEqual([
      { artifactId: "artifact-3", path: "logs/out.txt", name: "logs/out.txt" },
      { artifactId: "artifact-1", path: "src/a.ts", name: "src/a.ts" },
      { artifactId: "artifact-2", path: "docs/report.md", name: "docs/report.md" }
    ]);
  });

  it("derives artifact preview MIME type and byte size from the opened file", () => {
    expect(artifactPreviewStateFromContent("artifact-1", "docs/report.md", "# ok\n")).toMatchObject({
      artifactId: "artifact-1",
      path: "docs/report.md",
      name: "docs/report.md",
      content: "# ok\n",
      loading: false,
      mimeType: "text/markdown; charset=utf-8",
      sizeBytes: 5
    });

    expect(artifactPreviewStateFromContent("artifact-1", "images/diagram.png", "png")).toMatchObject({
      mimeType: "image/png",
      sizeBytes: 3
    });
  });
});
